# SRT Settings + Min-Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Single DocType `SRT Settings` with one Int field (`gap_between_stock_reconciliation_days`) and a `validate()` gate on `Stock Reconciliation SRT` that blocks creating a new SRT for an item until `gap_days` have elapsed from the previous submitted SRT's `posting_date`.

**Architecture:** New Single DocType under the existing module; new `_enforce_min_gap_between_srts()` helper inserted into the existing `validate()` chain after `_enforce_no_duplicate_open_srt_for_item`. Workspace JSON gains a "Setup" card-break + SRT Settings link/shortcut. Verification follows the project's bench-console assertion-script pattern (no pytest).

**Tech Stack:** Frappe v16 / Python 3.14 / ERPNext v16 — Single DocType + Workspace fixture.

**Spec:** `apps/kavach/docs/specs/2026-05-22-srt-settings-gap-design.md`

**Source-control note:** The SRT app folder is NOT a standalone git repo (parent `/workspace` repo `.gitignore`s `development/frappe-bench/`). Skip the `git commit` steps; treat each task's "Commit" step as an on-disk save checkpoint.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `apps/kavach/kavach/kavach/doctype/srt_settings/__init__.py` | Python package marker | Create |
| `apps/kavach/kavach/kavach/doctype/srt_settings/srt_settings.json` | DocType definition (Single, 1 field, perms) | Create |
| `apps/kavach/kavach/kavach/doctype/srt_settings/srt_settings.py` | Controller — non-negative gap_days validation | Create |
| `apps/kavach/kavach/kavach/doctype/srt_settings/srt_settings.js` | Minimal form JS (placeholder for future settings) | Create |
| `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.py` | Add `_enforce_min_gap_between_srts()` + call from `validate()` + header comments | Modify |
| `apps/kavach/kavach/kavach/workspace/kavach/kavach.json` | Append "Setup" card-break + SRT Settings link + SRT Settings shortcut | Modify |
| `apps/kavach/kavach/tests/test_srt_settings_gap.py` | 5 assertion-based verification tests + `run_all()` | Create |
| `apps/kavach/kavach.md` (app root) | New §13 (SRT Settings + gap rule) + Sync Block to v0.0.3 | Modify |
| `apps/kavach/kavach/kavach/kavach.md` (module) | Append SRT Settings paragraph | Modify |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | v0.0.3 description; add Settings to "What it does"; add restricted areas | Modify |

---

## Task 1: Write the failing verification script

**Files:**
- Create: `apps/kavach/kavach/tests/test_srt_settings_gap.py`

### Why this comes first

TDD discipline — assertions first; observe RED before implementing. Tests use the project's existing bench-console pattern (no pytest framework in this app).

Re-uses `_pick_warehouse()`, `_cleanup_open_srt_for_item()`, `_build_srt()` from the sibling test file (`tests/test_case1_case2.py`) by importing them — avoid duplicating fixtures.

- [ ] **Step 1: Write the verification script**

Create `apps/kavach/kavach/tests/test_srt_settings_gap.py`:

