# Kavach Notification Seen — DocType

**Module:** Stock Reconciliation Tracking
**Type:** Standard (non-submittable)

---

## 1. Purpose

Per-user "seen" marker for a Kavach Notification. Since Kavach Notification records are **shared** (one Global notification visible to all users), read-state cannot live on the notification itself. Instead, one `Kavach Notification Seen` row is inserted per (notification, user) tuple when the user marks it as read.

## 2. Key Fields

| Field | Type | Purpose |
|---|---|---|
| `kavach_notification` | Link → Kavach Notification | The notification that was seen |
| `user` | Link → User | The user who saw it |
| `seen_at` | Datetime | Timestamp of the read action |

## 3. How it's used

- **Write:** `mobile_api._mark_kavach_seen(notification, user)` — idempotent insert (checks existence first)
- **Read:** `mobile_api._visible_kavach_notifications()` — subquery `SELECT COUNT(*) FROM tabKavach Notification Seen WHERE ... AND user = %(user)s` to compute the `read` flag per notification

## 4. Controller

Stub — no validation logic. The parent `Kavach Notification` and `mobile_api.py` own all the logic.

## 5. Dependencies

- **Kavach Notification:** the notification being marked as seen
- **mobile_api.py:** `mark_message_read()`, `_mark_kavach_seen()`, `_visible_kavach_notifications()`
