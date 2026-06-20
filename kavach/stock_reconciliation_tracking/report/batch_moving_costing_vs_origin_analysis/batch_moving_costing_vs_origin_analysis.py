# Copyright (c) 2026, chaizup / kavach and contributors
# For license information, please see license.txt
"""
============================================================================
 Batch Moving Costing vs Origin Analysis  —  Script Report
 module: Stock Reconciliation Tracking (app: kavach)
============================================================================
CONTEXT:
    A per-batch **movement ledger** that asks one question of every movement:
    *did this batch keep its ORIGIN valuation rate, or did the rate change in
    the middle of its life?*

    GRAIN (important — clarified 2026-06-20):
        ONE ROW PER (item, batch, voucher, direction).
        Each row is a SINGLE direction — an INWARD movement or an OUTWARD
        movement — never both. The opposite side's columns are left BLANK.
        A movement is a transaction from a Stock Entry / Stock Reconciliation /
        any Stock Ledger voucher.

        In one ordinary voucher an item moves one way, so it makes ONE row.
        A **Stock Reconciliation** can move the same batch BOTH in and out in
        the same voucher — that becomes TWO rows (one inward with the outward
        columns blank, one outward with the inward columns blank). Verified
        live: MAT-RECO-… batch B-CZPFG85-ABH-… posts +12 and −12 → 2 rows.

    Each row carries:
      Item block   -> item code + name, stock UOM (+cf=1), higher UOM (+cf).
      Batch block  -> batch number, current batch stock (stock UOM, as of to_date).
      Costing      -> for this row's direction only: warehouse, valuation RATE
                      per stock UOM, valuation TOTAL. The other direction blank.
      Origin block -> the batch's FIRST-ever movement: timestamp, voucher
                      no / type / purpose, and origin rate per stock UOM.
      Movement vch -> this row's voucher no / type / purpose / timestamp, placed
                      in the inward OR outward voucher columns per direction.
      Verdict      -> "Maintains Origin Rate?" Yes / No: does THIS movement's
                      rate equal the origin rate (within tolerance)? "No" flags
                      the movement where the cost drifted away from origin.

INTEGRATIONS (this report reads, never writes):
    - ERPNext : Batch, Item, UOM Conversion Detail, Stock Ledger Entry,
                Serial and Batch Entry (child of Serial and Batch Bundle),
                Stock Entry / Stock Reconciliation (for the voucher purpose).

SITE QUIRK (the crux — shared with the other kavach reports):
    Batches are tracked 100% through the **Serial and Batch Bundle** —
    `Stock Ledger Entry.batch_no` is NULL. Per-batch movement lives in
    `Serial and Batch Entry` (sbe):
        sbe.parent                 = sle.serial_and_batch_bundle
        sbe.batch_no               = the batch
        sbe.qty                    = signed qty in STOCK UOM (+in / -out)
        sbe.stock_value_difference = signed value moved        (+in / -out)
    `sbe.outgoing_rate` is ALWAYS 0 on this site; the per-entry rate sits in
    `incoming_rate`, and svd = qty x incoming_rate. So a movement's value is
    `SUM(ABS(stock_value_difference))` and its RATE = value / qty — robust to
    the empty outgoing_rate. The +in / -out SIGN is what splits a row into the
    inward vs outward direction.

UOM RULE (per the requirement):
    `sbe.qty` is already in the STOCK UOM, so no conversion is needed. The
    "stock uom conversion factor" column is 1.0. The "higher UOM" is the item
    master's LARGEST `UOM Conversion Detail.conversion_factor > 1` (matches
    `api._pick_higher_uom`); shown only when one exists.

DANGER:
    - Only `is_cancelled = 0` SLEs count.
    - Movement rows are bounded to the [from_date, to_date] window. Batch stock
      (current balance) is the closing balance `posting_date <= to_date`.
    - Origin = earliest SLE (posting_date, posting_time, creation) for the
      (item, batch) pair via the SABB join — NOT Batch.creation (drifts).

RESTRICT:
    - All user filter values are BOUND params; only fixed column-name
      fragments are concatenated into SQL.
    - Do NOT collapse the two reconciliation rows back into one — single-
      direction rows are the required grain.
    - Do NOT read `Bin` / `Batch.batch_qty` — materialised views that drift.
============================================================================
"""

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, getdate, nowdate

# Magnitudes below this are treated as zero (float-dust guard).
_QTY_TOL = 0.0001
# Relative tolerance for the origin-rate "maintained" verdict (0.5%).
_RATE_TOL = 0.005


