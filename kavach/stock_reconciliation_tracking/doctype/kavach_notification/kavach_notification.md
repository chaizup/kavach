# Kavach Notification — DocType

**Module:** Stock Reconciliation Tracking
**Type:** Standard (non-submittable)

---

## 1. Purpose

A typed in-app notification for the Kavach Mobile message center. Three categories:

| Category | Audience | Use case |
|---|---|---|
| `Global` | All users | Company-wide broadcasts |
| `System Dev` | System Managers only | Dev/ops alerts |
| `User` | Targeted user (+ admins for oversight) | Per-user alerts |

## 2. Key Fields

| Field | Type | Purpose |
|---|---|---|
| `title` | Data | Notification headline |
| `message` | Text | Notification body (HTML stripped for mobile display) |
| `category` | Select | Global / System Dev / User |
| `user` | Link → User | Required when category = "User" |
| `severity` | Select | Info / Warning / Error (affects mobile display) |
| `link_document_type` | Link → DocType | Optional deep-link doctype |
| `link_document_name` | Data | Optional deep-link doc name |

## 3. Lifecycle

- `validate()`: throws if `category == "User"` and `user` is empty
- `after_insert` (via hooks.py doc_event): `mobile_api.send_push_on_kavach_notification` pushes to the audience's registered Expo devices

## 4. Read-state model

Kavach Notification is a **shared** record (one row, many readers). Read-state is tracked per-user via the `Kavach Notification Seen` child DocType — a row in that table means "this user has seen this notification". This avoids the N-user fan-out problem of duplicating the notification per user.

## 5. RESTRICT

<!-- RESTRICT: Visibility rules must stay in sync between this DocType and mobile_api. -->
- Visibility rules live in `mobile_api._visible_kavach_notifications` — keep them in sync with the `category` options here (Global / System Dev / User)
- Only System Manager / Administrator can create notifications (enforced in `mobile_api.create_notification`)

## 6. Dependencies

- **mobile_api.py:** `get_messages()`, `create_notification()`, `send_push_on_kavach_notification()`
- **Kavach Notification Seen:** per-user read marker
- **Kavach Push Token:** device tokens for Expo push delivery
- **hooks.py:** `doc_events["Kavach Notification"]["after_insert"]`
