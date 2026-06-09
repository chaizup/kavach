# SRT Form — Custom Frappe Page (Best-in-class Front-End for SRT DocType)

**Date:** 2026-05-23
**App:** `kavach`
**New Page:** `srt-form` (Frappe Page DocType)
**Status:** Approved — ready for implementation plan

---

## 1. Problem

The native DocType form at `/app/stock-reconciliation-srt/new` is functional but operator-unfriendly:

- Long single-column layout requires scrolling between item-pick at top and totals at bottom
- No live "Delta" indicator (operator has to mentally compare totals)
- Per-row status (matched? real delta? in which UOM?) is invisible until save
- No search/filter on the batches grid (a single SFG item can have 1000+ batches)
- Three remark fields are visually identical even though they have role-gated edit rules
- Help text / contextual hints crammed into field descriptions
- No tick-all / untick-all bulk actions on the batches grid

User intent:

> Build a same form on front end that replicates the doctype `stock-reconciliation-srt`, store into the same `stock-reconciliation-srt` doctype data; validations already in `stock-reconciliation-srt` so adding records performs the validations. But the front-end form will be best in class UI and UX — better space utilization, less scroll, clear differentiation between components, well aligned.

## 2. Architecture

### 2.1 Page shell + route

A new Frappe Page at `/app/srt-form`. Two entry modes:

- **New doc:** `/app/srt-form` (no query string)
- **Edit existing Draft:** `/app/srt-form?name=<srt-name>`

Standard 5-file Page convention matching `srt-dashboard`:

```
kavach/kavach/page/srt_form/
├── __init__.py
├── srt_form.json     (Page meta + 4 roles — System Manager, Srt Super Admin, Srt Admin, Srt User)
├── srt_form.py       (3 whitelisted methods: load_srt_form, save_srt_form, submit_srt_form)
├── srt_form.js       (form controller — ~700 LOC: layout, batches grid, save/submit, error surface)
├── srt_form.html     (Jinja shell — header strip + 3 panel containers)
└── srt_form.md       (in-app dev doc)
```

Two entry points wired into the existing SRT Dashboard:

- **`+ Create SRT` page-header action** alongside Bulk Approve → opens `/app/srt-form`
- **Draft tab "Edit Form" button** in the View modal — secondary action that opens `/app/srt-form?name=<draft>` (the existing "View" stays as a quick-review pane)

### 2.2 Form layout

Responsive two-column at ≥1200px, single-column below. Three vertical sections:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HEADER STRIP  (sticky)                                                 │
│  ← Back to Dashboard    Create Stock Reconciliation SRT    ● Draft      │
│                                       [Save Draft] [Submit for Approval]│
├─────────────────────────────────────────────────────────────────────────┤
│  CONTEXT PANEL                            │  LIVE TOTALS PANEL          │
│  ┌─ Item & Location ───────────────────┐  │  ┌─ Stock Snapshot ─────┐  │
│  │  Item *      [CZMAT/1585       ▼]   │  │  │  Current Stock        │  │
│  │  ↳ Grinded Masala — Kapol           │  │  │    3,823.460 g        │  │
│  │  Warehouse * [Work In Progress ▼]   │  │  │      3.823 Kg         │  │
│  │  Company     [CCP             (RO)] │  │  │  Stock Found          │  │
│  │  Posting     [2026-05-23] [16:00]   │  │  │    3,823.460 g        │  │
│  │  ☐ Edit posting                     │  │  │      3.823 Kg         │  │
│  └─────────────────────────────────────┘  │  │  Δ Delta              │  │
│                                            │  │    +0.000 g (matched) │  │
│                                            │  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│  BATCHES PANEL  (full-width)                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  [Search batches…]   [Tick all]   [Untick all]   [+ Add manual]  │   │
│  │ ☐  Batch         Qty Found  UOM    Current      Stock UOM  Status│   │
│  │ ☐  6A01D26       _____      Kg ▼   3.689        Gram       —     │   │
│  │ ☑  CZPRD/14976   _2___      Kg ▼   0.283        Gram     Δ+1.7Kg │   │
│  │ ☐  …                                                              │   │
│  │                                                       42 batches  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  REMARKS PANEL  (full-width)                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  User Remark        [editable, owner @ Draft]                    │   │
│  │  Admin Remark       [editable, Srt Admin @ Draft]                │   │
│  │  Super Admin Remark [locked at Draft — Srt Super Admin @ AA]     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

