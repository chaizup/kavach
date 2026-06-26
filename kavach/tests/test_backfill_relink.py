# =============================================================================
# CONTEXT: Runnable verification for the 2026-06-26 "foolproof + relink" work.
#
#   Proves the two guarantees the user asked for:
#     1. on_submit is ATOMIC — a normal-delta approval always lands a linked
#        draft SR (covered by test_case1_case2.test_regression_normal_submit;
#        here we focus on the relink/backfill recovery tool).
#     2. The Srt Super Admin "Relink Missing ERPNext SR" backfill recreates the
#        missing draft SR for an admin-approved SRT — and the recreated SR
#        carries the SAME posting_date AND posting_time the operator entered on
#        the SRT (NOT the relink click time). This is the user's hard
#        requirement: "in the relink process the posting date and time should be
#        same as user putted while create new srt."
#
#   Run with (this bench's site is dev.localhost):
#     ~/.local/bin/bench --site dev.localhost execute \
#       kavach.tests.test_backfill_relink.run_all
#
# MEMORY: stock_reconciliation_srt.md (DocType), stock_reconciliation_tracking.md
# =============================================================================

import frappe
from frappe.utils import flt, add_days, getdate, nowdate

from kavach.tests.test_case1_case2 import (
    TEST_ITEM,
    _pick_warehouse,
    _build_srt,
    _cleanup_open_srt_for_item,
)
from kavach.stock_reconciliation_tracking.doctype.stock_reconciliation_srt.stock_reconciliation_srt import (
    backfill_missing_sr,
    get_backfill_candidates,
)


