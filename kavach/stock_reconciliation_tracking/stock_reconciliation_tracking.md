# Stock Reconciliation Tracking — Module Reference

The only module in the kavach app. Contains 6 DocTypes, 1 Page, 2 Reports, 2 API files, and 1 Workspace.

See `apps/kavach/kavach.md` (app-root) for the full architecture, field map, restricted areas, sync block.

## Folder structure

```
stock_reconciliation_tracking/     ← module root (this folder)
├── api.py                         ← whitelisted read-only endpoints (5 methods)
├── api.md                         ← API component docs
├── mobile_api.py                  ← mobile backend bridge (OAuth, stock reports, push, messages)
├── mobile_api.md                  ← mobile API component docs
├── stock_reconciliation_tracking.md ← this file
├── doctype/
│   ├── stock_reconciliation_srt/  ← parent (submittable, workflow-enabled)
│   │   ├── stock_reconciliation_srt.json
│   │   ├── stock_reconciliation_srt.py   ← controller (954 LOC): validate + on_submit + on_cancel
│   │   ├── stock_reconciliation_srt.js   ← form controller
│   │   └── stock_reconciliation_srt.md   ← DocType docs
│   ├── batch_list/                ← child of Stock Reconciliation SRT
│   │   ├── batch_list.json
│   │   ├── batch_list.py          ← stub (logic in parent)
│   │   └── batch_list.md          ← DocType docs
│   ├── srt_settings/              ← Single DocType (gap_days setting)
│   │   ├── srt_settings.json
│   │   ├── srt_settings.py        ← minimal validate (gap_days >= 0)
│   │   ├── srt_settings.js        ← form script
│   │   └── srt_settings.md        ← DocType docs
│   ├── kavach_notification/       ← typed in-app notification (3 categories)
│   │   ├── kavach_notification.json
│   │   ├── kavach_notification.py ← user-targeting validation
│   │   └── kavach_notification.md ← DocType docs
│   ├── kavach_notification_seen/  ← per-user read marker for notifications
│   │   ├── kavach_notification_seen.json
│   │   ├── kavach_notification_seen.py ← stub
│   │   └── kavach_notification_seen.md ← DocType docs
│   └── kavach_push_token/         ← Expo push token per (user, device)
│       ├── kavach_push_token.json
│       ├── kavach_push_token.py   ← stub (owner-scoped)
│       └── kavach_push_token.md   ← DocType docs
├── page/
│   └── srt_dashboard/             ← main operator surface
│       ├── srt_dashboard.json     ← page meta + 4 roles
│       ├── srt_dashboard.py       ← 11 whitelisted server methods (628 LOC)
│       ├── srt_dashboard.js       ← page controller (~2700 LOC)
│       ├── srt_dashboard.html     ← Jinja shell (Tabulator CDN)
│       └── srt_dashboard.md       ← comprehensive page docs
├── report/                        ← Script Reports (read-only analytics)
│   ├── report.md                  ← folder overview
│   ├── work_order_consumption_cost_analysis/
│   │   ├── work_order_consumption_cost_analysis.json  ← Report meta
│   │   ├── work_order_consumption_cost_analysis.py    ← execute() (Script Report)
│   │   ├── work_order_consumption_cost_analysis.js    ← filters + cell rendering
│   │   └── work_order_consumption_cost_analysis.md    ← component docs
│   └── batch_moving_costing_vs_origin_analysis/
│       ├── batch_moving_costing_vs_origin_analysis.json
│       ├── batch_moving_costing_vs_origin_analysis.py ← execute() (Script Report)
│       ├── batch_moving_costing_vs_origin_analysis.js
│       └── batch_moving_costing_vs_origin_analysis.md
└── workspace/
    └── kavach/
        └── kavach.json            ← Kavach workspace (links to SRT, Settings, Dashboard)
```

## Use cases

See `../../kavach.md` § Use cases — three scenarios documented:
1. Monthly bin audit (counter walks the warehouse with a tablet)
2. Backdated cleanup (audit team correcting historical drift)
3. Partial count with deliberate "found zero"

## Dependencies (within the bench)

- `frappe` (framework)
- `erpnext` (the native Stock Reconciliation DocType, Bin, Item, Batch, Serial and Batch Bundle, Stock Ledger Entry)

