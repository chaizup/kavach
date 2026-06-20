# =============================================================================
# CONTEXT: kavach install / migrate hooks.
#
#   This module is a set of SELF-HEALING defensive hooks (after_install +
#   after_migrate), each idempotent so it is safe to re-run on every migrate /
#   restore. They guarantee:
#     1. `kavach` is present in the site's `tabInstalled Application` table
#        even when a production DB backup is restored on top of a dev site
#        that already has this app's DocTypes / Module Def / files on disk.
#     2. the 3 SRT roles + the SRT Workflow exist.
#     3. kavach's shipped reports stay STANDARD (is_standard="Yes") so they
#        run from disk — see `_ensure_standard_reports` for the NoneType crash
#        this prevents.
#
#   Without this, the symptom is:
#     "Module Stock Reconciliation Tracking not found
#      The resource you are looking for is not available"
#   when accessing the DocType via /app/ or via AwesomeBar — because frappe's
#   `setup_module_map(include_all_apps=False)` (the path used in REQUEST
#   context) reads ONLY site-installed apps, and our app row was wiped by the
#   restore.
#
# MEMORY:
#   - app_kavach.md § "Module not found" gotcha
#   - frappe_cloud_ops.md § silent backup-restore quirks
#
# INSTRUCTIONS:
#   - Wired in hooks.py as both `after_install` AND `after_migrate`. The latter
#     is the critical one — `bench migrate` runs after a backup restore in
#     the standard chaizup restore runbook.
#   - `add_to_installed_apps` is idempotent in Frappe v15+ — it's a no-op
#     when the row already exists, so re-running on every migrate is safe.
#
# DANGER ZONE:
#   - Don't add side-effects here that mutate user data — restore + migrate
#     are run repeatedly during incident response and any data mutation here
#     would compound across runs.
#   - Don't `frappe.clear_cache()` here — install/migrate already does that;
#     calling again here causes a no-op double-clear that slows migrate.
#
# RESTRICT:
#   - Do NOT remove the after_migrate wiring. The restore-from-prod pattern
#     is documented in `chaizup_audit_site_specifics.md`; without this hook
#     the desk UI is broken until someone manually runs `bench install-app`.
# =============================================================================

import frappe
from frappe.installer import add_to_installed_apps


APP_NAME = "kavach"


def after_install():
    _ensure_site_install_record()
    _ensure_roles()
    _ensure_workflow()
    _ensure_standard_reports()


def after_migrate():
    _ensure_site_install_record()
    _ensure_roles()
    _ensure_workflow()
    _ensure_standard_reports()


def _ensure_site_install_record() -> None:
    if APP_NAME in (frappe.get_installed_apps() or []):
        return
    add_to_installed_apps(APP_NAME)
    frappe.db.commit()
    frappe.client_cache.delete_value("installed_app_modules")
    frappe.client_cache.delete_value("module_installed_app")


# =============================================================================
# Roles + Workflow (2026-05-21)
# =============================================================================
#
# The SRT module ships three roles:
#   - Srt User         (create + edit draft + close own draft)
#   - Srt Admin        (submit SRT → creates draft ERPNext SR; cancel SRT)
#   - Srt Super Admin  (submit the linked ERPNext SR; cancel both)
#
# Plus one Workflow with 4 states:
#   - Draft               (docstatus=0)
#   - Admin Approval      (docstatus=1) — SRT submitted; ERPNext SR in draft
#   - Super Admin Approval (docstatus=1) — ERPNext SR submitted
#   - Close               (docstatus=2) — cancelled
#
# Both are idempotent (no-op when present) so after_migrate is safe to
# re-run on every restore + bench migrate.
# =============================================================================

_SRT_ROLES = ("Srt User", "Srt Admin", "Srt Super Admin")


def _ensure_roles() -> None:
    """Create the 3 SRT roles if they don't already exist."""
    for role in _SRT_ROLES:
        if not frappe.db.exists("Role", role):
            frappe.get_doc({
                "doctype": "Role",
                "role_name": role,
                "desk_access": 1,
                "two_factor_auth": 0,
            }).insert(ignore_permissions=True)
    frappe.db.commit()


