// =============================================================================
// CONTEXT: Stock Reconciliation SRT — form-level JS controller.
//
//   Three behaviours:
//
//     1. On `item` change → call `get_item_defaults(item_code)` once,
//        stuff the result into parent fields 2-7, replace the `batches`
//        child table with the returned rows. Posting date/time auto-set
//        to now.
//
//     2. On any child row's `qty_found` change → ask the server to
//        recompute the parent's "Total Qty Found" fields (default + higher
//        UOM). Done server-side via `frm.save("Update")` — but for
//        responsiveness, JS also recomputes locally so the user sees the
//        new totals INSTANTLY without waiting for save.
//
//     3. On child row's `select_uom` change → fetch the conversion_factor
//        from API, recompute `current_stock_in_selected_uom` for THAT row
//        only (no re-fetch of other rows).
//
//   Native-Frappe look: no custom CSS, no Tabulator, no fancy widgets.
//   Pure frappe.ui.form.on with the standard grid. Column widths set in
//   the JSON.
//
// MEMORY: app_kavach.md § JS controller
//
// INSTRUCTIONS:
//   - frappe.db.get_value().then(r => r.message) for single-field reads.
//   - frappe.call({method, args}) for whitelisted module endpoints.
//   - frm.clear_table("batches") + (frm.add_child + Object.assign)
//     iteration is the canonical way to bulk-load a child table.
//   - frm.refresh_field("batches") after bulk-load OR Frappe won't show
//     the new rows.
//
// DANGER ZONE:
//   - Don't `frm.set_value("batches", arr)` directly — Frappe's grid
//     state doesn't reset cleanly. Use clear_table + add_child loop.
//   - The naming_series field includes the year token — Frappe v15+
//     accepts but warns on non-template values. Don't override at runtime.
//
// RESTRICT:
//   - Do NOT add a server save inside `qty_found` event handler. The
//     local recompute is cosmetic; server validate() recomputes on next
//     save anyway. Saving on every keystroke is hugely expensive on
//     real-world docs with 100+ batches.
// =============================================================================

frappe.ui.form.on("Stock Reconciliation SRT", {

    refresh(frm) {
        _ipv_srt_set_default_company(frm);
        _ipv_srt_set_default_posting(frm);
        _ipv_srt_install_child_set_queries(frm);
        _ipv_srt_render_action_buttons(frm);
        _ipv_srt_apply_remark_field_locks(frm);
    },

    onload(frm) {
        // Pre-register the set_queries so they're alive BEFORE the first
        // grid render (refresh runs after the grid is built on existing docs;
        // onload runs before).
        _ipv_srt_install_child_set_queries(frm);
    },

    item(frm) {
        if (!frm.doc.item) return;
        // Defer the fetch until BOTH item and default_warehouse are set —
        // since the whole doc is warehouse-scoped now, fetching without a
        // warehouse would prime the batches table with cross-warehouse rows
        // that would then become invalid the moment the user picks a
        // warehouse. Cleaner to wait.
        if (!frm.doc.default_warehouse) return;
        _ipv_srt_load_defaults(frm);
    },

    default_warehouse(frm) {
        if (!frm.doc.item || !frm.doc.default_warehouse) return;
        _ipv_srt_load_defaults(frm);
    },

    posting_date(frm) {
        // 2026-05-22 v0.0.5 — refetch the as-of stock snapshot whenever
        // the operator changes the posting date. Mirrors the item /
        // warehouse handlers above. No confirm prompt per spec —
        // counted rows are lost on date change (consistent UX).
        if (!frm.doc.item || !frm.doc.default_warehouse) return;
        _ipv_srt_load_defaults(frm);
    },

    posting_time(frm) {
        // 2026-05-22 v0.0.5 — same as posting_date but for the time
        // component. Together they form the as_of_datetime sent to the
        // server.
        if (!frm.doc.item || !frm.doc.default_warehouse) return;
        _ipv_srt_load_defaults(frm);
    },

    edit_posting(frm) {
        // No data mutation — the docfield read_only_depends_on handles
        // the lock. This event exists only to trigger a refresh so the
        // visual state of date/time fields updates immediately.
        frm.refresh_field("posting_date");
        frm.refresh_field("posting_time");
    },
});


