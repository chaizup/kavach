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


def _submit_and_close_prior_srt(warehouse, posting_date):
    """Helper — build, insert, submit AND cancel an SRT so it lands at
    docstatus=2 (Close). Uses the Case 1 (auto-approve) path so no
    ERPNext SR is created — keeps cancellation clean (no SR cascade).

    Why cancel: the existing _enforce_no_duplicate_open_srt_for_item
    guard blocks creating a new SRT while a prior is at docstatus IN
    (0, 1). The gap rule we're testing applies to docstatus IN (1, 2)
    priors, and only the docstatus=2 case exercises the gap rule's
    distinct value — docstatus=1 priors are caught by duplicate-open
    first. So tests submit-then-cancel to get a docstatus=2 anchor.

    Returns the cancelled doc's name."""
    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        frappe.throw("Need at least 1 batch on test item to run gap tests")
    # All matched → Case 1 auto-approve → no linked SR → clean cancel
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.posting_date = posting_date
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()
    doc.flags.ignore_permissions = True
    doc.cancel()
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
    first = _submit_and_close_prior_srt(warehouse, today)

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
    _submit_and_close_prior_srt(warehouse, today)

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
    _submit_and_close_prior_srt(warehouse, two_days_ago)

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
    original_name = _submit_and_close_prior_srt(warehouse, today)
    # Helper already cancelled it; reload for amend
    original = frappe.get_doc("Stock Reconciliation SRT", original_name)
    assert original.docstatus == 2, f"helper should leave doc cancelled, got {original.docstatus}"

    # Now turn the gap on AFTER the cancel, then amend
    _set_gap(10)
    amend = frappe.copy_doc(original)
    amend.amended_from = original.name
    amend.posting_date = today
    # copy_doc carries workflow_state from the cancelled original
    # (Approved By System). Frappe's workflow framework would reject
    # the Draft → Approved By System transition on insert. Reset it.
    amend.workflow_state = None
    amend.docstatus = 0
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
    _submit_and_close_prior_srt(warehouse, today)

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


# ── Test 6: Bugfix regression — prior at Super Admin Approval ──────────────
def test_super_admin_approval_does_not_block_new_srt():
    """Bug 2026-05-22 v0.0.4: a prior SRT at docstatus=1 with
    workflow_state='Super Admin Approval' (ERPNext SR submitted, stock
    posted, work complete) was wrongly treated as 'open' by the
    duplicate-open guard. The relaxed guard now allows a new SRT for
    the same item under those workflow states (gap rule still applies
    independently).

    Mirrors the user's reported scenario on CZMAT/133.
    """
    _set_gap(0)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    # Build, insert, submit a SRT with one real-delta row so on_submit
    # creates a draft ERPNext SR, then move to Super Admin Approval via
    # the workflow path (submit_linked_sr() + db_set state). To avoid
    # the heavy SR-submit machinery in a test, simulate the final state
    # directly via db_set — which is what submit_linked_sr does.
    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        frappe.throw("Need at least 1 batch on test item")
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    # Move to Super Admin Approval (the bug-triggering state) — db_set
    # mimics submit_linked_sr's final workflow_state write.
    doc.db_set("workflow_state", "Super Admin Approval", update_modified=False)
    frappe.db.commit()
    doc.reload()
    assert doc.workflow_state == "Super Admin Approval"
    assert doc.docstatus == 1

    # Now try to create a NEW SRT for the same item — must NOT be
    # blocked by the duplicate-open guard.
    doc2 = _build_srt(TEST_ITEM, warehouse)
    for r in doc2.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc2.posting_date = nowdate()
    doc2.insert(ignore_permissions=True)  # must NOT throw on dup-open
    print(f"  PASS test_super_admin_approval_does_not_block_new_srt "
          f"(prior={doc.name}@SuperAdmin, new={doc2.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 7: Bugfix regression — prior at Approved By System ────────────────
def test_approved_by_system_does_not_block_new_srt():
    """Companion test: a prior SRT at docstatus=1 with
    workflow_state='Approved By System' (Case 1 auto-approve) must
    also be non-blocking. This is the cleanest scenario because no
    ERPNext SR exists — the doc reaches the completed state purely
    through controller logic."""
    _set_gap(0)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    # Submit via Case 1 (all matched → Approved By System, no SR)
    doc = _build_srt(TEST_ITEM, warehouse)
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()
    assert doc.workflow_state == "Approved By System"
    assert doc.docstatus == 1

    # New SRT for same item — must NOT be blocked
    doc2 = _build_srt(TEST_ITEM, warehouse)
    for r in doc2.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc2.posting_date = nowdate()
    doc2.insert(ignore_permissions=True)
    print(f"  PASS test_approved_by_system_does_not_block_new_srt "
          f"(prior={doc.name}@ApprovedBySystem, new={doc2.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 8: Bugfix regression — prior at Admin Approval STILL blocks ───────
def test_admin_approval_still_blocks_new_srt():
    """Negative-case companion: a prior at docstatus=1 with
    workflow_state='Admin Approval' (SR still draft, awaiting super
    admin) MUST continue to block new SRTs. The relaxation only
    applies to the truly-completed states."""
    _set_gap(0)
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    # Submit a real-delta SRT; on_submit creates draft SR; workflow_state
    # stays "Admin Approval" (the normal Draft→Admin Approval path)
    doc = _build_srt(TEST_ITEM, warehouse)
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    # Force workflow_state to Admin Approval (workflow framework would
    # have done this if the Approve action was clicked; direct submit
    # leaves it at whatever)
    doc.db_set("workflow_state", "Admin Approval", update_modified=False)
    frappe.db.commit()

    # Try new SRT — must throw the duplicate-open guard
    doc2 = _build_srt(TEST_ITEM, warehouse)
    for r in doc2.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    doc2.posting_date = nowdate()
    threw = False
    try:
        doc2.insert(ignore_permissions=True)
    except frappe.ValidationError as e:
        if "still open" in str(e) or "Close the existing SRT" in str(e):
            threw = True
    assert threw, "Admin Approval prior should still block new SRTs"
    print(f"  PASS test_admin_approval_still_blocks_new_srt (prior={doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_gap_disabled_allows_back_to_back,
        test_gap_blocks_within_window,
        test_gap_allows_after_window,
        test_amendment_skips_gap,
        test_gap_reconfig_takes_effect_immediately,
        test_super_admin_approval_does_not_block_new_srt,
        test_approved_by_system_does_not_block_new_srt,
        test_admin_approval_still_blocks_new_srt,
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
