# Public Assets — Kavach

## Overview
Static assets served at `/assets/kavach/` — icons, images, and desktop icon variants for the Kavach app.

## Directory Structure

```
public/
├── images/
│   ├── kavach-logo.svg          — App logo (brown thermometer + green boxes, from refs/kavach.svg)
│   └── stock-reconciliation-tracking.svg — SRT module icon (audit clipboard, from refs/SRT.svg)
├── icons/
│   ├── kavach-icons.svg          — SVG sprite (icon-kavach-icon + icon-kavach-srt symbols)
│   └── desktop_icons/
│       ├── solid/kavach.svg      — Solid variant of app icon
│       └── subtle/kavach.svg     — Subtle variant of app icon
├── .cache-bust
└── .gitkeep
```

## Icon Sprite Symbols (`kavach-icons.svg`)

| Symbol ID | Icon | Source | Used By |
|---|---|---|---|
| `icon-kavach-icon` | App icon (thermometer + green boxes) | `refs/kavach.svg` | Workspace Sidebar `header_icon: "kavach-icon"` |
| `icon-kavach-srt` | SRT audit icon (clipboard + magnifying glass) | `refs/SRT.svg` | Workspace JSON `icon: "kavach-srt"` |

## RESTRICT
<!-- RESTRICT: When updating icons, always update BOTH the sprite symbol AND the
     standalone SVG file. The sprite is used by the Frappe desk icon system,
     the standalone file is used by app_logo_url and add_to_apps_screen. -->
- Icon sprite is registered via `app_include_icons` in hooks.py — must be a flat SVG with `<symbol>` elements
- Desktop icon variants at `desktop_icons/{solid,subtle}/` must use `frappe.scrub(label).svg` naming
- Standalone SVG files in `images/` are used by `app_logo_url` and `add_to_apps_screen` hooks

## Dependencies
- **hooks.py**: `app_logo_url`, `app_icon_url`, `add_to_apps_screen` reference `images/kavach-logo.svg`
- **hooks.py**: `app_include_icons` registers `icons/kavach-icons.svg` sprite
- **Workspace JSON**: `icon: "kavach-srt"` resolves via sprite
- **Workspace Sidebar**: `header_icon: "kavach-icon"` resolves via sprite