def _ensure_workflow() -> None:
    """Create/update the Stock Reconciliation SRT Workflow.

    Idempotent on both prerequisites AND the workflow itself:
      1. Workflow State rows in `tabWorkflow State` — always ensured,
         so an upgrade path can reference the new "Approved By System"
         state without LinkValidationError.
      2. Workflow Action Master rows — always ensured.
      3. The Workflow doc — fresh install OR backfill-upgrade for
         pre-2026-05-22 sites (add missing state row to .states and
         missing transition to .transitions).
    """
    wf_name = "Stock Reconciliation SRT Workflow"

    # Prerequisites — always run (must precede upgrade or fresh install
    # because the Workflow doc's .states + .transitions Link to these).
    _ensure_workflow_state("Draft",                "Info",    "Draft")
    _ensure_workflow_state("Admin Approval",       "Warning", "Admin Approval")
    _ensure_workflow_state("Super Admin Approval", "Success", "Super Admin Approval")
    _ensure_workflow_state("Approved By System",   "Primary", "Approved By System")
    _ensure_workflow_state("Close",                "Danger",  "Close")
    for action in ("Approve", "Close"):
        if not frappe.db.exists("Workflow Action Master", action):
            frappe.get_doc({
                "doctype": "Workflow Action Master",
                "workflow_action_name": action,
            }).insert(ignore_permissions=True)
    frappe.db.commit()

    if frappe.db.exists("Workflow", wf_name):
        # Backfill 2026-05-22 additions for sites whose workflow was
        # created before the Approved By System state was scaffolded.
        # ORDER MATTERS: state row must exist on the workflow before
        # a transition can reference it (Link validation).
        _ensure_workflow_state_row(
            wf_name,
            state="Approved By System", doc_status=1,
            allow_edit="System Manager",
        )
        _ensure_workflow_transition(
            wf_name,
            state="Approved By System", action="Close",
            next_state="Close", allowed="Srt Super Admin",
        )
        return

    wf = frappe.get_doc({
        "doctype": "Workflow",
        "workflow_name": wf_name,
        "document_type": "Stock Reconciliation SRT",
        "is_active": 1,
        "send_email_alert": 0,
        "workflow_state_field": "workflow_state",
        "states": [
            {"state": "Draft",                "doc_status": 0,
             "allow_edit": "Srt User",        "update_field": None},
            {"state": "Admin Approval",       "doc_status": 1,
             "allow_edit": "Srt Admin",       "update_field": None},
            {"state": "Super Admin Approval", "doc_status": 1,
             "allow_edit": "Srt Super Admin", "update_field": None},
            # Terminal state — controller sets via db_set when ALL ticked
            # rows had qty_found == current_stock_in_selected_uom. No
            # human approval needed; no ERPNext SR created.
            {"state": "Approved By System",   "doc_status": 1,
             "allow_edit": "System Manager",  "update_field": None},
            {"state": "Close",                "doc_status": 2,
             "allow_edit": "Srt Super Admin", "update_field": None},
        ],
        "transitions": [
            # Draft → Admin Approval: Srt Admin submits, creates draft ERPNext SR
            {"state": "Draft", "action": "Approve",
             "next_state": "Admin Approval", "allowed": "Srt Admin"},
            # Admin Approval → Super Admin Approval: Srt Super Admin submits ERPNext SR
            {"state": "Admin Approval", "action": "Approve",
             "next_state": "Super Admin Approval", "allowed": "Srt Super Admin"},
            # Admin Approval → Close: Srt Admin OR Super Admin cancels (only if SR in draft)
            {"state": "Admin Approval", "action": "Close",
             "next_state": "Close", "allowed": "Srt Admin"},
            {"state": "Admin Approval", "action": "Close",
             "next_state": "Close", "allowed": "Srt Super Admin"},
            # Super Admin Approval → Close: only Srt Super Admin (SR is already submitted)
            {"state": "Super Admin Approval", "action": "Close",
             "next_state": "Close", "allowed": "Srt Super Admin"},
            # Approved By System → Close: only Srt Super Admin (no SR to cascade,
            # but the doc-level cancel still needs the workflow path). Added 2026-05-22.
            {"state": "Approved By System", "action": "Close",
             "next_state": "Close", "allowed": "Srt Super Admin"},
        ],
    })
    wf.flags.ignore_permissions = True
    wf.insert()
    frappe.db.commit()


