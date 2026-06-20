// Copyright (c) 2026, chaizup / kavach and contributors
// For license information, please see license.txt
/* ==========================================================================
 *  Batch Moving Costing vs Origin Analysis — report filters + cell rendering
 * --------------------------------------------------------------------------
 *  CONTEXT (kavach › Stock Reconciliation Tracking module):
 *    Per-batch MOVEMENT LEDGER. ONE ROW PER (item, batch, voucher, direction):
 *    each row is a single INWARD or OUTWARD movement (the other side's columns
 *    are blank); a reconciliation that moves a batch both ways = two rows. Each
 *    row asks "Maintains Origin Rate?" — did this movement keep the batch's
 *    origin valuation rate, or did it change. Traces the batch ORIGIN voucher.
 *    Integrated with ERPNext (Batch / Stock Ledger Entry / Serial and Batch
 *    Bundle) — read-only.
 *
 *  RESTRICT:
 *    - Warehouse / Item / Item Group / Batch are MultiSelectList (arrays sent
 *      to the server). Company is a single Link; from/to are Dates.
 *    - from_date..to_date bound the MOVEMENT window (which movements appear);
 *      Batch Stock is the closing balance as of to_date.
 *    - Item Name renders as a hyperlink to its Item. Batch / Origin / Inward /
 *      Outward Voucher are Link / Dynamic Link columns (auto-clickable) — do
 *      NOT re-wrap those.
 * ======================================================================== */
frappe.query_reports["Batch Moving Costing vs Origin Analysis"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "from_date",
			label: __("From Date (Activity Window)"),
			fieldtype: "Date",
			default:
				frappe.defaults.get_user_default("year_start_date") ||
				frappe.datetime.add_months(frappe.datetime.get_today(), -12),
		},
		{
			fieldname: "to_date",
			label: __("To Date (As Of)"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "warehouse",
			label: __("Warehouse"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Warehouse", txt, {
					company: frappe.query_report.get_filter_value("company"),
				});
			},
		},
		{
			fieldname: "item_code",
			label: __("Item"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Item", txt);
			},
		},
		{
			fieldname: "item_group",
			label: __("Item Group"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Item Group", txt);
			},
		},
		{
			fieldname: "batch_no",
			label: __("Batch"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Batch", txt);
			},
		},
		{
			fieldname: "only_with_stock",
			label: __("Only Batches With Current Stock"),
			fieldtype: "Check",
		},
		{
			fieldname: "only_rate_changed",
			label: __("Only Origin-Rate Changes"),
			fieldtype: "Check",
		},
	],

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		// Item Name → hyperlink to its Item record (item_code is the target).
		if (column.fieldname === "item_name" && data && data.item_code) {
			value = `<a href="/app/item/${encodeURIComponent(data.item_code)}"
				title="${__("Open Item")}">${frappe.utils.escape_html(data.item_name || "")}</a>`;
		}
		// Colour the verdict: green = Yes (origin rate kept), red = No (changed).
		if (column.fieldname === "maintains_origin_rate" && data) {
			if (data.maintains_origin_rate === "No") {
				value = `<span style="color:#b91c1c;font-weight:600;">${value}</span>`;
			} else if (data.maintains_origin_rate === "Yes") {
				value = `<span style="color:#15803d;font-weight:600;">${value}</span>`;
			}
		}
		return value;
	},
};
