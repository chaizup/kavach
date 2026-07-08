# SRT Item Group Summary — Script Report

**Built:** 2026-07-08 (user spec + column screenshot) · **Grain:** one row per
**Item Group** · **ref_doctype:** Stock Reconciliation SRT ·
**Roles:** Srt User/Admin/Super Admin, Stock User/Manager, Accounts Manager,
System Manager · total row ON.

Answers "how far has the stock audit progressed, group by group?" — item
coverage, SRT activity in a window, approval pipeline, and what the group is
worth right now.

## Filters

| Filter | Type | Bounds |
|---|---|---|
| From / To Date | Date (default: last month → today) | **`srt.creation`** — the SRT *created* time (user spec; NOT posting_date) . `to_date` inclusive. |
| Warehouse | MultiSelectList (leaf warehouses) | SRT columns via `srt.default_warehouse`; valuation via `bin.warehouse`. Legacy SRTs with empty warehouse drop out when this is set. |
| Item Group | MultiSelectList | every column |
| All Over Pending | Check (OFF by default) | ON ⇒ **Admin Approval Pending + Super Admin Approved Pending ignore the date window** — the full current backlog, however old the SRT (warehouse/group filters still apply). Every other column stays window-bound. The Excel export's filter-echo row prints "PENDING COLUMNS = ALL-TIME BACKLOG" so a printed sheet can't be misread. |

## Columns & exact semantics

| Column | Counts | Scope |
|---|---|---|
| Item Group | — | link |
| Total / Inactive / Active Items | Item **masters** in the group (disabled=1 / 0 split) | master data — ignores date + warehouse |
| Reconciliation (SRT) Count | **unique items** with ≥1 non-cancelled SRT — ANY stage (draft / admin / super admin / system approved), cancelled excluded. Coverage, not a doc count (user redefinition 2026-07-08) | date window + warehouse |
| Pending SRT Count Items | items **NOT found** in any such SRT record = `active − covered` (the un-audited gap; disabled items excluded — a disabled item can't be counted) | date window + warehouse |
| System Approved (Matched) | SRT docs at `Approved By System` (Case 1 — all counted batches matched, no SR) | date window + warehouse |
| Admin Approval Pending | SRT **drafts** (docstatus 0) — the admin hasn't approved yet | date window + warehouse |
| Super Admin Approved Pending | SRT docs the admin HAS approved (docstatus 1 at `Admin Approval` / blank state) — super admin still pending | date window + warehouse |
| Total Stock Valuation | `SUM(Bin.stock_value)` of the group's items | **current snapshot**, warehouse-scoped, ignores dates |
| Super Admin Approved Count | SRT docs at `Super Admin Approval` — the super admin HAS approved (SR posted). Last column (added on user request 2026-07-08) | date window + warehouse |

**Two different units — deliberate:** the four stage columns (Admin Approval
Pending / Super Admin Approved Pending / System Approved / Super Admin
Approved Count) count **documents** and sum to the group's total
non-cancelled SRT docs in the window; `Reconciliation (SRT) Count` and
`Pending SRT Count Items` count **items** (coverage: counted vs not-yet-
counted). Docs ≠ items whenever an item was counted more than once (live
example: Finished Goods 191 docs but 187 unique items). And per group:
`Reconciliation (SRT) Count`(active portion) + `Pending SRT Count Items`
= `Active Items Count`.

**The pending predicate is docstatus-FIRST** (identical to
`custom_erp_validation/overrides/srt_freeze.py` — keep in lock-step):
`docstatus = 0 OR (docstatus = 1 AND workflow_state ∈ {'Admin Approval', NULL, ''})`.
NULL-state submitted docs count as pending (fail-pending, same safety
direction as the freeze).

**Disjoint stages (user correction 2026-07-08):** `Admin Approval Pending`
(drafts) and `Super Admin Approved Pending` (admin-approved, awaiting super
admin) never count the same doc — each SRT sits in exactly one stage.
Their sum = the full waiting pipeline, which is exactly what
`Pending SRT Count Items` uses (distinct items across BOTH stages).

**Bin at item level is fine here.** The site's "never read Bin" quirk is
about BATCH-level numbers (those live only in the SABB ledger). Item ×
warehouse `stock_value` is exactly what Bin is authoritative for.

**Valuation is now, not as-of.** Rewinding valuation to `to_date` needs an
as-of SLE walk (like the WO consumption report does) — out of scope per spec;
extend `get_data` step 3 if ever requested.

## Excel export — "Excel (Formatted)" inner button (2026-07-08)

Frappe's stock Menu > Export drops all styling, so the report ships its own
`export_xlsx` whitelisted endpoint (house pattern cloned from chaizup_toc's
Purchase Batches Report): re-runs `execute()` with the **current filter
values** (`report.get_values()` via `open_url_post`) and streams a styled
workbook — title + filter-echo rows, navy `#0F172A` header band (white bold,
wrapped, 30px), zebra `#F1F5F9` data rows, **amber bold on non-zero pending
cells**, `#,##0` / `#,##0.00` number formats, bold navy-bordered **TOTAL row
computed in Python** (execute() never returns a total row — the UI total
comes from `add_total_row=1`), `freeze_panes` below the header, autofilter.
Filename carries the date window. openpyxl imports stay inside the function
(report hot path pays nothing). Verified 2026-07-08: bytes reopen clean
(navy 0F172A header, frozen A5, TOTAL 1960 items / 323 SRTs) and the UI
button POST returns 200 with the binary.

## Files

`srt_item_group_summary.py` (execute + export_xlsx — header carries the full
decision log) · `.js` (filters + Excel (Formatted) button) · `.json` (Report
doc, add_total_row=1) · this `.md`.