```python
# =============================================================================
# CONTEXT: Runnable verification for SRT Settings min-gap-between-SRTs
# rule. Mirrors the convention established in test_case1_case2.py —
# bench-console scripts that assert state on the live dev-site.
#
# Run with:
#   bench --site development.localhost execute \
#     kavach.tests.test_srt_settings_gap.run_all
#
# MEMORY: app_kavach.md § Live test 2026-05-22
# SPEC:   docs/specs/2026-05-22-srt-settings-gap-design.md
# =============================================================================

import frappe
from frappe.utils import add_days, flt, getdate, nowdate

from kavach.tests.test_case1_case2 import (
    TEST_ITEM,
    _build_srt,
    _cleanup_open_srt_for_item,
    _pick_warehouse,
)


SETTINGS_DOCTYPE = "SRT Settings"
SETTINGS_FIELD = "gap_between_stock_reconciliation_days"


def _set_gap(days):
    """Update SRT Settings.gap_between_stock_reconciliation_days
    and clear cache so the next validate() reads the new value."""
    frappe.db.set_single_value(SETTINGS_DOCTYPE, SETTINGS_FIELD, int(days))
    frappe.db.commit()
    frappe.clear_document_cache(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE)


def _submit_first_srt_with_delta(warehouse, posting_date):
    """Helper — build, insert, and SUBMIT an SRT with one ticked +1 delta row
    so docstatus becomes 1 via the normal flow (NOT the auto-approve path —
    that would create a doc that counts as a 'prior SRT' but takes the
    Approved By System branch, which is fine but mixes intents).

    Returns the submitted doc's name."""
    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        frappe.throw("Need at least 1 batch on test item to run gap tests")
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.posting_date = posting_date
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    return doc.name


# ── Test 1 ─────────────────────────────────────────────────────────────────
def test_gap_disabled_allows_back_to_back():
    """gap_days=0 — feature off. Two SRTs same day for same item must
    not throw on the gap rule (the duplicate-open guard kicks in only
    if the FIRST is still open; here we submit it first so it's closed)."""
    _set_gap(0)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    today = nowdate()
    first = _submit_first_srt_with_delta(warehouse, today)

    # Now insert a SECOND SRT for same item, same posting_date — should pass.
    doc = _build_srt(TEST_ITEM, warehouse)
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.posting_date = today
    doc.insert(ignore_permissions=True)  # must not throw on gap
    print(f"  PASS test_gap_disabled_allows_back_to_back "
          f"(first={first}, second={doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 2 ─────────────────────────────────────────────────────────────────
def test_gap_blocks_within_window():
    """gap_days=2 — first SRT today. New SRT with posting_date in
    {today-1, today, today+1} must all throw."""
    _set_gap(2)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    today = nowdate()
    _submit_first_srt_with_delta(warehouse, today)

    blocked_dates = [add_days(today, -1), today, add_days(today, 1)]
    for d in blocked_dates:
        doc = _build_srt(TEST_ITEM, warehouse)
        for r in doc.batches:
            r.is_counted = 1
            r.qty_found = flt(r.current_stock_in_selected_uom)
        doc.posting_date = d
        threw = False
        try:
            doc.insert(ignore_permissions=True)
        except frappe.ValidationError as e:
            if "SRT Gap Violation" in str(e) or "Gap Violation" in str(e) \
                    or "Minimum gap" in str(e):
                threw = True
        assert threw, f"expected throw for posting_date={d}, but insert succeeded"

    print(f"  PASS test_gap_blocks_within_window "
          f"(3 dates blocked: {blocked_dates})")
    _set_gap(0)
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 3 ─────────────────────────────────────────────────────────────────
def test_gap_allows_after_window():
    """gap_days=2 — first SRT two days ago. New SRT today must pass."""
    _set_gap(2)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    two_days_ago = add_days(nowdate(), -2)
    _submit_first_srt_with_delta(warehouse, two_days_ago)

    doc = _build_srt(TEST_ITEM, warehouse)
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)  # must pass (days=2 == gap_days=2)
    print(f"  PASS test_gap_allows_after_window ({doc.name})")
    _set_gap(0)
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 4 ─────────────────────────────────────────────────────────────────
def test_amendment_skips_gap():
    """gap_days=10 — amend a recently submitted SRT. Amendment must pass
    even though it would otherwise be within the gap window."""
    _set_gap(0)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    today = nowdate()
    original_name = _submit_first_srt_with_delta(warehouse, today)
    # Cancel so we can amend
    original = frappe.get_doc("Stock Reconciliation SRT", original_name)
    original.flags.ignore_permissions = True
    original.cancel()
    frappe.db.commit()

    # Now turn the gap on AFTER the cancel, then amend
    _set_gap(10)
    amend = frappe.copy_doc(original)
    amend.amended_from = original.name
    amend.posting_date = today
    # Repopulate at least one tickable row (original may have had only 1)
    for r in amend.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    amend.insert(ignore_permissions=True)  # must NOT throw on gap
    print(f"  PASS test_amendment_skips_gap "
          f"(original={original.name}, amend={amend.name})")
    _set_gap(0)
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 5 ─────────────────────────────────────────────────────────────────
def test_gap_reconfig_takes_effect_immediately():
    """gap_days=0 → submit one SRT. Bump gap_days=30 → next SRT same
    posting_date must throw. Set gap_days back to 0 → retry must pass."""
    _set_gap(0)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    today = nowdate()
    _submit_first_srt_with_delta(warehouse, today)

    # Bump gap up — next save must throw
    _set_gap(30)
    doc = _build_srt(TEST_ITEM, warehouse)
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.posting_date = today
    threw = False
    try:
        doc.insert(ignore_permissions=True)
    except frappe.ValidationError as e:
        if "Gap" in str(e) or "Minimum gap" in str(e):
            threw = True
    assert threw, "gap_days=30 should have blocked same-day insert"

    # Bring gap back to 0 — retry must pass
    _set_gap(0)
    doc2 = _build_srt(TEST_ITEM, warehouse)
    for r in doc2.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc2.posting_date = today
    doc2.insert(ignore_permissions=True)  # must pass
    print(f"  PASS test_gap_reconfig_takes_effect_immediately ({doc2.name})")
    _set_gap(0)
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_gap_disabled_allows_back_to_back,
        test_gap_blocks_within_window,
        test_gap_allows_after_window,
        test_amendment_skips_gap,
        test_gap_reconfig_takes_effect_immediately,
    ]
    print(f"\n=== SRT Settings min-gap verification ({len(tests)} tests) ===")
    failures = []
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failures.append((t.__name__, e))
            try:
                _set_gap(0)
                _cleanup_open_srt_for_item(TEST_ITEM)
            except Exception:
                pass
    print(f"\n=== {len(tests) - len(failures)} / {len(tests)} passed ===")
    if failures:
        raise AssertionError(
            f"{len(failures)} test(s) failed: "
            + ", ".join(n for n, _ in failures)
        )
```

