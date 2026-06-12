# Batch List — Child DocType

**Module:** Stock Reconciliation Tracking
**Type:** Child table of `Stock Reconciliation SRT`
**Parent link field:** `batches`

---

## 1. Purpose

One row per (batch, warehouse) tuple for the parent SRT's item. Represents each batch with positive stock that the operator can count. Rows are auto-populated from the SLE when the operator picks an item + warehouse in the SRT form.

## 2. Key Fields

| Field | Type | Purpose |
|---|---|---|
| `batch_no` | Link → Batch | The batch identifier |
| `item_code` | Link → Item | Read-only, auto-stamped from parent.item |
| `item_name_selected` | Data | Read-only, mirrored from parent.item_name |
| `warehouse` | Link → Warehouse | Read-only, auto-stamped from parent.default_warehouse |
| `stock_uom` | Link → UOM | The item's default stock UOM |
| `select_uom` | Link → UOM | User-switchable UOM (defaults to higher UOM) |
| `conversion_factor` | Float | CF between select_uom and stock_uom |
| `current_stock_in_stock_uom` | Float | Batch qty at posting time (stock UOM) |
| `current_stock_in_selected_uom` | Float | Same qty in selected UOM |
| `is_counted` | Check | "Do Reconcile" — user must explicitly tick |
| `qty_found` | Float | Physical count the operator types (in select_uom) |
| `valuation_rate` | Float (hidden) | Per-batch rate from SLE (used in ERPNext SR creation) |

## 3. Auto-stamping

Two layers ensure every child row has correct `warehouse` + `item_code`:

1. **JS** — `batches_add` event fills fields on every new row added via UI
2. **Server** — `validate()` → `_stamp_child_warehouse_and_item()` covers REST API / fixture import / any non-UI caller

`_stamp_child_warehouse_and_item` must run AFTER `_mirror_item_name` so children inherit the item name.

## 4. RESTRICT

<!-- RESTRICT: Batch List is a THIN child — all recompute logic lives in the parent. -->
- Do NOT add `validate()` that mutates `current_stock_in_stock_uom` or `valuation_rate` — those are set by the parent's autopopulate API and reflect the SLE at the moment the row was added
- Do NOT add a uniqueness constraint here — the parent enforces "no duplicate (batch, warehouse)" because the constraint depends on parent context
- `warehouse` and `item_code` are `read_only=1` in the JSON — do NOT lift this; the auto-stamp logic relies on it

## 5. Dependencies

- **Parent:** `Stock Reconciliation SRT` — all lifecycle logic
- **api.py:** `get_item_defaults()` populates these rows from SLE
- **srt_dashboard.js:** Form panel batches grid renders these fields
