# CONTEXT: One registered Expo push token per (user, device) for Kavach Mobile.
# Written by the app via mobile_api.register_push_token. Read by
# mobile_api._send_expo_push when a Notification Log is created for the user.
# RESTRICT: owner-scoped — a user may only see/modify their own tokens.
import frappe
from frappe.model.document import Document


class KavachPushToken(Document):
	pass
