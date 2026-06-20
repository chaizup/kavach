# Auth.gs — Authentication

> **Sync-block v0.0.1** — last verified against `Auth.gs` on 2026-06-12

## Purpose
Handles login, logout, and session validation against the Frappe backend. Session cookie (`sid`) is stored in `UserProperties` (per-Google-user isolation).

## Functions

### `login(email, password)` — Line 19
**Flow:**
1. POST `/api/method/login` with `{ usr, pwd }` → extract `sid` from `Set-Cookie` header
2. GET `/api/method/frappe.auth.get_logged_user` → confirm email
3. GET `/api/resource/User/<email>?fields=["full_name"]` → get display name
4. POST `kavach...srt_dashboard.get_form_meta` → extract `user_roles[]` (SRT-specific roles)
5. Fallback: GET `frappe.client.get_list` on `Has Role` doctype if `get_form_meta` fails
6. Store `{ frappe_sid, frappe_email, frappe_full_name, frappe_roles }` in `UserProperties`

**Returns:** `{ success, email?, fullName?, roles?, error? }`

### `checkSession()` — Line 109
Validates stored `sid` by calling `frappe.auth.get_logged_user`. If `Guest` or error, clears all properties.

**Returns:** `{ loggedIn, email?, fullName?, roles? }`

### `logout()` — Line 133
Calls Frappe `/api/method/logout` (best-effort), then `deleteAllProperties()`.

**Returns:** `{ success: true }`

## Session Storage (UserProperties)

| Key | Value |
|---|---|
| `frappe_sid` | Frappe session cookie value |
| `frappe_email` | Confirmed logged-in email |
| `frappe_full_name` | User's full name |
| `frappe_roles` | JSON array of role strings |

## Security Notes
- `sid` cookie never reaches the browser — stored server-side in Google's per-user property store
- Guest `sid` values are explicitly rejected: `m[1] !== 'Guest'`
- `followRedirects: false` on login POST to capture `Set-Cookie` headers
- `deleteAllProperties()` on logout wipes all session data

## Dependencies
- Calls: `getFrappeUrl()` (Code.gs), `_frappeGet()` / `_frappePost()` (FrappeProxy.gs)
- Called by: `script.html` via `google.script.run.login()`, `.checkSession()`, `.logout()`
