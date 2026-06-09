# SRT — Case 1 (All-Matched Auto-Approve) + Case 2 (Mixed Auto-Untick)

**Date:** 2026-05-22
**App:** `kavach`
**Doctype:** `Stock Reconciliation SRT`
**Status:** Approved — ready for implementation plan

---

## 1. Problem

Operators count physical stock and tick "Do Reconcile" per batch. Two real-world scenarios are currently mis-served by the existing Draft → Admin Approval → Super Admin Approval workflow:

1. **Case 1 — All ticked batches match current ledger stock.** Operator visited every batch, counted, and confirmed nothing changed. Today this either (a) blocks save via the old `_enforce_no_zero_delta_on_ticked_rows` throw, or (b) creates an ERPNext SR with zero net movement — pointless noise in the SR audit trail.
2. **Case 2 — Mixed: some ticked rows match, some don't.** Operator ticked more rows than they needed to. Today the matching rows would create zero-delta SR items; same noise problem.

Spec from user (2026-05-22):

> **Case 1:** If user checks "Do Reconcile" and Qty Found equals Current Stock (Selected UOM) on all ticked rows, allow save/submit — but no admin/super admin approval, no ERPNext SR. Status → "Approved By System". Both approval-remarks fields filled with: *"all batch are correct and the physical found exact match with current stock"*.
>
> **Case 2:** If some ticked rows match and some don't, silently untick the matching rows before save. Only real-delta rows reach the ERPNext SR.

## 2. What already exists (do not rebuild)

The 2026-05-22 partial scaffold is already in `stock_reconciliation_srt.py`:

- **`_classify_zero_delta_ticks()`** (line ~266) — runs in `validate()` BEFORE `_enforce_at_least_one_reconcile_ticked()`. Already implements both cases at the classification level:
  - Case 2 (mixed): sets `r.is_counted = 0` on matching rows in place.
  - Case 1 (all match): sets `self.flags.all_matched_no_delta = True`. Keeps rows ticked (they document what was counted).
  - Epsilon = `0.001` (matches field `precision=3`).
- **Workflow state `Approved By System`** is already registered in `install.py:_ensure_workflow()` with `doc_status=1`, `allow_edit="System Manager"`, and a comment explaining it is set by the controller via `db_set`.

The **gap**: `on_submit()` ignores `self.flags.all_matched_no_delta` and always falls through to `_create_erpnext_sr_draft()`. The whole point of Case 1 is to skip SR creation — that's what this design wires up.

## 3. Design

### 3.1 Server-side — `stock_reconciliation_srt.py`

#### `on_submit()` — add a branch at the top

```python
def on_submit(self):
    if getattr(self.flags, "all_matched_no_delta", False):
        self._route_to_system_approved()
        return
    # ── existing path unchanged below ──
    try:
        sr_name = self._create_erpnext_sr_draft()
        self.db_set("linked_erpnext_sr", sr_name, update_modified=False)
        self.db_set("admin_approved_by", frappe.session.user, update_modified=False)
        frappe.msgprint(...)
    except Exception:
        ...
        raise
```

#### New method — `_route_to_system_approved()`

Bypasses validate() entirely via `db_set` (no permission re-checks, no remark-field-lock errors). Operations, all via `db_set(..., update_modified=False)`:

| Field | Value | Notes |
|---|---|---|
| `workflow_state` | `"Approved By System"` | Overrides Workflow's default `Admin Approval` |
| `admin_approved_by` | `frappe.session.user` | The Srt Admin who clicked Approve |
| `super_admin_approved_by` | `frappe.session.user` | Same — documents who triggered auto-approval |
| `admin_remark` | `SYSTEM_APPROVE_MESSAGE` | **Only if currently empty** — preserves any manually-typed admin note |
| `super_admin_remark` | `SYSTEM_APPROVE_MESSAGE` | Same fill-if-empty rule (in practice this field is always empty here since the doc never reached Admin Approval state) |
| `linked_erpnext_sr` | (unchanged — stays NULL) | Whole point: no ERPNext SR row |

After the writes:

