# =============================================================================
# CONTEXT: SRT Dashboard server-side controller.
#
# Whitelisted methods called from the JS page controller. Each method is
# a thin wrapper around existing DocType operations — NO validation logic
# is duplicated here. All approve/reject calls dispatch through the
# existing DocType lifecycle so workflow + role checks + remark-field
# permissions stay authoritative in stock_reconciliation_srt.py.
#
# MEMORY: app_kavach.md § 17 (SRT Dashboard)
# SPEC:   docs/specs/2026-05-23-srt-dashboard-design.md
#
# RESTRICTED:
#   - Do NOT inline a "is this user allowed to approve" check that
#     diverges from StockReconciliationSRT._can_submit_linked_sr or the
#     remark-permission gate. Always call through the doc's own methods.
#   - Do NOT bypass submit_linked_sr() from approve_srt — it carries the
#     SABB monkey-patches and Stock Settings toggle that ERPNext SR
#     submit needs (Quirk #2). Always go through the doc method.
#   - Do NOT compute Origin from Batch.creation — Batch master timestamps
#     can drift from actual first SLE timing (backdated PRs). Use
#     MIN(sle.posting_datetime) for the (item, batch, warehouse) tuple.
# =============================================================================

import frappe
from frappe import _


_TAB_FILTERS = {
    # v0.0.9.17 — tabs reflect WHO is waiting to act, not the current state:
    #   - "Admin Approval Pending":      Draft SRTs (docstatus=0) waiting for
    #     Srt Admin to approve → submit → creates draft ERPNext SR.
    #   - "Super Admin Approval Pending": Admin-approved SRTs (docstatus=1,
    #     workflow_state="Admin Approval") waiting for Srt Super Admin to
    #     submit the linked ERPNext SR.
    "Admin Approval Pending":       {"docstatus": 0},
    "Super Admin Approval Pending": {"docstatus": 1, "workflow_state": "Admin Approval"},
}

# v0.0.9.17 — separate alias for load_srt_form's edit-mode docstatus guard.
# Don't fold into _TAB_FILTERS or get_dashboard_counts will double-count
# the Draft bucket and bulk_approve_srt will iterate it as a dashboard tab.
_EDIT_LOAD_FILTERS = {
    "Draft": {"docstatus": 0},
}


@frappe.whitelist()
def get_dashboard_rows(tab, item_filter=None):
    """Return a list of dashboard rows for the given tab.

    Joins SRT + Item.item_name in a single query. Orders by posting_date
    DESC, posting_time DESC so the newest SRTs land at the top.

    v0.0.9.15: optional item_filter (exact match on srt.item) narrows the
    result set when the operator drives an item picker on the header.
    """
    if tab not in _TAB_FILTERS:
        frappe.throw(_("Unknown tab: {0}").format(tab))
    f = dict(_TAB_FILTERS[tab])
    where_parts = [f"srt.{k} = %({k})s" for k in f]
    if item_filter:
        f["_item_filter"] = item_filter
        where_parts.append("srt.item = %(_item_filter)s")
    where_sql = " AND ".join(where_parts)
    rows = frappe.db.sql(f"""
        SELECT
          srt.name,
          srt.item,
          item.item_name,
          srt.default_warehouse,
          srt.total_qty_found_in_default_uom,
          srt.total_qty_found_in_higher_uom,
          srt.total_current_stock_in_default_uom,
          srt.total_current_stock_in_higher_uom,
          srt.default_uom,
          srt.higher_uom,
          srt.higher_uom_cf,
          srt.posting_date,
          srt.posting_time,
          srt.user_remark,
          srt.admin_remark,
          srt.super_admin_remark,
          srt.workflow_state
        FROM `tabStock Reconciliation SRT` srt
        LEFT JOIN `tabItem` item ON item.name = srt.item
        WHERE {where_sql}
        ORDER BY srt.posting_date DESC, srt.posting_time DESC, srt.creation DESC
    """, f, as_dict=True)
    return rows