- [ ] **Step 2: Run the script — confirm it FAILS with the "DocType not found" symptom**

Run from `/workspace/development/frappe-bench`:

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

Expected: every test (or the first one) fails because `SRT Settings` doctype doesn't exist yet — `frappe.db.set_single_value` will throw `DoesNotExistError: DocType SRT Settings not found` or similar.

This is the RED state — proves the tests exercise the new code path.

- [ ] **Step 3: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/tests/test_srt_settings_gap.py
```

---

## Task 2: Create the SRT Settings Single DocType

**Files:**
- Create: `apps/kavach/kavach/kavach/doctype/srt_settings/__init__.py`
- Create: `apps/kavach/kavach/kavach/doctype/srt_settings/srt_settings.json`
- Create: `apps/kavach/kavach/kavach/doctype/srt_settings/srt_settings.py`
- Create: `apps/kavach/kavach/kavach/doctype/srt_settings/srt_settings.js`

### Why grouped

All 4 files are the DocType's atomic shape — Frappe requires them together (`bench reload-doc` fails if any are missing). Single-task commit avoids a half-installed doctype.

- [ ] **Step 1: Create the package marker**

Create empty file `apps/.../doctype/srt_settings/__init__.py`:

```python
```

- [ ] **Step 2: Create the JSON definition**

Create `apps/.../doctype/srt_settings/srt_settings.json`:

```json
{
 "actions": [],
 "allow_rename": 0,
 "creation": "2026-05-22 00:00:00.000000",
 "doctype": "DocType",
 "engine": "InnoDB",
 "field_order": [
  "gap_between_stock_reconciliation_days"
 ],
 "fields": [
  {
   "default": "0",
   "description": "Minimum number of days that must pass between two submitted Stock Reconciliation SRT docs for the same item. Set to 0 to disable enforcement. The check is applied at validate-time and is symmetric (backdated docs landing within the window are also blocked).",
   "fieldname": "gap_between_stock_reconciliation_days",
   "fieldtype": "Int",
   "label": "Gap in two Stock Reconciliation of same item (days)",
   "non_negative": 1
  }
 ],
 "index_web_pages_for_search": 0,
 "issingle": 1,
 "links": [],
 "modified": "2026-05-22 00:00:00.000000",
 "modified_by": "Administrator",
 "module": "Stock Reconciliation Tracking",
 "name": "SRT Settings",
 "owner": "Administrator",
 "permissions": [
  {
   "create": 1,
   "delete": 0,
   "email": 1,
   "export": 1,
   "print": 1,
   "read": 1,
   "report": 1,
   "role": "System Manager",
   "share": 1,
   "write": 1
  },
  {
   "create": 1,
   "delete": 0,
   "email": 0,
   "export": 0,
   "print": 1,
   "read": 1,
   "report": 1,
   "role": "Srt Super Admin",
   "share": 0,
   "write": 1
  },
  {
   "create": 0,
   "delete": 0,
   "email": 0,
   "export": 0,
   "print": 1,
   "read": 1,
   "report": 0,
   "role": "Srt Admin",
   "share": 0,
   "write": 0
  }
 ],
 "sort_field": "modified",
 "sort_order": "DESC",
 "states": [],
 "track_changes": 1
}
```

- [ ] **Step 3: Create the controller**

Create `apps/.../doctype/srt_settings/srt_settings.py`:

```python
# =============================================================================
# CONTEXT: SRT Settings — Single DocType holding cross-cutting settings
# for the kavach module. Currently one field:
# gap_between_stock_reconciliation_days. Future settings will live here
# alongside it.
#
# MEMORY: app_kavach.md
# SPEC:   docs/specs/2026-05-22-srt-settings-gap-design.md
#
# INSTRUCTIONS:
#   - Validation is intentionally minimal — clamp gap_days >= 0. Frappe's
#     `non_negative=1` on the field also covers the UI; this is the
#     server-side belt for API callers.
#   - DO NOT add lifecycle hooks (on_update etc.) unless a new setting
#     genuinely needs them. Cross-cutting Settings docs should stay
#     reactive (read-on-validate) not push-on-save.
#
# RESTRICT:
#   - Do NOT rename `gap_between_stock_reconciliation_days` —
#     stock_reconciliation_srt._enforce_min_gap_between_srts reads it by
#     literal fieldname via frappe.db.get_single_value.
# =============================================================================

