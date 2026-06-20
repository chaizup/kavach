# Copyright (c) 2026, chaizup / kavach and contributors
# For license information, please see license.txt
"""
============================================================================
 Work Order Consumption Cost Analysis  —  Script Report
 module: Stock Reconciliation Tracking (app: kavach)
============================================================================
CONTEXT:
    Explodes each Work Order into every BATCH it consumed during its
    `Manufacture` Stock Entries and reports the cost picture PER consumed
    batch, all normalised to the item STOCK UOM:

      Work Order block  -> created date, id, status (doc : workflow),
                           produced batch + its valuation rate, item MRP
                           (Item master) + MRP (Work Order), production item
                           (code + name), stock UOM (+cf=1), planned / actual
                           produced qty (stock UOM), higher UOM (+cf).
      Consumed block    -> consumed item (code + name), item group, stock UOM
                           (+cf=1), consumed batch, batch valuation rate as of
                           the Stock Entry date, qty consumed (stock UOM), total
                           consumed valuation, the batch ORIGIN voucher
                           (origin type / no / voucher type label / purpose /
                           rate), higher UOM (+cf). Origin purpose is the
                           REAL purpose of the origin doc (Stock Entry.purpose
                           / Stock Reconciliation.purpose e.g. "Opening Stock").

    GRAIN: one row per (Work Order, Manufacture Stock Entry, consumed Stock
    Entry Detail row, consumed batch). Work-Order / produced-batch columns
    repeat down the consumed batches of the same Stock Entry.

INTEGRATIONS (this report reads, never writes):
    - ERPNext : Work Order, Stock Entry, Stock Entry Detail, Item, Batch,
                UOM Conversion Detail, Stock Ledger Entry,
                Serial and Batch Entry (child of Serial and Batch Bundle).
    - chaizup_toc custom fields : Work Order.custom_mrp, Item.custom_mrp,
                Work Order.workflow_state. Each is read DEFENSIVELY via
                `frappe.db.has_column` so the report still runs on a site
                where chaizup_toc / its fixtures are not installed.

SITE QUIRK (the crux — same as Batch-wise Stock Balance):
    On this site batches are tracked 100% through the **Serial and Batch
    Bundle** — `Stock Ledger Entry.batch_no` and `Stock Entry Detail.batch_no`
    are NULL. The real per-batch qty / rate live in `Serial and Batch Entry`
    (sbe), child of the bundle:
        sbe.parent         = <doc>.serial_and_batch_bundle
        sbe.batch_no       = the batch
        sbe.qty            = signed qty in STOCK UOM (+in / -out)
        sbe.incoming_rate  = inward valuation rate / stock UOM
        sbe.outgoing_rate  = outward (consumption) valuation rate / stock UOM
    A legacy fallback to `Stock Entry Detail.batch_no` + `.transfer_qty` is
    kept for rows that pre-date the bundle model or non-batched items.

UOM RULE (per the requirement):
    Every qty is reported in the item STOCK UOM. Bundle `sbe.qty` is ALREADY
    in stock UOM, and Stock Entry Detail.`transfer_qty` = qty x conversion
    factor is ALSO stock UOM — so no manual conversion is needed for the
    consumed/produced qty. The "stock uom conversion factor" column is 1.0 by
    definition (CF of the stock UOM against itself). The "higher UOM" is the
    item master's LARGEST `UOM Conversion Detail.conversion_factor > 1`
    (matches kavach's `api._pick_higher_uom`) — only shown when one exists.

DANGER:
    - Only `is_cancelled = 0` SLEs / `docstatus = 1` Stock Entries count.
    - Consumed rows = Manufacture SE rows with a SOURCE warehouse and no
      target warehouse and is_finished_item = 0 (raw materials issued).
      Scrap / by-product / finished rows have a TARGET warehouse -> excluded.
    - Origin = the EARLIEST SLE (posting_date, posting_time) for the (item,
      batch) pair via the SABB join — NOT Batch.creation (master timestamps
      drift). Mirrors srt_dashboard._fetch_origin.

RESTRICT:
    - All user filter values are passed as BOUND parameters; only fixed
      column-name fragments are concatenated into SQL.
    - Do NOT switch qty back to a Bin/Batch.batch_qty read — those are
      materialised views that drift. SLE + bundle is canonical.
============================================================================
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

# Quantities / values below this absolute magnitude are treated as zero.
_QTY_TOL = 0.0001


def execute(filters=None):
	filters = frappe._dict(filters or {})
	_apply_defaults(filters)
	columns = get_columns()
	data = get_data(filters)
	return columns, data


# ---------------------------------------------------------------------------
# Server-side fallbacks so the report never crashes when run via API /
# scheduler without the JS defaults having populated the dates.
# ---------------------------------------------------------------------------
def _apply_defaults(filters):
	if not filters.get("to_date"):
		filters.to_date = nowdate()
	if not filters.get("from_date"):
		filters.from_date = frappe.utils.add_to_date(getdate(filters.to_date), years=-1)


def get_columns():
	return [
		# ---- Work Order block ------------------------------------------------
		{"label": _("WO Created Date"), "fieldname": "wo_creation", "fieldtype": "Datetime", "width": 150},
		{"label": _("Work Order"), "fieldname": "work_order", "fieldtype": "Link", "options": "Work Order", "width": 150},
		{"label": _("WO Status (Doc : Workflow)"), "fieldname": "wo_status", "fieldtype": "Data", "width": 200},
		# ---- Produced item / batch block ------------------------------------
		{"label": _("Produced Batch"), "fieldname": "produced_batch", "fieldtype": "Link", "options": "Batch", "width": 150},
		{"label": _("Item MRP (Master)"), "fieldname": "item_mrp", "fieldtype": "Currency", "width": 120},
		{"label": _("MRP (Work Order)"), "fieldname": "wo_mrp", "fieldtype": "Currency", "width": 120},
		{"label": _("Produced Val. Rate / Stock UOM"), "fieldname": "produced_valuation_rate", "fieldtype": "Currency", "width": 160, "precision": 4},
		{"label": _("Item to be Produced"), "fieldname": "production_item", "fieldtype": "Link", "options": "Item", "width": 140},
		{"label": _("Produced Item Name"), "fieldname": "production_item_name", "fieldtype": "Data", "width": 200},
		{"label": _("Stock UOM (Produced)"), "fieldname": "produced_stock_uom", "fieldtype": "Link", "options": "UOM", "width": 120},
		{"label": _("Stock UOM CF (Produced)"), "fieldname": "produced_stock_uom_cf", "fieldtype": "Float", "width": 130, "precision": 3},
		{"label": _("Planned Produced (Stock UOM)"), "fieldname": "planned_qty", "fieldtype": "Float", "width": 160, "precision": 3},
		{"label": _("Actual Produced (Stock UOM)"), "fieldname": "actual_qty", "fieldtype": "Float", "width": 160, "precision": 3},
		{"label": _("Higher UOM (Produced)"), "fieldname": "produced_higher_uom", "fieldtype": "Data", "width": 120},
		{"label": _("Higher UOM CF (Produced)"), "fieldname": "produced_higher_uom_cf", "fieldtype": "Float", "width": 140, "precision": 3},
		# ---- Consumed item / batch block ------------------------------------
		{"label": _("Consumed Item"), "fieldname": "consumed_item", "fieldtype": "Link", "options": "Item", "width": 140},
		{"label": _("Consumed Item Name"), "fieldname": "consumed_item_name", "fieldtype": "Data", "width": 200},
		{"label": _("Consumed Item Group"), "fieldname": "consumed_item_group", "fieldtype": "Link", "options": "Item Group", "width": 140},
		{"label": _("Consumed Stock UOM"), "fieldname": "consumed_stock_uom", "fieldtype": "Link", "options": "UOM", "width": 120},
		{"label": _("Consumed Stock UOM CF"), "fieldname": "consumed_stock_uom_cf", "fieldtype": "Float", "width": 140, "precision": 3},
		{"label": _("Consumed Batch"), "fieldname": "consumed_batch", "fieldtype": "Link", "options": "Batch", "width": 150},
		{"label": _("Batch Val. Rate / Stock UOM (@ SE date)"), "fieldname": "consumed_batch_val_rate", "fieldtype": "Currency", "width": 200, "precision": 4},
		{"label": _("Qty Consumed (Stock UOM)"), "fieldname": "qty_consumed", "fieldtype": "Float", "width": 160, "precision": 3},
		{"label": _("Total Consumed Valuation"), "fieldname": "total_consumed_valuation", "fieldtype": "Currency", "width": 160},
		# ---- Consumed batch ORIGIN block ------------------------------------
		{"label": _("Batch Origin Type"), "fieldname": "origin_voucher_type", "fieldtype": "Data", "width": 150},
		{"label": _("Origin Voucher No"), "fieldname": "origin_voucher", "fieldtype": "Dynamic Link", "options": "origin_voucher_type", "width": 180},
		{"label": _("Origin Voucher Type"), "fieldname": "origin_voucher_type_label", "fieldtype": "Data", "width": 150},
		{"label": _("Origin Voucher Purpose"), "fieldname": "origin_voucher_purpose", "fieldtype": "Data", "width": 160},
		{"label": _("Origin Rate / Stock UOM"), "fieldname": "origin_rate", "fieldtype": "Currency", "width": 150, "precision": 4},
		# ---- Consumed item higher UOM ---------------------------------------
		{"label": _("Consumed Higher UOM"), "fieldname": "consumed_higher_uom", "fieldtype": "Data", "width": 130},
		{"label": _("Consumed Higher UOM CF"), "fieldname": "consumed_higher_uom_cf", "fieldtype": "Float", "width": 150, "precision": 3},
		# ---- provenance (handy drill-down) ----------------------------------
		{"label": _("Manufacture Stock Entry"), "fieldname": "stock_entry", "fieldtype": "Link", "options": "Stock Entry", "width": 160},
		{"label": _("Manufacture Posting Date"), "fieldname": "se_posting_date", "fieldtype": "Date", "width": 150},
	]


def get_data(filters):
	# 1) Pull every consumed Stock Entry Detail line of every Manufacture SE,
	#    exploded into its consumed batches via the Serial and Batch Bundle.
	cond, params = _build_conditions(filters)
	params["from_date"] = getdate(filters.from_date)
	params["to_date"] = getdate(filters.to_date)

	wo_mrp_col = "wo.custom_mrp" if frappe.db.has_column("Work Order", "custom_mrp") else "NULL"
	wo_wf_col = "wo.workflow_state" if frappe.db.has_column("Work Order", "workflow_state") else "NULL"

	query = f"""
		SELECT
			wo.name                                  AS work_order,
			wo.creation                              AS wo_creation,
			wo.status                                AS wo_doc_status,
			{wo_wf_col}                              AS wo_workflow_state,
			wo.production_item                       AS production_item,
			wo.qty                                   AS planned_qty,
			wo.produced_qty                          AS actual_qty,
			{wo_mrp_col}                             AS wo_mrp,

			se.name                                  AS stock_entry,
			se.posting_date                          AS se_posting_date,

			sed.name                                 AS sed_name,
			sed.item_code                            AS consumed_item,
			sed.item_name                            AS consumed_item_name,
			sed.stock_uom                            AS consumed_stock_uom,
			sed.transfer_qty                         AS sed_transfer_qty,
			sed.valuation_rate                       AS sed_valuation_rate,
			sed.basic_rate                           AS sed_basic_rate,
			sed.serial_and_batch_bundle              AS sed_bundle,
			sed.batch_no                             AS sed_batch_no,

			sbe.batch_no                             AS sbe_batch_no,
			sbe.qty                                  AS sbe_qty,
			sbe.outgoing_rate                        AS sbe_outgoing_rate,
			sbe.stock_value_difference               AS sbe_value_diff
		FROM `tabStock Entry` se
		INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
		INNER JOIN `tabWork Order` wo           ON wo.name   = se.work_order
		LEFT  JOIN `tabSerial and Batch Entry` sbe
		       ON sbe.parent = sed.serial_and_batch_bundle
		WHERE se.docstatus = 1
		  AND se.purpose = 'Manufacture'
		  AND IFNULL(sed.s_warehouse, '') <> ''
		  AND IFNULL(sed.t_warehouse, '') = ''
		  AND IFNULL(sed.is_finished_item, 0) = 0
		  AND se.posting_date BETWEEN %(from_date)s AND %(to_date)s
		  {cond}
		ORDER BY se.posting_date DESC, wo.name, se.name, sed.idx
	"""
	raw = frappe.db.sql(query, params, as_dict=True)
	if not raw:
		return []

	# 2) Resolve the produced (finished) batch + its valuation rate per SE.
	se_names = {r.stock_entry for r in raw}
	produced = _fetch_produced(se_names)

	# 3) Higher-UOM map for all involved items (produced + consumed).
	item_codes = {r.production_item for r in raw if r.production_item}
	item_codes |= {r.consumed_item for r in raw if r.consumed_item}
	higher = _higher_uom_map(item_codes)

	# 4) Item-master MRP + stock UOM (produced item) — one batched lookup.
	item_meta = _item_meta_map(item_codes)

	# 5) Origin voucher per consumed (item, batch) pair — one batched lookup.
	pairs = {(r.consumed_item, _row_batch(r)) for r in raw if r.consumed_item and _row_batch(r)}
	origins = _fetch_origins(pairs)

	out = []
	for r in raw:
		batch = _row_batch(r)
		qty_su, rate = _row_qty_and_rate(r)
		total_val = _row_total_valuation(r, qty_su, rate)

		prod = produced.get(r.stock_entry, {})
		pmeta = item_meta.get(r.production_item, {})
		cmeta = item_meta.get(r.consumed_item, {})
		ph = higher.get(r.production_item)
		ch = higher.get(r.consumed_item)
		origin = origins.get((r.consumed_item, batch), {}) if batch else {}

		out.append({
			# WO block
			"wo_creation": r.wo_creation,
			"work_order": r.work_order,
			"wo_status": _status_label(r.wo_doc_status, r.wo_workflow_state),
			# Produced block
			"produced_batch": prod.get("batch"),
			"item_mrp": flt(pmeta.get("custom_mrp")) if pmeta.get("custom_mrp") is not None else None,
			"wo_mrp": flt(r.wo_mrp) if r.wo_mrp is not None else None,
			"produced_valuation_rate": prod.get("valuation_rate"),
			"production_item": r.production_item,
			"production_item_name": pmeta.get("item_name"),
			"produced_stock_uom": pmeta.get("stock_uom"),
			"produced_stock_uom_cf": 1.0,
			"planned_qty": flt(r.planned_qty),
			"actual_qty": flt(r.actual_qty),
			"produced_higher_uom": ph["uom"] if ph else "",
			"produced_higher_uom_cf": flt(ph["factor"]) if ph else None,
			# Consumed block
			"consumed_item": r.consumed_item,
			"consumed_item_name": r.consumed_item_name,
			"consumed_item_group": cmeta.get("item_group"),
			"consumed_stock_uom": r.consumed_stock_uom,
			"consumed_stock_uom_cf": 1.0,
			"consumed_batch": batch or "",
			"consumed_batch_val_rate": rate,
			"qty_consumed": round(qty_su, 3),
			"total_consumed_valuation": round(total_val, 2),
			# Origin block
			"origin_voucher_type": origin.get("voucher_type", ""),
			"origin_voucher": origin.get("voucher_no", ""),
			"origin_voucher_type_label": origin.get("type_label", ""),
			"origin_voucher_purpose": origin.get("purpose", ""),
			"origin_rate": origin.get("rate"),
			# Consumed higher UOM
			"consumed_higher_uom": ch["uom"] if ch else "",
			"consumed_higher_uom_cf": flt(ch["factor"]) if ch else None,
			# Provenance
			"stock_entry": r.stock_entry,
			"se_posting_date": r.se_posting_date,
		})
	return out


# ---------------------------------------------------------------------------
# Per-row batch / qty / rate resolution (bundle-first, legacy fallback).
# ---------------------------------------------------------------------------
def _row_batch(r):
	"""Consumed batch for the row: bundle entry batch wins, else the legacy
	Stock Entry Detail.batch_no. Empty string when the item is non-batched."""
	return r.sbe_batch_no or r.sed_batch_no or ""


def _row_qty_and_rate(r):
	"""(qty_in_stock_uom, valuation_rate_per_stock_uom) for the consumed row.

	BUNDLE path  : sbe.qty is signed stock-UOM qty (outward = negative) -> ABS.
	               consumption rate = |sbe.outgoing_rate|, falling back to the
	               Stock Entry Detail valuation/basic rate when the bundle row
	               carries no outgoing_rate.
	LEGACY path  : no bundle row -> use sed.transfer_qty (stock UOM) and the
	               line's valuation_rate (or basic_rate)."""
	if r.sed_bundle and r.sbe_qty is not None:
		qty = abs(flt(r.sbe_qty))
		rate = abs(flt(r.sbe_outgoing_rate)) or flt(r.sed_valuation_rate) or flt(r.sed_basic_rate)
		return qty, rate
	qty = abs(flt(r.sed_transfer_qty))
	rate = flt(r.sed_valuation_rate) or flt(r.sed_basic_rate)
	return qty, rate


