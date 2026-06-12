# api.py — Whitelisted Read-Only API

**Module:** Stock Reconciliation Tracking
**File:** `kavach/stock_reconciliation_tracking/api.py`

---

## 1. Purpose

Single source of truth for batch autopopulate data. When the SRT form (dashboard or mobile) user picks an item + warehouse, `get_item_defaults` returns ALL data needed to populate parent fields + the batches child table in **one round-trip**.

This API is strictly **read-only**. All mutations go through the SRT DocType's lifecycle (validate, on_submit).

## 2. Endpoints

| Method | Auth | Purpose |
|---|---|---|
| `get_item_defaults(item_code, warehouse?, posting_date?, posting_time?)` | login | Full batch autopopulate: item meta, UOM ladder, warehouse-scoped batch list from SLE, totals. Supports historical "as-of" when posting_date+time are in the past. |
| `get_item_uoms(item_code)` | login | List of UOMs configured on the item master (stock UOM + UOM Conversion Detail). Powers the `select_uom` dropdown. |
| `get_item_uoms_for_link(doctype, txt, searchfield, start, page_len, filters)` | login | Frappe Link-query-compatible variant of `get_item_uoms`. Used by the Batch List grid's `select_uom` set_query. |
| `get_uom_conversion(item_code, uom)` | login | Returns `conversion_factor` for (item, uom) pair. Called when user changes `select_uom` on a child row. |
| `get_batch_current_state(item_code, batch_no, posting_date?, posting_time?)` | login | For manually-added batch rows: returns stock qty + warehouse + rate. Picks the largest-qty warehouse. Supports as-of. |

## 3. Data sources

- **Batch list:** SLE → Serial and Batch Entry join (NOT `Batch.batch_qty`, which can drift). Only positive-balance tuples (`HAVING SUM(sbe.qty) > 0.001`).
- **UOM:** Item master stock_uom + `tabUOM Conversion Detail` (ordered by CF desc).
- **Valuation rate:** `MAX(sle.valuation_rate)` per (batch, warehouse) — NOT Bin.valuation_rate. The two-pass rate-mirror in the controller ensures the ERPNext SR doesn't drift rates.

## 4. Historical "as-of" mode (v0.0.5)

When `posting_date` + `posting_time` are passed and the resulting timestamp is in the past, `_as_of_clause()` adds `AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)` to the SLE join. This bounds totals + batch list to reflect the historical state at that moment. Either input missing OR a future timestamp falls back to unbounded (current state).

## 5. Internal helpers

| Helper | Purpose |
|---|---|
| `_as_of_clause(posting_date, posting_time)` | Builds SQL WHERE fragment + params for historical bounding. Returns `("", ())` when no bound applies. |
| `_pick_higher_uom(item_code, stock_uom)` | Returns the item's largest-CF non-stock UOM. Falls back to (stock_uom, 1.0). |

## 6. RESTRICT

<!-- RESTRICT: Read-only. All mutations go through the SRT DocType lifecycle. -->
- Do NOT add write endpoints here — all mutations go through the SRT DocType's lifecycle
- Do NOT remove the `_as_of_clause` "either empty → no bound" fallback — mid-fill state (validate firing before posting_date is set) would return empty grids
- Bin qty is the source of truth for "current"; batch balances come from SLE (never `Batch.batch_qty`)
- Do NOT switch back to Bin.valuation_rate for per-batch rates — that reintroduces rate-drift (see CRITICAL comment in source, 2026-05-21 fix)

## 7. Dependencies

- **Stock Reconciliation SRT form (JS + dashboard):** primary consumer
- **mobile_api.py:** mobile app also calls these endpoints for SRT counting
- **SLE + Serial and Batch Entry:** canonical batch stock source
- **Item + UOM Conversion Detail:** UOM ladder
