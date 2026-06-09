# SRT Dashboard — Custom Frappe Page

**Date:** 2026-05-23
**App:** `kavach`
**New Page:** `srt-dashboard` (Frappe Page DocType)
**Status:** Approved — ready for implementation plan

---

## 1. Problem

The native DocType list view + form for **Stock Reconciliation SRT** is the system of record but offers limited UX control:

- No tabbed segmentation by workflow state — operators must filter manually
- No batch-level pre-approval drill-down — operators have to open each doc, scroll the batches grid, mentally compute "what happened to each batch between origin and now"
- No bulk approval — must approve one-by-one
- No comparison view of In vs Out movements for a batch in a given window

Operators reviewing many SRTs daily lose time clicking through forms and squinting at numbers. The DocType form stays canonical (all validations live there) — this dashboard is a richer UX layer that READS from + dispatches actions TO that DocType.

User spec (2026-05-23):

> Create a Page named SRT Dashboard. Three tabs (Draft | Admin Approval | Super Admin Approval). Table with item, warehouse, totals (both UOMs), posting date, user remark, action. Bulk approve. View modal per row with batch-level Origin, transaction summaries (Origin→Posting, Last SR→Posting), and Approve/Reject buttons. Click a transaction cell → drill-down modal with In on right, Out on left.

## 2. Architecture

### 2.1 Page shell (Frappe-native)

Standard Frappe Page convention — matches sibling pages `chaizup_toc:item_shortage_dashboard` and `yoddha:yoddha_dev_dashboard`. 5 files at:

```
kavach/kavach/page/srt_dashboard/
├── __init__.py                 (empty marker)
├── srt_dashboard.json          (Page meta + role gating)
├── srt_dashboard.py            (6 whitelisted methods + helpers)
├── srt_dashboard.js            (page controller — tabs, grid, modals)
├── srt_dashboard.html          (minimal Jinja shell — containers)
└── srt_dashboard.md            (in-app dev doc)
```

**Page meta** (`srt_dashboard.json`):

```json
{
  "doctype": "Page",
  "name": "srt-dashboard",
  "page_name": "srt-dashboard",
  "title": "SRT Dashboard",
  "module": "Stock Reconciliation Tracking",
  "standard": "Yes",
  "roles": [
    {"role": "System Manager"},
    {"role": "Srt Super Admin"},
    {"role": "Srt Admin"},
    {"role": "Srt User"}
  ]
}
```

Per-action role enforcement is server-side (see § 2.5). Page-level role is "can view"; not "can approve".

Header layout: `frappe.ui.Page` shell — title + tab strip rendered as `<ul class="nav nav-tabs">` (native Frappe class so no custom CSS dependency). Right side: bulk-approve button that appears only when ≥1 row is checked.

### 2.2 Tab strip + main grid

3 tabs, each with a workflow_state filter:

| Tab | Filter |
|---|---|
| **Draft** | `docstatus=0` |
| **Admin Approval** | `docstatus=1 AND workflow_state='Admin Approval'` |
| **Super Admin Approval** | `docstatus=1 AND workflow_state='Super Admin Approval'` |

Approved-By-System and Close (docstatus=2) docs intentionally don't appear — they're terminal.

Grid library: **Tabulator** (already loaded by the sibling chaizup_toc dashboards on this site). Columns:

| # | Column | Source | Notes |
|---|---|---|---|
| 1 | ☐ (checkbox) | row selector | Native Tabulator selector |
| 2 | Item (with code) | `f"{item_name}  •  {item}"` | Text-wrap on |
| 3 | Warehouse | `default_warehouse` | |
| 4 | Stock Found | `total_qty_found_in_default_uom` / `total_qty_found_in_higher_uom` | Two-line cell: `1234 g` (bold) + `1.234 Kg` (muted, smaller) |
| 5 | Stock as on Posting | `total_current_stock_in_default_uom` / `total_current_stock_in_higher_uom` | Same two-line format |
| 6 | Posting Date | `posting_date` + `posting_time` | Formatted `22-May-2026 04:30 PM` |
| 7 | User Remark | `user_remark` | Stripped HTML, truncated 80 chars + tooltip on full text |
| 8 | Action | "View" button | Opens View modal (§ 2.3) |

Bulk-approve button in the page header appears when ≥1 row is checked. Calls `bulk_approve_srt` with the selected `name` list; renders per-row pass/fail in a follow-up Dialog.

### 2.3 View modal (per row)

