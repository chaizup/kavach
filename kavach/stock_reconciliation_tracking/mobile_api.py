# =============================================================================
# CONTEXT: Kavach Mobile — backend bridge for the React Native (Expo) app.
#
#   The Kavach Mobile app (apps/Kavach Mobile) is an Expo client that talks to
#   THIS Frappe site over HTTP using an OAuth2 Bearer token. Because Frappe
#   resolves that token to a real User (frappe/auth.py validate_oauth ->
#   frappe.set_user), the mobile user has EXACTLY the same roles + DocType
#   permissions they have on the Desk. This module adds only:
#     1. get_app_config()      — guest-allowed bootstrap (client_id, logo, …)
#     2. ensure_oauth_client() — idempotent OAuth Client for "Kavach Mobile"
#     3. three read-only stock report endpoints used by the mobile Reports tab:
#          - get_item_stock_report        (item-wise current stock)
#          - get_batch_stock_report       (batch-wise current stock)
#          - get_item_group_stock_report  (item-group-wise rollup)
#     4. message-center + push endpoints (Notification Log feed + Expo push).
#
#   The full SRT counting + approval workflow is already API-backed by
#   api.py (get_item_defaults, …) + page/srt_dashboard/srt_dashboard.py
#   (get_dashboard_rows, approve_srt, reject_srt, save_srt_form, …) +
#   the controller's submit_linked_sr(). The mobile app calls those directly.
#
# MEMORY:
#   - [[frappe_react_native_mobile_auth]] — the Raven OAuth2/PKCE pattern
#   - app_kavach.md (app root), srt_dashboard.md (dashboard endpoints)
#
# INSTRUCTIONS:
#   - get_app_config is the ONLY allow_guest endpoint here — it must never
#     return anything sensitive (client_id is public by design; PKCE protects
#     the flow). Everything else requires a resolved user.
#   - Stock report queries are READ-ONLY. They never write. Keep them that way.
#   - Bin is the source of truth for "current" qty; batch balances come from
#     SLE -> Serial and Batch Entry (Batch.batch_qty can drift — never read it).
#
# DANGER ZONE:
#   - Do NOT widen get_app_config's payload with secrets (API keys, tokens).
#   - Do NOT change the OAuth Client redirect_uris without also updating the
#     Expo app's scheme (app.json "scheme") + makeRedirectUri native value —
#     a mismatch makes the login fail at the authorize step with an opaque error.
#
# RESTRICT:
#   - redirect scheme is "kavachmobile://". Keep it in sync across:
#     this file (ensure_oauth_client) <-> apps/Kavach Mobile/app.json (scheme)
#     <-> apps/Kavach Mobile/lib/auth.ts (REDIRECT_URI).
# =============================================================================

import frappe
from frappe import _
from frappe.utils import flt
from frappe.utils.change_log import get_versions

# The custom URL scheme the Expo app registers. MUST equal the OAuth Client
# redirect_uris and the app's makeRedirectUri({ native }) value.
KAVACH_MOBILE_SCHEME = "kavachmobile://"
KAVACH_MOBILE_OAUTH_APP_NAME = "Kavach Mobile"


# -----------------------------------------------------------------------------
# 1. Bootstrap — guest-allowed. The app fetches this BEFORE login to render the
#    login card (logo + app name) and to obtain the public OAuth client_id.
# -----------------------------------------------------------------------------
@frappe.whitelist(allow_guest=True)
def get_app_config():
	"""Public bootstrap payload for the Kavach Mobile app.

	Returns the OAuth client_id (public), the sitename, a display name, the
	logo URL, and version strings. Models on raven.api.raven_mobile.get_client_id.

	Self-heals: if no OAuth Client exists yet, creates one so a fresh site is
	immediately loginable from mobile.
	"""
	client_id = _get_or_create_oauth_client_id()

	versions = {k: v.get("version") for k, v in get_versions().items()}

	return {
		"client_id": client_id,
		"sitename": frappe.local.site,
		"app_name": "Kavach",
		"app_subtitle": "Stock Reconciliation Tracking",
		"logo": "/assets/kavach/images/kavach-logo.svg",
		"system_timezone": frappe.get_system_settings("time_zone"),
		"kavach_version": versions.get("kavach"),
		"frappe_version": versions.get("frappe"),
		"erpnext_version": versions.get("erpnext"),
	}