Layout uses native Frappe `.row` + `.col-*` (Bootstrap utility classes). The two-column area is `.col-md-7` + `.col-md-5`; batches and remarks are `.col-12`.

### 2.3 Key UX wins over the native doctype form

- **Item-pick preview:** item_name appears as a small muted line under the picker — operator confirms they picked the right item without leaving the field
- **Live Totals panel** on the right shows Current, Found, AND Delta — recomputed client-side on every qty_found / select_uom / is_counted change. The same `_recompute_totals` formula the server uses, so save-time totals never surprise.
- **Per-row Status column** shows live tick state + per-row delta in the operator's selected UOM (e.g., `Δ +1.717 Kg`) so the operator sees instantly which rows have meaningful deltas
- **Batches Search box** filters the grid in-memory (Tabulator's `setFilter("batch_no", "like", ...)`) — helpful for items with hundreds of batches
- **Tick all / Untick all** bulk actions in the grid header
- **Add manual batch row** for batches that don't auto-populate (mirrors the existing doctype's batch_no Link picker, but with a clearer affordance)
- **Sticky action bar** at top — Save Draft / Submit for Approval always visible while scrolling
- **Inline validation messages** — server errors render as a red banner at the top of the form, not in a modal alert
- **Remark field role hints** — each remark field shows a small chip below it saying which role can edit it and at which workflow state

### 2.4 Save path (validation reuse)

The critical architectural rule: **save MUST dispatch through `doc.save()` — never re-implement validation client-side.**

`srt_form.py:save_srt_form(payload, name=None)`:

```python
@frappe.whitelist()
def save_srt_form(payload, name=None):
    payload = frappe.parse_json(payload) if isinstance(payload, str) else payload
    if name:
        doc = frappe.get_doc("Stock Reconciliation SRT", name)
        if doc.docstatus != 0:
            frappe.throw(_(
                "Only Draft SRTs can be edited via this form. "
                "Use the workflow actions for {0} (current state: {1})."
            ).format(name, doc.workflow_state or "Submitted"))
        doc.update(payload)
    else:
        payload["doctype"] = "Stock Reconciliation SRT"
        doc = frappe.get_doc(payload)
    doc.save()
    return {"name": doc.name, "workflow_state": doc.workflow_state or "Draft"}
```

That's it. `doc.save()` runs every validation we built — duplicate-open guard, gap rule, `_classify_zero_delta_ticks`, `_enforce_at_least_one_reconcile_ticked`, `_enforce_remark_field_permissions`. Zero re-implementation.

Client-side flow:

1. User clicks **Save Draft**.
2. JS collects form state → builds `payload` (`{item, default_warehouse, posting_date, posting_time, batches: [...], user_remark, admin_remark, company}`).
3. POSTs to `save_srt_form`.
4. On 200 → green toast `Saved: SRT-RECO-…`, replace URL with `?name=<new-name>` (so the form is now in "edit" mode), enable **Submit for Approval** button.
5. On `frappe.ValidationError` → red banner at top of form with the throw message verbatim (includes our nicely-formatted "Cannot create SRT for item X: previous reconciliation..." messages). Banner has a × to dismiss.

For **Submit for Approval**, the JS calls `submit_srt_form(name)` (thin wrapper over `doc.submit()`) — runs the on_submit lifecycle, workflow transition, Case 1 auto-approve routing, and ERPNext SR draft creation. Same code path as the dashboard's `approve_srt` for Draft → Admin Approval, but called separately so the form has its own audit trail in the source field of frappe.log_error.

### 2.5 Live totals + per-row delta computation

JS function `_recompute_totals_and_deltas()` runs on every `qty_found`, `select_uom`, `is_counted` change. Mirrors `stock_reconciliation_srt.py:_recompute_totals`:

