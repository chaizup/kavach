# SRT Dashboard

**Path:** `/app/srt-dashboard`
**Module:** Stock Reconciliation Tracking
**Custom Frappe Page** — single operator surface for Stock Reconciliation SRT.

> **Current version:** v0.0.9.33 (2026-05-31)
> **Reference:** `../../../kavach.md` § 26 (versioned change log)
> **Claude memory:** `app_kavach.md`

---

## 1. Purpose

This page is the **only** operator surface for Stock Reconciliation SRT. All three roles (Srt User / Srt Admin / Srt Super Admin) use only this page. Every action — Create, View, Edit, Approve, Reject, Bulk Approve — lives here. The standalone `/app/srt-form` page was DELETED in v0.0.9.

Two-tab queue, role-adaptive UI, schema-driven form via `get_form_meta` so DocType changes propagate without JS changes.

## 2. Tab semantics

| Tab                              | Server filter                                       | Doc state | Action by              |
|----------------------------------|-----------------------------------------------------|-----------|------------------------|
| **Admin Approval Pending**       | `docstatus = 0`                                     | Draft     | Srt Admin (approve)    |
| **Super Admin Approval Pending** | `docstatus = 1, workflow_state = "Admin Approval"`  | Submitted | Srt Super Admin (submit linked SR) |

Tab labels reflect **who is waiting to act**, not the current workflow state. The Draft tab was dropped in v0.0.9.15 — operators create new SRTs via "+ New SRT" and the doc lands in Admin Approval Pending after submit.

## 3. Files (this folder)

| File | Purpose |
|---|---|
| `srt_dashboard.json` | Page meta + 4 roles (Srt User, Srt Admin, Srt Super Admin, System Manager) |
| `srt_dashboard.py` | 11 whitelisted server methods (`get_dashboard_rows`, `get_dashboard_counts`, `get_batch_summary`, `get_batch_drilldown`, `approve_srt`, `reject_srt`, `bulk_approve_srt`, `get_form_meta`, `load_srt_form`, `save_srt_form`, `submit_srt_form`) |
| `srt_dashboard.js` | Page controller (~2700 LOC): hand-curated utility CSS, dashboard list grid, slide-down form panel, View modal (with batch summary + 3 remark cards + editable remark Text Editor), drill-down modal, bulk-action snackbar, realtime sync |
| `srt_dashboard.html` | Minimal Jinja shell — loads Tabulator CDN, wraps slots. HTML comments only (Jinja-comment gotcha avoided) |
| `srt_dashboard.md` | This file |

## 4. Server methods (`srt_dashboard.py`)

| Method | Purpose |
|---|---|
| `get_dashboard_rows(tab, item_filter=None)` | Tab-filtered list of SRTs joined with Item.item_name. Returns the 15 grid-bound fields + 3 remarks (user/admin/super_admin) so the View modal can render them without a second round-trip. |
| `get_dashboard_counts()` | `{Admin Approval Pending: N, Super Admin Approval Pending: N}` for the tab pill badges. |
| `get_batch_summary(srt_name)` | Per-batch Origin + transaction summary for the View modal. Includes `is_counted`, `qty_found`, `current_stock_in_*`, `select_uom`, `conversion_factor` so the modal can compute the reconcile-state pill (uncounted / matched / over / short). |
| `get_batch_drilldown(item_code, warehouse, batch_no, from_date, to_date)` | Per-SLE In/Out split for the drill-down modal. |
| `approve_srt(srt_name, remark=None)` | Workflow-state-branched dispatch through `doc.submit()` / `doc.submit_linked_sr()` / `doc.cancel()`. Optional `remark` is appended to `admin_remark` (Draft state) or `super_admin_remark` (Admin Approval state) with `[via SRT Dashboard <ts> by <user>]` audit-trail tag BEFORE workflow advance. |
| `reject_srt(srt_name, reason)` | Forward to Close + reason annotation on the appropriate remark field. |
| `bulk_approve_srt(srt_names, bulk_remark=None)` | Loop approve with per-row results. `bulk_remark` is annotated with `[BULK via SRT Dashboard <ts> by <user>]` per doc and routed by `workflow_state` (Admin Approval → super_admin_remark; else → admin_remark). |
| `get_form_meta()` | Returns `frappe.get_meta` shape for parent + Batch List child + current user's roles. Drives schema-driven form. |
| `load_srt_form(name=None)` | Returns full doc shape (edit mode) or empty defaults (new mode). Always includes `modified` for optimistic concurrency. Posting Date/Time defaults are always non-empty (microseconds stripped from `now_datetime` so the Time control accepts them — v0.0.9.16). |
| `save_srt_form(payload, name=None)` | Dispatches `doc.save()` — checks `modified` for concurrency; raises `TimestampMismatchError` on mismatch. Fires the full validate() chain. |
| `submit_srt_form(name)` | Dispatches `doc.submit()` — fires Case 1/2 routing + ERPNext SR creation. |

