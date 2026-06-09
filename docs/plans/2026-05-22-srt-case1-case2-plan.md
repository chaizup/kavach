# SRT — Case 1 / Case 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `_classify_zero_delta_ticks()` scaffold to actually short-circuit SR creation in Case 1 (all ticked rows match current stock) and let Case 2 (mixed) silently untick matched rows. Adds the Workflow upgrade for `Approved By System → Close`.

**Architecture:** Three code touchpoints — `on_submit()` branching in `stock_reconciliation_srt.py`, idempotent workflow upgrade in `install.py`, an optional green banner in `stock_reconciliation_srt.js`. Verification is a runnable bench-console Python script under `apps/kavach/tests/` (project's existing manual-test convention — no pytest framework in this app).

**Tech Stack:** Frappe v16 / Python 3.11 / ERPNext v16 / Frappe DocType + Workflow + Workflow Action Master.

**Spec:** `apps/kavach/docs/specs/2026-05-22-srt-case1-case2-design.md`

**Source-control note:** The SRT app folder is NOT a standalone git repo (the parent `/workspace` repo `.gitignore`s `development/frappe-bench/`). Skip the `git commit` steps below unless you've initialized a repo for the app first. Treat each task's "Commit" step as an on-disk save checkpoint.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.py` | Doctype controller — `on_submit` branch + new `_route_to_system_approved()` + module constant | Modify |
| `apps/kavach/kavach/install.py` | Install/migrate hooks — workflow upgrade helper + new transition | Modify |
| `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.js` | Form JS — green dashboard banner at `Approved By System` state | Modify |
| `apps/kavach/kavach/tests/__init__.py` | Test package marker | Create |
| `apps/kavach/kavach/tests/test_case1_case2.py` | Bench-console verification script (5 assertion-based tests) | Create |
| `apps/kavach/kavach.md` | App-root doc | Modify — add §11 + update Sync Block |
| `apps/kavach/kavach/kavach/kavach.md` | Module doc | Modify — append Case 1/Case 2 paragraph |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | Claude memory | Modify — add Case 1/Case 2 to "What it does" + restricted areas |

---

## Task 1: Write the failing verification script

**Files:**
- Create: `apps/kavach/kavach/tests/__init__.py`
- Create: `apps/kavach/kavach/tests/test_case1_case2.py`

### Why this comes first

TDD discipline — write the assertions first, run them, confirm they fail with the CURRENT behavior (which always creates an ERPNext SR), then implement to make them pass.

The script is runnable via `bench --site development.localhost execute kavach.tests.test_case1_case2.run_all`. Each test handles its own setup + teardown (creates SRT, asserts, cancels SRT to free the item). Uses live dev-site data (`CZMAT/1585` + a warehouse with positive stock) per the project's existing manual-test convention documented in memory `app_kavach.md`.

- [ ] **Step 1: Create the test package marker**

Create empty file `apps/kavach/kavach/tests/__init__.py`:

```python
```

- [ ] **Step 2: Write the verification script**

Create `apps/kavach/kavach/tests/test_case1_case2.py`:

```python
# =============================================================================
# CONTEXT: Runnable verification for SRT Case 1 (all-matched auto-approve)
# and Case 2 (mixed auto-untick). Project convention: no pytest, instead
# bench-console scripts that assert state on the live dev-site.
#
# Run with:
#   bench --site development.localhost execute \
#     kavach.tests.test_case1_case2.run_all
#
# Or one at a time:
#   bench --site development.localhost execute \
#     kavach.tests.test_case1_case2.test_case1_happy
#
# MEMORY: app_kavach.md § Live test
# =============================================================================

import frappe
from frappe.utils import flt

# Dev-site data the memory documents as known-good for SRT tests.
TEST_ITEM = "CZMAT/1585"


def _pick_warehouse():
    """Return a warehouse where TEST_ITEM has positive stock + ≥3 batches.
    Falls back to any warehouse with batches if the preferred one is empty."""
    rows = frappe.db.sql(
        """
        SELECT b.warehouse, COUNT(*) AS n
        FROM `tabBin` b
        WHERE b.item_code = %s AND b.actual_qty > 0
        GROUP BY b.warehouse
        ORDER BY n DESC
        LIMIT 1
        """,
        (TEST_ITEM,),
        as_dict=True,
    )
    if not rows:
        frappe.throw(f"No warehouse with positive stock for {TEST_ITEM}")
    return rows[0]["warehouse"]


def _cleanup_open_srt_for_item(item):
    """Cancel + delete any open SRT for the test item so the duplicate-guard
    doesn't block fresh test runs."""
    names = frappe.db.sql(
        "SELECT name FROM `tabStock Reconciliation SRT` "
        "WHERE item = %s AND docstatus IN (0, 1)",
        (item,),
    )
    for (name,) in names:
        doc = frappe.get_doc("Stock Reconciliation SRT", name)
        try:
            if doc.docstatus == 1:
                doc.flags.ignore_permissions = True
                doc.cancel()
            frappe.delete_doc("Stock Reconciliation SRT", name,
                              force=True, ignore_permissions=True)
        except Exception as e:
            print(f"  cleanup warn: {name}: {e}")
    frappe.db.commit()


def _build_srt(item, warehouse):
    """Auto-populate batches via the api and return the doc instance
    (unsaved)."""
    from kavach.stock_reconciliation_tracking.api import (
        get_item_defaults,
    )
    defaults = get_item_defaults(item_code=item, warehouse=warehouse)
    company = frappe.defaults.get_user_default("Company") or frappe.db.get_value(
        "Company", {}, "name"
    )
    doc = frappe.new_doc("Stock Reconciliation SRT")
    doc.item = item
    doc.default_warehouse = warehouse
    doc.company = company
    doc.item_name = defaults.get("item_name")
    doc.default_uom = defaults.get("default_uom")
    doc.higher_uom = defaults.get("higher_uom")
    doc.higher_uom_cf = defaults.get("higher_uom_cf")
    for b in (defaults.get("batches") or [])[:3]:
        row = doc.append("batches", {})
        for k, v in b.items():
            setattr(row, k, v)
    return doc


# ── Test 1: Case 1 happy path ──────────────────────────────────────────────
def test_case1_happy():
    """All ticked rows have qty_found = current_stock. Submit must route
    to Approved By System with NO linked ERPNext SR."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    # Tick every row, leave qty_found = current_stock_in_selected_uom
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()

    assert doc.docstatus == 1, f"docstatus expected 1, got {doc.docstatus}"
    assert doc.workflow_state == "Approved By System", (
        f"workflow_state expected 'Approved By System', got {doc.workflow_state!r}"
    )
    assert not doc.linked_erpnext_sr, (
        f"linked_erpnext_sr expected NULL, got {doc.linked_erpnext_sr!r}"
    )
    assert doc.admin_approved_by, "admin_approved_by should be stamped"
    assert doc.super_admin_approved_by, "super_admin_approved_by should be stamped"
    assert doc.admin_remark and "exact match" in (doc.admin_remark or ""), (
        f"admin_remark missing system message: {doc.admin_remark!r}"
    )
    assert doc.super_admin_remark and "exact match" in (doc.super_admin_remark or ""), (
        f"super_admin_remark missing system message: {doc.super_admin_remark!r}"
    )
    print(f"  PASS test_case1_happy ({doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 2: Case 2 mixed ───────────────────────────────────────────────────
def test_case2_mixed():
    """Mix of matched and delta ticks → matched rows silently unticked,
    delta rows stay ticked, SRT goes through normal Admin Approval flow."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    if len(doc.batches) < 3:
        print("  SKIP test_case2_mixed: need at least 3 batches")
        return
    # First 2 rows = matched (qty_found = current); 3rd row = delta (+1 unit)
    for i, r in enumerate(doc.batches):
        r.is_counted = 1
        if i < 2:
            r.qty_found = flt(r.current_stock_in_selected_uom)
        else:
            r.qty_found = flt(r.current_stock_in_selected_uom) + 1.0
    doc.insert(ignore_permissions=True)  # validate fires → auto-untick
    doc.reload()

    matched_ticked = sum(1 for r in doc.batches[:2] if r.is_counted)
    delta_ticked   = sum(1 for r in doc.batches[2:] if r.is_counted)

    assert matched_ticked == 0, (
        f"matched rows should have been auto-unticked, "
        f"but {matched_ticked} of 2 still ticked"
    )
    assert delta_ticked == 1, (
        f"delta row should still be ticked, but {delta_ticked} of 1 ticked"
    )
    print(f"  PASS test_case2_mixed ({doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 3: Case 1 preserves pre-typed admin_remark ────────────────────────
def test_case1_preserves_admin_remark():
    """If admin_remark already has user-typed text at submit time,
    the system message must NOT overwrite it. super_admin_remark
    (which was empty) must still be filled."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.admin_remark = "reviewed Q2 audit"
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()

    assert doc.admin_remark == "reviewed Q2 audit", (
        f"admin_remark should be preserved, got {doc.admin_remark!r}"
    )
    assert "exact match" in (doc.super_admin_remark or ""), (
        f"super_admin_remark expected system message, got {doc.super_admin_remark!r}"
    )
    print(f"  PASS test_case1_preserves_admin_remark ({doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 4: Cancel auto-approved doc ───────────────────────────────────────
def test_cancel_auto_approved():
    """A Case 1 SRT at Approved By System must cancel cleanly with no SR
    cascade error (linked_erpnext_sr is NULL)."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()
    assert doc.workflow_state == "Approved By System"

    doc.flags.ignore_permissions = True
    doc.cancel()
    frappe.db.commit()
    doc.reload()

    assert doc.docstatus == 2, f"expected docstatus=2 after cancel, got {doc.docstatus}"
    print(f"  PASS test_cancel_auto_approved ({doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 5: Regression — normal delta submit ───────────────────────────────
def test_regression_normal_submit():
    """One row with a real delta still creates a draft ERPNext SR.
    Doesn't submit the SR (that would post SLE); just verifies the
    draft was created and the SRT sits at Admin Approval as before."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        print("  SKIP test_regression_normal_submit: no batches")
        return
    # Tick ONLY the first row with a real delta (+1 unit in selected UOM)
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()

    assert doc.workflow_state == "Admin Approval", (
        f"expected Admin Approval, got {doc.workflow_state!r}"
    )
    assert doc.linked_erpnext_sr, "draft ERPNext SR should have been created"
    sr = frappe.get_doc("Stock Reconciliation", doc.linked_erpnext_sr)
    assert sr.docstatus == 0, f"linked SR should be draft, got docstatus={sr.docstatus}"
    assert len(sr.items) == 1, f"SR should have exactly 1 item, got {len(sr.items)}"
    print(f"  PASS test_regression_normal_submit "
          f"(SRT {doc.name}, SR {sr.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_case1_happy,
        test_case2_mixed,
        test_case1_preserves_admin_remark,
        test_cancel_auto_approved,
        test_regression_normal_submit,
    ]
    print(f"\n=== SRT Case 1 / Case 2 verification ({len(tests)} tests) ===")
    failures = []
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failures.append((t.__name__, e))
            _cleanup_open_srt_for_item(TEST_ITEM)
    print(f"\n=== {len(tests) - len(failures)} / {len(tests)} passed ===")
    if failures:
        raise AssertionError(
            f"{len(failures)} test(s) failed: "
            + ", ".join(n for n, _ in failures)
        )
```

- [ ] **Step 3: Run the script and confirm it FAILS**

Run from `/workspace/development/frappe-bench`:

```bash
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Expected output (sketch):

```
=== SRT Case 1 / Case 2 verification (5 tests) ===
  FAIL test_case1_happy: linked_erpnext_sr expected NULL, got 'MAT-RECO-2026-...'
  FAIL test_case1_preserves_admin_remark: linked_erpnext_sr expected NULL, ...
  FAIL test_cancel_auto_approved: <similar>
  ...
```

`test_case2_mixed` may PASS already (the classifier is wired). `test_regression_normal_submit` should PASS (existing behavior). Tests 1, 3, 4 must FAIL — that's the gap this plan closes.

- [ ] **Step 4: Commit (on-disk checkpoint)**

```bash
# SRT app isn't versioned — this is an on-disk save checkpoint only.
ls apps/kavach/kavach/tests/test_case1_case2.py
```

---

## Task 2: Implement `on_submit` branching + `_route_to_system_approved()`

**Files:**
- Modify: `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.py`

### Why grouped

The constant, the new method, and the `on_submit` branch all live in the same controller file and are mutually dependent. Splitting them would create a half-wired commit that breaks `on_submit`.

- [ ] **Step 1: Add the module constant above `class StockReconciliationSRT`**

Locate the line after the imports (around line 127 — `from frappe.utils import ...`) and add:

```python
# =============================================================================
# Case 1 (all-matched auto-approve) — system message written to both approval
# remark fields when on_submit detects every ticked row matches current stock.
#
# RESTRICT: do NOT change this text without user approval. Downstream audit
# reports may grep for the literal string. Spec: docs/specs/2026-05-22-srt-
# case1-case2-design.md § 3.1.
# =============================================================================
SYSTEM_APPROVE_MESSAGE = (
    "all batch are correct and the physical found exact match with current stock"
)
```

- [ ] **Step 2: Add the `_route_to_system_approved()` method**

Add this method to `class StockReconciliationSRT` immediately after the `on_submit` method (so the two related methods sit together). Old `on_submit` stays for the moment — Step 3 wires it in.

```python
    def _route_to_system_approved(self):
        """Case 1 short-circuit — fired from on_submit when every ticked
        row had qty_found == current_stock_in_selected_uom (no delta).

        Skips the ERPNext SR creation entirely. Sets workflow_state =
        'Approved By System' directly, stamps both approval audit fields,
        and fills both remark fields with the system message (only if
        empty — preserves manually-typed admin notes).

        ALL writes go through db_set with update_modified=False so:
          - validate() doesn't re-run (would re-enforce remark field
            permissions and reject our writes since we're cross-role).
          - the parent `modified` timestamp isn't double-bumped (the
            outer save event already bumps it).

        MEMORY: spec docs/specs/2026-05-22-srt-case1-case2-design.md § 3.1
        DANGER: do NOT call self.save() or self.db_update() here — both
        re-run validate which would reject the cross-role remark writes
        due to _enforce_remark_field_permissions.
        """
        self.db_set("workflow_state", "Approved By System", update_modified=False)
        self.db_set("admin_approved_by", frappe.session.user, update_modified=False)
        self.db_set("super_admin_approved_by", frappe.session.user, update_modified=False)
        if not (self.admin_remark or "").strip():
            self.db_set("admin_remark", SYSTEM_APPROVE_MESSAGE, update_modified=False)
        if not (self.super_admin_remark or "").strip():
            self.db_set("super_admin_remark", SYSTEM_APPROVE_MESSAGE, update_modified=False)
        frappe.msgprint(
            _("All ticked batches matched current stock. Approved by system — "
              "no ERPNext Stock Reconciliation needed."),
            indicator="green", alert=True,
        )
```

- [ ] **Step 3: Replace `on_submit()` to branch on the flag**

Find the existing `on_submit()` method (around line 145). Replace it with:

```python
    def on_submit(self):
        """SRT submit — TWO PATHS:

        1. Case 1 (all_matched_no_delta flag set by _classify_zero_delta_ticks
           in validate): skip the ERPNext SR entirely, route to
           'Approved By System' workflow state. No human approval needed.

        2. Normal path (any real-delta ticks): create a DRAFT ERPNext SR.
           Per 2026-05-21 workflow spec, the actual SR submit is gated
           separately to Srt Super Admin via submit_linked_sr().
        """
        if getattr(self.flags, "all_matched_no_delta", False):
            self._route_to_system_approved()
            return
        try:
            sr_name = self._create_erpnext_sr_draft()
            self.db_set("linked_erpnext_sr", sr_name, update_modified=False)
            self.db_set("admin_approved_by", frappe.session.user, update_modified=False)
            frappe.msgprint(
                _("Draft ERPNext Stock Reconciliation <a href='/app/stock-reconciliation/{0}'>{0}</a> created. Awaiting Srt Super Admin approval to submit.").format(sr_name),
                indicator="orange", alert=True,
            )
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"SRT {self.name}: ERPNext SR draft creation failed",
            )
            raise
```

- [ ] **Step 4: Add new restricted-area entries to the header comment block**

Find the `# RESTRICT:` section at the top of the file (around lines 70-86) and append these three bullets at the end of that section (just before the `# GOTCHA — ...` line):

```python
#   - Do NOT remove the `getattr(self.flags, "all_matched_no_delta", False)`
#     check in on_submit. `flags` is initialised per-request; direct attribute
#     access would AttributeError on the first save of a fresh doc.
#   - Do NOT change the `SYSTEM_APPROVE_MESSAGE` constant text without user
#     approval — downstream audit reports may grep for the literal string.
#     Spec: docs/specs/2026-05-22-srt-case1-case2-design.md.
#   - Do NOT call self.save() or self.db_update() inside
#     `_route_to_system_approved()`. Both re-run validate(), which would
#     reject the cross-role remark writes via the remark-field-permission
#     gate. db_set with update_modified=False is the only safe write path.
```

- [ ] **Step 5: Commit checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.py
```

---

## Task 3: Workflow upgrade in `install.py`

**Files:**
- Modify: `apps/kavach/kavach/install.py`

### Why grouped

All three sub-changes (helper function, fresh-install transition, upgrade call) must land atomically — if you ship just the fresh-install transition, existing sites won't get the new `Approved By System → Close` transition; if you ship just the upgrade helper without removing the early-return, the upgrade never fires.

- [ ] **Step 1: Add the `_ensure_workflow_transition()` helper**

Append this function at the END of the file (after `_ensure_workflow_state`):

```python
def _ensure_workflow_transition(wf_name: str, state: str, action: str,
                                next_state: str, allowed: str) -> None:
    """Idempotent — append a Workflow Transition row if not already present.

    Used by `_ensure_workflow()` to upgrade existing workflows without
    overwriting user customizations. Matches an existing transition by
    the (state, action, next_state, allowed) tuple; any other field
    difference is treated as a different transition.

    RESTRICT: keep this idempotent — after_migrate re-runs on every
    `bench migrate`, and adding duplicate transitions would silently
    corrupt the workflow.
    """
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

- [ ] **Step 2: Add the new transition to the fresh-install list**

Find `transitions=[` inside `_ensure_workflow()` (around line 154). Append the `Approved By System → Close` row at the END of the list (preserving the trailing comma):

```python
        "transitions": [
            # Draft → Admin Approval: Srt Admin submits, creates draft ERPNext SR
            {"state": "Draft", "action": "Approve",
             "next_state": "Admin Approval", "allowed": "Srt Admin"},
            # Admin Approval → Super Admin Approval: Srt Super Admin submits ERPNext SR
            {"state": "Admin Approval", "action": "Approve",
             "next_state": "Super Admin Approval", "allowed": "Srt Super Admin"},
            # Admin Approval → Close: Srt Admin OR Super Admin cancels (only if SR in draft)
            {"state": "Admin Approval", "action": "Close",
             "next_state": "Close", "allowed": "Srt Admin"},
            {"state": "Admin Approval", "action": "Close",
             "next_state": "Close", "allowed": "Srt Super Admin"},
            # Super Admin Approval → Close: only Srt Super Admin (SR is already submitted)
            {"state": "Super Admin Approval", "action": "Close",
             "next_state": "Close", "allowed": "Srt Super Admin"},
            # Approved By System → Close: only Srt Super Admin (no SR to cascade,
            # but the doc-level cancel still needs the workflow path). Added 2026-05-22.
            {"state": "Approved By System", "action": "Close",
             "next_state": "Close", "allowed": "Srt Super Admin"},
        ],
```

- [ ] **Step 3: Replace the early-return with the upgrade call**

Find the lines (around 112-113):

```python
    if frappe.db.exists("Workflow", wf_name):
        return
```

Replace with:

```python
    if frappe.db.exists("Workflow", wf_name):
        # Idempotent upgrade — append the 2026-05-22 transition if missing.
        # Pre-2026-05-22 sites have the workflow but lack this row.
        _ensure_workflow_transition(
            wf_name,
            state="Approved By System", action="Close",
            next_state="Close", allowed="Srt Super Admin",
        )
        return
```

- [ ] **Step 4: Run `bench migrate` to apply the workflow upgrade**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost migrate
```

Expected: migrate runs cleanly. The `after_migrate` hook fires `_ensure_workflow()` → upgrade helper appends the new transition (if missing) → no error.

- [ ] **Step 5: Verify the transition was added**

```bash
bench --site development.localhost execute frappe.client.get_list \
  --kwargs '{"doctype":"Workflow Transition","filters":{"parent":"Stock Reconciliation SRT Workflow","state":"Approved By System"},"fields":["state","action","next_state","allowed"]}'
```

Expected: one row returned with `state=Approved By System, action=Close, next_state=Close, allowed=Srt Super Admin`.

- [ ] **Step 6: Commit checkpoint**

```bash
ls -l apps/kavach/kavach/install.py
```

---

## Task 4: Run the verification script — all 5 tests must PASS

**Files:** (none modified — verification only)

- [ ] **Step 1: Run the full suite**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Expected output:

```
=== SRT Case 1 / Case 2 verification (5 tests) ===
  PASS test_case1_happy (SRT-RECO-2026-NNNNN)
  PASS test_case2_mixed (SRT-RECO-2026-NNNNN)
  PASS test_case1_preserves_admin_remark (SRT-RECO-2026-NNNNN)
  PASS test_cancel_auto_approved (SRT-RECO-2026-NNNNN)
  PASS test_regression_normal_submit (SRT-RECO-2026-NNNNN, SR MAT-RECO-2026-NNNNN)

=== 5 / 5 passed ===
```

- [ ] **Step 2: If any test fails, diagnose and fix**

Failure modes to expect:
- `linked_erpnext_sr` not NULL → check `on_submit` branch wiring (Task 2.3)
- `workflow_state` is `Admin Approval` not `Approved By System` → check `_route_to_system_approved` (Task 2.2)
- Cancel test errors with "no transition for Approved By System → Close" → workflow upgrade didn't run, re-run `bench migrate`
- Permission errors on remark writes → the `db_set` is being short-circuited; verify `update_modified=False` is set

Re-run after each fix until all 5 PASS.

- [ ] **Step 3: Confirm no stray test docs left behind**

```bash
bench --site development.localhost execute frappe.client.get_list \
  --kwargs '{"doctype":"Stock Reconciliation SRT","filters":{"item":"CZMAT/1585","docstatus":["!=",2]},"fields":["name","workflow_state","docstatus"]}'
```

Expected: `[]` (all test docs cleaned up by the script's teardown).

---

## Task 5: Add the green dashboard banner (JS polish)

**Files:**
- Modify: `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.js`

- [ ] **Step 1: Add the banner to `_ipv_srt_render_action_buttons`**

Find the function `_ipv_srt_render_action_buttons` (around line 335). At the START of the function body (immediately after the comment block ends, before the `if (frm.doc.linked_erpnext_sr)` block), add:

```javascript
    // Auto-approved-by-system green banner (2026-05-22):
    // when the SRT routed to Approved By System (Case 1 — every ticked
    // row matched current stock), surface a green dashboard alert so the
    // user immediately sees WHY there's no linked ERPNext SR to click.
    if (frm.doc.workflow_state === "Approved By System") {
        frm.dashboard.add_comment(
            __("Auto-approved by system — all ticked batches matched current stock. No ERPNext Stock Reconciliation created."),
            "green",
            true,
        );
    }
```

- [ ] **Step 2: Browser smoke test of the banner**

Open one of the Case 1 SRT docs created during verification (find a name via `bench --site development.localhost execute "frappe.client.get_list" --kwargs '{"doctype":"Stock Reconciliation SRT","filters":{"workflow_state":"Approved By System"},"limit_page_length":1}'`).

Navigate in browser to `/app/stock-reconciliation-srt/<name>`. Hard-reload to bust the JS cache.

Expected: green dashboard banner appears at the top of the form reading *"Auto-approved by system — all ticked batches matched current stock. No ERPNext Stock Reconciliation created."*

- [ ] **Step 3: Commit checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.js
```

---

## Task 6: Browser smoke tests — end-to-end UX

**Files:** (none — manual UI verification)

Why this comes after Task 5: the verification script is server-side; UI smoke catches things scripts miss (action buttons, form refresh, permission gating).

- [ ] **Step 1: Case 1 happy path in browser**

1. Log in as a user with `Srt Admin` role (or fall back to Administrator).
2. Go to `/app/stock-reconciliation-srt/new`.
3. Pick item `CZMAT/1585`, warehouse with positive stock. Wait for batches to auto-populate.
4. Tick "Do Reconcile" on 2 rows. Leave qty_found unchanged (it's pre-filled with `current_stock_in_selected_uom`).
5. Save. Then click the "Approve" workflow action button.
6. **Verify:** form refreshes showing `workflow_state = Approved By System`; green dashboard banner shows; NO "Submit Linked ERPNext SR" button appears; NO "Open Linked ERPNext SR" button appears.

- [ ] **Step 2: Case 2 mixed in browser**

1. New SRT, same item/warehouse.
2. Tick 3 rows. On 2, leave qty_found = current. On the 3rd, change qty_found to current + 1.
3. Save (don't submit).
4. **Verify:** the form reloads; rows 1 and 2 are now UNTICKED (silently); row 3 stays ticked. No error message — the auto-untick is silent.

- [ ] **Step 3: Cancel auto-approved**

1. On the Case 1 doc from Step 1, switch user to `Srt Super Admin` (or stay as Administrator).
2. Click the "Close" workflow action button.
3. **Verify:** doc moves to `docstatus=2`, `workflow_state=Close`. No error about missing SR cascade.

- [ ] **Step 4: Regression — normal mixed submit + SR creation**

1. New SRT. Tick 1 row with a real delta (+1 unit).
2. Save → Approve.
3. **Verify:** doc at `Admin Approval`, "Open Linked ERPNext SR" button visible, clicking it lands on a draft Stock Reconciliation with 1 item.

- [ ] **Step 5: Note any regressions in plan margins**

If any UI flow broke unrelated to Case 1/Case 2 (e.g., field locks, set_query behaviour), STOP and report — do NOT proceed to docs until regressions are fixed.

---

## Task 7: Update app-root and module .md docs

**Files:**
- Modify: `apps/kavach/kavach.md`
- Modify: `apps/kavach/kavach/kavach/kavach.md` (if it exists; otherwise create)

- [ ] **Step 1: Add §11 to the app-root .md**

Append this section to `apps/kavach/kavach.md` AFTER the existing §10 (Sync Block) — or insert before the Sync Block as a new §11, then bump Sync Block to §12. Pick whichever keeps the Sync Block last (convention).

```markdown
---

## 11. Case 1 (auto-approve) + Case 2 (auto-untick) — 2026-05-22

### Spec
`apps/kavach/docs/specs/2026-05-22-srt-case1-case2-design.md`

### Case 1 — all ticked batches match current stock

When `validate()` finds EVERY ticked row has `qty_found ≈ current_stock_in_selected_uom` (epsilon 0.001), `_classify_zero_delta_ticks` sets `self.flags.all_matched_no_delta = True`. On submit, `on_submit()` branches:

- No ERPNext Stock Reconciliation is created (`linked_erpnext_sr` stays NULL)
- `workflow_state` set directly to `"Approved By System"` (overrides workflow's default `Admin Approval`)
- `admin_approved_by` + `super_admin_approved_by` both stamped to `frappe.session.user` (the Srt Admin who clicked Approve)
- `admin_remark` + `super_admin_remark` filled with the module constant `SYSTEM_APPROVE_MESSAGE` (only if empty — preserves manually-typed admin notes)
- Green dashboard banner on the form documents WHY there's no linked SR

### Case 2 — mixed (some match, some delta)

`_classify_zero_delta_ticks` silently sets `is_counted = 0` on matching rows. Real-delta rows stay ticked and proceed through the normal `Draft → Admin Approval → Super Admin Approval` flow.

### Workflow change

`install.py:_ensure_workflow()` now (a) registers the `Approved By System → Close` transition in the fresh-install path, and (b) idempotently appends that transition on existing sites via the new `_ensure_workflow_transition()` helper, so `after_migrate` self-heals pre-2026-05-22 installs.

### Restricted areas (additional, 2026-05-22)

- Don't reorder `validate()` to put `_classify_zero_delta_ticks` AFTER `_enforce_at_least_one_reconcile_ticked` — the classifier unticks matched rows in Case 2; if the count check runs first it may pass before the auto-untick reduces the count to zero.
- Don't replace `getattr(self.flags, "all_matched_no_delta", False)` with direct `self.flags.all_matched_no_delta` — `flags` is per-request and `AttributeError`s on first save of a fresh doc.
- Don't change `SYSTEM_APPROVE_MESSAGE` text without user approval.
- Don't call `self.save()` or `self.db_update()` inside `_route_to_system_approved()` — both re-run validate() which the remark-field-permission gate rejects for cross-role writes.
- Don't drop `_ensure_workflow_transition()`'s presence-check — `after_migrate` re-runs on every `bench migrate`; duplicating transitions would silently corrupt the workflow.
- Don't switch remark fill from "only if empty" to "always overwrite" without user approval.
- Don't stamp `super_admin_approved_by` to a literal "System" string — it's `Link → User`; a non-existent user breaks joins.
```

- [ ] **Step 2: Update the Sync Block in the app-root .md**

Find the existing `LATEST UPDATE 2026-05-21` block in §10. Above it, add a new `LATEST UPDATE 2026-05-22` block:

```
LATEST UPDATE 2026-05-22
            + Case 1 — auto-approve when all ticked rows match current stock:
                - on_submit() branches on self.flags.all_matched_no_delta
                  (set by existing _classify_zero_delta_ticks in validate)
                - New _route_to_system_approved() method: db_set
                  workflow_state="Approved By System", stamps both
                  *_approved_by fields, fills both remark fields with
                  SYSTEM_APPROVE_MESSAGE constant (only if empty).
                - No ERPNext SR created in this path.
            + Case 2 — auto-untick matched rows on save (already in place;
              no new code, just documented).
            + Workflow upgrade: Approved By System → Close transition
                added to fresh-install transitions AND backfilled via
                idempotent _ensure_workflow_transition() helper in
                install.py. after_migrate re-runs on every bench migrate.
            + JS green dashboard banner at Approved By System state.
            + Verification script: apps/.../tests/test_case1_case2.py
                with 5 assertion-based tests, runnable via
                `bench --site … execute kavach.
                tests.test_case1_case2.run_all`.
```

- [ ] **Step 3: Check whether the module-level .md exists**

```bash
ls apps/kavach/kavach/kavach/kavach.md
```

- [ ] **Step 4: Append the module-level paragraph**

If the file exists, append a short section at the end:

```markdown
---

## Case 1 / Case 2 (2026-05-22)

Validate-time classifier `_classify_zero_delta_ticks` routes the SRT
between two paths:

- **Case 1 — all ticked rows match current stock.** Skips ERPNext SR
  creation. `on_submit()` sets `workflow_state="Approved By System"`,
  fills both `admin_remark` + `super_admin_remark` with the module
  constant `SYSTEM_APPROVE_MESSAGE` (only if empty), stamps both
  `*_approved_by` fields to the Srt Admin who clicked Approve.
- **Case 2 — mixed (some match, some delta).** Matching rows have
  `is_counted` silently set to 0; only real-delta rows go to the SR.

Workflow has a new `Approved By System → Close` transition allowed
to Srt Super Admin. See app-root doc §11 and spec
`docs/specs/2026-05-22-srt-case1-case2-design.md` for restricted areas.
```

If the file doesn't exist, create it with the Case 1/Case 2 section as the only content.

- [ ] **Step 5: Commit checkpoint**

```bash
ls -l apps/kavach/kavach.md
ls -l apps/kavach/kavach/kavach/kavach.md
```

---

## Task 8: Update Claude memory

**Files:**
- Modify: `~/.claude/projects/-workspace/memory/app_kavach.md`

- [ ] **Step 1: Update the description in frontmatter**

Change the `description:` line to:

```yaml
description: "kavach v0.0.2 (2026-05-22) — ERPNext SR wrapper with batch auto-populate, UOM conversion, two-pass rate-mirror, RBAC workflow, and Case 1 (all-matched auto-approve) / Case 2 (mixed auto-untick) routing."
```

- [ ] **Step 2: Add Case 1 / Case 2 to the "What it does" section**

After the existing "On submit, creates + auto-submits a real ERPNext Stock Reconciliation with only counted rows" line, append:

```markdown
6. **Case 1 (2026-05-22) — auto-approve when all ticked rows match:** if every ticked row has `qty_found ≈ current_stock_in_selected_uom` (epsilon 0.001), submit routes directly to `workflow_state=Approved By System`, skips ERPNext SR creation, auto-fills both approval remarks with `SYSTEM_APPROVE_MESSAGE`.
7. **Case 2 (2026-05-22) — auto-untick matched rows on mixed save:** if some ticked rows match and others have real deltas, validate silently sets `is_counted=0` on the matching ones so only real deltas reach the SR.
```

- [ ] **Step 3: Add new entries to "Restricted areas"**

Append these bullets to the existing `## Restricted areas` section:

```markdown
- **Don't reorder `validate()` to put `_classify_zero_delta_ticks` AFTER `_enforce_at_least_one_reconcile_ticked`.** Case 2 auto-untick must happen BEFORE the count check.
- **Don't replace `getattr(self.flags, "all_matched_no_delta", False)` with direct attribute access in `on_submit`.** `flags` is per-request; fresh-doc first-save would `AttributeError`.
- **Don't change `SYSTEM_APPROVE_MESSAGE` text without user approval.** Audit-trail grep target.
- **Don't call `self.save()` / `self.db_update()` inside `_route_to_system_approved`.** Re-runs validate which rejects cross-role remark writes.
- **Don't drop `_ensure_workflow_transition()`'s presence check.** `after_migrate` is re-run; duplicates corrupt the workflow.
```

- [ ] **Step 4: Update the "Live test" section**

Add this block AFTER the existing 2026-05-21 live test:

```markdown
## Live test 2026-05-22 (Case 1 / Case 2 wiring)

5/5 verification tests pass via:
```
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Browser smoke confirmed:
- Case 1: Approve → green banner, no Submit-SR button, no Open-SR button
- Case 2: mixed save → matched rows silently untick
- Cancel auto-approved: clean docstatus=2 with no SR cascade error
- Regression: normal +1 delta still creates draft SR (Admin Approval)
```

- [ ] **Step 5: Verify Claude memory loads correctly**

The memory file is loaded by Claude on session start. No verification command — just confirm the file is syntactically valid markdown by reading it back.

---

## Task 9: Final task list cleanup + handoff summary

**Files:** (none — wrap-up)

- [ ] **Step 1: Verify the full file inventory**

Confirm all files in the plan's File Structure table exist and were modified:

```bash
cd /workspace/development/frappe-bench/apps/kavach
find . -newer docs/plans/2026-05-22-srt-case1-case2-plan.md -type f -name "*.py" -o -name "*.js" -o -name "*.md" | head -20
```

- [ ] **Step 2: Re-run the verification script one final time as a smoke check**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Expected: `=== 5 / 5 passed ===`.

- [ ] **Step 3: Print summary for user**

Report:
- Files touched: 6 (controller + install + JS + test script + 2 doc files + memory)
- Tests passing: 5/5
- Workflow transition added on dev site: verified
- UI smoke: 4 scenarios passed
- Restricted areas added: 6 new entries across header comments, app .md, and memory
- Spec + plan files retained at `apps/kavach/docs/{specs,plans}/`

Ask user: any further test cases to run? Any UX tweak to the green banner copy? Anything to back-fill into other docs?

---

## Self-Review Log

**Spec coverage:**
- §1 problem statement → Task 1 (tests assert the problematic states)
- §2 existing scaffold → Task 1 leverages `_classify_zero_delta_ticks` already in code
- §3.1 `on_submit` branch + `_route_to_system_approved` → Task 2 (steps 1–3)
- §3.2 workflow upgrade + idempotent helper → Task 3 (all 6 steps)
- §3.3 JS zero-functional-change + green banner polish → Task 5
- §3.4 file inventory → matches Plan's File Structure table
- §4 restricted areas (6 rules) → Task 2 step 4 (header comment) + Task 7 (app .md) + Task 8 (memory)
- §5 testing plan (5 manual tests) → Task 1 (script with 5 tests) + Task 6 (browser smoke)
- §6 out of scope → respected (no Srt User self-submit, no historical migration)

**Placeholder scan:** No TBDs, no "implement appropriate error handling", no "similar to" cross-refs.

**Type consistency:** `SYSTEM_APPROVE_MESSAGE` constant name used identically in Task 2 (define), Task 4 (test assert via `"exact match" in ...`), Task 7 (doc reference), Task 8 (memory reference). Method name `_route_to_system_approved` used identically across Task 2 definition + Task 2.4 RESTRICT comment + Task 7 doc reference + Task 8 memory reference. Helper name `_ensure_workflow_transition` used identically across Task 3.1 (define) + Task 3.3 (call) + Task 7 + Task 8.

**Edge case verified:** Task 2 step 3 keeps the existing `try/except` from current `on_submit` for the normal path. Case 1 path has no try/except because `db_set` calls are idempotent and can't raise the same class of error that the SR creation does.
