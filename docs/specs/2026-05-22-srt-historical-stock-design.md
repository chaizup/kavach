# SRT — Historical "As-Of Posting Date/Time" Stock Fetch

**Date:** 2026-05-22
**App:** `kavach`
**Modified DocType:** `Stock Reconciliation SRT` (no schema change)
**Modified API:** `kavach.api.get_item_defaults`, `…api.get_batch_current_state`
**Status:** Approved — ready for implementation plan

---

## 1. Problem

Today `get_item_defaults` queries `tabBin.actual_qty` for totals and aggregates `tabStock Ledger Entry` for batch rows **without any timestamp bound** — both reflect the LATEST state. When an operator backdates `posting_date` / `posting_time` (e.g., to fix a historical drift), the form still shows today's stock, not the stock as it existed at that posting timestamp. This forces the operator to compute deltas against the wrong reference and breaks the audit trail.

User spec (2026-05-22):

> Always update current stock as per Item, Warehouse, Posting Date and Posting Time. If user changes item, warehouse, posting_date or posting_time, the form must re-fetch data for the chosen state.

## 2. Architecture

### 2.1 Time-bound the SLE aggregation

`get_item_defaults` accepts two new optional kwargs: `posting_date` and `posting_time`. They feed a single `as_of_datetime` filter on the SLE join:

```sql
AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)
```

Both queries (warehouse-scoped + legacy aggregate) get the same clause. The total (`total_current_stock_in_default_uom`) is no longer queried from `tabBin` — it's computed by aggregating the bounded SLE rows so parent and children always agree.

### 2.2 Fallback to "now"

When EITHER `posting_date` is empty OR `posting_time` is empty OR the computed `as_of_datetime` is in the future, the API falls back to unbounded queries (same as today's behaviour). Rationale:

- **Mid-fill state**: validate fires before user has set posting_date — empty as-of would return empty grids
- **Future-dated queries**: no ledger entries exist beyond `now()`; clamping to now is the safe default

The fallback is silent — no warning, no error.

### 2.3 `get_batch_current_state` parity

The companion API `get_batch_current_state(item_code, batch_no)` (used when operator manually adds a batch not in the auto-populated list) gains the same `posting_date` + `posting_time` kwargs and applies the same fallback rule. Keeps the manually-added row's stock figure consistent with the auto-populated grid.

### 2.4 JS form triggers

Two new field-level handlers in `stock_reconciliation_srt.js`:

```js
posting_date(frm) {
    if (!frm.doc.item || !frm.doc.default_warehouse) return;
    _ipv_srt_load_defaults(frm);
},
posting_time(frm) {
    if (!frm.doc.item || !frm.doc.default_warehouse) return;
    _ipv_srt_load_defaults(frm);
},
```

`_ipv_srt_fetch_and_load` extended to forward two new params to the whitelisted method:

```js
args: {
    item_code: frm.doc.item,
    warehouse: frm.doc.default_warehouse || null,
    posting_date: frm.doc.posting_date || null,
    posting_time: frm.doc.posting_time || null,
},
```

Existing item/warehouse handlers are unchanged — they already call `_ipv_srt_load_defaults`, which now forwards the date/time.

### 2.5 UX side-effect: "counted rows are lost on date/time change"

The existing autopopulate clears the batches table and re-creates rows. This already happens on item/warehouse change without a confirm prompt (per the 2026-05-21 spec). Extending this to posting_date/posting_time means: if an operator types qty_found, then changes the date, their counts are lost. Consistent with existing UX — no confirm prompt added.

### 2.6 Historical snapshot scope

Per the brainstorming decision, the batches LIST itself reflects the as-of state — `HAVING SUM(sbe.qty) > 0.001` stays. A batch that didn't exist (or had 0 qty) at the posting time is NOT in the auto-populated list. The operator can still manually add it via the `batch_no` picker (which is filtered to the parent item's batches, not time-bounded — manually adding lets them note "this batch should have been counted but wasn't").

## 3. Behaviour matrix

