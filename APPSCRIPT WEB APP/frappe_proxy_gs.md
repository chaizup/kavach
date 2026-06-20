# FrappeProxy.gs — Frappe API Proxy

> **Sync-block v0.0.2** — last verified against `FrappeProxy.gs` on 2026-06-12

## Purpose
All Frappe API calls routed through the stored `sid` cookie. Client JS calls these via `google.script.run.<functionName>()`.

## Internal Helpers

| Function | Line | Description |
|---|---|---|
| `_getSid()` | 23 | Reads `frappe_sid` from `UserProperties`. Throws `SESSION_EXPIRED` if missing. |
| `_getUserFrappeUrl()` | 29 | Delegates to `getFrappeUrl()` in Code.gs. |
| `_frappeGet(path, params, sid)` | 33 | GET request with `Cookie: sid=<sid>`. URL-encodes params. Throws `SESSION_EXPIRED` on 401/403. |
| `_frappePost(path, data, sid)` | 53 | POST request with JSON body. Fetches CSRF token first via `frappe.auth.get_csrf_token`. Parses `_server_messages` on error. |

## Login (with URL)

| Function | Line | Description |
|---|---|---|
| `loginWithUrl(frappeUrl, email, password)` | 111 | Alternative login that accepts user-provided Frappe URL. Normalizes URL, stores in `UserProperties`, extracts sid, fetches user info + roles. |

## Dashboard Endpoints

| Function | Line | Frappe Method | Description |
|---|---|---|---|
| `getDashboardRows(tab, itemFilter)` | 188 | `srt_dashboard.get_dashboard_rows` | Rows for Admin/Super Admin tabs |
| `getDashboardCounts()` | 194 | `srt_dashboard.get_dashboard_counts` | Badge counts per tab |
| `getBatchSummary(srtName)` | 198 | `srt_dashboard.get_batch_summary` | Enriched batch data for view modal |
| `getBatchDrilldown(...)` | 203 | `srt_dashboard.get_batch_drilldown` | Batch transaction drilldown |

## Form CRUD

| Function | Line | Frappe Method | Description |
|---|---|---|---|
| `getFormMeta()` | 215 | `srt_dashboard.get_form_meta` | Roles, defaults, field options |
| `loadSrtForm(name)` | 219 | `srt_dashboard.load_srt_form` | Load Draft SRT for editing (rejects non-Draft) |
| `getSrtDoc(name)` | 229 | `frappe.client.get` | Read-only fetch of any SRT (any docstatus) — used by View modal |
| `saveSrtForm(payload, name)` | 237 | `srt_dashboard.save_srt_form` | Create or update Draft SRT |
| `submitSrtForm(name)` | 243 | `srt_dashboard.submit_srt_form` | Submit Draft → triggers workflow |

## Workflow Actions

| Function | Line | Frappe Method | Description |
|---|---|---|---|
| `approveSrt(srtName, remark)` | 253 | `srt_dashboard.approve_srt` | Approve (Admin or Super Admin) |
| `rejectSrt(srtName, reason)` | 259 | `srt_dashboard.reject_srt` | Reject with reason |
| `bulkApproveSrt(srtNames, bulkRemark)` | 264 | `srt_dashboard.bulk_approve_srt` | Batch approve multiple SRTs |
| `bulkRejectSrt(srtNames, reason)` | 272 | Loop of `reject_srt` per name | Bulk reject — no backend bulk endpoint exists, so GAS loops per name |

## Pre-Loaded Master Data (CacheService)

Server-side cached lists for instant client-side search. Uses `CacheService.getScriptCache()` shared across users with 1hr TTL (`CACHE_TTL = 3600`).

| Function | Line | Cache Key | Description |
|---|---|---|---|
| `getAllItems()` | 297 | `srt_all_items` | All batch-tracked items (`has_batch_no=1, disabled=0`). Fields: `name, item_name`. `limit_page_length: 0` (all records). |
| `getAllWarehouses()` | 317 | `srt_all_warehouses` | All non-group warehouses (`is_group=0`). Fields: `name`. |
| `getAllBatchesForItem(itemCode)` | 338 | `srt_batches_<itemCode>` | All non-disabled batches for an item. Fields: `name, item, expiry_date`. Per-item cache. |

### Cache Pattern
```javascript
const cache = CacheService.getScriptCache();
const cached = cache.get(cacheKey);
if (cached) return JSON.parse(cached);

// Fetch from Frappe
const result = _frappePost('/api/method/frappe.client.get_list', { ... });
cache.put(cacheKey, JSON.stringify(result.message), CACHE_TTL);
return result.message;
```

## Item Defaults & Batch State

| Function | Line | Frappe Method | Description |
|---|---|---|---|
| `getItemDefaults(itemCode, warehouse, postingDate, postingTime)` | 356 | `kavach...api.get_item_defaults` | Item UOM, batches with positive stock, conversion factor |
| `getBatchCurrentState(itemCode, batchNo, postingDate, postingTime)` | 394 | `kavach...api.get_batch_current_state` | Returns `{qty, warehouse, valuation_rate, stock_uom}` for a single batch at posting date/time. Returns qty=0 for 0-stock batches. |

## Legacy Search Functions

Kept for backward compatibility — client now searches locally from pre-loaded data.

| Function | Line | Description |
|---|---|---|
| `searchItems(txt)` | 365 | Items with `has_batch_no=1`, `or_filters` on name/item_name. Limit 20. Server fallback if pre-load fails. |
| `searchWarehouses(txt)` | 380 | Non-group warehouses, `or_filters` on name. Limit 20. Server fallback. |

## History

| Function | Line | Frappe Method | Description |
|---|---|---|---|
| `getSrtHistory(pageLength, start)` | 406 | `frappe.client.get_list` (POST) | User's own SRTs, ordered by creation desc |
| `getAllSrtHistory(pageLength, start)` | 419 | `frappe.client.get_list` (POST) | All SRTs (for admin/super admin view) |

## Important Notes
- Search functions use `POST /api/method/frappe.client.get_list` (not `GET /api/resource/`) because Frappe's REST endpoint unreliably handles `or_filters` as URL parameters
- `getSrtDoc` uses `frappe.client.get` for read-only access — no docstatus restriction (unlike `loadSrtForm`)
- CSRF token is fetched before every POST request via `frappe.auth.get_csrf_token`
- `_server_messages` are double-JSON-encoded by Frappe: `JSON.parse(body._server_messages)` → array of JSON strings → each parsed for `.message`
- `bulkRejectSrt` is GAS-side loop (not a single Frappe endpoint) — returns array of `{name, ok, error}` per SRT
- Cache is shared across all users (`getScriptCache`), 1hr TTL. First user to request after cache expiry pays the Frappe round-trip.

## Dependencies
- Calls: `getFrappeUrl()` (Code.gs), `UrlFetchApp` (GAS built-in), `CacheService` (GAS built-in)
- Called by: `script.html` via `google.script.run`, `Auth.gs` (login helpers)