// =============================================================================
// CHILD — Batch List
// =============================================================================
frappe.ui.form.on("Batch List", {

    batches_add(frm, cdt, cdn) {
        // Per spec: when a new row is added (autopopulated OR user-added),
        // auto-populate `warehouse` + `item_code` + `item_name_selected`
        // from the parent. Both fields are read-only in the JSON; this
        // hook is the only place they get set for user-added rows.
        const row = locals[cdt][cdn];
        if (frm.doc.default_warehouse && !row.warehouse) {
            frappe.model.set_value(row.doctype, row.name, "warehouse",
                frm.doc.default_warehouse);
        }
        if (frm.doc.item && !row.item_code) {
            frappe.model.set_value(row.doctype, row.name, "item_code", frm.doc.item);
        }
        if (frm.doc.item_name && !row.item_name_selected) {
            frappe.model.set_value(row.doctype, row.name, "item_name_selected",
                frm.doc.item_name);
        }
        if (frm.doc.default_uom && !row.stock_uom) {
            frappe.model.set_value(row.doctype, row.name, "stock_uom",
                frm.doc.default_uom);
        }
        // Default select_uom to the parent's higher UOM if available.
        if (frm.doc.higher_uom && !row.select_uom) {
            frappe.model.set_value(row.doctype, row.name, "select_uom",
                frm.doc.higher_uom);
        }
        if (frm.doc.higher_uom_cf && !row.conversion_factor) {
            frappe.model.set_value(row.doctype, row.name, "conversion_factor",
                frm.doc.higher_uom_cf);
        }
    },


    qty_found(frm, cdt, cdn) {
        // The user typing in qty_found NO LONGER auto-ticks the row.
        // Per 2026-05-21 spec: the first column ("Do Reconcile") is an
        // explicit user-controlled checkbox. Default = unchecked. The
        // user must tick it explicitly to include the row in the
        // ERPNext SR; without the tick, qty_found is IGNORED and the
        // batch retains its current ledger stock.
        //
        // We still trigger a recompute so the totals reflect the new
        // qty_found value on rows that ARE ticked.
        _ipv_srt_recompute_totals(frm);
    },

    is_counted(frm, cdt, cdn) {
        // User toggled the "Do Reconcile" checkbox — recompute parent
        // totals so the new tick state is reflected immediately.
        _ipv_srt_recompute_totals(frm);
    },

    select_uom(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.select_uom || !frm.doc.item) return;
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.api.get_uom_conversion",
            args: { item_code: frm.doc.item, uom: row.select_uom },
        }).then(r => {
            const cf = Number(r.message) || 1.0;
            frappe.model.set_value(row.doctype, row.name, "conversion_factor", cf);
            const stock_qty = Number(row.current_stock_in_stock_uom) || 0;
            frappe.model.set_value(
                row.doctype, row.name,
                "current_stock_in_selected_uom",
                cf > 0 ? stock_qty / cf : stock_qty,
            );
            // Recompute totals so the "Total Found (Higher UOM)" stays in sync
            // when the user reads a row's qty in a different UOM.
            _ipv_srt_recompute_totals(frm);
        });
    },

    batch_no(frm, cdt, cdn) {
        // Manually-typed batch (not auto-populated). Fetch its current state.
        const row = locals[cdt][cdn];
        if (!row.batch_no || !frm.doc.item) return;
        // Restrict picker to the parent item's batches only.
        // Skip the fetch when warehouse is already set (autopopulated row).
        if (row.warehouse && row.current_stock_in_stock_uom !== undefined
            && row.current_stock_in_stock_uom !== null) {
            return;
        }
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.api.get_batch_current_state",
            args: { item_code: frm.doc.item, batch_no: row.batch_no },
        }).then(r => {
            const d = r.message || {};
            frappe.model.set_value(row.doctype, row.name, "warehouse", d.warehouse || "");
            frappe.model.set_value(row.doctype, row.name, "stock_uom", d.stock_uom || frm.doc.default_uom);
            frappe.model.set_value(row.doctype, row.name, "current_stock_in_stock_uom", Number(d.qty) || 0);
            frappe.model.set_value(row.doctype, row.name, "valuation_rate", Number(d.valuation_rate) || 0);
            // Default select_uom to higher uom if not set.
            if (!row.select_uom) {
                frappe.model.set_value(row.doctype, row.name, "select_uom",
                    frm.doc.higher_uom || frm.doc.default_uom);
            }
            // Use the parent's higher UOM CF for the initial computation.
            const cf = frm.doc.higher_uom_cf || 1.0;
            frappe.model.set_value(row.doctype, row.name, "conversion_factor", cf);
            const stock_qty = Number(d.qty) || 0;
            frappe.model.set_value(
                row.doctype, row.name,
                "current_stock_in_selected_uom",
                cf > 0 ? stock_qty / cf : stock_qty,
            );
            // Mirror the parent's item_name into the row.
            frappe.model.set_value(row.doctype, row.name,
                "item_name_selected", frm.doc.item_name || "");
            _ipv_srt_recompute_totals(frm);
        });
    },
});