# -----------------------------------------------------------------------------
# 2. OAuth Client — idempotent. Called from get_app_config (self-heal) and can
#    be run manually: bench --site <site> execute
#    kavach.stock_reconciliation_tracking.mobile_api.ensure_oauth_client
# -----------------------------------------------------------------------------
def _get_or_create_oauth_client_id():
	existing = frappe.db.get_value(
		"OAuth Client", {"app_name": KAVACH_MOBILE_OAUTH_APP_NAME}, "name"
	)
	if existing:
		return existing
	return ensure_oauth_client()


@frappe.whitelist()
def ensure_oauth_client():
	"""Create (or update) the 'Kavach Mobile' OAuth Client. Idempotent.

	- grant_type / response_type = Authorization Code / Code  (PKCE flow)
	- scopes = "all openid"
	- redirect_uris = KAVACH_MOBILE_SCHEME  (the Expo custom scheme)
	- allowed_roles gate WHO may obtain a mobile token (the kavach roles).
	"""
	name = frappe.db.get_value(
		"OAuth Client", {"app_name": KAVACH_MOBILE_OAUTH_APP_NAME}, "name"
	)
	client = (
		frappe.get_doc("OAuth Client", name)
		if name
		else frappe.new_doc("OAuth Client")
	)
	client.app_name = KAVACH_MOBILE_OAUTH_APP_NAME
	client.scopes = "all openid"
	client.redirect_uris = KAVACH_MOBILE_SCHEME
	client.default_redirect_uri = KAVACH_MOBILE_SCHEME
	client.grant_type = "Authorization Code"
	client.response_type = "Code"
	client.skip_authorization = 1  # already gated by allowed_roles; smoother UX

	client.set("allowed_roles", [])
	for role in ("Srt User", "Srt Admin", "Srt Super Admin", "System Manager"):
		if frappe.db.exists("Role", role):
			client.append("allowed_roles", {"role": role})

	client.flags.ignore_permissions = True
	client.save(ignore_permissions=True)
	frappe.db.commit()
	return client.name


# -----------------------------------------------------------------------------
# 3. Read-only stock reports (Reports tab).
#    All three respect the requesting user's identity (they run as the OAuth
#    user). They are intentionally read-only and never mutate state.
# -----------------------------------------------------------------------------
def _require_login():
	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required."), frappe.PermissionError)


@frappe.whitelist()
def get_item_stock_report(search=None, item_group=None, warehouse=None, limit=200):
	"""Item-wise CURRENT stock from `tabBin` (the live ledger snapshot).

	Aggregates actual_qty + projected_qty + stock_value per item across
	warehouses (or scoped to one warehouse). Optional substring search on
	item_code/item_name and an item_group filter.

	Returns a list of dicts the mobile Reports tab renders as cards/rows.
	"""
	_require_login()
	limit = int(limit or 200)

	conditions = ["b.actual_qty != 0"]
	params = {}
	if warehouse:
		conditions.append("b.warehouse = %(warehouse)s")
		params["warehouse"] = warehouse
	if item_group:
		conditions.append("it.item_group = %(item_group)s")
		params["item_group"] = item_group
	if search:
		conditions.append("(b.item_code LIKE %(search)s OR it.item_name LIKE %(search)s)")
		params["search"] = f"%{search}%"
	params["limit"] = limit

	where = " AND ".join(conditions)
	rows = frappe.db.sql(
		f"""
		SELECT
			b.item_code                       AS item_code,
			it.item_name                      AS item_name,
			it.item_group                     AS item_group,
			it.stock_uom                      AS stock_uom,
			SUM(b.actual_qty)                 AS actual_qty,
			SUM(b.projected_qty)              AS projected_qty,
			SUM(b.reserved_qty)               AS reserved_qty,
			SUM(b.stock_value)                AS stock_value,
			COUNT(DISTINCT b.warehouse)       AS warehouse_count
		FROM `tabBin` b
		INNER JOIN `tabItem` it ON it.name = b.item_code
		WHERE {where}
		GROUP BY b.item_code
		HAVING SUM(b.actual_qty) != 0
		ORDER BY SUM(b.stock_value) DESC
		LIMIT %(limit)s
		""",
		params,
		as_dict=True,
	)
	for r in rows:
		r["actual_qty"] = flt(r["actual_qty"], 3)
		r["projected_qty"] = flt(r["projected_qty"], 3)
		r["reserved_qty"] = flt(r["reserved_qty"], 3)
		r["stock_value"] = flt(r["stock_value"], 2)
	return rows