```javascript
function _recompute_totals_and_deltas(state) {
    let total_current = 0, total_found = 0;
    for (const row of state.batches) {
        const cur = Number(row.current_stock_in_stock_uom) || 0;
        total_current += cur;
        if (row.is_counted) {
            const cf = _resolve_cf(state, row);  // mirror of _resolve_row_cf
            const found_in_stock = (Number(row.qty_found) || 0) * cf;
            total_found += found_in_stock;
            row._delta_in_selected = (Number(row.qty_found) || 0)
                                    - (Number(row.current_stock_in_selected_uom) || 0);
        } else {
            total_found += cur;
            row._delta_in_selected = null;
        }
    }
    return {
        current: total_current,
        found: total_found,
        delta: total_found - total_current,
        higher_current: total_current / (state.higher_uom_cf || 1),
        higher_found:   total_found   / (state.higher_uom_cf || 1),
    };
}
```

Per-row `_delta_in_selected` is rendered in the Status column:
- `null` (unticked) → `—`
- `0 ± epsilon` → `<span class="text-muted">Matched</span>` (will auto-untick on save per Case 2)
- positive → `<span class="text-success">Δ +1.717 Kg</span>`
- negative → `<span class="text-danger">Δ −0.234 Kg</span>`

### 2.6 Workspace + dashboard integration

- Dashboard's `srt_dashboard.js` gains a `+ Create SRT` button as a secondary page action (the existing Bulk Approve stays primary)
- Workspace gets a shortcut `SRT Form` pointing to `/app/srt-form` (optional path for power users; most enter via dashboard)
- Dashboard's View modal gains a footer button **Open Full Form** on the Draft tab → navigates to `/app/srt-form?name=<draft>`

## 3. Server APIs (3 whitelisted methods)

| Method | Purpose |
|---|---|
| `load_srt_form(name=None)` | Returns `{}` for new docs (just metadata: company default, default posting_date/time) OR the full doc shape for edits. On edit, also includes the batches with computed `current_stock_in_selected_uom` etc. (re-uses `api.get_item_defaults`). |
| `save_srt_form(payload, name=None)` | Thin wrapper — dispatches through `doc.save()`. Returns `{name, workflow_state}`. |
| `submit_srt_form(name)` | Thin wrapper — dispatches through `doc.submit()`. Returns `{name, workflow_state, linked_erpnext_sr}`. |

Existing module APIs reused via `frappe.call` from JS:

- `api.get_item_defaults(item_code, warehouse, posting_date?, posting_time?)` — on item/warehouse/posting change, auto-populate batches grid (already time-aware from v0.0.5)
- `api.get_uom_conversion(item_code, uom)` — on per-row select_uom change
- `api.get_batch_current_state(item_code, batch_no, posting_date?, posting_time?)` — on manual batch add
- `api.get_item_uoms_for_link(...)` — `select_uom` Link picker query

## 4. Behaviour matrix

| Scenario | Behaviour |
|---|---|
| Fresh form, no item picked | Batches grid empty + muted "Pick item & warehouse to load batches" message |
| Pick item, no warehouse | Same empty state — `get_item_defaults` not called until warehouse also set (mirrors doctype-form behavior) |
| Pick both, then change item | Confirm if any rows ticked? **No** — silent reset (matches doctype-form 2026-05-21 spec) |
| Change posting_date/time on a draft | Silent re-fetch via `get_item_defaults(posting_date, posting_time)` — mirrors doctype-form v0.0.5 behavior |
| Click Save Draft with zero ticked rows | Server throws "Cannot save: tick at least one batch row" → red banner |
| Click Save Draft with all matched rows + delta on one | Server's `_classify_zero_delta_ticks` auto-unticks matched ones, doc saves cleanly. JS reloads from server-returned state so the form reflects the auto-untick. |
| Open existing Draft via `?name=…` | Form loads in edit mode; Save Draft re-saves through `doc.update() + doc.save()` |
| Open submitted doc via `?name=…` | Form throws on load with "Only Draft SRTs can be edited" → redirect back to dashboard with red toast |
| Click Submit for Approval, server throws | Red banner with message, doc stays at Draft |
| Submit succeeds, Case 1 routing fires | Toast `Approved by System — no ERPNext SR needed`, redirect to dashboard's `Super Admin Approval`-equivalent tab (or Close tab if we wire that) |
| Two operators edit same Draft simultaneously | Last save wins (no doc-version optimistic-lock check); server's `modified` timestamp check by Frappe would surface as `TimestampMismatchError` → red banner |