// =============================================================================
// Helpers
// =============================================================================
function _ipv_srt_set_default_company(frm) {
    if (frm.is_new() && !frm.doc.company) {
        const co = frappe.defaults.get_user_default("Company");
        if (co) frm.set_value("company", co);
    }
}

function _ipv_srt_set_default_posting(frm) {
    if (frm.is_new()) {
        if (!frm.doc.posting_date) frm.set_value("posting_date", frappe.datetime.now_date());
        if (!frm.doc.posting_time) frm.set_value("posting_time", frappe.datetime.now_time());
    }
}

function _ipv_srt_load_defaults(frm) {
    // Per spec (2026-05-21): if item OR warehouse changes, ALL child rows
    // and parent totals must reset and re-populate from the new (item,
    // warehouse) pair. No confirm prompt — the spec says "all child and
    // data will reset and again update as per new value".
    //
    // We still skip the fetch for submitted/cancelled docs, where mutating
    // child rows is illegal in Frappe.
    if (frm.doc.docstatus !== 0) return;
    _ipv_srt_fetch_and_load(frm);
}

function _ipv_srt_fetch_and_load(frm) {
    frappe.call({
        method: "kavach.stock_reconciliation_tracking.api.get_item_defaults",
        args: {
            item_code:    frm.doc.item,
            warehouse:    frm.doc.default_warehouse || null,
            posting_date: frm.doc.posting_date || null,
            posting_time: frm.doc.posting_time || null,
        },
        freeze: true,
        freeze_message: __("Loading batches…"),
    }).then(r => {
        const d = r.message;
        if (!d) return;

        // Parent fields. Set then refresh — read-only Link/Float fields
        // sometimes don't repaint on set_value alone, especially after a
        // rapid item→warehouse change combo. The explicit refresh_field
        // calls below guarantee the user actually sees the new values.
        frm.set_value("item_name",                            d.item_name);
        frm.set_value("default_uom",                          d.default_uom);
        frm.set_value("total_current_stock_in_default_uom",   d.total_current_stock_in_default_uom);
        frm.set_value("higher_uom",                           d.higher_uom);
        frm.set_value("higher_uom_cf",                        d.higher_uom_cf);
        frm.set_value("total_current_stock_in_higher_uom",    d.total_current_stock_in_higher_uom);
        frm.set_value("total_qty_found_in_default_uom",       d.total_current_stock_in_default_uom);
        frm.set_value("total_qty_found_in_higher_uom",        d.total_current_stock_in_higher_uom);

        [
            "item_name", "default_uom",
            "total_current_stock_in_default_uom", "total_qty_found_in_default_uom",
            "higher_uom", "higher_uom_cf",
            "total_current_stock_in_higher_uom", "total_qty_found_in_higher_uom",
        ].forEach(f => frm.refresh_field(f));

        // Replace the batches grid.
        frm.clear_table("batches");
        (d.batches || []).forEach(b => {
            const row = frm.add_child("batches");
            Object.assign(row, b);
            // Belt-and-braces: even though server validate + batches_add hook
            // both stamp warehouse/item_code, set them here too so the user
            // sees them BEFORE the first save round-trip.
            row.warehouse  = b.warehouse  || frm.doc.default_warehouse;
            row.item_code  = b.item_code  || frm.doc.item;
        });
        frm.refresh_field("batches");

        if ((d.batches || []).length === 0) {
            frappe.msgprint(__(
                "No batches with positive stock found for item <b>{0}</b> in " +
                "warehouse <b>{1}</b>. You can still manually add batches " +
                "to the table (e.g., to count a batch with 0 ledger qty).",
                [frm.doc.item, frm.doc.default_warehouse],
            ));
        }
    });
}