External memory dependencies:
- `chaizup_audit_site_specifics.md` — custom_remarks mandatory, Stock Adjustment account
- `erpnext_bulk_reconcile_quirks.md` — Quirk #2 silent submit, #6 expense_account, #7 use_serial_batch_fields, #13 batch_no per row

## Reasoning

ERPNext's native Stock Reconciliation form doesn't auto-populate batches and forces the operator to handle UOM math manually. With items having 1000+ batches at chaizup, that's unworkable. This module wraps the SR creation in a friendlier form-with-autopopulate + delegates the actual SLE/GL writes to ERPNext's tested submit pipeline.

## Database connections

Read-only:
- `tabItem`, `tabBin`, `tabUOM Conversion Detail`
- `tabStock Ledger Entry` × `tabSerial and Batch Bundle` × `tabSerial and Batch Entry` (joined for batch totals)
- `tabAccount WHERE account_type='Stock Adjustment'`

Write:
- `tabStock Reconciliation SRT` (this app's parent)
- `tabBatch List` (child)
- `tabStock Reconciliation` + `tabStock Reconciliation Item` (ERPNext, on submit)

## Maintenance rules

When changing logic or schema:
1. Update the field map + restricted areas in `../../kavach.md`
2. Add a sync block entry with the date + change
3. Run a live smoke test against a real batched item BEFORE committing
4. Verify cascade-cancel (SRT cancel → SR cancel → Bin restored)

## Single-warehouse scoping (2026-05-21 spec)

The whole doc operates on **one item × one warehouse** at a time:
- Parent `default_warehouse` (Link Warehouse, reqd=1) is the single scope
- All totals + the batches list are scoped to that warehouse
- Each child row's `warehouse` + `item_code` are READ-ONLY and auto-stamped from parent
- Auto-stamp happens at TWO layers:
  1. **JS** — `batches_add` event fills warehouse / item_code / item_name_selected / stock_uom / select_uom / conversion_factor on every new row
  2. **Server** — `validate()` → `_stamp_child_warehouse_and_item()` covers REST API + fixture import + any non-UI caller. **MUST run AFTER `_mirror_item_name`** so children inherit the name.

API: `get_item_defaults(item_code, warehouse=None)` — passing `warehouse` scopes to that warehouse; omitting it keeps the multi-warehouse aggregate path (legacy back-compat).

## "Module not found" self-heal hook

`install.py` exports `after_install` + `after_migrate` (both wired in `hooks.py`).
Both call `_ensure_site_install_record()` which is idempotent and guarantees
`kavach` is registered in the site's `tabInstalled
Application` table. This is the recovery for the *Module not found* error that
appears after a production backup is restored on top of a dev site that already
has this app's files on disk.

See `../../kavach.md` § 9b for the full root-cause writeup.

Do **not** remove the `after_migrate` wiring — it is the only line of defence
between a restore and a broken desk UI.

---

## Case 1 / Case 2 (2026-05-22)

Validate-time classifier `_classify_zero_delta_ticks` routes the SRT
between two paths:

- **Case 1 — all ticked rows match current stock.** Skips ERPNext SR
  creation. `on_submit()` sets `workflow_state="Approved By System"`,
  fills both `admin_remark` + `super_admin_remark` with the module
  constant `SYSTEM_APPROVE_MESSAGE` (only if empty), stamps both
  `*_approved_by` fields to the Srt Admin who clicked Approve.
- **Case 2 — mixed (some match, some delta).** Matching rows have
  `is_counted` silently set to 0; only real-delta rows go to the SR.

Workflow has a new `Approved By System → Close` transition allowed
to Srt Super Admin, backfilled idempotently by `install.py` on every
`bench migrate`. See app-root doc §11 and spec
`../../docs/specs/2026-05-22-srt-case1-case2-design.md` for the full
restricted-areas list and the rationale.

---

## SRT Settings (2026-05-22 v0.0.3)

Module ships a Single DocType `SRT Settings` (renders at `/app/srt-settings`).
Today's one field: `gap_between_stock_reconciliation_days` (Int, default 0).
When non-zero, the SRT controller's `_enforce_min_gap_between_srts()` helper
blocks creating a new SRT for an item until at least that many days have
passed since the most recent SRT for the same item (`docstatus IN (1, 2)`,
measured against `posting_date`, symmetric via `abs(date_diff)`).

Workspace at `/desk/stock-reconciliation-tracking` exposes SRT Settings via:
- a "Setup" card-break + SRT Settings link in the links list
- a SRT Settings chip in the shortcuts strip

See app-root §13 and spec
`../../docs/specs/2026-05-22-srt-settings-gap-design.md` for restricted-areas
and the full reasoning.

---

## Duplicate-Open Guard fix (2026-05-22 v0.0.4)

`_enforce_no_duplicate_open_srt_for_item` is now workflow-state-aware.
Prior SRTs at `Super Admin Approval` or `Approved By System` (docstatus=1
but reconciliation work IS complete) no longer block creating a new SRT
for the same item. The gap rule (`_enforce_min_gap_between_srts`) still
runs after this check and provides any spacing throttle. See app-root §14
for the bug report, restricted areas, and tests.

---

## Historical "as-of" stock fetch (2026-05-22 v0.0.5)

`api.get_item_defaults` and `api.get_batch_current_state` now accept
optional `posting_date` + `posting_time` kwargs. When both are present
and the resulting timestamp is in the past, the SLE join is bounded so
the returned totals + batch list reflect the historical state at that
moment. Either input missing OR a future timestamp falls back to
unbounded (today's behaviour), keeping mid-fill UX intact.

The JS form picks up `posting_date` + `posting_time` change events and
refetches automatically, so the operator sees the as-of snapshot update
live as they backdate the SRT. The parent total is now computed from
the same SLE-bounded sum (no more `tabBin`) so `total == Σ children`
is an invariant.

See app-root §15 and spec
`../../docs/specs/2026-05-22-srt-historical-stock-design.md` for the
restricted-areas list and full reasoning.

---

## List-view Status deduplication (2026-05-23 v0.0.6)

The `workflow_state` field's `in_list_view` flag has been removed from
the DocType JSON. Frappe's list view auto-renders a colored Status
indicator at the start of each row for workflow-enabled doctypes;
setting `in_list_view=1` on the field caused the Status column to
appear TWICE in the list. The field stays in_standard_filter so users
can still filter by status. See app-root §16 for the bug + restricted
area.

---

## SRT Dashboard (2026-05-23 v0.0.7)

A custom Frappe Page at `/app/srt-dashboard` provides a tabbed (Draft /
Admin Approval / Super Admin Approval) operator review surface for
Stock Reconciliation SRT docs. Features bulk approve from the page
header, a per-row View modal showing batch-level Origin + transaction
summaries, and a per-cell drill-down modal splitting In vs Out movements.

All approve/reject actions dispatch through the existing
`StockReconciliationSRT` controller — no validation is duplicated.
See app-root §17 and spec
`../../docs/specs/2026-05-23-srt-dashboard-design.md` for restricted
areas, API shapes, and the full architectural rationale.

---

## SRT Form (DEPRECATED in v0.0.9, 2026-05-23)

The standalone `/app/srt-form` page has been DELETED in v0.0.9. The form
now lives as a slide-down panel inside the SRT Dashboard, triggered by
the `+ Add SRT` page primary action. The same `doc.save()` / `doc.submit()`
contract holds — validation is still 100% delegated to the DocType
controller. See § "SRT Dashboard v0.0.9" below.

## SRT Dashboard v0.0.9 — Single Source of Truth (2026-05-23)

The SRT Dashboard at `/app/srt-dashboard` is the **only** operator surface
for Stock Reconciliation SRT. All three roles use only this page. Every
action (Create, View, Edit, Approve, Reject, Bulk Approve) lives here.

**Architecture:**
- Tailwind CDN runtime (scoped to this page, preflight disabled)
- "Operator Cockpit" aesthetic: slate-50 / indigo-600 / Inter
- Slide-down form panel (translateY animation, backdrop blur, scroll lock)
- Sticky Tabulator headers via `max-h: calc(100vh - 280px)` containers
- Role-adaptive UI via `frappe.user_roles` (Srt User / Admin / Super Admin)
- Live sync: schema-driven fields (`get_form_meta`) + WebSocket
  (`frappe.realtime.doctype_subscribe`) + optimistic concurrency
  (`modified` timestamp check)
- Sticky bottom bulk-action bar on multi-row select

**Server APIs in `page/srt_dashboard/srt_dashboard.py`** (11 total):
get_dashboard_rows, get_dashboard_counts, get_batch_summary,
get_batch_drilldown, approve_srt, reject_srt, bulk_approve_srt,
get_form_meta, load_srt_form, save_srt_form, submit_srt_form

All save / submit dispatches go through `doc.save()` / `doc.submit()` —
zero validation duplicated. The `Stock Reconciliation SRT` DocType
controller's full validate() chain runs unchanged on every dashboard
interaction.

See app-root §19 for the complete restricted-areas list, test
inventory (10 dashboard tests + 27 cross-suite regression), and full
architectural rationale.

## DocType v0.0.9.26 — Linked SR posting timestamp mirrors SRT (2026-05-25)

Bug: When Srt Super Admin submitted the linked ERPNext SR, the SR's `posting_date` + `posting_time` were stamped at the click time instead of carrying over from the SRT. ERPNext's `TransactionBase.validate_posting_time()` unconditionally rewrites these fields to `now()` unless `set_posting_time = 1` is truthy on the doc. Validate runs on both insert and submit, so even backdated SRT values that survived insert got wiped on the super admin's submit.

Fix: `_create_erpnext_sr_draft` now sets `sr.set_posting_time = 1` before assigning posting_date / posting_time. New regression test `test_sr_posting_mirrors_srt` (in `tests/test_case1_case2.py`) backdates an SRT by 2 days and asserts the linked SR carries the same posting timestamp + the `set_posting_time` guard. 28/28 cross-suite regression (was 27/27).

Audit-trail rationale: backdated SRTs are the canonical use case — operator counts Friday closing, files SRT Monday, expects the ledger to land on Friday. Without `set_posting_time = 1`, every submit silently rewrites the timestamp, breaking the audit trail SRT was built to protect.

## SRT Dashboard v0.0.9.7 → v0.0.9.25 (continuous polish, 2026-05-24)

The dashboard has gone through 19 iterations of polish in a single day's session — see app-root § 26a-e for the full versioned change log and the page-level `page/srt_dashboard/srt_dashboard.md` for the current architecture snapshot.

**Headline changes since v0.0.9:**

- **Tab semantics swap (v0.0.9.17):** 2 tabs, both reflect *who is waiting to act* — "Admin Approval Pending" (Draft docs, Srt Admin acts) + "Super Admin Approval Pending" (Admin-approved docs, Srt Super Admin acts).
- **Controller-owned bulk-select Set (v0.0.9.25):** Tabulator 6.x's `selectableRows: true` was double-firing with our cellClick handler. Switched to `this._selected: Set<doc.name>` — Tabulator selection disabled.
- **View modal with 3 remark cards + editable Text Editor (v0.0.9.21, .25):** Approvers see operator + previous approver notes, then write their own remark before approval. Routed by `workflow_state` per the controller's `_enforce_remark_field_permissions` gates.
- **Reconcile-state pill + row visual treatment in view modal (v0.0.9.22):** Uncounted rows low-light (opacity 0.6); matched (emerald), over (amber), short (rose) rows get left-border + 6% tint so approvers see actionable batches at a glance.
- **Sidebar-aware form panel (v0.0.9.13):** Slide-down panel offsets via `.layout-main`'s `getBoundingClientRect().left` so Frappe's sidebar stays visible across collapsed / full / mobile modes.
- **Material 3 polish + Tailwind removed (v0.0.9.12+):** ~500KB Tailwind CDN runtime replaced with hand-curated utility CSS (~400 lines). Material 3 surface tints, state layers, motion easing.
- **DocType validation parity confirmed:** All 9 controller validate() gates fire through `save_srt_form` → `doc.save()`. Case 1/2 routing fires through `submit_srt_form` → `doc.submit()` → `on_submit`. Zero validation duplicated.

**Page-level docs:** `page/srt_dashboard/srt_dashboard.md` (canonical, sync block at end).
**Cross-suite regression:** 27/27 (Case 1/2 + gap + historical + dashboard) — locked at every iteration.

---

## Report: Work Order Consumption Cost Analysis (2026-06-20)

First Script Report in the module, under `report/`. It explodes each **Work
Order** into every **batch** it consumed in its `Manufacture` Stock Entries and
reports the cost picture per consumed batch — all in **stock UOM** — alongside
the produced FG batch, MRP (Item master + Work Order), planned/actual produced
qty, and each consumed batch's **origin voucher** (Stock Entry / Purchase
Receipt / Stock Reconciliation / Work Order) with its purpose and inward rate.

**Grain:** one row per (Work Order × Manufacture Stock Entry × consumed SE line
× consumed batch).

**Why it lives in kavach:** like the SRT DocType + dashboard, it reads ERPNext
stock data **read-only** through the canonical SLE → Serial and Batch Bundle →
Serial and Batch Entry join (the site quirk where `SLE.batch_no` is always
NULL). It reuses the same batch-origin logic as `srt_dashboard._fetch_origin`
and the higher-UOM heuristic from `api._pick_higher_uom`.

**Integrations:** ERPNext (Work Order, Stock Entry/Detail, Item, Batch, SLE,
Serial and Batch Entry, UOM Conversion Detail) + chaizup_toc custom fields
(`Work Order.custom_mrp`, `Item.custom_mrp`, `Work Order.workflow_state`), each
guarded by `frappe.db.has_column` for cross-app safety.

**Verified** 2026-06-20 on `dev.localhost` (direct `execute` + UI
`query_report.run`). See `report/work_order_consumption_cost_analysis/
work_order_consumption_cost_analysis.md` for the full column map, the site
quirk, origin tracing, filters, and the verification spot-check.

> RESTRICT: keep qty in stock UOM (never `Bin`/`Batch.batch_qty`); keep
> custom-field reads guarded by `has_column`; reports stay read-only.

---

## Report: Batch Moving Costing vs Origin Analysis (2026-06-20)

Second Script Report — a **batch movement ledger**. **One row per (item, batch,
voucher, direction)**: each row is a single INWARD *or* OUTWARD movement (the
other side's columns blank); a Stock Reconciliation that moves a batch both ways
in one voucher = **two rows**. Each row carries that movement's warehouse +
valuation rate + total, the batch's **origin** voucher (timestamp / no / type /
purpose / rate), this movement's voucher (no/type/purpose/timestamp), and a
per-movement verdict **"Maintains Origin Rate?"** (Yes/No) — No = the rate
changed from origin (the kavach audit signal).

**Grain:** one row per (item, batch, voucher, direction). **Surfaced** in the
Kavach workspace (Reports card link + shortcut tile).

**Key data notes:** direction = SIGN of `Serial and Batch Entry.qty` (+in/−out);
value = `SUM(ABS(stock_value_difference))`, **not** `outgoing_rate` (ALWAYS 0 on
this site; rate sits in `incoming_rate`, svd = qty × incoming_rate — verified).
Rows bounded to the [from_date, to_date] movement window; batch stock = closing
balance as of to_date; origin = earliest-ever SLE (`ROW_NUMBER() … rn=1`). Same
SLE → Serial and Batch Bundle join + higher-UOM heuristic as the WO-Consumption
report.

**Columns (28):** item + UOM block, batch stock, inward/outward warehouse +
rate + total (one side blank per row), the **origin** block (timestamp, voucher
no/type/purpose, rate), this movement's inward/outward voucher block
(no/type/purpose + timestamp, `dd-mmm-yyyy hh:mm AM/PM`), and the verdict
**Maintains Origin Rate?** ("Yes"/"No").

**Verified** 2026-06-20 on `dev.localhost`: batch `B-CZPFG85-ABH-001` → 4 rows
incl. reconciliation `MAT-RECO-2026-01884` split into IN + OUT (opposite side
blank); 20-day window → 28 cols, 3473 rows (2165 OUT / 1308 IN; 2060 No / 1413
Yes). See
`report/batch_moving_costing_vs_origin_analysis/batch_moving_costing_vs_origin_analysis.md`.

> RESTRICT: qty/value in stock UOM from the bundle (never `Bin`/`Batch.batch_qty`);
> value stays `stock_value_difference`-based; report read-only.