import frappe
from frappe import _
from frappe.model.document import Document


class SRTSettings(Document):
    def validate(self):
        if (self.gap_between_stock_reconciliation_days or 0) < 0:
            frappe.throw(_("Gap (days) cannot be negative."))
```

- [ ] **Step 4: Create the JS placeholder**

Create `apps/.../doctype/srt_settings/srt_settings.js`:

```javascript
// =============================================================================
// SRT Settings — form-level JS placeholder.
// No interactive logic needed today (single Int field renders natively).
// Future settings that need conditional UX can hook into refresh() here.
// =============================================================================

frappe.ui.form.on("SRT Settings", {
    refresh(frm) {
        // intentionally empty — placeholder for future settings UX
    },
});
```

- [ ] **Step 5: Reload the doctype + run migrate**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost reload-doc \
  kavach kavach.doctype.srt_settings.srt_settings
bench --site development.localhost migrate
```

Expected: reload-doc succeeds; migrate runs clean. The singleton row is auto-materialised on first read.

- [ ] **Step 6: Verify the DocType is queryable**

```bash
bench --site development.localhost execute frappe.client.get_value \
  --kwargs '{"doctype":"SRT Settings","fieldname":"gap_between_stock_reconciliation_days"}'
```

Expected output: `{'gap_between_stock_reconciliation_days': 0}` (default 0).

- [ ] **Step 7: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/doctype/srt_settings/
```

---

## Task 3: Add `_enforce_min_gap_between_srts()` to the SRT controller

**Files:**
- Modify: `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.py`

- [ ] **Step 1: Add the helper method**

Locate the existing `_enforce_no_duplicate_open_srt_for_item` method (around line 460 in the current file). Insert the new helper IMMEDIATELY AFTER its closing `if existing: ... frappe.throw(...)` block, so the two related item-uniqueness rules sit together:

```python
    def _enforce_min_gap_between_srts(self):
        """Block creating a new SRT for an item within the minimum-gap
        window defined in SRT Settings. The gap is measured against the
        most recent submitted (docstatus=1) SRT for the same item,
        using posting_date — symmetric (backdated docs within window
        also blocked) via abs(date_diff).

        Skipped when:
          - gap_days == 0 (feature disabled — opt-in)
          - self.docstatus == 2 (cancelled — frozen)
          - self.amended_from is set (amendments replace, not duplicate)
          - item or posting_date not yet set (mid-fill)

        Note: includes Approved By System docs in the prior search —
        they ARE completed reconciliations even though they skip the
        ERPNext SR creation.

        SPEC: docs/specs/2026-05-22-srt-settings-gap-design.md § 2.2
        RESTRICT: do NOT filter prior-SRT query by warehouse; spec is
        "same item" regardless of warehouse.
        """
        from frappe.utils import add_days, date_diff, formatdate

        gap_days = int(frappe.db.get_single_value(
            "SRT Settings", "gap_between_stock_reconciliation_days") or 0)
        if gap_days <= 0:
            return
        if self.docstatus == 2:
            return
        if self.amended_from:
            return
        if not (self.item and self.posting_date):
            return

        prev = frappe.db.sql("""
            SELECT name, posting_date FROM `tabStock Reconciliation SRT`
            WHERE item = %s AND docstatus = 1 AND name != %s
            ORDER BY posting_date DESC, posting_time DESC LIMIT 1
        """, (self.item, self.name or ""), as_dict=True)
        if not prev:
            return

        days = abs(date_diff(self.posting_date, prev[0]["posting_date"]))
        if days < gap_days:
            earliest = add_days(prev[0]["posting_date"], gap_days)
            frappe.throw(_(
                "Cannot create SRT for item <b>{0}</b>: the previous Stock "
                "Reconciliation for this item was on <b>{1}</b> ({2}). "
                "Minimum gap configured in SRT Settings is <b>{3}</b> days; "
                "earliest allowed posting date for a new SRT is <b>{4}</b>."
            ).format(
                self.item, formatdate(prev[0]["posting_date"]),
                prev[0]["name"], gap_days, formatdate(earliest),
            ), title=_("SRT Gap Violation"))
```

- [ ] **Step 2: Wire the helper into `validate()`**

Find the existing `validate()` method (around line 132). Insert the new call IMMEDIATELY AFTER `self._enforce_no_duplicate_open_srt_for_item()` and BEFORE `self._classify_zero_delta_ticks()`:

```python
    def validate(self):
        self._set_default_posting()
        self._mirror_item_name()
        self._stamp_child_warehouse_and_item()
        self._enforce_no_duplicate_rows()
        self._enforce_no_duplicate_open_srt_for_item()
        self._enforce_min_gap_between_srts()        # NEW (2026-05-22)
        self._classify_zero_delta_ticks()
        self._enforce_at_least_one_reconcile_ticked()
        self._enforce_remark_field_permissions()
        self._recompute_totals()