function _ipv_srt_apply_remark_field_locks(frm) {
    // ─────────────────────────────────────────────────────────────────────
    // Visual lock for the 3 remark fields, mirroring the server-side
    // gates in stock_reconciliation_srt.py:_enforce_remark_field_permissions.
    //
    //   user_remark         → editable by doc owner in Draft state
    //   admin_remark        → editable by Srt Admin / Srt Super Admin in Draft
    //   super_admin_remark  → editable by Srt Super Admin in Admin Approval
    //
    // System Manager + Administrator: always unlocked.
    //
    // This is COSMETIC ONLY — the server enforces the same rules in
    // validate(). Don't rely on it for security; it just prevents the
    // user from typing into a field that the server would reject on save.
    // ─────────────────────────────────────────────────────────────────────
    const roles      = new Set(frappe.user_roles || []);
    const is_sysmgr  = roles.has("System Manager") || frappe.session.user === "Administrator";
    if (is_sysmgr) {
        frm.set_df_property("user_remark",        "read_only", 0);
        frm.set_df_property("admin_remark",       "read_only", 0);
        frm.set_df_property("super_admin_remark", "read_only", 0);
        return;
    }
    const state      = frm.doc.workflow_state || "Draft";
    const is_owner   = (frm.doc.owner || frappe.session.user) === frappe.session.user;
    const can_admin  = roles.has("Srt Admin") || roles.has("Srt Super Admin");
    const can_super  = roles.has("Srt Super Admin");

    frm.set_df_property("user_remark",        "read_only",
        !(is_owner && state === "Draft"));
    frm.set_df_property("admin_remark",       "read_only",
        !(can_admin && state === "Draft"));
    frm.set_df_property("super_admin_remark", "read_only",
        !(can_super && state === "Admin Approval"));
}


function _ipv_srt_render_action_buttons(frm) {
    // ─────────────────────────────────────────────────────────────────────
    // Workflow-aware action buttons (2026-05-21):
    //
    //   - "Open Linked ERPNext SR" — always visible when a link exists.
    //
    //   - "Submit ERPNext SR" — visible to Srt Super Admin (or System
    //     Manager) when the SRT is at Admin Approval AND the linked SR
    //     is still in draft. Clicking submits the SR via the whitelisted
    //     `submit_linked_sr` method, which two-pass-mirrors the rate then
    //     calls _submit().
    //
    // The workflow's "Approve" action handles state transitions
    // (Draft → Admin Approval → Super Admin Approval); button below
    // covers the actual ERPNext SR submission, which is a separate side
    // effect distinct from the workflow doc_status transition.
    // ─────────────────────────────────────────────────────────────────────
    // Auto-approved-by-system green banner (2026-05-22):
    // when the SRT routed to Approved By System (Case 1 — every ticked
    // row matched current stock), surface a green dashboard alert so the
    // user immediately sees WHY there's no linked ERPNext SR to click.
    if (frm.doc.workflow_state === "Approved By System") {
        frm.dashboard.add_comment(
            __("Auto-approved by system — all ticked batches matched current stock. No ERPNext Stock Reconciliation created."),
            "green",
            true,
        );
    }

    if (frm.doc.linked_erpnext_sr) {
        frm.add_custom_button(__("Open Linked ERPNext SR"), () => {
            frappe.set_route("Form", "Stock Reconciliation", frm.doc.linked_erpnext_sr);
        }, __("View"));
    }

    const is_super = (frappe.user_roles || []).includes("Srt Super Admin")
                     || (frappe.user_roles || []).includes("System Manager")
                     || frappe.session.user === "Administrator";
    const at_admin_approval =
        frm.doc.docstatus === 1
        && (frm.doc.workflow_state === "Admin Approval");
    if (is_super && at_admin_approval && frm.doc.linked_erpnext_sr) {
        frm.add_custom_button(__("Submit Linked ERPNext SR"), () => {
            frappe.confirm(
                __("Submit ERPNext Stock Reconciliation {0}? This posts the SLE/GL movements and is NOT easily reversible.",
                   [frm.doc.linked_erpnext_sr]),
                () => {
                    frappe.call({
                        method: "kavach.stock_reconciliation_tracking.doctype.stock_reconciliation_srt.stock_reconciliation_srt.submit_linked_sr",
                        args: { srt_name: frm.doc.name },
                        freeze: true,
                        freeze_message: __("Submitting ERPNext SR…"),
                    }).then(r => {
                        if (r.message) {
                            frappe.show_alert({ message: __("Submitted: {0}", [r.message]),
                                                indicator: "green" });
                            frm.reload_doc();
                        }
                    });
                },
            );
        }).addClass("btn-primary");
    }
}