# =============================================================================
# T3 — Per-batch summary for the View modal
# =============================================================================
@frappe.whitelist()
def get_batch_summary(srt_name):
    """Return per-batch summary for the View modal.

    For each batch in the SRT:
      - origin: earliest SLE for (item, batch, warehouse)
        {voucher_type, voucher_no, posting_date, posting_time, posting_datetime}
      - summary_origin_to_posting: {in: sum_pos, out: sum_abs_neg}
      - last_sr_date: most recent SLE with voucher_type='Stock Reconciliation'
        for that batch (or None)
      - summary_lastsr_to_posting: {in, out} over (last_sr_date, posting_date]
        — empty {in: 0, out: 0} when no prior SR

    RESTRICT: Origin is MIN(posting_datetime) over the SABB join, NOT
    Batch.creation. See controller restricted-areas.
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    posting_dt = f"{doc.posting_date} {doc.posting_time}"
    out = []
    for row in (doc.batches or []):
        bn = row.batch_no
        wh = row.warehouse
        if not (bn and wh):
            continue
        origin = _fetch_origin(doc.item, wh, bn)
        last_sr_date = _fetch_last_sr_date(doc.item, wh, bn, posting_dt)
        out.append({
            "batch_no": bn,
            "origin": origin,
            "summary_origin_to_posting": _fetch_in_out(
                doc.item, wh, bn,
                origin.get("posting_datetime") if origin else None,
                posting_dt,
            ),
            # v0.0.9.32 — opening balance AS OF origin (stock UOM).
            "qty_at_origin": _fetch_balance_as_of(
                doc.item, wh, bn,
                origin.get("posting_datetime") if origin else None,
            ),
            "last_sr_date": last_sr_date,
            "summary_lastsr_to_posting": _fetch_in_out(
                doc.item, wh, bn, last_sr_date, posting_dt,
            ) if last_sr_date else {"in": 0.0, "out": 0.0},
            # v0.0.9.32 — opening balance AS OF the last SR (stock UOM).
            "qty_at_last_sr": _fetch_balance_as_of(doc.item, wh, bn, last_sr_date),
            # v0.0.9.22: surface reconcile-state so the view modal can
            # lowlight uncounted rows + highlight actionable (counted with
            # real delta) rows. Mirrors what _classify_zero_delta_ticks +
            # _recompute_totals consume server-side.
            "is_counted": int(row.is_counted or 0),
            "qty_found":  float(row.qty_found or 0),
            "current_stock_in_selected_uom": float(row.current_stock_in_selected_uom or 0),
            "current_stock_in_stock_uom":    float(row.current_stock_in_stock_uom or 0),
            "select_uom":   row.select_uom or "",
            "stock_uom":    row.stock_uom or "",
            "conversion_factor": float(row.conversion_factor or 1),
        })
    return out


def _fetch_origin(item, warehouse, batch_no):
    """Return earliest SLE for (item, warehouse, batch). Uses SABB join."""
    row = frappe.db.sql("""
        SELECT sle.voucher_type, sle.voucher_no,
               sle.posting_date, sle.posting_time,
               TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
        ORDER BY sle.posting_date ASC, sle.posting_time ASC LIMIT 1
    """, (item, warehouse, batch_no), as_dict=True)
    if not row:
        return None
    r = row[0]
    return {
        "voucher_type":     r["voucher_type"],
        "voucher_no":       r["voucher_no"],
        "posting_date":     str(r["posting_date"]),
        "posting_time":     str(r["posting_time"]),
        "posting_datetime": str(r["posting_datetime"]),
    }


def _fetch_last_sr_date(item, warehouse, batch_no, before_dt):
    """Return the posting_datetime (as str) of the most recent Stock
    Reconciliation SLE for the batch, strictly before `before_dt`. None if none."""
    row = frappe.db.sql("""
        SELECT TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          AND sle.voucher_type = 'Stock Reconciliation'
          AND TIMESTAMP(sle.posting_date, sle.posting_time) < TIMESTAMP(%s)
        ORDER BY sle.posting_date DESC, sle.posting_time DESC LIMIT 1
    """, (item, warehouse, batch_no, before_dt), as_dict=True)
    return str(row[0]["posting_datetime"]) if row else None


def _fetch_in_out(item, warehouse, batch_no, from_dt, to_dt):
    """Return {in, out} aggregate over (from_dt, to_dt] for the batch.
    `from_dt` None means unbounded on the left side."""
    if from_dt:
        where_from = "AND TIMESTAMP(sle.posting_date, sle.posting_time) > %s"
        params = (item, warehouse, batch_no, from_dt, to_dt)
    else:
        where_from = ""
        params = (item, warehouse, batch_no, to_dt)
    row = frappe.db.sql(f"""
        SELECT
          COALESCE(SUM(CASE WHEN sbe.qty > 0 THEN sbe.qty ELSE 0 END), 0) AS pos,
          COALESCE(SUM(CASE WHEN sbe.qty < 0 THEN -sbe.qty ELSE 0 END), 0) AS neg
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          {where_from}
          AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s)
    """, params, as_dict=True)
    r = row[0] if row else {"pos": 0, "neg": 0}
    return {"in": float(r["pos"] or 0), "out": float(r["neg"] or 0)}


def _fetch_balance_as_of(item, warehouse, batch_no, at_dt):
    """v0.0.9.32 — batch opening balance (cumulative stock-UOM qty) up to and
    including `at_dt`. Powers the View modal's 'qty at origin' / 'qty at last
    SR' chips. Returns 0.0 when at_dt is None. Mirrors _fetch_in_out's SABB
    join; `<=` so the boundary SLE (the origin / the SR itself) is included."""
    if not at_dt:
        return 0.0
    row = frappe.db.sql("""
        SELECT COALESCE(SUM(sbe.qty), 0) AS bal
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s)
    """, (item, warehouse, batch_no, at_dt), as_dict=True)
    return float(row[0]["bal"] or 0) if row else 0.0


# =============================================================================
# T4 — Per-SLE drill-down for a batch in a window
# =============================================================================
@frappe.whitelist()
def get_batch_drilldown(item_code, warehouse, batch_no, from_date, to_date):
    """Per-SLE drill-down for a batch in a given window. Returns
    {in: [...], out: [...]} where each entry is
    {voucher_type, voucher_no, posting_datetime, qty}.

    qty in the response is the ABSOLUTE value; the in/out split is
    captured by which list the entry lands in.
    """
    rows = frappe.db.sql("""
        SELECT
          sle.voucher_type,
          sle.voucher_no,
          TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime,
          sbe.qty AS qty
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          AND TIMESTAMP(sle.posting_date, sle.posting_time)
              BETWEEN TIMESTAMP(%s, '00:00:00') AND TIMESTAMP(%s, '23:59:59')
        ORDER BY sle.posting_date DESC, sle.posting_time DESC
    """, (item_code, warehouse, batch_no, from_date, to_date), as_dict=True)
    in_entries  = []
    out_entries = []
    for r in rows:
        entry = {
            "voucher_type":     r["voucher_type"],
            "voucher_no":       r["voucher_no"],
            "posting_datetime": str(r["posting_datetime"]),
            "qty":              abs(float(r["qty"] or 0)),
        }
        if (r["qty"] or 0) > 0:
            in_entries.append(entry)
        elif (r["qty"] or 0) < 0:
            out_entries.append(entry)
    return {"in": in_entries, "out": out_entries}


# =============================================================================
# T5 — approve_srt + reject_srt (workflow-state-branched dispatch)
# =============================================================================
@frappe.whitelist()
def approve_srt(srt_name, remark=None):
    """Branch by current workflow_state and dispatch through the existing
    DocType lifecycle:

      - Draft                → doc.submit()        (creates draft ERPNext SR)
      - Admin Approval       → doc.submit_linked_sr()  (submits the SR)
      - Super Admin Approval → doc.cancel()        (workflow forward to Close)

    Role checks live in the DocType methods. We refetch + re-verify
    state to avoid concurrent races.

    v0.0.9.21: optional `remark` is appended to the field the current
    workflow_state allows the user to write to, with a [via SRT Dashboard
    <ts> by <user>] audit-trail tag. Routing matches the controller's
    _enforce_remark_field_permissions gates:

      - state == "Draft" / ""  → admin_remark   (admin approving from Admin Approval Pending tab)
      - state == "Admin Approval" → super_admin_remark (super admin approving from Super Admin Approval Pending tab)

    Writes use db_set(update_modified=False) so they don't race against
    the approval's own modified-stamp.
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    state = (doc.workflow_state or "").strip()
    if remark and remark.strip():
        timestamp = frappe.utils.now()
        user = frappe.session.user
        annotated = f"[via SRT Dashboard {timestamp} by {user}] {remark.strip()}"
        if state == "Admin Approval":
            target = "super_admin_remark"
        else:
            target = "admin_remark"
        doc.db_set(target,
                   (getattr(doc, target) or "") + "\n" + annotated,
                   update_modified=False)
    if doc.docstatus == 0:
        doc.flags.ignore_permissions = True
        doc.submit()
    elif doc.docstatus == 1 and state == "Admin Approval":
        doc.submit_linked_sr()
    elif doc.docstatus == 1 and state == "Super Admin Approval":
        doc.flags.ignore_permissions = True
        doc.db_set("workflow_state", "Close", update_modified=False)
        doc.cancel()
    else:
        frappe.throw(_(
            "SRT {0} is no longer at a state the dashboard can act on "
            "(current: {1} / docstatus {2}). Refresh and try again."
        ).format(srt_name, state or "—", doc.docstatus))
    return {"ok": True, "new_state": frappe.db.get_value(
        "Stock Reconciliation SRT", srt_name, "workflow_state")}