```

- [ ] **Step 3: Add restricted-area entries to the header comment block**

Find the `# RESTRICT:` section at the top of the file. Append these three bullets to the end of that section (just before the `# GOTCHA — ...` line):

```python
#   - Do NOT rename `gap_between_stock_reconciliation_days` (SRT Settings
#     field). _enforce_min_gap_between_srts reads it by literal fieldname.
#   - Do NOT filter `_enforce_min_gap_between_srts`'s prior-SRT query by
#     warehouse — spec is "same item" regardless of warehouse.
#   - Do NOT add an "ignore gap" flag on the SRT doc to override the
#     setting without an audit-permission gate. Process discipline is
#     the whole point of the gap.
```

- [ ] **Step 4: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.py
```

---

## Task 4: Run the verification — all 5 tests must PASS

**Files:** (none modified — verification only)

- [ ] **Step 1: Run the suite**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

Expected output:

```
=== SRT Settings min-gap verification (5 tests) ===
  PASS test_gap_disabled_allows_back_to_back (first=SRT-RECO-2026-NNNNN, second=SRT-RECO-2026-NNNNN)
  PASS test_gap_blocks_within_window (3 dates blocked: ['2026-05-21', '2026-05-22', '2026-05-23'])
  PASS test_gap_allows_after_window (SRT-RECO-2026-NNNNN)
  PASS test_amendment_skips_gap (original=SRT-RECO-2026-NNNNN, amend=SRT-RECO-2026-NNNNN-1)
  PASS test_gap_reconfig_takes_effect_immediately (SRT-RECO-2026-NNNNN)

=== 5 / 5 passed ===
```

- [ ] **Step 2: If any test fails, diagnose**

Failure modes:
- "DocType SRT Settings not found" → Task 2 reload-doc/migrate skipped or failed — re-run Step 5 of Task 2.
- Test 1 fails with duplicate-open guard message → expected; the FIRST submit happens BEFORE the second insert, so the first is docstatus=1 (closed for the duplicate-open guard). If you see the duplicate-open error, the test ordering broke somewhere — re-read `_submit_first_srt_with_delta`.
- Test 2 doesn't throw on `today` → epsilon math: days = abs(date_diff(today, today)) = 0, which IS < 2. If it doesn't throw, `_enforce_min_gap_between_srts` isn't being called — verify Step 2 of Task 3 (the call ordering in `validate()`).
- Test 4 throws on amendment → the `amended_from` early-return in the helper is missing; re-check Step 1 of Task 3.
- Test 5 second-half (gap_days=0 retry) throws → the helper isn't reading the live value; check there's no caching layer wrapping `get_single_value`.

- [ ] **Step 3: Verify no stray test docs**

```bash
bench --site development.localhost console <<'PYEOF' 2>&1 | tail -5
import frappe
n = frappe.db.count("Stock Reconciliation SRT",
                    {"item": "CZMAT/1585", "docstatus": ["!=", 2]})
print(f"open test docs after run: {n}")
PYEOF
```

Expected: `open test docs after run: 0`.

---

## Task 5: Workspace integration — add SRT Settings to the module workspace

**Files:**
- Modify: `apps/kavach/kavach/kavach/workspace/kavach/kavach.json`

- [ ] **Step 1: Append the "Setup" card-break and SRT Settings link**

Find the existing `"links": [...]` array. It currently contains exactly two entries: one Card Break (label "Stock Reconciliation") and one Link (label "Stock Reconciliation SRT"). Replace the closing `]` of the `links` array with the two new entries + the closing bracket:

Before:

```json
 "links": [
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "Stock Reconciliation",
   "link_count": 0,
   "link_type": "DocType",
   "onboard": 0,
   "type": "Card Break"
  },
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "Stock Reconciliation SRT",
   "link_count": 0,
   "link_to": "Stock Reconciliation SRT",
   "link_type": "DocType",
   "onboard": 0,
   "type": "Link"
  }
 ],
```

After:

```json
 "links": [
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "Stock Reconciliation",
   "link_count": 0,
   "link_type": "DocType",
   "onboard": 0,
   "type": "Card Break"
  },
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "Stock Reconciliation SRT",
   "link_count": 0,
   "link_to": "Stock Reconciliation SRT",
   "link_type": "DocType",
   "onboard": 0,
   "type": "Link"
  },
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
 ],
```

- [ ] **Step 2: Append the SRT Settings shortcut**

Find the existing `"shortcuts": [...]` array. It currently has one entry. Replace its closing `]` with the new entry + closing bracket:

Before:

```json
 "shortcuts": [
  {
   "doc_view": "",
   "label": "Stock Reconciliation SRT",
   "link_to": "Stock Reconciliation SRT",
   "type": "DocType"
  }
 ],
