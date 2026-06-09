# =============================================================================
# CONTEXT: Stock Reconciliation Tracking — whitelisted API.
#   Single endpoint the SRT form's JS controller calls when the user picks
#   an item. Returns ALL data needed to populate parent fields 2-7 + the
#   batches child table.
#
#   Why one endpoint (not many): keeps the form's first paint snappy
#   (1 round-trip instead of ~5) and avoids inconsistent partial loads
#   (e.g., user picks item, default_uom loads but batches don't because of
#   a 500 — confusing state).
#
# MEMORY: app_kavach.md § API
#
# INSTRUCTIONS:
#   - `get_item_defaults(item_code)` returns a flat dict the JS can stuff
#     straight into frm fields + grid rows.
#   - `get_uom_conversion(item_code, uom)` is a small follow-up the JS
#     calls when the user changes "Select UOM" on a child row (no batch
#     lookup needed for that — just the CF).
#
# DANGER ZONE:
#   - Bin qty is the source of truth. NEVER read Batch.batch_qty directly
#     — Batch master qty is a materialized view that can drift. Always
#     join SLE → SABB → Bundle Entry for batch totals.
#   - Stock Adjustment account is per-company; resolve at the time of
#     create_erpnext_sr, NOT cached client-side.
#
# RESTRICT:
#   - Don't add a write endpoint here. All mutations go through the SRT
#     DocType's lifecycle (validate, on_submit). API stays read-only.
# =============================================================================

import frappe
from frappe import _
from frappe.utils import flt