@frappe.whitelist()
def reject_srt(srt_name, reason):
    """Advance the SRT to Close and write `reason` into the appropriate
    remark field:
      - Draft → admin_remark
      - Admin Approval or Super Admin Approval → super_admin_remark
    """
    if not reason or not reason.strip():
        frappe.throw(_("Reject reason is required."))
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    state = (doc.workflow_state or "").strip()
    timestamp = frappe.utils.now()
    user = frappe.session.user
    annotated = f"[REJECTED via SRT Dashboard {timestamp} by {user}] {reason.strip()}"
    if doc.docstatus == 0:
        doc.db_set("admin_remark",
                   (doc.admin_remark or "") + "\n" + annotated,
                   update_modified=False)
        doc.flags.ignore_permissions = True
        doc.submit()
        doc.reload()
        doc.db_set("workflow_state", "Close", update_modified=False)
        doc.cancel()
    elif doc.docstatus == 1:
        doc.db_set("super_admin_remark",
                   (doc.super_admin_remark or "") + "\n" + annotated,
                   update_modified=False)
        doc.flags.ignore_permissions = True
        doc.db_set("workflow_state", "Close", update_modified=False)
        doc.cancel()
    else:
        frappe.throw(_(
            "SRT {0} is already at docstatus={1} — cannot reject."
        ).format(srt_name, doc.docstatus))
    return {"ok": True}


