# script.html — SPA Client-Side JavaScript

> **Sync-block v0.0.2** — last verified against `script.html` on 2026-06-12

## Purpose
Single-Page Application (SPA) logic for the SRT Web App. Handles login, dashboard, form, history, view modal, and all user interactions. Communicates with Frappe via `google.script.run` → GAS server → Frappe API.

## Sections Overview (1442 lines)

| Section | Lines | Description |
|---|---|---|
| §1 Utils | 18–52 | `callServer()` Promise wrapper, formatters, `debounce` |
| §2 State | 59–96 | `App` global state object, role helpers, pre-loaded data arrays |
| §3 Toast | 103–111 | `showToast(msg, type, duration)` |
| §4 Modal | 118–134 | `showModal(html)` / `closeModal()`, overlay click handler |
| §5 Router | 141–159 | `navigateTo(page)` — switches dashboard/create/history |
| §6 Login | 166–202 | Login form handler, calls `Auth.gs login()` |
| §7 App Init | 209–262 | Session check, `prefetchMasterData()`, bottom nav wiring, logout, boot sequence |
| §8 Dashboard | 269–555 | Tabs, card list, select-all, bulk approve, bulk reject, status pills, delta display |
| §9 View Detail | 562–758 | Modal with batches (both UOMs), remarks (role-gated), approve/reject buttons |
| §10 Create Form | 765–1378 | Item/warehouse local search, batch cards (dual UOM input), add batch (instant), totals, save/submit |
| §11 History | 1385–1442 | Past SRTs list with status pills |

## §1. Utils (lines 18–52)

### `callServer(fn, ...args)` — Line 18
Promise wrapper around `google.script.run`:
```
google.script.run
  .withSuccessHandler(resolve)
  .withFailureHandler(reject)
  [fn](...args)
```

### Formatters
| Function | Line | Purpose |
|---|---|---|
| `fmtNum(v, precision)` | 30 | Indian locale formatting (`en-IN`), default 3 decimal places |
| `fmtDate(d)` | 38 | `DD MMM YYYY` format via `en-IN` locale |
| `escHtml(s)` | 44 | XSS-safe HTML escaping via `textContent` → `innerHTML` |
| `debounce(fn, ms)` | 50 | Standard debounce, used for server search fallback (300ms) |

## §2. State (lines 59–96)

### `App` Object
```javascript
{
  user: { email, fullName, roles },
  currentPage: 'dashboard' | 'create' | 'history',
  // Pre-loaded master data (fetched once on app init, searched locally)
  allItems: [],       // [{ name, item_name }]
  allWarehouses: [],  // [{ name }]
  allBatches: [],     // [{ name, item, expiry_date }] — per selected item
  dashboard: { tab, rows[], counts{}, selected: Set, loading },
  form: { item, item_name, default_warehouse, posting_date, posting_time,
          default_uom, higher_uom, higher_uom_cf, totals..., batches[], company,
          name, modified, user_remark },
  history: { rows[], loading }
}
```

### Role Helpers
| Function | Line | Description |
|---|---|---|
| `hasRole(role)` | 88 | Checks `App.user.roles.includes(role)` |
| `isAdmin()` | 91 | `Srt Admin` OR `System Manager` OR `Administrator` |
| `isSuperAdmin()` | 94 | `Srt Super Admin` OR `System Manager` OR `Administrator` |

## §5. Router (lines 141–159)

`navigateTo(page)`:
1. Updates `App.currentPage`
2. Toggles `.active` on bottom nav items
3. Sets top bar title
4. Clears content area with spinner
5. Calls `renderDashboard()` / `renderCreateForm()` / `renderHistory()`

## §6. Login (lines 166–202)

- URL field hidden by default (`$('#url-field-wrap').style.display = 'none'`)
- Calls `login(email, pwd)` from Auth.gs
- On success: sets `App.user`, calls `showApp()`

## §7. Boot Sequence (lines 209–262)

```
DOMContentLoaded → initLogin() → callServer('checkSession')
  → loggedIn?  → showApp() → prefetchMasterData() → navigateTo('dashboard')
  → !loggedIn? → showPage('page-login')
```

