// =============================================================================
// CONTEXT: Stock Reconciliation SRT — LIST VIEW controller.
//
//   Frappe auto-loads `<scrubbed_doctype>_list.js` from the doctype folder and
//   reads `frappe.listview_settings["Stock Reconciliation SRT"]` (no hooks.py
//   wiring needed — same convention as frappe core's note_list.js / todo_list.js).
//
//   Two jobs (2026-06-26):
//
//     1. LINKED SR HYPERLINK COLUMN
//        `linked_erpnext_sr` is in_list_view in the JSON, so it renders as a
//        column. The formatter below turns it into a real hyperlink to the
//        ERPNext Stock Reconciliation, and — crucially — renders a red
//        "⚠ Missing — relink" hint when an ADMIN-APPROVED row (docstatus=1,
//        not Approved By System) has NO link. That makes orphans visible at a
//        glance instead of looking like a blank cell.
//
//     2. SUPER-ADMIN RELINK ACTION
//        For Srt Super Admin / System Manager, a "Relink ERPNext SR" inner
//        button group:
//          - "Scan & Fix All Missing" → finds every admin-approved SRT with an
//            empty link and creates the missing DRAFT ERPNext SR for each.
//          - "Fix Selected" → does the same for the checked rows, and ALSO
//            repairs links that point at a deleted/cancelled SR (explicit
//            selection = intent to repair).
//        Both dispatch to the whitelisted backfill_missing_sr() server method,
//        which re-uses the SAME ensure_linked_sr() path on_submit uses.
//
// MEMORY: stock_reconciliation_srt.md (DocType), stock_reconciliation_tracking.md (module)
//
// RESTRICT:
//   - Do NOT duplicate eligibility logic here. The server
//     (backfill_missing_sr) re-validates every row; this JS is convenience UI.
//   - Do NOT show the relink buttons to non-super-admins — the server gate
//     (_can_backfill_missing_sr) is authoritative, but hiding the button keeps
//     the UI honest.
//   - "Approved By System" rows legitimately have no SR — the formatter shows
//     a muted note for them, never the red "Missing" warning.
// =============================================================================