# =============================================================================
# T6 — bulk_approve_srt (loop with per-row error capture)
# =============================================================================
@frappe.whitelist()
def bulk_approve_srt(srt_names, bulk_remark=None):
    """Loop approve_srt per name; return per-row {name, ok, error?}.
    No transaction rollback — partial successes are real successes.

    v0.0.9.17: bulk_remark (optional) is appended to admin_remark or
    super_admin_remark BEFORE approval is dispatched. Field routing matches
    the DocType controller's _enforce_remark_field_permissions gates so
    the write is always to a field the user is allowed to edit at that
    workflow_state. Annotated with timestamp + user for PCAOB audit-trail
    consistency (same pattern reject_srt uses).

    Field routing by current workflow_state of the doc:
      - "" / "Draft"      → admin_remark
        (doc on "Admin Approval Pending" tab; admin_remark editable only
        in Draft state per _enforce_remark_field_permissions)
      - "Admin Approval"  → super_admin_remark
        (doc on "Super Admin Approval Pending" tab; super_admin_remark
        editable only in Admin Approval state)
      - anything else     → admin_remark (defensive fallback)
    """
    if isinstance(srt_names, str):
        import json
        srt_names = json.loads(srt_names)
    if bulk_remark is not None:
        bulk_remark = bulk_remark.strip()
    results = []
    for name in (srt_names or []):
        try:
            if bulk_remark:
                # Annotate + persist remark BEFORE approval so it lands on
                # the same modified-stamp as the workflow advance — keeps
                # the audit trail atomic from the operator's POV.
                doc = frappe.get_doc("Stock Reconciliation SRT", name)
                state = (doc.workflow_state or "").strip()
                timestamp = frappe.utils.now()
                user = frappe.session.user
                annotated = (
                    f"[BULK via SRT Dashboard {timestamp} by {user}] {bulk_remark}"
                )
                if state == "Admin Approval":
                    target = "super_admin_remark"
                else:
                    target = "admin_remark"
                doc.db_set(target,
                           (getattr(doc, target) or "") + "\n" + annotated,
                           update_modified=False)
            approve_srt(srt_name=name)
            results.append({"name": name, "ok": True})
        except Exception as e:
            results.append({"name": name, "ok": False, "error": str(e)})
    return results