```

After:

```json
 "shortcuts": [
  {
   "doc_view": "",
   "label": "Stock Reconciliation SRT",
   "link_to": "Stock Reconciliation SRT",
   "type": "DocType"
  },
  {
   "doc_view": "",
   "label": "SRT Settings",
   "link_to": "SRT Settings",
   "type": "DocType"
  }
 ],
```

- [ ] **Step 3: Sync the workspace fixture into the DB**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost migrate
bench --site development.localhost clear-cache
```

The `migrate` step picks up workspace JSON changes and upserts the Workspace doc. The cache clear ensures the desk re-fetches.

- [ ] **Step 4: Verify via SQL**

```bash
bench --site development.localhost mariadb -e "SELECT label, link_to, type FROM \`tabWorkspace Link\` WHERE parent='Stock Reconciliation Tracking' ORDER BY idx;"
```

Expected: 4 rows:

```
Stock Reconciliation         NULL                          Card Break
Stock Reconciliation SRT     Stock Reconciliation SRT      Link
Setup                        NULL                          Card Break
SRT Settings                 SRT Settings                  Link
```

```bash
bench --site development.localhost mariadb -e "SELECT label, link_to FROM \`tabWorkspace Shortcut\` WHERE parent='Stock Reconciliation Tracking' ORDER BY idx;"
```

Expected: 2 rows — `Stock Reconciliation SRT` + `SRT Settings`.

- [ ] **Step 5: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/workspace/kavach/kavach.json
```

---

## Task 6: Browser smoke (manual — deferred to user if no browser available)

**Files:** (none — manual UI verification)

- [ ] **Step 1: Workspace UX**

Open `/desk/stock-reconciliation-tracking` (browser). Hard-reload to bust the cache. Expect:
- Two card sections: existing "Stock Reconciliation" + new "Setup"
- Under "Setup": a link **SRT Settings**
- Top shortcuts strip: two chips — **Stock Reconciliation SRT** and **SRT Settings**

- [ ] **Step 2: SRT Settings form**

Click the SRT Settings chip (or navigate to `/app/srt-settings`). Expect:
- Single field: "Gap in two Stock Reconciliation of same item (days)", default `0`
- Form saves cleanly
- Setting a negative value (-1) and Save → throws "Gap (days) cannot be negative."

- [ ] **Step 3: Gap rule on the SRT form**

Set gap_days to `2` in SRT Settings, save. Open the most recent submitted SRT for an item, note its posting_date. Create a NEW SRT for the same item with posting_date today, tick a row, save. Expect: throws "SRT Gap Violation" with the earliest-allowed date in the message.

- [ ] **Step 4: Disable gap, retry**

Set gap_days back to `0`, save. Retry the same New SRT form: must save cleanly.

If no browser available: server-side equivalents of Steps 2–4 are covered by Task 4's verification script. Step 1 (workspace UX rendering) has no server equivalent — defer to user.

---

## Task 7: Update app-root and module .md docs

**Files:**
- Modify: `apps/kavach/kavach.md`
- Modify: `apps/kavach/kavach/kavach/kavach.md`

- [ ] **Step 1: Add §13 to app-root .md**

Find the existing `## 12. Sync Block — 2026-05-22 (v0.0.2)` heading. Insert the new section IMMEDIATELY BEFORE it:

```markdown
---

## 13. SRT Settings + Minimum Gap Between SRTs — 2026-05-22 (v0.0.3)

### Spec
`docs/specs/2026-05-22-srt-settings-gap-design.md`

### What was added

- **New Single DocType `SRT Settings`** at `/app/srt-settings`. One field today:
  `gap_between_stock_reconciliation_days` (Int, default 0). Future
  cross-cutting settings will live here.
- **Workspace integration** — new "Setup" card-break + SRT Settings link
  + SRT Settings shortcut, visible on `/desk/stock-reconciliation-tracking`.
- **New validate-time gate** on `Stock Reconciliation SRT`:
  `_enforce_min_gap_between_srts()`. Reads SRT Settings on every save
  (no caching layer on top of `frappe.db.get_single_value`). Throws
  `SRT Gap Violation` when the new SRT's posting_date is within
  `gap_days` of the most recent submitted (docstatus=1) SRT for the
  same item — symmetric (`abs(date_diff)`).

### Behaviour

- `gap_days = 0` (default) → feature off
- Amendments skip the check (`amended_from` early-return)
- Auto-approved (Approved By System) docs COUNT as prior submitted docs
- Same-item rule (NOT same-item-same-warehouse)
- Configurable anytime by Srt Super Admin / System Manager; new value
  takes effect on the next save (no retroactive invalidation)

### Permissions

| Role | SRT Settings access |
|---|---|
| System Manager | full (read/write/create/print/email/export/share/report) |
| Srt Super Admin | read/write/create/print/report |
| Srt Admin | read-only/print |
| Srt User | none |

### Restricted areas (additional, 2026-05-22)

- Don't rename `gap_between_stock_reconciliation_days` —
  `_enforce_min_gap_between_srts` reads it by literal fieldname.
- Don't filter the prior-SRT query by warehouse — spec is same-item.
- Don't skip the check for Approved By System docs — they're docstatus=1
  reconciliations.
- Don't add a per-doc "ignore gap" flag without an audit-permission gate.
- Don't cache the SRT Settings value — read fresh on every validate so
  reconfig takes effect immediately.

### Verification

5 assertion-based tests in `kavach/tests/test_srt_settings_gap.py`:
- `test_gap_disabled_allows_back_to_back`
- `test_gap_blocks_within_window`
- `test_gap_allows_after_window`
- `test_amendment_skips_gap`
- `test_gap_reconfig_takes_effect_immediately`

Run via:

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

---
```