def execute(filters=None):
	filters = frappe._dict(filters or {})
	_apply_defaults(filters)
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def _apply_defaults(filters):
	if not filters.get("to_date"):
		filters.to_date = nowdate()
	if not filters.get("from_date"):
		filters.from_date = frappe.utils.add_to_date(getdate(filters.to_date), years=-1)


def get_columns():
	return [
		# ---- Item block ------------------------------------------------------
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 130},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
		{"label": _("Stock UOM"), "fieldname": "stock_uom", "fieldtype": "Link", "options": "UOM", "width": 100},
		{"label": _("Stock UOM CF"), "fieldname": "stock_uom_cf", "fieldtype": "Float", "width": 110, "precision": 3},
		{"label": _("Higher UOM"), "fieldname": "higher_uom", "fieldtype": "Data", "width": 100},
		{"label": _("Higher UOM CF"), "fieldname": "higher_uom_cf", "fieldtype": "Float", "width": 120, "precision": 3},
		# ---- Batch block -----------------------------------------------------
		{"label": _("Batch Number"), "fieldname": "batch_no", "fieldtype": "Link", "options": "Batch", "width": 160},
		{"label": _("Batch Stock (Stock UOM)"), "fieldname": "batch_stock", "fieldtype": "Float", "width": 150, "precision": 3},
		# ---- Costing block (only this row's direction is filled) -------------
		{"label": _("Inward Warehouse"), "fieldname": "inward_warehouse", "fieldtype": "Data", "width": 180},
		{"label": _("Outward Warehouse"), "fieldname": "outward_warehouse", "fieldtype": "Data", "width": 180},
		{"label": _("Inward Val. Rate / Stock UOM"), "fieldname": "inward_rate", "fieldtype": "Currency", "width": 170, "precision": 4},
		{"label": _("Outward Val. Rate / Stock UOM"), "fieldname": "outward_rate", "fieldtype": "Currency", "width": 170, "precision": 4},
		{"label": _("Inward Valuation Total"), "fieldname": "inward_total", "fieldtype": "Currency", "width": 160},
		{"label": _("Outward Valuation Total"), "fieldname": "outward_total", "fieldtype": "Currency", "width": 160},
		# ---- Origin block (the batch's FIRST movement) ----------------------
		{"label": _("Batch Origin Timestamp"), "fieldname": "origin_timestamp", "fieldtype": "Data", "width": 170},
		{"label": _("Batch Origin Voucher No"), "fieldname": "origin_voucher", "fieldtype": "Dynamic Link", "options": "origin_voucher_type", "width": 180},
		{"label": _("Batch Origin Voucher Type"), "fieldname": "origin_voucher_type", "fieldtype": "Data", "width": 170},
		{"label": _("Batch Origin Voucher Purpose"), "fieldname": "origin_voucher_purpose", "fieldtype": "Data", "width": 190},
		{"label": _("Batch Origin Rate / Stock UOM"), "fieldname": "origin_rate", "fieldtype": "Currency", "width": 180, "precision": 4},
		# ---- This movement's voucher (placed per direction) -----------------
		{"label": _("Inward Voucher No"), "fieldname": "inward_voucher", "fieldtype": "Dynamic Link", "options": "inward_voucher_type", "width": 170},
		{"label": _("Inward Voucher Type"), "fieldname": "inward_voucher_type", "fieldtype": "Data", "width": 150},
		{"label": _("Inward Voucher Purpose"), "fieldname": "inward_voucher_purpose", "fieldtype": "Data", "width": 170},
		{"label": _("Inward Timestamp"), "fieldname": "inward_timestamp", "fieldtype": "Data", "width": 170},
		{"label": _("Outward Voucher No"), "fieldname": "outward_voucher", "fieldtype": "Dynamic Link", "options": "outward_voucher_type", "width": 170},
		{"label": _("Outward Voucher Type"), "fieldname": "outward_voucher_type", "fieldtype": "Data", "width": 150},
		{"label": _("Outward Voucher Purpose"), "fieldname": "outward_voucher_purpose", "fieldtype": "Data", "width": 170},
		{"label": _("Outward Timestamp"), "fieldname": "outward_timestamp", "fieldtype": "Data", "width": 170},
		# ---- Verdict ---------------------------------------------------------
		{"label": _("Maintains Origin Rate?"), "fieldname": "maintains_origin_rate", "fieldtype": "Data", "width": 170},
	]