# =============================================================================
# v0.0.9 — Single Source of Truth additions for the in-dashboard form panel
# =============================================================================
# The /app/srt-form standalone page was DELETED in v0.0.9. All form workflow
# now lives inside the SRT Dashboard as a slide-down panel. The 3 wrappers
# below (load_srt_form / save_srt_form / submit_srt_form) were absorbed from
# the deleted srt_form.py — they remain thin proxies that dispatch through
# doc.save() / doc.submit() on the existing Stock Reconciliation SRT
# DocType. ZERO validation duplicated.
#
# RESTRICT (live-sync contract):
#   - Do NOT reimplement validation client-side. The dashboard form panel
#     MUST dispatch through these wrappers.
#   - Do NOT add a parallel API that bypasses doc.save() — the controller's
#     validate() chain is authoritative.
#   - Do NOT remove get_form_meta() — the dashboard form panel uses it to
#     read field-level `reqd`, `read_only`, `description` so doctype schema
#     changes propagate without dashboard code changes.
# =============================================================================


@frappe.whitelist()
def get_dashboard_counts():
    """Return {Draft: N, "Admin Approval": N, "Super Admin Approval": N}.
    Powers the count badges on the tab pills. Single round-trip."""
    counts = {}
    for tab, f in _TAB_FILTERS.items():
        counts[tab] = frappe.db.count("Stock Reconciliation SRT", filters=f)
    return counts


@frappe.whitelist()
def get_form_meta():
    """Return the DocType meta the form panel needs:
      - parent fields (label, fieldtype, options, reqd, read_only, description)
      - child Batch List fields (same shape)
      - current user's roles for client-side action visibility

    Driven by frappe.get_meta — schema changes to the DocType (new field,
    changed default, made required) propagate to the form without JS
    changes. The form's LAYOUT (which panel each field goes in) stays
    hardcoded; the SHAPE comes from this call.
    """
    def shape(meta):
        return [
            {
                "fieldname":   df.fieldname,
                "label":       df.label,
                "fieldtype":   df.fieldtype,
                "options":     df.options,
                "reqd":        int(df.reqd or 0),
                "read_only":   int(df.read_only or 0),
                "default":     df.default,
                "description": df.description,
                "in_list_view": int(df.in_list_view or 0),
            }
            for df in meta.fields
            if df.fieldtype not in ("Section Break", "Column Break", "Tab Break", "HTML")
        ]
    parent = frappe.get_meta("Stock Reconciliation SRT")
    child  = frappe.get_meta("Batch List")
    return {
        "parent_fields": shape(parent),
        "child_fields":  shape(child),
        "user_roles":    list(frappe.get_roles()),
        "current_user":  frappe.session.user,
    }


