# mobile_api.py — Kavach Mobile backend bridge

Backend touchpoints for the **Kavach Mobile** Expo app
(`apps/Kavach Mobile`). Everything the mobile app needs that isn't already in
`api.py` / `srt_dashboard.py` / the SRT controller lives here. Added 2026-06-09.

## Why this exists
A mobile client needs three things a desk SPA gets for free: a way to **log in**
(OAuth2), a **public bootstrap** so it can render a login card from just a site
URL, and **mobile-shaped read endpoints** (stock reports, a notification feed,
push). The SRT counting + approval workflow is already API-backed, so the app
reuses those endpoints directly.

## Endpoints

| Function | Auth | Purpose |
|---|---|---|
| `get_app_config()` | **guest** | Public bootstrap: OAuth `client_id`, sitename, app name, logo, versions. Self-heals the OAuth Client. |
| `ensure_oauth_client()` | login | Idempotent **OAuth Client** "Kavach Mobile" (Auth Code + PKCE, scopes `all openid`, redirect `kavachmobile://`, `allowed_roles` = the Srt roles + System Manager). |
| `get_item_stock_report(search, item_group, warehouse, limit)` | login | Item-wise current stock from `tabBin`. |
| `get_batch_stock_report(item_code, warehouse, search, limit)` | login | Batch-wise current stock from SLE → Serial and Batch Entry. |
| `get_item_group_stock_report(warehouse)` | login | Item-group value rollup + % of total. |
| `get_report_filters()` | login | Warehouses + item groups for filter dropdowns. |
| `get_me()` | login | user, full name, kavach roles, `is_admin` (for admin gating). |
| `get_messages(limit, unread_only, category)` | login | Merged feed: Kavach Notification (3 categories) + Notification Log. |
| `get_unread_message_count()` | login | Badge count across both sources. |
| `mark_message_read(name, source, all)` | login | Flip Notification Log `read` / insert a Seen marker. |
| `create_notification(title, message, category, user, severity)` | **System Manager** | Compose a typed notification (Global / System Dev / User). |
| `register_push_token / unregister_push_token` | login | Per-device Expo push token (DocType **Kavach Push Token**). |

## Notification model (3 categories)
DocTypes: **Kavach Notification** (`category ∈ Global | System Dev | User`) and
**Kavach Notification Seen** (per-user read marker). Visibility:

- regular user → Global + own User + own Notification Log
- System Manager / Administrator → all of that **+ System Dev + all User-category**

## Push
`hooks.py doc_events`:
- `Notification Log.after_insert` → `send_push_on_notification_log` (push to the
  for_user's devices).
- `Kavach Notification.after_insert` → `send_push_on_kavach_notification`
  (audience by category: Global=all, System Dev=admins, User=that user).

Delivery is via **Expo's push API** (`exp.host`) — no Firebase credentials in
Frappe; Expo fans out to FCM/APNs. Best-effort; failures are logged, never raised.

## DANGER / RESTRICT
- `get_app_config` is the only `allow_guest` endpoint — never add secrets to it.
- The redirect scheme `kavachmobile://` must stay in sync with the Expo app's
  `app.json` scheme and `lib/auth.ts` REDIRECT_URI.
- Stock report queries are read-only; keep them that way.
- Bin = current qty source of truth; batch balances come from SLE, never
  `Batch.batch_qty`.