- [ ] **Step 2: Bump the Sync Block header**

Change the heading `## 12. Sync Block — 2026-05-22 (v0.0.2)` to:

```markdown
## 12. Sync Block — 2026-05-22 (v0.0.3)
```

- [ ] **Step 3: Add a new `LATEST UPDATE 2026-05-22 (v0.0.3)` block to the Sync Block**

Find the existing `LATEST UPDATE 2026-05-22` text block inside §12. ABOVE it, add:

```
LATEST UPDATE 2026-05-22 (v0.0.3)
            + New Single DocType: SRT Settings (/app/srt-settings)
                - Field: gap_between_stock_reconciliation_days (Int, default 0)
                - Perms: SysMan + Srt Super Admin = write; Srt Admin = read;
                  Srt User = none.
            + Workspace integration: new "Setup" card-break + SRT Settings
                link + SRT Settings shortcut on the module workspace.
            + Stock Reconciliation SRT: new validate helper
                _enforce_min_gap_between_srts() — runs after the
                duplicate-open guard, before the zero-delta classifier.
                Symmetric (abs(date_diff)), skips amendments + cancelled
                + mid-fill docs. Throws "SRT Gap Violation" with
                earliest-allowed posting_date.
            + Configurable anytime — reconfig takes effect on next save;
                no caching, no retroactive invalidation.
            + Verification: tests/test_srt_settings_gap.py (5 tests).
                5 / 5 passed on dev site.
```

- [ ] **Step 4: Append to the module .md**

Append at the end of `apps/.../kavach/kavach.md`:

```markdown

---

## SRT Settings (2026-05-22)

Module ships a Single DocType `SRT Settings` (renders at `/app/srt-settings`).
Today's one field: `gap_between_stock_reconciliation_days` (Int, default 0).
When non-zero, the SRT controller's `_enforce_min_gap_between_srts()` helper
blocks creating a new SRT for an item until at least that many days have
passed since the previous submitted SRT for the same item (measured against
`posting_date`, symmetric via `abs(date_diff)`).

Workspace at `/desk/stock-reconciliation-tracking` exposes SRT Settings via:
- a "Setup" card-break + SRT Settings link in the links list
- a SRT Settings chip in the shortcuts strip

See app-root §13 and spec
`../../docs/specs/2026-05-22-srt-settings-gap-design.md` for restricted-areas
and the full reasoning.
```

