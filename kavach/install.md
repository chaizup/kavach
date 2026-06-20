# install.py — Install & Migrate Hooks

**File:** `kavach/install.py`
**Wired in:** `hooks.py` → `after_install` + `after_migrate`

---

## 1. Purpose

Self-healing defensive hook that guarantees `kavach` is registered in the site's `tabInstalled Application` table even when a production DB backup is restored on top of a dev site. Also ensures the three SRT roles and the SRT Workflow exist, **and that kavach's shipped reports stay built-in / standard** (`is_standard = "Yes"`) so they run from the on-disk source code.

Without this hook, a backup restore would cause:
> "Module Stock Reconciliation Tracking not found — The resource you are looking for is not available"

Root cause: `frappe.setup_module_map(include_all_apps=False)` (used in REQUEST context) reads only site-installed apps from `tabInstalled Application`. A restore from a site that didn't have kavach wipes that row.

## 2. Functions

| Function | Purpose |
|---|---|
| `after_install()` | Entry point for `bench install-app kavach` |
| `after_migrate()` | Entry point for `bench migrate` — runs on every migrate |
| `_ensure_site_install_record()` | Idempotent: adds kavach to `tabInstalled Application` if missing |
| `_ensure_roles()` | Creates Srt User, Srt Admin, Srt Super Admin roles if they don't exist |
| `_ensure_workflow()` | Creates/updates the Stock Reconciliation SRT Workflow (5 states, 6 transitions) |
| `_ensure_workflow_state(name, style, label)` | Idempotent: creates a global Workflow State if missing |
| `_ensure_workflow_state_row(wf_name, state, ...)` | Idempotent: appends a state to a Workflow's .states child table |
| `_ensure_workflow_transition(wf_name, state, action, ...)` | Idempotent: appends a transition to a Workflow's .transitions child table |
| `_ensure_standard_reports()` | Idempotent: forces kavach's shipped reports to `is_standard="Yes"` (clears stale inline `report_script`) so they run from disk. See § 8. |

## 3. Workflow States

| State | docstatus | allow_edit | Purpose |
|---|---|---|---|
| Draft | 0 | Srt User | Initial state |
| Admin Approval | 1 | Srt Admin | SRT submitted; ERPNext SR in draft |
| Super Admin Approval | 1 | Srt Super Admin | ERPNext SR submitted; SLE/GL posted |
| Approved By System | 1 | System Manager | Case 1: all matched, no SR needed |
| Close | 2 | Srt Super Admin | Cancelled terminal state |

## 4. Workflow Transitions

| From → To | Action | Allowed |
|---|---|---|
| Draft → Admin Approval | Approve | Srt Admin |
| Admin Approval → Super Admin Approval | Approve | Srt Super Admin |
| Admin Approval → Close | Close | Srt Admin |
| Admin Approval → Close | Close | Srt Super Admin |
| Super Admin Approval → Close | Close | Srt Super Admin |
| Approved By System → Close | Close | Srt Super Admin |

## 5. Idempotency

All functions are idempotent and safe to re-run on every `bench migrate`. The `_ensure_*` pattern checks for existence before creating. The workflow backfill path (for pre-2026-05-22 sites) adds only missing state rows and transitions without overwriting existing customizations.

## 6. RESTRICT

<!-- RESTRICT: after_migrate is the only line of defence between a restore and a broken desk UI. -->
- Do NOT remove the `after_migrate` wiring — it is the only defence between a backup restore and a broken desk UI
- Do NOT add side-effects that mutate user data — restore + migrate are run repeatedly during incident response
- Do NOT call `frappe.clear_cache()` here — install/migrate already does that
- All functions must remain idempotent — `after_migrate` re-runs on every `bench migrate`

## 7. Dependencies

- **hooks.py:** `after_install` + `after_migrate` wiring
- **frappe.installer:** `add_to_installed_apps()`
- **Workflow State / Workflow Action Master / Workflow:** Frappe core DocTypes
- **Roles:** Srt User, Srt Admin, Srt Super Admin
- **Report:** the standard reports listed in `_STANDARD_REPORTS`

## 8. Standard-report self-heal (`_ensure_standard_reports`) — 2026-06-20

Built-in reports (e.g. **Work Order Consumption Cost Analysis**) ship as source
in `stock_reconciliation_tracking/report/<name>/` and must run via Frappe's
`execute_module` path (`is_standard = "Yes"`). If the `tabReport` row is left as
`is_standard = "No"` with an empty `report_script` (a stale/restored row, or a
record created in desk without a disk sync), Frappe instead takes the
`execute_script` path and calls `safe_exec(report_script, …)` on a `NULL`
script, raising:

> `TypeError: Not allowed source type: "NoneType".`

`_ensure_standard_reports()` heals this **purely from source** — it re-imports
the report's committed `.json` with
`frappe.modules.import_file.import_file_by_path(path, force=True)`, the exact
operation `bench migrate` runs for every standard record. The `.json` declares
`is_standard: "Yes"`, so the upserted row is always standard. **No DB field is
poked by hand — no `db.set_value`, no `get_doc().save()`** (saving a standard
Report in developer_mode would rewrite the disk files, which a migrate hook
must never do). Source `.json` → import → done.

Because Frappe Cloud runs `bench migrate` on every deploy, this also runs there
— so installing/deploying kavach on Frappe Cloud installs the report as
standard with no manual step.

Verified 2026-06-20 on `dev.localhost`: forcing `is_standard="No"` re-creates
the `NoneType` crash; running the heal (pure `.json` re-import) restores
`is_standard="Yes"` and the report runs (33 cols, clean).
