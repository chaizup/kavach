# Desktop Icon — Kavach

## Overview
This folder contains the Desktop Icon JSON fixture for the Kavach app. The Desktop Icon registers Kavach as a top-level "App" tile in Frappe's desktop/apps screen.

## File

| File | Desktop Icon Type | Label | Purpose |
|---|---|---|---|
| `kavach.json` | App (root) | Kavach | Root app tile on desktop — links to `/desk/kavach`, shows `kavach-logo.svg` |

## Critical JSON Fields

| Field | Value | Purpose |
|---|---|---|
| `icon_type` | `"App"` | Root-level app icon (not a child Link) |
| `logo_url` | `"/assets/kavach/images/kavach-logo.svg"` | SVG shown on the desktop tile |
| `hidden` | `0` | Visible on desktop |
| `standard` | `1` | Synced during `bench migrate` (not user-created) |
| `app` | `"kavach"` | Links icon to the kavach app |

## Sync Mechanism
Frappe's `model/sync.py` scans `{app_path}/desktop_icon/` during migrate and calls `import_file_by_path` on each JSON file. The `standard: 1` flag marks it as framework-managed.

## Icon Asset Chain

```
Desktop Icon (kavach.json)
  └─ logo_url → /assets/kavach/images/kavach-logo.svg
       (brown thermometer + green boxes on white circle)

Workspace Sidebar (workspace_sidebar/kavach.json)
  └─ header_icon → "kavach-icon"
       └─ resolves to <symbol id="icon-kavach-icon"> in kavach-icons.svg sprite

Desktop Icon Variants (for sidebar icon rendering)
  ├─ public/icons/desktop_icons/solid/kavach.svg
  └─ public/icons/desktop_icons/subtle/kavach.svg
```

## RESTRICT
<!-- RESTRICT: Never place .md files inside desktop_icon/ directory — Frappe's sync
     code parses ALL files in that folder as JSON. Keep docs alongside the folder. -->
- **Never** place `.md` files inside the `desktop_icon/` directory — Frappe's sync code tries to parse ALL files as JSON
- The `link` field must be `/desk/kavach` — this Frappe version uses `/desk/` as the URL prefix (not `/app/`). The slug must match the Workspace name: `frappe.utils.slug("Kavach")` → `kavach`

## Dependencies
- **kavach-logo.svg**: `public/images/kavach-logo.svg` — the actual SVG rendered on the tile
- **kavach-icons.svg**: `public/icons/kavach-icons.svg` — sprite containing `icon-kavach-icon` (app) and `icon-kavach-srt` (SRT) symbols
- **Workspace Sidebar**: `workspace_sidebar/kavach.json` — sidebar entry for the Kavach workspace