@frappe.whitelist()
def get_batch_stock_report(item_code=None, warehouse=None, search=None, limit=300):
	"""Batch-wise CURRENT stock.

	Built from Stock Ledger Entry -> Serial and Batch Entry (NOT Batch.batch_qty,
	which is a materialized value that can drift). One row per
	(batch, item, warehouse) with positive balance.

	`item_code` strongly recommended (a site can have 100k+ batches); without
	it the result is capped by `limit` and ordered by qty desc.
	"""
	_require_login()
	limit = int(limit or 300)

	conditions = [
		"sle.is_cancelled = 0",
		"sbe.batch_no IS NOT NULL",
		"sbe.batch_no != ''",
	]
	params = {}
	if item_code:
		conditions.append("sle.item_code = %(item_code)s")
		params["item_code"] = item_code
	if warehouse:
		conditions.append("sle.warehouse = %(warehouse)s")
		params["warehouse"] = warehouse
	if search:
		conditions.append("(sbe.batch_no LIKE %(search)s OR sle.item_code LIKE %(search)s)")
		params["search"] = f"%{search}%"
	params["limit"] = limit

	where = " AND ".join(conditions)
	rows = frappe.db.sql(
		f"""
		SELECT
			sbe.batch_no              AS batch_no,
			sle.item_code             AS item_code,
			sle.warehouse             AS warehouse,
			SUM(sbe.qty)              AS qty,
			MAX(sle.valuation_rate)   AS valuation_rate
		FROM `tabStock Ledger Entry` sle
		JOIN `tabSerial and Batch Entry` sbe
			ON sbe.parent = sle.serial_and_batch_bundle
		WHERE {where}
		GROUP BY sbe.batch_no, sle.item_code, sle.warehouse
		HAVING SUM(sbe.qty) > 0.001
		ORDER BY SUM(sbe.qty) DESC
		LIMIT %(limit)s
		""",
		params,
		as_dict=True,
	)
	# Decorate with item meta (stock_uom + item_name) in one round-trip.
	item_codes = list({r["item_code"] for r in rows})
	meta = {}
	if item_codes:
		for m in frappe.db.get_all(
			"Item",
			filters={"name": ["in", item_codes]},
			fields=["name", "item_name", "stock_uom"],
		):
			meta[m["name"]] = m
	for r in rows:
		r["qty"] = flt(r["qty"], 3)
		r["valuation_rate"] = flt(r["valuation_rate"], 4)
		r["stock_value"] = flt(r["qty"] * r["valuation_rate"], 2)
		m = meta.get(r["item_code"], {})
		r["item_name"] = m.get("item_name")
		r["stock_uom"] = m.get("stock_uom")
	return rows


@frappe.whitelist()
def get_item_group_stock_report(warehouse=None):
	"""Item-group-wise rollup of current stock value + qty.

	Aggregates `tabBin` joined to `tabItem.item_group`. Returns one row per
	item group with total stock value, distinct item count, and a percent of
	the grand total (handy for a mobile bar/percentage UI).
	"""
	_require_login()

	conditions = ["b.actual_qty != 0"]
	params = {}
	if warehouse:
		conditions.append("b.warehouse = %(warehouse)s")
		params["warehouse"] = warehouse
	where = " AND ".join(conditions)

	rows = frappe.db.sql(
		f"""
		SELECT
			it.item_group                  AS item_group,
			COUNT(DISTINCT b.item_code)    AS item_count,
			SUM(b.actual_qty)              AS total_qty,
			SUM(b.stock_value)             AS stock_value
		FROM `tabBin` b
		INNER JOIN `tabItem` it ON it.name = b.item_code
		WHERE {where}
		GROUP BY it.item_group
		HAVING SUM(b.stock_value) != 0
		ORDER BY SUM(b.stock_value) DESC
		""",
		params,
		as_dict=True,
	)
	grand_total = sum(flt(r["stock_value"]) for r in rows) or 1.0
	for r in rows:
		r["total_qty"] = flt(r["total_qty"], 3)
		r["stock_value"] = flt(r["stock_value"], 2)
		r["pct_of_total"] = flt(r["stock_value"] / grand_total * 100, 1)
	return rows