@frappe.whitelist()
def load_srt_form(name=None):
    """Return either the full Stock Reconciliation SRT doc shape (edit mode)
    or an empty defaults dict (new mode). Also includes `modified` timestamp
    for optimistic concurrency.

    RESTRICT: do NOT remove the `modified` key — the dashboard form sends
    it back on save and the server compares against tabStock Reconciliation
    SRT.modified. Mismatch → TimestampMismatchError surfaced to the user.
    """
    if not name:
        # v0.0.9.16: posting_date + posting_time defaults MUST be non-empty
        # and parseable by Frappe's Date/Time controls. nowtime() returns
        # "HH:MM:SS.ffffff" — strip microseconds so the Time control accepts
        # it on set_value(). nowdate() is already "YYYY-MM-DD" (safe).
        now_dt = frappe.utils.now_datetime()
        return {
            "is_new": True,
            "company": frappe.defaults.get_user_default("Company") or "",
            "posting_date": now_dt.strftime("%Y-%m-%d"),
            "posting_time": now_dt.strftime("%H:%M:%S"),
            "modified": None,
        }
    doc = frappe.get_doc("Stock Reconciliation SRT", name)
    if doc.docstatus != 0:
        frappe.throw(_(
            "Only Draft SRTs can be edited via the dashboard form. "
            "{0} is at workflow state {1} (docstatus {2})."
        ).format(name, doc.workflow_state or "?", doc.docstatus))
    # v0.0.9.1 — DocType parity: include audit fields the form must display
    # (naming_series, *_approved_by, linked_erpnext_sr). These are read-only
    # in the form; the dashboard audit strip renders them when non-empty.
    return {
        "is_new": False,
        "name": doc.name,
        "naming_series": doc.naming_series,
        "modified": str(doc.modified),
        "item": doc.item,
        "item_name": doc.item_name,
        "default_warehouse": doc.default_warehouse,
        "company": doc.company,
        "default_uom": doc.default_uom,
        "higher_uom": doc.higher_uom,
        "higher_uom_cf": doc.higher_uom_cf,
        "total_current_stock_in_default_uom": doc.total_current_stock_in_default_uom,
        "total_qty_found_in_default_uom": doc.total_qty_found_in_default_uom,
        "total_current_stock_in_higher_uom": doc.total_current_stock_in_higher_uom,
        "total_qty_found_in_higher_uom": doc.total_qty_found_in_higher_uom,
        "posting_date": str(doc.posting_date),
        "posting_time": str(doc.posting_time),
        "edit_posting": doc.edit_posting,
        "user_remark": doc.user_remark,
        "admin_remark": doc.admin_remark,
        "super_admin_remark": doc.super_admin_remark,
        "admin_approved_by": doc.admin_approved_by,
        "super_admin_approved_by": doc.super_admin_approved_by,
        "linked_erpnext_sr": doc.linked_erpnext_sr,
        "workflow_state": doc.workflow_state,
        "amended_from": doc.amended_from,
        "batches": [r.as_dict() for r in (doc.batches or [])],
    }


@frappe.whitelist()
def save_srt_form(payload, name=None):
    """Save a SRT through the existing DocType controller.

    For edit mode, payload MAY include `modified` (the timestamp loaded by
    load_srt_form). If present and the server's current `modified` differs,
    raise TimestampMismatchError — surface to UI as a reload prompt.

    Returns {name, workflow_state, modified}. Caller sends `modified` back
    on next save to maintain the concurrency contract.
    """
    payload = frappe.parse_json(payload) if isinstance(payload, str) else payload
    sent_modified = payload.pop("modified", None) if isinstance(payload, dict) else None
    if name:
        doc = frappe.get_doc("Stock Reconciliation SRT", name)
        if doc.docstatus != 0:
            frappe.throw(_(
                "Only Draft SRTs can be edited via this form. "
                "Use the workflow actions for {0} (current state: {1})."
            ).format(name, doc.workflow_state or "Submitted"))
        # Optimistic concurrency: if caller sent a `modified` it loaded, and
        # the doc's modified has moved since, throw the standard Frappe
        # mismatch error. The frontend will offer a Reload prompt.
        if sent_modified and str(doc.modified) != str(sent_modified):
            from frappe.exceptions import TimestampMismatchError
            raise TimestampMismatchError(_(
                "This SRT was edited by someone else after you opened it. "
                "Reload to see their changes — your unsaved edits will be lost."
            ))
        doc.update(payload)
    else:
        payload["doctype"] = "Stock Reconciliation SRT"
        doc = frappe.get_doc(payload)
    doc.save()
    return {
        "name": doc.name,
        "workflow_state": doc.workflow_state or "Draft",
        "modified": str(doc.modified),
    }


@frappe.whitelist()
def submit_srt_form(name):
    """Submit a Draft SRT through the existing DocType controller.

    Wraps doc.submit() — fires on_submit lifecycle (workflow transition,
    Case 1 auto-approve routing, ERPNext SR draft creation).
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", name)
    if doc.docstatus != 0:
        frappe.throw(_(
            "SRT {0} is not in Draft state (current docstatus: {1})."
        ).format(name, doc.docstatus))
    doc.flags.ignore_permissions = True
    doc.submit()
    return {
        "name": doc.name,
        "workflow_state": doc.workflow_state,
        "linked_erpnext_sr": doc.linked_erpnext_sr,
    }