def _row_total_valuation(r, qty_su, rate):
	"""Total value consumed. Prefer the bundle's own stock_value_difference
	(the exact value ERPNext moved); else qty x rate."""
	if r.sed_bundle and r.sbe_value_diff is not None and abs(flt(r.sbe_value_diff)) > _QTY_TOL:
		return abs(flt(r.sbe_value_diff))
	return flt(qty_su) * flt(rate)


def _status_label(doc_status, workflow_state):
	"""'<doc status> : <workflow status>' — collapses to just the doc status
	when no workflow_state is present (site without a Work Order workflow)."""
	doc_status = (doc_status or "").strip()
	workflow_state = (workflow_state or "").strip()
	if doc_status and workflow_state:
		return f"{doc_status} : {workflow_state}"
	return doc_status or workflow_state or ""


# ---------------------------------------------------------------------------
# Produced (finished) batch + valuation rate per Manufacture Stock Entry.
# ---------------------------------------------------------------------------
def _fetch_produced(se_names):
	"""{stock_entry: {"batch", "valuation_rate"}} for the finished-good row of
	each Manufacture SE. The produced batch comes from the finished row's
	bundle (site quirk) with a legacy fallback to its batch_no. valuation_rate
	is the rate the FG batch was produced at (per stock UOM)."""
	if not se_names:
		return {}
	rows = frappe.db.sql(
		"""
		SELECT
			sed.parent                      AS stock_entry,
			sed.idx                         AS idx,
			sed.valuation_rate              AS valuation_rate,
			sed.basic_rate                  AS basic_rate,
			sed.batch_no                    AS sed_batch_no,
			sbe.batch_no                    AS sbe_batch_no
		FROM `tabStock Entry Detail` sed
		LEFT JOIN `tabSerial and Batch Entry` sbe
		       ON sbe.parent = sed.serial_and_batch_bundle
		WHERE sed.parent IN %(se_names)s
		  AND IFNULL(sed.is_finished_item, 0) = 1
		ORDER BY sed.parent, sed.idx
		""",
		{"se_names": tuple(se_names)},
		as_dict=True,
	)
	out = {}
	for r in rows:
		# First finished row per SE wins (typically exactly one).
		if r.stock_entry in out:
			continue
		out[r.stock_entry] = {
			"batch": r.sbe_batch_no or r.sed_batch_no or "",
			"valuation_rate": flt(r.valuation_rate) or flt(r.basic_rate),
		}
	return out