# -----------------------------------------------------------------------------
# 4. Message Center + Push Notifications.
#
#    The mobile "Messages" tab reads the user's Frappe `Notification Log` rows
#    (the same feed the Desk bell shows) so every warning/notification the
#    system records is visible on the phone. Push delivery is layered on top:
#    the app registers an Expo push token; a Notification Log doc_event hook
#    (see hooks.py + send_push_on_notification_log) fans the message out to the
#    user's registered devices through Expo's push service.
#
#    Why Notification Log (not a custom feed): it is the canonical Frappe
#    notification store. Assignments, mentions, workflow alerts, and any
#    frappe.publish_realtime/Notification all land there already — reusing it
#    means the mobile message center stays in sync with the Desk for free.
# -----------------------------------------------------------------------------
@frappe.whitelist()
def register_push_token(expo_push_token, platform=None, device_id=None, app_version=None):
	"""Register (or refresh) this device's Expo push token for the current user.

	Idempotent on expo_push_token (unique). Re-registering updates the owning
	user + last_seen so a shared device follows whoever logged in last.
	"""
	_require_login()
	if not expo_push_token:
		frappe.throw(_("expo_push_token is required"))

	name = frappe.db.get_value("Kavach Push Token", {"expo_push_token": expo_push_token}, "name")
	if name:
		doc = frappe.get_doc("Kavach Push Token", name)
	else:
		doc = frappe.new_doc("Kavach Push Token")
		doc.expo_push_token = expo_push_token

	doc.user = frappe.session.user
	doc.platform = platform
	doc.device_id = device_id
	doc.app_version = app_version
	doc.enabled = 1
	doc.last_seen = frappe.utils.now_datetime()
	doc.flags.ignore_permissions = True
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "name": doc.name}


@frappe.whitelist()
def unregister_push_token(expo_push_token):
	"""Disable a device token (called on logout). Soft-disables; keeps the row
	for audit. Owner-scoped."""
	_require_login()
	name = frappe.db.get_value(
		"Kavach Push Token",
		{"expo_push_token": expo_push_token, "user": frappe.session.user},
		"name",
	)
	if name:
		frappe.db.set_value("Kavach Push Token", name, "enabled", 0)
		frappe.db.commit()
	return {"ok": True}


# --- THREE notification categories + Frappe Notification Log -----------------
#
# The Message Center shows a single merged feed from TWO sources:
#   source="kavach" → Kavach Notification, with 3 categories:
#       - "Global"     : visible to EVERYONE
#       - "System Dev" : visible to System Managers only (dev/ops broadcasts)
#       - "User"       : visible to the targeted user (and to admins for oversight)
#   source="log"    → the user's own Frappe Notification Log (assignments,
#                     workflow alerts, warnings) — always user-scoped.
#
# Visibility rule (get_messages): a System Manager / Administrator sees Global +
# System Dev + every User-category notification. A regular user sees Global +
# their own User-category notifications + their own Notification Log.
#
# Read-state: Notification Log has its own `read` flag; Kavach Notification
# (shared rows) uses the per-user "Kavach Notification Seen" marker.

def _is_admin():
	if frappe.session.user == "Administrator":
		return True
	return "System Manager" in set(frappe.get_roles())


def _visible_kavach_notifications(user, is_admin, limit):
	"""Kavach Notification rows visible to `user`, newest first, each decorated
	with read = (a Seen marker exists)."""
	if is_admin:
		# Global + System Dev + all User-category.
		cond = "1=1"
		params = {"limit": limit}
	else:
		cond = "(kn.category = 'Global' OR (kn.category = 'User' AND kn.user = %(user)s))"
		params = {"user": user, "limit": limit}

	rows = frappe.db.sql(
		f"""
		SELECT
			kn.name, kn.title, kn.message, kn.category, kn.severity,
			kn.link_document_type, kn.link_document_name, kn.owner AS from_user,
			kn.creation,
			(SELECT COUNT(*) FROM `tabKavach Notification Seen` s
			   WHERE s.kavach_notification = kn.name AND s.user = %(seen_user)s) AS seen
		FROM `tabKavach Notification` kn
		WHERE {cond}
		ORDER BY kn.creation DESC
		LIMIT %(limit)s
		""",
		{**params, "seen_user": user},
		as_dict=True,
	)
	out = []
	for r in rows:
		out.append({
			"source": "kavach",
			"name": r["name"],
			"subject": r["title"],
			"message": frappe.utils.strip_html(r.get("message") or ""),
			"category": r["category"],
			"severity": r["severity"] or "Info",
			"type": r["severity"] or "Info",
			"document_type": r.get("link_document_type"),
			"document_name": r.get("link_document_name"),
			"read": 1 if r["seen"] else 0,
			"creation": r["creation"],
			"from_user": r.get("from_user"),
		})
	return out