@frappe.whitelist()
def get_item_defaults(item_code, warehouse=None, posting_date=None, posting_time=None):
    """
    Return everything the SRT form needs to auto-populate when an item +
    warehouse pair is picked:
       {
         "item_name":              "...",
         "default_uom":            "Gram",
         "total_current_stock_in_default_uom": 5320.4,
         "higher_uom":             "Kg",
         "higher_uom_cf":          1000,
         "total_current_stock_in_higher_uom":  5.3204,
         "batches": [
            {"batch_no": "BATCH01", "item_code": "CZMAT/1585",
             "warehouse": "WH-A", "qty": 100.0,
             "valuation_rate": 1.583, "stock_uom": "Gram",
             "select_uom": "Kg", "conversion_factor": 1000,
             "current_stock_in_selected_uom": 0.1,
             "item_name_selected": "..."},
            ...
         ]
       }

    SCOPING:
      - When `warehouse` is provided, ALL queries (total_current_stock,
        batches list) are filtered to that warehouse. Each child row gets
        warehouse = the passed warehouse, item_code = the passed item.
      - When `warehouse` is omitted (legacy callers), falls back to the
        original multi-warehouse aggregation behaviour.

    INSTRUCTIONS:
      - Batches list is BUILT FROM SLE (joined to SABB + Bundle Entry),
        NOT from Batch.batch_qty. Batch master can drift; SLE is canonical.
      - Include only rows where the (batch, warehouse) tuple has positive
        current qty. Zero/negative-balance batches are NOT auto-populated —
        the user can still manually add them.
      - select_uom defaults to higher_uom if available, else stock_uom.
      - When posting_date + posting_time are passed AND the resulting
        timestamp is in the past, the SLE join is bounded to entries
        <= that timestamp — totals + batch list reflect the historical
        "as of" state. The HAVING > 0.001 clause stays, so batches that
        had zero qty at the as-of moment are EXCLUDED from the list.
        Either input missing OR a future timestamp → unbounded (today's
        behaviour). See spec § 2.2 fallback rules.
    """
    if not item_code:
        frappe.throw(_("item_code is required"))

    item = frappe.db.get_value("Item", item_code,
        ["item_name", "stock_uom", "disabled", "has_batch_no"],
        as_dict=True)
    if not item:
        frappe.throw(_("Item {0} not found").format(item_code))
    if item.disabled:
        frappe.throw(_("Item {0} is disabled").format(item_code))
    if not item.has_batch_no:
        frappe.throw(_(
            "Item {0} is NOT batch-tracked. Stock Reconciliation SRT is "
            "designed for batched items. Use the native Stock Reconciliation "
            "form for non-batched items."
        ).format(item_code))

    stock_uom = item.stock_uom

    # Higher UOM (largest non-stock CF in the item's ladder).
    higher_uom, higher_cf = _pick_higher_uom(item_code, stock_uom)

    # Warehouse-scoped totals if warehouse is provided; else aggregate.
    # Total is computed by summing the bounded batch rows below — NOT from
    # tabBin (which is always "now"). Guarantees total == Σ children.
    if warehouse:
        as_of_clause, as_of_params = _as_of_clause(posting_date, posting_time)
        batch_rows = frappe.db.sql(f"""
            SELECT
              sbe.batch_no                            AS batch_no,
              sle.warehouse                           AS warehouse,
              SUM(sbe.qty)                            AS qty,
              MAX(sle.valuation_rate)                 AS valuation_rate
            FROM `tabStock Ledger Entry` sle
            JOIN `tabSerial and Batch Entry` sbe
                 ON sbe.parent = sle.serial_and_batch_bundle
            WHERE sle.item_code = %s
              AND sle.warehouse = %s
              AND sle.is_cancelled = 0
              AND sbe.batch_no IS NOT NULL
              AND sbe.batch_no != ''
              {as_of_clause}
            GROUP BY sbe.batch_no, sle.warehouse
            HAVING SUM(sbe.qty) > 0.001
            ORDER BY sbe.batch_no
        """, (item_code, warehouse, *as_of_params), as_dict=True)
        total_stock = sum(flt(b["qty"]) for b in batch_rows)
    else:
        as_of_clause, as_of_params = _as_of_clause(posting_date, posting_time)
        batch_rows = frappe.db.sql(f"""
            SELECT
              sbe.batch_no                            AS batch_no,
              sle.warehouse                           AS warehouse,
              SUM(sbe.qty)                            AS qty,
              MAX(sle.valuation_rate)                 AS valuation_rate
            FROM `tabStock Ledger Entry` sle
            JOIN `tabSerial and Batch Entry` sbe
                 ON sbe.parent = sle.serial_and_batch_bundle
            WHERE sle.item_code = %s
              AND sle.is_cancelled = 0
              AND sbe.batch_no IS NOT NULL
              AND sbe.batch_no != ''
              {as_of_clause}
            GROUP BY sbe.batch_no, sle.warehouse
            HAVING SUM(sbe.qty) > 0.001
            ORDER BY sle.warehouse, sbe.batch_no
        """, (item_code, *as_of_params), as_dict=True)
        total_stock = sum(flt(b["qty"]) for b in batch_rows)

    # PER-BATCH valuation rate (NOT warehouse-level Bin rate).
    #
    # CRITICAL — 2026-05-21 fix:
    #   ERPNext's Stock Reconciliation with batch_no + use_serial_batch_fields=1
    #   posts each batch at its OWN historical rate, NOT the warehouse-level
    #   Bin.valuation_rate. If we pass the Bin rate here, ERPNext computes
    #   current_valuation_rate from SLE and creates a stock_value_difference
    #   = qty×bin_rate - current_qty×batch_rate → the SR moves the Bin rate
    #   even when we only intended to move qty.
    #
    #   To preserve the rate, we MUST capture the batch's own historical
    #   rate here (MAX(sle.valuation_rate) for that batch). Then in
    #   _create_and_submit_erpnext_sr we pass it as BOTH
    #   `valuation_rate` and `current_valuation_rate` — guaranteeing
    #   the SR moves only qty.
    #
    # NOTE: do NOT switch back to bin_rates lookup — that re-introduces
    # the rate-drift bug observed on CZMAT/1585 (rate fell 1.0355 → 1.0218
    # on a +1g qty correction during the 2026-05-21 live test).
    batches = []
    for b in batch_rows:
        batch_rate = flt(b.valuation_rate) or 0
        select_uom = higher_uom or stock_uom
        cf = higher_cf if select_uom != stock_uom else 1.0
        batches.append({
            "batch_no":                       b.batch_no,
            "item_code":                      item_code,
            "warehouse":                      b.warehouse,
            "stock_uom":                      stock_uom,
            "current_stock_in_stock_uom":     flt(b.qty),
            "valuation_rate":                 batch_rate,
            "select_uom":                     select_uom,
            "conversion_factor":              cf,
            "current_stock_in_selected_uom":  flt(b.qty) / cf if cf else flt(b.qty),
            "item_name_selected":             item.item_name,
        })

    return {
        "item_name":                          item.item_name,
        "default_uom":                        stock_uom,
        "total_current_stock_in_default_uom": total_stock,
        "higher_uom":                         higher_uom or stock_uom,
        "higher_uom_cf":                      higher_cf or 1.0,
        "total_current_stock_in_higher_uom":  total_stock / (higher_cf or 1.0),
        "batches":                            batches,
    }


