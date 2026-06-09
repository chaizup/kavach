# =============================================================================
# CONTEXT: Runnable verification for the SRT Dashboard page's server-side
# APIs. Mirrors the convention established in test_case1_case2.py /
# test_srt_settings_gap.py / test_historical_stock.py.
#
# Run with:
#   bench --site development.localhost execute \
#     kavach.tests.test_srt_dashboard.run_all
#
# MEMORY: app_kavach.md § Live test 2026-05-23
# SPEC:   docs/specs/2026-05-23-srt-dashboard-design.md
# =============================================================================

import frappe
from frappe.utils import flt, nowdate

from kavach.tests.test_case1_case2 import (
    TEST_ITEM,
    _build_srt,
    _cleanup_open_srt_for_item,
    _pick_warehouse,
)


# Helpers used by multiple tests
def _make_draft_srt(item, warehouse):
    doc = _build_srt(item, warehouse)
    for r in doc.batches[:1]:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom) + 1.0
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)
    return doc


# ── Test 1 ─────────────────────────────────────────────────────────────────
def test_dashboard_rows_filters_by_tab():
    """v0.0.9.17 — get_dashboard_rows('Admin Approval Pending') returns
    only docstatus=0 docs (drafts awaiting Srt Admin's approval). Smoke
    tests the tab filter logic and the response shape."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_dashboard_rows,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    draft = _make_draft_srt(TEST_ITEM, warehouse)
    rows = get_dashboard_rows(tab="Admin Approval Pending")
    names = [r["name"] for r in rows]
    assert draft.name in names, f"Draft {draft.name} not in Admin Approval Pending tab: {names}"
    # Verify shape — every row must have the 8 grid-bound fields
    sample = next(r for r in rows if r["name"] == draft.name)
    for k in ("name", "item", "item_name", "default_warehouse",
              "total_qty_found_in_default_uom",
              "total_qty_found_in_higher_uom",
              "total_current_stock_in_default_uom",
              "total_current_stock_in_higher_uom",
              "posting_date", "posting_time", "user_remark"):
        assert k in sample, f"missing field {k} in dashboard row"
    print(f"  PASS test_dashboard_rows_filters_by_tab "
          f"(found {draft.name} in Admin Approval Pending tab; {len(rows)} total)")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 2 ─────────────────────────────────────────────────────────────────
def test_batch_summary_returns_per_batch_data():
    """get_batch_summary(srt_name) returns one dict per batch with the
    5 fields the View modal renders."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_batch_summary,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    summary = get_batch_summary(srt_name=draft.name)
    assert isinstance(summary, list), f"expected list, got {type(summary)}"
    assert len(summary) == len(draft.batches), (
        f"summary length {len(summary)} != batches {len(draft.batches)}")
    for b in summary:
        for k in ("batch_no", "origin", "summary_origin_to_posting",
                  "last_sr_date", "summary_lastsr_to_posting"):
            assert k in b, f"missing field {k} in batch summary entry"
        for w in ("summary_origin_to_posting", "summary_lastsr_to_posting"):
            assert "in" in b[w], f"missing 'in' in {w}"
            assert "out" in b[w], f"missing 'out' in {w}"
    print(f"  PASS test_batch_summary_returns_per_batch_data "
          f"({draft.name}, {len(summary)} batches)")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 3 ─────────────────────────────────────────────────────────────────