### Server filter constants

```python
_TAB_FILTERS = {
    "Admin Approval Pending":       {"docstatus": 0},
    "Super Admin Approval Pending": {"docstatus": 1, "workflow_state": "Admin Approval"},
}
_EDIT_LOAD_FILTERS = {            # used by load_srt_form's docstatus guard
    "Draft": {"docstatus": 0},
}
```

## 5. Form panel (slide-down)

Triggered by **+ New SRT** primary action OR **Edit** on a Draft row in the View modal. Slides down from the navbar with backdrop blur + body-scroll lock + `ESC` close. Lives at z-index 1015; respects Frappe's left sidebar by offsetting via `.layout-main`'s `getBoundingClientRect().left` (resize listener re-pins on sidebar toggle).

Sections:

1. **Audit strip** (existing docs only) — Doc number, Series, Status pill, Amended-from chip, Admin/Super-admin approver chips, Linked ERPNext SR link.
2. **Item & Location** — Item, Warehouse, Company, Posting Date, Posting Time, "Edit posting" toggle.
3. **Totals** (live recompute) — Matched/over/short delta in both default + higher UOM.
4. **Batches** (Tabulator grid) — Reconcile checkbox, Batch picker, Qty Found, UOM, Status pill, Add Row, search filter, tick-all/untick-all. Snapshot badge in header shows the (date, warehouse) the table is scoped to.
5. **Remarks** — three stacked Text Editor fields (user_remark, admin_remark, super_admin_remark), each `read_only` per role + state per the controller's `_enforce_remark_field_permissions` gates.
6. **Footer actions** — Save / Submit / Submit Linked ERPNext SR (state-adaptive).

## 6. View modal

Shows the per-batch Origin / In-Out / Last SR / In-Out summary for a Submitted SRT. Triggered by the eye icon on any grid row.

Sections:

1. **Meta chips** — Item, Warehouse, Posting timestamp.
2. **Batch summary grid** — Batch, State pill (uncounted/matched/over/short), Origin (voucher type + no + datetime, 3-line block), Origin → Posting (In/Out 2-line stack), Last SR (date + time), Last SR → Posting (In/Out). Responsive: collapses Last SR columns first on narrow viewports. **Row visual treatment:**
    - Uncounted: `opacity: 0.6` + transparent left-border (low-light)
    - Matched: emerald left-border + 4% emerald tint
    - Over: amber left-border + 6% amber tint (actionable)
    - Short: rose left-border + 6% rose tint (actionable)
3. **Existing remarks** — Read-only cards for user/admin/super-admin remarks (any non-empty), each Material-3 elevated with icon-color matching the role's accent.
4. **Editable remark panel** — Text Editor for the field the current state allows (`admin_remark` for Draft, `super_admin_remark` for Admin Approval). Pre-loads no existing value (the read-only block above shows history); typed content is appended via the server's `[via SRT Dashboard]` audit-trail tag on Approve.
5. **Primary / Secondary actions** — Approve (with remark) / Reject (with mandatory reason).