function _ipv_srt_install_child_set_queries(frm) {
    // ─────────────────────────────────────────────────────────────────────
    // Per user spec:
    //   - "Select UOM shows only options which UOMs configure on specific
    //     item master in unit of measurement child table"
    //   - "user cannot add duplicate batch"  (server validate enforces; JS
    //     filter is cosmetic — hides already-picked batches from the picker
    //     so the user doesn't accidentally pick one that will reject on save)
    //
    // Both set_queries are item-scoped, so they MUST be re-installed
    // whenever the parent item changes. Frappe caches the set_query against
    // the form, so re-calling this in `refresh`/`onload`/`item` is safe.
    // ─────────────────────────────────────────────────────────────────────

    // ── batch_no picker: restrict to parent item's batches, exclude
    //    batches already in the table to prevent duplicates at the UI level.
    //    Now also constrained to batches that have stock in the parent's
    //    default_warehouse (when set) — the picker shouldn't offer batches
    //    that don't physically exist in the chosen warehouse.
    frm.set_query("batch_no", "batches", function(doc, cdt, cdn) {
        const already_picked = (doc.batches || [])
            .filter(r => r.name !== cdn && r.batch_no)
            .map(r => r.batch_no);
        return {
            filters: {
                item:     doc.item || "",
                disabled: 0,
                ...(already_picked.length ? { name: ["not in", already_picked] } : {}),
            },
        };
    });

    // ── select_uom picker: restrict to UOMs the item actually has a
    //    conversion for. Uses the new `get_item_uoms` whitelisted helper.
    frm.set_query("select_uom", "batches", function(doc, cdt, cdn) {
        return {
            query: "kavach.stock_reconciliation_tracking.api.get_item_uoms_for_link",
            filters: { item_code: doc.item || "" },
        };
    });
}


function _ipv_srt_recompute_totals(frm) {
    // Mirror server-side _recompute_totals exactly, so the user sees
    // the same numbers we'll save on next form save. Uses the is_counted
    // sentinel — qty_found alone can't be trusted (Float stores 0 for unset).
    let total_current = 0.0;
    let total_found = 0.0;
    (frm.doc.batches || []).forEach(r => {
        const current = Number(r.current_stock_in_stock_uom) || 0;
        total_current += current;
        if (r.is_counted) {
            total_found += (Number(r.qty_found) || 0) * _ipv_srt_resolve_cf(frm, r);
        } else {
            total_found += current;
        }
    });
    frm.set_value("total_current_stock_in_default_uom", total_current);
    frm.set_value("total_qty_found_in_default_uom",     total_found);
    const hcf = Number(frm.doc.higher_uom_cf) || 1.0;
    frm.set_value("total_current_stock_in_higher_uom",  hcf ? total_current / hcf : 0);
    frm.set_value("total_qty_found_in_higher_uom",      hcf ? total_found   / hcf : 0);
}


function _ipv_srt_resolve_cf(frm, r) {
    // CONTEXT: Frappe's child-grid editor can drop hidden fields' values
    // when re-rendering a row on cell focus/blur. The autopopulated row
    // has `conversion_factor=1000` (set by api.get_item_defaults), but
    // by the time the user types qty_found and our recompute runs,
    // r.conversion_factor may have been blanked. Defaulting to 1.0
    // silently produces the wrong total (qty_found × 1 instead of
    // qty_found × 1000) — the 2026-05-21 "1000.804" bug report.
    //
    // RESOLUTION ORDER (first non-zero wins):
    //   1. r.conversion_factor             — happy path when grid kept it
    //   2. current_stock_in_stock_uom ÷ current_stock_in_selected_uom
    //                                      — derive from the two values
    //                                        the user CAN see in the row
    //   3. frm.doc.higher_uom_cf           — if row.select_uom == higher_uom
    //   4. 1.0                             — last resort (assume stock UOM)
    //
    // RESTRICT: do NOT replace this resolver with a simple
    // `Number(r.conversion_factor) || 1.0` — the bug recurs immediately.
    let cf = Number(r.conversion_factor);
    if (cf && Number.isFinite(cf) && cf > 0) return cf;

    const stock_qty    = Number(r.current_stock_in_stock_uom);
    const selected_qty = Number(r.current_stock_in_selected_uom);
    if (Number.isFinite(stock_qty) && Number.isFinite(selected_qty)
        && stock_qty > 0 && selected_qty > 0) {
        cf = stock_qty / selected_qty;
        if (Number.isFinite(cf) && cf > 0) return cf;
    }

    if (r.select_uom && r.select_uom === frm.doc.higher_uom) {
        cf = Number(frm.doc.higher_uom_cf);
        if (Number.isFinite(cf) && cf > 0) return cf;
    }

    return 1.0;
}
