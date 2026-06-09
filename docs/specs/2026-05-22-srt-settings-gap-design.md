# SRT Settings (Single DocType) + Minimum Gap Between SRTs

**Date:** 2026-05-22
**App:** `kavach`
**New DocType:** `SRT Settings` (Single)
**Modified DocType:** `Stock Reconciliation SRT`
**Status:** Approved — ready for implementation plan

---

## 1. Problem

Operators can submit consecutive Stock Reconciliations for the same item without any spacing rule. Audit-wise, daily SRTs for the same item are usually a sign of poor process discipline (over-counting, suppressing real deltas by repeatedly "fixing" the same item). Need a configurable minimum gap.

Spec from user (2026-05-22):

> Add an SRT Settings page (like ERPNext Stock Settings / Buying Settings). For now, add one field: *"gap in two stock reconciliation of same item (days)"*. If set to 2, a user who submitted an SRT for item X today cannot create another SRT for item X until 2 days later.

## 2. Architecture

### 2.1 New Single DocType — `SRT Settings`

| Property | Value |
|---|---|
| Naming | Single (singleton — no naming series) |
| Module | Stock Reconciliation Tracking |
| Path | `apps/.../doctype/srt_settings/` |
| Files | `srt_settings.json`, `srt_settings.py`, `srt_settings.js`, `__init__.py` |
| Renders at | `/app/srt-settings` |

**Fields:**

| Fieldname | Type | Label | Default | Notes |
|---|---|---|---|---|
| `gap_between_stock_reconciliation_days` | Int | "Gap in two Stock Reconciliation of same item (days)" | `0` | `0` = no enforcement (opt-in). Non-negative validation in py controller. |

**Permissions:**

| Role | read | write | report |
|---|---|---|---|
| System Manager | ✓ | ✓ | ✓ |
| Srt Super Admin | ✓ | ✓ | ✓ |
| Srt Admin | ✓ | — | — |
| Srt User | — | — | — |

**Controller logic** (`srt_settings.py`):

```python
class SRTSettings(Document):
    def validate(self):
        if (self.gap_between_stock_reconciliation_days or 0) < 0:
            frappe.throw(_("Gap (days) cannot be negative."))
```

That's all the controller does — it's a settings doc, no lifecycle hooks needed.

### 2.2 New validate-time helper in `Stock Reconciliation SRT`

`_enforce_min_gap_between_srts()` called from `validate()` **after** `_enforce_no_duplicate_open_srt_for_item()`:

```python
def _enforce_min_gap_between_srts(self):
    gap_days = int(frappe.db.get_single_value(
        "SRT Settings", "gap_between_stock_reconciliation_days") or 0)
    if gap_days <= 0:
        return  # feature disabled
    if self.docstatus == 2:
        return  # cancelled doc — frozen
    if self.amended_from:
        return  # amendment replaces an existing doc, not a new event
    if not (self.item and self.posting_date):
        return  # mid-fill

    prev = frappe.db.sql("""
        SELECT name, posting_date FROM `tabStock Reconciliation SRT`
        WHERE item = %s AND docstatus IN (1, 2) AND name != %s
        ORDER BY posting_date DESC, posting_time DESC LIMIT 1
    """, (self.item, self.name or ""), as_dict=True)
    if not prev:
        return
    # Note: `docstatus IN (1, 2)` catches both active-workflow SRTs and
    # closed/completed ones. The duplicate-open guard
    # (_enforce_no_duplicate_open_srt_for_item) already blocks creating
    # a new SRT while a prior is docstatus IN (0, 1); in that case the
    # user sees the duplicate-open error first and the gap rule is
    # redundant but harmless. The gap rule's distinct value is enforcing
    # spacing AFTER the prior SRT reaches Close (docstatus=2) — which
    # the duplicate-open guard does not cover.

    days = abs(date_diff(self.posting_date, prev[0]["posting_date"]))
    if days < gap_days:
        from frappe.utils import add_days, formatdate
        earliest = add_days(prev[0]["posting_date"], gap_days)
        frappe.throw(_(
            "Cannot create SRT for item <b>{0}</b>: previous Stock "
            "Reconciliation for this item was on <b>{1}</b> ({2}). "
            "Minimum gap configured in SRT Settings is <b>{3}</b> days; "
            "earliest allowed posting date for a new SRT is <b>{4}</b>."
        ).format(
            self.item, formatdate(prev[0]["posting_date"]),
            prev[0]["name"], gap_days, formatdate(earliest),
        ), title=_("SRT Gap Violation"))
```