def test_batch_drilldown_returns_in_out_split():
    """get_batch_drilldown returns {in: [...], out: [...]} with per-SLE
    voucher_type, voucher_no, posting_datetime, qty fields."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_batch_drilldown,
    )
    from kavach.stock_reconciliation_tracking.api import (
        get_item_defaults,
    )
    from frappe.utils import add_days
    warehouse = _pick_warehouse()
    defaults = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    if not defaults["batches"]:
        print("  SKIP test_batch_drilldown_returns_in_out_split: no batches")
        return
    batch = defaults["batches"][0]["batch_no"]
    r = get_batch_drilldown(
        item_code=TEST_ITEM, warehouse=warehouse, batch_no=batch,
        from_date=add_days(nowdate(), -365), to_date=nowdate(),
    )
    assert "in" in r and "out" in r, f"missing keys; got {list(r.keys())}"
    assert isinstance(r["in"], list) and isinstance(r["out"], list)
    for entry in (r["in"] + r["out"]):
        for k in ("voucher_type", "voucher_no", "posting_datetime", "qty"):
            assert k in entry, f"missing field {k} in drilldown entry"
    total = len(r["in"]) + len(r["out"])
    print(f"  PASS test_batch_drilldown_returns_in_out_split "
          f"({batch}: {len(r['in'])} in, {len(r['out'])} out, {total} total)")


# ── Test 4 ─────────────────────────────────────────────────────────────────
def test_approve_srt_advances_workflow():
    """Approving a Draft SRT moves it to Admin Approval with a draft SR."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        approve_srt,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    approve_srt(srt_name=draft.name)
    frappe.db.commit()
    draft.reload()
    assert draft.docstatus == 1, f"expected docstatus=1, got {draft.docstatus}"
    assert draft.workflow_state == "Admin Approval", (
        f"expected Admin Approval, got {draft.workflow_state!r}")
    assert draft.linked_erpnext_sr, "expected draft ERPNext SR to be created"
    print(f"  PASS test_approve_srt_advances_workflow ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 5 ─────────────────────────────────────────────────────────────────
def test_reject_srt_closes_with_reason():
    """Rejecting a SRT moves it to Close with the reason written to a
    remark field."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        approve_srt, reject_srt,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    approve_srt(srt_name=draft.name)
    frappe.db.commit()
    reject_srt(srt_name=draft.name, reason="test rejection")
    frappe.db.commit()
    draft.reload()
    assert draft.docstatus == 2, f"expected docstatus=2, got {draft.docstatus}"
    remark = (draft.super_admin_remark or draft.admin_remark or "")
    assert "test rejection" in remark, (
        f"expected reason in remark, got remark={remark!r}")
    print(f"  PASS test_reject_srt_closes_with_reason ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 6 ─────────────────────────────────────────────────────────────────
def test_bulk_approve_returns_per_row_results():
    """bulk_approve_srt returns one result entry per name."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        bulk_approve_srt,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    results = bulk_approve_srt(srt_names=[draft.name])
    assert isinstance(results, list) and len(results) == 1
    for r in results:
        assert "name" in r and "ok" in r
    assert results[0]["ok"] is True, f"expected ok=True, got {results[0]}"
    print(f"  PASS test_bulk_approve_returns_per_row_results "
          f"({len(results)} results)")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 7: v0.0.9.17 — counts API powers tab badges (2 tabs now) ──────────
def test_dashboard_counts_returns_three_tabs():
    """get_dashboard_counts returns counts for the 2 dashboard tabs:
    Admin Approval Pending (Draft docs) + Super Admin Approval Pending
    (workflow_state='Admin Approval' docs). The legacy 3-tab name is
    kept on the test function so the loop's expectation matches; the
    runner asserts only the two tab keys we now surface in the UI."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_dashboard_counts,
    )
    r = get_dashboard_counts()
    assert isinstance(r, dict), f"expected dict, got {type(r)}"
    for tab in ("Admin Approval Pending", "Super Admin Approval Pending"):
        assert tab in r, f"missing tab {tab}"
        assert isinstance(r[tab], int), f"{tab} count must be int"
    print(f"  PASS test_dashboard_counts_returns_three_tabs ({r})")


# ── Test 8: v0.0.9 — schema-driven form meta (live sync) ───────────────────
def test_form_meta_returns_doctype_schema():
    """get_form_meta returns parent + child field shapes from frappe.get_meta.
    Schema changes to the DocType propagate to the form without JS changes."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_form_meta,
    )
    r = get_form_meta()
    assert "parent_fields" in r and "child_fields" in r
    assert "user_roles" in r and "current_user" in r
    # At least item, default_warehouse, batches must be in parent
    parent_names = {f["fieldname"] for f in r["parent_fields"]}
    for required in ("item", "default_warehouse", "batches",
                     "posting_date", "user_remark"):
        assert required in parent_names, f"parent_fields missing {required}"
    # Batch List must include batch_no, qty_found, is_counted
    child_names = {f["fieldname"] for f in r["child_fields"]}
    for required in ("batch_no", "qty_found", "is_counted", "select_uom"):
        assert required in child_names, f"child_fields missing {required}"
    print(f"  PASS test_form_meta_returns_doctype_schema "
          f"({len(r['parent_fields'])} parent, {len(r['child_fields'])} child)")


