# index.html — HTML Shell

> **Sync-block v0.0.1** — last verified against `index.html` on 2026-06-12

## Purpose
Main HTML template served by `doGet()`. Contains all page shells, navigation, modal overlay, and toast. Uses `<?!= include() ?>` to pull in `styles.html` (CSS) and `script.html` (JS).

## Structure (137 lines)

### Head (lines 1–13)
- Charset UTF-8, viewport locked (no zoom)
- `theme-color: #4f46e5` (indigo) for mobile browser chrome
- Apple mobile web app meta tags for PWA-like behavior
- Google Fonts: Inter (400, 500, 600, 700)
- `<?!= include('styles') ?>` — injects CSS

### Loading Screen (lines 20–25)
- `#loading-screen` — shown while `checkSession()` runs on boot
- Spinner + "Loading..." text

### Login Page (lines 30–71)
- `#page-login` with `.login-container`
- SVG clipboard icon, title "Stock Reconciliation"
- Form fields:
  - `#url-field-wrap` — Frappe Site URL (hidden by default via JS when `FRAPPE_URL` is set)
  - `#login-email` — email input
  - `#login-password` — password input
- `#login-error` — error message div (hidden by default)
- `#login-btn` — submit button with spinner

### App Shell (lines 76–121)
- `#app-shell` — main app container (shown after login)
- **Top Bar** (`#top-bar`):
  - `#top-bar-title` — page title (Dashboard/New SRT/History)
  - `#top-bar-action` — context action button (hidden)
  - `#btn-logout` — logout icon (door arrow SVG)
- **Content Area** (`#content-area`):
  - `<main>` element — dynamically filled by router
- **Bottom Navigation** (`#bottom-nav`):
  - Dashboard (grid icon) — `data-page="dashboard"`
  - New SRT (plus-circle icon) — `data-page="create"`
  - History (clock icon) — `data-page="history"`

### Modal Overlay (lines 126–128)
- `#modal-overlay` — full-screen backdrop, hidden by default
- `#modal-content` — dynamically filled by `showModal(html)`

### Toast (lines 133)
- `#toast` — notification bar, hidden by default

### Script Include (line 135)
- `<?!= include('script') ?>` — injects all client-side JS

## Page Visibility Pattern
```
Boot:       #loading-screen.active
Login:      #page-login.active
App:        #app-shell.active
```
Only one `.page.active` at a time — controlled by `showPage(id)` in script.html.

## Dependencies
- Includes: `styles.html`, `script.html`
- Served by: `doGet()` in Code.gs