```python
frappe.msgprint(
    _("All ticked batches matched current stock. Approved by system — "
      "no ERPNext Stock Reconciliation needed."),
    indicator="green", alert=True,
)
```

Constant (module-level):

```python
SYSTEM_APPROVE_MESSAGE = (
    "all batch are correct and the physical found exact match with current stock"
)
```

The text matches user spec verbatim (do not "fix" grammar).

### 3.2 Workflow — `install.py:_ensure_workflow()`

The existing `if frappe.db.exists("Workflow", wf_name): return` skips ANY update on sites that already have the workflow. We need to add one transition:

```python
{"state": "Approved By System", "action": "Close",
 "next_state": "Close", "allowed": "Srt Super Admin"},
```

To make this work on already-installed sites, replace the early-return with an upgrade step:

```python
def _ensure_workflow() -> None:
    wf_name = "Stock Reconciliation SRT Workflow"
    # ... existing _ensure_workflow_state + Workflow Action Master prereqs ...

    if frappe.db.exists("Workflow", wf_name):
        _ensure_workflow_transition(wf_name, "Approved By System", "Close",
                                    "Close", "Srt Super Admin")
        return

    # ... existing wf.insert() flow unchanged ...


def _ensure_workflow_transition(wf_name, state, action, next_state, allowed):
    """Append a transition row if it doesn't already exist on the Workflow."""
    wf = frappe.get_doc("Workflow", wf_name)
    for t in wf.transitions:
        if (t.state == state and t.action == action
                and t.next_state == next_state and t.allowed == allowed):
            return  # already present — no-op
    wf.append("transitions", {
        "state": state, "action": action,
        "next_state": next_state, "allowed": allowed,
    })
    wf.flags.ignore_permissions = True
    wf.save()
    frappe.db.commit()
```

Also add the same transition row to the fresh-install branch in `_ensure_workflow()`'s `transitions=[...]` list so new installs get it without the upgrade path.

### 3.3 JS — `stock_reconciliation_srt.js`

**Zero functional changes required.** Existing logic handles the new state correctly:

- `_ipv_srt_render_action_buttons` gates "Submit Linked ERPNext SR" on `workflow_state === "Admin Approval"` — correctly hidden at `Approved By System`.
- `_ipv_srt_apply_remark_field_locks` gates `super_admin_remark` editability on `state === "Admin Approval"` — at `Approved By System` it's read-only for everyone. Correct (audit log shouldn't be editable post-system-approval).

**Polish (approved):** In `_ipv_srt_render_action_buttons`, when `frm.doc.workflow_state === "Approved By System"`, render a green dashboard alert at the top of the form:

```js
if (frm.doc.workflow_state === "Approved By System") {
    frm.dashboard.add_comment(
        __("Auto-approved by system — all ticked batches matched current stock. No ERPNext Stock Reconciliation created."),
        "green", true,
    );
}
```

### 3.4 Files touched (final inventory)

| File | Change |
|---|---|
| `stock_reconciliation_srt.py` | `on_submit()` branch + new `_route_to_system_approved()` + `SYSTEM_APPROVE_MESSAGE` constant + comment block (CONTEXT/MEMORY/INSTRUCTIONS/DANGER/RESTRICT) on the new method |
| `install.py` | `_ensure_workflow()` no longer early-returns when workflow exists — instead calls new `_ensure_workflow_transition()` helper. Add the new `Approved By System → Close` transition to the fresh-install transitions list AND via the upgrade helper |
| `stock_reconciliation_srt.js` | Optional green dashboard comment in `_ipv_srt_render_action_buttons` |
| `kavach.md` (app root) | Add §11: 2026-05-22 spec — Case 1 + Case 2 behavior, restricted areas, new constant, new workflow transition. Update Sync Block. |
| `kavach/kavach.md` (module) | Same paragraph — module-level summary of the 2026-05-22 behavior |
| Memory `app_kavach.md` | Add Case 1/Case 2 to "What it does" + "Restricted areas". Update version to v0.0.2 if user agrees (else leave at v0.0.1 + dated update) |

## 4. Restricted areas (post-implementation)

