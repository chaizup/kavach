# Work Order Consumption Cost Analysis — Report (component docs)

**Type:** Script Report  ·  **Module:** Stock Reconciliation Tracking (app: `kavach`)
**Primary DocType (`ref_doctype`):** Work Order
**Path:** `kavach/stock_reconciliation_tracking/report/work_order_consumption_cost_analysis/`
**Open at:** `/app/query-report/Work Order Consumption Cost Analysis`

> Injected prompts/instructions/restrictions live in the file headers
> (`*.py` and `*.js`). This MD is the human-readable companion.

---

## 1. What it answers

> "For each Work Order, exactly which **batches** of which materials did it
> burn, **how much** (in stock UOM), at **what valuation**, and **where did
> each consumed batch originally come from**?"

It is a manufacturing **cost + traceability** report. One screen ties together:

- the **Work Order** (id, created date, status `Doc : Workflow`, planned/actual produced qty, MRP)
- the **produced** item & its FG **batch** + valuation rate
- every **consumed** material **batch** with qty (stock UOM), batch valuation
  rate as of the manufacture date, and total consumed value
- the **origin** of each consumed batch — the voucher that first brought that
  batch into stock (Stock Entry / Purchase Receipt / Stock Reconciliation /
  Work Order) with its number, purpose and inward rate.

This gives **multi-level traceability**: when a consumed batch is itself a
semi-finished good, its origin points at the earlier Manufacture Stock Entry
that produced it — you can walk the chain backwards.

---

## 2. Row grain (important)

**One row = one consumed batch line.**

```
Work Order
  └── Manufacture Stock Entry (purpose = "Manufacture", docstatus = 1)
        ├── finished-good row  ──► produced batch + produced valuation rate
        └── consumed rows (raw materials)
              └── each exploded into its consumed BATCHES
                    └──►  ONE REPORT ROW each
```

Work-Order and produced-batch columns **repeat** down the consumed batches of
the same Stock Entry. A Work Order with several partial-manufacture entries
appears once per (entry × consumed batch).

---

## 3. Columns (in requirement order)

| # | Column | Source |
|---|--------|--------|
| 1 | WO Created Date | `Work Order.creation` |
| 2 | Work Order | `Stock Entry.work_order` → `Work Order.name` |
| 3 | WO Status (Doc : Workflow) | `Work Order.status` + `Work Order.workflow_state` |
| 4 | Produced Batch | finished SE row → bundle batch |
| 5 | Item MRP (Master) | `Item.custom_mrp` of the production item *(chaizup_toc)* |
| 6 | MRP (Work Order) | `Work Order.custom_mrp` *(chaizup_toc)* |
| 7 | Produced Val. Rate / Stock UOM | finished SE row `valuation_rate` |
| 8 | Item to be Produced | `Work Order.production_item` |
| 9 | Produced Item Name | `Item.item_name` |
| 10 | Stock UOM (Produced) | `Item.stock_uom` |
| 11 | Stock UOM CF (Produced) | `1.0` (CF of stock UOM vs itself) |
| 12 | Planned Produced (Stock UOM) | `Work Order.qty` |
| 13 | Actual Produced (Stock UOM) | `Work Order.produced_qty` |
| 14 | Higher UOM (Produced) | largest `UOM Conversion Detail.conversion_factor > 1` |
| 15 | Higher UOM CF (Produced) | that conversion factor |
| 16 | Consumed Item | `Stock Entry Detail.item_code` |
| 17 | Consumed Item Name | `Stock Entry Detail.item_name` |
| 18 | Consumed Item Group | `Item.item_group` |
| 19 | Consumed Stock UOM | `Stock Entry Detail.stock_uom` |
| 20 | Consumed Stock UOM CF | `1.0` |
| 21 | Consumed Batch | bundle entry `batch_no` (legacy: `Stock Entry Detail.batch_no`) |
| 22 | Batch Val. Rate / Stock UOM (@ SE date) | bundle `outgoing_rate` (fallback SE line `valuation_rate`) |
| 23 | Qty Consumed (Stock UOM) | `ABS(bundle qty)` (legacy: `transfer_qty`) |
| 24 | Total Consumed Valuation | `ABS(bundle stock_value_difference)` (fallback qty×rate) |
| 25 | Batch Origin Type | earliest SLE `voucher_type` (raw DocType; also the Dynamic Link target for col 26) |
| 26 | Origin Voucher No | earliest SLE `voucher_no` (Dynamic Link → col 25) |
| 27 | Origin Voucher Type | friendly/normalised category: Stock Entry / Purchase Receipt / Work Order / **Reconciliation** |
| 28 | Origin Voucher Purpose | the **real** purpose of the origin doc — Stock Entry.`purpose` / Stock Reconciliation.`purpose` (e.g. `Opening Stock`); PR → "Purchase Receipt" |
| 29 | Origin Rate / Stock UOM | earliest SLE bundle `incoming_rate` |
| 30 | Consumed Higher UOM | largest CF>1 for the consumed item |
| 31 | Consumed Higher UOM CF | that conversion factor |
| 32 | Manufacture Stock Entry | `Stock Entry.name` (provenance drill-down) |
| 33 | Manufacture Posting Date | `Stock Entry.posting_date` |