@frappe.whitelist()
def get_item_uoms(item_code):
    """
    Return the list of UOMs configured on the item master (stock UOM +
    all rows in tabUOM Conversion Detail). Used by the Batch List grid's
    `select_uom` set_query so the picker shows ONLY UOMs the item actually
    has a conversion for — per the spec:
      "Select UOM shows only options which UOMs configure on specific item
       master in unit of measurement child table"

    The stock UOM is ALWAYS included (CF=1) even if it doesn't appear in
    the conversion table — otherwise a user can't fall back to base units.

    Returns a sorted list of distinct UOM names. Order: stock UOM first,
    then alt UOMs by descending conversion_factor (largest first, matching
    the higher-UOM heuristic).
    """
    if not item_code:
        return []
    stock_uom = frappe.db.get_value("Item", item_code, "stock_uom") or ""
    rows = frappe.db.sql("""
        SELECT uom, conversion_factor
        FROM `tabUOM Conversion Detail`
        WHERE parent = %s AND parenttype = 'Item'
        ORDER BY conversion_factor DESC
    """, item_code, as_dict=True)
    ordered, seen = [], set()
    if stock_uom:
        ordered.append(stock_uom)
        seen.add(stock_uom)
    for r in rows:
        if r.uom and r.uom not in seen:
            ordered.append(r.uom)
            seen.add(r.uom)
    return ordered


@frappe.whitelist()
def get_item_uoms_for_link(doctype, txt, searchfield, start, page_len, filters):
    """
    Frappe Link-query-compatible variant of `get_item_uoms`.

    Used by the Batch List grid's `select_uom` set_query so the picker
    shows ONLY the UOMs from the parent item's UOM Conversion Detail
    + the stock UOM (always). Order: stock UOM first, then alt UOMs by
    descending conversion_factor.

    Returns `[[uom_name], ...]` per Frappe's standard Link-picker contract.

    INSTRUCTIONS:
      - `filters["item_code"]` is required; without it, returns empty list.
      - `txt` is honored as a case-insensitive substring filter on the UOM
        name — gives the user proper autocomplete behaviour inside the
        restricted set.
      - `start` / `page_len` are honored for pagination consistency.
    """
    # Frappe sends `filters` as a JSON-encoded string for GET requests; from
    # JS `set_query` it can also arrive as a dict. Normalize.
    if isinstance(filters, str):
        try:
            import json as _json
            filters = _json.loads(filters) if filters else {}
        except ValueError:
            filters = {}
    item_code = (filters or {}).get("item_code")
    if not item_code:
        return []
    txt = (txt or "").lower()
    uoms = get_item_uoms(item_code)
    if txt:
        uoms = [u for u in uoms if txt in (u or "").lower()]
    try:
        start = int(start or 0)
        page_len = int(page_len or 20)
    except (TypeError, ValueError):
        start, page_len = 0, 20
    return [[u] for u in uoms[start:start + page_len]]


