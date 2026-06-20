# Batch Moving Costing vs Origin Analysis — Report (component docs)

**Type:** Script Report  ·  **Module:** Stock Reconciliation Tracking (app: `kavach`)
**Primary DocType (`ref_doctype`):** Batch
**Path:** `kavach/stock_reconciliation_tracking/report/batch_moving_costing_vs_origin_analysis/`
**Open at:** `/app/query-report/Batch Moving Costing vs Origin Analysis`

> Injected prompts/instructions/restrictions live in the file headers
> (`*.py` and `*.js`). This MD is the human-readable companion.

---

## 1. What it answers

> "Take each batch movement, one at a time. Did this batch **keep its origin
> valuation rate**, or did the rate change somewhere in the middle of its life?"

A per-batch **movement ledger**. Every inward or outward movement is its own
row, carrying that movement's warehouse + valuation rate + total, the batch's
**origin** voucher (where it was born + at what rate), and a per-movement
verdict **"Maintains Origin Rate?"**. The "No" rows are exactly where the cost
drifted away from origin — the audit signal the kavach app exists to catch
(typically a mid-life Stock Reconciliation re-rate).

---

## 2. Row grain — a MOVEMENT LEDGER

**One row per (item, batch, voucher, direction).** Each row is a **single
direction** — an INWARD movement *or* an OUTWARD movement, never both. The
opposite direction's columns are left **blank**.

- An ordinary voucher moves a batch one way → **one row**.
- A **Stock Reconciliation** can move the *same* batch both in and out within
  one voucher → **two rows** (one inward with the outward columns blank; one
  outward with the inward columns blank). Verified live: `MAT-RECO-2026-01884`
  on batch `B-CZPFG85-ABH-001` posts +12 and −12 → 2 rows.

A "movement" is any Stock Ledger voucher — Stock Entry, Stock Reconciliation,
Delivery Note, Purchase Receipt, etc. Rows are ordered by item, batch, then
posting time, so you can read a batch's life top-to-bottom and spot where the
rate changed.

---

## 3. Columns

| # | Column | Source |
|---|--------|--------|
| 1 | Item Code | `Stock Ledger Entry.item_code` |
| 2 | Item Name | `Item.item_name` |
| 3 | Stock UOM | `Item.stock_uom` |
| 4 | Stock UOM CF | `1.0` (CF of stock UOM vs itself) |
| 5 | Higher UOM | largest `UOM Conversion Detail.conversion_factor > 1` |
| 6 | Higher UOM CF | that conversion factor |
| 7 | Batch Number | `Serial and Batch Entry.batch_no` |
| 8 | Batch Stock (Stock UOM) | `SUM(sbe.qty)` signed, `posting_date <= to_date` |
| 9 | Inward Warehouse | this movement's `sle.warehouse` — **blank** on outward rows |
| 10 | Outward Warehouse | this movement's `sle.warehouse` — **blank** on inward rows |
| 11 | Inward Val. Rate / Stock UOM | this inward movement's `value / qty` — blank on outward rows |
| 12 | Outward Val. Rate / Stock UOM | this outward movement's `value / qty` — blank on inward rows |
| 13 | Inward Valuation Total | this inward movement's `SUM(ABS(svd))` — blank on outward rows |
| 14 | Outward Valuation Total | this outward movement's `SUM(ABS(svd))` — blank on inward rows |
| 15 | Batch Origin Timestamp | earliest SLE `TIMESTAMP(posting_date, posting_time)`, `dd-mmm-yyyy hh:mm AM/PM` |
| 16 | Batch Origin Voucher No | earliest SLE `voucher_no` (Dynamic Link) |
| 17 | Batch Origin Voucher Type | earliest SLE `voucher_type` |
| 18 | Batch Origin Voucher Purpose | the **real** purpose of the origin doc (e.g. Stock Reconciliation → `Opening Stock`) |
| 19 | Batch Origin Rate / Stock UOM | earliest SLE bundle `incoming_rate` |
| 20 | Inward Voucher No | **this** movement's `voucher_no` (Dynamic Link) — blank on outward rows |
| 21 | Inward Voucher Type | this movement's `voucher_type` — blank on outward rows |
| 22 | Inward Voucher Purpose | this movement's **real** purpose — blank on outward rows |
| 23 | Inward Timestamp | this movement's timestamp `dd-mmm-yyyy hh:mm AM/PM` — blank on outward rows |
| 24 | Outward Voucher No | **this** movement's `voucher_no` (Dynamic Link) — blank on inward rows |
| 25 | Outward Voucher Type | this movement's `voucher_type` — blank on inward rows |
| 26 | Outward Voucher Purpose | this movement's **real** purpose — blank on inward rows |
| 27 | Outward Timestamp | this movement's timestamp — blank on inward rows |
| 28 | **Maintains Origin Rate?** | "Yes" / "No" — see §5 |

> **Single-direction rows.** Each row is one movement, so exactly one side
> (inward *or* outward) of cols 9–14 and 20–27 is filled; the other side is
> blank. The **origin** block (cols 15–19) repeats on every row of a batch (it
> is a batch attribute). Voucher purposes are read from the real document
> (`Manufacture`, `Material Transfer for Manufacture`, `Opening Stock`,
> `Delivery Note`, …). Timestamps are a `Data` column formatted
> `dd-mmm-yyyy hh:mm AM/PM` (e.g. `20-Jun-2026 02:34 PM`) so the format is
> stable regardless of the site's datetime display setting.

---

## 4. The site quirk that drives everything