### 6a. State column HTML-leak fix (v0.0.9.29)

**Symptom:** the View-modal **State** column rendered raw markup, e.g.
`<div style='text-align: right'>-5,27,400</div> Pcs`, instead of the
expected `-5,27,400 Pcs` delta pill.

**Root cause chain:**
1. `frappe.format(x, {fieldtype:"Float"})` (and `Int` / `Currency` /
   `Percent`) wraps its output in `<div style='text-align: right'>…</div>`
   for number fieldtypes — that is core Frappe formatter behaviour, not a bug.
2. In `compute_reco_state()` that wrapped string became part of the pill's
   plain-text `label` (the over/short branches).
3. `fmt_reco_state()` renders the pill text via
   `frappe.utils.escape_html(s.label)` — correct for a text node — which
   escaped the `<div>` into the **visible** `&lt;div…` you saw on screen.

**Fix:** use `format_number()` (`window.format_number`, Frappe core) which
returns the locale-formatted number as **plain text** (no wrapper). Applied
in two places that build inline pills/labels:
- `compute_reco_state()` over/short branches (View-modal State column).
- `fmt_status()` over/short branch (Form-panel batches grid Status column —
  there the stray `<div>` rendered as a block and broke the inline pill,
  rather than showing literal tags, but same anti-pattern).

> **RESTRICT (new rule):** never feed
> `frappe.format(..., {fieldtype:"Float"|"Int"|"Currency"|"Percent"})` into a
> text node, an `escape_html()` call, or an inline pill/badge. Always
> `format_number()` it (or `frappe.utils.strip_html()` it) first. The wrapped
> `<div style='text-align:right'>` is only safe where the formatter output is
> injected as **raw innerHTML in a right-aligned cell** (e.g. the In/Out
> stack `fmt_inout`, the drill-down `col_html`, and the form grid's numeric
> Qty/Stock cells — those are intentionally left as `frappe.format`).

**Verified:** clear cache + hard browser refresh (Cmd/Ctrl+Shift+R) required
for the new `srt_dashboard.js` to load; the State pill then shows clean
`-5,27,400 Pcs`.

### 6b. Dual-UOM "box bubble" chips (v0.0.9.30)

**Request:** every quantity in the dashboard must show BOTH the default/stock
UOM and the higher UOM, each in its own box/bubble.

**Implementation:** two module-level helpers in `srt_dashboard.js`:
- `srt_uom_chip(val, uom, primary, toneCls)` — one bordered rounded-md pill
  (value + unit). `primary` bolds the value; `toneCls` ∈ `srt-chip-slate` /
  `srt-chip-emerald` / `srt-chip-rose` / `srt-chip-indigo`.
- `srt_uom_chips(stock_val, stock_uom, higher_uom, higher_uom_cf, opts)` —
  stacks the stock-UOM chip (primary) above the higher-UOM chip. It converts
  `higher = stock_val / higher_uom_cf`, OR uses `opts.higher_val` when the
  caller already has the higher value precomputed (dashboard list totals).
  Higher chip is omitted when there is no distinct higher UOM (cf ≤ 0).

Applied at every qty site:

| Surface | Formatter | UOM source |
|---|---|---|
| Dashboard list (Stock Found, Stock as on Posting) | `fmt_uom_stack` | precomputed `total_*_in_higher_uom` via `opts.higher_val` |
| View-modal In/Out (Origin→Posting, Last SR→Posting) | `fmt_inout` | SLE stock-UOM sum ÷ `row_data.higher_uom_cf` |
| Form totals card (Current Stock, Stock Found) | `_render_totals` | `this.state.higher_uom_cf` + precomputed `t.higher_*` |
| Form batches grid (Current Selected/Stock UOM) | inline | single chip per column (Selected vs Stock) |
| Drilldown modal (per-SLE qty + column total) | `_render_drilldown` | `srt_row.higher_uom_cf` |