## 5. Restricted areas (post-implementation)

- **Don't duplicate any validation from `stock_reconciliation_srt.py`** client-side. The form is a UX layer. Save MUST dispatch through `doc.save()`.
- **Don't allow editing submitted (docstatus=1) docs via this form.** `save_srt_form` early-throws. Edits to remarks at Admin Approval / Super Admin Approval go through the doctype form (where the remark-permission gate is authoritative).
- **Don't bypass `_classify_zero_delta_ticks`** by auto-ticking matched rows client-side. Server-side Case 2 auto-untick is the source of truth. JS reloads after save to reflect the auto-untick.
- **Don't compute Delta using a different formula than `_recompute_totals`.** The two MUST agree visually. If `_recompute_totals` changes, this JS copy MUST be updated too.
- **Don't add a CSS file.** Use Frappe utility classes only (matches the dashboard).
- **Don't use Jinja `{# ... #}` comments in `srt_form.html`** — same gotcha as the dashboard (apostrophe in comment breaks the JS bundle). HTML comments only.
- **Don't add a "force submit" button that bypasses the workflow.** Submit always goes through `doc.submit()` which carries the workflow transition + role check.
- **Don't write to `admin_remark` / `super_admin_remark` for a non-privileged user.** The `_enforce_remark_field_permissions` gate will throw — but we should also gate the JS UI (read-only field) so the user doesn't see a confusing error after typing.
- **Don't fetch the `super_admin_remark` field for a Draft doc.** It's writable only at Admin Approval — for the form's Draft mode, it should be visually disabled with the role-hint chip.

## 6. Testing plan

`tests/test_srt_form.py` — 4 assertion-based tests (runnable via `bench --site … execute kavach.tests.test_srt_form.run_all`):

1. **test_load_new_returns_empty** — `load_srt_form()` (no name) returns `{}` or just defaults (no error).
2. **test_load_existing_draft_returns_full_doc** — Create a Draft via `_make_draft_srt`, call `load_srt_form(name)`, assert returned dict has `item`, `default_warehouse`, `batches`, `user_remark`.
3. **test_save_new_creates_draft** — Build a minimal payload, call `save_srt_form(payload)`, assert a Draft was created with the expected item + at-least-1-ticked batch.
4. **test_save_existing_submitted_throws** — Submit a Draft to Admin Approval, then call `save_srt_form(payload, name)` → assert `ValidationError` with "Only Draft SRTs can be edited via this form".

All tests use the existing shared fixtures (`TEST_ITEM`, `_pick_warehouse`, `_cleanup_open_srt_for_item`).

## 7. Out of scope

- **Inline-edit list view** (replacing the doctype list view with a Tabulator). The doctype list stays; this form replaces the form view only when accessed via the dashboard.
- **Multi-doc bulk-create** (one form, many SRTs at once). Single-doc only.
- **Auto-save / draft autosave every N seconds.** Save is explicit via Save Draft button.
- **Mobile-optimized layout** below 768px. Form is desktop-first; mobile gets the responsive single-column fallback but no touch-optimized affordances.
- **Replace the native doctype form route.** `/app/stock-reconciliation-srt/<name>` continues to use Frappe's standard form (useful as a debug fallback). The new form is at `/app/srt-form`.
- **Real-time co-editing** (WebSocket multi-user awareness). Last-save-wins.
- **Form templates / "save as preset"** for repeated SRTs.

## 8. References

- App memory: `~/.claude/projects/-workspace/memory/app_kavach.md`
- Existing controller: `apps/.../doctype/stock_reconciliation_srt/stock_reconciliation_srt.py` — `validate()` runs the 9-step chain that save_srt_form dispatches through
- Existing dashboard (sibling pattern): `apps/.../page/srt_dashboard/`
- Existing module APIs reused: `apps/.../api.py` (`get_item_defaults`, `get_uom_conversion`, `get_batch_current_state`, `get_item_uoms_for_link`)
- Prior spec for context: `docs/specs/2026-05-23-srt-dashboard-design.md`
- Page HTML-comment gotcha: app-root §17, restricted-area "Don't use Jinja `{# ... #}` comments"
