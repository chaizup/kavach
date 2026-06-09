# SRT Historical "As-Of" Stock Fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `get_item_defaults` and `get_batch_current_state` time-aware so the SRT form's totals + batch grid reflect the stock state at the chosen `posting_date` + `posting_time`. JS form re-fetches when any of (item, warehouse, posting_date, posting_time) change.

**Architecture:** Add `posting_date` + `posting_time` kwargs to both API methods. Build an `as_of_datetime` from them; if either is empty or the timestamp is in the future, fall back to unbounded queries (today's behaviour). The SLE join gets a `TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)` clause; the parent total is recomputed from the same bounded SLE rows (replacing the previous `tabBin` lookup) so total = Σ children always.

**Tech Stack:** Frappe v16 / Python 3.14 / ERPNext v16 — Stock Ledger Entry + Serial and Batch Bundle/Entry joins.

**Spec:** `apps/kavach/docs/specs/2026-05-22-srt-historical-stock-design.md`

**Source-control note:** The SRT app folder is NOT a standalone git repo (parent `/workspace` repo `.gitignore`s `development/frappe-bench/`). Skip `git commit` steps; treat each task's "Commit" step as an on-disk save checkpoint.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `apps/kavach/kavach/kavach/api.py` | Whitelisted module API — `get_item_defaults` + `get_batch_current_state` time-bound + SLE-aggregated total | Modify |
| `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.js` | Form JS — 2 new field handlers + 2 new API params | Modify |
| `apps/kavach/kavach/tests/test_historical_stock.py` | 4 assertion-based verification tests + `run_all()` | Create |
| `apps/kavach/kavach.md` (app root) | New §15 + Sync Block bump to v0.0.5 | Modify |
| `apps/kavach/kavach/kavach/kavach.md` (module) | Append paragraph on historical fetch | Modify |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | Bump version to v0.0.5 + add restricted areas + live test | Modify |

---

## Task 1: Write the failing verification script

**Files:**
- Create: `apps/kavach/kavach/tests/test_historical_stock.py`

### Why this comes first

TDD discipline — assertions first; observe RED before implementing. Re-uses `TEST_ITEM`, `_pick_warehouse` from the sibling test file (`tests/test_case1_case2.py`).

- [ ] **Step 1: Write the verification script**

Create `apps/kavach/kavach/tests/test_historical_stock.py`:

```python
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
```

- [ ] **Step 2: Run the script — confirm test 2 + test 3 FAIL**

Run from `/workspace/development/frappe-bench`:

```bash
bench --site development.localhost execute \
  kavach.tests.test_historical_stock.run_all
```

Expected:
- `test_no_posting_filter_returns_current` PASS (today's behaviour matches itself)
- `test_total_matches_child_sum` may PASS or FAIL depending on whether `tabBin.actual_qty` happens to equal the SLE sum (it often does in clean state, so this test won't reliably go RED — that's fine, it acts as an invariant guard)
- **`test_future_date_falls_back_to_now`** — passes today because `get_item_defaults` ignores `posting_date` (the kwarg doesn't exist yet), so future-date and no-date return the same. RED on the call-signature: `get_item_defaults()` accepts no `posting_date`, so the test should fail with `TypeError: get_item_defaults() got an unexpected keyword argument 'posting_date'`. THAT is the RED signal.
- **`test_historical_date_excludes_later_sles`** — also throws the same `TypeError`.

So expected RED: tests 2 + 3 throw TypeError. Tests 1 + 4 pass.

- [ ] **Step 3: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/tests/test_historical_stock.py
```

---

## Task 2: Add `posting_date` + `posting_time` kwargs to `get_item_defaults`

**Files:**
- Modify: `apps/kavach/kavach/kavach/api.py`

- [ ] **Step 1: Add an `_as_of_clause()` private helper**

Find the existing `def _pick_higher_uom(...)` (around line 337 — the lowest helper in the file) and insert a new helper IMMEDIATELY ABOVE it:

```python
def _as_of_clause(posting_date, posting_time):
    """Build a SQL WHERE-clause fragment + params tuple that bounds SLE
    rows to `<= posting_datetime`. Returns ("", ()) when either input
    is missing OR the resulting timestamp is in the future, signalling
    "no bound" (callers concatenate the empty clause and pass the empty
    params tuple — both no-ops).

    SPEC: docs/specs/2026-05-22-srt-historical-stock-design.md § 2.2
    RESTRICT: do NOT remove the "either empty → no bound" fallback.
    Mid-fill state (validate firing before user has set posting_date)
    would return empty grids and break the form UX.
    """
    from frappe.utils import get_datetime, now_datetime

    if not (posting_date and posting_time):
        return "", ()
    try:
        as_of = get_datetime(f"{posting_date} {posting_time}")
    except Exception:
        return "", ()
    if as_of >= now_datetime():
        return "", ()
    return (
        " AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)",
        (posting_date, posting_time),
    )
```

- [ ] **Step 2: Change `get_item_defaults` signature**

Find the existing function (line 39). Update the signature line:

```python
@frappe.whitelist()
def get_item_defaults(item_code, warehouse=None, posting_date=None, posting_time=None):
```

Update the docstring's parameter section (immediately under the function) to add:

```
       posting_date / posting_time:
         Optional. When both are present AND the resulting timestamp is
         in the past, the SLE aggregation is bounded so totals + batch
         list reflect the "as of" state. Either missing or future → no
         bound (same as today's behaviour). See spec for fallback rules.
```

- [ ] **Step 3: Replace the `tabBin` total query with an SLE-aggregated total**

In the `if warehouse:` branch (around lines 99–122), REPLACE the body with:

```python
    if warehouse:
        as_of_clause, as_of_params = _as_of_clause(posting_date, posting_time)
        batch_rows = frappe.db.sql(f"""
            SELECT
              sbe.batch_no                            AS batch_no,
              sle.warehouse                           AS warehouse,
              SUM(sbe.qty)                            AS qty,
              MAX(sle.valuation_rate)                 AS valuation_rate
            FROM `tabStock Ledger Entry` sle
            JOIN `tabSerial and Batch Entry` sbe
                 ON sbe.parent = sle.serial_and_batch_bundle
            WHERE sle.item_code = %s
              AND sle.warehouse = %s
              AND sle.is_cancelled = 0
              AND sbe.batch_no IS NOT NULL
              AND sbe.batch_no != ''
              {as_of_clause}
            GROUP BY sbe.batch_no, sle.warehouse
            HAVING SUM(sbe.qty) > 0.001
            ORDER BY sbe.batch_no
        """, (item_code, warehouse, *as_of_params), as_dict=True)
        total_stock = sum(flt(b["qty"]) for b in batch_rows)
```

Note: `total_stock` is now computed by summing the bounded batch rows — NOT by querying `tabBin`. This guarantees `total == Σ children`.

- [ ] **Step 4: Same change in the legacy aggregate branch**

In the `else:` branch (around lines 124–145), REPLACE the body with:

```python
    else:
        as_of_clause, as_of_params = _as_of_clause(posting_date, posting_time)
        batch_rows = frappe.db.sql(f"""
            SELECT
              sbe.batch_no                            AS batch_no,
              sle.warehouse                           AS warehouse,
              SUM(sbe.qty)                            AS qty,
              MAX(sle.valuation_rate)                 AS valuation_rate
            FROM `tabStock Ledger Entry` sle
            JOIN `tabSerial and Batch Entry` sbe
                 ON sbe.parent = sle.serial_and_batch_bundle
            WHERE sle.item_code = %s
              AND sle.is_cancelled = 0
              AND sbe.batch_no IS NOT NULL
              AND sbe.batch_no != ''
              {as_of_clause}
            GROUP BY sbe.batch_no, sle.warehouse
            HAVING SUM(sbe.qty) > 0.001
            ORDER BY sle.warehouse, sbe.batch_no
        """, (item_code, *as_of_params), as_dict=True)
        total_stock = sum(flt(b["qty"]) for b in batch_rows)
```

- [ ] **Step 5: Verify the helper docstring at the top of `get_item_defaults` is in sync**

Make sure the docstring block that begins `INSTRUCTIONS:` mentions the as-of behaviour. Find the line:

```python
      - select_uom defaults to higher_uom if available, else stock_uom.
    """
```

Insert ABOVE that line:

```python
      - When posting_date + posting_time are passed AND the resulting
        timestamp is in the past, the SLE join is bounded to entries
        <= that timestamp — totals + batch list reflect the historical
        "as of" state. The HAVING > 0.001 clause stays, so batches that
        had zero qty at the as-of moment are EXCLUDED from the list.
```

- [ ] **Step 6: Run the suite — tests 2 + 3 must now PASS**

```bash
bench --site development.localhost execute \
  kavach.tests.test_historical_stock.run_all
```

Expected: `=== 4 / 4 passed ===`. If 2/3 still fail with TypeError, re-check Step 2 (signature was not changed).

- [ ] **Step 7: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/api.py
```

---

## Task 3: Time-bound `get_batch_current_state` (companion API)

**Files:**
- Modify: `apps/kavach/kavach/kavach/api.py`

- [ ] **Step 1: Update the signature and SQL**

Find `get_batch_current_state` (around line 299). Replace it entirely with:

```python
@frappe.whitelist()
def get_batch_current_state(item_code, batch_no, posting_date=None, posting_time=None):
    """Return current (warehouse, qty, valuation_rate, stock_uom) for a
    manually-typed batch — used when the operator adds a row not in the
    auto-populated list.

    posting_date / posting_time: same as get_item_defaults — bounds the
    SLE aggregation to entries <= as_of_datetime. Either missing or
    future falls back to unbounded (current state).
    """
    if not (item_code and batch_no):
        return {}
    as_of_clause, as_of_params = _as_of_clause(posting_date, posting_time)
    rows = frappe.db.sql(f"""
        SELECT
          sle.warehouse                           AS warehouse,
          SUM(sbe.qty)                            AS qty,
          MAX(sle.valuation_rate)                 AS valuation_rate
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s
          AND sbe.batch_no = %s
          AND sle.is_cancelled = 0
          {as_of_clause}
        GROUP BY sle.warehouse
        HAVING SUM(sbe.qty) > 0.001
        ORDER BY SUM(sbe.qty) DESC
        LIMIT 1
    """, (item_code, batch_no, *as_of_params), as_dict=True)
    if not rows:
        return {}
    row = rows[0]
    stock_uom = frappe.db.get_value("Item", item_code, "stock_uom")
    return {
        "warehouse":      row["warehouse"],
        "qty":            flt(row["qty"]),
        "valuation_rate": flt(row["valuation_rate"]),
        "stock_uom":      stock_uom,
    }
```

- [ ] **Step 2: On-disk checkpoint** — no test changes needed; the existing tests don't exercise this API directly. The JS UX uses it; we cover that in Task 4.

```bash
grep -n "def get_batch_current_state" apps/kavach/kavach/kavach/api.py
```

Expected: `def get_batch_current_state(item_code, batch_no, posting_date=None, posting_time=None):`

---

## Task 4: JS form triggers + API call extension

**Files:**
- Modify: `apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.js`

- [ ] **Step 1: Add `posting_date` + `posting_time` event handlers**

Find the `default_warehouse(frm)` handler (around line 76). Insert IMMEDIATELY AFTER its closing `}`, BEFORE `edit_posting(frm)`:

```javascript
    posting_date(frm) {
        // 2026-05-22 v0.0.5 — refetch the as-of stock snapshot whenever
        // the operator changes the posting date. Mirrors the item /
        // warehouse handlers above. No confirm prompt per spec —
        // counted rows are lost on date change (consistent UX).
        if (!frm.doc.item || !frm.doc.default_warehouse) return;
        _ipv_srt_load_defaults(frm);
    },

    posting_time(frm) {
        // 2026-05-22 v0.0.5 — same as posting_date but for the time
        // component. Together they form the as_of_datetime sent to the
        // server.
        if (!frm.doc.item || !frm.doc.default_warehouse) return;
        _ipv_srt_load_defaults(frm);
    },

```

- [ ] **Step 2: Extend `_ipv_srt_fetch_and_load` to forward the date/time**

Find the call inside `_ipv_srt_fetch_and_load` (around line 240):

```javascript
        args: {
            item_code: frm.doc.item,
            warehouse: frm.doc.default_warehouse || null,
        },
```

Replace with:

```javascript
        args: {
            item_code:    frm.doc.item,
            warehouse:    frm.doc.default_warehouse || null,
            posting_date: frm.doc.posting_date || null,
            posting_time: frm.doc.posting_time || null,
        },
```

- [ ] **Step 3: Clear cache so the new JS is served**

```bash
bench --site development.localhost clear-cache 2>&1 | tail -3
bench --site development.localhost clear-website-cache 2>&1 | tail -3
```

- [ ] **Step 4: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/doctype/stock_reconciliation_srt/stock_reconciliation_srt.js
```

---

## Task 5: Final verification — full regression across all 4 test suites

**Files:** (none modified — verification only)

- [ ] **Step 1: Run the new historical-stock suite**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost execute \
  kavach.tests.test_historical_stock.run_all
```

Expected: `=== 4 / 4 passed ===`.

- [ ] **Step 2: Run the gap suite**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

Expected: `=== 8 / 8 passed ===`.

- [ ] **Step 3: Run the Case 1 / Case 2 suite**

```bash
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Expected: `=== 5 / 5 passed ===`.

- [ ] **Step 4: Browser smoke (deferred to user if no browser)**

If user has a browser:
1. Open `/app/stock-reconciliation-srt/new`
2. Pick item + warehouse → batches auto-populate (qty = current)
3. Tick **Edit Posting**
4. Change posting_date to a date in the past where the item had less stock → batches should re-fetch and show smaller numbers
5. Reset posting_date to today → batches refresh again with current values

If no browser: skip — server-side equivalents covered above.

---

## Task 6: Update app + module .md docs

**Files:**
- Modify: `apps/kavach/kavach.md`
- Modify: `apps/kavach/kavach/kavach/kavach.md`

- [ ] **Step 1: Add §15 to the app-root .md**

Find the `## 12. Sync Block — 2026-05-22 (v0.0.4)` heading. Insert the new section IMMEDIATELY BEFORE it:

```markdown
---

## 15. Historical "As-Of Posting Date/Time" Stock Fetch — 2026-05-22 (v0.0.5)

### Spec
`docs/specs/2026-05-22-srt-historical-stock-design.md`

### What was added

- **`api.get_item_defaults(item_code, warehouse=None, posting_date=None, posting_time=None)`** — two new optional kwargs. When both date and time are present AND the resulting timestamp is in the past, the SLE join gains `TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)`. Either missing or future → unbounded (today's behaviour).
- **`api.get_batch_current_state(item_code, batch_no, posting_date=None, posting_time=None)`** — same kwargs and same fallback rule for the manually-add-a-batch flow.
- **Parent total is no longer queried from `tabBin`.** It's recomputed by summing the SLE-bounded batch rows, so `total_current_stock_in_default_uom == Σ batches[].current_stock_in_stock_uom` always.
- **JS form** picks up `posting_date` + `posting_time` change events and forwards them to the API.

### Behaviour

- **Fallback to "now":** when either `posting_date` or `posting_time` is empty OR the as-of timestamp is in the future, the unbounded query runs. Mid-fill state and future-date inputs don't break the form.
- **Historical snapshot scope:** the batch list itself reflects the as-of state. The `HAVING SUM(sbe.qty) > 0.001` clause stays — batches with zero qty at the as-of moment are excluded from the auto-populate. Operator can still add them manually via the batch picker (which is item-scoped, NOT time-bounded).
- **Counted rows are lost when posting_date/posting_time changes** (autopopulate clears + re-creates rows). Consistent with item/warehouse change. No confirm prompt.

### Restricted areas (additional, 2026-05-22 v0.0.5)

- Don't drop the "either field empty → fall back to now" branch in `_as_of_clause`. Mid-fill validate would return empty grids.
- Don't switch the total back to `tabBin`. Bin is "now"; mixing it with SLE-bounded children causes total ≠ Σ children divergence.
- Don't remove the `as_of >= now() → no bound` clamp. Future-dated queries return surprising results.
- Don't add a confirm prompt on posting_date / posting_time change. Spec is silent refresh, matching item/warehouse handlers.
- Don't drop `HAVING SUM(sbe.qty) > 0.001`. Historical-snapshot scope requires the auto-populate list to exclude zero-qty batches at the as-of moment.
- Don't time-bound the `batch_no` Link picker. The picker stays item-scoped so operators can manually add batches not in the auto-populate list.

### Verification

`kavach/tests/test_historical_stock.py` — 4 tests:
- `test_no_posting_filter_returns_current` (backward-compat)
- `test_future_date_falls_back_to_now` (future clamp)
- `test_historical_date_excludes_later_sles` (real time-bound semantics)
- `test_total_matches_child_sum` (invariant: parent == Σ children)

Live result 2026-05-22: 4 / 4 passed. Cross-suite regression: 17/17 across all 4 suites.

---
```

- [ ] **Step 2: Bump the Sync Block heading**

Change `## 12. Sync Block — 2026-05-22 (v0.0.4)` to `## 12. Sync Block — 2026-05-22 (v0.0.5)`.

- [ ] **Step 3: Add a new `LATEST UPDATE 2026-05-22 (v0.0.5)` block to the Sync Block**

Find the existing `LATEST UPDATE 2026-05-22 (v0.0.4)` text block inside §12. ABOVE it, add:

```
LATEST UPDATE 2026-05-22 (v0.0.5)
            + Historical "as-of posting_date/posting_time" stock fetch:
                - api.get_item_defaults + get_batch_current_state gain
                  optional posting_date + posting_time kwargs.
                - SLE join is bounded by
                  TIMESTAMP(posting_date, posting_time) <= TIMESTAMP(%s, %s)
                  when both inputs are present and in the past.
                - Either empty OR future → unbounded (today's behaviour).
                - Parent total is now SUM(bounded SLE rows) — no more
                  tabBin lookup; total == Σ children invariant holds.
                - JS form refetches on posting_date / posting_time change.
                - Verification: tests/test_historical_stock.py (4 tests).
                  4 / 4 passed on dev site. Cross-suite: 17/17.
```

- [ ] **Step 4: Append the historical-fetch paragraph to module .md**

Append at the end of `apps/.../kavach/kavach.md`:

```markdown

---

## Historical "as-of" stock fetch (2026-05-22 v0.0.5)

`api.get_item_defaults` and `api.get_batch_current_state` now accept
optional `posting_date` + `posting_time` kwargs. When both are present
and the resulting timestamp is in the past, the SLE join is bounded so
the returned totals + batch list reflect the historical state at that
moment. Either input missing OR a future timestamp falls back to
unbounded (today's behaviour), keeping mid-fill UX intact.

The JS form picks up `posting_date` + `posting_time` change events and
refetches automatically, so the operator sees the as-of snapshot
update live as they backdate the SRT.

See app-root §15 and spec
`../../docs/specs/2026-05-22-srt-historical-stock-design.md` for the
restricted-areas list and full reasoning.
```

- [ ] **Step 5: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach.md
ls -l apps/kavach/kavach/kavach/kavach.md
```

---

## Task 7: Update Claude memory

**Files:**
- Modify: `~/.claude/projects/-workspace/memory/app_kavach.md`

- [ ] **Step 1: Bump the version in the frontmatter description**

Change `description:` line to:

```yaml
description: "kavach v0.0.5 (2026-05-22) — ERPNext SR wrapper with batch auto-populate, UOM conversion, two-pass rate-mirror, RBAC workflow, Case 1 / Case 2 routing, SRT Settings min-gap gate, workflow-state-aware duplicate-open guard, and historical 'as-of posting_date/posting_time' stock fetch."
```

- [ ] **Step 2: Add item 9 to "What it does"**

After the existing item 8 (SRT Settings min-gap), append:

```markdown
9. **Historical as-of stock fetch (2026-05-22 v0.0.5)** — `api.get_item_defaults` + `api.get_batch_current_state` accept optional `posting_date` + `posting_time` kwargs. SLE join is bounded by `TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)` when both are present and in the past. Either empty OR future → unbounded (mid-fill safe, future clamp). Parent total computed from bounded SLE sum (no more `tabBin`), so `total == Σ children` invariant holds. JS form refetches on `posting_date` / `posting_time` change, mirroring the item/warehouse handlers.
```

- [ ] **Step 3: Add restricted areas**

Append to the existing `## Restricted areas` section:

```markdown
- **Don't drop the "either field empty → fall back to now" branch in `_as_of_clause`** — mid-fill validate would return empty grids and break the form.
- **Don't switch the parent total back to `tabBin`.** Bin is always "now"; SLE-bounded children + Bin total = silent divergence.
- **Don't remove the `as_of >= now() → no bound` clamp.** Future-dated queries return surprising results.
- **Don't add a confirm prompt on posting_date / posting_time change.** Silent refresh matches item/warehouse handler UX.
- **Don't drop `HAVING SUM(sbe.qty) > 0.001`.** Historical-snapshot scope requires the auto-populate list to exclude batches at zero qty at the as-of moment.
- **Don't time-bound the `batch_no` Link picker.** It stays item-scoped so operators can manually add batches not in the auto-populated list.
```

- [ ] **Step 4: Add a Live test entry**

ABOVE the existing `## Live test 2026-05-22 (SRT Settings min-gap, v0.0.3)` heading, add:

```markdown
## Live test 2026-05-22 (Historical as-of fetch, v0.0.5)

4/4 verification tests pass on dev site via:
```
bench --site development.localhost execute \
  kavach.tests.test_historical_stock.run_all
```

Cross-suite regression: 17/17 across all 4 suites (Case 1/2 + gap + duplicate-open bugfix + historical).

```

---

## Task 8: Final cleanup + handoff summary

**Files:** (none — wrap-up)

- [ ] **Step 1: Re-run all 4 test suites one more time**

```bash
cd /workspace/development/frappe-bench
for suite in test_case1_case2 test_srt_settings_gap test_historical_stock; do
  echo "=== $suite ==="
  bench --site development.localhost execute \
    kavach.tests.${suite}.run_all 2>&1 | grep -E "PASS|FAIL|==="
done
```

Expected output (all 3 sections show 100% pass):

```
=== test_case1_case2 ===
=== SRT Case 1 / Case 2 verification (5 tests) ===
  PASS test_case1_happy ...
  ...
=== 5 / 5 passed ===
=== test_srt_settings_gap ===
=== SRT Settings min-gap verification (8 tests) ===
  ...
=== 8 / 8 passed ===
=== test_historical_stock ===
=== SRT historical-stock verification (4 tests) ===
  ...
=== 4 / 4 passed ===
```

- [ ] **Step 2: Verify no stray open test docs**

```bash
bench --site development.localhost mariadb -e \
  "SELECT COUNT(*) AS open_test_docs FROM \`tabStock Reconciliation SRT\` WHERE item='CZMAT/1585' AND docstatus != 2;" 2>&1 | tail -3
```

Expected: `open_test_docs: 0`.

- [ ] **Step 3: Print summary to user**

Files touched: 6 (1 API, 1 JS, 1 test, 2 docs, 1 memory).
Tests: 4/4 historical + 8/8 gap + 5/5 Case 1/2 — **17/17** total.
Behaviour change: `get_item_defaults` + `get_batch_current_state` are now time-aware; SRT form refetches on posting_date / posting_time change.

Ask: anything else? E.g., should the existing `tabBin` reads elsewhere in the app (any?) be migrated too?

---

## Self-Review Log

**Spec coverage:**
- §1 problem → addressed by API time-bounding + JS triggers (Tasks 2–4)
- §2.1 SLE WHERE clause → Task 2 Step 3+4 (exact SQL fragment shown)
- §2.2 fallback to "now" → Task 2 Step 1 (`_as_of_clause` helper returns `("", ())` on missing/future)
- §2.3 `get_batch_current_state` parity → Task 3
- §2.4 JS triggers → Task 4
- §2.5 UX side-effect (counted rows lost) → documented in Task 4 Step 1 comment + Task 6 §15 behaviour section
- §2.6 historical snapshot (HAVING > 0.001 stays) → Task 2 Steps 3+4 show the clause preserved
- §3 behaviour matrix → covered by 4 tests in Task 1
- §4 file inventory → matches Plan's File Structure table
- §5 restricted areas (6 rules) → all 6 land in Task 6 (app .md §15) + Task 7 (memory)
- §6 testing plan (4 tests) → Task 1 (full code shown) + Task 5 (run-all) + Task 8 (final regression)
- §7 out-of-scope → respected (no batch_no picker time-bound, no row-level posting fields, no UI banner)

**Placeholder scan:** No TBDs, no "add appropriate handling", no "similar to" cross-refs. Every code block is concrete.

**Type consistency:** Function name `_as_of_clause` used identically in Task 2 Step 1 (define), Task 2 Steps 3+4 (call from `get_item_defaults`), Task 3 Step 1 (call from `get_batch_current_state`). Param names `posting_date` + `posting_time` consistent across API signatures (Tasks 2.2, 3.1), JS call args (Task 4.2), test fixtures (Task 1), and docs (Tasks 6, 7).

**Edge case verified:** Task 1's test 3 (`test_historical_date_excludes_later_sles`) uses `<=` comparison because the historical total can equal the current total when the item didn't accumulate any new stock in the last 5 years. The invariant holds either way.