### `prefetchMasterData()` — Line 234
Pre-loads items + warehouses in parallel on app init:
```javascript
const [items, whs] = await Promise.all([
  callServer('getAllItems'),       // cached server-side for 1hr
  callServer('getAllWarehouses'),  // cached server-side for 1hr
]);
App.allItems = items;
App.allWarehouses = whs;
```
Fails silently — form search falls back to server search if pre-load not ready.

## §8. Dashboard (lines 269–555)

### Tabs
- Always shows both tabs: "Admin Approval Pending" and "Super Admin Approval Pending"
- Server-side `get_dashboard_rows` handles permission filtering
- Tab badges show counts from `getDashboardCounts()`

### Card Rendering
Each card shows:
- Item code : Item name (truncated)
- SRT name + warehouse
- Snapshot Stock vs Physical Found (with UOM labels)
- **Difference** row with delta coloring (`delta-over` green for surplus, `delta-short` red for shortage)
- Date + View button
- Checkbox (for admins, for bulk select)

### Bulk Actions (lines 462–543)
- Select-all checkbox + per-card checkboxes
- Bulk bar appears with count + **"Approve All"** + **"Reject All"** buttons + Cancel
- `bulkApprove()` — calls `bulkApproveSrt(names, remark)` with optional remark prompt
- `bulkReject()` — prompts for mandatory reason, calls `bulkRejectSrt(names, reason)`
- Both refresh dashboard counts + rows after completion

### `statusPill(state)` — Line 545
Maps workflow states to pill classes:
| State | CSS Class | Label |
|---|---|---|
| Draft | `pill-draft` | Draft |
| Admin Approval | `pill-admin` | Admin Approved |
| Super Admin Approval | `pill-super` | Completed |
| Approved By System | `pill-system` | Auto-Approved |
| Close | `pill-close` | Closed |

## §9. View SRT Detail (lines 562–758)

### `viewSrt(name)` — Line 562
1. Shows loading spinner in modal
2. Fetches in parallel: `getSrtDoc(name)` + `getBatchSummary(name)`
3. Determines approve/reject permissions from `workflow_state` + user role
4. Renders: item info, totals panel (both UOMs), remarks, batch cards (with counted/uncounted styling), approve/reject buttons

**Key:** Uses `getSrtDoc` (not `loadSrtForm`) — works for any docstatus (Draft, Submitted, Cancelled).

### View Modal Totals (both UOMs)
Shows a 2x2 grid when `higher_uom !== default_uom`:
| | Default UOM (e.g., Gm) | Higher UOM (e.g., Kg) |
|---|---|---|
| Snapshot Stock | Shown | Shown |
| Physical Found | Shown | Shown |

Plus difference in both UOMs with color (green surplus / red shortage).

### View Modal Batch Cards (both UOMs)
Each batch card shows (when UOMs differ):
| Field | UOM |
|---|---|
| Current (select_uom) | Higher/Selected UOM |
| Found (select_uom) | Higher/Selected UOM |
| Current (stock_uom) | Stock UOM |
| Found (stock_uom) | Stock UOM (auto-converted: `qty_found × CF`) |

### Remarks Visibility (Role-Gated)
- **Admin** sees: User Remark
- **Super Admin** sees: User Remark + Admin Remark
- **Regular user** sees: no remark cards
- Remark textarea appears for both approve AND reject (`canApprove || canReject`)
- Remarks are **mandatory** for both approve and reject actions

### `approveFromModal(name)` — Line 706
Validates remark is filled, calls `approveSrt(name, remark)`, refreshes dashboard on success.

### `rejectFromModal(name)` — Line 734
Validates remark is filled (uses `#modal-remark` textarea, not `prompt()`), calls `rejectSrt(name, reason)`.

## §10. Create SRT Form (lines 765–1378)

### Flow
1. `renderCreateForm()` — resets form state, renders inputs
2. `bindFormSearch()` — wires item/warehouse autocomplete (**local search first**, server fallback)
3. User selects item → `prefetchBatchesForItem()` in background → selects warehouse → `tryLoadBatches()`
4. `tryLoadBatches()` → calls `getItemDefaults()` → populates `App.form.batches[]`
5. `renderFormBatches()` — renders batch cards with checkbox + **dual UOM qty input**
6. User ticks "Reconcile" / enters qty in either UOM → fields auto-sync → `recomputeFormTotals()`
7. Save or Submit

