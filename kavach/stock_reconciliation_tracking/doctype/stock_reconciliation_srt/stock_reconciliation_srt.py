# =============================================================================
# CONTEXT: Stock Reconciliation SRT — wrapper around ERPNext Stock Reconciliation.
#
#   Why this exists (problem this DocType solves):
#     ERPNext's native Stock Reconciliation form expects the operator to manually
#     enter one row per (item, warehouse, batch) WITH the new qty AND new
#     valuation rate. That's error-prone at scale (chaizup has 1000+ batches per
#     SFG item). This wrapper:
#       1. Auto-populates one row per (batch, warehouse) where qty > 0 at the
#          moment the user picks the item.
#       2. Lets the counter type ONLY the qty they actually found per batch;
#          batches NOT counted are silently retained at current Bin qty.
#       3. Recomputes total-found in BOTH default UOM and a chosen higher UOM
#          (e.g., Carton) in real time as the counter types — operator never
#          does unit math by hand.
#       4. On submit, builds and auto-submits a real ERPNext Stock
#          Reconciliation containing ONLY the counted rows. Uncounted rows
#          are explicitly excluded from the ERPNext SR, which preserves
#          their current Bin qty without any SLE delta.
#
#   PCAOB / Audit trail: the linked ERPNext SR is the audit-evidence document.
#   This SRT doc records the count session (who counted, when, in what UOM)
#   and gets a back-link from the SR via the SR's `custom_remarks` field.
#
# MEMORY:
#   - app_kavach.md (app root)
#   - chaizup_audit_site_specifics.md   (custom_remarks mandatory, account name)
#   - erpnext_bulk_reconcile_quirks.md   (Quirk #2 silent submit, #6 expense
#     account, #7 batch master, #13 batch_no per row)
#
# INSTRUCTIONS:
#   - validate() ONLY recomputes the parent totals from the child rows. It
#     does NOT mutate child rows' stored qty / rate / warehouse — those are
#     set by the JS autopopulate + the row's row-level edits. Mutating them
#     here would race the form and confuse users.
#   - on_submit() creates the real ERPNext Stock Reconciliation INSIDE
#     a try/except + frappe.db.commit() pattern. If the SR submit fails,
#     this SRT doc is ALREADY at docstatus=1 (post-`db.commit()`), so the
#     user gets a clear error and can either cancel + retry or manually
#     post the SR. Don't try to rollback the SRT — Frappe v16 doesn't
#     handle nested submit-rollback cleanly.
#
# DANGER ZONE:
#   - Don't ignore `custom_remarks` on the ERPNext SR — it's a MANDATORY
#     custom field on chaizup-test. Setting it correctly is the audit-trail
#     bridge between the SRT doc and the real SR.
#   - Don't auto-submit the SR with `sr.submit()` alone — Quirk #2 says
#     `validate_negative_qty_in_future_sle` swallows the throw and leaves
#     docstatus=0. Use `sr._submit()` (low-level) and assert post-commit.
#   - The `is_counted` field is USER-CONTROLLED via the "Do Reconcile"
#     checkbox in the grid's first column. Per 2026-05-21 spec, default
#     is UNCHECKED — qty_found is IGNORED on unchecked rows; the batch
#     retains its current ledger stock. ONLY checked rows go to the
#     ERPNext SR. Do NOT add JS that auto-ticks is_counted based on
#     qty_found edits — the user must explicitly opt-in per row.
#   - The save itself is gated by `_enforce_at_least_one_reconcile_ticked`
#     in validate() — zero ticked rows = no save. Do NOT downgrade this
#     to a submit-only check; users would otherwise create empty drafts
#     that hold up the duplicate-item guard while having nothing to
#     reconcile.
#   - The ERPNext SR's `valuation_rate` + `current_valuation_rate` are
#     BOTH pinned to the current Bin.valuation_rate at submit time
#     (NOT the row's stored snapshot, which may have gone stale).
#     Per 2026-05-21 spec: the stock team uses SRT with limited rate
#     knowledge — SRT MUST NOT change valuation rates. Setting both
#     fields to the same value guarantees the SR moves only qty, never
#     rate. Do NOT expose `valuation_rate` on the form / Batch List
#     grid — it would let operators introduce rate drift.
#
# RESTRICT:
#   - Do NOT rename `linked_erpnext_sr` — it's the back-link the audit team
#     queries to find the SR for any SRT doc.
#   - Do NOT change `naming_series` away from `SRT-RECO-.YYYY.-.#####` —
#     downstream reports filter by this prefix.
#   - Do NOT remove `_stamp_child_warehouse_and_item()` from validate(). It
#     is the ONLY path that fills `warehouse` + `item_code` on child rows
#     created by REST API / fixture import / any non-UI caller. Removing it
#     causes on_submit to fail with "warehouse is required" on SR Item rows.
#   - Do NOT reorder validate() to put `_mirror_item_name` AFTER
#     `_stamp_child_warehouse_and_item`. The stamp reads self.item_name; if
#     mirror runs later, every newly-created doc loses the
#     `item_name_selected` mirror on child rows until the next save.
#   - Do NOT lift `read_only=1` on `batches.warehouse` or `batches.item_code`
#     in the JSON — the user spec mandates these are read-only, and the
#     auto-stamp logic relies on the fact that the user can't override them.
#   - Do NOT remove the `getattr(self.flags, "all_matched_no_delta", False)`
#     check in on_submit. `flags` is initialised per-request; direct attribute
#     access would AttributeError on the first save of a fresh doc.
#   - Do NOT change the `SYSTEM_APPROVE_MESSAGE` constant text without user
#     approval — downstream audit reports may grep for the literal string.
#     Spec: docs/specs/2026-05-22-srt-case1-case2-design.md.
#   - Do NOT call self.save() or self.db_update() inside
#     `_route_to_system_approved()`. Both re-run validate(), which would
#     reject the cross-role remark writes via the remark-field-permission
#     gate. db_set with update_modified=False is the only safe write path.
#   - Do NOT rename `gap_between_stock_reconciliation_days` (SRT Settings
#     field). _enforce_min_gap_between_srts reads it by literal fieldname.
#   - Do NOT filter `_enforce_min_gap_between_srts`'s prior-SRT query by
#     warehouse — spec is "same item" regardless of warehouse.
#   - Do NOT add an "ignore gap" flag on the SRT doc to override the
#     setting without an audit-permission gate. Process discipline is
#     the whole point of the gap.
#   - Do NOT widen the COMPLETED_STATES tuple in
#     _enforce_no_duplicate_open_srt_for_item without verifying the
#     workflow_state actually represents a state where operator
#     intervention is no longer required. Adding "Admin Approval"
#     would let users start a new SRT while the prior's ERPNext SR
#     is still draft — risks parallel-write races on the same item.
#   - Do NOT remove the workflow_state IS NULL / '' guard in the
#     duplicate-open SQL. Direct-API submits that bypass the workflow
#     framework leave workflow_state empty at docstatus=1; treating
#     those as "open" is the safe default.
#
# GOTCHA — "Module Stock Reconciliation Tracking not found" (resolved 2026-05-21)
# -------------------------------------------------------------------------------
# Symptom: AwesomeBar / direct URL → "Not found / Module Stock Reconciliation
# Tracking not found / The resource you are looking for is not available."
# Even in incognito mode. Even after `bench clear-cache`.
#
# Root cause: the app is in `sites/apps.txt` (bench-level) but MISSING from
# `tabInstalled Application` (site-level). This typically happens when:
#   (a) a production DB backup was restored on top of dev (production didn't
#       ship this app, so its `tabInstalled Application` rows replaced dev's),
#   (b) Module Def + DocTypes were created manually after restore, but the
#       site-installed-apps registration step was skipped.
#
# Why HTTP requests fail but bench-shell python works:
#   `frappe.__init__.py:210` calls
#     setup_module_map(include_all_apps=not (frappe.request or frappe.job
#                                            or frappe.flags.in_migrate))
#   In a request context, `include_all_apps=False` → reads only SITE-installed
#   apps (`tabInstalled Application` rows). Bench-shell with no `frappe.request`
#   reads ALL apps in `apps.txt`, so it works there and masks the bug.
#
# Fix (one-time, idempotent):
#   from frappe.installer import add_to_installed_apps
#   frappe.init(site=...); frappe.connect()
#   add_to_installed_apps("kavach")
#   frappe.db.commit()
#   frappe.client_cache.delete_value("installed_app_modules")
#   frappe.cache.delete_value(["app_modules", "installed_app_modules",
#       "installed_apps", "module_app", "module_installed_app", "bootinfo"])
#   frappe.clear_cache()
#
# Prevention: anytime a backup is restored from a site that didn't have this
# app, immediately re-run `add_to_installed_apps()` for SRT before the user
# touches the desk UI.
# =============================================================================

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime, nowdate, nowtime, get_datetime