---

## 4. The site quirk that drives everything

On this site **batches are tracked 100% through the Serial and Batch Bundle.**
`Stock Ledger Entry.batch_no` and `Stock Entry Detail.batch_no` are NULL. The
real per-batch numbers live in **`Serial and Batch Entry` (sbe)**, the bundle's
child:

```
sbe.parent        = <doc>.serial_and_batch_bundle
sbe.batch_no      = the batch
sbe.qty           = signed qty in STOCK UOM  (+in / -out)
sbe.incoming_rate = inward rate / stock UOM  (used for ORIGIN rate)
sbe.outgoing_rate = outward rate / stock UOM (used for CONSUMPTION rate)
sbe.stock_value_difference = exact value moved (used for total valuation)
```

So a single consumed line is **LEFT JOIN**ed to its bundle entries → one report
row per consumed batch. A legacy fallback to `Stock Entry Detail.batch_no` +
`.transfer_qty` covers pre-bundle rows and non-batched items.

This is the same crux documented in chaizup_toc's *Batch-wise Stock Balance*
report and kavach's `api.py`. **Never read `Batch.batch_qty` or `Bin` for
batch qty — they are materialised views that drift.**

---

## 5. UOM handling (per the requirement)

Every qty is reported in the **stock UOM** with no manual conversion needed:

- bundle `sbe.qty` is **already** stock UOM,
- `Stock Entry Detail.transfer_qty` (= `qty × conversion_factor`) is **also**
  stock UOM,
- `Work Order.qty` / `produced_qty` are **already** in the production item's
  stock UOM.

`*_stock_uom_cf` columns are `1.0` (a stock UOM's conversion factor against
itself is always 1). The **higher UOM** is the item master's **largest**
`conversion_factor > 1` (the biggest packaging unit, e.g. Kg over Gram, CFC
over Pcs) — matching kavach `api._pick_higher_uom`. Shown only when one exists.

---

## 6. Batch origin tracing

Origin = the **earliest** Stock Ledger Entry for the `(item, batch)` pair
(`ORDER BY posting_date, posting_time, creation`), resolved through the SABB
join, picked with `ROW_NUMBER() OVER (PARTITION BY item, batch ...)`. From that
one row we read `voucher_type` / `voucher_no` / `incoming_rate`. This mirrors
`srt_dashboard._fetch_origin`.

Three columns describe the origin voucher, on purpose kept distinct:

- **Batch Origin Type** (col 25) — the raw `voucher_type` (e.g. `Stock
  Reconciliation`). This is the **Dynamic Link target** for *Origin Voucher No*,
  so it must hold the real DocType name — don't "prettify" it.
- **Origin Voucher Type** (col 27) — a **friendly/normalised** label per the
  requirement's four terms (`Stock Entry` / `Purchase Receipt` / `Work Order` /
  `Reconciliation`), via `_origin_type_label`.
- **Origin Voucher Purpose** (col 28) — the **real `purpose` of the origin
  document**: `Stock Entry.purpose` (Manufacture / Material Receipt / …) or
  `Stock Reconciliation.purpose` (`Opening Stock` / `Stock Reconciliation`),
  via `_origin_purpose` (two batched lookups). Purchase Receipt has no purpose
  field → labelled "Purchase Receipt".