`frappe.ui.Dialog` size=`extra-large`. Header: SRT name + item + warehouse + posting date. Body: a Tabulator grid keyed per batch:

| Column | Source |
|---|---|
| Batch | `batch_no` |
| Origin | Earliest SLE for that (item, batch, warehouse) — `f"{voucher_type} {voucher_no} at {posting_date}"` |
| Transactions (Origin → Posting) | `In: <sum_positive>  Out: <sum_abs_negative>` — clickable cell |
| Last SR Date | Most recent SLE with `voucher_type='Stock Reconciliation'` for that batch — empty if none |
| Transactions (Last SR → Posting) | Same In/Out aggregate over the narrower window — empty if no prior SR — clickable cell |

The two "Transactions" cells are clickable → opens drill-down modal (§ 2.4).

**Footer buttons** (per tab, role-gated server-side):

| Tab | Approve does | Reject does |
|---|---|---|
| Draft | Calls `approve_srt` → DocType `submit()` → Draft→Admin Approval (draft ERPNext SR created) | Calls `reject_srt(reason)` → forward to Close, fill admin_remark with reason |
| Admin Approval | Calls `approve_srt` → existing `submit_linked_sr()` → Admin Approval→Super Admin Approval (submits the linked SR, posts SLE) | Calls `reject_srt(reason)` → forward to Close, fill super_admin_remark with reason |
| Super Admin Approval | Calls `approve_srt` → forward to Close (terminal) | Same as Approve — both end at Close (kept visible for consistency) |

Reject always prompts for a reason via a small `frappe.prompt` dialog; the typed text is written into the appropriate remark field and the workflow advances to Close.

### 2.4 Drill-down modal (per cell)

Click on either "Transactions" cell → second `frappe.ui.Dialog` size=`large`. Title: `Batch <X> — Transactions <from_date> to <to_date>`.

Body: two columns side-by-side, native Frappe `.row > .col-6`:

- **Left column header:** "Out" (red badge)
- **Right column header:** "In" (green badge)

Each column lists every SLE in the window where `actual_qty` matches the column's sign. Entry format: `<voucher_type> <voucher_no>  •  <posting_date HH:MM>  •  qty <abs_value> <stock_uom>`. Sorted by `posting_datetime DESC`. Column footer: `Total <sum> <stock_uom>`.

Empty state per column: `<em class="text-muted">No transactions in window</em>`.

Single Close button — no actions in this drill-down modal.

### 2.5 Server APIs (in `srt_dashboard.py`)

All `@frappe.whitelist()`. Method names prefixed with `srt_dashboard_` ONLY when called via dotted-path from JS — within the file they're plain names. Role checks INSIDE each approve/reject method (reuse `_can_submit_linked_sr` and `_is_privileged_user` patterns from the existing controller).

| Method | Purpose |
|---|---|
| `get_dashboard_rows(tab)` | Returns list of dicts for chosen tab. JOIN with `tabItem.item_name`. Order by `posting_date DESC, posting_time DESC`. Includes the 6 numeric/text fields the grid renders. |
| `get_batch_summary(srt_name)` | For the View modal — returns `[{batch_no, origin: {voucher, date}, summary_origin_to_posting: {in, out}, last_sr_date, summary_lastsr_to_posting: {in, out}}, ...]`. One round-trip when modal opens. |
| `get_batch_drilldown(item_code, warehouse, batch_no, from_date, to_date)` | For the drill-down modal — returns `{in: [{voucher_type, voucher_no, posting_datetime, qty}], out: [...]}`. Joined via Serial and Batch Bundle / Entry to filter by batch. |
| `approve_srt(srt_name)` | Branches by current workflow_state. Draft → calls `doc.submit()`. Admin Approval → calls `doc.submit_linked_sr()`. Super Admin Approval → forwards to Close via `doc.db_set("workflow_state", "Close")` + `doc.cancel()`. Reuses existing role-gate methods. |
| `reject_srt(srt_name, reason)` | Always advances to Close. Writes `reason` into super_admin_remark (Admin Approval / Super Admin Approval tabs) or admin_remark (Draft tab). Calls the same cancel path as approve_srt's Super Admin Approval branch. Role: Srt Admin or above. |
| `bulk_approve_srt(srt_names)` | Loops `approve_srt` per name; returns `[{name, ok, error?}]`. NO transaction rollback — partial successes are real successes (each doc commits independently). UI renders the result list in a follow-up dialog. |

