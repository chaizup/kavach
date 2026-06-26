# Stock Reconciliation SRT — List View controller (`stock_reconciliation_srt_list.js`)

**Added:** 2026-06-26 (foolproofing + relink work)
**Loaded by:** Frappe convention — any `<scrubbed_doctype>_list.js` in the doctype folder is auto-loaded and read as `frappe.listview_settings["Stock Reconciliation SRT"]`. **No `hooks.py` wiring** (same pattern as frappe core's `note_list.js` / `todo_list.js`).
**Pairs with:** `stock_reconciliation_srt.py` (the whitelisted backfill methods) and `stock_reconciliation_srt.md` § 9b.

---

## 1. Why it exists

Two jobs, both stemming from the "SR sometimes not created after admin approval" bug:

1. **Make the linked SR visible (with a hyperlink).** `linked_erpnext_sr` is `in_list_view` in the JSON, so it shows as a column. The formatter turns the value into a real hyperlink to the ERPNext Stock Reconciliation, and — crucially — makes an **orphan obvious**: an admin-approved row (`docstatus=1`, not Approved By System) with no link renders a red **"⚠ Missing — relink"** pill instead of a blank cell.

2. **Give Srt Super Admin a one-click relink.** No more desk console. A **Relink ERPNext SR** inner-button group dispatches to the whitelisted backfill methods.

## 2. `frappe.listview_settings["Stock Reconciliation SRT"]`

| Key | Purpose |
|---|---|
| `add_fields` | Pulls `linked_erpnext_sr`, `workflow_state`, `docstatus` so the formatter can decide orphan-vs-expected. |
| `formatters.linked_erpnext_sr(value, df, doc)` | Returns HTML. Linked → `<a href="/app/stock-reconciliation/NAME">`. Empty + `docstatus=1` + `Approved By System` → muted **"— (system-approved)"** (no SR by design). Empty + `docstatus=1` (any other state) → red **"⚠ Missing — relink"**. Draft/cancelled → muted "—". |
| `onload(listview)` | For Srt Super Admin / System Manager / Administrator only, adds two grouped inner buttons. |

## 3. The two actions (group "Relink ERPNext SR")

- **Scan & Fix All Missing** → calls `get_backfill_candidates()`, filters to `reason === "no_link"` (empty links only), shows a confirm dialog listing the orphans, then calls `backfill_missing_sr()` with **no names** (blanket empty-link fix). If none: a green "All clear".
- **Fix Selected** → `listview.get_checked_items(true)` (names of ticked rows). Confirms, then `backfill_missing_sr(JSON.stringify(names), repair_broken=1)` — explicit selection also repairs links that point at a **cancelled/deleted** SR.

Both render a per-row result table (SRT → ERPNext SR hyperlink → action/error) via `_ipv_srt_run_backfill`, then `listview.refresh()`.

## 4. Contract / RESTRICT

- **Convenience UI only.** The server (`backfill_missing_sr`) re-validates every row and is the authoritative permission + eligibility gate. Do NOT duplicate eligibility logic here.
- Hide the relink buttons from non-super-admins (the server still refuses them, but a hidden button keeps the UI honest).
- **Approved By System** rows legitimately have no SR — the formatter shows the muted note, **never** the red "Missing" warning, and the buttons skip them.
- Posting date/time of any relinked SR is preserved server-side (see `stock_reconciliation_srt.md` § 9b) — nothing in this JS sets it.

## 5. Deploy note

A new `*_list.js` + the `in_list_view` JSON change need the assets/DocType synced:

```bash
~/.local/bin/bench build --app kavach            # bundle the new list.js
~/.local/bin/bench --site <site> migrate         # sync the DocType JSON (in_list_view on linked_erpnext_sr)
~/.local/bin/bench --site <site> clear-cache
```

(In `bench start` dev mode a restart + hard browser refresh is usually enough.)
