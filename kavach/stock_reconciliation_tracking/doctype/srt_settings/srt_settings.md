# SRT Settings — Single DocType

**Module:** Stock Reconciliation Tracking
**Type:** Single (one record per site)
**URL:** `/desk/srt-settings`

---

## 1. Purpose

Cross-cutting settings for the kavach module. Currently holds one field; future settings will live alongside it.

## 2. Fields

| Field | Type | Default | Purpose |
|---|---|---|---|
| `gap_between_stock_reconciliation_days` | Int | 0 | Minimum days between SRTs for the same item. 0 = disabled. |

## 3. How it's consumed

The SRT controller's `_enforce_min_gap_between_srts()` reads `gap_between_stock_reconciliation_days` via `frappe.db.get_single_value("SRT Settings", "gap_between_stock_reconciliation_days")`. It blocks creating a new SRT for an item until at least that many days have passed since the most recent SRT for the same item (any `docstatus IN (1, 2)`), using `posting_date` with symmetric `abs(date_diff)`.

## 4. Validation

- `validate()`: clamps `gap_days >= 0` (server-side belt for API callers; the field also has `non_negative=1` in JSON)

## 5. RESTRICT

<!-- RESTRICT: Field name is read by literal string in the SRT controller. -->
- Do NOT rename `gap_between_stock_reconciliation_days` — `stock_reconciliation_srt._enforce_min_gap_between_srts` reads it by literal fieldname
- Do NOT add lifecycle hooks (on_update etc.) unless genuinely needed — Settings docs should stay reactive (read-on-validate), not push-on-save

## 6. Dependencies

- **Stock Reconciliation SRT controller:** reads this setting on every validate()
- **Workspace:** exposed via "Setup" card + shortcut in the Kavach workspace