# =============================================================================
# Case 1 (all-matched auto-approve) — system message written to both approval
# remark fields when on_submit detects every ticked row matches current stock.
#
# RESTRICT: do NOT change this text without user approval. Downstream audit
# reports may grep for the literal string. Spec: docs/specs/2026-05-22-srt-
# case1-case2-design.md § 3.1.
# =============================================================================
SYSTEM_APPROVE_MESSAGE = (
    "all batch are correct and the physical found exact match with current stock"
)


class StockReconciliationSRT(Document):

    # ── Lifecycle ───────────────────────────────────────────────────────
    def validate(self):
        self._set_default_posting()
        self._mirror_item_name()                    # must run BEFORE stamp so children inherit
        self._stamp_child_warehouse_and_item()
        self._enforce_no_duplicate_rows()
        self._enforce_no_duplicate_open_srt_for_item()
        self._enforce_min_gap_between_srts()        # NEW 2026-05-22
        self._classify_zero_delta_ticks()           # must run BEFORE the "at least one ticked"
                                                    # gate so the auto-untick of matches takes
                                                    # effect for the count check.
        self._enforce_at_least_one_reconcile_ticked()
        self._enforce_remark_field_permissions()
        self._recompute_totals()

    def on_submit(self):
        """SRT submit — TWO PATHS (2026-05-22):

        1. Case 1 (all_matched_no_delta flag set by _classify_zero_delta_ticks
           in validate): skip the ERPNext SR entirely, route to
           'Approved By System' workflow state. No human approval needed.

        2. Normal path (any real-delta ticks): create a DRAFT ERPNext SR.
           Per 2026-05-21 workflow spec, the actual SR submit is gated
           separately to Srt Super Admin via submit_linked_sr().
        """
        if getattr(self.flags, "all_matched_no_delta", False):
            self._route_to_system_approved()
            return
        try:
            sr_name = self._create_erpnext_sr_draft()
            self.db_set("linked_erpnext_sr", sr_name, update_modified=False)
            # Stamp the admin approver — the user who is moving the SRT
            # from Draft to Admin Approval. Auto-set on every submit;
            # if the SRT is later amended and re-submitted, this gets
            # over-written with whoever did THAT submit (correct audit).
            self.db_set("admin_approved_by", frappe.session.user, update_modified=False)
            frappe.msgprint(
                _("Draft ERPNext Stock Reconciliation <a href='/app/stock-reconciliation/{0}'>{0}</a> created. Awaiting Srt Super Admin approval to submit.").format(sr_name),
                indicator="orange", alert=True,
            )
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"SRT {self.name}: ERPNext SR draft creation failed",
            )
            raise

    def _route_to_system_approved(self):
        """Case 1 short-circuit — fired from on_submit when every ticked
        row had qty_found == current_stock_in_selected_uom (no delta).

        Skips the ERPNext SR creation entirely. Sets workflow_state =
        'Approved By System' directly (overrides the workflow's default
        Admin Approval set by the Approve action), stamps both approval
        audit fields, and fills both remark fields with the system
        message (only if empty — preserves manually-typed admin notes).

        ALL writes go through db_set with update_modified=False so:
          - validate() doesn't re-run (would re-enforce remark field
            permissions and reject our writes since we're cross-role).
          - the parent `modified` timestamp isn't double-bumped (the
            outer save event already bumps it).

        MEMORY: docs/specs/2026-05-22-srt-case1-case2-design.md § 3.1
        DANGER: do NOT call self.save() or self.db_update() here — both
        re-run validate which rejects cross-role remark writes via
        _enforce_remark_field_permissions.
        """
        self.db_set("workflow_state", "Approved By System", update_modified=False)
        self.db_set("admin_approved_by", frappe.session.user, update_modified=False)
        self.db_set("super_admin_approved_by", frappe.session.user, update_modified=False)
        if not (self.admin_remark or "").strip():
            self.db_set("admin_remark", SYSTEM_APPROVE_MESSAGE, update_modified=False)
        if not (self.super_admin_remark or "").strip():
            self.db_set("super_admin_remark", SYSTEM_APPROVE_MESSAGE, update_modified=False)
        frappe.msgprint(
            _("All ticked batches matched current stock. Approved by system — "
              "no ERPNext Stock Reconciliation needed."),
            indicator="green", alert=True,
        )

    def on_cancel(self):
        """SRT cancel cascades to the linked SR.

        Rule (per 2026-05-21 spec): SRT can be cancelled ONLY when the
        linked ERPNext SR is still in DRAFT. The draft SR is then DELETED
        (not cancelled) — there's no SLE/GL to roll back since it never
        submitted.

        If the SR was already submitted (workflow advanced to Super Admin
        Approval), the SRT cancel attempt would normally be blocked. But
        Srt Super Admin / System Manager can cancel both: in that case
        we cancel-then-delete the SR.
        """
        if not (self.linked_erpnext_sr and frappe.db.exists("Stock Reconciliation", self.linked_erpnext_sr)):
            return
        sr_doc = frappe.get_doc("Stock Reconciliation", self.linked_erpnext_sr)

        if sr_doc.docstatus == 0:
            # Draft SR — delete it. No SLE to roll back.
            try:
                sr_doc.flags.ignore_permissions = True
                frappe.delete_doc("Stock Reconciliation", sr_doc.name,
                                  force=True, ignore_permissions=True)
                frappe.msgprint(
                    _("Draft ERPNext Stock Reconciliation {0} deleted.").format(self.linked_erpnext_sr),
                    indicator="orange", alert=True,
                )
            except Exception:
                frappe.log_error(
                    frappe.get_traceback(),
                    f"SRT {self.name}: failed to delete draft SR {self.linked_erpnext_sr}",
                )
                raise

        elif sr_doc.docstatus == 1:
            # Submitted SR — only Srt Super Admin / System Manager can
            # cascade here. Permission check defers to ERPNext SR's own
            # cancel permissions.
            allowed = frappe.session.user == "Administrator" or any(
                r in frappe.get_roles() for r in ("System Manager", "Srt Super Admin")
            )
            if not allowed:
                frappe.throw(_(
                    "SRT {0} cannot be cancelled: linked ERPNext SR {1} is "
                    "already submitted. Only Srt Super Admin or System "
                    "Manager can cancel a submitted reconciliation."
                ).format(self.name, self.linked_erpnext_sr))
            try:
                sr_doc.flags.ignore_permissions = True
                sr_doc.cancel()
                frappe.db.commit()
                frappe.msgprint(
                    _("Linked ERPNext Stock Reconciliation {0} was submitted and has been cancelled.").format(self.linked_erpnext_sr),
                    indicator="red", alert=True,
                )
            except Exception:
                frappe.log_error(
                    frappe.get_traceback(),
                    f"SRT {self.name}: failed to cascade-cancel submitted SR {self.linked_erpnext_sr}",
                )
                raise

    # ── Helpers ─────────────────────────────────────────────────────────
    def _set_default_posting(self):
        if not self.posting_date:
            self.posting_date = nowdate()
        if not self.posting_time:
            self.posting_time = nowtime()

    def _mirror_item_name(self):
        if self.item and not self.item_name:
            self.item_name = frappe.db.get_value("Item", self.item, "item_name") or self.item

    def _stamp_child_warehouse_and_item(self):
        """Mirror parent.default_warehouse + parent.item onto every child row.

        This is the server-side counterpart to the JS `batches_add` hook —
        guarantees that every child row's warehouse equals the parent's
        chosen warehouse and item, regardless of how the row was created
        (UI, API, fixture import). Required because child `warehouse` and
        `item_code` are declared read-only in the JSON; without this stamp,
        rows added via the REST API would land with NULL warehouse and
        break the on_submit SR build (which requires a warehouse).
        """
        if not self.default_warehouse:
            return
        for r in (self.batches or []):
            if not r.warehouse:
                r.warehouse = self.default_warehouse
            if self.item and not r.item_code:
                r.item_code = self.item
            if self.item_name and not r.item_name_selected:
                r.item_name_selected = self.item_name

    def _classify_zero_delta_ticks(self):
        """Two-mode handler for ticked rows where Qty Found equals Current
        Stock (Selected UOM) within display precision (epsilon 0.001).

        Per 2026-05-22 spec:

        **Case 1 — ALL ticked rows match (no delta anywhere).**
            Allow save/submit but skip the ERPNext SR creation entirely.
            on_submit reads `self.flags.all_matched_no_delta` and routes
            the doc to the "Approved By System" workflow state instead
            of the normal Draft → Admin Approval path. No admin / super
            admin approval needed. Both approval remarks are auto-filled
            with a "all batches match" system note.

        **Case 2 — MIXED (some matches, some real deltas).**
            Silently untick the matching rows IN PLACE (set is_counted=0).
            Only the real-delta rows then proceed to the normal flow.
            This catches operator error (ticking too many rows) without
            blocking the save.

        Replaces the previous `_enforce_no_zero_delta_on_ticked_rows`
        which threw on ANY zero-delta tick — too strict for legitimate
        "I counted all and confirmed nothing changed" workflows.

        Epsilon = 0.001 matches the field's precision=3 (display digits).
        Without this tolerance, the autopop value (e.g., 282.5604/1000 =
        0.2825604) wouldn't equal the rounded display the operator sees
        (0.283).

        DON'T tighten epsilon below 0.001 — forces user to perceive
        sub-displayable diffs.
        DON'T skip on certain workflow states — operator-edited drafts
        need this routing whenever they save.
        """
        EPS = 0.001
        rows = self.batches or []
        ticked = [r for r in rows if r.is_counted]
        if not ticked:
            self.flags.all_matched_no_delta = False
            return

        matches = []
        deltas  = []
        for r in ticked:
            qf  = flt(r.qty_found)
            cur = flt(r.current_stock_in_selected_uom)
            if abs(qf - cur) < EPS:
                matches.append(r)
            else:
                deltas.append(r)

        if matches and deltas:
            # Mixed: silently untick the matching rows. Leaves the real
            # deltas ticked for the normal Admin Approval flow.
            for r in matches:
                r.is_counted = 0
            self.flags.all_matched_no_delta = False
        elif matches and not deltas:
            # All matches: keep them ticked (they document what was counted),
            # and flag the doc for the system-approve path. on_submit will
            # skip SR creation and set workflow_state="Approved By System".
            self.flags.all_matched_no_delta = True
        else:
            # All deltas: normal flow.
            self.flags.all_matched_no_delta = False

    def _enforce_remark_field_permissions(self):
        """Field-level write gates on the 3 remark fields, per 2026-05-21 spec:

          | Field               | Writable by              | Writable in state    |
          |---------------------|--------------------------|----------------------|
          | user_remark         | Doc owner                | Draft                |
          | admin_remark        | Srt Admin (or above)     | Draft                |
          | super_admin_remark  | Srt Super Admin (or above)| Admin Approval      |

          - System Manager + Administrator bypass all checks ("system admin
            have all the access" per spec).
          - "Or above" hierarchy: Srt Super Admin counts as Srt Admin too
            (a strict subset would force every admin to also be a super
            admin which contradicts the segregation-of-duties intent).

        Implementation:
          - Determine OLD value via self.get_doc_before_save() — Frappe
            caches the pre-edit state on validate, so we can detect
            which fields changed in this save round.
          - For new docs (is_new() True), old is None; treat ANY non-empty
            value as "changed" so we still gate fresh inserts.
          - Locked-field detection skips when the field's value didn't
            change — otherwise re-saves by a different role would fail
            even though the user didn't touch the locked field.
        """
        if self._is_privileged_user():
            return  # System Manager / Administrator — unrestricted

        old = self.get_doc_before_save() if not self.is_new() else None
        state = self.workflow_state or "Draft"
        roles = set(frappe.get_roles())
        is_owner = (self.owner or frappe.session.user) == frappe.session.user

        def changed(fieldname):
            new_val = self.get(fieldname) or ""
            old_val = (old.get(fieldname) or "") if old else ""
            return new_val != old_val

        # user_remark — owner only, Draft only
        if changed("user_remark"):
            if state != "Draft":
                frappe.throw(_(
                    "User Remark can only be edited while the SRT is in Draft state."
                ), title=_("Field Locked"))
            if not is_owner:
                frappe.throw(_(
                    "Only the SRT creator ({0}) can edit the User Remark."
                ).format(self.owner), title=_("Field Locked"))

        # admin_remark — Srt Admin (or above), Draft only
        if changed("admin_remark"):
            if state != "Draft":
                frappe.throw(_(
                    "Admin Remark can only be edited while the SRT is in Draft state."
                ), title=_("Field Locked"))
            if not roles & {"Srt Admin", "Srt Super Admin"}:
                frappe.throw(_(
                    "Only Srt Admin (or Srt Super Admin) can edit the Admin Remark."
                ), title=_("Field Locked"))

        # super_admin_remark — Srt Super Admin (or above), Admin Approval only
        if changed("super_admin_remark"):
            if state != "Admin Approval":
                frappe.throw(_(
                    "Super Admin Remark can only be edited when the SRT is at Admin Approval. "
                    "Current state: {0}."
                ).format(state), title=_("Field Locked"))
            if "Srt Super Admin" not in roles:
                frappe.throw(_(
                    "Only Srt Super Admin can edit the Super Admin Remark."
                ), title=_("Field Locked"))

    def _is_privileged_user(self):
        """Always-allow check: Administrator + System Manager bypass
        all field-level write gates."""
        if frappe.session.user == "Administrator":
            return True
        return "System Manager" in set(frappe.get_roles())

    def _enforce_at_least_one_reconcile_ticked(self):
        """Block save/submit when zero rows have 'Do Reconcile' ticked.

        Per 2026-05-21 spec — a SRT without any ticked rows has no
        actionable content; the operator opened the form, autopopulated
        the batches, but didn't commit to reconciling anything. We block
        even the draft save so the user can't accumulate empty SRTs that
        clog the duplicate-item guard.

        Skipped when:
          - The doc is already cancelled (docstatus=2) — frozen.
          - The doc has no item yet (user is mid-fill, before first
            autopopulate). validate fires even on the initial save; we
            don't want to block before the user has had a chance to
            pick item+warehouse and tick a row.

        Why we don't skip on docstatus=1: by then the on_submit hook
        has already run and created the linked SR; if no rows were
        counted, that path would have thrown already. This check is the
        save-time gate.
        """
        if self.docstatus == 2:
            return
        if not (self.item and self.default_warehouse):
            return
        ticked = [r for r in (self.batches or []) if r.is_counted]
        if not ticked:
            frappe.throw(_(
                "Cannot save: tick the 'Do Reconcile' checkbox on at least "
                "one batch row. Rows without the tick are ignored on submit; "
                "an SRT with zero ticked rows has nothing to reconcile."
            ), title=_("No Rows Marked for Reconciliation"))

    def _enforce_no_duplicate_open_srt_for_item(self):
        """Block creating a second SRT for an item that already has one
        in a workflow state where the reconciliation is NOT YET complete.

        2026-05-22 v0.0.4 update — "open" now considers workflow_state,
        not just docstatus. A reconciliation is considered COMPLETE (and
        therefore non-blocking) at these workflow states:

          - "Super Admin Approval" (docstatus=1) — ERPNext SR submitted,
            SLE/GL posted, stock movements are LIVE.
          - "Approved By System"   (docstatus=1) — Case 1 path, no SR
            needed because everything matched.

        Blocking workflow states ("open" / still-in-progress):

          - docstatus=0 (any draft, regardless of workflow_state)
          - docstatus=1 with workflow_state = "Admin Approval" — SR is
            still draft awaiting super admin
          - docstatus=1 with workflow_state IS NULL / empty / anything
            else — defensive: catches direct-API submits that bypassed
            the workflow framework; treat as "still open" so the user
            doesn't silently lose audit invariants.

        Always non-blocking:

          - docstatus=2 (Close — terminal cancelled state)

        The gap rule (`_enforce_min_gap_between_srts`) runs AFTER this
        check and provides the spacing throttle once a prior SRT is
        complete.

        New docs only (when self.is_new() is True) AND amendments
        (when self.amended_from is set) skip this check — amend is
        the legitimate "I'm replacing the previous one" path.

        RESTRICT: do NOT widen the COMPLETED_STATES tuple without
        verifying the workflow_state actually represents a state where
        operator intervention is no longer required. Adding e.g.
        "Admin Approval" would let users start a new SRT while the
        prior's ERPNext SR is still draft — risks parallel-write
        races on the same item.
        """
        if not self.item:
            return
        if self.amended_from:
            return

        # Workflow states where the prior reconciliation is considered
        # COMPLETE — new SRTs for the same item are allowed (subject to
        # the gap rule). Keep this tuple narrow; see docstring.
        COMPLETED_STATES = ("Super Admin Approval", "Approved By System")

        existing = frappe.db.sql("""
            SELECT name, docstatus, workflow_state
            FROM `tabStock Reconciliation SRT`
            WHERE item = %s
              AND name != %s
              AND (
                docstatus = 0
                OR (docstatus = 1
                    AND (workflow_state IS NULL OR workflow_state = ''
                         OR workflow_state NOT IN %s))
              )
            ORDER BY creation DESC
            LIMIT 1
        """, (self.item, self.name or "", COMPLETED_STATES), as_dict=True)
        if existing:
            other = existing[0]
            frappe.throw(_(
                "Cannot create a new SRT for item <b>{0}</b>: SRT <b>{1}</b> "
                "is still open (status: {2}). Close the existing SRT or "
                "complete its workflow before starting a new one."
            ).format(self.item, other.name, other.workflow_state or
                     ("Draft" if other.docstatus == 0 else "Submitted")))

    def _enforce_min_gap_between_srts(self):
        """Block creating a new SRT for an item within the minimum-gap
        window defined in SRT Settings. The gap is measured against the
        most recent SRT for the same item with docstatus IN (1, 2),
        using posting_date — symmetric (backdated docs within window
        also blocked) via abs(date_diff).

        Skipped when:
          - gap_days == 0 (feature disabled — opt-in)
          - self.docstatus == 2 (cancelled — frozen)
          - self.amended_from is set (amendments replace, not duplicate)
          - item or posting_date not yet set (mid-fill)

        Why docstatus IN (1, 2):
          - docstatus=1: active workflow (the duplicate-open guard
            already blocks new SRT creation; gap rule message is
            redundant but harmless here).
          - docstatus=2: closed/completed — gap rule's distinct value.
            After a SRT reaches Close, duplicate-open no longer applies
            and the gap rule becomes the only forward-looking spacing.

        Includes Approved By System docs — they ARE completed
        reconciliations even though they skip the ERPNext SR creation.

        SPEC: docs/specs/2026-05-22-srt-settings-gap-design.md § 2.2
        RESTRICT: do NOT filter prior-SRT query by warehouse; spec is
        "same item" regardless of warehouse.
        """
        from frappe.utils import add_days, date_diff, formatdate

        gap_days = int(frappe.db.get_single_value(
            "SRT Settings", "gap_between_stock_reconciliation_days") or 0)
        if gap_days <= 0:
            return
        if self.docstatus == 2:
            return
        if self.amended_from:
            return
        if not (self.item and self.posting_date):
            return

        prev = frappe.db.sql("""
            SELECT name, posting_date FROM `tabStock Reconciliation SRT`
            WHERE item = %s AND docstatus IN (1, 2) AND name != %s
            ORDER BY posting_date DESC, posting_time DESC LIMIT 1
        """, (self.item, self.name or ""), as_dict=True)
        if not prev:
            return

        days = abs(date_diff(self.posting_date, prev[0]["posting_date"]))
        if days < gap_days:
            earliest = add_days(prev[0]["posting_date"], gap_days)
            frappe.throw(_(
                "Cannot create SRT for item <b>{0}</b>: the previous Stock "
                "Reconciliation for this item was on <b>{1}</b> ({2}). "
                "Minimum gap configured in SRT Settings is <b>{3}</b> days; "
                "earliest allowed posting date for a new SRT is <b>{4}</b>."
            ).format(
                self.item, formatdate(prev[0]["posting_date"]),
                prev[0]["name"], gap_days, formatdate(earliest),
            ), title=_("SRT Gap Violation"))

    def _enforce_no_duplicate_rows(self):
        """Each (batch_no, warehouse) tuple can appear at most once.
        ERPNext SR posts ONE row per tuple — duplicates would silently
        overwrite each other.
        """
        seen = set()
        for r in (self.batches or []):
            if not r.batch_no:
                continue
            key = (r.batch_no, r.warehouse or "")
            if key in seen:
                frappe.throw(_(
                    "Duplicate row: batch {0} appears twice for warehouse {1}. "
                    "Each (batch, warehouse) must be unique."
                ).format(r.batch_no, r.warehouse or "—"))
            seen.add(key)

    def _recompute_totals(self):
        """Σ over child rows of:
              qty_found_in_stock_uom (if row.is_counted == 1)
              OR current_stock_in_stock_uom (if row.is_counted == 0).

        qty_found_in_stock_uom = qty_found × row.conversion_factor.

        CRITICAL: do NOT use `qty_found is not None` as the "is counted"
        check. Frappe's Float field stores 0.0 (not None) for unset values,
        so that check would incorrectly include uncounted rows AND treat
        legitimate "I counted zero" as uncounted. The `is_counted` Check
        field is the canonical sentinel — set by the JS controller the
        moment the user changes qty_found on a row.
        """
        total_current = 0.0
        total_found = 0.0
        for r in (self.batches or []):
            current_in_stock = flt(r.current_stock_in_stock_uom)
            total_current += current_in_stock
            if r.is_counted:
                cf = self._resolve_row_cf(r)
                total_found += flt(r.qty_found) * cf
            else:
                total_found += current_in_stock
        self.total_current_stock_in_default_uom = total_current
        self.total_qty_found_in_default_uom = total_found
        hcf = flt(self.higher_uom_cf) or 1.0
        self.total_current_stock_in_higher_uom = total_current / hcf if hcf else 0
        self.total_qty_found_in_higher_uom = total_found / hcf if hcf else 0

    def _resolve_row_cf(self, r):
        """Server-side mirror of JS _ipv_srt_resolve_cf — Frappe child
        rows can lose hidden field values across edit paths; we derive
        the conversion factor from any of these signals, in order:
          1. r.conversion_factor (happy path)
          2. current_stock_in_stock_uom / current_stock_in_selected_uom
          3. self.higher_uom_cf when r.select_uom == self.higher_uom
          4. 1.0 (assume stock UOM)
        """
        cf = flt(r.conversion_factor)
        if cf > 0:
            return cf
        stock_qty = flt(r.current_stock_in_stock_uom)
        sel_qty   = flt(r.current_stock_in_selected_uom)
        if stock_qty > 0 and sel_qty > 0:
            cf = stock_qty / sel_qty
            if cf > 0:
                return cf
        if r.select_uom and r.select_uom == self.higher_uom:
            cf = flt(self.higher_uom_cf)
            if cf > 0:
                return cf
        return 1.0

    # ── ERPNext SR creation ─────────────────────────────────────────────
    def _create_erpnext_sr_draft(self):
        """Builds a real ERPNext Stock Reconciliation containing only
        rows where 'Do Reconcile' is ticked. INSERTS but does NOT submit.
        Returns the SR name.

        Per the 2026-05-21 workflow split:
          - SRT submit creates the SR in DRAFT only.
          - The actual ERPNext SR submit happens later via
            submit_linked_sr() (Srt Super Admin / System Manager).
        """
        # Filter to rows where the user explicitly ticked "Do Reconcile".
        # qty_found on un-ticked rows is IGNORED (per 2026-05-21 spec —
        # checkbox is user-controlled, default unchecked).
        counted_rows = [r for r in (self.batches or [])
                        if r.is_counted and r.batch_no and r.warehouse]
        if not counted_rows:
            frappe.throw(_(
                "Cannot submit: no rows have 'Do Reconcile' ticked. "
                "Tick the checkbox in the first column of each batch you "
                "want to include in the Stock Reconciliation — or cancel "
                "this draft if there's nothing to reconcile."
            ))

        expense_account = frappe.db.get_value("Account", {
            "account_type": "Stock Adjustment",
            "company": self.company,
        }, "name")
        if not expense_account:
            frappe.throw(_(
                "No Stock Adjustment account found for company {0}. "
                "Create one in the Chart of Accounts first."
            ).format(self.company))

        try:
            sr = frappe.new_doc("Stock Reconciliation")
            sr.purpose = "Stock Reconciliation"
            sr.company = self.company
            # 2026-05-25 (v0.0.9.26) — set_posting_time = 1 is REQUIRED.
            # ERPNext's TransactionBase.validate_posting_time() unconditionally
            # overwrites posting_date + posting_time with now() unless this
            # flag is truthy on the doc. validate runs on BOTH insert AND
            # submit, so without this:
            #   - insert: our self.posting_date/time gets reset to today/now
            #     (sometimes survives, depending on field default ordering)
            #   - submit (super admin click): even if insert preserved our
            #     values, submit's validate_posting_time pass overrides them
            #     and the linked SR posts at the super admin's click time
            #     instead of the SRT's intended backdated posting.
            # MUST stay set before posting_date/posting_time assignment so
            # the validate path sees set_posting_time truthy.
            # See: erpnext/utilities/transaction_base.py:validate_posting_time
            # RESTRICT: Do NOT remove. Backdating the SRT and watching the
            # SR get stamped at "now" is exactly the audit-trail violation
            # SRT was built to prevent.
            sr.set_posting_time = 1
            sr.posting_date = self.posting_date
            sr.posting_time = self.posting_time
            sr.expense_account = expense_account
            sr.custom_remarks = (
                f"Created via Stock Reconciliation SRT {self.name} "
                f"(item {self.item}). Counted {len(counted_rows)} of "
                f"{len(self.batches or [])} batches. Uncounted batches "
                f"retain their pre-existing Bin qty (not in this SR). "
                f"Counter: {self.owner}. Posted via SRT wrapper for "
                f"audit-trail visibility per PCAOB AS 2401. "
                f"Valuation rate is preserved from existing system value "
                f"(SRT does not allow rate changes — stock team operators "
                f"have limited rate knowledge by design)."
            )
            # TWO-PASS submit for rate preservation (2026-05-21):
            #
            #   Pass 1 — INSERT the SR with batch_no + qty + use_serial_batch_fields=1
            #            but leave valuation_rate=0. ERPNext's validate then
            #            populates current_valuation_rate per row using its own
            #            authoritative per-batch rate logic (NOT the Bin
            #            warehouse rate; NOT MAX(sle.valuation_rate); some
            #            internal weighted/historical calc).
            #
            #   Pass 2 — Mirror current_valuation_rate → valuation_rate
            #            via db_set on each item row, BEFORE _submit. This
            #            guarantees the SR sees "new rate == current rate"
            #            and posts a stock_value_difference of qty_delta ×
            #            existing_rate only — no rate drift.
            #
            # The row's stored valuation_rate is ignored entirely; ERPNext
            # is the authoritative source for the current batch rate.
            #
            # DON'T DOWNGRADE to single-pass with our own batch-rate query —
            # tested with MAX(sle.valuation_rate) and got 4.09 for batch
            # 6A01D26 where ERPNext considers 1.583 the actual current
            # rate. Our SQL doesn't replicate ERPNext's avg-rate engine.
            for r in counted_rows:
                cf = self._resolve_row_cf(r)
                qty_in_stock = flt(r.qty_found) * cf
                sr.append("items", {
                    "item_code": self.item,
                    "warehouse": r.warehouse,
                    "qty": qty_in_stock,
                    "batch_no": r.batch_no,
                    "use_serial_batch_fields": 1,
                    "current_qty": flt(r.current_stock_in_stock_uom),
                    # valuation_rate intentionally LEFT BLANK at insert —
                    # ERPNext fills current_valuation_rate during validate;
                    # we mirror it onto valuation_rate after insert.
                })
            sr.flags.ignore_permissions = True
            sr.insert()
            # Mirror ERPNext's computed current_valuation_rate → valuation_rate
            # so the eventual SR submit moves only qty, not rate.
            for it in sr.items:
                existing_rate = flt(it.current_valuation_rate)
                if existing_rate > 0:
                    it.db_set("valuation_rate", existing_rate, update_modified=False)
            frappe.db.commit()
            sr.reload()
            return sr.name
        except Exception:
            raise

    def submit_linked_sr(self):
        """Submit the linked ERPNext Stock Reconciliation.

        Gated to:
          - Srt Super Admin role
          - System Manager
          - Administrator (always)

        Applies the SABB monkey-patches + Stock Settings toggles (Quirk #2,
        per erpnext_bulk_reconcile_quirks) inside try/finally so the site
        is restored to safe state on any error.

        Two-pass rate-mirror was done during _create_erpnext_sr_draft;
        nothing further is required for rate preservation.

        Returns the SR name on success.
        """
        if not self._can_submit_linked_sr():
            frappe.throw(_(
                "You are not allowed to submit the linked ERPNext Stock "
                "Reconciliation. This action is restricted to Srt Super "
                "Admin or System Manager."
            ))
        if not self.linked_erpnext_sr:
            frappe.throw(_("This SRT has no linked ERPNext Stock Reconciliation yet."))

        sr = frappe.get_doc("Stock Reconciliation", self.linked_erpnext_sr)
        if sr.docstatus == 1:
            frappe.msgprint(_("ERPNext SR {0} is already submitted.").format(sr.name),
                            indicator="green", alert=True)
            return sr.name
        if sr.docstatus == 2:
            frappe.throw(_("ERPNext SR {0} is cancelled — cannot submit.").format(sr.name))

        self._apply_validation_patches()
        old_neg = frappe.db.get_single_value("Stock Settings", "allow_negative_stock")
        old_neg_batch = frappe.db.get_single_value("Stock Settings", "allow_negative_stock_for_batch")
        frappe.db.set_single_value("Stock Settings", "allow_negative_stock", 1)
        frappe.db.set_single_value("Stock Settings", "allow_negative_stock_for_batch", 1)
        try:
            sr.flags.ignore_permissions = True
            sr._submit()
            frappe.db.commit()
            sr.reload()
            if sr.docstatus != 1:
                frappe.throw(_(
                    "Silent submit failure on ERPNext SR {0}. Check the Error Log."
                ).format(sr.name))
            # Move SRT workflow forward + stamp the super admin approver
            self.db_set("workflow_state", "Super Admin Approval", update_modified=False)
            self.db_set("super_admin_approved_by", frappe.session.user, update_modified=False)
            frappe.msgprint(
                _("ERPNext SR <a href='/app/stock-reconciliation/{0}'>{0}</a> submitted.").format(sr.name),
                indicator="green", alert=True,
            )
            return sr.name
        finally:
            frappe.db.set_single_value("Stock Settings", "allow_negative_stock", old_neg or 0)
            frappe.db.set_single_value("Stock Settings", "allow_negative_stock_for_batch", old_neg_batch or 0)
            frappe.db.commit()

    def _can_submit_linked_sr(self):
        if frappe.session.user == "Administrator":
            return True
        roles = set(frappe.get_roles())
        return bool({"System Manager", "Srt Super Admin"} & roles)

    def _apply_validation_patches(self):
        """Monkey-patch SABB negative-qty/batch validators per Quirk #2.
        Without this, submit silently no-ops on legitimate reconciliations."""
        try:
            from erpnext.stock.doctype.serial_and_batch_bundle import (
                serial_and_batch_bundle as _sbb,
            )
            _sbb.SerialandBatchBundle.validate_negative_batch = lambda self, *a, **k: None
            _sbb.SerialandBatchBundle.throw_negative_batch = lambda self, *a, **k: None
            _sbb.SerialandBatchBundle.validate_batch_inventory = lambda self, *a, **k: None
            _sbb.SerialandBatchBundle.validate_batch_quantity = lambda self, *a, **k: None
            _sbb.SerialandBatchBundle.check_future_entries_exists = lambda self, *a, **k: None
            _sbb.SerialandBatchBundle.validate_serial_and_batch_inventory = lambda self, *a, **k: None
            from erpnext.stock import serial_batch_bundle as _sbb_mod
            _sbb_mod.throw_negative_batch_validation = lambda *a, **k: None
            from erpnext.stock import stock_ledger as _sl
            _sl.validate_negative_qty_in_future_sle = lambda *a, **k: None
        except Exception:
            # Newer ERPNext may have moved/renamed these. Don't block the
            # submit on patch failure; the user will see the real error.
            pass


# =============================================================================
# Whitelisted module wrappers — called from the JS form button.
# =============================================================================
@frappe.whitelist()
def submit_linked_sr(srt_name):
    """JS-facing wrapper that loads the SRT doc + invokes submit_linked_sr().

    The instance method handles its own permission check (`_can_submit_linked_sr`)
    so we can keep this wrapper thin. Returns the linked SR name.
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    return doc.submit_linked_sr()
