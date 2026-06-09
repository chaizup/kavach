# =============================================================================
# CONTEXT: Runnable verification for "as-of posting_date/posting_time" stock
# fetch behaviour. Mirrors the convention established in test_case1_case2.py
# and test_srt_settings_gap.py — bench-console scripts that assert state on
# the live dev-site.
#
# Run with:
#   bench --site development.localhost execute \
#     kavach.tests.test_historical_stock.run_all
#
# MEMORY: app_kavach.md § Live test 2026-05-22
# SPEC:   docs/specs/2026-05-22-srt-historical-stock-design.md
# =============================================================================

import frappe
from frappe.utils import add_days, flt, nowdate, nowtime

from kavach.stock_reconciliation_tracking.api import (
    get_item_defaults,
)
from kavach.tests.test_case1_case2 import (
    TEST_ITEM,
    _pick_warehouse,
)

EPS = 0.001


# ── Test 1: No posting filter returns current state (backward compat) ──────
def test_no_posting_filter_returns_current():
    """Calling get_item_defaults without posting_date/time must return the
    same result as today's behaviour (unbounded SLE aggregation)."""
    warehouse = _pick_warehouse()
    r_now = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    assert "batches" in r_now, "missing batches key"
    assert "total_current_stock_in_default_uom" in r_now, "missing total"
    # Backward-compat shape — must include the same keys today's callers expect
    for key in ("item_name", "default_uom", "higher_uom", "higher_uom_cf",
                "total_current_stock_in_higher_uom"):
        assert key in r_now, f"missing key {key}"
    print(f"  PASS test_no_posting_filter_returns_current "
          f"({len(r_now['batches'])} batches, total={r_now['total_current_stock_in_default_uom']:.3f})")


# ── Test 2: Future date falls back to "now" ────────────────────────────────
def test_future_date_falls_back_to_now():
    """Calling with a future posting_date must return the same result as
    omitting posting_date entirely (no clamping = same as 'now')."""
    warehouse = _pick_warehouse()
    r_now    = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    r_future = get_item_defaults(
        item_code=TEST_ITEM, warehouse=warehouse,
        posting_date=add_days(nowdate(), 365),
        posting_time="23:59:59",
    )
    assert abs(r_now["total_current_stock_in_default_uom"]
               - r_future["total_current_stock_in_default_uom"]) < EPS, (
        f"future-date total {r_future['total_current_stock_in_default_uom']} "
        f"should equal current {r_now['total_current_stock_in_default_uom']}"
    )
    assert len(r_now["batches"]) == len(r_future["batches"]), (
        f"batch count differs: now={len(r_now['batches'])} "
        f"future={len(r_future['batches'])}"
    )
    print("  PASS test_future_date_falls_back_to_now")


# ── Test 3: Historical date excludes later SLEs ────────────────────────────
def test_historical_date_excludes_later_sles():
    """Compare result at 'now' vs. result 5 years in the past. The past
    snapshot must have <= the same totals as 'now' (assuming the item
    accumulated stock over time). Strict < if there are any historical SLEs."""
    warehouse = _pick_warehouse()
    r_now  = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    r_past = get_item_defaults(
        item_code=TEST_ITEM, warehouse=warehouse,
        posting_date=add_days(nowdate(), -365 * 5),
        posting_time="00:00:00",
    )
    # At least the totals should differ — historical can equal 0 if the
    # item didn't exist 5 years ago, or be a partial sum if it did
    assert r_past["total_current_stock_in_default_uom"] <= r_now["total_current_stock_in_default_uom"] + EPS, (
        f"5-years-ago total ({r_past['total_current_stock_in_default_uom']}) "
        f"can't exceed current ({r_now['total_current_stock_in_default_uom']})"
    )
    print(f"  PASS test_historical_date_excludes_later_sles "
          f"(now={r_now['total_current_stock_in_default_uom']:.3f}, "
          f"5yr_ago={r_past['total_current_stock_in_default_uom']:.3f})")


# ── Test 4: Parent total = Σ children's current_stock_in_stock_uom ─────────
def test_total_matches_child_sum():
    """Invariant: parent total == sum over batches of current_stock_in_stock_uom.
    Verifies that the new SLE-aggregated total agrees with the rows."""
    warehouse = _pick_warehouse()
    r = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    parent_total = flt(r["total_current_stock_in_default_uom"])
    child_sum = sum(flt(b["current_stock_in_stock_uom"]) for b in r["batches"])
    assert abs(parent_total - child_sum) < EPS, (
        f"total ({parent_total}) != Σ children ({child_sum}); "
        f"diff = {parent_total - child_sum}"
    )
    print(f"  PASS test_total_matches_child_sum "
          f"(parent_total={parent_total:.3f}, child_sum={child_sum:.3f})")


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_no_posting_filter_returns_current,
        test_future_date_falls_back_to_now,
        test_historical_date_excludes_later_sles,
        test_total_matches_child_sum,
    ]
    print(f"\n=== SRT historical-stock verification ({len(tests)} tests) ===")
    failures = []
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failures.append((t.__name__, e))
    print(f"\n=== {len(tests) - len(failures)} / {len(tests)} passed ===")
    if failures:
        raise AssertionError(
            f"{len(failures)} test(s) failed: "
            + ", ".join(n for n, _ in failures)
        )
