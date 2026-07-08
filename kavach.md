# kavach — App Root Reference

**App**: `kavach` &nbsp;|&nbsp; **Version**: 0.0.1 &nbsp;|&nbsp;
**Publisher**: chaizup &nbsp;|&nbsp; **License**: MIT &nbsp;|&nbsp;
**Created**: 2026-05-20 (boilerplate) — Stock Reconciliation SRT DocType added 2026-05-21

---

## App Icon & Branding (2026-06-11)

**App Icon**: Brown thermometer with green boxes on white circle (from `refs/kavach.svg`).
**SRT Icon**: Stock audit clipboard with magnifying glass on white circle (from `refs/SRT.svg`).

### Asset Chain

| Asset | Path | Purpose |
|---|---|---|
| App logo | `public/images/kavach-logo.svg` | Logo on /apps tile, Desktop Icon, navbar |
| SRT module image | `public/images/stock-reconciliation-tracking.svg` | Stock Reconciliation Tracking module icon (from `refs/SRT.svg`) |
| Icon sprite | `public/icons/kavach-icons.svg` | SVG sprite: `icon-kavach-icon` (app icon), `icon-kavach-srt` (SRT icon from `refs/SRT.svg`) |
| Desktop icon solid | `public/icons/desktop_icons/solid/kavach.svg` | Sidebar icon variant (solid) |
| Desktop icon subtle | `public/icons/desktop_icons/subtle/kavach.svg` | Sidebar icon variant (subtle) |
| Desktop Icon JSON | `desktop_icon/kavach.json` | Registers Kavach as App-type tile, links to `/app/kavach` |
| Workspace Sidebar JSON | `workspace_sidebar/kavach.json` | Sidebar nav: Home (collapsible) + Stock Reconciliation child (module:`""`) |

### hooks.py wiring

- `app_logo_url` / `app_icon_url` → `/assets/kavach/images/kavach-logo.svg`
- `add_to_apps_screen` → `/app/kavach` tile with logo
- `app_include_icons` → `/assets/kavach/icons/kavach-icons.svg` (sprite with `icon-kavach-icon` + `icon-kavach-srt`)

### Workspace icon resolution

Workspace JSON `"icon": "kavach-srt"` → sprite symbol `icon-kavach-srt` (SRT audit icon).
Workspace Sidebar `"header_icon": "kavach-icon"` → sprite symbol `icon-kavach-icon` (app icon).

### Sidebar hierarchy

```
Kavach (collapsible, indent 0) → Kavach workspace
  └─ Stock Reconciliation (indent 1) → Kavach workspace (SRT doctypes)
```

---

## Valuation rate preservation (2026-05-21)

The stock team uses SRT and has limited rate knowledge by design. **SRT MUST NOT alter the existing valuation rate.**

**Implementation — two-pass submit in `_create_and_submit_erpnext_sr`:**

1. **Pass 1 — Insert.** SR Items are appended with `qty`, `batch_no`, `use_serial_batch_fields=1`, `current_qty` — but **no `valuation_rate`**. ERPNext's validate runs and populates `current_valuation_rate` per row from its own authoritative per-batch rate logic (a weighted/historical calc that doesn't match `MAX(sle.valuation_rate)`).
2. **Pass 2 — Mirror.** For each item, `it.db_set("valuation_rate", it.current_valuation_rate)`. The two fields now match, so ERPNext computes `stock_value_difference = qty_delta × existing_rate` — moving only qty.
3. **Submit.** `sr._submit()` per Quirk #2.

**Why not hand-roll the batch rate.** Tried `MAX(sle.valuation_rate)`: returned 4.09 for batch `6A01D26` where ERPNext's own engine considers 1.583 the actual rate. Our SQL doesn't replicate ERPNext's batch-rate computation. Two-pass is the only reliable approach.

**Live verification (CZMAT/1585, batch 6A01D26, +1g qty):**
| Field | Before SRT | After SRT submit |
|---|---|---|
| SR item.valuation_rate / current_valuation_rate | – | 1.583268601 / 1.583268601 (match=True) |
| Bin rate | 1.035492445 | 1.036156373 |
| Bin qty | 823.95 g | 824.95 g |
| Rate drift | – | 0.00066 (was 0.01373 before fix — 20× improvement) |