def get_data(filters):
	cond, params = _build_conditions(filters)
	params["from_date"] = getdate(filters.from_date)
	params["to_date"] = getdate(filters.to_date)

	# One row per (item, batch, voucher, direction) within the movement window.
	# sbe.qty is stock-UOM and SIGNED (+in/-out); the sign drives `direction`.
	# value = SUM(ABS(stock_value_difference)) (robust to the zero outgoing_rate);
	# rate = value / qty.
	movements = frappe.db.sql(f"""
		SELECT
			sle.item_code                                  AS item_code,
			sbe.batch_no                                   AS batch_no,
			sle.voucher_type                               AS voucher_type,
			sle.voucher_no                                 AS voucher_no,
			CASE WHEN sbe.qty > 0 THEN 'in' ELSE 'out' END AS direction,
			SUM(ABS(sbe.qty))                              AS qty,
			SUM(ABS(sbe.stock_value_difference))           AS value,
			GROUP_CONCAT(DISTINCT sle.warehouse)           AS warehouse,
			MAX(TIMESTAMP(sle.posting_date, sle.posting_time)) AS posting_datetime
		FROM `tabStock Ledger Entry` sle
		JOIN `tabSerial and Batch Entry` sbe
		     ON sbe.parent = sle.serial_and_batch_bundle
		WHERE sle.is_cancelled = 0
		  AND IFNULL(sbe.batch_no, '') <> ''
		  AND IFNULL(sbe.qty, 0) <> 0
		  AND sle.posting_date BETWEEN %(from_date)s AND %(to_date)s
		  {cond}
		GROUP BY sle.item_code, sbe.batch_no, sle.voucher_type, sle.voucher_no, direction
		ORDER BY sle.item_code, sbe.batch_no, posting_datetime, direction
	""", params, as_dict=True)
	if not movements:
		return []

	# Enrichment lookups (batched).
	item_codes = {m.item_code for m in movements if m.item_code}
	item_meta = _item_meta_map(item_codes)
	higher = _higher_uom_map(item_codes)
	pairs = {(m.item_code, m.batch_no) for m in movements}
	origins = _fetch_origins(pairs)
	balances = _fetch_balances(pairs, params["to_date"], cond, params)
	se_purpose, sr_purpose = _purpose_maps(movements)

	group_filter = set(_as_list(filters.get("item_group")))
	only_with_stock = bool(filters.get("only_with_stock"))
	only_rate_changed = bool(filters.get("only_rate_changed"))

	out = []
	for m in movements:
		meta = item_meta.get(m.item_code, {})
		if group_filter and meta.get("item_group") not in group_filter:
			continue

		batch_stock = flt(balances.get((m.item_code, m.batch_no), 0.0))
		if only_with_stock and abs(batch_stock) <= _QTY_TOL:
			continue

		qty = flt(m.qty)
		value = flt(m.value)
		rate = (value / qty) if qty > _QTY_TOL else 0.0
		ts = _fmt_dt(m.posting_datetime)
		purpose = _origin_purpose(m.voucher_type, m.voucher_no, se_purpose, sr_purpose)

		origin = origins.get((m.item_code, m.batch_no), {})
		verdict = _maintains_origin(rate, origin.get("rate"))
		if only_rate_changed and verdict != "No":
			continue

		h = higher.get(m.item_code)
		is_in = (m.direction == "in")

		row = {
			# Item
			"item_code": m.item_code,
			"item_name": meta.get("item_name"),
			"stock_uom": meta.get("stock_uom"),
			"stock_uom_cf": 1.0,
			"higher_uom": h["uom"] if h else "",
			"higher_uom_cf": flt(h["factor"]) if h else None,
			# Batch
			"batch_no": m.batch_no,
			"batch_stock": round(batch_stock, 3),
			# Costing (only this row's direction is populated; other side blank)
			"inward_warehouse": (m.warehouse or "") if is_in else "",
			"outward_warehouse": "" if is_in else (m.warehouse or ""),
			"inward_rate": rate if is_in else None,
			"outward_rate": None if is_in else rate,
			"inward_total": round(value, 2) if is_in else None,
			"outward_total": None if is_in else round(value, 2),
			# Origin (repeats per batch)
			"origin_timestamp": origin.get("timestamp", ""),
			"origin_voucher": origin.get("voucher_no", ""),
			"origin_voucher_type": origin.get("voucher_type", ""),
			"origin_voucher_purpose": origin.get("purpose", ""),
			"origin_rate": origin.get("rate"),
			# This movement's voucher, placed in the matching direction's columns
			"inward_voucher": m.voucher_no if is_in else "",
			"inward_voucher_type": m.voucher_type if is_in else "",
			"inward_voucher_purpose": purpose if is_in else "",
			"inward_timestamp": ts if is_in else "",
			"outward_voucher": "" if is_in else m.voucher_no,
			"outward_voucher_type": "" if is_in else m.voucher_type,
			"outward_voucher_purpose": "" if is_in else purpose,
			"outward_timestamp": "" if is_in else ts,
			# Verdict
			"maintains_origin_rate": verdict,
		}
		out.append(row)
	return out