### 2.6 Workspace integration

Add an SRT Dashboard link + shortcut to the existing module workspace (mirrors the SRT Settings addition from v0.0.3):

- Links: under the existing Setup card-break, add `{"label": "SRT Dashboard", "link_to": "srt-dashboard", "link_type": "Page"}`
- Shortcuts: add `{"label": "SRT Dashboard", "link_to": "srt-dashboard", "type": "Page"}`

After the workspace JSON edit, run the manual workspace re-sync pattern documented in memory (Workspace fixtures don't auto-sync on `bench migrate`).

## 3. UX details

### 3.1 Native-Frappe look

- Page header: native `page.set_title()` + `page.add_action_item()` for bulk-approve
- Tab strip: `<ul class="nav nav-tabs">` with `<li class="nav-item">` children — zero custom CSS
- Grid: Tabulator with `theme: 'modern'` (matches the existing chaizup_toc dashboards)
- Modals: `frappe.ui.Dialog` with `size: 'extra-large'` (View) and `size: 'large'` (drill-down)
- No custom CSS file — all styling via Frappe utility classes (`.text-muted`, `.text-bold`, `.text-right`, etc.)

### 3.2 Reduce-scroll layout

- Two-line cells for Stock Found / Stock as on Posting (default + higher UOM stacked) → consolidates 4 columns into 2
- Text-wrap on Item column → keeps long item names readable without horizontal scroll
- Modal grid uses `layout: 'fitDataStretch'` — Tabulator auto-sizes columns to content
- View modal sized `extra-large` (~1100px wide on standard monitors); drill-down `large` (~800px)

### 3.3 Empty / loading states

- Tab body shows `Loading...` (Frappe spinner) while fetching `get_dashboard_rows`
- Empty tab shows `<div class="text-muted text-center">No <tab_name> SRTs to review</div>`
- View modal empty (zero batches): unusual but handled — shows `<em>No batches in this SRT</em>`
- Drill-down modal empty In or Out columns: each shows `<em>No transactions in window</em>`

### 3.4 Concurrency safety

- Each approve/reject call refetches the doc server-side and re-checks current workflow_state before acting — if a concurrent user already advanced the doc, the dashboard call throws "SRT <name> is no longer at <expected state>; refresh and try again."
- Bulk approve returns per-row errors so the user sees which ones got snatched

## 4. Files touched

| File | Action |
|---|---|
| `page/srt_dashboard/__init__.py` | Create — empty |
| `page/srt_dashboard/srt_dashboard.json` | Create — Page meta + 4 roles |
| `page/srt_dashboard/srt_dashboard.py` | Create — 6 whitelisted methods + helpers, ~300 LOC |
| `page/srt_dashboard/srt_dashboard.js` | Create — page controller (tabs, grid, modals), ~500 LOC |
| `page/srt_dashboard/srt_dashboard.html` | Create — minimal Jinja shell (4 containers) |
| `page/srt_dashboard/srt_dashboard.md` | Create — in-app dev doc per project standard |
| `workspace/kavach/kavach.json` | Modify — add SRT Dashboard link + shortcut |
| `tests/test_srt_dashboard.py` | Create — 6 assertion-based tests + runner |
| `kavach.md` (app root) | Modify — new §17 + Sync Block to v0.0.7 |
| `kavach/kavach/kavach.md` (module) | Modify — append paragraph |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | Modify — bump version, add restricted areas, add live test |

## 5. Restricted areas (post-implementation)

- **Don't bypass `submit_linked_sr()` from the dashboard.** It carries the SABB monkey-patches + Stock Settings toggle that ERPNext SR submit needs. Reuse via `doc.submit_linked_sr()`.
- **Don't compute "Origin" by querying Batch master `Batch.creation`.** Batch master timestamps can differ from actual first SLE timing (backdated Purchase Receipts). Always use `MIN(sle.posting_datetime)` for the (item, batch, warehouse) tuple.
- **Don't lump In and Out into single totals only in the drill-down.** Spec explicitly asks for per-SLE breakdown — keep each entry's voucher_type + voucher_no + posting_datetime + qty separately rendered.
- **Don't switch action buttons by role only — gate by tab AND role.** A Srt User who somehow lands on the Admin Approval tab View modal still sees the [Approve] button; the server-side role check rejects the call. UI prevents the obvious case via the tab visibility, but server is authoritative.
- **Don't add front-end "are you sure?" confirms on top of native ones.** Frappe wraps submit/cancel in its own confirm. Only the reject reason prompt is a custom prompt (functional, not redundant).
- **Don't time-bound the Origin SLE query by posting_date.** Origin is the FIRST event for the batch ever, not relative to the SRT's posting_date. Use `MIN(posting_datetime)` unconditionally.
- **Don't read live-fetched data from cache.** Every modal open and every approve call refetches from the DB. Stale data on the dashboard is OK (it's a snapshot); stale data inside an action call is dangerous.
- **Don't add a "Reject reason" rich-text editor.** The reason field is a single-line `frappe.prompt({ fieldtype: 'Small Text' })` — keep it boring, the audit trail is in admin_remark / super_admin_remark text.
- **Workspace fixture sync gotcha applies.** After editing the workspace JSON for the SRT Dashboard link, MANUALLY re-sync via the documented pattern (`frappe.get_doc("Workspace", ...).save()`) — `bench migrate` does NOT pick up Workspace edits automatically.