@frappe.whitelist()
def get_messages(limit=50, unread_only=0, category=None):
	"""Merged Message Center feed (Kavach Notification + Notification Log).

	`category` optionally filters to one of: Global / System Dev / User / System
	(System = the Frappe Notification Log items). Empty => all visible.
	"""
	_require_login()
	limit = int(limit or 50)
	user = frappe.session.user
	is_admin = _is_admin()

	feed = []

	# 1. Typed Kavach notifications (3 categories).
	if category in (None, "", "Global", "System Dev", "User"):
		feed += _visible_kavach_notifications(user, is_admin, limit)
		if category in ("Global", "System Dev", "User"):
			feed = [m for m in feed if m["category"] == category]

	# 2. Frappe Notification Log (the user's own system feed) -> "System" bucket.
	if category in (None, "", "System"):
		log_rows = frappe.db.get_all(
			"Notification Log",
			filters={"for_user": user},
			fields=[
				"name", "subject", "email_content", "type", "document_type",
				"document_name", "read", "creation", "from_user",
			],
			order_by="creation desc",
			limit=limit,
		)
		for r in log_rows:
			feed.append({
				"source": "log",
				"name": r["name"],
				"subject": frappe.utils.strip_html(r.get("subject") or ""),
				"message": frappe.utils.strip_html(r.get("email_content") or ""),
				"category": "System",
				"severity": r.get("type") or "Alert",
				"type": r.get("type") or "Alert",
				"document_type": r.get("document_type"),
				"document_name": r.get("document_name"),
				"read": r.get("read") or 0,
				"creation": r["creation"],
				"from_user": r.get("from_user"),
			})

	if int(unread_only or 0):
		feed = [m for m in feed if not m["read"]]

	feed.sort(key=lambda m: str(m["creation"]), reverse=True)
	return feed[:limit]


@frappe.whitelist()
def get_unread_message_count():
	"""Total unread across both sources for the Messages tab badge."""
	_require_login()
	user = frappe.session.user
	is_admin = _is_admin()

	log_unread = frappe.db.count("Notification Log", {"for_user": user, "read": 0})

	visible = _visible_kavach_notifications(user, is_admin, 500)
	kavach_unread = sum(1 for m in visible if not m["read"])
	return log_unread + kavach_unread


@frappe.whitelist()
def mark_message_read(name=None, source="log", all=0):
	"""Mark read. For source='log' flips Notification Log.read; for
	source='kavach' inserts a per-user Seen marker. all=1 marks everything
	currently visible to the user as read."""
	_require_login()
	user = frappe.session.user

	if int(all or 0):
		frappe.db.sql(
			"UPDATE `tabNotification Log` SET `read` = 1 WHERE for_user = %s AND `read` = 0",
			user,
		)
		for m in _visible_kavach_notifications(user, _is_admin(), 500):
			if not m["read"]:
				_mark_kavach_seen(m["name"], user)
		frappe.db.commit()
		return {"ok": True}

	if not name:
		return {"ok": False}

	if source == "kavach":
		_mark_kavach_seen(name, user)
	else:
		owner = frappe.db.get_value("Notification Log", name, "for_user")
		if owner != user and not _is_admin():
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		frappe.db.set_value("Notification Log", name, "read", 1)
	frappe.db.commit()
	return {"ok": True}


def _mark_kavach_seen(notification, user):
	if frappe.db.exists("Kavach Notification Seen", {"kavach_notification": notification, "user": user}):
		return
	doc = frappe.new_doc("Kavach Notification Seen")
	doc.kavach_notification = notification
	doc.user = user
	doc.seen_at = frappe.utils.now_datetime()
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)


@frappe.whitelist()
def create_notification(title, message=None, category="Global", user=None, severity="Info"):
	"""Compose a typed notification. Restricted to System Manager / Administrator
	(the in-app compose screen is an admin tool). Global + System Dev broadcast;
	User targets one user. The after_insert hook pushes it to the audience."""
	_require_login()
	if not _is_admin():
		frappe.throw(_("Only System Managers can post notifications."), frappe.PermissionError)
	if category == "User" and not user:
		frappe.throw(_("Target user is required for a User notification."))

	doc = frappe.new_doc("Kavach Notification")
	doc.title = title
	doc.message = message
	doc.category = category
	doc.severity = severity
	if category == "User":
		doc.user = user
	doc.flags.ignore_permissions = True
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True, "name": doc.name}


