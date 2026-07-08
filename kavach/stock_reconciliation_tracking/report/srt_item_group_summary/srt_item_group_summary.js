// Copyright (c) 2026, chaizup / kavach and contributors
// For license information, please see license.txt
/* ==========================================================================
 *  SRT Item Group Summary — filters
 * --------------------------------------------------------------------------
 *  CONTEXT: audit-coverage dashboard at ITEM GROUP grain. Filters per user
 *  spec 2026-07-08: from/to date on SRT CREATION time + Warehouse
 *  MultiSelectList (+ Item Group multi as a natural companion).
 *
 *  RESTRICT:
 *    - from/to bound srt.creation (created time), NOT posting_date — the
 *      user asked for created time explicitly. Don't "fix" it.
 *    - Warehouse/Item Group are MultiSelectList → arrays on the server;
 *      server tolerates JSON string too (_as_list).
 *    - Item counts + valuation columns ignore the date window by design
 *      (master data / current snapshot) — see the .py header.
 *    - "Excel (Formatted)" button → the module's whitelisted export_xlsx;
 *      the ONLY export keeping the navy header band / zebra / total row.
 *      Frappe's stock Menu > Export stays available but unstyled. The
 *      button sends the CURRENT filter values — what you see is what
 *      exports.
 * ======================================================================== */
frappe.query_reports["SRT Item Group Summary"] = {
	onload: function (report) {
		report.page.add_inner_button(__("Excel (Formatted)"), function () {
			open_url_post(
				"/api/method/kavach.stock_reconciliation_tracking.report.srt_item_group_summary.srt_item_group_summary.export_xlsx",
				{ filters: JSON.stringify(report.get_values()) }
			);
		});
	},
	filters: [
		{
			fieldname: "from_date",
			label: __("From Date (SRT Created)"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
		},
		{
			fieldname: "to_date",
			label: __("To Date (SRT Created)"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "warehouse",
			label: __("Warehouse"),
			fieldtype: "MultiSelectList",
			get_data: function (txt) {
				return frappe.db.get_link_options("Warehouse", txt, { is_group: 0 });
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
			// User 2026-07-08: "THERE WILL OPTION TO CHECK ALL OVER PENDING" —
			// ON = the two waiting columns (Admin Approval Pending, Super
			// Admin Approved Pending) ignore the date window and show the
			// FULL current backlog (warehouse/group filters still apply).
			// Every other column stays date-window-bound.
			fieldname: "all_time_pending",
			label: __("All Over Pending (ignore dates for pending columns)"),
			fieldtype: "Check",
			default: 0,
		},
	],
};
