# =============================================================================
# CONTEXT: "Batch List" — child DocType of Stock Reconciliation SRT.
#   One row per (batch, warehouse) for the parent's item. The 7 visible
#   columns mirror the user's spec exactly; an 8th hidden warehouse field
#   + 2 hidden helper fields (conversion_factor, valuation_rate) are
#   internal plumbing for the ERPNext SR creation on submit.
#
# MEMORY: app_kavach.md § Batch List
#
# INSTRUCTIONS:
#   - This is a thin Frappe Document subclass. ALL recompute logic lives
#     in the parent's JS controller + Python validate, NOT here. Child
#     controllers run AFTER parent.validate() which means any row-level
#     side effects would race the parent's recompute.
#
# RESTRICT:
#   - Do NOT add validate() that mutates `current_stock_in_stock_uom` or
#     `valuation_rate`. Those are set by the parent's autopopulate API
#     and reflect the Bin at the moment the row was added.
#   - Do NOT add a uniqueness constraint here — the parent enforces
#     "no duplicate (batch, warehouse) within one SRT doc" because the
#     constraint depends on parent context.
# =============================================================================

from frappe.model.document import Document


class BatchList(Document):
    pass