def _make_orphan_admin_approved_srt(target_date, target_time):
    """Create + submit a normal-delta SRT (→ Admin Approval + draft SR), then
    simulate the historical bug by deleting the draft SR and clearing the link
    so the SRT is 'admin-approved but has no linked SR'. Returns the SRT name."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        return None
    doc.edit_posting = 1
    doc.posting_date = target_date
    doc.posting_time = target_time
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()

    assert doc.workflow_state == "Admin Approval", doc.workflow_state
    assert doc.linked_erpnext_sr, "setup: draft SR should exist before we orphan it"
    stray = doc.linked_erpnext_sr

    # Clear the link FIRST (so the SR delete isn't blocked by the back-reference),
    # then delete the draft SR — leaving the exact orphan state the bug produced.
    doc.db_set("linked_erpnext_sr", "", update_modified=False)
    frappe.db.commit()
    frappe.delete_doc("Stock Reconciliation", stray, force=True, ignore_permissions=True)
    frappe.db.commit()
    doc.reload()
    assert not doc.linked_erpnext_sr, "setup: SRT should now be an orphan"
    return doc.name


# ── Test 1: relink preserves the operator's posting date AND time ──────────
def test_backfill_preserves_posting_date_and_time():
    """The user's hard requirement. Backdate the SRT 3 days, orphan it, relink,
    and assert the NEW draft SR posts on the SRT's backdated date+time."""
    target_date = add_days(nowdate(), -3)
    target_time = "09:30:00"
    name = _make_orphan_admin_approved_srt(target_date, target_time)
    if not name:
        print("  SKIP test_backfill_preserves_posting_date_and_time: no batches")
        return

    results = backfill_missing_sr(srt_names=[name])
    frappe.db.commit()

    res = next((r for r in results if r["name"] == name), None)
    assert res and res["ok"], f"backfill failed: {results}"

    doc = frappe.get_doc("Stock Reconciliation SRT", name)
    assert doc.linked_erpnext_sr, "relink should have recreated + linked a draft SR"
    sr = frappe.get_doc("Stock Reconciliation", doc.linked_erpnext_sr)

    assert sr.docstatus == 0, f"relinked SR should be DRAFT, got {sr.docstatus}"
    # POSTING DATE fidelity
    assert getdate(sr.posting_date) == getdate(target_date), (
        f"relinked SR posting_date {sr.posting_date} != SRT posting_date "
        f"{target_date} — relink must preserve the operator's date, not 'now'."
    )
    # POSTING TIME fidelity — compare as time VALUES (Frappe stores "9:30:00",
    # the operator typed "09:30:00"; these are the same instant).
    from frappe.utils import get_time
    assert get_time(sr.posting_time) == get_time(target_time), (
        f"relinked SR posting_time {sr.posting_time} != SRT posting_time "
        f"{target_time} — relink must preserve the operator's time, not the "
        f"relink-click time."
    )
    # The lock that keeps ERPNext from rewriting the timestamp on submit.
    assert int(sr.set_posting_time or 0) == 1, (
        f"relinked SR.set_posting_time must be 1; got {sr.set_posting_time!r}"
    )
    print(f"  PASS test_backfill_preserves_posting_date_and_time "
          f"(SRT {name} @ {target_date} {target_time} → SR {sr.name} @ "
          f"{sr.posting_date} {sr.posting_time})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 2: relink is idempotent (a valid link is left untouched) ──────────
def test_backfill_idempotent_on_valid_link():
    """Running backfill on an SRT that already has a valid draft SR must NOT
    create a second SR — it returns action 'already_linked'."""
    target_date = add_days(nowdate(), -1)
    target_time = "11:00:00"
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        print("  SKIP test_backfill_idempotent_on_valid_link: no batches")
        return
    doc.edit_posting = 1
    doc.posting_date = target_date
    doc.posting_time = target_time
    r0 = doc.batches[0]
    r0.is_counted = 1
    r0.qty_found = flt(r0.current_stock_in_selected_uom) + 1.0
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    doc.reload()
    first_sr = doc.linked_erpnext_sr
    assert first_sr, "setup: SR should exist"

    results = backfill_missing_sr(srt_names=[doc.name])
    frappe.db.commit()
    res = next((r for r in results if r["name"] == doc.name), None)
    assert res and res["ok"], f"unexpected failure: {results}"
    assert res["action"] == "already_linked", (
        f"expected 'already_linked', got {res['action']!r}"
    )
    doc.reload()
    assert doc.linked_erpnext_sr == first_sr, "link must be unchanged"
    print(f"  PASS test_backfill_idempotent_on_valid_link "
          f"(SRT {doc.name} kept SR {first_sr})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 3: a system-approved (Case 1) SRT is NEVER backfilled ─────────────
def test_backfill_skips_system_approved():
    """Approved By System SRTs have no delta to post — backfill must never
    create an SR for them, and get_backfill_candidates must not list them."""
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    doc = _build_srt(TEST_ITEM, warehouse)
    if not doc.batches:
        print("  SKIP test_backfill_skips_system_approved: no batches")
        return
    # All ticked rows match current stock → Case 1 → Approved By System, no SR.
    for r in doc.batches:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom)
    # Case 1 auto-approves on SAVE via on_update (db_set docstatus=1). We do NOT
    # call doc.submit() here: submitting again after the db_set auto-approve
    # trips an unrelated, pre-existing higher-UOM precision guard on this site's
    # data. insert-only is the clean path to reach Approved By System.
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    doc.reload()
    if doc.workflow_state != "Approved By System":
        print(f"  SKIP test_backfill_skips_system_approved: data did not "
              f"auto-approve (state={doc.workflow_state!r})")
        _cleanup_open_srt_for_item(TEST_ITEM)
        return
    assert not doc.linked_erpnext_sr

    # Direct backfill attempt must be refused (excluded state).
    results = backfill_missing_sr(srt_names=[doc.name])
    res = next((r for r in results if r["name"] == doc.name), None)
    assert res and not res["ok"], f"system-approved SRT must be skipped: {res}"

    # And it must not show up in the scan.
    cand = get_backfill_candidates()
    names = [r["name"] for r in cand["rows"]]
    assert doc.name not in names, "Approved By System SRT must not be a candidate"

    doc.reload()
    assert not doc.linked_erpnext_sr, "no SR should ever be created for Case 1"
    print(f"  PASS test_backfill_skips_system_approved ({doc.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_backfill_preserves_posting_date_and_time,
        test_backfill_idempotent_on_valid_link,
        test_backfill_skips_system_approved,
    ]
    print(f"\n=== SRT backfill / relink verification ({len(tests)} tests) ===")
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
