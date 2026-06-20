# Code.gs — Entry Point & Configuration

> **Sync-block v0.0.1** — last verified against `Code.gs` on 2026-06-12

## Purpose
Google Apps Script entry point. Serves the web app, provides the HTML `include()` helper, and manages Frappe URL configuration.

## Key Constants & Functions

| Symbol | Line | Description |
|---|---|---|
| `FRAPPE_URL` | 16 | Global constant — set to lock all users to one Frappe site. Empty = per-user URL. |
| `doGet(e)` | 22 | GAS entry point. Creates `HtmlTemplate` from `index.html`, sets title/viewport/XFrame. |
| `include(filename)` | 38 | Template helper for `<?!= include('styles') ?>` pattern. Returns raw HTML content. |
| `getFrappeUrl()` | 47 | Priority chain: `FRAPPE_URL` constant → per-user `UserProperties.frappe_url` → script property `FRAPPE_URL` → empty string. |
| `isUrlLocked()` | 60 | Returns `true` if URL is set via constant or script property (hides URL field on login). |

## URL Resolution Priority
```
1. FRAPPE_URL constant (Code.gs)        ← highest
2. UserProperties('frappe_url')         ← set during loginWithUrl()
3. ScriptProperties('FRAPPE_URL')       ← set via GAS project settings
4. '' (empty — login page prompts user) ← fallback
```

## Configuration Notes
- All trailing slashes are stripped via `.replace(/\/+$/, '')`
- `doGet` uses `HtmlService.XFrameOptionsMode.ALLOWALL` for iframe embedding
- Meta viewport set to prevent zoom: `maximum-scale=1, user-scalable=no`

## Dependencies
- Called by: `Auth.gs` (`login()` calls `getFrappeUrl()`), `FrappeProxy.gs` (`_getUserFrappeUrl()` calls `getFrappeUrl()`)
- Calls: `HtmlService` (GAS built-in)
