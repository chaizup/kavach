# CONTEXT: A typed Kavach notification (Global / System Dev / User).
# Created by admins/ops (or programmatically). On insert, mobile_api's
# after_insert hook pushes it to the relevant audience and the Message Center
# surfaces it. Read-state is per-user in "Kavach Notification Seen".
# RESTRICT: visibility rules live in mobile_api.get_messages — keep them in sync
# with the 'category' options here (Global / System Dev / User).
import frappe
from frappe.model.document import Document


class KavachNotification(Document):
	def validate(self):
		if self.category == "User" and not self.user:
			frappe.throw(frappe._("Target User is required when Category is 'User'."))