- [ ] **Step 5: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach.md
ls -l apps/kavach/kavach/kavach/kavach.md
```

---

## Task 8: Update Claude memory

**Files:**
- Modify: `~/.claude/projects/-workspace/memory/app_kavach.md`

- [ ] **Step 1: Bump the version in the frontmatter description**

Change `description:` line to:

```yaml
description: "kavach v0.0.3 (2026-05-22) — ERPNext SR wrapper with batch auto-populate, UOM conversion, two-pass rate-mirror, RBAC workflow, Case 1 / Case 2 routing, and SRT Settings (min-gap-between-SRTs gate)."
```

- [ ] **Step 2: Add item 8 to "What it does"**

After the existing item 7 (Case 2 auto-untick), append:

```markdown
8. **SRT Settings + min-gap rule (2026-05-22 v0.0.3) — process discipline gate:** new Single DocType `SRT Settings` with field `gap_between_stock_reconciliation_days` (Int, default 0). When non-zero, `_enforce_min_gap_between_srts()` blocks new SRTs for an item until `gap_days` have elapsed (measured against the prior submitted SRT's `posting_date`, symmetric). Includes auto-approved (Approved By System) docs as priors. Same-item rule (not same-item-same-warehouse). Configurable anytime — reconfig takes effect on the next validate.
```

- [ ] **Step 3: Add to Restricted areas**

Append to the existing `## Restricted areas` section:

```markdown
- **Don't rename `gap_between_stock_reconciliation_days`** — `_enforce_min_gap_between_srts` reads it by literal fieldname via `frappe.db.get_single_value`.
- **Don't filter the prior-SRT query by warehouse** — spec is "same item" regardless of warehouse.
- **Don't skip the check for Approved By System docs** — they're docstatus=1 reconciliations and count as priors.
- **Don't add a per-doc "ignore gap" flag without an audit-permission gate** — the gap is a process discipline rule, not a hint.
- **Don't cache the SRT Settings value** — read fresh on every validate so reconfig takes effect immediately.
```

- [ ] **Step 4: Add live-test entry above the 2026-05-22 (Case 1 / Case 2) entry**

```markdown
## Live test 2026-05-22 (SRT Settings min-gap)

5/5 verification tests pass on dev site via:
```
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

Workspace verified — `/desk/stock-reconciliation-tracking` shows
"Setup → SRT Settings" link + SRT Settings shortcut chip after `bench migrate`.
```

---

## Task 9: Final cleanup + handoff summary

**Files:** (none — wrap-up)

- [ ] **Step 1: Re-run the full verification suite**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

Expected: `=== 5 / 5 passed ===`.

- [ ] **Step 2: Re-run the Case 1 / Case 2 suite as a regression check**

```bash
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Expected: `=== 5 / 5 passed ===`. Confirms the new validate helper didn't break the earlier work.

- [ ] **Step 3: Verify cleanup**

```bash
bench --site development.localhost console <<'PYEOF' 2>&1 | tail -10
import frappe
open_count = frappe.db.count("Stock Reconciliation SRT",
    {"item": "CZMAT/1585", "docstatus": ["!=", 2]})
settings_val = frappe.db.get_single_value(
    "SRT Settings", "gap_between_stock_reconciliation_days")
print(f"open test SRTs for CZMAT/1585: {open_count}")
print(f"SRT Settings gap_days after run: {settings_val}")
PYEOF
```

Expected: `open test SRTs ... 0` and `SRT Settings gap_days after run: 0`. Both tests reset gap to 0 in teardown.

- [ ] **Step 4: Report summary to user**

Files touched: 9 (4 new doctype files, 1 modified controller, 1 modified workspace JSON, 1 new test file, 2 modified docs, 1 modified memory).

Tests: 5/5 PASS for gap suite; 5/5 PASS for Case 1/Case 2 regression.

Workspace verified at `/desk/stock-reconciliation-tracking` (link + shortcut visible after migrate + clear-cache).

Ask user: anything else to add to SRT Settings (e.g., future fields like default warehouse, auto-cancel-on-stale)?

---

## Self-Review Log

**Spec coverage:**
- §1 problem → addressed by gap-rule helper (Task 3)
- §2.1 DocType shape (1 Int field + 3-role perms) → Task 2
- §2.2 validate helper → Task 3 (full code in Step 1)
- §2.3 workspace JSON additions (links + shortcuts) → Task 5
- §2.4 validate ordering → Task 3 Step 2 shows the exact insertion point
- §3 behaviour matrix → covered by the 5 tests in Task 1
- §3.1 reconfig semantics → Task 1 Test 5 covers explicitly
- §4 file inventory → matches Plan's File Structure table exactly
- §5 restricted areas → 5 bullets across Task 3 Step 3 (header comment) + Task 7 (app .md §13) + Task 8 (memory)
- §6 testing (5 tests) → Task 1 implements all 5 + Task 4 runs them + Task 9 re-runs as smoke
- §7 out-of-scope → respected (no presets, no per-warehouse, no per-item-group)

**Placeholder scan:** No TBDs, no "implement appropriate validation", no "similar to" cross-refs. Every code block is concrete.

**Type consistency:** Method name `_enforce_min_gap_between_srts` used identically in Task 3 Step 1 (define), Task 3 Step 2 (wire call), Task 7 (app .md doc), Task 8 (memory doc). Field name `gap_between_stock_reconciliation_days` used identically in Task 1 (`SETTINGS_FIELD` constant), Task 2 Step 2 (JSON `fieldname`), Task 3 Step 1 (`get_single_value` call), Task 3 Step 3 (restricted-area entry), Task 7, Task 8. DocType name `SRT Settings` used identically across all references.

**Edge case verified:** Task 1 Test 5 second half (`_set_gap(0)` retry must pass) confirms the helper reads SRT Settings fresh — no application-level caching. The standard Frappe `get_single_value` does have a request-scoped cache, but `frappe.clear_document_cache` in `_set_gap` busts it; production behaviour matches because settings docs are re-fetched per request.
