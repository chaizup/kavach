// Copyright (c) 2026, chaizup / kavach and contributors
// For license information, please see license.txt
/* ==========================================================================
 *  Work Order Consumption Cost Analysis — report filters + cell rendering
 * --------------------------------------------------------------------------
 *  CONTEXT (kavach › Stock Reconciliation Tracking module):
 *    Drills a Work Order down to every BATCH it consumed in its Manufacture
 *    Stock Entries, in STOCK UOM, with each consumed batch's valuation and
 *    its ORIGIN voucher (where the batch first entered stock). Integrated
 *    with ERPNext (Work Order / Stock Entry / Batch) + chaizup_toc custom
 *    fields (Work Order.custom_mrp, Item.custom_mrp, Work Order.workflow_state).
 *
 *  RESTRICT:
 *    - Work Order / Item to be Produced / Consumed Item / Consumed Item Group
 *      are MultiSelectList (arrays sent to the server). Company is a single
 *      Link; from/to are Dates that bound the MANUFACTURE posting date.
 *    - Date window filters the Manufacture Stock Entry posting_date (the
 *      consumption date), NOT the Work Order creation date.
 *    - Link / Dynamic Link columns (Work Order, Batch, Item, Origin Voucher)
 *      are auto-clickable — do NOT re-wrap those in the formatter.
 * ======================================================================== */
frappe.query_reports["Work Order Consumption Cost Analysis"] = {
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
			label: __("From Date (Manufacture Posting)"),
			fieldtype: "Date",
			default:
				frappe.defaults.get_user_default("year_start_date") ||
				frappe.datetime.add_months(frappe.datetime.get_today(), -12),
		},
		{
			fieldname: "to_date",
			label: __("To Date (Manufacture Posting)"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "work_order",
			label: __("Work Order"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Work Order", txt, {
					company: frappe.query_report.get_filter_value("company"),
				});
			},
		},
		{
			fieldname: "production_item",
			label: __("Item to be Produced"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Item", txt);
			},
		},
		{
			fieldname: "consumed_item",
			label: __("Consumed Item"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Item", txt);
			},
		},
		{
			fieldname: "consumed_item_group",
			label: __("Consumed Item Group"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Item Group", txt);
			},
		},
		{
			fieldname: "wo_status",
			label: __("Work Order Status"),
			fieldtype: "Select",
			options: [
				"",
				"Draft",
				"Not Started",
				"In Process",
				"Completed",
				"Stopped",
				"Closed",
				"Cancelled",
			].join("\n"),
		},
	],

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		// Consumed Item Name → hyperlink to its Item (consumed_item is the target).
		if (column.fieldname === "consumed_item_name" && data && data.consumed_item) {
			value = `<a href="/app/item/${encodeURIComponent(data.consumed_item)}"
				title="${__("Open Item")}">${frappe.utils.escape_html(data.consumed_item_name || "")}</a>`;
		}
		// Produced Item Name → hyperlink to its Item (production_item is the target).
		if (column.fieldname === "production_item_name" && data && data.production_item) {
			value = `<a href="/app/item/${encodeURIComponent(data.production_item)}"
				title="${__("Open Item")}">${frappe.utils.escape_html(data.production_item_name || "")}</a>`;
		}
		return value;
	},
};