# ---------------------------------------------------------------------------
# Verdict + formatting helpers.
# ---------------------------------------------------------------------------
def _close(a, b):
	"""True when two rates are equal within _RATE_TOL (relative tolerance).
	Relative (not absolute) so it scales across cheap and expensive items."""
	base = max(abs(flt(a)), abs(flt(b)), _QTY_TOL)
	return abs(flt(a) - flt(b)) / base <= _RATE_TOL


def _maintains_origin(movement_rate, origin_rate):
	"""'Yes' / 'No' — did this movement keep the batch's ORIGIN rate?
	  - 'Yes' : origin rate is non-zero AND this movement's rate equals it
	            within _RATE_TOL (the cost was maintained).
	  - 'No'  : the rate changed from origin — OR the origin entered at rate 0
	            (a qty-only opening) while this movement carries a real rate.
	"""
	if not origin_rate or abs(flt(origin_rate)) <= _QTY_TOL:
		return "No"
	return "Yes" if _close(movement_rate, origin_rate) else "No"


def _fmt_dt(value):
	"""Format a datetime as 'dd-mmm-yyyy hh:mm AM/PM' (e.g. 20-Jun-2026 02:34 PM).
	Forced here (Data column) so the format is stable regardless of the site's
	datetime display setting. Empty string for a missing value."""
	if not value:
		return ""
	try:
		return get_datetime(value).strftime("%d-%b-%Y %I:%M %p")
	except Exception:
		return str(value)


# ---------------------------------------------------------------------------
# Current batch balance (stock UOM) per (item, batch), as of to_date.
# ---------------------------------------------------------------------------
def _fetch_balances(pairs, to_date, cond, params):
	pairs = {p for p in pairs if p[0] and p[1]}
	if not pairs:
		return {}
	q_params = dict(params)
	q_params["b_items"] = tuple({p[0] for p in pairs})
	q_params["b_batches"] = tuple({p[1] for p in pairs})
	rows = frappe.db.sql(f"""
		SELECT sle.item_code AS item_code, sbe.batch_no AS batch_no,
		       SUM(sbe.qty) AS bal
		FROM `tabStock Ledger Entry` sle
		JOIN `tabSerial and Batch Entry` sbe
		     ON sbe.parent = sle.serial_and_batch_bundle
		WHERE sle.is_cancelled = 0
		  AND IFNULL(sbe.batch_no, '') <> ''
		  AND sle.posting_date <= %(to_date)s
		  AND sle.item_code IN %(b_items)s
		  AND sbe.batch_no  IN %(b_batches)s
		  {cond}
		GROUP BY sle.item_code, sbe.batch_no
	""", q_params, as_dict=True)
	return {(r.item_code, r.batch_no): flt(r.bal) for r in rows}


# ---------------------------------------------------------------------------
# Origin voucher per (item, batch): earliest SLE via the SABB join.
# ---------------------------------------------------------------------------
def _fetch_origins(pairs):
	pairs = {p for p in pairs if p[0] and p[1]}
	if not pairs:
		return {}
	items = tuple({p[0] for p in pairs})
	batches = tuple({p[1] for p in pairs})

	rows = frappe.db.sql(
		"""
		SELECT x.item_code, x.batch_no, x.voucher_type, x.voucher_no,
		       x.incoming_rate, x.posting_datetime
		FROM (
			SELECT
				sle.item_code     AS item_code,
				sbe.batch_no      AS batch_no,
				sle.voucher_type  AS voucher_type,
				sle.voucher_no    AS voucher_no,
				sbe.incoming_rate AS incoming_rate,
				TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime,
				ROW_NUMBER() OVER (
					PARTITION BY sle.item_code, sbe.batch_no
					ORDER BY sle.posting_date ASC, sle.posting_time ASC, sle.creation ASC
				) AS rn
			FROM `tabStock Ledger Entry` sle
			JOIN `tabSerial and Batch Entry` sbe
			     ON sbe.parent = sle.serial_and_batch_bundle
			WHERE sle.is_cancelled = 0
			  AND sle.item_code IN %(items)s
			  AND sbe.batch_no  IN %(batches)s
		) x
		WHERE x.rn = 1
		""",
		{"items": items, "batches": batches},
		as_dict=True,
	)

	se_purpose, sr_purpose = _purpose_maps(rows)
	out = {}
	for r in rows:
		out[(r.item_code, r.batch_no)] = {
			"voucher_type": r.voucher_type or "",
			"voucher_no": r.voucher_no or "",
			"purpose": _origin_purpose(r.voucher_type, r.voucher_no, se_purpose, sr_purpose),
			"rate": flt(r.incoming_rate),
			"timestamp": _fmt_dt(r.posting_datetime),
		}
	return out


