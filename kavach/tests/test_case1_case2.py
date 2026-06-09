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
    """Return a warehouse where TEST_ITEM has positive stock + at least one
    batch. Picks the warehouse with the highest batch count."""
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
    """Cancel + delete EVERY SRT for the test item (any docstatus) so:
      - the duplicate-open guard doesn't block fresh test runs (docstatus 0,1)
      - the gap rule's prior-SRT query doesn't see leftover cancelled docs
        from previous test runs (docstatus=2). The gap query searches
        docstatus IN (1, 2); without this, cancelled test docs accumulate
        and trip the gap rule during the NEXT run's setup phase.
    """
    names = frappe.db.sql(
        "SELECT name FROM `tabStock Reconciliation SRT` WHERE item = %s",
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
    """Mix of matched and delta ticks: matched rows silently unticked,
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
    doc.insert(ignore_permissions=True)  # validate fires, auto-unticks matched
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


# ── Test 6: v0.0.9.26 — posting_date/time mirror onto linked SR ────────────
def test_sr_posting_mirrors_srt():
    """The linked ERPNext SR must carry the SAME posting_date + posting_time
    as the SRT — at insert AND after submit. Without set_posting_time=1 on
    the SR doc, ERPNext's TransactionBase.validate_posting_time silently
    overrides them with now() on every validate (which runs on both insert
    and submit). The fix sets set_posting_time=1 before assignment.

    Backdated SRTs are the canonical use case — operator counts a Friday
    closing, files the SRT on Monday morning, expects the ledger entry to
    land on Friday. The audit trail breaks if the SR posts at the super
    admin's click time instead."""
    from frappe.utils import add_days, getdate
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        print("  SKIP test_sr_posting_mirrors_srt: no batches")
        return
    # Backdate to 2 days ago so we'd notice any reset to today.
    target_date = add_days(frappe.utils.nowdate(), -2)
    target_time = "10:15:00"
    doc.edit_posting = 1
    doc.posting_date = target_date
    doc.posting_time = target_time
    # Tick one row with a real delta.
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()

    assert doc.linked_erpnext_sr, "draft ERPNext SR should have been created"
    sr = frappe.get_doc("Stock Reconciliation", doc.linked_erpnext_sr)
    assert getdate(sr.posting_date) == getdate(target_date), (
        f"SR posting_date {sr.posting_date} != SRT posting_date {target_date} "
        f"(set_posting_time guard missing? See validate_posting_time in "
        f"erpnext/utilities/transaction_base.py)"
    )
    # Time comparison: ERPNext stores HH:MM:SS or HH:MM:SS.ffffff
    sr_time = str(sr.posting_time).split(".")[0][:8]
    assert sr_time == target_time, (
        f"SR posting_time {sr_time} != SRT posting_time {target_time}"
    )
    # set_posting_time should be persisted truthy on the SR.
    assert int(sr.set_posting_time or 0) == 1, (
        f"SR.set_posting_time must be 1 to lock our explicit posting "
        f"timestamp against future validate() passes; got {sr.set_posting_time!r}"
    )
    print(f"  PASS test_sr_posting_mirrors_srt "
          f"(SRT {doc.name} @ {target_date} {target_time} → SR {sr.name} @ "
          f"{sr.posting_date} {sr_time})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_case1_happy,
        test_case2_mixed,
        test_case1_preserves_admin_remark,
        test_cancel_auto_approved,
        test_regression_normal_submit,
        test_sr_posting_mirrors_srt,
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