| Input | Behaviour |
|---|---|
| posting_date + posting_time both set, in the past | SLE-bounded historical snapshot |
| posting_date set, posting_time empty | Fall back to "now" (unbounded) |
| posting_date empty, posting_time set | Fall back to "now" (unbounded) |
| posting_date + posting_time both empty | Fall back to "now" (unbounded) |
| posting_date in the future | Fall back to "now" (unbounded) |
| posting_date set to a date with no SLEs yet for the item | Empty batches list (correct — nothing existed then) |
| posting_date/time change while in Draft (docstatus=0) | Batches reload from API; counted rows lost (same as item/warehouse change) |
| posting_date/time change on submitted doc | No-op — fields are read-only on submit; `_ipv_srt_load_defaults` early-returns when docstatus !== 0 |

## 4. Files touched

| File | Action |
|---|---|
| `api.py` | Modify — `get_item_defaults` + `get_batch_current_state` new kwargs; SLE WHERE clause; replace `tabBin` total with SLE-aggregated total |
| `stock_reconciliation_srt.js` | Modify — add `posting_date` + `posting_time` form handlers; extend `_ipv_srt_fetch_and_load` call args |
| `tests/test_historical_stock.py` | Create — 4 assertion-based tests + `run_all()` |
| `kavach.md` (app root) | Modify — new §15 + Sync Block to v0.0.5 |
| `kavach/kavach/kavach.md` (module) | Modify — append paragraph |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | Modify — bump version to v0.0.5; add restricted areas |

## 5. Restricted areas (post-implementation)

- **Don't drop the "either field empty → fall back to now" fallback.** Mid-fill state would return empty grids and the user sees a broken form.
- **Don't switch the total back to `tabBin`.** Bin is always "now"; mixing a Bin total with SLE-bounded children would create silent total ≠ Σ children divergence.
- **Don't remove the `as_of > now → clamp to now` rule.** Future-dated queries return surprising results; clamping is safe.
- **Don't add a confirm prompt on posting_date/posting_time change.** Spec is "always show as per chosen data" — silent refresh matches that intent.
- **Don't drop the `HAVING SUM(sbe.qty) > 0.001` filter.** Spec is historical snapshot — batches at zero qty at the as-of moment shouldn't appear in the auto-populated list. Operator can still manually add via the batch picker.
- **Don't time-bound the `batch_no` Link picker.** The picker stays item-scoped (NOT time-bounded) so operators can manually add batches that don't auto-populate (e.g., for backdated reconciliation where the auto-populate list intentionally excludes the batch).

## 6. Testing plan

`tests/test_historical_stock.py` — 4 tests (runnable via `bench --site … execute kavach.tests.test_historical_stock.run_all`):

1. **test_no_posting_filter_returns_current** — call `get_item_defaults(item, warehouse)` (omit date/time) and assert the result matches an SLE-unbounded query. Confirms backward compatibility.
2. **test_future_date_falls_back_to_now** — call with posting_date = today + 1 year. Result must equal the no-filter result (current state).
3. **test_historical_date_excludes_later_sles** — insert a Stock Entry creating qty for the test batch AT a known timestamp T. Call `get_item_defaults` with posting_date set BEFORE T. Assert the returned batches list does NOT include qty contributions from that Stock Entry. Cleanup: cancel the Stock Entry.
4. **test_total_matches_child_sum** — call with a real historical date that has multiple batches. Assert `total_current_stock_in_default_uom == sum(b["current_stock_in_stock_uom"] for b in batches)` within 0.001 epsilon.

All tests use the same `_pick_warehouse` / `_cleanup_open_srt_for_item` shared fixtures.

## 7. Out of scope

- Time-bounding the `batch_no` Link picker (operator should retain the ability to manually add any batch, even one not in the auto-populated list).
- Time-bounding the valuation_rate snapshot. The current `MAX(sle.valuation_rate)` per-batch logic stays — operators don't see the rate, and the two-pass rate-mirror on submit handles the actual ERPNext SR rate independently.
- Adding a posting_date+time field on individual batch rows (rows inherit from the parent's as-of).
- UI indicator showing "this is historical state" — the posting_date/posting_time fields on the form already make this visible.
- Auto-refresh when a new SLE lands while the user has the form open (would require websocket events — out of scope).

## 8. References

- App memory: `~/.claude/projects/-workspace/memory/app_kavach.md`
- ERPNext stock-utility reference: `apps/erpnext/erpnext/stock/utils.py:get_stock_balance` (pattern reference; we roll our own SQL to keep the SABB join in one place)
- Existing SLE query in `api.py:get_item_defaults` lines 105–145
- Prior spec for context: `docs/specs/2026-05-22-srt-settings-gap-design.md`