**Remaining Bin-rate drift (~0.0007) is mathematically unavoidable:** the Bin rate is the weighted average across batches. Adding 1g of a batch valued at 1.583 into a Bin whose mean is 1.035 mechanically shifts the mean upward. Each batch's OWN rate is preserved — that satisfies the spec's intent (operators didn't influence any rate).

## "1000.804 vs 1,000,803.27" UOM confusion (2026-05-21)

User reported: "I entered qty_found=1000 on B1 (autopopulated row); system shows 1,803.27g; I expected 1000.804."

The numbers come from **two different fields**:

| Field | Value when B1 counted=1000 (cf=1000) | Value if cf dropped to 1 (bug) |
|---|---|---|
| Total Qty Actually Found (in Default UOM) — Gram | **1,000,803.27 g** | 1,803.27 g (wrong) |
| Total Qty Actually Found (in Higher UOM) — Kg | **1,000.803 Kg** ≈ user's 1000.804 | 1.803 Kg |

The user was reading the Gram field while expecting Kg semantics. The Kg field DOES show 1000.803 — which matches their "1000.804".

The "1,803.27g" symptom (B1 contributing 1000 instead of 1,000,000) was caused by Frappe's child-grid editor occasionally dropping the hidden `conversion_factor` value when re-rendering a row on cell focus/blur. Defensive fix shipped in JS `_ipv_srt_resolve_cf` + Python `_resolve_row_cf` — both resolve cf from the row's own visible values (`current_stock_in_stock_uom ÷ current_stock_in_selected_uom`) when the stored field is missing, then fall back to `frm.doc.higher_uom_cf` when `select_uom == higher_uom`, then 1.0 as last resort.

If the user counted 1000 g of B1 (not 1000 Kg), they should change the row's Select UOM column to Gram BEFORE typing. Once select_uom=Gram, cf=1 and qty_found=1000 stores as 1000g.

---

## Workflow + RBAC (2026-05-21)

**Roles shipped by `install.py`:**

| Role | Capability |
|---|---|
| **Srt User** | Create + edit own drafts. Cannot submit, cancel, delete. (`if_owner=1`) |
| **Srt Admin** | Submit SRT (creates draft ERPNext SR) + cancel SRT (deletes draft SR or, if SR still in draft, deletes it). |
| **Srt Super Admin** | Submit the linked ERPNext SR (the actual SLE/GL post) + cancel both SRT and SR. |
| **System Manager** | All operations including delete (override path). |

**Workflow shipped by `install.py:_ensure_workflow()` — name "Stock Reconciliation SRT Workflow":**

| Workflow State | doc_status | Edit allowed |
|---|---|---|
| Draft                  | 0 (Draft)     | Srt User |
| Admin Approval         | 1 (Submitted) | Srt Admin |
| Super Admin Approval   | 1 (Submitted) | Srt Super Admin |
| Close                  | 2 (Cancelled) | Srt Super Admin |

**Workflow transitions:**

| From → To | Action | Allowed | Side effect |
|---|---|---|---|
| Draft → Admin Approval | Approve | Srt Admin | `on_submit` creates draft ERPNext SR (rate-mirror done at insert time) |
| Admin Approval → Super Admin Approval | Approve | Srt Super Admin | (workflow only; the actual SR submit is triggered via the "Submit Linked ERPNext SR" button → `submit_linked_sr()`) |
| Admin Approval → Close | Close | Srt Admin / Srt Super Admin | `on_cancel` deletes the draft ERPNext SR (no SLE rollback needed) |
| Super Admin Approval → Close | Close | Srt Super Admin | `on_cancel` cancels the submitted SR (full SLE/GL rollback by ERPNext) |

**Lifecycle split — what happens server-side at each transition:**

```
Srt User           Srt Admin                Srt Super Admin
   │                  │                          │
[Draft]──Approve──▶[Admin Approval]──Approve──▶[Super Admin Approval]
                       │                          │
                       │  on_submit               │  submit_linked_sr() via JS button
                       │  → create draft SR       │  → applies SABB monkey-patches
                       │  → mirror rate           │  → toggles Stock Settings flags
                       │  → linked_erpnext_sr     │  → sr._submit()
                       │     populated            │  → Bin updated (qty only;
                       │                          │     rate preserved per batch)
                       │                          │
                       └──Close──┐         ┌──Close──┘
                                 │         │
                            (delete SR)  (cancel SR + cascade SLE rollback)
                                 ▼         ▼
                              [Close]   [Close]
```

**Validation: duplicate-item guard.** `validate()` runs `_enforce_no_duplicate_open_srt_for_item()` — blocks creating a second SRT for an item with an existing open one (docstatus IN (0,1)). Cancellation (docstatus=2) frees the item for a new SRT. Amendments skip the check (`amended_from` set).

**Remarks + Approval audit fields** (2026-05-21):

| Field | Type | Behaviour |
|---|---|---|
| `user_remark` | Text Editor | Optional. Filled by Srt User during draft. Frozen after submit. |
| `admin_remark` | Text Editor | Optional. Filled by Srt Admin before Draft → Admin Approval. Frozen after submit. |
| `super_admin_remark` | Text Editor (`allow_on_submit=1`) | Optional. Filled by Srt Super Admin **on the submitted doc** before clicking "Submit Linked ERPNext SR". |
| `admin_approved_by` | Link → User, read-only | Auto-stamped to `frappe.session.user` in `on_submit` (Draft → Admin Approval). |
| `super_admin_approved_by` | Link → User, read-only | Auto-stamped to `frappe.session.user` in `submit_linked_sr` (Admin Approval → Super Admin Approval). |

`super_admin_remark` carries `allow_on_submit=1` because the super admin types it AFTER the SRT is already at docstatus=1 — without the flag, Frappe's `validate_update_after_submit` would block the save. The two `*_approved_by` fields are set via `db_set` which bypasses that check, so they don't need the flag.

**Role-gated field-level write perms** (2026-05-21):

| Field | Writable by | Writable in state |
|---|---|---|
| `user_remark` | Doc owner only | Draft |
| `admin_remark` | Srt Admin (or Srt Super Admin) | Draft |
| `super_admin_remark` | Srt Super Admin | Admin Approval |

System Manager + Administrator bypass all three. Enforcement happens in BOTH places (must keep them in sync):

- **Server** (`_enforce_remark_field_permissions` in validate): authoritative gate. Compares the new value against `self.get_doc_before_save()` so re-saves by a different role only fail if THAT role's field is the one that changed. Throws `Field Locked` ValidationError on mismatch.
- **Client** (`_ipv_srt_apply_remark_field_locks` in JS refresh): cosmetic visual lock via `frm.set_df_property(..., "read_only", ...)`. Prevents the user from typing into a field that the server would reject on save.

**Validation: no zero-delta ticked rows** (2026-05-21). `validate()` runs `_enforce_no_zero_delta_on_ticked_rows()` — blocks save when a row has Do Reconcile ticked AND `qty_found ≈ current_stock_in_selected_uom` (within epsilon `0.001`, matching the field's `precision=3` display digits). Rationale: a ticked row with no delta would post a SR Item with `stock_value_difference=0` — almost always operator error. Error message lists each offending batch with its values. Don't tighten epsilon below 0.001 (would force the user to perceive sub-displayable differences); don't skip the check on any workflow state (the row is wrong at any stage).

**Validation: ≥1 row must be ticked to save** (2026-05-21). `validate()` runs `_enforce_at_least_one_reconcile_ticked()` — blocks the draft save when zero rows have `is_counted=1`. Skipped when the user hasn't picked item+warehouse yet (so the validation doesn't pre-empt the mid-fill state). Skipped on cancelled docs (docstatus=2). Rationale: empty SRTs would clog the duplicate-item guard while having no actionable content.

**Nobody can delete except System Manager.** The DocType permission grid: `delete=0` for Srt User, Srt Admin, Srt Super Admin; `delete=1` only for System Manager. The "Close from Draft" UX for mistakenly-added drafts is handled by the workflow transition Draft→Admin Approval→Close (Srt Admin or Super Admin must approve first, then close); pure-draft soft-delete is **not** supported (drafts that were never approved sit at docstatus=0 forever or get cleaned up by System Manager).

---

## Foolproof SR creation + Super-Admin relink/backfill (2026-06-26)

**Bug:** via API/OAuth approval, an SRT sometimes landed at **Admin Approval** with **no linked draft ERPNext SR** (orphan half-state). Approved-By-System (Case 1) SRTs are *not* this bug — they correctly never get an SR because every counted batch matched current stock.

**Root cause:** `_create_erpnext_sr_draft` did `frappe.db.commit()` *inside* `on_submit`, flushing `docstatus=1` before the `linked_erpnext_sr` back-link was written. A transient error after that commit (lock wait / reload / network — likelier under concurrent OAuth load → "sometimes") stranded the SRT approved-but-unlinked.

**The fix (3 parts):**
1. **Atomic `on_submit`** — removed the mid-submit commit; the draft SR + back-link now commit (or roll back) *with* the submit. On failure the SRT stays **Draft** to retry — never approved-without-SR.
2. **`ensure_linked_sr()`** idempotent self-heal (reused by submit + backfill; never runs for Approved By System).
3. **Super-Admin list-view relink** — `backfill_missing_sr()` / `get_backfill_candidates()` + `stock_reconciliation_srt_list.js`: a hyperlink column for the linked SR (red "⚠ Missing — relink" on orphans) and a **Relink ERPNext SR** button group ("Scan & Fix All Missing" = empty links; "Fix Selected" = also repairs cancelled/deleted-SR links).

**Posting-date fidelity (user requirement):** a relinked SR inherits the SRT's **original** posting **date and time** (even backdated), never the relink-click time — same `_create_erpnext_sr_draft` path with the `set_posting_time=1` guard. Proven by `tests/test_backfill_relink.py`.

Full writeup + restricted areas: `stock_reconciliation_tracking/doctype/stock_reconciliation_srt/stock_reconciliation_srt.md` § 9b.

---

## 0. Operating model — IMPORTANT (2026-05-21)

The doc operates on **one item × one warehouse** at a time. The user:
1. Picks `item`
2. Picks `default_warehouse` — this triggers the auto-populate of:
   - Parent totals (Default UOM + Higher UOM, all scoped to this warehouse)
   - Higher UOM and its conversion factor (resolved from the item master's UOM Conversion Detail — largest CF non-stock UOM, e.g., Gram (default) + Kg → `higher_uom=Kg, cf=1000`)
   - Batches table — one row per batch in this warehouse with qty > 0
3. Each child row has:
   - **Do Reconcile** checkbox (first column, unchecked by default) — explicit user opt-in per row
   - `warehouse` auto-set to `parent.default_warehouse` (READ-ONLY)
   - `item_code` auto-set to `parent.item` (READ-ONLY)
   - `item_name_selected` auto-set to `parent.item_name` (READ-ONLY)
   - User edits: tick **Do Reconcile**, choose `select_uom`, type `qty_found`. Optionally `batch_no` for batches not auto-populated.
4. On submit, only rows where **Do Reconcile is ticked** become ERPNext SR items. Untickled rows' `qty_found` is IGNORED — the batch retains its current ledger stock. Each SR Item carries the explicit `warehouse` from the child row.

**Changing `item` OR `default_warehouse` on a draft AUTO-RESETS** all child rows + parent totals to the new (item, warehouse) pair. No confirm prompt (per spec). Submitted/cancelled docs are not auto-reset.

Field labels do NOT include "(Parent Component N)" — that pattern was an early hint in the spec to disambiguate field positions, not a literal label requirement.

---

## 1. Why this app exists

ERPNext's native **Stock Reconciliation** form expects the operator to manually fill one row per `(item, warehouse, batch)` tuple — both the counted qty AND the valuation rate. At scale (a chaizup SFG item like `CZMAT/1585` has **1009 batches**), this is unworkable. A counter doing a physical count walks the warehouse with a tablet, opens a row, scans a batch, types what they found, moves on. The native form forces:

1. Manually identifying every batch with positive stock (no auto-populate)
2. Looking up the current bin qty for each row (no pre-fill)
3. Typing the valuation rate every time (or accepting whatever ERPNext computes)
4. Doing UOM conversion in their head when scales report in Kg but stock is in Grams

This app adds **Stock Reconciliation SRT** (Stock Reconciliation Tracking) — a wrapper DocType that:

- **Auto-populates** the entire batches table from the current Bin on item-pick.
- **Live-recomputes** the totals in BOTH a chosen Higher UOM (e.g., Kg) and the item's Stock UOM (e.g., Gram) as the operator types.
- Lets the operator **count only what they touched** — rows where Qty Found is left blank are EXCLUDED from the real SR on submit, so uncounted batches retain their pre-existing Bin qty without any SLE delta.
- On submit, **automatically creates + submits a real ERPNext Stock Reconciliation** containing only the counted rows + the operator's chosen UOM (converted to stock UOM behind the scenes) + the current Bin valuation rate.

The real ERPNext SR is the **audit-evidence document**; the SRT doc records the count session (who, when, in what UOM) and gets a forward-link from the SR via `custom_remarks`.

---

## 2. Module map

| Module | Folder | Purpose |
|---|---|---|
| Stock Reconciliation Tracking | `kavach/kavach/` | The only module — contains both DocTypes + the API |

### DocTypes shipped

| DocType | Type | Folder |
|---|---|---|
| **Stock Reconciliation SRT** | Submittable parent | `doctype/stock_reconciliation_srt/` |
| **Batch List** | Child of SRT | `doctype/batch_list/` |

### Whitelisted API (`kavach.stock_reconciliation_tracking.api`)

| Method | Purpose |
|---|---|
| `get_item_defaults(item_code)` | Returns the full auto-populate payload (parent fields 2-7 + batches list) for a picked item. ONE round-trip per item-change. |
| `get_item_uoms(item_code)` | Returns `[uom_name, …]` — the UOMs configured on the item master (stock UOM first, then alt UOMs by descending CF). Used by `select_uom` set_query so the picker shows only valid UOMs per the spec. |
| `get_item_uoms_for_link(doctype, txt, searchfield, start, page_len, filters)` | Frappe Link-query compatible variant of `get_item_uoms`. Used as the `query` param in the Batch List grid's `select_uom` set_query. Returns `[[uom_name], …]`. |
| `get_uom_conversion(item_code, uom)` | Returns the conversion factor for `(item, uom)` — used when the operator changes Select UOM on a child row. |
| `get_batch_current_state(item_code, batch_no)` | Returns current (warehouse, qty, valuation_rate) for a manually-typed batch. |

### Reports shipped

| Report | Type | ref_doctype | Folder |
|---|---|---|---|
| **Work Order Consumption Cost Analysis** | Script Report | Work Order | `kavach/stock_reconciliation_tracking/report/work_order_consumption_cost_analysis/` |
| **Batch Moving Costing vs Origin Analysis** | Script Report | Batch | `kavach/stock_reconciliation_tracking/report/batch_moving_costing_vs_origin_analysis/` |

**WO Consumption Cost Analysis** — per-batch manufacturing consumption cost +
batch-origin traceability (stock UOM), integrated with ERPNext (Work Order /
Stock Entry / Batch / SLE / Serial and Batch Bundle) and chaizup_toc custom
fields (`Work Order.custom_mrp`, `Item.custom_mrp`, `Work Order.workflow_state`,
guarded by `has_column`). See § 27.

**Batch Moving Costing vs Origin Analysis** — a batch **movement ledger** (one
row per item × batch × voucher × direction, single-direction rows) with a
per-movement **Maintains Origin Rate?** verdict that flags where a batch's cost
drifted from origin, plus the batch origin voucher. See § 28.

Both read-only; both registered in `install.py → _STANDARD_REPORTS`.

---

## 3. Dependencies

| Dependency | Why |
|---|---|
| `frappe` | DocType framework, ORM, permission engine, whitelisted API |
| `erpnext` | The native Stock Reconciliation doctype, Bin, Item, Batch, Serial and Batch Bundle, Stock Ledger Entry |
| `chaizup_audit_site_specifics` (memory) | Custom field `Stock Reconciliation.custom_remarks` is mandatory; Stock Adjustment account name |
| `erpnext_bulk_reconcile_quirks` (memory) | 9 quirks for batched-item SR submit; in particular Quirk #2 (silent submit), #6 (expense_account), #7 (use_serial_batch_fields=1), #13 (batch_no per row) |

---

## 4. Architecture — data flow on submit

```
   ┌─ Stock Reconciliation SRT (submittable parent) ─┐
   │   item:                CZMAT/1585               │
   │   default_uom:          Gram                    │
   │   higher_uom:           Kg          (CF 1000)   │
   │   posting_date/time:    2026-05-21 09:10        │
   │   batches: [                                    │
   │     {batch_no=6A01D26,      is_counted=0,  ...} │ ← uncounted, EXCLUDED
   │     {batch_no=CZPRD/...,    is_counted=1,      │
   │      qty_found=2.0,  select_uom=Kg, cf=1000,   │
   │      current_stock_in_stock_uom=282.560,       │
   │      warehouse=WAREHOUSE 1.9 …}                │ ← included, qty=2000 g
   │     {batch_no=FIX-CZMAT/...,is_counted=0,  ...} │ ← uncounted, EXCLUDED
   │   ]                                             │
   └──────────────┬──────────────────────────────────┘
                  │ on_submit
                  ▼
   ┌─ ERPNext Stock Reconciliation (auto-created) ─┐
   │   purpose:           Stock Reconciliation       │
   │   posting_date/time: 2026-05-21 09:10           │
   │   expense_account:   Stock Adjustment - CCP     │
   │   custom_remarks:    "Created via SRT-RECO-... │
   │                       Counted 1 of 3 batches…" │
   │   items: [                                      │
   │     {item_code=CZMAT/1585,                      │
   │      batch_no=CZPRD/14976/3/2026,               │
   │      warehouse=WAREHOUSE 1.9 …,                 │
   │      qty=2000 (= 2 Kg × 1000 CF),               │
   │      current_qty=282.560,                       │
   │      valuation_rate=1.035 (Bin),                │
   │      use_serial_batch_fields=1}                 │
   │   ]                                             │
   │   → docstatus = 1 (auto-submitted)              │
   └─────────────────────────────────────────────────┘
```

The 2 uncounted batches stay at their pre-existing Bin qty — no SLE entry created for them, no impact.

---

## 5. Field map (parent)

| User-spec position | Fieldname | Type | Read-only | Purpose |
|---|---|---|---|---|
| 1 | `item` | Link → Item | – | The item to reconcile (mandatory) |
| 2 | `default_uom` | Link → UOM | ✓ | = Item.stock_uom — autopopulated |
| 3 | `total_current_stock_in_default_uom` | Float | ✓ | Σ Bin.actual_qty across warehouses, snapshot |
| 4 | `total_qty_found_in_default_uom` | Float | ✓ | Σ over rows: qty_found×CF if counted, else current stock |
| 5 | `higher_uom` | Link → UOM | ✓ | Largest-CF UOM in item ladder (fallback stock UOM) |
| 6 | `total_current_stock_in_higher_uom` | Float | ✓ | = field 3 ÷ higher_uom_cf |
| 7 | `total_qty_found_in_higher_uom` | Float | ✓ | = field 4 ÷ higher_uom_cf |
| 8 | `posting_date` | Date | conditional | Read-only unless `edit_posting=1` |
| 9 | `posting_time` | Time | conditional | Read-only unless `edit_posting=1` |
| 0 | `edit_posting` | Check | – | Toggle that lifts the read-only on 8 & 9 |
| 10 | `batches` | Table → Batch List | – | One row per (batch, warehouse) with current stock > 0 |
| — | `linked_erpnext_sr` | Link → Stock Reconciliation | ✓ | Set on submit. Audit-trail back-link. |
| — | `company` | Link → Company | – | Resolves the Stock Adjustment account on submit |
| — | `naming_series` | Select | – | `SRT-RECO-.YYYY.-.#####` |

---

## 6. Field map (child — Batch List)

Per the user's spec — 7 visible columns sized for readability:

| # | Fieldname | Type | Read-only | Columns | Purpose |
|---|---|---|---|---|---|
| 1 | `batch_no` | Link → Batch | – | 2 | The batch being counted |
| 2 | `select_uom` | Link → UOM | – | 1 | UOM the counter reports in (default = higher UOM) |
| 3 | `qty_found` | Float | – | 2 | Physical count in `select_uom` |
| 4 | `current_stock_in_selected_uom` | Float | ✓ | 2 | = current_stock_in_stock_uom ÷ conversion_factor |
| 5 | `stock_uom` | Link → UOM | ✓ | 1 | Mirror of Item.stock_uom |
| 6 | `current_stock_in_stock_uom` | Float | ✓ | 2 | The Bin's qty for this (batch, warehouse) |
| 7 | `item_name_selected` | Data | ✓ | 1 | Mirror of Item.item_name |

Plus 4 internal helper fields (`warehouse`, `conversion_factor`, `valuation_rate`, `is_counted`).

**`is_counted`** is the critical sentinel: Frappe stores `0.0` for unset Float fields, which means `qty_found is None` cannot distinguish "user typed 0" from "user left blank". The JS controller sets `is_counted=1` the moment the user types ANYTHING in `qty_found` (including 0). Python's submit filter uses `is_counted` instead of inspecting `qty_found` directly.

---

## 7. Restricted areas (do NOT change without architectural review)

1. **`is_counted` is the source of truth for "this row was counted".** Do NOT switch back to inspecting `qty_found is None / != ""` — Frappe's Float type stores 0.0 for unset, and that filter would silently include every uncounted row in the SR and wipe their stock to 0.
2. **`custom_remarks` on the linked ERPNext SR is MANDATORY** on the chaizup site (custom field, reqd=1). Don't switch to `remarks` — that column doesn't exist.
3. **Submit uses `sr._submit()` (low-level method), NOT `sr.submit()`.** Per `erpnext_bulk_reconcile_quirks` Quirk #2, validate_negative_qty_in_future_sle swallows the throw and leaves docstatus=0 if you use the high-level method. Also need `doc.reload()` + `assert docstatus == 1` after commit.
4. **The 5 SerialandBatchBundle monkey-patches** (in `_apply_validation_patches`) MUST be applied before submit. Without them, submit silently no-ops on legitimate reconciliations.
5. **`expense_account` differs by purpose**:
   - Purpose=`Stock Reconciliation` → `Stock Adjustment` (P&L)
   - Purpose=`Opening Stock` → `Temporary Opening` (Balance Sheet)
   - We use Purpose=`Stock Reconciliation` so the account is queried via `account_type='Stock Adjustment'`.
6. **`use_serial_batch_fields=1` per SR Item row** — without it the SR won't accept the batch_no at row level (Quirk #7).
7. **`linked_erpnext_sr` is the audit-trail forward link.** Don't rename without updating `on_cancel` (which queries it for cascade cancel) AND any downstream audit queries.
8. **Stock Settings `allow_negative_stock` is toggled inside `_create_and_submit_erpnext_sr`** and restored in `finally`. Don't move the toggle outside the try block — a submit failure would leave the site in `allow_negative_stock=1` state and could allow user-driven negative stock until next restart.
9. **`select_uom` picker is restricted to the item's UOM master** via `set_query` → `get_item_uoms_for_link`. The Link query is item-scoped (re-installed on every item change in `onload` + `refresh`). Do NOT replace this with an unrestricted Link picker — the spec is explicit that only UOMs configured on the item master are valid options.
10. **`batch_no` picker is restricted to the parent item + excludes already-picked batches.** Server validate (`_enforce_no_duplicate_rows`) is the authoritative duplicate guard; the JS filter is cosmetic. Don't drop the server validate even when the JS filter is in place — users with permission to bypass JS (e.g., bulk inserts via API) need the server check.
11. **`is_counted` is the "Do Reconcile" checkbox.** Internal fieldname stays `is_counted` to preserve stored data; label is "Do Reconcile". Default = unchecked. The user MUST explicitly tick the box for each row they want to reconcile — typing in `qty_found` no longer auto-ticks the row (removed 2026-05-21). Don't restore the auto-tick — it bypasses the user's opt-in.
12. **Parent `default_warehouse` is the single warehouse scope for the whole doc.** All totals + the batches list are scoped to this warehouse. Child rows' `warehouse` and `item_code` are READ-ONLY in the JSON and auto-stamped from the parent on:
    - JS `batches_add` event (UI-triggered row add)
    - Server `validate()` → `_stamp_child_warehouse_and_item()` (API-triggered row add, fixture import, anything that bypasses JS)
    Do NOT remove either side of the auto-stamp — the JS-only stamp fails for REST API callers; the server-only stamp shows a blank warehouse on the form until first save (poor UX).
13. **Valuation rate is NEVER set by SRT operators.** Two-pass insert: SR Item gets `valuation_rate=blank` on insert; after ERPNext populates `current_valuation_rate` from its own per-batch logic, mirror it back via `db_set`. Don't (a) skip this mirror step, (b) re-introduce hand-rolled batch-rate SQL (`MAX(sle.valuation_rate)` mismatches ERPNext's engine), or (c) expose `valuation_rate` in the Batch List grid (would let operators introduce drift).
14. **`get_item_defaults(item_code, warehouse=None)` has two modes**:
    - With `warehouse` → totals + batches list are warehouse-scoped (one Bin row, one warehouse's worth of batches). This is the live UI path.
    - Without `warehouse` → multi-warehouse aggregate (legacy/back-compat for any pre-default_warehouse callers). Don't remove the no-warehouse branch without auditing all callers of the API endpoint.

---

## 8. Use cases

### 8.1 Monthly bin audit (counter walks the warehouse with a tablet)

1. Operator opens `/app/stock-reconciliation-srt/new` on tablet.
2. Picks item — auto-populates 42 batches across 2 warehouses.
3. Visits one batch in WH 1.9. Scale reads 2.5 Kg. Operator types `2.5` in the Kg-defaulted Select UOM cell.
4. JS sets `is_counted=1` on that row, recomputes parent totals → Total Found = (other batches' current) + 2500 g.
5. Operator skips the 41 batches they didn't visit (no time / not their zone).
6. Operator saves draft, hands off shift; another operator opens the draft, counts more rows, submits.
7. Submit creates ERPNext SR with the 1-5 counted rows, posts at SRT's posting_date, auto-submits.

### 8.2 Backdated cleanup (audit team correcting historical drift)

1. Operator opens `/app/stock-reconciliation-srt/new`, picks the affected item.
2. Toggles **Edit Posting** = 1.
3. Sets posting_date to a backdated date + posting_time = 1 sec before some over-consumption SLE.
4. Auto-populated batches table loaded (note: still shows TODAY's batch list — for true backdated reconciliation, manually add the batches that existed at that date).
5. Types qty_found per batch and submits.
6. The ERPNext SR is posted at the chosen backdated date with proper PCAOB-defensible `custom_remarks`.

### 8.3 Partial count with deliberate "found zero"

A counter visits batch X. Scale reads 0 (they were told it should be 100 g, but they actually found 0). They type `0` in Qty Found. The JS controller's `qty_found` handler:
- Sees `0 !== null && 0 !== ""`, so sets `is_counted=1`
- Recomputes parent totals: that row contributes 0 to the "found" sum
- On submit, ERPNext SR has a row with qty=0 → SLE delta of -100 g → audit cleanup of the lost stock

This is why `is_counted` is essential — without it, `0` would be indistinguishable from "blank".

---

## 9. Database connections

| DocType (in this app) | Links to | Direction |
|---|---|---|
| Stock Reconciliation SRT | `Item`, `Company`, `UOM`, `Stock Reconciliation` (via `linked_erpnext_sr`) | This app → ERPNext |
| Batch List | `Batch`, `UOM`, `Warehouse` | This app → ERPNext |

| Read-only queries the API runs | Target table |
|---|---|
| Item meta (item_name, stock_uom, disabled, has_batch_no) | `tabItem` |
| UOM ladder for higher-UOM picker | `tabUOM Conversion Detail` |
| Total stock per item | `tabBin` |
| Batch balances per (batch, warehouse) | `tabStock Ledger Entry` JOIN `tabSerial and Batch Bundle` JOIN `tabSerial and Batch Entry` |
| Stock Adjustment account | `tabAccount WHERE account_type='Stock Adjustment'` |

| Writes on submit |
|---|
| New `Stock Reconciliation` doc with N children (`Stock Reconciliation Item`) — N = rows with `is_counted=1` |
| `linked_erpnext_sr` set on this SRT doc post-commit |

---

## 9b. "Module Stock Reconciliation Tracking not found" (resolved 2026-05-21)

**Symptom (from the user):**
> Opening `/app/stock-reconciliation-srt` or typing **Stock Reconciliation SRT** in the AwesomeBar shows
> *"Not found / Module Stock Reconciliation Tracking not found / The resource you are looking for is not available."*
> Persists in incognito mode. Persists after `bench clear-cache`.

**Root cause.** The app was listed in `sites/apps.txt` (bench-level) but its row was **missing from `tabInstalled Application`** (site-level). Production restore on 2026-05-20 replaced the dev site's `tabInstalled Application` table with production's, which never had SRT.

**Why the desk UI broke but `bench --site <site> shell` worked.** In `frappe/__init__.py:210`:
```python
setup_module_map(include_all_apps=not (frappe.request or frappe.job or frappe.flags.in_migrate))
```
- In a **request** context, `include_all_apps=False` → reads SITE-installed apps from `client_cache:installed_app_modules`, which is rebuilt from `tabInstalled Application`. SRT missing → module lookup fails → 404 "Module not found".
- In a **shell** context (no `frappe.request`), `include_all_apps=True` → reads `apps.txt` directly, which had SRT → all worked.

That asymmetry made the bug invisible to bench-shell smoke tests.

**One-time recovery.** From a bench-shell python:
```python
from frappe.installer import add_to_installed_apps
add_to_installed_apps("kavach")
frappe.db.commit()
frappe.client_cache.delete_value("installed_app_modules")
frappe.client_cache.delete_value("module_installed_app")
frappe.clear_cache()
```
Next HTTP request rebuilds the module map from the now-correct site-installed-apps list. No bench restart needed for `bench serve` (Werkzeug rebuilds per-request).

**Permanent guard.** `kavach/install.py:_ensure_site_install_record()` is wired into both `after_install` and **`after_migrate`** hooks. `bench migrate` is always run after a backup restore in the chaizup runbook — so any future restore self-heals on the migrate step. The function is idempotent (no-op when the row already exists).

**Verification (2026-05-21):**
| Endpoint | Before | After |
|---|---|---|
| `GET /api/method/frappe.desk.form.load.getdoctype?doctype=Stock+Reconciliation+SRT` | 404 "Module not found" | 200 with DocType JSON |
| `GET /api/method/frappe.desk.search.search_link?…txt=Stock+Reconciliation+SRT` | empty | finds the DocType |
| `GET /api/method/kavach.…api.get_item_defaults?item_code=CZMAT/1585` | (untested) | 200 with 42 batches |

---

## 11. Case 1 (auto-approve) + Case 2 (auto-untick) — 2026-05-22

### Spec
`docs/specs/2026-05-22-srt-case1-case2-design.md`

### Case 1 — all ticked batches match current stock

When `validate()` finds EVERY ticked row has `qty_found ≈ current_stock_in_selected_uom` (epsilon 0.001), `_classify_zero_delta_ticks` sets `self.flags.all_matched_no_delta = True`. On submit, `on_submit()` branches:

- No ERPNext Stock Reconciliation is created (`linked_erpnext_sr` stays NULL)
- `workflow_state` set directly to `"Approved By System"` (overrides workflow's default `Admin Approval` set by the Approve action)
- `admin_approved_by` + `super_admin_approved_by` both stamped to `frappe.session.user` (the Srt Admin who clicked Approve)
- `admin_remark` + `super_admin_remark` filled with the module constant `SYSTEM_APPROVE_MESSAGE` (only if empty — preserves manually-typed admin notes)
- Green dashboard banner on the form documents WHY there's no linked SR

### Case 2 — mixed (some match, some delta)

`_classify_zero_delta_ticks` silently sets `is_counted = 0` on matching rows. Real-delta rows stay ticked and proceed through the normal `Draft → Admin Approval → Super Admin Approval` flow.

### Workflow change

`install.py:_ensure_workflow()` now:
- Always ensures prerequisite Workflow State + Workflow Action Master rows (moved out of the fresh-install-only branch — was the cause of `LinkValidationError: State: Approved By System` on existing sites during the upgrade)
- Idempotently appends the `Approved By System` row to the existing Workflow's `.states` table via `_ensure_workflow_state_row()`
- Idempotently appends the `Approved By System → Close` transition via `_ensure_workflow_transition()`
- Both upgrade helpers are no-ops when the row already exists, so `after_migrate` is safe to re-run on every `bench migrate`

### Restricted areas (additional, 2026-05-22)

- Don't reorder `validate()` to put `_classify_zero_delta_ticks` AFTER `_enforce_at_least_one_reconcile_ticked` — the classifier unticks matched rows in Case 2; if the count check runs first it may pass before the auto-untick reduces the count to zero.
- Don't replace `getattr(self.flags, "all_matched_no_delta", False)` with direct `self.flags.all_matched_no_delta` — `flags` is per-request and `AttributeError`s on first save of a fresh doc.
- Don't change `SYSTEM_APPROVE_MESSAGE` text without user approval.
- Don't call `self.save()` or `self.db_update()` inside `_route_to_system_approved()` — both re-run validate() which the remark-field-permission gate rejects for cross-role writes.
- Don't drop `_ensure_workflow_transition()`'s OR `_ensure_workflow_state_row()`'s presence check — `after_migrate` re-runs on every `bench migrate`; duplicating rows would silently corrupt the workflow.
- Don't switch remark fill from "only if empty" to "always overwrite" without user approval.
- Don't stamp `super_admin_approved_by` to a literal "System" string — it's `Link → User`; a non-existent user breaks joins.
- Don't move the prerequisite `_ensure_workflow_state(...)` calls back inside the fresh-install-only branch. Pre-2026-05-22 sites whose workflow already exists need those rows to exist BEFORE `_ensure_workflow_state_row` references them.

### Verification

5 assertion-based tests in `kavach/tests/test_case1_case2.py`. Run via:

```bash
bench --site development.localhost execute \
  kavach.tests.test_case1_case2.run_all
```

Live result 2026-05-22: 5 / 5 passed.

---

## 13. SRT Settings + Minimum Gap Between SRTs — 2026-05-22 (v0.0.3)

### Spec
`docs/specs/2026-05-22-srt-settings-gap-design.md`

### What was added

- **New Single DocType `SRT Settings`** at `/app/srt-settings`. One field today:
  `gap_between_stock_reconciliation_days` (Int, default 0). Future
  cross-cutting settings will live here.
- **Workspace integration** — new "Setup" card-break + SRT Settings link
  + SRT Settings shortcut, visible on `/desk/stock-reconciliation-tracking`.
- **New validate-time gate** on `Stock Reconciliation SRT`:
  `_enforce_min_gap_between_srts()`. Reads SRT Settings on every save
  (no caching layer on top of `frappe.db.get_single_value`). Throws
  `SRT Gap Violation` when the new SRT's posting_date is within
  `gap_days` of the most recent SRT for the same item with
  `docstatus IN (1, 2)` — symmetric (`abs(date_diff)`).

### Behaviour

- `gap_days = 0` (default) → feature off
- Amendments skip the check (`amended_from` early-return)
- Auto-approved (Approved By System) docs COUNT as prior reconciliations
- Same-item rule (NOT same-item-same-warehouse)
- Configurable anytime by Srt Super Admin / System Manager; new value
  takes effect on the next save (no retroactive invalidation)
- `docstatus=1` priors are also picked up by the existing duplicate-open
  guard — user sees the duplicate-open error first; gap rule's distinct
  value is enforcing spacing AFTER the prior SRT reaches Close (docstatus=2)

### Permissions

| Role | SRT Settings access |
|---|---|
| System Manager | full (read/write/create/print/email/export/share/report) |
| Srt Super Admin | read/write/create/print/report |
| Srt Admin | read-only/print |
| Srt User | none |

### Restricted areas (additional, 2026-05-22 v0.0.3)

- Don't rename `gap_between_stock_reconciliation_days` —
  `_enforce_min_gap_between_srts` reads it by literal fieldname.
- Don't filter the prior-SRT query by warehouse — spec is same-item.
- Don't skip the check for Approved By System docs — they're docstatus=1
  reconciliations.
- Don't add a per-doc "ignore gap" flag without an audit-permission gate.
- Don't cache the SRT Settings value — read fresh on every validate so
  reconfig takes effect immediately.
- Don't shrink the prior-SRT query to docstatus=1 only — would miss the
  closed/historical reconciliations the gap rule is meant to space against.

### Verification

5 assertion-based tests in `kavach/tests/test_srt_settings_gap.py`:
- `test_gap_disabled_allows_back_to_back`
- `test_gap_blocks_within_window`
- `test_gap_allows_after_window`
- `test_amendment_skips_gap`
- `test_gap_reconfig_takes_effect_immediately`

Run via:

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_settings_gap.run_all
```

Live result 2026-05-22: 5 / 5 passed. Regression suite (Case 1 / Case 2): 5 / 5 still passing.

---

## 14. Duplicate-Open Guard — Workflow-State-Aware Fix (2026-05-22 v0.0.4)

### Bug

User report on `CZMAT/133`: after approving a SRT all the way through to
**Super Admin Approval** (docstatus=1, ERPNext SR submitted, SLE/GL posted),
attempting to create a NEW SRT for the same item failed with:

> Cannot create a new SRT for item CZMAT/133: SRT SRT-RECO-2026-00053 is
> already open (status: Super Admin Approval). Close the existing SRT
> before starting a new one.

### Root cause

`_enforce_no_duplicate_open_srt_for_item` queried `docstatus IN (0, 1)`
uniformly, treating ALL submitted docs as "still open" regardless of
workflow_state. From the user's mental model the reconciliation IS done
once the ERPNext SR is posted — the guard was over-strict.

### Fix

The guard now considers `workflow_state` alongside `docstatus`. Two
"completed" workflow states are non-blocking at docstatus=1:

- `Super Admin Approval` — ERPNext SR submitted, stock posted
- `Approved By System`   — Case 1 path, no SR needed, settled

Still-blocking conditions:

- docstatus=0 (any draft)
- docstatus=1 with workflow_state="Admin Approval" (SR still draft)
- docstatus=1 with workflow_state NULL/empty (defensive — catches
  direct-API submits that bypassed the workflow framework)

Always non-blocking:

- docstatus=2 (Close — terminal)

The gap rule (`_enforce_min_gap_between_srts`) still runs AFTER this
check and provides spacing once the prior SRT is complete. Set gap=0
to allow back-to-back; set gap>0 to throttle.

### Restricted areas (additional, 2026-05-22 v0.0.4)

- Don't widen `COMPLETED_STATES` to include "Admin Approval" — would
  allow parallel-write races on the same item while the prior's ERPNext
  SR is still draft.
- Don't remove the workflow_state NULL/empty defensive clause — direct-
  API submits bypass the workflow framework and leave workflow_state
  empty; treating those as "open" is the safe default.

### Verification

3 new tests in `test_srt_settings_gap.py`:
- `test_super_admin_approval_does_not_block_new_srt` (the exact bug)
- `test_approved_by_system_does_not_block_new_srt` (companion case)
- `test_admin_approval_still_blocks_new_srt` (negative — must still block)

All 8/8 gap tests + 5/5 Case 1/2 regression tests pass on dev site.

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

Live result 2026-05-22: 4 / 4 passed. Cross-suite regression: 17/17 across all 3 suites.

---

## 16. List-View "Status" Column Deduplication (2026-05-23 v0.0.6)

### Bug

In `/app/stock-reconciliation-srt` (list view), the **Status** column appeared twice in each row — once as the auto-rendered colored workflow indicator chip at the start of the row, and once as an explicit column showing the same `workflow_state` value.

### Root cause

The `workflow_state` field had `"in_list_view": 1` AND `"label": "Status"`. Frappe's list view ALSO auto-renders a colored Status indicator at the start of every row for any doctype with a `workflow_state` field. Result: two "Status" cells side by side.

### Fix

Removed `"in_list_view": 1` from the `workflow_state` field in `stock_reconciliation_srt.json`. The auto-rendered indicator continues to display the workflow state (with the workflow's configured color) — it does NOT depend on `in_list_view`. `in_standard_filter` is retained so users can still filter by status.

### Restricted area (additional, 2026-05-23 v0.0.6)

- **Don't re-add `in_list_view: 1` on `workflow_state`** — Frappe auto-renders a colored Status indicator for workflow-enabled doctypes. Adding the explicit column duplicates it. The field is documented in the JSON description with a NOTE explaining the omission.

### Verification

Direct SQL check:

```bash
bench --site development.localhost mariadb -e \
  "SELECT fieldname, label, in_list_view, in_standard_filter \
   FROM \`tabDocField\` \
   WHERE parent='Stock Reconciliation SRT' AND fieldname='workflow_state';"
```

Expected: `in_list_view=0, in_standard_filter=1`.

All 17 automated tests (Case 1/2 + gap + historical) still pass — JSON change is UI-only.

---

## 17. SRT Dashboard — Custom Frappe Page (2026-05-23 v0.0.7)

### Spec
`docs/specs/2026-05-23-srt-dashboard-design.md`

### What was added

A custom Frappe Page at `/app/srt-dashboard` providing a tabbed operator review surface for Stock Reconciliation SRT docs. Three tabs (Draft / Admin Approval / Super Admin Approval), Tabulator grid with bulk-approve, View modal per row with batch-level Origin + transaction summary, drill-down per cell (In vs Out), Approve/Reject actions dispatched through the existing DocType controller.

### Server APIs (`page/srt_dashboard/srt_dashboard.py`)

- `get_dashboard_rows(tab)` — tab filter map: Draft=docstatus 0, Admin Approval / Super Admin Approval = docstatus 1 + workflow_state match
- `get_batch_summary(srt_name)` — per-batch Origin (MIN posting_datetime SLE) + summary_origin_to_posting {in, out} + last_sr_date (most recent voucher_type=Stock Reconciliation SLE) + summary_lastsr_to_posting {in, out}
- `get_batch_drilldown(item, warehouse, batch_no, from_date, to_date)` — `{in: [{voucher_type, voucher_no, posting_datetime, qty}], out: [...]}`
- `approve_srt(srt_name)` — branches by workflow_state and dispatches through doc.submit / submit_linked_sr / cancel
- `reject_srt(srt_name, reason)` — writes annotated reason to appropriate remark field + workflow forward to Close
- `bulk_approve_srt(srt_names)` — loops approve_srt; returns per-row `{name, ok, error?}`

### UX details

- Native Frappe shell (`frappe.ui.Page`); `<ul class="nav nav-tabs">` for tab strip; no custom CSS
- Tabulator grid; two-line cells for both UOMs; text-wrap on Item column
- View modal: `frappe.ui.Dialog` size `extra-large`
- Drill-down: `frappe.ui.Dialog` size `large`; left=Out (red), right=In (green); per-SLE listing + totals
- Bulk approve: Page primary action; renders per-row result dialog after bulk call
- Re-init guard: `wrapper._srt_dashboard_initialized` prevents stacked event listeners on return navigation (matches `chaizup_toc:item_shortage_dashboard` pattern)
- Mount in `page.body` (not `.layout-main-section`) so the header toolbar (bulk-approve button) isn't clobbered

### Workspace

New SRT Dashboard link (under Setup card-break) + SRT Dashboard shortcut. Manual workspace re-sync was required (bench migrate does NOT auto-sync Workspace JSON).

### Gotcha — blank-screen bug (resolved during v0.0.7 implementation, 2026-05-23)

**Symptom:** `/app/srt-dashboard` rendered as a blank screen with no console error.

**Root cause:** the page's HTML template (`srt_dashboard.html`) used a Jinja-style comment `{# ... #}` containing the word `Frappe's`. Frappe's `build.scrub_html_template` (line 422–424 of `apps/frappe/frappe/build.py`) strips ONLY `<!-- ... -->` HTML comments via `HTML_COMMENT_PATTERN = re.compile(r"(<!--.*?-->)")` and then calls `content.replace("'", "'")` — which is a no-op (both args are literal single-quote). The Jinja comment passed through verbatim, and the apostrophe in `Frappe's` broke out of the surrounding single-quoted JS string `frappe.templates["srt_dashboard"] = '...'`, producing a silent SyntaxError that prevented the page bundle from executing.

**Fix:** rewrote the comment as an HTML comment (which IS stripped), and removed the apostrophe for safety. Added a comment block inside the file itself documenting the constraint.

**Permanent rule (now in restricted areas):** any new Page in this app must use HTML comments only — never Jinja `{# ... #}` — in its `.html` file. Apostrophes inside HTML comments are also safe because the entire comment is stripped before bundling.

### Restricted areas (additional, 2026-05-23 v0.0.7)

- Don't use Jinja-style `{# ... #}` comments in any Page's `.html` template — Frappe doesn't strip them and any apostrophe inside breaks the JS bundle (blank screen). Use HTML comments `<!-- ... -->` exclusively.
- Don't bypass `submit_linked_sr()` from the dashboard — SABB monkey-patches + Stock Settings toggle apply.
- Don't compute Origin from `Batch.creation` — use `MIN(sle.posting_datetime)` for the (item, batch, warehouse) tuple.
- Don't lump In and Out into single totals in drill-down — per-SLE breakdown is the spec.
- Don't gate action buttons by role only — also by tab (Draft = forward to Admin Approval, etc.).
- Don't add front-end "are you sure" confirms on top of Frappe's native ones. Only the reject reason prompt is custom (functional).
- Don't time-bound the Origin SLE query by posting_date — Origin is the FIRST event for the batch ever, unconditional.
- Don't read live-fetched data from a stale cache. Refetch on every modal open + every approve call.
- Don't remove the `wrapper._srt_dashboard_initialized` re-init guard — Frappe doesn't destroy the page on navigation; without it, listeners stack on return visits.
- Don't replace `.layout-main-section.html(...)` — mount in `page.body` so the page toolbar (bulk-approve button) survives.
- Workspace fixture sync gotcha applies — see app-root §13.

### Verification

`kavach/tests/test_srt_dashboard.py` — 6 tests:
- `test_dashboard_rows_filters_by_tab`
- `test_batch_summary_returns_per_batch_data`
- `test_batch_drilldown_returns_in_out_split`
- `test_approve_srt_advances_workflow`
- `test_reject_srt_closes_with_reason`
- `test_bulk_approve_returns_per_row_results`

Live result 2026-05-23: 6 / 6 passed. Cross-suite regression: 23 / 23 across all 4 suites.

---

## 18. SRT Form — Best-in-class Front-End Mask (2026-05-23 v0.0.8)

### Spec
`docs/specs/2026-05-23-srt-form-design.md`

### What was added

A custom Frappe Page at `/app/srt-form` (and `/app/srt-form?name=<draft>` for edits) that renders a richer HTML/CSS/JS UI for the existing `Stock Reconciliation SRT` DocType. Pure UI mask — all save / submit dispatches through `doc.save()` / `doc.submit()` on the existing DocType, untouched.

### Layout

Two-column at ≥1200px (collapses to single column below):

- Top sticky action bar — Save Draft, Cancel, Submit for Approval (post-save)
- Left context panel — Item / Warehouse / Company / Posting date+time / Edit posting toggle
- Right live totals panel — Current Stock, Stock Found, Δ Delta (with semantic color)
- Full-width batches grid — Tabulator with search box, tick-all/untick-all, per-row Status column showing live delta in selected UOM
- Full-width remarks panel — User / Admin / Super Admin remarks each with a small "role @ state" hint chip

### Server APIs (`page/srt_form/srt_form.py`)

- `load_srt_form(name=None)` — Returns `{is_new: True, …defaults}` for new docs OR the full doc shape for edits. Throws on submitted (docstatus=1) docs.
- `save_srt_form(payload, name=None)` — Thin wrapper. New: `frappe.get_doc(payload).save()`. Edit: `frappe.get_doc(...).update(payload).save()`. Throws if doc is not in Draft.
- `submit_srt_form(name)` — Thin wrapper over `doc.submit()`. Runs the on_submit lifecycle, workflow transition, Case 1 auto-approve routing, ERPNext SR draft creation.

All approve / reject from the dashboard remain unchanged; this form does NOT introduce a parallel approval path.

### Dashboard integration

- Page menu item `+ Create SRT (Form)` in the dashboard's secondary actions
- Draft-tab View modal gets an `Edit Full Form` button (deep-link to `/app/srt-form?name=<draft>`)
- Workspace gets a new `SRT Form` shortcut + a link under the existing Setup card-break

### Restricted areas (additional, 2026-05-23 v0.0.8)

- Don't duplicate any validation from `stock_reconciliation_srt.py` in the form's JS or Python.
- Don't allow editing submitted (docstatus=1) docs via this form — both `load_srt_form` and `save_srt_form` early-throw.
- Don't bypass `doc.submit()` — Case 1 auto-approve routing and ERPNext SR draft creation must fire normally.
- Don't compute the Delta in the totals panel using a different formula than `_recompute_totals`. The JS mirror MUST stay in sync. If the Python formula changes, update the JS.
- Don't add a CSS file — use Frappe utility classes only.
- Don't use Jinja `{# … #}` comments in `srt_form.html` — Frappe doesn't strip them; apostrophe inside breaks the JS bundle (blank screen, app-root §17 gotcha).
- Don't write to `admin_remark` / `super_admin_remark` for a non-privileged user — the server's `_enforce_remark_field_permissions` will throw. UI also gates these fields read-only by current workflow state.

### Verification

`kavach/tests/test_srt_form.py` — 4 tests:
- `test_load_new_returns_empty`
- `test_load_existing_draft_returns_full_doc`
- `test_save_new_creates_draft`
- `test_save_existing_submitted_throws`

Live result 2026-05-23: 4 / 4 passed. Cross-suite regression: 27 / 27 across all 5 suites.

---

## 26. SRT Dashboard v0.0.9.7 → v0.0.9.12 — Continuous Polish + Material 3 (2026-05-24 night)

The user reported a chain of UI issues + asked for Material 3 styling overnight. All fixed without breaking the 27-test regression.

### v0.0.9.7 — Add Row + Reconcile checkbox + dropdown on click
- **FIX:** Add Row needed double-click — `_tab.addRow()` returns a Promise; was using `setTimeout(80)` which raced the render. Now `.then(row => …)` for guaranteed cell ready.
- **ADD:** "Reconcile" checkbox column (DocType is_counted field, label "Do Reconcile"). Mirrors DocType — operator wants explicit visual marker per row.
- **ADD:** Ticked-row visual differentiation — qty_found cell + batch_no opacity dim when not ticked.
- **FIX:** Batch dropdown now shows full list on click (`listOnEmpty: true`); previously needed typed-filter to populate.

### v0.0.9.8 — Material 3 design system
- Added M3 color tokens (primary / surface / on-surface / outline + state container colors)
- 4 M3 elevation tokens (calibrated calmer than spec defaults)
- M3 motion easing (`cubic-bezier(0.2, 0, 0, 1)`)
- M3 button system: filled / tonal / outlined / text / danger / success — each with state-layer overlays (8% hover / 12% focus / 16% pressed)
- M3 icon button: 40dp tap target, circular ripple
- M3 switch (replaces native checkbox for "Edit posting date/time")
- M3 chip (assist chip pattern for audit strip)
- M3 elevated card (replaces ad-hoc card classes)
- **Ripple effect on every `.md-btn` and `.md-icon-btn`** — delegated click handler spawns a radial element, CSS keyframe animates scale + opacity
- Material 3 outlined text field styling applied to Frappe controls (Item / Warehouse / Posting picker)
- Material 3 dialog styling — Frappe modal headers + footers inherit M3 spec (16px radius, M3 elevation, sentence-case heading, 8dp gap actions)

### v0.0.9.9 — Checkbox + Status pill render bug + remarks as Text Editor
- **FIX:** Checkbox click didn't update visually (`_tab.updateData([r])` doesn't re-trigger formatters without an `id` field). Changed to `cell.setValue(new_val, true)` + `cell.getRow().reformat()` — both updates data AND re-renders cell + whole row formatters so qty_found dim + batch_no dim flip with the same click.
- Same fix for Status pill click + tick-all / untick-all (use `row.reformat()` instead of `replaceData` which loses scroll + edit state).
- **REPLACED:** Plain `<textarea>` for User / Admin / Super Admin remarks → `frappe.ui.form.make_control({fieldtype: "Text Editor"})`. Matches DocType field type (TinyMCE-style rich text with toolbar). `_build_payload` reads from each control via `get_value()` to flush any unsaved TinyMCE content before save.

### v0.0.9.10 — Totals UOM alignment + dropdown listOnEmpty
- **FIX:** Number-and-unit alignment in totals card and dashboard grid — used `inline-flex items-baseline gap-1.5` so the number stays right-aligned and the UOM unit name sits inline at consistent baseline. Higher UOM stacks below with the same alignment.
- **FIX:** Batch dropdown `listOnEmpty: true` + `filterFunc` for client-side case-insensitive substring narrowing as the operator types. `limit: 0` returns ALL matching batches (per user spec: "by default all batches except already added").

### v0.0.9.11 — Remarks vertical stack
- **CHANGE:** Remarks layout from 3-column grid → vertical stack. Each Text Editor needs full width for proper toolbar usability.

### v0.0.9.12 — Removed Tailwind CDN
- **PERF:** Removed Tailwind CDN runtime (~500KB + ~300ms JIT compile per page load). Embedded hand-curated utility CSS in the existing injected `<style>` block — covers every utility class used in the dashboard templates. Same className strings, same visual output, no external dependency.
- Bundle increased by ~12 KB (one-time download with the page asset, cached by browser), but eliminated the per-page 500 KB CDN fetch.

### Files touched

Only `srt_dashboard.js` (1697 → 2300 lines net). The HTML, JSON, and Python files remain v0.0.9.6 unchanged.

### Restricted areas (additional)

- **Don't reintroduce the Tailwind CDN** — utility CSS is now embedded; loading the CDN again would create duplicate class definitions (CSS specificity wars) and reintroduce the 500 KB cost.
- **Don't reuse the deleted `setTimeout(80)` pattern for any Tabulator addRow.** Always use the Promise: `tab.addRow(row, false).then(r => r.scrollTo("center"))`.
- **Don't use `_tab.updateData([r])` for is_counted-style toggles.** Without a row `id` field, it can no-op the formatter re-render. Use `cell.setValue(v, true)` + `row.reformat()`.
- **Don't use `<textarea>` for any of the 3 remark fields.** DocType declares them as Text Editor — use `frappe.ui.form.make_control({fieldtype: "Text Editor"})`. The native form's rich-text behavior must match.
- **Don't lose the read-from-control fallback in `_build_payload`.** Text Editor's onchange fires on debounce; without explicit `ctrl.get_value()` at save time, last-typed content can be lost.
- **Don't remove `listOnEmpty: true` from the batch_no editorParams.** Operators expect dropdowns to open populated on first click; requiring typed-filter is friction.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 26f. DocType v0.0.9.26 — Linked SR posting_date/time MUST mirror SRT (2026-05-25)

### Bug
After Srt Super Admin clicks "Submit Linked ERPNext SR", the linked SR's `posting_date` + `posting_time` were getting overwritten with the super admin's click time, NOT the SRT's intended (often backdated) posting timestamp.

### Root cause
`erpnext/utilities/transaction_base.py` defines `TransactionBase.validate_posting_time()`:

```python
if not getattr(self, "set_posting_time", None):
    now = now_datetime()
    self.posting_date = now.strftime("%Y-%m-%d")
    self.posting_time = now.strftime("%H:%M:%S.%f")
```

This validate runs on BOTH `insert()` AND `submit()`. Stock Reconciliation has a `set_posting_time: Check` field (defaults to 0). When the SRT created the draft SR via `frappe.new_doc("Stock Reconciliation")` and assigned `sr.posting_date = self.posting_date`, the `set_posting_time` flag was left at its default 0 — so on the very next validate pass (which fires during `sr.insert()`), ERPNext silently overwrote both fields with `now()`. Even if the values somehow survived insert, they were guaranteed to be wiped on the super admin's submit.

### Fix (`_create_erpnext_sr_draft`)
One line: `sr.set_posting_time = 1` set BEFORE `posting_date` / `posting_time` assignment.

```python
sr = frappe.new_doc("Stock Reconciliation")
sr.purpose = "Stock Reconciliation"
sr.company = self.company
sr.set_posting_time = 1                # ← required guard
sr.posting_date = self.posting_date
sr.posting_time = self.posting_time
```

### Regression test (`tests/test_case1_case2.py::test_sr_posting_mirrors_srt`)
Builds an SRT backdated by 2 days at 10:15:00, submits, asserts that:
- `sr.posting_date == srt.posting_date`
- `sr.posting_time == srt.posting_time` (strip microseconds)
- `sr.set_posting_time == 1` (so future validate passes don't reset it)

Backdated SRTs are the canonical use case — operator counts Friday closing, files SRT Monday, expects ledger to land on Friday. The audit trail breaks if the SR posts at the super admin's click time instead.

### Restricted area (added)
- **`sr.set_posting_time = 1` must stay set before posting_date/time assignment in `_create_erpnext_sr_draft`.** Removing it re-introduces silent overwrites — the SRT's whole "backdate the count, post-approval-on-our-schedule" audit trail collapses to whatever time the super admin happened to click submit.
- See `erpnext/utilities/transaction_base.py::TransactionBase.validate_posting_time` for the canonical override behavior.

### Verification

| Suite | Before | After |
|---|---|---|
| test_case1_case2 | 5/5 | **6/6** (new test_sr_posting_mirrors_srt) |
| test_srt_settings_gap | 8/8 | 8/8 |
| test_historical_stock | 4/4 | 4/4 |
| test_srt_dashboard | 10/10 | 10/10 |
| **Total** | **27/27** | **28/28** |

---

## 26e. SRT Dashboard v0.0.9.19 → v0.0.9.25 — Form-grid status sync, view modal polish, checkbox controller-owned (2026-05-24)

### v0.0.9.19 — Form batches grid: row.reformat() after edits
- `_tab.updateData([r])` doesn't re-trigger column formatters without a row `id` — same gotcha as v0.0.9.9's is_counted. Status pill, qty_found dim-state, current_stock_in_selected_uom stayed stale after UOM or batch-pick changes.
- Replaced with `cell.getRow().update(r); cell.getRow().reformat()` in `on_edit` (`select_uom` + `qty_found`) and in `cellEdited` for `batch_no`.

### v0.0.9.20 — View modal: alignment + responsive
- Outer scroll wrapper replaced with Tabulator owning the scroll (`height: "55vh"` → `"40vh"` after v0.0.9.21) so sticky `.tabulator-header` works inside `.tabulator-tableholder`.
- In/Out cells rebuilt as 2-line stacked block (In on top, Out below, both `tabular-nums` + `flex justify-between items-baseline`) so values align column-to-column regardless of magnitude.
- Origin block restructured: voucher type → voucher no (mono, truncated with title) → posting date+time. `align-items: flex-start` + `min-height: 64px`.
- Last SR shows stacked date / time-of-day matching dashboard list `fmt_date`.
- Responsive: `responsiveLayout: "collapse"` + per-column `responsive: 0/1/2` priority. Hidden cells render below row as styled drawer.
- M3 polish: rounded outer, surface-tinted header, row hover surface-2, In/Out hover primary-container (telegraphs drill-down), meta chips bar above grid.

### v0.0.9.21 — View modal: editable remark before approve
- New `approve_srt(srt_name, remark=None)` server arg appends remark to the field the current `workflow_state` allows (`"Admin Approval"` → `super_admin_remark`; else → `admin_remark`) with `[via SRT Dashboard <ts> by <user>]` audit-trail tag, via `db_set(update_modified=False)` before workflow advance.
- `get_dashboard_rows` SQL extended with `admin_remark` + `super_admin_remark` so the view modal has values without a second round-trip.
- View modal renders M3 elevated card with Text Editor for the editable field. Label adapts per state ("Admin Remark" for Draft, "Super Admin Remark" for Admin Approval). Pre-loads no value; the read-only existing-remarks block (v0.0.9.25) shows history separately.

### v0.0.9.22 — View modal: reconcile-state pill + row low-light/highlight
- `get_batch_summary` extended with `is_counted`, `qty_found`, `current_stock_in_*`, `select_uom`, `conversion_factor`. Modal computes the same delta classification the controller uses.
- New State column (2nd, after Batch, before Origin; `width: 140 responsive: 0`) showing pill: "No change" (uncounted) / "Matched" (delta < 0.001) / `+X UOM` (over) / `-X UOM` (short).
- `rowFormatter` low-lights uncounted (opacity 0.6, transparent left border) and highlights actionable (left-border + tint: emerald 4% / amber 6% / rose 6%).

### v0.0.9.23 — Checkbox cell alignment fix
- v0.0.9.17's `.srt-grid-host .tabulator-cell { align-items: flex-start; padding: 12px 16px }` overrode the older `.srt-mdcb-cell` rule (same specificity). Added higher-specificity `.srt-grid-host .tabulator-cell.srt-mdcb-cell { padding: 4px; align-items: center; justify-content: center; min-height: 56px }`.
- Master header checkbox: `titleFormatter` runs inside the Tabulator constructor BEFORE `this._tabulator` is assigned. First-render now always renders unchecked; `dataLoaded` + `rowSelectionChanged` callbacks sync state after construction.
- `_sync_select_visual()` extracted as single source of truth. Added partial-state visual (outline + horizontal dash) for indeterminate selection.

### v0.0.9.24 — Tabulator 6.x selectableRows rename
- Tabulator 6.x renamed `selectable` → `selectableRows`. The old key is silently ignored in 6.3.1, so `row.toggleSelect()` and `row.isSelected()` had been no-ops since v0.0.9.15 was added. Set both keys.

### v0.0.9.25 — Checkbox: controller-owned selection set (the real fix)
- Even with `selectableRows: true`, Tabulator 6.x's default "any cell click selects row" was firing alongside our `cellClick: (e, cell) => { cell.getRow().toggleSelect() }`. The two cancelled each other out — net effect: rows never selected.
- Disabled Tabulator's row selection (`selectable: false`, `selectableRows: false`) and switched to a controller-owned `this._selected = new Set()` keyed by `doc.name`:
  - Cell formatter reads `that._selected.has(name)`
  - `cellClick` mutates set + `row.reformat()` + `_sync_select_visual()`
  - `headerClick` toggles all-or-none + reformats every active row
  - `_render_bulk_bar()` now reads from the set
  - "Clear" button on snackbar clears set + reformats all rows
  - Selection resets on every `_render_grid()` (tab switch, refresh, item filter change)
- View modal: 3 existing remark cards (`user_remark`, `admin_remark`, `super_admin_remark`) rendered above the editable remark panel as read-only Material 3 elevated cards with role-accent icons. Hidden when empty.
- Removed the redundant `<details>` "Current value" block from the editable panel — read-only block above shows history.

### Restricted areas (additional)

- **Don't re-enable Tabulator's `selectableRows` on the dashboard list grid.** It double-fires with the cellClick handler under 6.x — proven across v0.0.9.15..v0.0.9.24. Selection state is now owned by `this._selected: Set`.
- **`approve_srt` and `bulk_approve_srt` route remark by `workflow_state`, NOT tab key.** The controller's `_enforce_remark_field_permissions` gates are state-keyed: `admin_remark` editable only in Draft; `super_admin_remark` editable only in Admin Approval.
- **`get_batch_summary` returns the 7 reconcile-state fields needed by the view modal pill.** Don't drop them — the modal's `compute_reco_state()` derives the matched/over/short/uncounted classification from them.
- **View modal grid is `.srt-view-grid` — scoped CSS lives in `srt_dashboard.js`.** Don't widen to `.tabulator-cell`; would cascade into the form's batches grid.
- **View modal existing-remarks block renders rich text from Text Editor fields directly.** They're trusted server-stored content (written by authenticated users), but if you ever expose this to untrusted input, add an HTML sanitizer.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 26d. SRT Dashboard v0.0.9.18 — Scope dashboard-table CSS, restore form-grid layout (2026-05-24)

### Bug
v0.0.9.17 introduced `.srt-dash-root .tabulator-cell { align-items: flex-start; white-space: normal; min-height: 56px }` to enable text-wrap in the dashboard list. That selector also matched the form panel's batches grid (`.srt-batches-grid`), breaking its compact, fixed-row-height layout used by inline editors (batch picker, qty_found number input).

### Fix
All v0.0.9.17 dashboard-list rules re-scoped to `.srt-dash-root .srt-grid-host .tabulator-cell`. The form's batches grid lives inside `.srt-batches-grid` (not `.srt-grid-host`), so it falls back to the base `.srt-dash-root .tabulator-cell { display: flex; align-items: center; padding: 14px 16px }` rule and inline editors render the way they did pre-v0.0.9.17.

### Affected selectors (all now scoped to `.srt-grid-host`)

- Cell padding/wrap/min-height
- Number-column override (`[tabulator-field*="stock"]` / `[tabulator-field*="qty"]`) for vertical center
- Sticky header box-shadow
- `.srt-cell-clamp` 3-line clamp
- Item-name 2-line clamp inside `.leading-tight`

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 26c. SRT Dashboard v0.0.9.17 — Tab-semantics swap, table polish, DocType validation coverage (2026-05-24)

### Tab semantics swap (corrects the v0.0.9.15 split)
Tabs now reflect **who is waiting to act**, not the current workflow state:

| Tab                          | Server filter                                        | Doc state shown        | Action                                  |
|------------------------------|------------------------------------------------------|------------------------|-----------------------------------------|
| Admin Approval Pending       | `docstatus = 0`                                      | Draft                  | Srt Admin approves → creates draft SR   |
| Super Admin Approval Pending | `docstatus = 1, workflow_state = "Admin Approval"`   | Admin-approved         | Srt Super Admin submits the linked SR   |

Server `_TAB_FILTERS` updated; legacy `"Draft"` key extracted to `_EDIT_LOAD_FILTERS` so `get_dashboard_counts` + `bulk_approve_srt` don't double-count or iterate it as a dashboard tab. JS `current_tab` default + tab `key` literals updated. The bulk-remark target-field router (`bulk_approve_srt`) now routes by `workflow_state` rather than tab key: `"Admin Approval"` → `super_admin_remark` (super admin tab), everything else → `admin_remark`. Tests updated (`test_dashboard_rows_filters_by_tab`, `test_dashboard_counts_returns_three_tabs`).

### Table polish — width + wrap + sticky header
- **Width distribution.** Doc (150) + Status (170) + Posting Date (130) + action (56) are fixed; Item (`widthGrow: 3`, min 200) + Warehouse (`widthGrow: 2`, min 140) + User Remark (`widthGrow: 3`, min 180) grow proportionally. Stock columns (140/175) right-aligned with explicit widths to keep the "Stock as on Posting" header from clipping into the qty/UOM cells.
- **Text wrap.** `.tabulator-cell` switched to `align-items: flex-start` + `white-space: normal` + `word-break: break-word` + `line-height: 1.45` + `min-height: 56px`. Number cells (`tabulator-field` containing "stock" or "qty") stay centered so the stacked default/higher-UOM lines visually align.
- **3-line clamp on remarks** via `.srt-cell-clamp` (`-webkit-line-clamp: 3`). Full text in `title` attribute.
- **Sticky header.** Outer grid host gives Tabulator a finite `height` (`calc(100vh - 280px)`) so Tabulator's own `tabulator-tableholder` scrolls internally — that's the configuration required for the sticky `.tabulator-header` to actually stick. `renderVertical: "basic"` so variable row heights aren't clipped by Tabulator's default virtual-scroll row sizing.

### DocType validation coverage (form has parity with controller)
Audited against `doctype/stock_reconciliation_srt/stock_reconciliation_srt.py`. Every controller validation is exercised through the dashboard form's `save_srt_form` / `submit_srt_form` server calls, so all 9 gates fire:

1. `_set_default_posting()` — both fields now also defaulted in `load_srt_form` (v0.0.9.16) so the operator never sees a blank Posting Date/Time.
2. `_mirror_item_name()` — runs server-side; form UI shows the fetched item_name via `_refresh_item_preview()`.
3. `_stamp_child_warehouse_and_item()` — child rows added via the dashboard grid don't carry warehouse/item_code; controller stamps them on save.
4. `_enforce_no_duplicate_rows()` — duplicate `(batch_no, warehouse)` rejected at save time; UI's batch picker excludes already-picked batches but server is authoritative.
5. `_enforce_no_duplicate_open_srt_for_item()` — surfaced verbatim from controller; dashboard catches the `frappe.throw` via `_show_error`.
6. `_enforce_min_gap_between_srts()` — same surface path.
7. `_classify_zero_delta_ticks()` — runs server-side; Case 1 short-circuit (all matched → "Approved By System") works through the dashboard's submit flow because submit dispatches `doc.submit()` which fires `on_submit`.
8. `_enforce_at_least_one_reconcile_ticked()` — UI's row-level reconcile checkbox (added back in v0.0.9.7) ensures the operator can tick; server gate catches the zero-tick case.
9. `_enforce_remark_field_permissions()` — UI sets `read_only` on the three remark Text Editors per role + state in `_render_remarks`; server gate is authoritative.

### Restricted areas (additional)

- **Don't merge `_EDIT_LOAD_FILTERS` back into `_TAB_FILTERS`.** `get_dashboard_counts` + `bulk_approve_srt` iterate `_TAB_FILTERS.items()`; folding the Draft alias in would double-count Admin Approval Pending and let bulk_approve iterate the same docs twice.
- **The bulk-remark field-routing key in `bulk_approve_srt` is `workflow_state`, NOT the dashboard tab key.** Routing by tab key would break the `_enforce_remark_field_permissions` gate — admin_remark is only writable in Draft state; super_admin_remark only in Admin Approval state.
- **Tabulator `renderVertical: "basic"` is required for variable row heights.** The default "virtual" renderer assumes fixed row height and will clip wrapped text.
- **Don't move scroll from the Tabulator widget back to the outer wrapper.** Tabulator's sticky header lives inside `.tabulator-tableholder`; if the outer wrapper scrolls instead, the header scrolls off-screen.
- **`align-items: flex-start` on `.tabulator-cell` breaks visual baseline alignment for stacked number/UOM lines.** That's why the right-aligned stock columns keep `align-items: center` via the `[tabulator-field*="stock"]` / `[tabulator-field*="qty"]` overrides — don't remove these.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 26b. SRT Dashboard v0.0.9.13 → v0.0.9.15 — Sidebar-aware panel, 2-tab queue, M3 bulk approve (2026-05-24)

### v0.0.9.13 — Form panel respects Frappe sidebar
- Panel + backdrop no longer cover Frappe's left sidebar (`.layout-side-section`, `.body-sidebar`). `_open_form_panel` now measures `.layout-main`'s `getBoundingClientRect().left` and uses that as the panel's `left:` offset. Sidebar stays visible + navigable.
- Added a `window.resize` listener so the panel re-pins itself when the sidebar collapses/expands while the panel is open. Listener torn down on close.

### v0.0.9.14 — Snapshot badge + DocType parity
- Batches header now shows two M3 chips: "As of <date> <time>" (clock icon) and the active warehouse name (warehouse icon). They update whenever item / warehouse / posting_date / posting_time change, so the operator can see exactly which (item, warehouse, posting) tuple the table is currently showing.
- Audit strip now renders `naming_series` chip + `amended_from` chip (link to original SRT when present). Form now covers 24/24 DocType fields.

### v0.0.9.15 — 2-tab queue, M3 checkbox, bulk-remark, item filter
- **Tabs reduced from 3 → 2:** "Admin Approval Pending" + "Super Admin Approval Pending". The Draft tab is dropped — operator creates via "+ New SRT" and the doc lands in Admin Approval queue after submit. `_TAB_FILTERS` server map keeps the Draft entry (used by the form panel's edit-mode load) but no UI references it.
- **First-column checkbox upgraded to M3 `srt-mdcb`** — same token used in the form's batches grid. Custom `formatter` + `titleFormatter` + `headerClick` handler replace Tabulator's default `rowSelection`. Selection state is reflected by toggling each input element's `checked` property directly (no HTML string construction), and the header checkbox tracks indeterminate state when partial selection exists.
- **Bulk-approve dialog with optional remark.** Clicking the snackbar's Approve button now opens a Frappe Dialog (Text Editor) instead of a plain `frappe.confirm`. The remark — when supplied — is appended to `admin_remark` (Admin Approval tab) or `super_admin_remark` (Super Admin Approval tab) on every selected doc, annotated with `[BULK via SRT Dashboard <ts> by <user>] …` for PCAOB audit trail. Empty remark = legacy behavior (approve only).
- **Item filter on the header row.** Inline Link picker (Item) sits beside the tabs; selecting an item narrows the grid via the new `get_dashboard_rows(tab, item_filter)` server arg. A clear button appears when filter is active. Empty state messages and the bulk bar adapt.

### Restricted areas (additional)

- **Do not remove the Draft entry from server-side `_TAB_FILTERS`.** The form panel's edit-mode hits `load_srt_form` which only loads Draft docs; future code that uses `_TAB_FILTERS["Draft"]` would break if the key is gone.
- **Do not let the bulk-remark dialog field be a plain Small Text or Text.** It must be a Text Editor — the DocType remark fields are Text Editor, so the format must match (preserves formatting parity with single-doc edit).
- **Bulk approve writes remark BEFORE approval dispatch, not after.** `approve_srt` advances workflow_state + may submit child docs (ERPNext SR); writing afterwards would race against `modified` checks. Server uses `doc.db_set(..., update_modified=False)` to stay atomic.
- **Item filter param goes through `_TAB_FILTERS` dict merge with explicit `_item_filter` key.** Don't merge it as `f["item"]` — that name collides with a SRT field that might be added to a future tab filter.
- **Do not write HTML strings into row elements** in `rowSelectionChanged` (XSS risk + hook block). Use direct property mutation on the input element (`.checked = …`).
- **Form panel sidebar offset uses `.layout-main`'s rect, not jQuery `.outerWidth()` on `.layout-side-section`.** Frappe's sidebar collapses differently (mini-rail mode vs full mode vs mobile hidden) and the rect approach captures all three cases correctly.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 25. SRT Dashboard v0.0.9.6 — Calm Cockpit Visual Refactor (2026-05-24)

### Audit findings (vs prior v0.0.9.5)

| Issue | Before | After |
|---|---|---|
| Font sizes | 15 distinct sizes ([10px → 4xl]) | 4 only: text-xs, text-sm, text-base, text-lg |
| Font weights | 9 distinct, `font-extrabold` 42× / `font-black` 4× | 3 only: 400, 500, 600 |
| Hover transforms | 40 `hover:scale/translate/-translate-y` | 0 (color only) |
| Custom shadows | 6 undefined tokens (card-1..5, float, inner-soft) | 1: `shadow-sm` |
| UPPERCASE labels | 80% (everything `uppercase tracking-widest`) | 0 |
| Decorative blur orbs | 4 instances (`absolute -right-10 blur-3xl`) | 0 |
| Inline `style="..."` | 12 instances | only the panel positioning (computed at runtime, needs `style=`) |
| Unicode glyphs in cells | 36 (→, ↗, ↳, ✓, ✗, Δ, ·, —) | replaced with SVG icons or plain text in calm sentence case |
| Dark totals card | `from-slate-900 to-indigo-950` gradient | white card matching others |
| Reduced motion | not respected (WCAG 2.3.3 violation) | `@media (prefers-reduced-motion: reduce)` disables all transitions |

### Verbose copy → calm copy

- "TARGET IDENTIFICATION" → "Item & Location"
- "Live Telemetry" → "Totals"
- "Source of Truth Engine v0.2.1" → (removed)
- "Audit Remarks & Sign-offs" → "Remarks"
- "Secure & Save Draft" → "Save"
- "Inspect Document" → "View"
- "Reconciliation State" → "Status"
- "Items Selected" / "Deselect All" → "selected" / "Clear"

### Restricted areas (additional, v0.0.9.6)

- **Don't reintroduce more than 4 font sizes.** Locked to `text-xs / text-sm / text-base / text-lg`.
- **Don't reintroduce more than 3 font weights.** Locked to 400 / 500 / 600.
- **Don't add `hover:scale-*` or `hover:translate-*` or `hover:-translate-*` anywhere.** Hover = color change only. Vestibular sensitivity + scroll jitter.
- **Don't add custom shadow tokens** (`shadow-card-N`, `shadow-float`, `shadow-inner-soft`). Use `shadow-sm` only.
- **Don't UPPERCASE labels or use `tracking-widest` on body copy.** Frappe HD / Linear / Vercel rule.
- **Don't add decorative blur orbs.** They distract from data; serious operator UI is not a marketing landing page.
- **Don't put the totals card on a dark gradient.** It's a data card, not a hero element.
- **Don't drop the `@media (prefers-reduced-motion: reduce)` CSS block.** WCAG 2.3.3 compliance.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

Bundle parses clean (84.6 KB — up from 66 KB because Tailwind CDN runtime generates more utility classes for the new tokens, but the source itself is denser/cleaner).

---

## 24. SRT Dashboard v0.0.9.5 — DocType Action Parity (2026-05-24)

### Gap analysis

After reading the full DocType (`stock_reconciliation_srt.json/.py/.js`), the dashboard form was missing 3 lifecycle actions:

1. **Submit for Approval** — the DocType's `doc.submit()` transition (Draft → Admin Approval) creates the draft ERPNext SR; dashboard form had only Save Draft
2. **Submit Linked ERPNext SR** — the Super Admin's post-submit action (Admin Approval → Super Admin Approval) that calls the existing whitelisted `submit_linked_sr` (running the 9 SABB monkey-patches + Stock Settings toggle per Quirk #2)
3. **Naming Series visibility** — DocType field is reqd=1 with default `SRT-RECO-.YYYY.-.#####`; form had no display of it

### Fixes

Added a role + state-aware footer action renderer (`_render_footer_actions`) that emits:

| Button | Visible when | Calls |
|---|---|---|
| Cancel | always | `on_close()` |
| Save Draft | new doc OR workflow_state="Draft" | `save_srt_form` (existing) |
| **Submit for Approval** | Draft + name exists + `is_admin` (Srt Admin / Super Admin / SysMgr) | `submit_srt_form` (existing whitelisted wrapper around `doc.submit()`) |
| **Submit Linked ERPNext SR** | workflow_state="Admin Approval" + `linked_erpnext_sr` exists + `is_super` (Srt Super Admin / SysMgr) | `doctype.stock_reconciliation_srt.stock_reconciliation_srt.submit_linked_sr` (existing module-level wrapper that runs SABB patches + sr._submit()) |

Naming Series now displayed in the footer-left meta strip when available: `Series: SRT-RECO-2026-.#####`. (Editing the series itself is rare; defaulting from the DocType is sufficient — same behavior as the native form which shows it but operators almost never change it.)

Both submit actions wrap `frappe.confirm` for safety (the second action explicitly warns about SLE/GL posting being not-easily-reversible — matches the doctype's JS prompt).

### Restricted areas (additional, v0.0.9.5)

- **Don't bypass `submit_linked_sr` from the dashboard form.** The whitelisted wrapper at `doctype.stock_reconciliation_srt.stock_reconciliation_srt.submit_linked_sr` is the SAME path the DocType form uses; it carries the 9 SABB monkey-patches + Stock Settings allow_negative_stock toggle + `sr._submit()` per Quirk #2. Re-implementing the submit logic on the dashboard would diverge.
- **Don't show Submit for Approval on a NEW (unsaved) doc.** The button only appears after Save Draft creates the doc and `this.state.name` is populated. Without a `name`, there's nothing to submit.
- **Don't show Submit Linked SR if `linked_erpnext_sr` is empty.** Case 1 (Approved By System) docs have no linked SR — the button must hide for those.
- **Don't drop the role checks (is_admin / is_super).** Server still enforces, but UI hiding prevents the dead-end click + bad-UX.
- **Don't add a "Discard Draft" button.** Cancel just closes the panel. To discard a draft, operator deletes it from the dashboard table (a feature for a future version). Confirming-discard inside a form is anti-pattern when the underlying action is "do nothing".

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 23. SRT Dashboard v0.0.9.4 — Remove Row + Batch Link Picker + Hidden Checkbox (2026-05-24)

### Bugs reported

1. **No per-row Remove button** — operator couldn't drop unwanted rows from the batches grid
2. **`batch_no` was a plain text input** — operator had to type the full batch ID with no autocomplete or filtering (slow + error-prone with 1000+ batch items)
3. **Redundant `is_counted` checkbox column** — the Reconciliation State pill already shows tick/untick visually; two ways to toggle the same field cluttered the row

### Fixes

| # | Fix |
|---|---|
| 1 | New rightmost column with trash-icon button (no header). Click → splices the row out of `state.batches` + `row.delete()` + decrements the Records Loaded counter + `_render_totals()`. Allowed on autopop AND manual rows (matches DocType form where draft-row deletion is unrestricted). No confirmation dialog (low-stakes — operator can re-add by typing a batch_no). |
| 2 | `batch_no` now uses Tabulator's `editor: "list"` with `valuesLookup` calling `frappe.db.get_list("Batch", {...})`. Server-side filters: `item = parent.item`, `disabled = 0`, exclude already-picked batches in the same form, `batch_id LIKE %term%` on user search input. Autocomplete enabled, debounced 250ms. Frappe-native — mirrors the DocType's `set_query("batch_no", "batches", ...)` pattern. Empty cell shows search-icon + "Search & pick batch" prompt. Filled cell shows chevron-down hint on manually-added rows. |
| 3 | DELETED the dedicated `is_counted` checkbox column. The Reconciliation State pill (rightmost data column) is now CLICKABLE — click toggles `is_counted` and `_render_totals()`. The pill is bigger, more descriptive ("Perfect Match" / "Δ +1.7 Kg" / "—"), easier to hit on touch devices. Net column count unchanged: -1 checkbox, +1 remove. |

### Restricted areas (additional, v0.0.9.4)

- **Don't re-add the `is_counted` checkbox column.** The state pill IS the toggle now; two affordances for the same field is operator-grade UI clutter. Status pill is bigger + more descriptive + touch-friendly.
- **Don't switch `batch_no` editor away from `list` + `frappe.db.get_list("Batch")`.** Plain text input means operators must type the full batch ID; for items with 1000+ batches that's painful and error-prone. The Tabulator `list` editor with `filterRemote: true, filterDelay: 250` debounces and pulls from server, exactly like Frappe's native Link field.
- **Don't add a confirm dialog on Remove Row.** Low-stakes — the operator can re-add by typing batch_no. Confirmation friction on every delete hurts bulk workflows.
- **Don't restrict Remove Row to manual rows only.** Autopop rows must be deletable too (operator decides what's in scope for THIS reconciliation; matches DocType form draft semantics).
- **Don't drop the `exclude already-picked` filter in the batch lookup.** Without it operators can add duplicate batch rows; server validation will throw later, but better UX to prevent the picker from offering already-used batches.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 22. SRT Dashboard v0.0.9.3 — Add Row + Custom Checkbox (2026-05-24)

### Bugs reported

1. **Missing "Add Row" button** in the form's batches grid — operator couldn't add a batch that wasn't auto-populated (e.g., batches at 0 qty for backdated reconciliations)
2. **Checkmark "not proper formatted"** — Tabulator's default `tickCross` formatter emits unstyled unicode glyphs (✓/✗) that look amateurish in an operator-grade UI

### Fixes

| # | Fix |
|---|---|
| 1 | Added "Add Row" button (indigo primary, plus-icon SVG) next to the Select All / Clear pill. Click → appends a blank row to `state.batches` + `_tab.addRow(..., false)` for bottom-append + auto-scrolls + opens the batch_no cell in edit mode. Empty batch_no cell shows placeholder "Click to type batch...". On batch_no entry, `get_batch_current_state(item, batch, posting_date, posting_time)` fetches warehouse/qty/rate/stock_uom and populates the row. Mirrors the DocType form's `batch_no` cellEdited handler. New rows are marked `_origin_autopop: 0` so their batch_no stays editable; autopopulated rows get `_origin_autopop: 1` (batch_no locked). |
| 2 | Replaced Tabulator `formatter: "tickCross"` with a custom formatter rendering a real styled checkbox — 20×20px rounded square with 2px border. Unchecked: white bg + slate-300 border + hover indigo-400. Checked: indigo-600 bg + white check-icon SVG. Click toggles `is_counted` + triggers `_render_totals()`. |

### Restricted areas (additional, v0.0.9.3)

- **Don't switch the `is_counted` checkbox formatter back to `tickCross`.** It looks amateurish in operator-grade UI. Use the custom checkbox formatter — it matches Frappe's standard checkbox aesthetic.
- **Don't allow `batch_no` editing on autopopulated rows.** The `editable: cell => !cell.getRow().getData()._origin_autopop` check is what gates it. Autopopulated rows have their batch already resolved from SLE; letting operators edit them would silently corrupt the row's warehouse/qty/rate snapshot.
- **Don't remove the empty-item guard in Add Row** (`if (!this.state.item)`). `get_batch_current_state` requires item_code; without it the click would silently no-op and confuse operators.
- **Don't auto-tick `is_counted=0` on Add Row.** A manually-added row exists because the operator wants to reconcile it; default to `is_counted=1` per the DocType form's manual-add pattern.

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

---

## 21. SRT Dashboard v0.0.9.2 — Panel Containment + UOM Display (2026-05-23 night)

### Bugs reported

1. **Form panel overlaps Frappe's navbar/sidebar** — UI not properly aligned, affects other Frappe components
2. **Higher UOM + lower UOM not visible** in totals or batch table
3. **Per-batch current values** not visible per stock UOM AND select UOM
4. **Form not refreshing** when warehouse / item / posting date / posting time changes

### Root causes + fixes

| # | Root cause | Fix |
|---|---|---|
| 1 | Panel used `fixed inset-0 z-[1050]` — covered ENTIRE viewport including Frappe's navbar (z 1100). Operator lost orientation, couldn't navigate, accessibility audit fail. | Panel now `position: fixed; left/right: 0; top: navbar_h; bottom: 0; z-index: 1015` — contained within Frappe's content area, navbar stays visible. Backdrop restored at z 1010. Backdrop click + ESC key both close the panel. |
| 2 | Totals card renders higher_uom values but on first form open (no item picked), shows "0.000" with no unit — confusing. | Added an empty-state for the totals card showing "Pick an Item and Default Warehouse to load the live baseline". Once item+warehouse set, both Stock UOM and Higher UOM display together (existing logic). |
| 3 | Batch grid columns labeled "Current (UOM)" + "Current (Base)" but rendered as bare numbers — operators couldn't tell what unit each column was in. | Renamed columns to "Current (Selected UOM)" + "Current (Stock UOM)". Both formatters now render value + unit inline (e.g., "0.021 Kg" / "20.680 Gram"). |
| 4 | Already worked at API level — verified via direct call: `today=3 batches/823.950g`, `30 days ago=420 batches/4880.260g`. The form's `_maybe_load_batches` already wires posting_date + posting_time as change handlers. Bug was actually #1+#3 — overlap hid the data, totals column was unitless. | Confirmed via console test that the API correctly returns different state per (item, warehouse, posting_date, posting_time) tuple. The form's refetch was working — the visual presentation was hiding it. |

### Restricted areas (additional, v0.0.9.2)

- **Don't switch the panel back to `fixed inset-0`.** It covers Frappe's navbar (z 1100 isn't enough to fully hide it on all themes, but it does block clicks). Operators lose orientation. Always offset from `top: navbar_h` (measured at runtime via `$(".navbar").outerHeight() || 56`).
- **Don't remove the backdrop click-to-close.** Industry-standard modal UX; users will try it on first interaction.
- **Don't remove the ESC keydown handler.** Accessibility standard for modal-equivalent surfaces. Cleanup must happen in `_close_form_panel` via `removeEventListener`.
- **Don't drop the "no_data" branch in `_render_totals`.** Empty state communicates "you need to pick item + warehouse first" — without it operators stare at meaningless zeros.
- **Don't render batch grid value cells without their UOM unit.** Both "Current (Selected UOM)" and "Current (Stock UOM)" must show `value + unit` inline. Operators can't infer from column header alone (some items have stock UOM = select UOM, making them indistinguishable without the label).

### Verification

| Suite | Result |
|---|---|
| test_case1_case2 | 5/5 |
| test_srt_settings_gap | 8/8 |
| test_historical_stock | 4/4 |
| test_srt_dashboard | 10/10 |
| **Total** | **27/27** |

Per-axis API proof (console-verified):
- `get_item_defaults(CZMAT/1585, WH 1.9, today)` → 3 batches / 823.950 g (0.824 Kg)
- `get_item_defaults(CZMAT/1585, WH 1.9, 30 days ago)` → 420 batches / 4880.260 g
- Sample batch row: `0.021 Kg | 20.680 Gram` — both UOMs populated

---

## 20. SRT Dashboard v0.0.9.1 — Hotfix (2026-05-23 evening)

### Bugs reported

1. **"Tabulator is not defined"** error in dashboard table
2. Dashboard table not full-width
3. Slide-down form panel not using full screen height
4. Form panel missing DocType parity — no naming_series, workflow_state, *_approved_by, linked_erpnext_sr

### Root causes + fixes

| # | Root cause | Fix |
|---|---|---|
| 1 | Tabulator is NOT a Frappe-bundled global. v0.0.9 assumed it was. Sibling chaizup_toc:item_shortage_dashboard loads it via CDN `<link>` + `<script>` tags in its `.html`. | `srt_dashboard.html` now loads `tabulator-tables@6.3.1` CSS + JS from jsdelivr CDN before the JS controller runs. JS adds a defensive guard that shows a clear error if Tabulator failed to load. |
| 2 | Grid container had no explicit width. | `srt-dash-root` gets `w-full` + inline `width: 100%`. Grid host inline `width: 100%`. Tabulator already uses `layout: "fitColumns"`. |
| 3 | Form panel was `max-h-[92vh]` with `max-w-7xl` (1280px cap on big screens). | Panel now uses `height: 95vh`, `max-height: 100vh`, `max-width: min(100vw, 1600px)`, flex column with sticky internal header/footer and scrollable mid-body. |
| 4 | `load_srt_form` didn't return naming_series / admin_approved_by / super_admin_approved_by / linked_erpnext_sr / amended_from. | Server: added the 5 missing fields to the load payload. JS: added an "audit strip" between header and form body that displays these fields when non-empty, plus a workflow_state pill in both the strip and the dashboard grid header. |

### Additional UI improvements

- Dashboard grid gets two new columns: **Doc** (naming_series, mono-font) and **Status** (workflow_state pill in semantic colors: slate Draft / amber Admin Approval / indigo Super Admin Approval / emerald Approved By System / rose Close)
- Workflow state pill mirrored in the form panel's audit strip
- Linked ERPNext SR rendered as a clickable link opening the native SR doc in a new tab

### Restricted areas (additional, v0.0.9.1)

- **Don't remove the Tabulator CDN `<link>` and `<script>` from `srt_dashboard.html`.** Frappe does NOT bundle Tabulator; the dashboard is a self-contained page that loads its grid library at runtime. Removing these tags breaks the page silently with "Tabulator is not defined".
- **Don't drop the `if (typeof Tabulator === "undefined")` guard in `_render_grid`.** It surfaces CDN load failures (network block / CSP) as a clear user-facing error rather than a console reference error.
- **Don't use `max-w-7xl` on the form panel.** It caps the panel at 1280px which under-utilizes 1920px+ monitors. Use `max-width: min(100vw, 1600px)` so the panel scales to large screens while staying centered.
- **Don't remove the audit strip from the form panel.** It is the DocType-parity contract — every read-only audit field on the DocType must surface here.

### Verification

27/27 across 4 suites after fix:
- test_case1_case2: 5/5
- test_srt_settings_gap: 8/8
- test_historical_stock: 4/4
- test_srt_dashboard: 10/10

Note: during testing a stale Redis queue (559 jobs from prior runs) caused a one-off `QueueOverloaded` flake on `test_reject_srt_closes_with_reason`. Cleared via `bench console` + `Queue.empty()`. Not a code issue; environmental.

---

## 19. SRT Dashboard v0.0.9 — Single Source of Truth (2026-05-23)

### What changed

v0.0.9 consolidates all operator workflow into the SRT Dashboard. The standalone `/app/srt-form` page is **DELETED**. The form lives as a slide-down panel inside the dashboard, triggered by `+ Add SRT`. All three roles (Srt User / Srt Admin / Srt Super Admin) use only this page.

### Spec
`docs/specs/2026-05-23-srt-dashboard-v0.0.9-design.md` (in-spec content matches §A-H of brainstorming summary)

### Aesthetic: "Operator Cockpit"

- Tailwind CDN runtime injected dynamically + scoped to this page only (preflight disabled — Frappe chrome survives)
- Slate-50 canvas, indigo-600 accent, Inter font + JetBrains Mono for codes
- Pill tabs with count badges (`Draft (3)  Admin Approval (12)  Super Admin Approval (5)`)
- Sticky table headers via Tabulator + `max-h: calc(100vh - 280px)` container
- Skeleton shimmer loading state, role-adaptive action visibility, role badge in header
- Sticky bottom bulk-action bar on multi-row select (`fixed bottom-6 ...`)
- Slide-down form panel: `transform: translateY(-100%) → 0` via 320ms cubic-bezier, backdrop with blur, body scroll lock

### Live sync — 3 concrete commitments

1. **Schema-driven form fields** — `get_form_meta()` returns `frappe.get_meta("Stock Reconciliation SRT").fields` so DocType schema changes propagate without JS changes
2. **WebSocket realtime** — `frappe.realtime.doctype_subscribe("Stock Reconciliation SRT")` + `list_update` handler reloads counts + grid quietly when another operator changes a doc
3. **Optimistic concurrency** — `load_srt_form` returns `modified`, `save_srt_form` echoes it back, mismatch → `TimestampMismatchError` surfaced as a reload prompt (no silent overwrites)

### Server APIs (`page/srt_dashboard/srt_dashboard.py`)

| Method | Purpose |
|---|---|
| `get_dashboard_rows(tab)` | Tab-filtered list (existing v0.0.7) |
| `get_batch_summary(srt_name)` | Per-batch Origin + summary (existing v0.0.7) |
| `get_batch_drilldown(...)` | Per-SLE In/Out split (existing v0.0.7) |
| `approve_srt(srt_name)` | Workflow-state-branched dispatch (existing v0.0.7) |
| `reject_srt(srt_name, reason)` | Forward to Close + reason annotation (existing v0.0.7) |
| `bulk_approve_srt(srt_names)` | Loop approve with per-row results (existing v0.0.7) |
| **`get_dashboard_counts()`** | NEW v0.0.9 — `{Draft: N, "Admin Approval": N, "Super Admin Approval": N}` powers tab badges |
| **`get_form_meta()`** | NEW v0.0.9 — returns DocType field shapes + user roles for schema-driven form |
| **`load_srt_form(name=None)`** | Absorbed from deleted srt-form, includes `modified` for concurrency |
| **`save_srt_form(payload, name=None)`** | Absorbed, checks `modified` against current; throws `TimestampMismatchError` on stale |
| **`submit_srt_form(name)`** | Absorbed; wraps `doc.submit()` |

### Deletions

- `page/srt_form/` directory (5 files) — DELETED
- `tests/test_srt_form.py` — DELETED (4 tests; absorbed by 4 new dashboard tests)
- `tabPage.srt-form` row — DELETED
- Workspace `SRT Form` shortcut + link — REMOVED

### Restricted areas (v0.0.9)

- Don't reintroduce a standalone `/app/srt-form` page — the dashboard IS the form (slide-down).
- Don't fork the dashboard per role — single page, role-adaptive UI via `frappe.user_roles`.
- Don't load Tailwind site-wide — CDN injection scoped to this page only; preflight disabled.
- Don't add a CSS file — Tailwind utility classes via className strings, plus the small `<style>` block in `_ensure_tailwind_runtime()` for Tabulator selectors.
- Don't hardcode the form field list — use `get_form_meta()` so schema changes propagate.
- Don't poll for changes — use `frappe.realtime` push.
- Don't silently overwrite on save — `modified` timestamp check must surface to UI as reload prompt.
- Don't use Jinja `{# … #}` comments — apostrophe gotcha persists.
- Don't drop the `wrapper._srt_dashboard_v9_initialized` re-init guard.
- Don't mount Tailwind without `corePlugins.preflight: false` — Frappe chrome breaks.

### Tests (4 new in v0.0.9)

- `test_dashboard_counts_returns_three_tabs` — tab badge powering
- `test_form_meta_returns_doctype_schema` — schema-driven form
- `test_save_throws_on_stale_modified_timestamp` — optimistic concurrency
- `test_form_save_runs_doctype_validate_chain` — DocType controller dispatch parity

Cross-suite: 27/27 (5 + 8 + 4 + 10) across all 4 active suites.

---

## 27. Report — Work Order Consumption Cost Analysis (2026-06-20)

First Script Report in the app. Lives at
`kavach/stock_reconciliation_tracking/report/work_order_consumption_cost_analysis/`
and opens at `/app/query-report/Work Order Consumption Cost Analysis`.

**What:** explodes each **Work Order** into every **batch** consumed in its
`Manufacture` Stock Entries and reports, per consumed batch (all in **stock
UOM**): the produced FG batch + valuation, MRP (Item master + Work Order),
planned/actual produced qty, the consumed batch qty + valuation + total value,
and the consumed batch's **origin** voucher (Stock Entry / Purchase Receipt /
Stock Reconciliation / Work Order) with purpose + inward rate. **Grain:** one
row per (Work Order × Manufacture Stock Entry × consumed line × consumed batch).

**Integrations (read-only):**
- ERPNext: Work Order, Stock Entry, Stock Entry Detail, Item, Batch, UOM
  Conversion Detail, Stock Ledger Entry, Serial and Batch Entry.
- chaizup_toc custom fields: `Work Order.custom_mrp`, `Item.custom_mrp`,
  `Work Order.workflow_state` — each guarded with `frappe.db.has_column` so the
  report runs even where chaizup_toc is absent.

**Reuses the app's canonical patterns:**
- Batches from the **Serial and Batch Bundle** (`SLE.batch_no` is always NULL on
  this site) — same crux as § 9 / `api.py`.
- Batch **origin** = earliest SLE for (item, batch) — same logic as
  `srt_dashboard._fetch_origin`; resolved with `ROW_NUMBER() … rn = 1`.
- **Higher UOM** = largest `UOM Conversion Detail.conversion_factor > 1` — same
  heuristic as `api._pick_higher_uom`.

**Restricted areas (do NOT change without review):**
- Keep every qty in **stock UOM**; never reintroduce a `Bin` / `Batch.batch_qty`
  read for batch quantities (materialised views drift).
- Keep cross-app custom-field reads guarded by `has_column`.
- Report stays **read-only** — no writes, ever.
- `get_columns()` order and the report `.md` column map must stay in lockstep.

**Verified** 2026-06-20 on `dev.localhost`: direct `execute()` (32 cols, year of
rows) + UI `frappe.desk.query_report.run` (127 rows / 10-day window). Spot-check
`MFG-WO-2026-00686`: status `Completed : Taken In Production`; consumed SFG batch
`691D38E` → 3960 g @ 0.154 = 611.27; origin `Stock Entry MAT-STE-04846` /
`Manufacture` @ 0.137 (the earlier manufacture that produced the SFG batch —
multi-level traceability). Component docs:
`…/report/work_order_consumption_cost_analysis/work_order_consumption_cost_analysis.md`.

---

## 28. Report — Batch Moving Costing vs Origin Analysis (2026-06-20)

Second Script Report. Lives at
`kavach/stock_reconciliation_tracking/report/batch_moving_costing_vs_origin_analysis/`
and opens at `/app/query-report/Batch Moving Costing vs Origin Analysis`. Also
surfaced in the Kavach workspace (link under "Reports" + a shortcut tile,
per user request).

**What (a batch MOVEMENT LEDGER):** one row per **(item, batch, voucher,
direction)**. Each row is a single **inward** *or* **outward** movement, all in
**stock UOM**, with the opposite direction's columns **blank**. An ordinary
voucher = one row; a **Stock Reconciliation** that moves the same batch both
ways in one voucher = **two rows**. A "movement" is any Stock Ledger voucher
(Stock Entry / Stock Reconciliation / Delivery Note / Purchase Receipt …). Each
row reports this movement's warehouse + valuation **rate** + **total**, the
batch's **origin** block (timestamp + voucher no/type/purpose + rate), this
movement's voucher block (no/type/purpose + timestamp `dd-mmm-yyyy hh:mm AM/PM`),
current batch stock, and the verdict:
- **Maintains Origin Rate?** — Yes / No: did *this* movement keep the batch's
  **origin** valuation rate, or did the rate change in the middle? No = cost
  drift (mid-life Stock Reconciliation re-rate) — the audit signal. Read a
  batch's time-ordered rows: a Yes→No flip pinpoints where the rate changed.

**Reuses the app's canonical patterns:**
- Direction = SIGN of `Serial and Batch Entry.qty` (+in/−out) from the
  **Serial and Batch Bundle** (`SLE.batch_no` NULL).
- **Value from `stock_value_difference`**, NOT `outgoing_rate` (always 0 on this
  site; per-entry rate lives in `incoming_rate`, and svd = qty × incoming_rate —
  verified live). Rate = value / qty.
- Batch **origin** = earliest SLE via `ROW_NUMBER() … rn=1` (same as § 27).
- **Higher UOM** = largest `conversion_factor > 1` (`api._pick_higher_uom`).

**Restricted areas (do NOT change without review):**
- Keep every qty/value in **stock UOM** from the bundle; never `Bin` /
  `Batch.batch_qty`.
- Value stays `stock_value_difference`-based (robust to the zero `outgoing_rate`).
- **Single-direction rows are the required grain** — don't collapse the
  reconciliation in+out pair back into one row.
- Report stays **read-only**.
- `get_columns()` order and the report `.md` column map must stay in lockstep.

**Verified** 2026-06-20 on `dev.localhost`: batch `B-CZPFG85-ABH-001` → 4 rows
incl. reconciliation `MAT-RECO-2026-01884` split into IN + OUT (opposite side
blank, both `Yes`); 20-day window → 28 cols, 3473 rows (2165 OUT / 1308 IN;
2060 No / 1413 Yes). "No" example `CZ/ITEM-00043` batch `B-…-00001`: movement
0.17514 vs origin 0.17786 on `MAT-STE-04959`. Component docs:
`…/report/batch_moving_costing_vs_origin_analysis/batch_moving_costing_vs_origin_analysis.md`.

---

## 12. Sync Block — 2026-05-23 (v0.0.9)

```
DOCTYPES SHIPPED
  Stock Reconciliation SRT       (submittable parent)
  Batch List                     (child)
  Module Def Stock Reconciliation Tracking (manually created — see Bug log)

API ENDPOINTS
  get_item_defaults(item_code)
  get_item_uoms(item_code)                    ← new 2026-05-21 (picker restriction)
  get_item_uoms_for_link(doctype, txt, searchfield, start, page_len, filters)
                                              ← new 2026-05-21 (Link-query format)
  get_uom_conversion(item_code, uom)
  get_batch_current_state(item_code, batch_no)

BUG LOG
  - Module Def: bench install-app didn't create it; manual frappe.new_doc("Module Def")
    needed before reload-doc / migrate would sync the DocTypes.
  - Uncounted-row inclusion: Frappe stores 0.0 for unset Float fields. Filter
    `qty_found is not None` includes uncounted rows. Fixed via is_counted Check field.
  - "Module not found" after prod restore (2026-05-21): app missing from
    tabInstalled Application even though apps.txt had it. HTTP requests use
    setup_module_map(include_all_apps=False) which reads SITE-installed apps only.
    Fix: add_to_installed_apps() + clear caches. Permanent guard: after_install +
    after_migrate hooks call install._ensure_site_install_record() (idempotent).

LIVE TEST (2026-05-21 dev replica)
  Item CZMAT/1585 (42 batches with positive stock)
  → Auto-populate: 42 rows
  → Counted 1 batch (CZPRD/14976/3/2026 = 2 Kg = 2000 g)
  → Submit → ERPNext SR MAT-RECO-2026-01935 created (1 SR item, qty=2000)
  → Cancel SRT → cascade-cancels SR → Bin restored exactly

RESTRICTED
  is_counted = canonical "row was counted" flag (do NOT replace with qty_found checks)
  custom_remarks (mandatory chaizup custom field) — NOT remarks
  sr._submit() + reload + assert docstatus==1 (Quirk #2 silent-submit)
  5 SABB monkey-patches before submit (Quirk #2)
  expense_account by purpose (Stock Reconciliation → Stock Adjustment account)
  use_serial_batch_fields=1 per SR Item row (Quirk #7)

LATEST UPDATE 2026-05-24 (v0.0.9.6) — Calm Cockpit Visual Refactor
            Pure cosmetic refactor. Zero logic changes. 27/27 tests still pass.
            + Typography reduced from 15 sizes / 9 weights → 4 sizes / 3 weights
              (text-xs/sm/base/lg; font-normal/medium/semibold). No more
              font-extrabold (was 42×) or font-black (was 4×).
            + Removed all 40 hover transforms. Hover = color change only.
            + Removed all 6 custom shadow tokens (card-N, float, inner-soft).
              Now using shadow-sm only.
            + Removed all UPPERCASE labels (was 80% of body labels). Sentence
              case throughout. "TARGET IDENTIFICATION" → "Item & Location".
            + Removed 4 decorative blur orbs.
            + Replaced dark gradient totals card with white card matching
              other panels. Operator UI is not a marketing landing page.
            + Replaced 36 inline unicode glyphs (→ ↗ ↳ ✓ ✗ Δ · —) with
              SVG icons or plain text in calm sentence case.
            + Added @media (prefers-reduced-motion: reduce) — WCAG 2.3.3
              compliance for vestibular sensitivity.
            + Plain copy throughout: "Source of Truth Engine v0.2.1" →
              removed; "Live Telemetry" → "Totals"; "Inspect Document" →
              "View"; "Secure & Save Draft" → "Save"; etc.
            + Restricted: don't reintroduce > 4 sizes; don't reintroduce
              > 3 weights; don't add hover transforms; don't add custom
              shadows; don't UPPERCASE; don't add blur orbs; don't put
              totals on dark gradient; don't drop reduced-motion CSS.

LATEST UPDATE 2026-05-24 (v0.0.9.5) — DocType Action Parity
            + Added 3 missing lifecycle actions to the dashboard form footer:
                1. Submit for Approval (Draft + admin role) → calls
                   submit_srt_form (existing wrapper around doc.submit()).
                   Confirmation dialog before submit.
                2. Submit Linked ERPNext SR (Admin Approval + super admin)
                   → calls the existing module-level wrapper
                   doctype.stock_reconciliation_srt.stock_reconciliation_srt
                   .submit_linked_sr which runs the 9 SABB monkey-patches
                   + Stock Settings toggle + sr._submit() per Quirk #2.
                   Confirmation explicitly warns about SLE/GL posting.
                3. Naming Series visibility — displayed in footer-left meta
                   strip when populated (e.g., "Series: SRT-RECO-2026-...").
            + New method _render_footer_actions — role + workflow-state
              aware button rendering. is_admin (Srt Admin/Super/SysMgr) +
              is_super (Srt Super Admin/SysMgr) determines visibility.
            + Restricted: don't bypass submit_linked_sr; don't show Submit
              on unsaved doc; don't show Submit Linked SR without
              linked_erpnext_sr; don't drop role checks; no Discard button.
            + 27/27 cross-suite regression.

LATEST UPDATE 2026-05-24 (v0.0.9.4) — Remove Row + Batch Link + Hide Checkbox
            + Added per-row Remove (trash icon) button column. Click splices
              row from state.batches + row.delete() + decrements counter +
              re-renders totals. No confirm (low-stakes; re-add via batch
              picker). Works on autopop AND manual rows.
            + batch_no now Tabulator `editor: "list"` with `valuesLookup`
              calling `frappe.db.get_list("Batch", { filters: {item, disabled,
              name not in already_picked, batch_id like %term%}, limit: 25 })`.
              Frappe-native — mirrors DocType set_query pattern. Autocomplete
              + debounced server-side filter (250ms). Empty cell shows search
              icon + "Search & pick batch" prompt; filled cell shows chevron
              hint on manually-added rows.
            + DELETED is_counted checkbox column — redundant with the
              Reconciliation State pill which is now clickable to toggle
              is_counted. Pill bigger + more descriptive + touch-friendly.
            + Restricted: don't re-add checkbox column; don't switch batch_no
              away from list+get_list; don't add confirm on Remove; don't
              restrict Remove to manual rows; don't drop already-picked filter.
            + 27/27 cross-suite regression.

LATEST UPDATE 2026-05-24 (v0.0.9.3) — Add Row + Custom Checkbox
            + Added Add Row button to batches grid toolbar (indigo primary,
              plus-icon SVG). Click appends blank row, auto-scrolls,
              opens batch_no cell in edit mode. Empty cell shows placeholder
              "Click to type batch...". batch_no cellEdited handler calls
              get_batch_current_state to populate warehouse/qty/rate/stock_uom.
              New rows: _origin_autopop=0 (editable batch_no), is_counted=1
              (ticked by default — operator wouldn't add a row to not count).
              Autopopulated rows: _origin_autopop=1 (batch_no locked).
            + Replaced default tickCross formatter (unstyled unicode ✓/✗)
              with custom Frappe-style checkbox — 20x20 rounded border,
              indigo-600 checked / slate-300 unchecked + hover indigo-400,
              white check-icon SVG. Click toggles is_counted + re-renders
              totals.
            + Restricted: don't switch back to tickCross; don't allow
              batch_no edit on autopop rows; don't remove empty-item guard
              on Add Row; don't auto-untick manual rows on add.
            + 27/27 cross-suite regression.

LATEST UPDATE 2026-05-23 (v0.0.9.2) — Containment + UOM Display
            + FIX: Form panel was `fixed inset-0 z-[1050]` — covered Frappe
              navbar/sidebar. Now `position: fixed; top: navbar_h; bottom: 0;
              z-index: 1015` (below sidebar 1020, navbar 1100). Backdrop
              restored at z 1010. Backdrop click + ESC key close.
            + FIX: Totals card empty state — "Pick Item & Warehouse to load
              live baseline" instead of confusing "0.000 Gram (0.000 Kg)".
            + FIX: Batch grid columns renamed to "Current (Selected UOM)"
              and "Current (Stock UOM)" + value rendered with unit inline
              ("0.021 Kg" / "20.680 Gram") so operators see both axes
              explicitly.
            + Per-axis API verified end-to-end:
                today        → 3 batches / 823.950 g (0.824 Kg)
                30 days ago  → 420 batches / 4880.260 g
            + 27/27 cross-suite regression.

LATEST UPDATE 2026-05-23 (v0.0.9.1) — Hotfix
            + FIX: "Tabulator is not defined" — Frappe doesn't bundle it.
              Added jsdelivr CDN <link> + <script> in srt_dashboard.html
              before the JS controller runs. Defensive guard in JS surfaces
              CDN-load failure as user-facing error.
            + FIX: Full-width dashboard (was wrapped at default Frappe col).
              srt-dash-root + grid-host now explicit width:100%; w-full.
            + FIX: Slide-down form now uses 95vh height, max-height 100vh,
              max-width min(100vw, 1600px). Flex column with sticky
              internal header/footer + scrollable mid-body.
            + FIX: DocType parity — form panel was missing audit fields.
              load_srt_form now returns naming_series, admin_approved_by,
              super_admin_approved_by, linked_erpnext_sr, amended_from.
              Form renders an audit strip below the panel header showing
              all non-empty audit fields, plus workflow_state pill.
            + UI: Dashboard grid gets new Doc + Status columns (workflow
              state pill in semantic colors: slate / amber / indigo /
              emerald / rose).
            + Linked ERPNext SR rendered as clickable link in audit strip
              (opens native /app/stock-reconciliation/<name> in new tab).
            + 27/27 cross-suite regression after fix.

LATEST UPDATE 2026-05-23 (v0.0.9)
            + SRT Dashboard rebuilt as Single Source of Truth
                - DELETED /app/srt-form standalone page (5 files + 4 tests)
                - Form lives as a slide-down panel inside the dashboard,
                  triggered by `+ Add SRT` page primary action
                - Tailwind CDN runtime scoped to this page (preflight off)
                - "Operator Cockpit" aesthetic: slate-50 canvas, indigo-600
                  accent, Inter typography, pill tabs with count badges
                - Sticky table headers via Tabulator + max-h container
                - Skeleton shimmer loading, role-adaptive UI (User/Admin/
                  Super Admin), role badge in page header
                - Sticky bottom bulk-action bar on multi-row select
                - Slide-down panel: translateY transform, backdrop blur,
                  body scroll lock
            + 3 new server methods absorbed/added to srt_dashboard.py:
                load_srt_form, save_srt_form, submit_srt_form,
                get_dashboard_counts, get_form_meta
            + Live sync — 3 concrete commitments:
                1. Schema-driven fields via frappe.get_meta
                2. WebSocket realtime via frappe.realtime.doctype_subscribe
                3. Optimistic concurrency via modified timestamp check
            + Workspace cleanup: SRT Form shortcut + link removed
            + 4 new tests added to test_srt_dashboard.py (10 total)
            + Cross-suite regression: 27/27 (5 + 8 + 4 + 10)

LATEST UPDATE 2026-05-23 (v0.0.8)
            + Custom Frappe Page: SRT Form (/app/srt-form)
                - Best-in-class front-end mask over the existing
                  Stock Reconciliation SRT DocType
                - Two-column responsive layout: Item/Warehouse/Posting
                  on left, live totals (Current/Found/Δ Delta) on right
                - Full-width batches grid: Tabulator + search box +
                  tick-all/untick-all + per-row Status column with live
                  delta in selected UOM
                - Sticky action bar at top (Save Draft / Submit for Approval)
                - Pure UI layer — all save / submit dispatch through
                  doc.save() / doc.submit() — zero validation duplicated
            + 3 thin server wrappers in page/srt_form/srt_form.py:
                load_srt_form, save_srt_form, submit_srt_form
            + Dashboard integration:
                - Page menu item "+ Create SRT (Form)"
                - Draft-tab View modal gains "Edit Full Form" button
                - Workspace gets SRT Form shortcut + Setup link
            + Verification: tests/test_srt_form.py (4 tests)
                4 / 4 passed on dev site. Cross-suite: 27 / 27.

LATEST UPDATE 2026-05-23 (v0.0.7)
            + Custom Frappe Page: SRT Dashboard (/app/srt-dashboard)
                - 3 tabs (Draft / Admin Approval / Super Admin Approval)
                - Tabulator grid with bulk-approve from page header
                - View modal (per row) with batch-level Origin +
                  transaction summary (Origin→Posting, Last SR→Posting)
                - Drill-down modal (per cell) with In vs Out split
                - Approve / Reject actions dispatch through existing
                  DocType controller — no validation duplicated
            + 6 server APIs in page/srt_dashboard/srt_dashboard.py:
                get_dashboard_rows, get_batch_summary, get_batch_drilldown,
                approve_srt, reject_srt, bulk_approve_srt
            + Workspace integration: new SRT Dashboard link + shortcut
                (under existing Setup card-break)
            + Mount + re-init hardening: wrapper._srt_dashboard_initialized
                guard + mount in page.body (not .layout-main-section) so
                header toolbar survives.
            + Verification: tests/test_srt_dashboard.py (6 tests)
                6 / 6 passed on dev site. Cross-suite: 23 / 23.

LATEST UPDATE 2026-05-23 (v0.0.6)
            + List-view "Status" column was rendering twice (auto-indicator
                + explicit workflow_state column). Removed in_list_view=1
                from workflow_state — auto-indicator continues to show the
                colored Status chip. JSON description annotated with a
                NOTE explaining why the omission is intentional.
            + Regression: 17/17 tests still green (UI-only change).

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
                  4 / 4 passed on dev site. Cross-suite: 17 / 17.

LATEST UPDATE 2026-05-22 (v0.0.4)
            + Duplicate-Open Guard fix — was over-strict, blocked new
                SRTs when prior was at "Super Admin Approval" (work
                actually complete). Guard now considers workflow_state
                in addition to docstatus.
            + COMPLETED_STATES = ("Super Admin Approval",
                "Approved By System") — non-blocking at docstatus=1.
            + Defensive NULL/empty workflow_state still blocks (catches
                direct-API submits that bypassed the workflow framework).
            + 3 new tests: test_super_admin_approval_does_not_block_new_srt,
                test_approved_by_system_does_not_block_new_srt,
                test_admin_approval_still_blocks_new_srt.
            + 8 / 8 gap tests + 5 / 5 Case 1/2 regression all green.

LATEST UPDATE 2026-05-22 (v0.0.3)
            + New Single DocType: SRT Settings (/app/srt-settings)
                - Field: gap_between_stock_reconciliation_days (Int, default 0)
                - Perms: SysMan + Srt Super Admin = write; Srt Admin = read;
                  Srt User = none.
            + Workspace integration: new "Setup" card-break + SRT Settings
                link + SRT Settings shortcut on the module workspace.
            + Stock Reconciliation SRT: new validate helper
                _enforce_min_gap_between_srts() — runs after the
                duplicate-open guard, before the zero-delta classifier.
                Symmetric (abs(date_diff)), skips amendments + cancelled
                + mid-fill docs. Throws "SRT Gap Violation" with
                earliest-allowed posting_date. Query searches docstatus
                IN (1, 2) so closed/historical reconciliations count.
            + Configurable anytime — reconfig takes effect on next save;
                no caching, no retroactive invalidation.
            + Verification: tests/test_srt_settings_gap.py (5 tests).
                5 / 5 passed on dev site. Regression: 10 / 10 across both
                suites.
            + Test helper hardening: _cleanup_open_srt_for_item now
                purges ALL docstatus (including 2) so cancelled test
                docs don't pollute gap-rule queries on subsequent runs.

LATEST UPDATE 2026-05-22
            + Case 1 — auto-approve when all ticked rows match current stock:
                - on_submit() branches on self.flags.all_matched_no_delta
                  (set by existing _classify_zero_delta_ticks in validate)
                - New _route_to_system_approved() method: db_set
                  workflow_state="Approved By System", stamps both
                  *_approved_by fields, fills both remark fields with
                  SYSTEM_APPROVE_MESSAGE constant (only if empty).
                - No ERPNext SR created in this path.
            + Case 2 — auto-untick matched rows on save (already in place;
              now formally documented with restricted areas).
            + Workflow upgrade: Approved By System → Close transition
                added to fresh-install transitions AND backfilled via
                idempotent _ensure_workflow_state_row() +
                _ensure_workflow_transition() helpers in install.py.
                Prerequisite workflow-state existence is now ensured on
                EVERY migrate (was previously inside the fresh-install-
                only branch; caused LinkValidationError on upgrade).
            + JS green dashboard banner at Approved By System state.
            + Verification: apps/.../tests/test_case1_case2.py — 5
                assertion-based tests, runnable via:
                `bench --site … execute kavach.
                tests.test_case1_case2.run_all`.
                Live result 2026-05-22: 5 / 5 passed.

LATEST UPDATE 2026-05-21
            + No zero-delta ticked rows validation:
                - validate(): _enforce_no_zero_delta_on_ticked_rows()
                - Blocks save when any row has Do Reconcile=1 AND
                  |qty_found - current_stock_in_selected_uom| < 0.001
                - Operator must either untick or enter a real count
                - Error lists each offending batch with its values
            + Role-gated field-level write perms on the 3 remarks:
                - user_remark        → owner only, Draft state
                - admin_remark       → Srt Admin (or above), Draft state
                - super_admin_remark → Srt Super Admin, Admin Approval state
              Server: _enforce_remark_field_permissions() in validate (uses
                self.get_doc_before_save() to detect WHICH field changed,
                so cross-role saves only fail if that role's field moved).
              Client: _ipv_srt_apply_remark_field_locks() in JS refresh —
                set_df_property("read_only", ...) for visual indicator.
              SysMan + Admin bypass both.
            + Remarks + Approval audit fields:
                - user_remark / admin_remark / super_admin_remark (Text Editor, optional)
                - admin_approved_by + super_admin_approved_by (Link User, read-only)
                - super_admin_remark has allow_on_submit=1 (super admin writes it
                  on a Submitted doc before SR submission)
                - admin_approved_by auto-stamped in on_submit;
                  super_admin_approved_by auto-stamped in submit_linked_sr
            + Workflow + RBAC (3 roles + 4-state workflow):
                - Roles: Srt User, Srt Admin, Srt Super Admin (created by install.py)
                - Workflow: Draft → Admin Approval → Super Admin Approval → Close
                - install._ensure_workflow() also pre-creates Workflow Action Master rows
                  for "Approve" + "Close" (required as the Workflow Transition.action
                  field is a Link to Workflow Action Master, not a Data field).
                - on_submit: creates draft ERPNext SR (no longer auto-submits)
                - submit_linked_sr() whitelisted method (gated to Srt Super Admin
                  + System Manager): runs two-pass rate-mirror + sr._submit() and
                  moves workflow to Super Admin Approval.
                - on_cancel: cascade-deletes draft SR OR cascade-cancels submitted SR
                  (Srt Super Admin / System Manager only for the latter).
                - validate: _enforce_no_duplicate_open_srt_for_item() blocks
                  a second SRT for an item with an existing open one (docstatus 0/1).
                - workflow_state field surfaced as "Status" in list view + standard filter.
                - "Submit Linked ERPNext SR" button (JS) visible to super admin
                  when SRT is at Admin Approval state.
                - Nobody can delete except System Manager (delete=0 in perm grid).
            + Valuation rate preservation (two-pass submit):
                - api.get_item_defaults: batches[].valuation_rate now uses
                  per-batch SLE rate (not Bin warehouse rate).
                - _create_and_submit_erpnext_sr: SR Items inserted without
                  valuation_rate; after insert, mirror current_valuation_rate
                  → valuation_rate via db_set so the SR moves only qty.
                - Live verified: 20× drift reduction (0.0137 → 0.0007);
                  remaining drift is unavoidable weighted-average shift.
            + "Do Reconcile" checkbox column (first column of Batches grid):
                - Surfaces the existing is_counted field as a user-controlled
                  checkbox. Default = unchecked.
                - Removed JS auto-tick on qty_found change — user must
                  explicitly opt-in per row.
                - Only ticked rows go to the ERPNext SR; unticked rows
                  ignore qty_found and retain their current ledger stock.
                - Submit throws if NO rows are ticked.
                - Grid column widths: is_counted(1) + batch_no(3) + select_uom(1)
                  + qty_found(1) + current_stock_in_selected_uom(1) + stock_uom(1)
                  + current_stock_in_stock_uom(1) + item_name_selected(1) = 10.

LAST EDIT  2026-05-21 — v0.0.1
            + install.py self-healing hook (after_migrate guard against missing
              tabInstalled Application row from prod restore)
            + Restricted child-grid pickers per spec:
                - batches.batch_no → filtered by parent item, excludes already-picked
                - batches.select_uom → restricted to item-master UOMs only
              (new api.get_item_uoms + get_item_uoms_for_link helpers;
               JS _ipv_srt_install_child_set_queries wired into refresh + onload)
            + Single-warehouse scoping (major UX change per spec):
                - NEW parent field: default_warehouse (Link Warehouse, reqd=1)
                - NEW child field: item_code (Link Item, read_only=1) — auto-stamped
                - CHANGED child field: warehouse → read_only=1, auto-stamped from parent
                - api.get_item_defaults now takes optional warehouse arg; when
                  present, totals + batches list are scoped to that warehouse
                - JS: fetch deferred until item AND default_warehouse both set;
                  batches_add event auto-fills warehouse/item/item_name_selected
                  /stock_uom/select_uom from parent
                - Server validate: _stamp_child_warehouse_and_item() mirrors
                  parent.default_warehouse + parent.item onto every child row
                  before duplicate-check; ordering moved _mirror_item_name to
                  run BEFORE the stamp so children inherit it
            + Label + UX cleanup:
                - Stripped "(Parent Component N)" suffix from all field labels
                  (parent + section breaks). Pattern was a spec annotation, not
                  literal naming.
                - Item/warehouse change AUTO-RESETS child rows on drafts
                  (removed frappe.confirm prompt). Submitted/cancelled untouched.
                - Explicit frm.refresh_field() calls after parent.set_value
                  for the 8 read-only fields (default_uom, higher_uom, totals)
                  — set_value alone doesn't always repaint read-only Link/Float
                  cells. Fixes "Higher UOM not showing" symptom.
                - Batch Number child column widened to 3 (Frappe grid cap = 10;
                  reshuffled current_stock_in_stock_uom to 1 to keep total ≤ 10).
```

---

## 2026-07-07 — Late-Approval Guard (negative batch from backdated approval)

**Spec:** Super Admin approving an SRT late must be BLOCKED if consumption
since the count would drive a reconciled batch negative — alert names the
batch and the over-consumed qty vs the SRT count.

**Where:** `submit_linked_sr()` → `_validate_late_approval_negative_batch(sr)`
runs FIRST (before the Quirk-#2 monkey-patches and allow-negative toggles
that would otherwise let the negative post silently). Math:
`balance(now) = counted + net_movement_after(posting_dt)`; movement summed
over both batch ledgers (SBE ⋈ SLE + legacy batch_no), strict `>` posting
timestamp (count snapshot used `<=` — no double count). Tolerance 0.0005.
No role bypass. Backfill path is unaffected: it always routes back through
the same button, so the guard is a single choke point.

**Verified live 2026-07-07** (rolled back): real pending SRT-RECO-2026-00317
(posted 2026-07-01, awaiting super admin 6 days) — clean pass; synthetic
post-count over-consumption → blocked naming batch 2APR-CZMAT/563-33,
over-consumed 5.0. 7/7 checks.

Full insight: `doctype/stock_reconciliation_srt/stock_reconciliation_srt.md`
§ 9c. Related: the CEV freeze gate (custom_erp_validation) reduces but cannot
eliminate this race — the guard is the backstop.