# =============================================================================
# Standard reports self-heal (2026-06-20)
# =============================================================================
#
# Reports shipped by kavach live on disk as STANDARD reports
# (`is_standard = "Yes"`, with their `execute()` in the module `.py`). Frappe
# runs a standard report by IMPORTING that module (the `execute_module` path).
#
# THE BUG this heals:
#   If the `tabReport` row is left as `is_standard = "No"` with an empty
#   `report_script` (e.g. the record was created/opened in desk without a
#   disk sync, or a prod backup carried a stale row), Frappe takes the
#   `execute_script` path instead and calls `safe_exec(self.report_script,…)`.
#   `report_script` is NULL → RestrictedPython raises:
#       TypeError: Not allowed source type: "NoneType".
#   The on-disk `execute()` is never reached.
#
# THE FIX (source-of-truth, idempotent): re-import the report's on-disk `.json`
#   with `import_file_by_path(..., force=True)` — the SAME operation `bench
#   migrate` runs for every standard record. The `.json` declares
#   `is_standard: "Yes"`, so the upserted row is always standard and runs from
#   the module. A stale `is_standard="No"` row is corrected simply by replaying
#   the committed source. Verified 2026-06-20: a forced `is_standard="No"` row
#   flips back to "Yes" purely from the `.json` import — no DB field write.
#
# RESTRICT: do the fix THROUGH SOURCE — `import_file_by_path` on the committed
#   `.json`. Do NOT hand-poke fields with `db.set_value`, and do NOT
#   `get_doc().save()` a standard Report (in developer_mode that rewrites the
#   disk files). Source `.json` → import → done.
# =============================================================================

# (report_name, module_folder) — module_folder is the on-disk folder under
# `kavach/` that holds the report's `report/<scrubbed>/` directory.
_STANDARD_REPORTS = (
    ("Work Order Consumption Cost Analysis", "stock_reconciliation_tracking"),
)


def _ensure_standard_reports() -> None:
    """Install kavach's shipped reports straight FROM SOURCE.

    This simply replays — for this app's reports — exactly what `bench migrate`
    already does for every standard record: `import_file_by_path` reads the
    report's on-disk `.json` (which declares `is_standard: "Yes"`) and upserts
    the Report doc from it. The `.json` IS the source of truth, so the imported
    row is always standard and runs from the on-disk module (`execute_module`),
    never `safe_exec(None)`.

    NO database field is poked by hand — no `db.set_value`. A stale or restored
    row (e.g. `is_standard="No"` carried in from a prod backup) is corrected
    purely by re-importing the committed source file. Idempotent + force, so it
    is safe on every `after_install` / `after_migrate` (and on Frappe Cloud,
    whose deploy pipeline runs `bench migrate`).
    """
    import os
    from frappe.modules.import_file import import_file_by_path

    for report, module_folder in _STANDARD_REPORTS:
        path = frappe.get_app_path(
            APP_NAME, module_folder, "report",
            frappe.scrub(report), frappe.scrub(report) + ".json",
        )
        if os.path.exists(path):
            import_file_by_path(path, force=True)
    frappe.db.commit()


def _ensure_workflow_state(name: str, style: str, label: str) -> None:
    if frappe.db.exists("Workflow State", name):
        return
    frappe.get_doc({
        "doctype": "Workflow State",
        "workflow_state_name": name,
        "style": style,
    }).insert(ignore_permissions=True)


def _ensure_workflow_state_row(wf_name: str, state: str, doc_status: int,
                               allow_edit: str) -> None:
    """Idempotent — append a row to the Workflow's .states table if the
    state isn't already listed there.

    Distinct from `_ensure_workflow_state` (which writes to the global
    tabWorkflow State doctype). This one writes to a SPECIFIC workflow's
    .states child table so the Workflow doc actually knows about the
    state and any transition can reference it without LinkValidationError.

    RESTRICT: idempotent — after_migrate re-runs on every bench migrate.
    """
    wf = frappe.get_doc("Workflow", wf_name)
    for s in wf.states:
        if s.state == state:
            return  # already present — no-op
    wf.append("states", {
        "state": state,
        "doc_status": doc_status,
        "allow_edit": allow_edit,
    })
    wf.flags.ignore_permissions = True
    wf.save()
    frappe.db.commit()


def _ensure_workflow_transition(wf_name: str, state: str, action: str,
                                next_state: str, allowed: str) -> None:
    """Idempotent — append a Workflow Transition row if not already present.

    Used by `_ensure_workflow()` to upgrade existing workflows without
    overwriting user customizations. Matches an existing transition by
    the (state, action, next_state, allowed) tuple; any other field
    difference is treated as a different transition.

    RESTRICT: keep this idempotent — after_migrate re-runs on every
    `bench migrate`, and adding duplicate transitions would silently
    corrupt the workflow.
    """
    wf = frappe.get_doc("Workflow", wf_name)
    for t in wf.transitions:
        if (t.state == state and t.action == action
                and t.next_state == next_state and t.allowed == allowed):
            return  # already present — no-op
    wf.append("transitions", {
        "state": state, "action": action,
        "next_state": next_state, "allowed": allowed,
    })
    wf.flags.ignore_permissions = True
    wf.save()
    frappe.db.commit()