@frappe.whitelist()
def get_uom_conversion(item_code, uom):
    """
    Return the conversion_factor for (item_code, uom) so the JS controller
    can recompute "Current Stock in Selected UOM" on a child row whenever
    the user changes Select UOM.

    Falls back to 1.0 when:
      - uom == stock_uom (no conversion)
      - the (item, uom) pair is not in tabUOM Conversion Detail
    """
    if not item_code or not uom:
        return 1.0
    stock_uom = frappe.db.get_value("Item", item_code, "stock_uom") or ""
    if uom == stock_uom:
        return 1.0
    cf = frappe.db.get_value("UOM Conversion Detail", {
        "parent": item_code,
        "parenttype": "Item",
        "uom": uom,
    }, "conversion_factor")
    return flt(cf or 1.0) or 1.0


@frappe.whitelist()
def get_batch_current_state(item_code, batch_no, posting_date=None, posting_time=None):
    """
    For a manually-added batch row, return stock + warehouse + rate as of
    the optional posting_date/posting_time. Used when the user types a
    batch that wasn't auto-populated.

    posting_date / posting_time: bounds SLE aggregation to entries
    <= as_of_datetime. Either missing or future falls back to unbounded
    (current state). See spec docs/specs/2026-05-22-srt-historical-stock-
    design.md § 2.3.

    Returns the LARGEST (positive-qty) (batch, warehouse) tuple — if a
    batch has stock in multiple warehouses, picks the one with the most.
    Returns {qty: 0, warehouse: ""} if the batch exists but has no stock
    at the as-of moment.
    """
    if not item_code or not batch_no:
        return {"qty": 0, "warehouse": "", "valuation_rate": 0, "stock_uom": ""}
    as_of_clause, as_of_params = _as_of_clause(posting_date, posting_time)
    row = frappe.db.sql(f"""
        SELECT sle.warehouse,
               SUM(sbe.qty) AS qty,
               MAX(sle.valuation_rate) AS rate
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sbe.batch_no = %s
          AND sle.is_cancelled = 0
          {as_of_clause}
        GROUP BY sle.warehouse
        HAVING SUM(sbe.qty) > 0.001
        ORDER BY SUM(sbe.qty) DESC
        LIMIT 1
    """, (item_code, batch_no, *as_of_params), as_dict=True)
    stock_uom = frappe.db.get_value("Item", item_code, "stock_uom") or ""
    if not row:
        return {"qty": 0, "warehouse": "", "valuation_rate": 0, "stock_uom": stock_uom}
    return {
        "qty":             flt(row[0].qty),
        "warehouse":       row[0].warehouse,
        "valuation_rate":  flt(row[0].rate or 0),
        "stock_uom":       stock_uom,
    }


# =============================================================================
# Internal helper
# =============================================================================
def _as_of_clause(posting_date, posting_time):
    """Build a SQL WHERE-clause fragment + params tuple that bounds SLE
    rows to `<= posting_datetime`. Returns ("", ()) when either input
    is missing OR the resulting timestamp is in the future, signalling
    "no bound" (callers concatenate the empty clause and pass the empty
    params tuple — both no-ops).

    SPEC: docs/specs/2026-05-22-srt-historical-stock-design.md § 2.2
    RESTRICT: do NOT remove the "either empty → no bound" fallback.
    Mid-fill state (validate firing before user has set posting_date)
    would return empty grids and break the form UX.
    """
    from frappe.utils import get_datetime, now_datetime

    if not (posting_date and posting_time):
        return "", ()
    try:
        as_of = get_datetime(f"{posting_date} {posting_time}")
    except Exception:
        return "", ()
    if as_of >= now_datetime():
        return "", ()
    return (
        " AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s, %s)",
        (posting_date, posting_time),
    )


def _pick_higher_uom(item_code, stock_uom):
    """Return (higher_uom, conversion_factor) — the item's largest-CF UOM
    that is NOT the stock UOM. Falls back to (stock_uom, 1.0) if no alt
    UOM exists."""
    row = frappe.db.sql("""
        SELECT uom, conversion_factor
        FROM `tabUOM Conversion Detail`
        WHERE parent = %s AND parenttype = 'Item'
          AND uom != %s
          AND IFNULL(conversion_factor, 0) > 1
        ORDER BY conversion_factor DESC LIMIT 1
    """, (item_code, stock_uom), as_dict=True)
    if row:
        return row[0].uom, flt(row[0].conversion_factor)
    return stock_uom, 1.0