**Server change:** `get_dashboard_rows` now also SELECTs `srt.higher_uom_cf`
so `row_data` carries it into the View modal + drilldown (which only get the
SLE sums in stock UOM and must convert client-side).

**Column auto-width:** View-modal In/Out columns widened to `width:210,
minWidth:200`; list UOM columns to 160 / 185 — so the longer UOM chip never
clips. The View grid uses `layout:"fitDataStretch"`, so columns size to the
chip content.

**Item name in modal:** the View-modal "Item" meta chip now renders
`item_code · item_name` (`row_data.item_name` from the `get_dashboard_rows`
Item join), shown only when the name differs from the code.

> **RESTRICT:** chips MUST use `format_number()` (the v0.0.9.29 rule). Don't
> merge the form grid's two Current columns into one — they intentionally show
> Selected vs Stock UOM side by side. Don't remove `higher_uom_cf` from
> `get_dashboard_rows` — In/Out + drilldown conversion depends on it.

**Verified:** `node --check` + `python3 ast.parse` pass; visual confirm needs
a hard browser refresh.

### 6c. View-modal refinements (v0.0.9.31)

- **State column → dual UOM.** `compute_reco_state()` now returns `delta_stock`
  (the stock-UOM delta); `fmt_reco_state()` renders over/short as dual-UOM
  box-bubble chips (amber = over, rose = short) instead of a single
  select-UOM number. matched/uncounted keep their text pill.
- **In/Out word labels removed.** `fmt_inout()` no longer prints "In"/"Out" —
  direction is colour-coded (emerald = In, rose = Out). A legend chip
  (green ● In · red ● Out) was added to the modal header meta row. In/Out
  columns narrowed to `width:160, minWidth:150`.
- **No sorting on the modal table.** Every view-modal column carries
  `headerSort:false`.

### 6d. View modal — opening balance, Difference column, remark freezing (v0.0.9.32–33)

- **Opening balance in In/Out cells (v0.0.9.32).** `get_batch_summary` now
  returns `qty_at_origin` and `qty_at_last_sr` (via `_fetch_balance_as_of` —
  cumulative `SUM(sbe.qty)` ≤ that datetime). `fmt_inout` shows that balance as
  a neutral slate chip ABOVE the In/Out chips (origin cell → qty_at_origin,
  last-SR cell → qty_at_last_sr). **Don't drop those keys — fmt_inout reads them.**
- **"State" → "Difference" (v0.0.9.33).** Column renamed. over/short render the
  delta in both UOMs as chips, **always amber/orange — never rose** (rose = Out
  and would read as an outward movement). Hover shows the calc
  (Counted − Current = Δ). matched/uncounted keep their text pill.
- **In/Out word labels removed (v0.0.9.31).** Direction is colour-coded
  (emerald = In, rose = Out); a legend chip sits in the modal header. No column
  sorting on the modal (`headerSort:false` on every column).
- **"No change" rows hidden (v0.0.9.33).** The grid filters to
  `is_counted` rows only — uncounted batches just retain prior Bin qty and add
  noise for an approver. Server snapshot stays complete; filter is client-side.
- **Scrollable modal (v0.0.9.33).** `body .modal-dialog:has(.srt-view-grid)
  .modal-body { max-height:80vh; overflow-y:auto }` so all three remark cards +
  the editable remark are reachable.
- **Item name in modal (v0.0.9.30).** "Item" meta chip shows `code · name`.

### 6e. Remark freezing & access (v0.0.9.33)

Strict stage-based, role-checked editing — UI mirrors the controller's
`_enforce_remark_field_permissions`:

| Field | Editable where | By whom | Stage |
|---|---|---|---|
| `user_remark` | **Form panel only** | owner | creation / Draft |
| `admin_remark` | **View modal** (Approve) | Srt Admin | Draft |
| `super_admin_remark` | **View modal** (Approve) | Srt Super Admin | Admin Approval |