Same crux as the WO-Consumption report and `api.py`: **batches are tracked 100%
through the Serial and Batch Bundle.** `Stock Ledger Entry.batch_no` is NULL.
Per-batch movement lives in **`Serial and Batch Entry` (sbe)**:

```
sbe.parent                 = sle.serial_and_batch_bundle
sbe.batch_no               = the batch
sbe.qty                    = signed qty in STOCK UOM  (+in / -out)
sbe.stock_value_difference = signed value moved        (+in / -out)
```

**Why value comes from `stock_value_difference` (not `outgoing_rate`):** on this
site `sbe.outgoing_rate` is **always 0** — the per-entry rate sits in
`incoming_rate` for *both* directions, and `stock_value_difference =
qty × incoming_rate` (verified live, e.g. qty −4466 × 6.6289 = svd −29604.67).
Deriving each side's value from `stock_value_difference` and the rate as
`value / qty` is robust regardless of which rate column a site fills.

---

## 5. The verdict — "Maintains Origin Rate?" (col 28)

For **this movement's** rate (whichever side it is), compare against the batch's
**origin** rate using a **0.5% relative** tolerance (`_RATE_TOL` — relative so
it scales across cheap and expensive items):

- **Yes** — origin rate is non-zero AND this movement's rate equals it within
  tolerance: the movement kept the batch's original cost.
- **No** — the rate changed from origin (cost drift), **or** the origin entered
  at rate 0 (a qty-only opening reconciliation) while this movement carries a
  real rate.

Read a batch's rows top-to-bottom (they are time-ordered): a run of **Yes** that
turns into **No** pinpoints the exact movement where the rate changed — usually
a mid-life Stock Reconciliation. The JS `formatter` colours Yes green / No red.
The **Only Origin-Rate Changes** filter restricts to the **No** rows.

---

## 6. UOM handling

`sbe.qty` and `sbe.stock_value_difference` are already in the **stock UOM**, so
no manual conversion is needed. `Stock UOM CF` is `1.0`. The **Higher UOM** is
the item master's **largest** `conversion_factor > 1` (matches
`api._pick_higher_uom`); shown only when one exists.

---

## 7. Date semantics

- **From Date → To Date** bound the **movement window** — which movement rows
  appear (a movement is shown when its `posting_date` is in `[from_date,
  to_date]`).
- **Batch Stock** is the batch's closing balance **as of to_date**
  (`SUM(sbe.qty)` for `posting_date <= to_date`), computed once per batch and
  repeated on each of its rows.
- **Origin** is always the batch's earliest-ever movement (unbounded), so a
  batch's origin shows even when the origin itself is outside the window.

---

## 8. Filters

| Filter | Type | Notes |
|--------|------|-------|
| Company | Link | bounds `sle.company` |
| From Date | Date | lower bound of the movement window (see §7) |
| To Date | Date | upper bound of the movement window; batch-stock "as of" |
| Warehouse | MultiSelectList | scopes movements to those warehouses |
| Item | MultiSelectList (Item) | |
| Item Group | MultiSelectList | applied post-join on the item master |
| Batch | MultiSelectList (Batch) | |
| Only Batches With Current Stock | Check | hide rows whose batch is fully consumed |
| Only Origin-Rate Changes | Check | show only the **No** (rate-changed) rows |

All user values are **bound parameters**; only fixed column names are
concatenated.

---

## 9. Verification (2026-06-20, site `dev.localhost`)

UI runner `frappe.desk.query_report.run`:

- **Single-direction grain + reconciliation split** — batch `B-CZPFG85-ABH-001`
  (window 2026-01-01 → 06-20) returns **4 movement rows**: `MAT-RECO-2026-01883`
  (IN), `MAT-RECO-2026-01884` (IN **and** OUT → two rows), `DN-26-00195` (OUT).
  Every row has the opposite side blank (`otherBlank=True`). ✓ All `Yes`
  (held 268.2347 from origin through every move).
- **Scale + spread** — 20-day window: **28 columns, 3473 movement rows** (2165
  OUT / 1308 IN), voucher types Stock Entry / Stock Reconciliation / Delivery
  Note / Purchase Receipt. Verdict 2060 No / 1413 Yes.
- **A "No" (rate changed)** — `CZ/ITEM-00043` batch `B-...-00001`: movement rate
  0.17514 vs origin 0.17786 on `MAT-STE-04959` (Manufacture). ✓
- Timestamps render `02-Apr-2026 12:00 AM` / `14-May-2026 02:28 PM`.

Re-run:
```bash
bench --site dev.localhost execute \
  kavach.stock_reconciliation_tracking.report.batch_moving_costing_vs_origin_analysis.batch_moving_costing_vs_origin_analysis.execute \
  --kwargs "{'filters': {'from_date':'2026-05-20','to_date':'2026-06-20'}}"
```

---

## 10. Built-in / standard report

Ships in source as a standard report (`is_standard = "Yes"`); Frappe runs it via
`execute_module` (the on-disk `.py`). Registered in
`install.py → _STANDARD_REPORTS` so `after_install` / `after_migrate` re-import
the committed `.json` (which keeps it standard) — see `install.md` § 8 and the
sibling report's §11 for the `is_standard` / `NoneType` background. Frappe Cloud
runs `bench migrate` on deploy, so it installs there with no manual step.

---

## 11. Maintenance rules

1. Keep all qty/value in **stock UOM** from the **Serial and Batch Bundle**;
   never read `Bin` / `Batch.batch_qty`.
2. Value comes from `stock_value_difference`; do not rely on `outgoing_rate`
   (zero on this site).
3. If you add columns, update §3 **and** `get_columns()` in lockstep.
4. After editing the `.json`, re-sync with `bench --site <site> migrate`.