### Pre-Loading & Local Search

#### `_localFilter(list, txt, keys)` — Line 851
Client-side filter utility: filters `list` by checking if any `keys` field contains `txt` (case-insensitive). Returns max 30 results. If `txt` is empty, returns first 30.

#### Item Search (local first)
- `renderItemResults(txt)` checks `App.allItems.length > 0`
- If pre-loaded: uses `_localFilter(App.allItems, txt, ['name', 'item_name'])` — **instant**
- If not pre-loaded: falls back to `_serverSearchItems(txt)` via `callServer('searchItems', txt)`
- Triggers on 1 char (was 2) and on focus
- On item select: calls `prefetchBatchesForItem(itemCode)` in background

#### Warehouse Search (local first)
- Same pattern: `_localFilter(App.allWarehouses, txt, ['name'])` or server fallback
- Triggers on 1 char and on focus

#### `prefetchBatchesForItem(itemCode)` — Line 979
Pre-loads ALL non-disabled batches for the selected item:
```javascript
App.allBatches = await callServer('getAllBatchesForItem', itemCode);
```
Server-side cached per-item for 1hr via `CacheService`.

#### Batch Search ("Add Batch" — instant)
- `bindBatchSearch()` — Line 987
- `renderBatchResults(txt)` filters `App.allBatches` locally (instant, no server call)
- Excludes already-added batches from results
- Shows on focus (all available batches) and on input
- No debounce needed — filtering is synchronous
- On batch select: calls `getBatchCurrentState()` for stock qty, adds to batch list with `is_counted: 1`

### Dual UOM Qty Input (Batch Cards)
Each batch card has **two input fields** that auto-sync:
- `batch-qty-higher` — Found in higher/selected UOM (e.g., Kg)
- `batch-qty-stock` — Found in stock UOM (e.g., Gm)

**Higher UOM → Stock UOM sync:**
```javascript
b.qty_found = parseFloat(inp.value) || 0;
const cf = Number(b.conversion_factor) || 1;
stockInp.value = b.qty_found ? (b.qty_found * cf).toFixed(3) : '';
```

**Stock UOM → Higher UOM sync:**
```javascript
const stockVal = parseFloat(inp.value) || 0;
b.qty_found = cf ? stockVal / cf : stockVal;
higherInp.value = b.qty_found ? b.qty_found.toFixed(3) : '';
```

`qty_found` is always stored in the higher/selected UOM.

### CF Footnote
When `select_uom !== stock_uom`, each batch card shows:
`CF: 1 Kg = 1000 Gm` (right-aligned, small grey text)

### `recomputeFormTotals()` — Line 1256
- Iterates all batches
- Counted rows: `qty_found × conversion_factor` → sum to total found (in stock UOM)
- Uncounted rows: `current_stock_in_stock_uom` → contribute to total found
- Higher UOM totals: divide by `higher_uom_cf`

### `buildFormPayload()` — Line 1354
Assembles payload for `saveSrtForm()`:
- Parent fields: item, warehouse, dates, user_remark
- Batches array: batch_no, item_code, warehouse, UOMs, conversion_factor, current_stock, qty_found, is_counted

### Save vs Submit
- **Save** (`saveForm`) — calls `saveSrtForm(payload, name)`, stays on form
- **Submit** (`submitForm`) — validates user_remark (mandatory) + at least one ticked batch, saves first if needed, then calls `submitSrtForm(name)`, navigates to dashboard
- After submit, checks `workflow_state === 'Approved By System'` for auto-approve toast

## §11. History (lines 1385–1442)

- Admins/Super Admins: `getAllSrtHistory(100, 0)` — all SRTs
- Regular users: `getSrtHistory(100, 0)` — own SRTs only
- Cards show: item, name, warehouse, date, status pill
- Cancelled docs: separate `pill-cancelled` styling
- Click opens `viewSrt(name)` modal

## Dependencies
- Calls: All functions in `Auth.gs` and `FrappeProxy.gs` via `callServer()`
- DOM: All element IDs defined in `index.html`
- Styles: All CSS classes defined in `styles.html`