### 2.3 Workspace integration

The existing module workspace at `apps/.../workspace/kavach/kavach.json` currently has one Card Break + one Link + one Shortcut, all pointing at `Stock Reconciliation SRT`. We add SRT Settings in two places so users find it via either browse-style (links list) or quick-access (shortcuts strip):

**Add to `links` array** (append after the existing SRT link):

```json
{
  "hidden": 0,
  "is_query_report": 0,
  "label": "Setup",
  "link_count": 0,
  "link_type": "DocType",
  "onboard": 0,
  "type": "Card Break"
},
{
  "hidden": 0,
  "is_query_report": 0,
  "label": "SRT Settings",
  "link_count": 0,
  "link_to": "SRT Settings",
  "link_type": "DocType",
  "onboard": 0,
  "type": "Link"
}
```

**Add to `shortcuts` array** (append after the existing SRT shortcut):

```json
{
  "doc_view": "",
  "label": "SRT Settings",
  "link_to": "SRT Settings",
  "type": "DocType"
}
```

Verification: after `bench migrate` (which syncs workspace fixtures), `/desk/stock-reconciliation-tracking` should show:
- A new "Setup" card section listing **SRT Settings**
- A second shortcut chip labelled **SRT Settings** alongside the existing one

### 2.4 Validate order (final)

```
validate():
    _set_default_posting
    _mirror_item_name
    _stamp_child_warehouse_and_item
    _enforce_no_duplicate_rows
    _enforce_no_duplicate_open_srt_for_item
    _enforce_min_gap_between_srts          # NEW — runs after duplicate-open check
    _classify_zero_delta_ticks
    _enforce_at_least_one_reconcile_ticked
    _enforce_remark_field_permissions
    _recompute_totals
```

