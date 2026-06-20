# styles.html — Mobile-First CSS

> **Sync-block v0.0.1** — last verified against `styles.html` on 2026-06-12

## Purpose
Complete CSS for the SRT Web App. Material 3 inspired, mobile-first, no external CSS dependencies (only Inter font from Google Fonts).

## Design System

| Token | Value | Usage |
|---|---|---|
| Primary | `#4f46e5` (indigo-600) | Buttons, active nav, accents |
| Success | `#059669` (emerald-600) | Approve buttons, matched delta |
| Warning | `#d97706` (amber-600) | Toast warning, over delta |
| Error | `#e11d48` (rose-600) | Reject, error states |
| Surface | `#f8fafc` (slate-50) | Body background |
| Text | `#1e293b` (slate-800) | Primary text |
| Muted | `#64748b` (slate-500) | Labels, subtitles |
| Font | Inter, system-ui | All text |

## Major CSS Sections

### Reset & Base
- Box-sizing border-box, zero margins
- `-webkit-tap-highlight-color: transparent` for mobile
- Body min-height 100vh

### Page Transitions
- `.page { display: none }` / `.page.active { display: flex }`

### Loading & Spinner
- `.spinner` — 32px border-spin animation (indigo top border)
- `.spinner-sm` — 16px variant for buttons

### Login
- `.login-container` — max-width 400px, centered
- `.login-icon` — indigo circle with SVG
- `.login-form` — standard form group styling

### Top Bar
- Fixed top, 56px height, white background, shadow
- Safe area padding: `padding-top: env(safe-area-inset-top)`

### Bottom Navigation
- Fixed bottom, safe area padding: `padding-bottom: env(safe-area-inset-bottom)`
- `.nav-item` — 48px touch target, icon + label
- `.nav-item.active` — indigo color

### Content Area
- Padded: `56px` top (top bar) + `72px` bottom (nav) + safe areas
- 16px horizontal padding

### Cards
- `.card` — white, rounded-12, shadow, 16px padding
- `.card-title` / `.card-subtitle` — truncated text
- `.card-row` — flex row for label/value pairs

### Tabs
- `.tabs` — horizontal scroll, gap 8px
- `.tab-btn` — pill buttons with `.tab-badge` count

### Status Pills
- `.pill` — inline badge, 10px font, rounded-full
- Variants: `.pill-draft` (blue-50), `.pill-admin` (indigo-50), `.pill-super` (emerald-50), `.pill-system` (amber-50), `.pill-close` (slate-100), `.pill-cancelled` (rose-50)

### Batch Cards
- `.batch-card` — white card with left border
- `.batch-card.checked` — indigo left border
- `.batch-card.matched` — emerald left border
- `.batch-card.over` — amber left border
- `.batch-card.short` — rose left border
- `.batch-fields` — 2-column grid for batch data

### Totals Panel
- `.totals-panel` — indigo-50 background, rounded
- `.totals-grid` — 2x2 grid of total items
- `.delta-matched` / `.delta-over` / `.delta-short` — colored text

### Modal
- `.modal-overlay` — fixed full-screen, black backdrop (40% opacity)
- `.modal-content` — bottom-sheet style on mobile, max-height 90vh, scrollable
- `.modal-handle` — drag handle bar at top
- `.modal-header` / `.modal-body` / `.modal-footer`

### Search Dropdown
- `.search-wrap` — relative container
- `.search-results` — absolute dropdown, max-height 240px, scrollable
- `.search-result-item` — 48px touch target rows

### Toast
- `.toast` — fixed bottom center, pill shape, animated entrance
- `.toast-success` / `.toast-error` / `.toast-warning` — colored variants

### Buttons
- `.btn` — 48px height, rounded-12, transition
- `.btn-primary` (indigo), `.btn-success` (emerald), `.btn-danger` (rose), `.btn-outline` (border only)
- `.btn-full` — width 100%
- `.btn.loading` — hides text, shows spinner

### Utility Classes
- `.mt-2`, `.mt-3`, `.mb-2` — margin spacing
- `.flex`, `.items-center`, `.justify-between`, `.gap-2`
- `.truncate` — text overflow ellipsis
- `.hidden` — display none

## Mobile Optimizations
- All touch targets ≥ 48px
- `env(safe-area-inset-*)` for iPhone notch/home indicator
- `-webkit-text-size-adjust: 100%` prevents iOS font inflation
- `user-scalable=no` in viewport meta (set in index.html)