- Form panel (`_render_remarks`): `ro_admin = ro_super = true` always — only
  `user_remark` is editable there (and only while Draft/new), **regardless of
  whether the editor also holds admin/super roles.** Approvers add their remark
  at approval time in the modal.
- View modal editable-remark gate now checks the role for the *target* field:
  `_can_edit_remark = (state==="Admin Approval") ? this.is_super : this.is_admin`.
- All three remarks are shown read-only as cards in the modal regardless.

## 7. Bulk approve

Selection lives in `this._selected: Set<doc_name>` — controller-owned, not Tabulator's `selectableRows`. Tabulator 6.x's `selectableRows: true` defaults to "any cell click selects" which double-fired with our cellClick handler, cancelling each other out (root cause of the v0.0.9.15..v0.0.9.24 broken-checkbox bug). Now:

- Cell formatter reads `this._selected.has(name)` and renders Material 3 checkbox
- `cellClick` mutates the Set + reformats the row + syncs the header/bulk-bar visuals
- `headerClick` toggles all-or-none on the Set + reformats every active row
- `_sync_select_visual()` updates the master checkbox (checked / partial / unchecked) and the bulk-action snackbar
- Selection clears whenever the grid re-renders (tab switch, refresh, item filter change)

The bulk-approve dialog opens a Frappe Dialog with a Text Editor remark field, routes the remark by `workflow_state` server-side, dispatches each approval through the existing `approve_srt(srt_name)` path so the DocType lifecycle hooks all fire.

## 8. Restricted areas (cannot change without architectural review)

See `srt_dashboard.js` top-of-file comment block for the canonical list. The hot list:

### Architecture

- Don't reintroduce a standalone `/app/srt-form` page — DELETED in v0.0.9.
- Don't fork the dashboard per role — single page, role-adaptive UI.
- Don't hardcode form field list — use `get_form_meta()` for schema parity.
- Don't poll for changes — use `frappe.realtime` push.
- Don't silently overwrite on save — `modified` check throws `TimestampMismatchError`.
- Don't drop the `wrapper._srt_dashboard_v9_initialized` re-init guard.
- Don't bypass `submit_linked_sr()` from `approve_srt` — SABB monkey-patches apply.

### Tab semantics (v0.0.9.17)

- Don't merge `_EDIT_LOAD_FILTERS` back into `_TAB_FILTERS` — `get_dashboard_counts` and `bulk_approve_srt` iterate `_TAB_FILTERS.items()`; folding Draft in would double-count the Admin Approval Pending tab.
- Don't route the bulk/single remark by tab key — route by `workflow_state` (the controller's `_enforce_remark_field_permissions` gates are state-keyed). "Admin Approval" → super_admin_remark; else → admin_remark.

### Tables (v0.0.9.18..25)

- Dashboard list text-wrap CSS is scoped to `.srt-grid-host`. Don't widen — cascades into the form's `.srt-batches-grid` and breaks inline editors.
- Form batches grid uses Tabulator's default virtual renderer (fixed row height). Don't apply `renderVertical: "basic"` there.
- The dashboard list checkbox column is OWNED by `this._selected: Set`, NOT Tabulator's `selectableRows`. Don't re-enable `selectableRows: true` — double-fires with cellClick under Tabulator 6.x.
- `align-items: flex-start` on `.tabulator-cell` breaks number-column visual baseline. Right-aligned stock columns keep `align-items: center` via `[tabulator-field*="stock"]` / `[tabulator-field*="qty"]` overrides — don't remove these.
- **(v0.0.9.29)** Never feed `frappe.format(..., {fieldtype:"Float"|"Int"|"Currency"|"Percent"})` into a pill/badge label, a text node, or `escape_html()` — it wraps the number in `<div style='text-align:right'>…</div>` which either renders as a stray block or (under `escape_html`) shows literal tags. Use `format_number()` / `strip_html()`. See § 6a.