Add to the existing list in `stock_reconciliation_srt.py` comment header AND `app_kavach.md`:

- **Don't reorder `validate()` to put `_classify_zero_delta_ticks()` AFTER `_enforce_at_least_one_reconcile_ticked()`.** The classifier is what unticks matching rows in Case 2; if the count check runs first, it may pass before the auto-untick reduces the ticked count to zero, leading to a downstream "no rows to reconcile" error on submit instead of a clean Case 1 routing.
- **Don't bypass the `getattr(self.flags, ...)` check in `on_submit()`.** The flag is set fresh every validate() pass and lives on `self.flags` not on the DB — direct attribute access without `getattr` would AttributeError on the first save of a fresh doc (flags object initialized empty).
- **Don't change `SYSTEM_APPROVE_MESSAGE` text without user approval.** The literal wording is the user's audit spec; downstream audit reports may grep for it.
- **Don't remove `_ensure_workflow_transition()`'s presence-check.** It MUST be idempotent — `after_migrate` re-runs on every bench migrate, and duplicating transitions every run would silently corrupt the workflow.
- **Don't switch the remark fill from "only if empty" to "always overwrite" without user approval.** The current rule preserves manually-typed admin notes; overwriting destroys evidence.
- **Don't stamp `super_admin_approved_by` to a literal "System" string.** It's a Link → User; a non-existent user would break joins.

## 5. Testing plan (manual, post-implementation)

Run on `development.localhost` via `bench --site development.localhost console` for state checks + browser for UI:

1. **Case 1 happy path** — Pick item `CZMAT/1585`, warehouse `WAREHOUSE 1.9 …`. Tick 3 auto-populated rows. Leave `qty_found = current_stock_in_selected_uom` on all 3. Save. Submit (Srt Admin clicks Approve). **Expect:** `workflow_state="Approved By System"`, `linked_erpnext_sr IS NULL`, both `*_approved_by` stamped, both remark fields filled with the system message. No new `Stock Reconciliation` created.
2. **Case 2 mixed** — Tick 4 rows: 2 with qty_found = current, 2 with real deltas. Save. **Expect:** 2 matching rows' `is_counted` flipped to 0; 2 delta rows still ticked. Submit (Approve). **Expect:** normal `Admin Approval` state, draft ERPNext SR with exactly 2 items.
3. **Case 1 with pre-typed `admin_remark`** — Srt Admin types `"reviewed Q2 audit"` in admin_remark, ticks all matching rows, Approves. **Expect:** `admin_remark` preserved as `"reviewed Q2 audit"`, `super_admin_remark` filled with system message.
4. **Cancel auto-approved doc** — On a Case 1 doc, switch to Srt Super Admin, invoke Close action. **Expect:** SRT → docstatus=2 cleanly, no SR cascade error (linked_erpnext_sr is NULL so on_cancel early-returns).
5. **Regression — normal mixed-delta submit end-to-end** — Counted batch with real delta (e.g., +1g), no matched-ticks. Draft → Admin Approval → Super Admin Approval. **Expect:** Bin updates by exactly the delta; valuation rate preserved (two-pass mirror works as before).

## 6. Out of scope

- Re-introducing the old `_enforce_no_zero_delta_on_ticked_rows` throw (the 2026-05-22 spec replaces it with classification).
- Allowing Srt User to self-submit Case 1 (decided: Srt Admin still clicks Approve; Option A from brainstorming).
- Backfilling existing submitted SRT docs into the new state (no migration — historical docs stay as they are).
- Changes to ERPNext SR creation logic, valuation-rate two-pass, SABB monkey-patches, Stock Settings toggle — none touched.

## 7. References

- App memory: `app_kavach.md`
- ERPNext quirks: `erpnext_bulk_reconcile_quirks.md` (Quirk #2 silent submit — applies only to the normal path, not Case 1)
- Site facts: `chaizup_audit_site_specifics.md` (custom_remarks, Stock Adjustment account)
- Existing scaffold: `stock_reconciliation_srt.py:_classify_zero_delta_ticks` (266–331), `install.py:_ensure_workflow` (105–173)