## 6. Testing plan

`tests/test_srt_dashboard.py` — 6 assertion-based tests (runnable via `bench --site … execute kavach.tests.test_srt_dashboard.run_all`):

1. **test_dashboard_rows_filters_by_tab** — create 3 SRTs at different workflow states; call `get_dashboard_rows('Draft')`, assert only Draft docs returned.
2. **test_batch_summary_returns_per_batch_data** — create a SRT for an item known to have ≥2 SLEs (CZMAT/1585 batches). Call `get_batch_summary(srt_name)`. Assert returned list has length == number of batches and each item has `origin`, `summary_origin_to_posting`, `last_sr_date`, `summary_lastsr_to_posting` keys.
3. **test_batch_drilldown_returns_in_out_split** — call `get_batch_drilldown(item, warehouse, batch_no, from_date, to_date)`. Assert returned `{in: [...], out: [...]}`. Verify each entry has voucher_type, voucher_no, posting_datetime, qty.
4. **test_approve_srt_advances_workflow** — Draft doc → call `approve_srt(name)`. Assert docstatus moves to 1, workflow_state becomes "Admin Approval", linked_erpnext_sr populated.
5. **test_reject_srt_closes_with_reason** — submit a Draft to Admin Approval, then call `reject_srt(name, "test reason")`. Assert workflow_state ends at "Close", docstatus=2, super_admin_remark contains "test reason".
6. **test_bulk_approve_returns_per_row_results** — create 2 Draft SRTs, call `bulk_approve_srt([name1, name2])`. Assert returned list has 2 entries each `{name, ok: True}` and both docs moved to Admin Approval.

All tests reset state in teardown via the shared `_cleanup_open_srt_for_item` helper.

## 7. Out of scope

- Real-time auto-refresh (websocket) — dashboard is snapshot-on-load + refresh button (planned but minor; covered in implementation if cheap)
- Per-batch approve/reject — approval is at SRT-doc level, not batch-level
- Export to Excel from the dashboard — sibling chaizup_toc:item_shortage_dashboard has this; we can add later if requested
- Custom reject-reason templates / dropdown — single free-text Small Text field for now
- Mobile / touch-optimized layout — Tabulator is responsive enough; dedicated mobile breakpoints out of scope
- "Approved By System" tab — these are auto-resolved, no human review needed; intentionally absent
- "Close" tab (cancelled/historical docs) — out of scope; native list view is sufficient for audit lookup
- Approval audit log inside the modal — the doc form already shows admin_approved_by + super_admin_approved_by; not duplicating here

## 8. References

- App memory: `~/.claude/projects/-workspace/memory/app_kavach.md`
- Sibling pattern: `apps/chaizup_toc/chaizup_toc/chaizup_toc/page/item_shortage_dashboard/` (Tabulator + quick-filter + server API pattern)
- Sibling pattern: `apps/yoddha/yoddha/yoddha_dev/page/yoddha_dev_dashboard/` (tabs + page header actions)
- Existing controller actions reused: `StockReconciliationSRT.submit_linked_sr`, `_can_submit_linked_sr`, `_is_privileged_user`
- Existing SLE join pattern: `api.get_item_defaults` (SLE + Serial and Batch Bundle / Entry join, used for batch drill-down)
- Workspace fixture gotcha: app-root §13 "Workspace fixture sync gotcha" (memory: same name)
- Prior spec for context: `docs/specs/2026-05-22-srt-historical-stock-design.md`