# ---------------------------------------------------------------------------
# Origin voucher per (item, batch): earliest SLE via the SABB join.
# ---------------------------------------------------------------------------
def _fetch_origins(pairs):
	"""{(item_code, batch_no): {voucher_type, voucher_no, purpose, rate}}.

	Origin = the EARLIEST Stock Ledger Entry (posting_date, posting_time,
	creation) for the (item, batch) pair, resolved through the Serial and
	Batch Bundle. `rate` = that earliest entry's incoming_rate (the rate the
	batch first entered stock at). `purpose` is filled for Stock Entry origins
	(its purpose field) and labelled sensibly for the other voucher types."""
	pairs = {p for p in pairs if p[0] and p[1]}
	if not pairs:
		return {}
	items = tuple({p[0] for p in pairs})
	batches = tuple({p[1] for p in pairs})

	rows = frappe.db.sql(
		"""
		SELECT x.item_code, x.batch_no, x.voucher_type, x.voucher_no, x.incoming_rate
		FROM (
			SELECT
				sle.item_code                AS item_code,
				sbe.batch_no                 AS batch_no,
				sle.voucher_type             AS voucher_type,
				sle.voucher_no               AS voucher_no,
				sbe.incoming_rate            AS incoming_rate,
				ROW_NUMBER() OVER (
					PARTITION BY sle.item_code, sbe.batch_no
					ORDER BY sle.posting_date ASC, sle.posting_time ASC, sle.creation ASC
				) AS rn
			FROM `tabStock Ledger Entry` sle
			INNER JOIN `tabSerial and Batch Entry` sbe
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

	# Resolve the real "purpose" for Stock Entry + Stock Reconciliation origins
	# in two batched lookups (Stock Entry.purpose e.g. "Manufacture" /
	# "Material Receipt"; Stock Reconciliation.purpose e.g. "Opening Stock").
	se_origins = {r.voucher_no for r in rows if r.voucher_type == "Stock Entry" and r.voucher_no}
	sr_origins = {r.voucher_no for r in rows if r.voucher_type == "Stock Reconciliation" and r.voucher_no}
	se_purpose, sr_purpose = {}, {}
	if se_origins:
		for d in frappe.db.sql(
			"SELECT name, purpose FROM `tabStock Entry` WHERE name IN %(n)s",
			{"n": tuple(se_origins)}, as_dict=True,
		):
			se_purpose[d.name] = d.purpose
	if sr_origins:
		for d in frappe.db.sql(
			"SELECT name, purpose FROM `tabStock Reconciliation` WHERE name IN %(n)s",
			{"n": tuple(sr_origins)}, as_dict=True,
		):
			sr_purpose[d.name] = d.purpose

	out = {}
	for r in rows:
		out[(r.item_code, r.batch_no)] = {
			"voucher_type": r.voucher_type or "",
			"voucher_no": r.voucher_no or "",
			"type_label": _origin_type_label(r.voucher_type),
			"purpose": _origin_purpose(r.voucher_type, r.voucher_no, se_purpose, sr_purpose),
			"rate": flt(r.incoming_rate),
		}
	return out


def _origin_type_label(voucher_type):
	"""Friendly, normalised origin category per the requirement's four terms:
	Stock Entry / Purchase Receipt / Work Order / Reconciliation. Unknown
	voucher types pass through unchanged."""
	return {
		"Stock Entry": "Stock Entry",
		"Purchase Receipt": "Purchase Receipt",
		"Work Order": "Work Order",
		"Stock Reconciliation": "Reconciliation",
	}.get(voucher_type, voucher_type or "")


def _origin_purpose(voucher_type, voucher_no, se_purpose, sr_purpose):
	"""Human-readable origin purpose, pulled from the ORIGIN document:
	  - Stock Entry          -> its `purpose` (Manufacture / Material Receipt / ...)
	  - Stock Reconciliation -> its `purpose` (Opening Stock / Stock Reconciliation)
	  - Purchase Receipt     -> "Purchase Receipt" (no purpose field)
	  - Work Order           -> "Manufacture"
	"""
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
	"""{item_code: {item_name, item_group, stock_uom, custom_mrp}} in one read.
	custom_mrp is only selected when the chaizup_toc field is installed."""
	item_codes = {c for c in item_codes if c}
	if not item_codes:
		return {}
	has_mrp = frappe.db.has_column("Item", "custom_mrp")
	mrp_col = "custom_mrp" if has_mrp else "NULL AS custom_mrp"
	rows = frappe.db.sql(
		f"""
		SELECT name, item_name, item_group, stock_uom, {mrp_col}
		FROM `tabItem`
		WHERE name IN %(codes)s
		""",
		{"codes": tuple(item_codes)},
		as_dict=True,
	)
	return {r.name: r for r in rows}


def _higher_uom_map(item_codes):
	"""{item_code: {"uom", "factor"}} — the item master's LARGEST conversion
	factor > 1 (the biggest packaging unit, e.g. Kg over Gram). Matches
	kavach `api._pick_higher_uom`. Items without a CF>1 are simply absent."""
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
# fragments are concatenated into the fragment string.
# ---------------------------------------------------------------------------
def _build_conditions(filters):
	cond = []
	params = {}
	if filters.get("company"):
		cond.append("AND se.company = %(company)s")
		params["company"] = filters.company
	wos = _as_list(filters.get("work_order"))
	if wos:
		cond.append("AND se.work_order IN %(work_order)s")
		params["work_order"] = tuple(wos)
	prod_items = _as_list(filters.get("production_item"))
	if prod_items:
		cond.append("AND wo.production_item IN %(production_item)s")
		params["production_item"] = tuple(prod_items)
	c_items = _as_list(filters.get("consumed_item"))
	if c_items:
		cond.append("AND sed.item_code IN %(consumed_item)s")
		params["consumed_item"] = tuple(c_items)
	c_groups = _as_list(filters.get("consumed_item_group"))
	if c_groups:
		cond.append("AND sed.item_code IN (SELECT name FROM `tabItem` WHERE item_group IN %(consumed_item_group)s)")
		params["consumed_item_group"] = tuple(c_groups)
	if filters.get("wo_status"):
		cond.append("AND wo.status = %(wo_status)s")
		params["wo_status"] = filters.wo_status
	return "\n		  ".join(cond), params


def _as_list(value):
	"""Normalise a MultiSelectList value (list | csv-string | None) to a clean
	list of non-empty strings."""
	if not value:
		return []
	if isinstance(value, str):
		value = [v.strip() for v in value.split(",")]
	return [str(v).strip() for v in value if str(v).strip()]
