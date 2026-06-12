# Kavach Push Token — DocType

**Module:** Stock Reconciliation Tracking
**Type:** Standard (non-submittable)

---

## 1. Purpose

Stores one Expo push token per (user, device) for the Kavach Mobile app. The mobile app registers its `ExponentPushToken[...]` on login; when a notification is created (Notification Log or Kavach Notification), the `after_insert` hook fans out push messages to the user's registered devices via Expo's push API.

## 2. Key Fields

| Field | Type | Purpose |
|---|---|---|
| `expo_push_token` | Data (unique) | The `ExponentPushToken[...]` string |
| `user` | Link → User | Current owner (updated on re-register) |
| `platform` | Data | iOS / Android (informational) |
| `device_id` | Data | Device identifier (informational) |
| `app_version` | Data | Kavach Mobile version at registration time |
| `enabled` | Check | 1 = active, 0 = soft-disabled (on logout) |
| `last_seen` | Datetime | Last registration/refresh timestamp |

## 3. Lifecycle

- **Register:** `mobile_api.register_push_token()` — idempotent on `expo_push_token`. Re-registering updates the owning user + `last_seen` (shared device follows whoever logged in last).
- **Unregister:** `mobile_api.unregister_push_token()` — soft-disables (`enabled=0`), keeps the row for audit. Owner-scoped.
- **Read:** `mobile_api.send_push_on_notification_log()` and `send_push_on_kavach_notification()` query enabled tokens for the target audience.

## 4. Controller

Stub — no validation logic. Access control is owner-scoped: a user may only see/modify their own tokens.

## 5. RESTRICT

<!-- RESTRICT: Owner-scoped access — a user may only see/modify their own tokens. -->
- Owner-scoped — a user may only see/modify their own tokens
- Token format must start with `ExponentPushToken` (validated in `_send_expo_push`)

## 6. Dependencies

- **mobile_api.py:** all CRUD and push delivery logic
- **hooks.py:** `doc_events` wire the `after_insert` hooks for push delivery
- **Expo push API:** `exp.host/--/api/v2/push/send` — no Firebase credentials needed
