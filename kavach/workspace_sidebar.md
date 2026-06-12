# Workspace Sidebar — Kavach

## Overview
This folder contains the Workspace Sidebar JSON fixture for the Kavach app. The sidebar provides navigation in the Frappe desk left panel when viewing Kavach workspaces. Clicking the Kavach icon expands to show child workspace links.

## File

| File | Title | Items | Purpose |
|---|---|---|---|
| `kavach.json` | Kavach | 2 (Home + Stock Reconciliation) | Root sidebar entry for Kavach app with expandable child |

## Critical JSON Fields

| Field | Value | Purpose |
|---|---|---|
| `module` | `""` (empty string) | **Critical**: bypasses module permission check. Without this, sidebar won't render for users who lack the module role |
| `header_icon` | `"kavach-icon"` | Resolves to `icon-kavach-icon` symbol in `kavach-icons.svg` sprite |
| `standard` | `1` | Synced during `bench migrate` |
| `app` | `"kavach"` | Links sidebar to the kavach app |

## Sidebar Items

| Label | Link To | Link Type | Indent | Collapsible | Purpose |
|---|---|---|---|---|---|
| Home | Kavach | Workspace | 0 | Yes | Root collapsible item — click to expand children |
| Stock Reconciliation | Kavach | Workspace | 1 | No | Child link — opens the Kavach workspace (SRT doctypes) |

## Sidebar Hierarchy

```
Kavach (collapsible, indent 0)
  └─ Stock Reconciliation (indent 1) → Kavach workspace
       contains: Stock Reconciliation SRT, SRT Settings, SRT Dashboard
```

## RESTRICT
<!-- RESTRICT: module field MUST stay "" (empty string). UI edits silently reset it.
     See memory: feedback_workspace_module_empty.md -->
- **Never** set `module` to anything other than `""` — this is a known Frappe pitfall
- **Never** place .md files inside the `workspace_sidebar/` directory — Frappe's sync code tries to parse ALL files as JSON

## Sync Mechanism
Frappe's `model/sync.py` scans `{app_path}/workspace_sidebar/` during migrate and calls `import_file_by_path` on each JSON file. Only `.json` files should exist in this directory.

## Dependencies
- **Kavach Workspace**: `stock_reconciliation_tracking/workspace/kavach/kavach.json` — the workspace this sidebar links to
- **kavach-icons.svg**: `public/icons/kavach-icons.svg` — sprite containing `icon-kavach-icon` (app icon) and `icon-kavach-srt` (SRT icon)
