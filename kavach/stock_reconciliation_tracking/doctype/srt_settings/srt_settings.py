# =============================================================================
# CONTEXT: SRT Settings — Single DocType holding cross-cutting settings
# for the kavach module. Currently one field:
# gap_between_stock_reconciliation_days. Future settings will live here
# alongside it.
#
# MEMORY: app_kavach.md
# SPEC:   docs/specs/2026-05-22-srt-settings-gap-design.md
#
# INSTRUCTIONS:
#   - Validation is intentionally minimal — clamp gap_days >= 0. Frappe's
#     `non_negative=1` on the field also covers the UI; this is the
#     server-side belt for API callers.
#   - DO NOT add lifecycle hooks (on_update etc.) unless a new setting
#     genuinely needs them. Cross-cutting Settings docs should stay
#     reactive (read-on-validate) not push-on-save.
#
# RESTRICT:
#   - Do NOT rename `gap_between_stock_reconciliation_days` —
#     stock_reconciliation_srt._enforce_min_gap_between_srts reads it by
#     literal fieldname via frappe.db.get_single_value.
# =============================================================================

import frappe
from frappe import _
from frappe.model.document import Document


class SRTSettings(Document):
    def validate(self):
        if (self.gap_between_stock_reconciliation_days or 0) < 0:
            frappe.throw(_("Gap (days) cannot be negative."))