def send_push_on_notification_log(doc, method=None):
	"""doc_event hook (Notification Log after_insert): push to the user's
	registered Expo devices. Best-effort — never block the notification on a
	push failure.

	Wired in hooks.py:
		doc_events = {"Notification Log": {"after_insert":
			"kavach.stock_reconciliation_tracking.mobile_api.send_push_on_notification_log"}}
	"""
	try:
		if not doc.for_user:
			return
		tokens = frappe.db.get_all(
			"Kavach Push Token",
			filters={"user": doc.for_user, "enabled": 1},
			pluck="expo_push_token",
		)
		if not tokens:
			return
		title = "Kavach"
		body = frappe.utils.strip_html(doc.subject or "Notification")
		_send_expo_push(
			tokens,
			title,
			body,
			data={
				"document_type": doc.document_type,
				"document_name": doc.document_name,
				"notification_log": doc.name,
			},
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Kavach push send failed")


def send_push_on_kavach_notification(doc, method=None):
	"""doc_event hook (Kavach Notification after_insert): push to the category's
	audience.
	  - Global     → every enabled device
	  - System Dev → devices of System Managers
	  - User       → that user's devices
	Best-effort; failures are logged, never raised.

	Wired in hooks.py doc_events["Kavach Notification"]["after_insert"].
	"""
	try:
		if doc.category == "User":
			users = [doc.user] if doc.user else []
		elif doc.category == "System Dev":
			users = _system_manager_users()
		else:  # Global
			users = None  # all

		filters = {"enabled": 1}
		if users is not None:
			if not users:
				return
			filters["user"] = ["in", users]
		tokens = frappe.db.get_all("Kavach Push Token", filters=filters, pluck="expo_push_token")
		if not tokens:
			return
		_send_expo_push(
			tokens,
			f"Kavach · {doc.category}",
			f"{doc.title}",
			data={"kavach_notification": doc.name, "category": doc.category},
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Kavach notification push failed")


def _system_manager_users():
	"""Enabled users holding the System Manager role."""
	return [
		r["parent"]
		for r in frappe.db.get_all(
			"Has Role",
			filters={"role": "System Manager", "parenttype": "User"},
			fields=["parent"],
		)
		if frappe.db.get_value("User", r["parent"], "enabled")
	]


def _send_expo_push(tokens, title, body, data=None):
	"""POST to Expo's push API. Expo handles APNs/FCM fan-out, so we don't need
	platform credentials in Frappe — only the device's ExponentPushToken.
	Docs: https://docs.expo.dev/push-notifications/sending-notifications/
	"""
	import json
	import requests

	messages = [
		{
			"to": t,
			"title": title,
			"body": body,
			"sound": "default",
			"data": data or {},
			"channelId": "default",
		}
		for t in tokens
		if t and t.startswith("ExponentPushToken")
	]
	if not messages:
		return
	requests.post(
		"https://exp.host/--/api/v2/push/send",
		data=json.dumps(messages),
		headers={"Content-Type": "application/json", "Accept": "application/json"},
		timeout=10,
	)


@frappe.whitelist()
def get_me():
	"""Identity + capability payload for the Profile screen + admin gating.
	Returns the user, full name, avatar, kavach roles, and is_admin (System
	Manager) so the app can show/hide the notification composer."""
	_require_login()
	user = frappe.session.user
	roles = set(frappe.get_roles())
	u = frappe.db.get_value(
		"User", user, ["full_name", "user_image", "email"], as_dict=True
	) or {}
	kavach_roles = [r for r in ("Srt User", "Srt Admin", "Srt Super Admin") if r in roles]
	return {
		"user": user,
		"full_name": u.get("full_name") or user,
		"email": u.get("email") or user,
		"user_image": u.get("user_image"),
		"roles": kavach_roles,
		"is_admin": _is_admin(),
	}


@frappe.whitelist()
def get_report_filters():
	"""Helper: distinct warehouses + item groups for the Reports tab filter
	dropdowns. Cheap, read-only."""
	_require_login()
	warehouses = [
		w["name"]
		for w in frappe.db.get_all(
			"Warehouse", filters={"is_group": 0, "disabled": 0}, fields=["name"], order_by="name"
		)
	]
	item_groups = [
		g["name"]
		for g in frappe.db.get_all(
			"Item Group", filters={"is_group": 0}, fields=["name"], order_by="name"
		)
	]
	return {"warehouses": warehouses, "item_groups": item_groups}