Order rationale: gap check sits next to the duplicate-open guard since both are item-uniqueness rules. Runs before the zero-delta classifier so a gap violation throws before any auto-untick happens (the doc shouldn't be saved at all).

## 3. Behaviour matrix

| Scenario | Outcome |
|---|---|
| First SRT for an item | Allowed (no prior submitted doc) |
| `gap_days = 0` | Always allowed (feature off) |
| New SRT, posting_date ≥ prior + gap_days | Allowed (boundary inclusive — strict `<` blocks) |
| New SRT, posting_date < prior + gap_days | Throws |
| Backdated posting_date that lands within gap (either direction) | Throws — symmetric via `abs(date_diff)` |
| Amendment of a submitted SRT | Allowed (skips check) |
| Auto-approved (Approved By System) docs count toward prior | Yes — they're docstatus=1 reconciliations |
| Cancelled SRT (docstatus=2) on new doc being saved | Skipped (no point) |
| Mid-fill (item or posting_date not set yet) | Skipped (validate fires repeatedly; don't pre-empt user) |

### 3.1 Gap reconfiguration semantics

**The gap value can be changed anytime by Srt Super Admin / System Manager.** The check runs at SRT `validate()` time, NOT retroactively, so:

- Setting `gap_days` to a higher value does NOT invalidate any existing submitted SRTs. They stay submitted.
- The new value applies to the **next** SRT save/submit attempt. The most recent docstatus=1 SRT for the item is the anchor — if the new SRT's posting_date is within the (now-larger) window from that anchor, it throws.
- Setting `gap_days` back to `0` immediately disables the check; the next save attempt succeeds with no gap query.
- Changing the value does not back-fill notifications or warnings on existing drafts. A draft that was valid yesterday under `gap_days=1` may throw on its next save today if `gap_days` was raised to `5` and the prior submitted SRT now sits inside the new window.

This means policy can evolve (e.g., tighten from 0 → 7 → 30) without data migration. The draft re-validation behavior is a deliberate property — operators should re-read the SRT Settings any time their save unexpectedly throws.

## 4. Files touched

| File | Action |
|---|---|
| `doctype/srt_settings/srt_settings.json` | Create — Single DocType with 1 field + perms |
| `doctype/srt_settings/srt_settings.py` | Create — controller with `validate()` non-negative gate |
| `doctype/srt_settings/srt_settings.js` | Create — minimal refresh hook (no logic yet; placeholder for future settings) |
| `doctype/srt_settings/__init__.py` | Create — empty |
| `doctype/stock_reconciliation_srt/stock_reconciliation_srt.py` | Modify — `_enforce_min_gap_between_srts()` helper + call from `validate()` + header restricted-area entries |
| `workspace/kavach/kavach.json` | Modify — append "Setup" card-break + SRT Settings link + SRT Settings shortcut |
| `tests/test_srt_settings_gap.py` | Create — 5 assertion-based tests + runner |
| `kavach.md` (app root) | Modify — new §13 + sync block update to v0.0.3 |
| `kavach/kavach/kavach.md` (module) | Modify — append paragraph about SRT Settings |
| Claude memory `app_kavach.md` | Modify — bump description to v0.0.3, add Settings to "What it does", add restricted areas, add Live test entry |

No `install.py` change needed — DocType perms live in JSON; no workflow or role changes. SRT Settings is a Single, so `bench migrate` auto-creates the singleton row on first read.

## 5. Restricted areas (post-implementation)

- **Don't store the gap value on individual SRT docs.** It's a Single setting; reading from SRT Settings on every validate is the right path (Frappe caches Singles).
- **Don't filter the prior-SRT query by warehouse.** Spec is "same item" — an SRT for item X in WH1 still blocks a new SRT for item X in WH2 within the gap window.
- **Don't skip the check for Approved By System docs.** They ARE completed reconciliations and count toward the gap window.
- **Don't fold the check into `_enforce_no_duplicate_open_srt_for_item`.** They have different semantics (duplicate-open vs. min-gap) and different error messages — separate functions keep both readable.
- **Don't let the gap go negative.** `srt_settings.py:validate` clamps `gap_days >= 0`.
- **Don't change `abs(date_diff(...))` to a one-directional check** without user approval. Symmetric was the explicit design choice — backdated docs within the window should be blocked too.
- **Don't add an "ignore gap" flag on the SRT doc to override the setting** without an audit-permission gate. The whole point is process discipline.
- **Don't query for prior SRTs without the `name != self.name` filter.** On re-save the current doc would match itself and the check would always trip on a second save round.

## 6. Testing plan

`tests/test_srt_settings_gap.py` — 5 assertion-based tests (runnable via `bench --site … execute kavach.tests.test_srt_settings_gap.run_all`):

1. **test_gap_disabled_allows_back_to_back** — set gap_days=0, create + submit one SRT, create another with same posting_date, assert no throw.
2. **test_gap_blocks_within_window** — set gap_days=2, submit one SRT with posting_date=today, try to insert another with posting_date in [today-1, today, today+1], assert all three throw with "SRT Gap Violation".
3. **test_gap_allows_after_window** — set gap_days=2, prior was 2 days ago, new SRT today, assert no throw.
4. **test_amendment_skips_gap** — set gap_days=10, submit one SRT, amend it (sets `amended_from`), assert amend insert succeeds.
5. **test_gap_reconfig_takes_effect_immediately** — set gap_days=0, submit one SRT, then set gap_days=30, try to insert a second SRT with same posting_date, assert throws. Confirms the gap is read fresh on each validate (not cached against the old setting). Then set gap_days back to 0, retry — assert succeeds.

All tests reset `gap_days` to 0 in their teardown so they don't poison each other.

## 7. Out of scope

- UX presets / quick-pick buttons on SRT Settings (e.g., "1 week", "1 month") — single Int field is enough for now per spec.
- Per-item-group gap overrides — could be a future Setting addition.
- Per-warehouse scoping of the gap check (decided: same-item rule, no warehouse split).
- Notification / email when a gap violation is attempted — error is sufficient.
- Backfill / audit on existing data — the gap is a forward-looking validation only.

## 8. References

- App memory: `~/.claude/projects/-workspace/memory/app_kavach.md`
- Pattern reference: `apps/erpnext/erpnext/stock/doctype/stock_settings/` (Single + controller validate)
- Prior spec for context: `docs/specs/2026-05-22-srt-case1-case2-design.md`
- Existing duplicate guard: `stock_reconciliation_srt.py:_enforce_no_duplicate_open_srt_for_item`