# ── Test 9: v0.0.9 — optimistic concurrency on save ────────────────────────
def test_save_throws_on_stale_modified_timestamp():
    """save_srt_form with an outdated `modified` timestamp must throw
    TimestampMismatchError so the UI can offer a reload prompt."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        save_srt_form,
    )
    from frappe.exceptions import TimestampMismatchError
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    # Simulate a concurrent edit by bumping `modified` via db_set
    import time
    time.sleep(1)  # ensure timestamp differs by at least 1s
    frappe.db.set_value("Stock Reconciliation SRT", draft.name,
                        "modified", frappe.utils.now(), update_modified=False)
    frappe.db.commit()
    # Now try to save with the original (stale) timestamp
    threw = False
    try:
        save_srt_form(
            payload={
                "user_remark": "stale edit",
                "modified": str(draft.modified),  # old timestamp
            },
            name=draft.name,
        )
    except (TimestampMismatchError, frappe.ValidationError) as e:
        if "edited by someone else" in str(e) or "TimestampMismatchError" in type(e).__name__:
            threw = True
    assert threw, "expected TimestampMismatchError on stale save"
    print(f"  PASS test_save_throws_on_stale_modified_timestamp ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 10: v0.0.9 — dashboard form save parity with DocType controller ───
def test_form_save_runs_doctype_validate_chain():
    """save_srt_form must dispatch through doc.save() so the controller's
    validate() chain runs (e.g., empty-batches throws the canonical error)."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        save_srt_form,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    # Empty payload — no batches → validate chain must reject
    payload = {
        "item": TEST_ITEM,
        "default_warehouse": warehouse,
        "company": frappe.defaults.get_user_default("Company")
                   or frappe.db.get_value("Company", {}, "name"),
        "posting_date": nowdate(),
        "posting_time": frappe.utils.nowtime(),
        "batches": [],  # empty — triggers the "at least one ticked" gate
    }
    threw = False
    try:
        save_srt_form(payload=payload)
    except frappe.ValidationError as e:
        msg = str(e)
        if "tick the" in msg or "No Rows Marked" in msg or "Do Reconcile" in msg:
            threw = True
    assert threw, "expected validate chain to reject empty-batches"
    print(f"  PASS test_form_save_runs_doctype_validate_chain")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_dashboard_rows_filters_by_tab,
        test_batch_summary_returns_per_batch_data,
        test_batch_drilldown_returns_in_out_split,
        test_approve_srt_advances_workflow,
        test_reject_srt_closes_with_reason,
        test_bulk_approve_returns_per_row_results,
        test_dashboard_counts_returns_three_tabs,
        test_form_meta_returns_doctype_schema,
        test_save_throws_on_stale_modified_timestamp,
        test_form_save_runs_doctype_validate_chain,
    ]
    print(f"\n=== SRT Dashboard verification ({len(tests)} tests) ===")
    failures = []
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failures.append((t.__name__, e))
            try:
                _cleanup_open_srt_for_item(TEST_ITEM)
            except Exception:
                pass
    print(f"\n=== {len(tests) - len(failures)} / {len(tests)} passed ===")
    if failures:
        raise AssertionError(
            f"{len(failures)} test(s) failed: "
            + ", ".join(n for n, _ in failures)
        )