> Example (live): origin type **Reconciliation**, voucher `MAT-RECO-2026-01851`,
> purpose **Opening Stock**, rate 0.07 — an opening-stock batch consumed in
> manufacture.

> A consumed semi-finished batch will show origin type **Stock Entry** /
> purpose **Manufacture** — the earlier manufacture that produced it. That's
> the multi-level traceability working as intended.

---

## 7. Filters

| Filter | Type | Notes |
|--------|------|-------|
| Company | Link | optional; defaults to user default |
| From / To Date | Date | bounds the **Manufacture Stock Entry posting_date** (consumption window), **not** WO creation |
| Work Order | MultiSelectList | |
| Item to be Produced | MultiSelectList (Item) | |
| Consumed Item | MultiSelectList (Item) | |
| Consumed Item Group | MultiSelectList (Item Group) | resolved via Item master |
| Work Order Status | Select | the WO `status` field |

All user values are **bound parameters**; only fixed column-name fragments are
concatenated into SQL.

---

## 8. ERPNext / chaizup_toc integration

- **ERPNext (read-only):** Work Order, Stock Entry, Stock Entry Detail, Item,
  Batch, UOM Conversion Detail, Stock Ledger Entry, Serial and Batch Entry.
- **chaizup_toc custom fields:** `Work Order.custom_mrp`, `Item.custom_mrp`,
  `Work Order.workflow_state`. Each is read **defensively** via
  `frappe.db.has_column(...)` so the report still runs where chaizup_toc (or its
  fixtures) is absent — those columns just come back empty.

---

## 9. Verification (done 2026-06-20, site `dev.localhost`)

- `execute()` direct call: returns 32 columns + thousands of rows over a year.
- UI runner `frappe.desk.query_report.run`: 127 rows on a 10-day window, clean.
- Spot-check `MFG-WO-2026-00686`:
  - status `Completed : Taken In Production` (doc + workflow both resolve)
  - consumed batch `691D38E` (a SFG) → qty `3960 Gram`, rate `0.154`,
    total `611.27` (= 3960 × 0.154 ✓)
  - origin `Stock Entry MAT-STE-04846`, purpose `Manufacture`, origin rate
    `0.137` — the earlier manufacture that produced the SFG batch.
- Origin types observed: Stock Reconciliation, Purchase Receipt, Stock Entry.

Re-run after schema changes:
```bash
bench --site dev.localhost execute \
  kavach.stock_reconciliation_tracking.report.work_order_consumption_cost_analysis.work_order_consumption_cost_analysis.execute \
  --kwargs "{'filters': {'from_date':'2026-06-10','to_date':'2026-06-20'}}"
```

---

## 10. Maintenance rules

1. Keep all qty in **stock UOM**; never reintroduce a `Bin`/`Batch.batch_qty`
   read for batch quantities.
2. Keep custom-field reads guarded by `has_column` (cross-app safety).
3. If you add columns, update §3 above **and** the `get_columns()` list — they
   must stay in lockstep.
4. After editing the `.json` metadata, re-sync with
   `bench --site <site> migrate` (or `import_file_by_path` for just this file).

## 11. Built-in / standard report (must stay `is_standard = "Yes"`)

This is a **built-in report shipped with kavach's source code** — its `execute()`
lives in the on-disk `.py` and Frappe runs it via the `execute_module` path. The
`tabReport` row **must** have `is_standard = "Yes"`.

If the row is ever left as `is_standard = "No"` with an empty `report_script`
(a stale row from a prod backup restore, or a record opened/created in desk
without a disk sync), the report crashes with:

> `TypeError: Not allowed source type: "NoneType".`
> (Frappe takes the inline-script path `safe_exec(report_script, …)` and
> `report_script` is `NULL`.)

This is **self-healed** on every `bench migrate` by
`kavach/install.py → _ensure_standard_reports()` (after_migrate), which forces
`is_standard = "Yes"`. To fix on the spot without a full migrate:

```bash
bench --site <site> execute kavach.install._ensure_standard_reports
# or
bench --site <site> reload-doc kavach report work_order_consumption_cost_analysis
```