### Form panel chrome (v0.0.9.13)

- Form panel offsets via `.layout-main`'s `getBoundingClientRect().left`, NOT jQuery `.outerWidth()` on `.layout-side-section`. The rect approach captures all sidebar modes (collapsed / full / mobile hidden); outerWidth misses mini-rail mode.
- Resize listener torn down on close — don't leak it.

### Visual hygiene (v0.0.9.6 audit baseline)

- 4 font sizes only / 3 font weights only / 1 shadow only / hover = color change only / sentence case only / SVG icons only / no decorative blur orbs / no dark gradient totals card.
- `prefers-reduced-motion` disables all transitions — required for WCAG 2.3.3.

### Validation parity (DocType authority)

- `save_srt_form` → `doc.save()` fires the full `validate()` chain (9 gates). Don't add a parallel API that bypasses it.
- `submit_srt_form` → `doc.submit()` fires `on_submit` (Case 1/2 routing). Don't short-circuit Case 1 in JS — the controller decides.

## 9. Verification

10 tests in `tests/test_srt_dashboard.py`. Cross-suite regression includes Case 1/2 (5), gap rule (8), historical stock (4), dashboard (10) — total 27/27.

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Last verified: 2026-05-24 @ v0.0.9.25 → 27/27. (v0.0.9.29 is a JS-only
render fix — see § 6a; `node --check` passes, no server logic touched, so the
27/27 suite is unaffected. Visual confirm via hard browser refresh.)

## 10. Sync block (for cross-model handoff)

```
APP:    kavach
PAGE:   srt_dashboard @ v0.0.9.33 (2026-05-31)
FEAT932: get_batch_summary returns qty_at_origin/qty_at_last_sr (_fetch_balance_as_of); fmt_inout shows opening balance chip above In/Out.
FEAT933: "State"→"Difference" (amber chips, calc tooltip); In/Out word labels removed (colour legend in header); no headerSort on modal; "No change"/uncounted rows hidden (data filter r.is_counted); modal body scrollable (:has(.srt-view-grid)); remark freeze: form=user_remark only (ro_admin=ro_super=true), modal admin/super by stage+role.
FIX929: State/Status pills use format_number() not frappe.format({fieldtype:Float}) — the latter wraps numbers in <div style='text-align:right'> which leaked into escape_html'd pill text (literal tags) / inline pills (stray block). See § 6a.
FEAT930: dual-UOM box-bubble chips at every qty via srt_uom_chips()/srt_uom_chip(); get_dashboard_rows returns higher_uom_cf for In/Out+drilldown conversion; In/Out cols 210/minWidth200, list UOM cols 160/185; View "Item" chip = item_code · item_name. See § 6b.
TABS:   2 — Admin Approval Pending (docstatus=0), Super Admin Approval Pending (ds=1, ws="Admin Approval")
SELECT: controller-owned Set<name>; Tabulator selectableRows DISABLED
GRID:   .srt-grid-host = dashboard list (renderVertical:basic, text-wrap, sticky); .srt-batches-grid = form (virtual, fixed row); .srt-view-grid = view modal (basic, responsive collapse)
APPROVE: approve_srt(srt_name, remark?) — routes by workflow_state ("Admin Approval"→super_admin_remark; else→admin_remark)
BULK:   bulk_approve_srt(srt_names, bulk_remark?) — same routing per row, [BULK] audit tag
VIEW:   3 remark cards (read-only) + editable Text Editor per state + reconcile-state pills + responsive collapse
FORM:   slide-down panel, .layout-main rect offset, schema-driven via get_form_meta(), modified-check concurrency
TESTS:  27/27 (5+8+4+10)
STACK:  Frappe v16 / Tabulator 6.3.1 (CDN) / Material 3 surface tints / Inter font / hand-curated utility CSS (Tailwind CDN removed v0.0.9.12)
```