frappe.listview_settings["Stock Reconciliation SRT"] = {

    // Pull the fields the formatter + actions need (beyond the default columns).
    add_fields: ["linked_erpnext_sr", "workflow_state", "docstatus"],

    formatters: {
        linked_erpnext_sr(value, df, doc) {
            if (value) {
                const safe = frappe.utils.escape_html(value);
                const href = "/app/stock-reconciliation/" + encodeURIComponent(value);
                return `<a href="${href}" title="${__("Open ERPNext Stock Reconciliation")} ${safe}">${safe}</a>`;
            }
            // No link. Decide whether that is EXPECTED or an ORPHAN.
            const state = doc.workflow_state || "";
            if (Number(doc.docstatus) === 1 && state === "Approved By System") {
                // Case 1 — every ticked batch matched current stock; no SR by design.
                return `<span class="text-muted" title="${__("Auto-approved by system — no ERPNext SR is created when every counted batch already matches current stock.")}">${__("— (system-approved)")}</span>`;
            }
            if (Number(doc.docstatus) === 1) {
                // Admin-approved but missing its SR → the orphan we want to surface.
                return `<span class="indicator-pill red" title="${__("Admin-approved but the ERPNext Stock Reconciliation was never created/linked. Use Relink ERPNext SR → Fix Selected (Srt Super Admin).")}">${__("⚠ Missing — relink")}</span>`;
            }
            // Draft / cancelled — no SR expected yet.
            return `<span class="text-muted">—</span>`;
        },
    },

    onload(listview) {
        const roles = frappe.user_roles || [];
        const is_super = roles.includes("Srt Super Admin")
            || roles.includes("System Manager")
            || frappe.session.user === "Administrator";
        if (!is_super) return;

        const GROUP = __("Relink ERPNext SR");

        // ── Scan & fix ALL admin-approved SRTs with an EMPTY link ──────────
        listview.page.add_inner_button(__("Scan & Fix All Missing"), () => {
            frappe.call({
                method: "kavach.stock_reconciliation_tracking.doctype.stock_reconciliation_srt.stock_reconciliation_srt.get_backfill_candidates",
                freeze: true,
                freeze_message: __("Scanning for SRTs missing their ERPNext SR…"),
            }).then(r => {
                const data = r.message || { count: 0, rows: [] };
                const empties = (data.rows || []).filter(x => x.reason === "no_link");
                if (!empties.length) {
                    frappe.msgprint({
                        title: __("All clear"),
                        message: __("No admin-approved SRTs are missing their linked ERPNext Stock Reconciliation."),
                        indicator: "green",
                    });
                    return;
                }
                const list_html = empties.slice(0, 50).map(x =>
                    `<li><b>${frappe.utils.escape_html(x.name)}</b> — ${frappe.utils.escape_html(x.item_name || x.item || "")} <span class="text-muted">(${frappe.utils.escape_html(x.workflow_state || "")})</span></li>`
                ).join("");
                frappe.confirm(
                    __("Found <b>{0}</b> admin-approved SRT(s) with NO linked ERPNext SR. Create the missing draft Stock Reconciliation for each?", [empties.length])
                        + `<ul style="margin-top:8px;max-height:240px;overflow:auto">${list_html}</ul>`
                        + (empties.length > 50 ? `<div class="text-muted">${__("…and more")}</div>` : ""),
                    () => _ipv_srt_run_backfill(listview, null, 0),
                );
            });
        }, GROUP);

        // ── Fix only the SELECTED rows (also repairs broken links) ─────────
        listview.page.add_inner_button(__("Fix Selected"), () => {
            const names = listview.get_checked_items(true);
            if (!names || !names.length) {
                frappe.msgprint({
                    title: __("No rows selected"),
                    message: __("Tick the SRT rows you want to relink, then choose Fix Selected. (Tip: filter the list by Linked ERPNext SR = empty to find orphans.)"),
                    indicator: "orange",
                });
                return;
            }
            frappe.confirm(
                __("Create / relink the draft ERPNext Stock Reconciliation for the <b>{0}</b> selected SRT(s)? Rows that already have a valid link are skipped; links pointing at a cancelled/deleted SR are re-created.", [names.length]),
                () => _ipv_srt_run_backfill(listview, names, 1),
            );
        }, GROUP);
    },
};


// =============================================================================
// Helper — dispatch the backfill call and render a per-row result summary.
// =============================================================================
function _ipv_srt_run_backfill(listview, names, repair_broken) {
    frappe.call({
        method: "kavach.stock_reconciliation_tracking.doctype.stock_reconciliation_srt.stock_reconciliation_srt.backfill_missing_sr",
        args: {
            srt_names: names ? JSON.stringify(names) : null,
            repair_broken: repair_broken,
        },
        freeze: true,
        freeze_message: __("Creating missing ERPNext Stock Reconciliations…"),
    }).then(r => {
        const results = r.message || [];
        const ok = results.filter(x => x.ok);
        const failed = results.filter(x => !x.ok);

        const ok_rows = ok.map(x => {
            const sr = x.sr_name
                ? `<a href="/app/stock-reconciliation/${encodeURIComponent(x.sr_name)}">${frappe.utils.escape_html(x.sr_name)}</a>`
                : "—";
            return `<tr><td>${frappe.utils.escape_html(x.name)}</td><td>${sr}</td><td>${frappe.utils.escape_html(x.action || "")}</td></tr>`;
        }).join("");
        const fail_rows = failed.map(x =>
            `<tr><td>${frappe.utils.escape_html(x.name)}</td><td colspan="2" class="text-danger">${frappe.utils.escape_html(x.error || "error")}</td></tr>`
        ).join("");

        frappe.msgprint({
            title: __("Relink complete — {0} ok, {1} failed", [ok.length, failed.length]),
            indicator: failed.length ? "orange" : "green",
            message: `
                <table class="table table-bordered" style="font-size:12px">
                    <thead><tr><th>${__("SRT")}</th><th>${__("ERPNext SR")}</th><th>${__("Result")}</th></tr></thead>
                    <tbody>${ok_rows}${fail_rows}</tbody>
                </table>`,
        });
        listview.refresh();
    });
}