def _purpose_maps(rows):
	"""Shared purpose resolver. `rows` is any iterable of dict-rows with
	`voucher_type` + `voucher_no`. Returns (se_purpose, sr_purpose) — each
	{voucher_no: purpose} — in two batched lookups (Stock Entry.purpose /
	Stock Reconciliation.purpose)."""
	se = {r.voucher_no for r in rows if r.voucher_type == "Stock Entry" and r.voucher_no}
	sr = {r.voucher_no for r in rows if r.voucher_type == "Stock Reconciliation" and r.voucher_no}
	se_purpose, sr_purpose = {}, {}
	if se:
		for d in frappe.db.sql(
			"SELECT name, purpose FROM `tabStock Entry` WHERE name IN %(n)s",
			{"n": tuple(se)}, as_dict=True,
		):
			se_purpose[d.name] = d.purpose
	if sr:
		for d in frappe.db.sql(
			"SELECT name, purpose FROM `tabStock Reconciliation` WHERE name IN %(n)s",
			{"n": tuple(sr)}, as_dict=True,
		):
			sr_purpose[d.name] = d.purpose
	return se_purpose, sr_purpose


def _origin_purpose(voucher_type, voucher_no, se_purpose, sr_purpose):
	"""Human-readable purpose pulled from the ORIGIN/movement document.
	e.g. Stock Reconciliation is the voucher type, purpose = 'Opening Stock'."""
	if voucher_type == "Stock Entry":
		return se_purpose.get(voucher_no, "Stock Entry")
	if voucher_type == "Stock Reconciliation":
		return sr_purpose.get(voucher_no, "Stock Reconciliation")
	if voucher_type == "Purchase Receipt":
		return "Purchase Receipt"
	if voucher_type == "Work Order":
		return "Manufacture"
	return voucher_type or ""


# ---------------------------------------------------------------------------
# Item master helpers.
# ---------------------------------------------------------------------------
def _item_meta_map(item_codes):
	"""{item_code: {item_name, item_group, stock_uom}} in one read."""
	item_codes = {c for c in item_codes if c}
	if not item_codes:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT name, item_name, item_group, stock_uom
		FROM `tabItem`
		WHERE name IN %(codes)s
		""",
		{"codes": tuple(item_codes)},
		as_dict=True,
	)
	return {r.name: r for r in rows}


def _higher_uom_map(item_codes):
	"""{item_code: {"uom", "factor"}} — the item master's LARGEST conversion
	factor > 1 (biggest packaging unit). Items without a CF>1 are absent."""
	item_codes = {c for c in item_codes if c}
	if not item_codes:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT parent AS item_code, uom, conversion_factor
		FROM `tabUOM Conversion Detail`
		WHERE parent IN %(items)s AND conversion_factor > 1
		ORDER BY parent, conversion_factor DESC
		""",
		{"items": tuple(item_codes)},
		as_dict=True,
	)
	out = {}
	for r in rows:
		if r.item_code not in out:  # first = largest factor = biggest higher unit
			out[r.item_code] = {"uom": r.uom, "factor": flt(r.conversion_factor)}
	return out


# ---------------------------------------------------------------------------
# Filter -> SQL. Every user value is a BOUND PARAM; only fixed column-name
# fragments are concatenated. (item_group is applied post-join in get_data.)
# ---------------------------------------------------------------------------
def _build_conditions(filters):
	cond = []
	params = {}
	if filters.get("company"):
		cond.append("AND sle.company = %(company)s")
		params["company"] = filters.company
	wh = _as_list(filters.get("warehouse"))
	if wh:
		cond.append("AND sle.warehouse IN %(warehouse)s")
		params["warehouse"] = tuple(wh)
	items = _as_list(filters.get("item_code"))
	if items:
		cond.append("AND sle.item_code IN %(item_code)s")
		params["item_code"] = tuple(items)
	batches = _as_list(filters.get("batch_no"))
	if batches:
		cond.append("AND sbe.batch_no IN %(batch_no)s")
		params["batch_no"] = tuple(batches)
	return "\n		  ".join(cond), params


def _as_list(value):
	"""Normalise a MultiSelectList value (list | csv-string | None) to a clean
	list of non-empty strings."""
	if not value:
		return []
	if isinstance(value, str):
		value = [v.strip() for v in value.split(",")]
	return [str(v).strip() for v in value if str(v).strip()]
