// =============================================================================
// SRT Dashboard v0.0.9.33 — Calm Cockpit (Material 3 polish)
//
// v0.0.9.33 — View modal: "State" column renamed "Difference"; its over/short
//   chips are now ALWAYS amber/orange (never rose — rose = Out would confuse);
//   hover shows the calculation (Counted − Current = Δ). Modal body is now
//   scrollable (:has(.srt-view-grid) → max-height 80vh) so all three remark
//   cards + the editable remark are reachable.
//

// v0.0.9.32 — View modal In/Out cells now lead with the OPENING BALANCE
//   (batch qty AS OF the origin / as of the last SR, in both UOMs) shown as a
//   neutral slate chip above the In/Out chips. Server: get_batch_summary adds
//   qty_at_origin + qty_at_last_sr via _fetch_balance_as_of() (cumulative
//   SUM(sbe.qty) ≤ that datetime). RESTRICT: don't drop qty_at_origin /
//   qty_at_last_sr from get_batch_summary — fmt_inout reads them.
//

// v0.0.9.31 — View modal polish:
//   • State column now shows the delta in BOTH UOMs as box-bubble chips
//     (amber=over, rose=short) — was a single select-UOM number.
//   • In/Out cells dropped the "In"/"Out" word labels (they widened the
//     column); direction is colour-coded (emerald=In, rose=Out) with a
//     legend chip added to the modal header. In/Out cols narrowed to 160.
//   • headerSort:false on EVERY view-modal column (no sorting on the modal).
//

// v0.0.9.30 — FEATURE: dual-UOM "box bubble" chips everywhere a quantity is
//   shown (dashboard list, View-modal In/Out, totals card, drilldown modal,
//   form batches grid). Each qty renders BOTH the default/stock UOM and the
//   higher UOM as stacked bordered rounded-md pills via srt_uom_chips() /
//   srt_uom_chip(). Server: get_dashboard_rows now also returns
//   higher_uom_cf so the View-modal In/Out + drilldown can convert SLE
//   stock-UOM sums to the higher UOM client-side. In/Out columns widened to
//   210 (minWidth 200) and the list UOM columns to 160/185 so the longer
//   UOM chip never clips. View modal "Item" chip now shows item_code · item_name.
//   RESTRICT: chips use format_number() — NEVER frappe.format({fieldtype:Float})
//   (see v0.0.9.29 below). Don't restructure the form grid's two Current
//   columns into one — they intentionally show Selected vs Stock UOM.
//
// v0.0.9.29 — BUGFIX: View modal "State" column rendered raw HTML
//   (`<div style='text-al…`). frappe.format(x,{fieldtype:"Float"}) wraps
//   numbers in a right-align <div>; that markup leaked into the reco-state
//   pill's text label. Switched to format_number() (plain text). See the
//   compute_reco_state() note and srt_dashboard.md § "State column HTML-leak".
//
// Single Source of Truth for Stock Reconciliation SRT. Two-tab queue +
// slide-down form panel + multi-modal view/drilldown + bulk approve with
// per-state remark routing.
//
// MEMORY: app_kavach.md § 26a-d
// SPEC:   docs/specs/2026-05-23-srt-dashboard-design.md (and amendments)
// DOC:    ./srt_dashboard.md (same folder)
//
// ---------------------------------------------------------------------------
// AESTHETIC RULES (LOCKED — see srt_dashboard.md § 1):
//   - 4 font sizes:   text-xs / text-sm / text-base / text-lg
//   - 3 font weights: 400 / 500 / 600
//   - 2 radii:        rounded-md / rounded-lg
//   - 1 shadow:       shadow-sm  (other elevation via Material 3 surface tints)
//   - Hover = color change only (no transforms, no shadow shifts)
//   - Sentence case labels, never UPPERCASE
//   - SVG icons only (no unicode glyphs in cell renderers)
//   - Respects prefers-reduced-motion
//
// COLOR PALETTE (LOCKED):
//   - canvas:   slate-50 / surface: white
//   - text:     slate-900 / 600 / 400 (primary / secondary / tertiary)
//   - accent:   indigo-600
//   - semantic: emerald-600 (success) / amber-600 (warning) / rose-600 (danger)
//
// ---------------------------------------------------------------------------
// RESTRICTED — DO NOT CHANGE WITHOUT ARCHITECTURAL REVIEW:
//
// Visual hygiene
//   - Don't reintroduce 9 font weights or 15 font sizes (v0.0.9.5 catalog).
//   - Don't add custom shadow tokens (card-1/2/3/4/5, float, inner-soft).
//   - Don't reintroduce hover:translate / hover:scale anywhere.
//   - Don't UPPERCASE labels or use tracking-widest on body text.
//   - Don't add decorative blur orbs (absolute positioned blurred circles).
//   - Don't put the totals card on a dark gradient — it's a data card, not a hero.
//   - Don't change the JS class hooks (.srt-* selectors) — event bindings depend on them.
//
// Architecture
//   - Don't reintroduce a standalone /app/srt-form page — DELETED in v0.0.9.
//   - Don't fork the dashboard per role — single page, role-adaptive UI.
//   - Don't hardcode form field list — use get_form_meta() for schema parity.
//   - Don't poll for changes — use frappe.realtime push.
//   - Don't silently overwrite on save — `modified` check throws TimestampMismatchError.
//   - Don't use Jinja `{# … #}` comments in srt_dashboard.html (apostrophe gotcha).
//   - Don't drop the wrapper._srt_dashboard_v9_initialized re-init guard.
//   - Don't use fixed pixel `height` on Tabulator — use calc() so sticky headers
//     scale to any viewport (13" laptop → 27" monitor).
//   - Don't bypass submit_linked_sr() from approve_srt — SABB monkey-patches apply.
//   - Don't compute "Origin" from Batch.creation — use MIN(sle.posting_datetime).
//
// Tables (v0.0.9.18+)
//   - Dashboard list text-wrap / min-height / sticky-header CSS is SCOPED to
//     .srt-grid-host. Don't widen to .tabulator-cell — it cascades into the
//     form's .srt-batches-grid and breaks its inline-editor row height.
//   - The form's batches grid uses Tabulator's default virtual renderer
//     (fixed row height) so inline editors render correctly. Don't apply
//     renderVertical:"basic" there.
//   - The dashboard list's checkbox column is OWNED by this controller (a
//     Set on this._selected), NOT by Tabulator's selectableRows. Don't
//     re-enable selectableRows — it double-fires with cellClick (Tabulator
//     6.x default = row-click-anywhere selects), cancelling each other out.
//     See v0.0.9.24 → v0.0.9.25 history for the proof.
//   - (v0.0.9.29) NEVER feed frappe.format(x, {fieldtype:"Float"|"Int"|
//     "Currency"|"Percent"}) into a pill/badge label, a text node, or an
//     escape_html() call. Those formatters wrap the number in
//     `<div style='text-align:right'>…</div>`; under escape_html it shows
//     literal "<div…" tags (the v0.0.9.29 State-column bug), and inline it
//     renders a stray block. Use format_number() / frappe.utils.strip_html().
//     Raw-innerHTML right-aligned number cells (fmt_inout, col_html, the form
//     grid Qty/Stock cells) intentionally keep frappe.format — don't "fix"
//     those. See srt_dashboard.md § 6a.
//
// Validation parity
//   - save_srt_form → doc.save() → all 9 validate() gates fire. submit_srt_form
//     → doc.submit() → on_submit (Case 1/2 routing). Don't add a parallel API
//     that bypasses these — the controller is authoritative.
//   - approve_srt(remark) routes remark by workflow_state (Admin Approval →
//     super_admin_remark; everything else → admin_remark), matching the
//     controller's _enforce_remark_field_permissions gates. Don't route by
//     tab key — the gates are state-keyed, not tab-keyed.
//
// Tab semantics (v0.0.9.17)
//   - "Admin Approval Pending"     → docstatus=0 (Draft awaiting Srt Admin)
//   - "Super Admin Approval Pending" → docstatus=1, ws="Admin Approval"
//   - Server _TAB_FILTERS = these 2 only. Legacy "Draft" key extracted to
//     _EDIT_LOAD_FILTERS so get_dashboard_counts + bulk_approve_srt don't
//     double-count or iterate it as a tab.
//
// Form panel chrome (v0.0.9.13)
//   - Form panel offsets via .layout-main rect (NOT .layout-side-section
//     outerWidth) so it respects Frappe's sidebar across collapsed / full /
//     mobile modes. Resize listener re-pins on sidebar toggle.
// =============================================================================

frappe.pages["srt-dashboard"].on_page_load = function (wrapper) {
    if (wrapper._srt_dashboard_v9_initialized) return;
    wrapper._srt_dashboard_v9_initialized = true;
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("SRT Dashboard"),
        single_column: true,
    });
    _ensure_tailwind_runtime();
    new SRTDashboardV9(page, wrapper);
};

// =============================================================================
// v0.0.9.30 — Shared dual-UOM "box bubble" renderer.
//
// Every quantity in the dashboard shows BOTH UOMs as stacked bordered chips:
//   • primary chip  = value in the default/stock UOM
//   • secondary chip = value in the higher UOM (value_stock / higher_uom_cf)
// The higher chip is omitted when there is no distinct higher UOM (or cf<=0).
//
// CONTRACT: pass the STOCK-UOM value + the higher_uom name + higher_uom_cf.
// The helper does the conversion so callers don't repeat the math. For the
// dashboard LIST (which already has both precomputed totals) call the
// `*_pre` variant via opts.higher_val to skip conversion.
//
// RESTRICT (v0.0.9.29 rule): chips use format_number() for PLAIN text — never
// frappe.format(x,{fieldtype:"Float"}); that wraps numbers in a
// `<div style='text-align:right'>` which breaks the chip layout. See
// srt_dashboard.md § 6a.
// =============================================================================
function srt_uom_chip(val, uom, primary, toneCls) {
    return `<span class="srt-uom-chip ${toneCls || "srt-chip-slate"} ${primary ? "srt-uom-chip-primary" : ""}">`
        + `<span class="srt-uom-chip-val">${format_number(Number(val) || 0)}</span>`
        + `<span class="srt-uom-chip-uom">${frappe.utils.escape_html(uom || "")}</span>`
        + `</span>`;
}
function srt_uom_chips(stock_val, stock_uom, higher_uom, higher_uom_cf, opts) {
    opts = opts || {};
    const tone = { emerald: "srt-chip-emerald", rose: "srt-chip-rose",
                   indigo: "srt-chip-indigo", amber: "srt-chip-amber",
                   slate: "srt-chip-slate" }[opts.tone] || "srt-chip-slate";
    const cf = Number(higher_uom_cf) || 0;
    // opts.higher_val lets callers pass a precomputed higher-UOM value
    // (dashboard list totals) instead of converting from stock_val/cf.
    const higher_val = (opts.higher_val !== undefined && opts.higher_val !== null)
        ? Number(opts.higher_val) : (cf > 0 ? (Number(stock_val) || 0) / cf : null);
    let html = `<div class="srt-uom-chips">` + srt_uom_chip(stock_val, stock_uom, true, tone);
    const has_higher = higher_uom && higher_uom !== stock_uom
        && (opts.higher_val !== undefined && opts.higher_val !== null ? true : cf > 0);
    if (has_higher) html += srt_uom_chip(higher_val, higher_uom, false, tone);
    html += `</div>`;
    return html;
}

// =============================================================================
// Tailwind CDN bootstrap (scoped to this page; preflight disabled)
// =============================================================================
function _ensure_tailwind_runtime() {
    if (window._tailwind_v3_loaded_for_srt) return;
    window._tailwind_v3_loaded_for_srt = true;

    // v0.0.9.12: REMOVED Tailwind CDN runtime (was ~500KB + ~300ms JIT
    // compile per page load). Replaced with a hand-curated utility CSS
    // covering ONLY the utilities used in this dashboard's templates.
    // Design is preserved — same class names, same visual output, but
    // loads synchronously with the page (no external dep, no JIT).

    const css = document.createElement("style");
    css.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        /* =================================================================
         * Material 3 (M3) design tokens — operator-density variant.
         * Surface tinting: level 0 (white) → 1 → 2 → 3 (slate-50 → -100).
         * Elevation shadows from M3 spec, dialled down for data UIs.
         * State layers: hover 8%, focus 12%, pressed 16% opacity overlays.
         * ================================================================= */
        .srt-dash-root {
            --md-sys-color-primary: #4f46e5;          /* indigo-600 */
            --md-sys-color-on-primary: #ffffff;
            --md-sys-color-primary-container: #e0e7ff;
            --md-sys-color-on-primary-container: #312e81;
            --md-sys-color-secondary: #475569;        /* slate-600 */
            --md-sys-color-surface: #ffffff;
            --md-sys-color-surface-1: #fafbfd;
            --md-sys-color-surface-2: #f5f7fb;
            --md-sys-color-surface-3: #eef1f7;
            --md-sys-color-surface-variant: #f1f5f9;
            --md-sys-color-on-surface: #0f172a;
            --md-sys-color-on-surface-variant: #475569;
            --md-sys-color-outline: #cbd5e1;
            --md-sys-color-outline-variant: #e2e8f0;
            --md-sys-color-error: #dc2626;
            --md-sys-color-error-container: #fee2e2;
            --md-sys-color-on-error-container: #7f1d1d;
            --md-sys-color-success: #059669;
            --md-sys-color-success-container: #d1fae5;
            --md-sys-color-warning: #d97706;
            --md-sys-color-warning-container: #fef3c7;

            /* M3 elevation tokens — calmer than spec defaults */
            --md-sys-elevation-1: 0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 1px rgb(15 23 42 / 0.04);
            --md-sys-elevation-2: 0 1px 2px 0 rgb(15 23 42 / 0.06), 0 2px 6px 2px rgb(15 23 42 / 0.05);
            --md-sys-elevation-3: 0 4px 8px 3px rgb(15 23 42 / 0.06), 0 1px 3px 0 rgb(15 23 42 / 0.06);
            --md-sys-elevation-4: 0 6px 10px 4px rgb(15 23 42 / 0.07), 0 2px 3px 0 rgb(15 23 42 / 0.07);

            /* M3 motion — emphasized decelerate */
            --md-sys-motion-easing-emphasized: cubic-bezier(0.2, 0, 0, 1);
            --md-sys-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
            --md-sys-motion-duration-short: 200ms;
            --md-sys-motion-duration-medium: 300ms;
        }

        .srt-dash-root, .srt-dash-root * {
            font-family: 'Inter', system-ui, sans-serif;
        }

        /* Accessibility: respect reduced-motion preference */
        @media (prefers-reduced-motion: reduce) {
            .srt-dash-root *,
            .srt-dash-root *::before,
            .srt-dash-root *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }

        /* Calm slide-down + fade — used by panel + alerts */
        @keyframes srt-slide-down {
            from { transform: translateY(-12px); opacity: 0; }
            to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes srt-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        .srt-anim-slide-down { animation: srt-slide-down 200ms cubic-bezier(0.16,1,0.3,1) both; }
        .srt-anim-fade-in    { animation: srt-fade-in 150ms ease-out both; }

        /* Skeleton shimmer */
        @keyframes srt-shimmer {
            from { background-position: -200% 0; }
            to   { background-position:  200% 0; }
        }
        .srt-dash-skeleton {
            background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
            background-size: 200% 100%;
            animation: srt-shimmer 1.4s linear infinite;
        }

        /* Scrollbars — quiet */
        .srt-dash-root ::-webkit-scrollbar { width: 8px; height: 8px; }
        .srt-dash-root ::-webkit-scrollbar-track { background: transparent; }
        .srt-dash-root ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .srt-dash-root ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

        /* Material 3 outlined text field — applied to Frappe controls */
        .srt-dash-root .frappe-control { margin-bottom: 0 !important; position: relative; }
        .srt-dash-root .frappe-control input,
        .srt-dash-root .frappe-control select,
        .srt-dash-root .frappe-control .input-with-feedback,
        .srt-dash-root .frappe-control .link-field input,
        .srt-dash-root .frappe-control .awesomplete input {
            border-radius: 8px !important;
            border: 1px solid var(--md-sys-color-outline) !important;
            font-size: 14px !important;
            font-family: 'Inter', system-ui, sans-serif !important;
            background: white !important;
            color: var(--md-sys-color-on-surface) !important;
            padding: 10px 14px !important;
            min-height: 40px !important;
            transition: border-color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
                        box-shadow var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard) !important;
            box-shadow: none !important;
            line-height: 1.4 !important;
        }
        .srt-dash-root .frappe-control input:hover,
        .srt-dash-root .frappe-control select:hover {
            border-color: var(--md-sys-color-on-surface) !important;
        }
        .srt-dash-root .frappe-control input:focus,
        .srt-dash-root .frappe-control select:focus {
            border-color: var(--md-sys-color-primary) !important;
            border-width: 2px !important;
            padding: 9px 13px !important;
            box-shadow: none !important;
            outline: none !important;
        }
        .srt-dash-root .frappe-control input::placeholder {
            color: var(--md-sys-color-on-surface-variant) !important;
            opacity: 0.6;
        }
        .srt-dash-root .frappe-control input[disabled],
        .srt-dash-root .frappe-control input[readonly],
        .srt-dash-root .frappe-control select[disabled] {
            background: var(--md-sys-color-surface-2) !important;
            color: var(--md-sys-color-on-surface-variant) !important;
            cursor: not-allowed;
        }
        /* Awesomplete dropdown — Material elevated surface */
        .srt-dash-root .awesomplete > ul,
        body > .awesomplete > ul {
            background: white !important;
            border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0) !important;
            border-radius: 8px !important;
            box-shadow: var(--md-sys-elevation-3, 0 4px 8px 3px rgb(15 23 42 / 0.06)) !important;
            margin-top: 4px !important;
            padding: 4px !important;
        }
        body > .awesomplete > ul > li {
            border-radius: 6px !important;
            padding: 8px 12px !important;
            font-size: 14px !important;
        }
        body > .awesomplete > ul > li:hover,
        body > .awesomplete > ul > li[aria-selected="true"] {
            background: #f1f5f9 !important;
        }

        /* Frappe dialog Buttons inherit Material 3 styling globally (Frappe
         * dialogs render outside .srt-dash-root scope, so target body .modal) */
        body .modal-dialog .btn-primary,
        body .modal-dialog .btn-modal-primary {
            background: var(--md-sys-color-primary, #4f46e5) !important;
            border-color: var(--md-sys-color-primary, #4f46e5) !important;
            color: white !important;
            border-radius: 10px !important;
            padding: 8px 16px !important;
            font-weight: 500 !important;
            min-height: 36px !important;
            font-size: 14px !important;
            box-shadow: 0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 1px rgb(15 23 42 / 0.04) !important;
            transition: box-shadow 200ms ease, background 200ms ease !important;
        }
        body .modal-dialog .btn-primary:hover {
            background: #4338ca !important;
            border-color: #4338ca !important;
            box-shadow: 0 1px 2px 0 rgb(15 23 42 / 0.06), 0 2px 6px 2px rgb(15 23 42 / 0.05) !important;
        }
        body .modal-dialog .btn-secondary,
        body .modal-dialog .btn-default,
        body .modal-dialog .btn-modal-secondary {
            border-radius: 10px !important;
            padding: 8px 16px !important;
            font-weight: 500 !important;
            min-height: 36px !important;
            font-size: 14px !important;
        }
        body .modal-dialog .modal-content {
            border-radius: 16px !important;
            box-shadow: 0 12px 24px -8px rgb(15 23 42 / 0.18) !important;
            border: none !important;
        }
        body .modal-dialog .modal-header {
            border-bottom: 1px solid #e2e8f0 !important;
            padding: 16px 20px !important;
        }
        body .modal-dialog .modal-title {
            font-size: 16px !important;
            font-weight: 600 !important;
            color: #0f172a !important;
        }
        body .modal-dialog .modal-footer {
            border-top: 1px solid #e2e8f0 !important;
            padding: 12px 20px !important;
            gap: 8px !important;
        }

        /* =================================================================
         * Material 3 button system — 4 variants, all with state layers + ripple
         * ================================================================= */
        .srt-dash-root .md-btn {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 0 16px;
            min-height: 36px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 500;
            font-family: inherit;
            border: none;
            cursor: pointer;
            transition: background-color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
                        box-shadow var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
            user-select: none;
            white-space: nowrap;
            overflow: hidden;
            isolation: isolate;
        }
        .srt-dash-root .md-btn::before {
            content: "";
            position: absolute; inset: 0;
            background: currentColor;
            opacity: 0;
            transition: opacity var(--md-sys-motion-duration-short) ease;
            pointer-events: none;
            z-index: 0;
        }
        .srt-dash-root .md-btn:hover::before  { opacity: 0.08; }
        .srt-dash-root .md-btn:focus-visible::before  { opacity: 0.12; }
        .srt-dash-root .md-btn:active::before { opacity: 0.16; }
        .srt-dash-root .md-btn > * { position: relative; z-index: 1; }

        .srt-dash-root .md-btn-filled {
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            box-shadow: var(--md-sys-elevation-1);
        }
        .srt-dash-root .md-btn-filled:hover { box-shadow: var(--md-sys-elevation-2); }

        .srt-dash-root .md-btn-tonal {
            background: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
        }

        .srt-dash-root .md-btn-outlined {
            background: var(--md-sys-color-surface);
            color: var(--md-sys-color-primary);
            border: 1px solid var(--md-sys-color-outline);
        }

        .srt-dash-root .md-btn-text {
            background: transparent;
            color: var(--md-sys-color-primary);
            padding: 0 12px;
        }

        .srt-dash-root .md-btn-danger {
            background: var(--md-sys-color-error);
            color: white;
            box-shadow: var(--md-sys-elevation-1);
        }

        .srt-dash-root .md-btn-success {
            background: var(--md-sys-color-success);
            color: white;
            box-shadow: var(--md-sys-elevation-1);
        }

        /* Icon button — square 40dp tap target, circular ripple */
        .srt-dash-root .md-icon-btn {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 40px; height: 40px;
            border-radius: 50%;
            border: none;
            background: transparent;
            color: var(--md-sys-color-on-surface-variant);
            cursor: pointer;
            transition: color var(--md-sys-motion-duration-short) ease;
            overflow: hidden;
            isolation: isolate;
        }
        .srt-dash-root .md-icon-btn::before {
            content: "";
            position: absolute; inset: 0;
            background: currentColor;
            opacity: 0;
            transition: opacity var(--md-sys-motion-duration-short) ease;
            pointer-events: none;
        }
        .srt-dash-root .md-icon-btn:hover::before  { opacity: 0.08; }
        .srt-dash-root .md-icon-btn:active::before { opacity: 0.16; }
        .srt-dash-root .md-icon-btn > svg { position: relative; z-index: 1; }
        .srt-dash-root .md-icon-btn:hover { color: var(--md-sys-color-primary); }

        /* Material 3 switch (replaces native checkbox for "Edit posting") */
        .srt-dash-root .md-switch {
            position: relative;
            display: inline-block;
            width: 44px; height: 24px;
            flex-shrink: 0;
        }
        .srt-dash-root .md-switch input {
            opacity: 0; width: 0; height: 0;
        }
        .srt-dash-root .md-switch-track {
            position: absolute; inset: 0;
            background: var(--md-sys-color-surface-variant);
            border: 2px solid var(--md-sys-color-outline);
            border-radius: 999px;
            transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
            cursor: pointer;
        }
        .srt-dash-root .md-switch-thumb {
            position: absolute;
            top: 50%; left: 4px;
            width: 12px; height: 12px;
            background: var(--md-sys-color-secondary);
            border-radius: 50%;
            transform: translateY(-50%);
            transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-emphasized);
        }
        .srt-dash-root .md-switch input:checked ~ .md-switch-track {
            background: var(--md-sys-color-primary);
            border-color: var(--md-sys-color-primary);
        }
        .srt-dash-root .md-switch input:checked ~ .md-switch-track .md-switch-thumb {
            left: 24px;
            width: 16px; height: 16px;
            background: white;
        }

        /* Chip — M3 assist/filter chip */
        .srt-dash-root .md-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 0 12px;
            min-height: 28px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid var(--md-sys-color-outline-variant);
            background: var(--md-sys-color-surface);
            color: var(--md-sys-color-on-surface);
        }

        /* =================================================================
         * v0.0.9.30 — Dual-UOM "box bubble" chips. Every quantity in the
         * dashboard renders BOTH the default/stock UOM and the higher UOM,
         * each in its own bordered rounded-md pill. Stock UOM chip on top
         * (primary weight), higher UOM chip below. Built by srt_uom_chips().
         * Respects locked visual hygiene: rounded-md (6px), 1px component
         * border, no new shadow, tabular-nums, sentence-case-free (numbers).
         * ================================================================= */
        .srt-dash-root .srt-uom-chips {
            display: inline-flex;
            flex-direction: column;
            gap: 4px;
            align-items: stretch;     /* chips share width so units line up */
            min-width: 0;
        }
        /* When the cell is right-aligned, push the stack to the right edge. */
        .srt-dash-root .tabulator-cell[tabulator-field] .srt-uom-chips { align-items: flex-end; }
        .srt-dash-root .srt-uom-chip {
            display: inline-flex;
            align-items: baseline;
            justify-content: flex-end;
            gap: 6px;
            padding: 2px 8px;
            border-radius: 6px;                                   /* rounded-md */
            border: 1px solid var(--md-sys-color-outline-variant);
            background: var(--md-sys-color-surface-1);
            white-space: nowrap;
        }
        .srt-dash-root .srt-uom-chip-val {
            font-size: 13px;
            font-weight: 500;
            color: var(--md-sys-color-on-surface);
            font-variant-numeric: tabular-nums;
        }
        .srt-dash-root .srt-uom-chip-primary .srt-uom-chip-val { font-weight: 600; }
        .srt-dash-root .srt-uom-chip-uom {
            font-size: 11px;
            font-weight: 500;
            color: var(--md-sys-color-on-surface-variant);
        }
        /* Semantic tones (In = emerald, Out = rose, accent = indigo). */
        .srt-dash-root .srt-chip-emerald { border-color: #a7f3d0; background: #ecfdf5; }
        .srt-dash-root .srt-chip-emerald .srt-uom-chip-val { color: #047857; }
        .srt-dash-root .srt-chip-emerald .srt-uom-chip-uom { color: #059669; }
        .srt-dash-root .srt-chip-rose    { border-color: #fecdd3; background: #fff1f2; }
        .srt-dash-root .srt-chip-rose .srt-uom-chip-val { color: #be123c; }
        .srt-dash-root .srt-chip-rose .srt-uom-chip-uom { color: #e11d48; }
        .srt-dash-root .srt-chip-amber   { border-color: #fde68a; background: #fffbeb; }
        .srt-dash-root .srt-chip-amber .srt-uom-chip-val { color: #b45309; }
        .srt-dash-root .srt-chip-amber .srt-uom-chip-uom { color: #d97706; }
        .srt-dash-root .srt-chip-indigo  { border-color: #c7d2fe; background: #eef2ff; }
        .srt-dash-root .srt-chip-indigo .srt-uom-chip-val { color: #4338ca; }
        /* A small "In/Out" leading label that sits left of a chip stack. */
        .srt-dash-root .srt-io-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .srt-dash-root .srt-io-label { font-size: 11px; font-weight: 600; }
        /* v0.0.9.32 — opening-balance row (qty at origin / last SR) sits above
         * the In/Out chips, separated by a dashed rule. */
        .srt-dash-root .srt-io-open {
            display: flex; align-items: center; justify-content: space-between; gap: 8px;
            padding-bottom: 4px; margin-bottom: 4px;
            border-bottom: 1px dashed var(--md-sys-color-outline-variant);
        }
        .srt-dash-root .srt-io-open-lbl {
            font-size: 11px; font-weight: 600; color: var(--md-sys-color-on-surface-variant);
        }
        /* v0.0.9.33 — View modal body scrolls (grid + 3 remark cards +
         * editable remark can exceed the viewport). Scoped to dialogs that
         * actually contain our view grid via :has(), so other Frappe dialogs
         * are untouched. */
        body .modal-dialog:has(.srt-view-grid) .modal-body {
            max-height: 80vh !important;
            overflow-y: auto !important;
        }

        /* Card elevations */
        .srt-dash-root .md-card {
            background: var(--md-sys-color-surface);
            border: 1px solid var(--md-sys-color-outline-variant);
            border-radius: 12px;
        }
        .srt-dash-root .md-card-elevated {
            background: var(--md-sys-color-surface);
            box-shadow: var(--md-sys-elevation-1);
            border-radius: 12px;
        }

        /* Ripple effect — Material's signature radial press feedback */
        @keyframes md-ripple {
            0%   { transform: scale(0);   opacity: 0.4; }
            100% { transform: scale(2.5); opacity: 0;   }
        }
        .srt-dash-root .md-ripple {
            position: absolute;
            border-radius: 50%;
            background: currentColor;
            transform: scale(0);
            pointer-events: none;
            animation: md-ripple 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
            z-index: 0;
            opacity: 0.3;
        }

        /* Banner / snackbar — Material 3 */
        .srt-dash-root .md-banner-error {
            background: var(--md-sys-color-error-container);
            color: var(--md-sys-color-on-error-container);
            border-radius: 12px;
            padding: 12px 16px;
            display: flex; align-items: flex-start; gap: 12px;
            border: 1px solid rgba(220, 38, 38, 0.15);
        }

        /* Skeleton placeholder — M3 progressive disclosure */
        .srt-dash-root .md-skeleton {
            background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
            background-size: 200% 100%;
            animation: srt-shimmer 1.4s linear infinite;
            border-radius: 8px;
        }

        /* Focus ring — M3 spec */
        .srt-dash-root .md-btn:focus-visible,
        .srt-dash-root .md-icon-btn:focus-visible {
            outline: 2px solid var(--md-sys-color-primary);
            outline-offset: 2px;
        }

        /* Tabulator — M3 data-table theme (compact density, no chrome) */
        .srt-dash-root .tabulator {
            border: none !important;
            background: transparent !important;
            font-size: 14px !important;
            font-family: inherit !important;
        }
        .srt-dash-root .tabulator-header {
            position: sticky !important; top: 0 !important; z-index: 10 !important;
            background: var(--md-sys-color-surface-1) !important;
            border-bottom: 1px solid var(--md-sys-color-outline-variant) !important;
            border-top: none !important;
        }
        .srt-dash-root .tabulator-col {
            background: transparent !important;
            border-right: none !important;
            color: var(--md-sys-color-on-surface-variant) !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            text-transform: none !important;
            letter-spacing: 0 !important;
            padding: 12px 16px !important;
        }
        .srt-dash-root .tabulator-row {
            border-bottom: 1px solid var(--md-sys-color-outline-variant) !important;
            background: white !important;
            transition: background-color var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard) !important;
            position: relative;
        }
        /* Hover state layer (M3 8% overlay) */
        .srt-dash-root .tabulator-row:hover {
            background: var(--md-sys-color-surface-2) !important;
        }
        /* Selected state — primary container surface (M3 spec) */
        .srt-dash-root .tabulator-row.tabulator-selected {
            background: var(--md-sys-color-primary-container) !important;
        }
        .srt-dash-root .tabulator-cell {
            border-right: none !important;
            padding: 14px 16px !important;
            color: var(--md-sys-color-on-surface);
            display: flex;
            align-items: center;
        }
        /* =====================================================================
         * v0.0.9.18 — Dashboard LIST grid only: text-wrap + sticky header +
         * variable row heights. SCOPED to .srt-grid-host so the form's
         * batches grid (.srt-batches-grid) keeps its compact single-line
         * layout used by inline editors.
         * ===================================================================*/
        .srt-dash-root .srt-grid-host .tabulator-cell {
            padding: 12px 16px !important;
            align-items: flex-start !important;
            white-space: normal !important;
            word-break: break-word !important;
            overflow-wrap: anywhere !important;
            line-height: 1.45 !important;
            min-height: 56px;
        }
        /* Number columns stay vertically centered so the stacked
           default/higher-UOM lines align. */
        .srt-dash-root .srt-grid-host .tabulator-cell[tabulator-field*="stock"],
        .srt-dash-root .srt-grid-host .tabulator-cell[tabulator-field*="qty"] {
            align-items: center !important;
        }
        .srt-dash-root .srt-grid-host .tabulator-header {
            box-shadow: 0 1px 0 0 var(--md-sys-color-outline-variant) !important;
        }
        /* 3-line clamp for remarks in the dashboard list. */
        .srt-dash-root .srt-grid-host .srt-cell-clamp {
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        /* Item-name line in the Item column — 2-line clamp. */
        .srt-dash-root .srt-grid-host .tabulator-cell .leading-tight > div:first-child {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        /* v0.0.9.23 — Restore centered checkbox cell inside the dashboard
           list grid. The grid-host scoped rule (align-items: flex-start +
           padding 12px 16px) was overriding the older .srt-mdcb-cell rule.
           Higher-specificity selector wins back the centered round target. */
        .srt-dash-root .srt-grid-host .tabulator-cell.srt-mdcb-cell {
            padding: 4px !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: 56px;
        }
        .srt-dash-root .srt-grid-host .tabulator-col[tabulator-field=""] .tabulator-col-content,
        .srt-dash-root .srt-grid-host .tabulator-col.tabulator-row-handle .tabulator-col-content {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        /* Header checkbox sits where the master is rendered — Tabulator
           gives the title-formatted column an inner .tabulator-col-content
           wrapper; center it so the master checkbox aligns with the cell
           checkboxes below it. */
        .srt-dash-root .srt-grid-host .tabulator-header .tabulator-col:first-child .tabulator-col-content {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 8px 4px !important;
        }
        .srt-dash-root .srt-grid-host .tabulator-header .tabulator-col:first-child .tabulator-col-content .srt-mdcb-wrap {
            margin: 0 !important;
        }
        /* =====================================================================
         * v0.0.9.18 — Form batches grid (.srt-batches-grid) Material 3 polish
         * Distinct from the dashboard list — uses Tabulator's default virtual
         * renderer (fixed row height) so inline editors render correctly.
         * Just a touch-up on density + hover/selected tint + sticky header.
         * ===================================================================*/
        .srt-dash-root .srt-batches-grid .tabulator-header {
            position: sticky !important;
            top: 0 !important;
            z-index: 5 !important;
            background: var(--md-sys-color-surface-1) !important;
            box-shadow: 0 1px 0 0 var(--md-sys-color-outline-variant) !important;
        }
        .srt-dash-root .srt-batches-grid .tabulator-col {
            background: transparent !important;
            border-right: none !important;
            color: var(--md-sys-color-on-surface-variant) !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            padding: 10px 12px !important;
        }
        .srt-dash-root .srt-batches-grid .tabulator-row {
            border-bottom: 1px solid var(--md-sys-color-outline-variant) !important;
            background: white !important;
            transition: background-color 120ms ease !important;
        }
        .srt-dash-root .srt-batches-grid .tabulator-row.tabulator-row-even {
            background: var(--md-sys-color-surface-1, #fafafa) !important;
        }
        .srt-dash-root .srt-batches-grid .tabulator-row:hover {
            background: var(--md-sys-color-surface-2, #f1f5f9) !important;
        }
        .srt-dash-root .srt-batches-grid .tabulator-row.tabulator-selected {
            background: var(--md-sys-color-primary-container, #e0e7ff) !important;
        }
        .srt-dash-root .srt-batches-grid .tabulator-cell {
            padding: 10px 12px !important;
            min-height: 48px;
        }
        /* =====================================================================
         * v0.0.9.20 — View modal grid (.srt-view-grid)
         * Variable row height (Origin block is 3 lines), sticky header,
         * responsive collapse for narrow viewports.
         * ===================================================================*/
        .srt-dash-root .srt-view-grid {
            border-radius: 12px;
            border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0);
        }
        .srt-dash-root .srt-view-grid .tabulator-header {
            position: sticky !important;
            top: 0 !important;
            z-index: 5 !important;
            background: var(--md-sys-color-surface-1, #f8fafc) !important;
            box-shadow: 0 1px 0 0 var(--md-sys-color-outline-variant, #e2e8f0) !important;
        }
        .srt-dash-root .srt-view-grid .tabulator-col {
            background: transparent !important;
            border-right: none !important;
            color: var(--md-sys-color-on-surface-variant, #475569) !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            padding: 10px 14px !important;
        }
        .srt-dash-root .srt-view-grid .tabulator-row {
            border-bottom: 1px solid var(--md-sys-color-outline-variant, #e2e8f0) !important;
            background: white !important;
            transition: background-color 120ms ease !important;
        }
        .srt-dash-root .srt-view-grid .tabulator-row:hover {
            background: var(--md-sys-color-surface-2, #f1f5f9) !important;
        }
        .srt-dash-root .srt-view-grid .tabulator-cell {
            padding: 12px 14px !important;
            align-items: flex-start !important;
            white-space: normal !important;
            word-break: break-word !important;
            line-height: 1.45 !important;
            min-height: 72px;
            border-right: none !important;
            overflow: hidden !important;
            text-overflow: ellipsis;
        }
        /* Right-aligned In/Out cells: vertical-center the 2-line stack and
           tint the cell on hover so users see it's clickable for drill-down. */
        .srt-dash-root .srt-view-grid .tabulator-cell[tabulator-field*="summary"] {
            align-items: center !important;
            justify-content: flex-end !important;
            background-color: transparent;
            transition: background-color 120ms ease;
            cursor: pointer;
        }
        .srt-dash-root .srt-view-grid .tabulator-cell[tabulator-field*="summary"]:hover {
            background-color: var(--md-sys-color-primary-container, #e0e7ff) !important;
        }
        /* In/Out stack — let it fill its cell so the In / Out labels align
           on the LEFT and the numbers align on the RIGHT inside the cell. */
        .srt-dash-root .srt-inout-stack { width: 100%; min-width: 130px; }
        /* v0.0.9.28 — Origin cell needs to be tall enough for 3 lines
           (voucher type / voucher no / date+time) without clipping. */
        .srt-dash-root .srt-view-grid .tabulator-cell[tabulator-field="origin"] {
            min-height: 80px;
        }
        /* Tabulator's internal tableholder owns horizontal scroll. Ensure
           it's allowed to overflow-x:auto so wide column totals scroll. */
        .srt-dash-root .srt-view-grid .tabulator-tableholder {
            overflow-x: auto !important;
        }
        /* v0.0.9.27 — responsive collapse toggle styling REMOVED. The view
           modal no longer uses responsiveLayout:"collapse" (user removed the
           "..." toggle per request). Belt-and-braces: hide any residual
           toggle/collapse-row Tabulator might still emit. */
        .srt-dash-root .srt-view-grid .tabulator-responsive-collapse,
        .srt-dash-root .srt-view-grid .tabulator-responsive-collapse-toggle {
            display: none !important;
        }
        /* Narrow viewports — chips wrap to multiple rows, modal fills width */
        @media (max-width: 768px) {
            .srt-dash-root .srt-view-meta { gap: 4px !important; }
            .srt-dash-root .srt-view-grid { min-height: 200px; }
        }
        /* Edit dropdown — Material elevated surface */
        .srt-dash-root .tabulator-edit-list,
        body > .tabulator-edit-list {
            font-size: 14px !important;
            font-family: 'Inter', system-ui, sans-serif !important;
            background: white !important;
            border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0) !important;
            border-radius: 8px !important;
            box-shadow: var(--md-sys-elevation-3, 0 4px 8px 3px rgb(15 23 42 / 0.06)) !important;
            padding: 4px !important;
            max-height: 320px !important;
        }
        body > .tabulator-edit-list .tabulator-edit-list-item {
            border-radius: 6px !important;
            padding: 8px 12px !important;
            font-size: 14px !important;
            color: #0f172a !important;
            transition: background-color 100ms ease !important;
        }
        body > .tabulator-edit-list .tabulator-edit-list-item:hover {
            background: #f1f5f9 !important;
        }
        body > .tabulator-edit-list .tabulator-edit-list-item.active {
            background: #e0e7ff !important;
            color: #312e81 !important;
        }
        body > .tabulator-edit-list .tabulator-edit-list-item.empty {
            color: #94a3b8 !important;
            font-style: italic !important;
        }
        body > .tabulator-edit-list .tabulator-edit-list-placeholder {
            padding: 12px !important;
            color: #94a3b8 !important;
            text-align: center !important;
        }

        /* Tabulator INLINE EDITORS — Material 3 input field style.
           Tabulator's default editors render as bare <input>/<select>
           elements. We style them to match the M3 outlined text field. */
        .srt-dash-root .tabulator-cell input,
        .srt-dash-root .tabulator-cell select,
        .srt-dash-root .tabulator-cell textarea {
            border: 2px solid var(--md-sys-color-primary) !important;
            border-radius: 6px !important;
            padding: 6px 10px !important;
            font-size: 14px !important;
            font-family: 'Inter', system-ui, sans-serif !important;
            background: white !important;
            color: var(--md-sys-color-on-surface) !important;
            box-shadow: none !important;
            outline: none !important;
            width: 100% !important;
            height: 100% !important;
            min-height: 32px !important;
        }
        .srt-dash-root .tabulator-cell input:focus,
        .srt-dash-root .tabulator-cell select:focus {
            border-color: var(--md-sys-color-primary) !important;
            box-shadow: 0 0 0 3px rgb(99 102 241 / 0.15) !important;
            outline: none !important;
        }
        /* Number editor — right-align */
        .srt-dash-root .tabulator-cell input[type="number"] {
            text-align: right !important;
            font-variant-numeric: tabular-nums !important;
            font-weight: 500 !important;
        }
        /* Editing cell — soften the focus ring of the cell itself */
        .srt-dash-root .tabulator-cell.tabulator-editing {
            padding: 4px !important;
            background: var(--md-sys-color-surface-1) !important;
            box-shadow: inset 0 0 0 2px var(--md-sys-color-primary) !important;
            border-radius: 6px !important;
        }
        /* =================================================================
         * Hand-rolled utility CSS — replaces Tailwind CDN (v0.0.9.12)
         * Covers ONLY the utilities used in this dashboard's templates.
         * Naming matches Tailwind so existing className strings work unchanged.
         * ================================================================= */

        /* Display */
        .srt-dash-root .block { display: block; }
        .srt-dash-root .inline-block { display: inline-block; }
        .srt-dash-root .inline { display: inline; }
        .srt-dash-root .flex { display: flex; }
        .srt-dash-root .inline-flex { display: inline-flex; }
        .srt-dash-root .grid { display: grid; }
        .srt-dash-root .hidden { display: none; }

        /* Flex */
        .srt-dash-root .flex-col { flex-direction: column; }
        .srt-dash-root .flex-row { flex-direction: row; }
        .srt-dash-root .flex-wrap { flex-wrap: wrap; }
        .srt-dash-root .flex-nowrap { flex-wrap: nowrap; }
        .srt-dash-root .flex-1 { flex: 1 1 0%; }
        .srt-dash-root .flex-grow { flex-grow: 1; }
        .srt-dash-root .flex-shrink-0 { flex-shrink: 0; }
        .srt-dash-root .flex-none { flex: none; }
        .srt-dash-root .items-start { align-items: flex-start; }
        .srt-dash-root .items-center { align-items: center; }
        .srt-dash-root .items-end { align-items: flex-end; }
        .srt-dash-root .items-baseline { align-items: baseline; }
        .srt-dash-root .justify-start { justify-content: flex-start; }
        .srt-dash-root .justify-center { justify-content: center; }
        .srt-dash-root .justify-end { justify-content: flex-end; }
        .srt-dash-root .justify-between { justify-content: space-between; }

        /* Grid */
        .srt-dash-root .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
        .srt-dash-root .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .srt-dash-root .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .srt-dash-root .grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
        .srt-dash-root .col-span-7 { grid-column: span 7 / span 7; }
        .srt-dash-root .col-span-5 { grid-column: span 5 / span 5; }

        /* Gap */
        .srt-dash-root .gap-1 { gap: 4px; }
        .srt-dash-root .gap-1\\.5 { gap: 6px; }
        .srt-dash-root .gap-2 { gap: 8px; }
        .srt-dash-root .gap-2\\.5 { gap: 10px; }
        .srt-dash-root .gap-3 { gap: 12px; }
        .srt-dash-root .gap-4 { gap: 16px; }
        .srt-dash-root .gap-5 { gap: 20px; }
        .srt-dash-root .gap-6 { gap: 24px; }
        .srt-dash-root .gap-8 { gap: 32px; }
        .srt-dash-root .gap-x-6 { column-gap: 24px; }
        .srt-dash-root .gap-y-2 { row-gap: 8px; }

        /* Space-y */
        .srt-dash-root .space-y-3 > * + * { margin-top: 12px; }
        .srt-dash-root .space-y-4 > * + * { margin-top: 16px; }
        .srt-dash-root .space-y-5 > * + * { margin-top: 20px; }

        /* Width / Height */
        .srt-dash-root .w-full { width: 100%; }
        .srt-dash-root .w-auto { width: auto; }
        .srt-dash-root .w-1\\/3 { width: 33.333333%; }
        .srt-dash-root .w-1\\/4 { width: 25%; }
        .srt-dash-root .w-1\\.5 { width: 6px; }
        .srt-dash-root .w-2 { width: 8px; }
        .srt-dash-root .w-3 { width: 12px; }
        .srt-dash-root .w-3\\.5 { width: 14px; }
        .srt-dash-root .w-4 { width: 16px; }
        .srt-dash-root .w-5 { width: 20px; }
        .srt-dash-root .w-6 { width: 24px; }
        .srt-dash-root .w-7 { width: 28px; }
        .srt-dash-root .w-8 { width: 32px; }
        .srt-dash-root .w-10 { width: 40px; }
        .srt-dash-root .w-12 { width: 48px; }
        .srt-dash-root .w-14 { width: 56px; }
        .srt-dash-root .w-px { width: 1px; }
        .srt-dash-root .h-full { height: 100%; }
        .srt-dash-root .h-auto { height: auto; }
        .srt-dash-root .h-1\\.5 { height: 6px; }
        .srt-dash-root .h-2 { height: 8px; }
        .srt-dash-root .h-3 { height: 12px; }
        .srt-dash-root .h-3\\.5 { height: 14px; }
        .srt-dash-root .h-4 { height: 16px; }
        .srt-dash-root .h-5 { height: 20px; }
        .srt-dash-root .h-6 { height: 24px; }
        .srt-dash-root .h-7 { height: 28px; }
        .srt-dash-root .h-8 { height: 32px; }
        .srt-dash-root .h-10 { height: 40px; }
        .srt-dash-root .h-12 { height: 48px; }
        .srt-dash-root .h-14 { height: 56px; }
        .srt-dash-root .h-32 { height: 128px; }
        .srt-dash-root .h-48 { height: 192px; }
        .srt-dash-root .h-64 { height: 256px; }
        .srt-dash-root .min-h-0 { min-height: 0; }
        .srt-dash-root .min-h-\\[240px\\] { min-height: 240px; }
        .srt-dash-root .max-w-xs { max-width: 320px; }
        .srt-dash-root .max-w-sm { max-width: 384px; }
        .srt-dash-root .max-w-md { max-width: 448px; }
        .srt-dash-root .max-w-\\[1600px\\] { max-width: 1600px; }
        .srt-dash-root .max-w-\\[1800px\\] { max-width: 1800px; }

        /* Margin / Padding */
        .srt-dash-root .m-0 { margin: 0; }
        .srt-dash-root .mx-auto { margin-left: auto; margin-right: auto; }
        .srt-dash-root .mx-1 { margin-left: 4px; margin-right: 4px; }
        .srt-dash-root .my-2 { margin-top: 8px; margin-bottom: 8px; }
        .srt-dash-root .mt-0 { margin-top: 0; }
        .srt-dash-root .mt-0\\.5 { margin-top: 2px; }
        .srt-dash-root .mt-1 { margin-top: 4px; }
        .srt-dash-root .mt-1\\.5 { margin-top: 6px; }
        .srt-dash-root .mt-2 { margin-top: 8px; }
        .srt-dash-root .mt-3 { margin-top: 12px; }
        .srt-dash-root .mt-4 { margin-top: 16px; }
        .srt-dash-root .mb-0 { margin-bottom: 0; }
        .srt-dash-root .mb-1 { margin-bottom: 4px; }
        .srt-dash-root .mb-1\\.5 { margin-bottom: 6px; }
        .srt-dash-root .mb-2 { margin-bottom: 8px; }
        .srt-dash-root .mb-3 { margin-bottom: 12px; }
        .srt-dash-root .mb-4 { margin-bottom: 16px; }
        .srt-dash-root .mb-5 { margin-bottom: 20px; }
        .srt-dash-root .mb-6 { margin-bottom: 24px; }
        .srt-dash-root .mb-8 { margin-bottom: 32px; }
        .srt-dash-root .ml-1 { margin-left: 4px; }
        .srt-dash-root .ml-1\\.5 { margin-left: 6px; }
        .srt-dash-root .ml-2 { margin-left: 8px; }
        .srt-dash-root .ml-auto { margin-left: auto; }
        .srt-dash-root .mr-1 { margin-right: 4px; }
        .srt-dash-root .mr-2 { margin-right: 8px; }
        .srt-dash-root .p-1 { padding: 4px; }
        .srt-dash-root .p-2 { padding: 8px; }
        .srt-dash-root .p-3 { padding: 12px; }
        .srt-dash-root .p-4 { padding: 16px; }
        .srt-dash-root .p-5 { padding: 20px; }
        .srt-dash-root .p-6 { padding: 24px; }
        .srt-dash-root .p-8 { padding: 32px; }
        .srt-dash-root .p-12 { padding: 48px; }
        .srt-dash-root .px-1\\.5 { padding-left: 6px; padding-right: 6px; }
        .srt-dash-root .px-2 { padding-left: 8px; padding-right: 8px; }
        .srt-dash-root .px-2\\.5 { padding-left: 10px; padding-right: 10px; }
        .srt-dash-root .px-3 { padding-left: 12px; padding-right: 12px; }
        .srt-dash-root .px-3\\.5 { padding-left: 14px; padding-right: 14px; }
        .srt-dash-root .px-4 { padding-left: 16px; padding-right: 16px; }
        .srt-dash-root .px-5 { padding-left: 20px; padding-right: 20px; }
        .srt-dash-root .px-6 { padding-left: 24px; padding-right: 24px; }
        .srt-dash-root .py-0\\.5 { padding-top: 2px; padding-bottom: 2px; }
        .srt-dash-root .py-1 { padding-top: 4px; padding-bottom: 4px; }
        .srt-dash-root .py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
        .srt-dash-root .py-2 { padding-top: 8px; padding-bottom: 8px; }
        .srt-dash-root .py-2\\.5 { padding-top: 10px; padding-bottom: 10px; }
        .srt-dash-root .py-3 { padding-top: 12px; padding-bottom: 12px; }
        .srt-dash-root .py-4 { padding-top: 16px; padding-bottom: 16px; }
        .srt-dash-root .pl-2 { padding-left: 8px; }
        .srt-dash-root .pt-3 { padding-top: 12px; }
        .srt-dash-root .pt-4 { padding-top: 16px; }
        .srt-dash-root .pt-6 { padding-top: 24px; }
        .srt-dash-root .pb-2 { padding-bottom: 8px; }
        .srt-dash-root .pb-4 { padding-bottom: 16px; }
        .srt-dash-root .pb-6 { padding-bottom: 24px; }

        /* Position */
        .srt-dash-root .static { position: static; }
        .srt-dash-root .fixed { position: fixed; }
        .srt-dash-root .absolute { position: absolute; }
        .srt-dash-root .relative { position: relative; }
        .srt-dash-root .sticky { position: sticky; }
        .srt-dash-root .inset-0 { inset: 0; }
        .srt-dash-root .top-0 { top: 0; }
        .srt-dash-root .right-0 { right: 0; }
        .srt-dash-root .bottom-0 { bottom: 0; }
        .srt-dash-root .left-0 { left: 0; }
        .srt-dash-root .left-1\\/2 { left: 50%; }
        .srt-dash-root .bottom-6 { bottom: 24px; }
        .srt-dash-root .-translate-x-1\\/2 { transform: translateX(-50%); }
        .srt-dash-root .z-10 { z-index: 10; }
        .srt-dash-root .z-20 { z-index: 20; }
        .srt-dash-root .z-30 { z-index: 30; }
        .srt-dash-root .z-40 { z-index: 40; }

        /* Overflow */
        .srt-dash-root .overflow-hidden { overflow: hidden; }
        .srt-dash-root .overflow-auto { overflow: auto; }
        .srt-dash-root .overflow-y-auto { overflow-y: auto; }
        .srt-dash-root .overflow-x-auto { overflow-x: auto; }
        .srt-dash-root .truncate {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Typography */
        .srt-dash-root .text-xs { font-size: 12px; line-height: 16px; }
        .srt-dash-root .text-sm { font-size: 14px; line-height: 20px; }
        .srt-dash-root .text-base { font-size: 16px; line-height: 24px; }
        .srt-dash-root .text-lg { font-size: 18px; line-height: 26px; }
        .srt-dash-root .text-xl { font-size: 20px; line-height: 28px; }
        .srt-dash-root .font-normal { font-weight: 400; }
        .srt-dash-root .font-medium { font-weight: 500; }
        .srt-dash-root .font-semibold { font-weight: 600; }
        .srt-dash-root .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        .srt-dash-root .text-left { text-align: left; }
        .srt-dash-root .text-center { text-align: center; }
        .srt-dash-root .text-right { text-align: right; }
        .srt-dash-root .italic { font-style: italic; }
        .srt-dash-root .tabular-nums { font-variant-numeric: tabular-nums; }
        .srt-dash-root .leading-tight { line-height: 1.25; }
        .srt-dash-root .leading-relaxed { line-height: 1.625; }

        /* Colors — text */
        .srt-dash-root .text-white   { color: #ffffff; }
        .srt-dash-root .text-slate-300 { color: #cbd5e1; }
        .srt-dash-root .text-slate-400 { color: #94a3b8; }
        .srt-dash-root .text-slate-500 { color: #64748b; }
        .srt-dash-root .text-slate-600 { color: #475569; }
        .srt-dash-root .text-slate-700 { color: #334155; }
        .srt-dash-root .text-slate-800 { color: #1e293b; }
        .srt-dash-root .text-slate-900 { color: #0f172a; }
        .srt-dash-root .text-indigo-500 { color: #6366f1; }
        .srt-dash-root .text-indigo-600 { color: #4f46e5; }
        .srt-dash-root .text-indigo-700 { color: #4338ca; }
        .srt-dash-root .text-emerald-500 { color: #10b981; }
        .srt-dash-root .text-emerald-600 { color: #059669; }
        .srt-dash-root .text-emerald-700 { color: #047857; }
        .srt-dash-root .text-rose-500 { color: #f43f5e; }
        .srt-dash-root .text-rose-600 { color: #e11d48; }
        .srt-dash-root .text-rose-700 { color: #be123c; }
        .srt-dash-root .text-amber-700 { color: #b45309; }

        /* Colors — background */
        .srt-dash-root .bg-white      { background-color: #ffffff; }
        .srt-dash-root .bg-slate-50   { background-color: #f8fafc; }
        .srt-dash-root .bg-slate-100  { background-color: #f1f5f9; }
        .srt-dash-root .bg-slate-200  { background-color: #e2e8f0; }
        .srt-dash-root .bg-slate-700  { background-color: #334155; }
        .srt-dash-root .bg-slate-800  { background-color: #1e293b; }
        .srt-dash-root .bg-slate-900  { background-color: #0f172a; }
        .srt-dash-root .bg-indigo-500 { background-color: #6366f1; }
        .srt-dash-root .bg-indigo-600 { background-color: #4f46e5; }
        .srt-dash-root .bg-indigo-700 { background-color: #4338ca; }
        .srt-dash-root .bg-indigo-50  { background-color: #eef2ff; }
        .srt-dash-root .bg-emerald-50 { background-color: #ecfdf5; }
        .srt-dash-root .bg-emerald-500{ background-color: #10b981; }
        .srt-dash-root .bg-emerald-600{ background-color: #059669; }
        .srt-dash-root .bg-emerald-700{ background-color: #047857; }
        .srt-dash-root .bg-rose-50    { background-color: #fff1f2; }
        .srt-dash-root .bg-rose-600   { background-color: #e11d48; }
        .srt-dash-root .bg-amber-50   { background-color: #fffbeb; }

        /* Borders */
        .srt-dash-root .border    { border-width: 1px; border-style: solid; }
        .srt-dash-root .border-2  { border-width: 2px; border-style: solid; }
        .srt-dash-root .border-t  { border-top-width: 1px; border-top-style: solid; }
        .srt-dash-root .border-b  { border-bottom-width: 1px; border-bottom-style: solid; }
        .srt-dash-root .border-l  { border-left-width: 1px; border-left-style: solid; }
        .srt-dash-root .border-r  { border-right-width: 1px; border-right-style: solid; }
        .srt-dash-root .border-slate-100 { border-color: #f1f5f9; }
        .srt-dash-root .border-slate-200 { border-color: #e2e8f0; }
        .srt-dash-root .border-slate-300 { border-color: #cbd5e1; }
        .srt-dash-root .border-indigo-200 { border-color: #c7d2fe; }
        .srt-dash-root .border-indigo-300 { border-color: #a5b4fc; }
        .srt-dash-root .border-rose-200 { border-color: #fecdd3; }
        .srt-dash-root .border-emerald-200 { border-color: #a7f3d0; }

        /* Border radius */
        .srt-dash-root .rounded     { border-radius: 4px; }
        .srt-dash-root .rounded-md  { border-radius: 6px; }
        .srt-dash-root .rounded-lg  { border-radius: 8px; }
        .srt-dash-root .rounded-xl  { border-radius: 12px; }
        .srt-dash-root .rounded-full{ border-radius: 9999px; }

        /* Effects */
        .srt-dash-root .shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
        .srt-dash-root .shadow    { box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); }
        .srt-dash-root .opacity-60 { opacity: 0.6; }
        .srt-dash-root .opacity-70 { opacity: 0.7; }

        /* Cursor */
        .srt-dash-root .cursor-pointer { cursor: pointer; }
        .srt-dash-root .cursor-not-allowed { cursor: not-allowed; }

        /* Transitions */
        .srt-dash-root .transition-colors {
            transition-property: color, background-color, border-color;
            transition-duration: 150ms;
            transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Hover states */
        .srt-dash-root .hover\\:bg-slate-50:hover  { background-color: #f8fafc; }
        .srt-dash-root .hover\\:bg-slate-100:hover { background-color: #f1f5f9; }
        .srt-dash-root .hover\\:bg-white:hover     { background-color: #ffffff; }
        .srt-dash-root .hover\\:bg-white\\/60:hover { background-color: rgba(255,255,255,0.6); }
        .srt-dash-root .hover\\:bg-indigo-50:hover { background-color: #eef2ff; }
        .srt-dash-root .hover\\:bg-indigo-700:hover { background-color: #4338ca; }
        .srt-dash-root .hover\\:bg-emerald-700:hover { background-color: #047857; }
        .srt-dash-root .hover\\:bg-rose-50:hover { background-color: #fff1f2; }
        .srt-dash-root .hover\\:border-indigo-200:hover { border-color: #c7d2fe; }
        .srt-dash-root .hover\\:text-slate-900:hover { color: #0f172a; }
        .srt-dash-root .hover\\:text-slate-700:hover { color: #334155; }
        .srt-dash-root .hover\\:text-rose-600:hover  { color: #e11d48; }
        .srt-dash-root .hover\\:text-rose-700:hover  { color: #be123c; }
        .srt-dash-root .hover\\:text-indigo-600:hover { color: #4f46e5; }
        .srt-dash-root .hover\\:text-indigo-700:hover { color: #4338ca; }
        .srt-dash-root .hover\\:text-white:hover { color: #ffffff; }

        /* Focus states */
        .srt-dash-root .focus\\:outline-none:focus { outline: none; }
        .srt-dash-root .focus\\:border-indigo-500:focus { border-color: #6366f1; }
        .srt-dash-root .focus\\:ring-2:focus { box-shadow: 0 0 0 2px rgb(99 102 241 / 0.15); }

        /* Responsive (xl 1280px) */
        @media (min-width: 1280px) {
            .srt-dash-root .xl\\:grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
            .srt-dash-root .xl\\:col-span-7 { grid-column: span 7 / span 7; }
            .srt-dash-root .xl\\:col-span-5 { grid-column: span 5 / span 5; }
        }
        @media (min-width: 1024px) {
            .srt-dash-root .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        /* Material 3 row checkbox column — bigger tap target, proper M3 styling */
        .srt-dash-root .tabulator-cell.srt-mdcb-cell {
            cursor: pointer;
            padding: 8px !important;
        }
        .srt-dash-root .srt-mdcb-wrap {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 40px; height: 40px;
            border-radius: 50%;
            cursor: pointer;
            transition: background-color 150ms ease;
            position: relative;
            isolation: isolate;
        }
        .srt-dash-root .srt-mdcb-wrap:hover {
            background: rgb(99 102 241 / 0.08);
        }
        .srt-dash-root .srt-mdcb-wrap:active {
            background: rgb(99 102 241 / 0.16);
        }
        .srt-dash-root .srt-mdcb {
            width: 18px; height: 18px;
            border-radius: 2px;
            border: 2px solid var(--md-sys-color-outline);
            background: white;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 150ms ease, border-color 150ms ease;
        }
        .srt-dash-root .srt-mdcb.checked {
            background: var(--md-sys-color-primary);
            border-color: var(--md-sys-color-primary);
        }
        .srt-dash-root .srt-mdcb svg {
            color: white;
            width: 14px; height: 14px;
            stroke-width: 3;
            opacity: 0;
            transition: opacity 100ms ease;
        }
        .srt-dash-root .srt-mdcb.checked svg { opacity: 1; }
        /* v0.0.9.23 — master checkbox "partial" state: outline ring without
           a fill, used when SOME (but not all) rows are selected. */
        .srt-dash-root .srt-mdcb.partial:not(.checked) {
            background: white;
            border-color: var(--md-sys-color-primary, #4f46e5);
            position: relative;
        }
        .srt-dash-root .srt-mdcb.partial:not(.checked)::after {
            content: "";
            position: absolute;
            left: 3px; right: 3px; top: 50%;
            height: 2px;
            background: var(--md-sys-color-primary, #4f46e5);
            transform: translateY(-50%);
            border-radius: 1px;
        }
    `;
    document.head.appendChild(css);

    // Material 3 ripple installer — delegated click listener spawns a
    // radial ripple element inside the clicked .md-btn / .md-icon-btn.
    // CSS keyframe animates scale+opacity, removed after 500ms.
    document.addEventListener("click", e => {
        const btn = e.target.closest(".md-btn, .md-icon-btn");
        if (!btn || btn.disabled) return;
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement("span");
        ripple.className = "md-ripple";
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
        ripple.style.top  = `${e.clientY - rect.top  - size / 2}px`;
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);
    }, true);
}

// =============================================================================
// Main controller
// =============================================================================
class SRTDashboardV9 {
    constructor(page, wrapper) {
        this.page = page;
        this.$wrap = $(wrapper);
        this.$body = $(page.body);
        // v0.0.9.17 — tab keys reflect WHO is waiting to act:
        //   "Admin Approval Pending"     → docstatus=0 (Draft) docs
        //   "Super Admin Approval Pending" → docstatus=1, ws="Admin Approval"
        this.current_tab = "Admin Approval Pending";
        this.counts = {
            "Admin Approval Pending": 0,
            "Super Admin Approval Pending": 0,
        };
        this.item_filter = null;
        // v0.0.9.25 — controller-owned selection set keyed by doc.name.
        // Decoupled from Tabulator's selectableRows (was breaking under
        // 6.x's "any cell click selects row" default which double-fired
        // with cellClick toggleSelect, leaving rows in their original
        // state). Now the formatter reads from this set + cellClick
        // mutates it directly.
        this._selected = new Set();
        this.roles = new Set(frappe.user_roles || []);
        this.is_super = this.roles.has("Srt Super Admin") || this.roles.has("System Manager")
                        || frappe.session.user === "Administrator";
        this.is_admin = this.is_super || this.roles.has("Srt Admin");
        this._form_meta = null;
        this._tabulator = null;
        this._render_shell();
        this._render_header();
        this._render_page_actions();
        this._subscribe_realtime();
        this._load_counts_then_grid();
    }

    _render_shell() {
        const html = frappe.render_template("srt_dashboard", {});
        this.$body.html(html);
        this.$body.addClass("srt-dash-root bg-slate-50 w-full");
        this.$body.css({ "min-height": "calc(100vh - 100px)", "width": "100%" });
        this.$tw_slot       = this.$body.find(".srt-dash-tw-style-slot");
        this.$header_slot   = this.$body.find(".srt-dash-header-slot");
        this.$grid_slot     = this.$body.find(".srt-dash-grid-slot");
        this.$bulk_slot     = this.$body.find(".srt-dash-bulk-bar-slot");
        this.$backdrop_slot = this.$body.find(".srt-dash-backdrop-slot");
        this.$panel_slot    = this.$body.find(".srt-dash-form-panel-slot");
    }

    _render_header() {
        const role_label = this.is_super ? __("Super Admin")
                          : (this.is_admin ? __("Admin")
                          : (this.roles.has("Srt User") ? __("User") : __("Viewer")));
        // v0.0.9.17 — tab keys match server _TAB_FILTERS exactly. Each tab
        // shows docs waiting for that role's action:
        //   "Admin Approval Pending"     → docstatus=0 Draft (action: Srt Admin approve)
        //   "Super Admin Approval Pending" → ws="Admin Approval" (action: Srt Super Admin submit linked SR)
        const tabs = [
            { key: "Admin Approval Pending",       label: __("Admin Approval Pending") },
            { key: "Super Admin Approval Pending", label: __("Super Admin Approval Pending") },
        ];
        // Material 3 segmented button group — active state uses
        // primary-container surface (M3 spec), inactive uses neutral
        const tab_html = tabs.map(t => {
            const is_active = t.key === this.current_tab;
            const cls = is_active
                ? "bg-white text-slate-900"
                : "text-slate-600 hover:bg-white/60";
            const badge_cls = is_active
                ? "bg-indigo-50 text-indigo-700"
                : "bg-slate-200 text-slate-600";
            const style = is_active ? "box-shadow: var(--md-sys-elevation-1);" : "";
            return `
                <button data-tab="${frappe.utils.escape_html(t.key)}"
                        class="srt-tab inline-flex items-center px-3.5 py-1.5 rounded-md
                               text-sm font-medium transition-colors ${cls}"
                        style="${style}">
                    ${frappe.utils.escape_html(t.label)}
                    <span class="srt-tab-count ml-2 px-1.5 py-0.5 rounded text-xs
                                 font-medium ${badge_cls}">${this.counts[t.key] ?? 0}</span>
                </button>`;
        }).join("");

        this.$header_slot.html(`
            <div class="flex items-center justify-between mb-2 mt-2">
                <div class="flex items-center gap-3">
                    <h2 class="text-lg font-semibold text-slate-900 m-0">
                        ${__("Stock Reconciliation")}
                    </h2>
                    <span class="md-chip">
                        <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                        ${frappe.utils.escape_html(role_label)}
                    </span>
                </div>
                <div class="flex items-center gap-1">
                    <button class="srt-refresh md-icon-btn" title="${__("Refresh")}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                        </svg>
                    </button>
                </div>
            </div>
            <p class="text-sm text-slate-500 mb-4 mt-0">
                ${__("Review and approve batch-level stock reconciliations.")}
            </p>
            <div class="flex items-center gap-3 flex-wrap mb-4">
                <div class="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                    ${tab_html}
                </div>
                <!-- v0.0.9.15: item filter — narrows the grid to a single item.
                     Renders inline next to the tabs. Clearing returns to
                     the full unfiltered queue. -->
                <div class="flex items-center gap-2 ml-auto">
                    <label class="text-xs font-medium text-slate-600 whitespace-nowrap">
                        ${__("Filter by item")}
                    </label>
                    <div class="srt-item-filter-field" style="min-width: 240px;"></div>
                    ${this.item_filter ? `
                        <button class="srt-item-filter-clear md-icon-btn"
                                title="${__("Clear item filter")}">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                      stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>` : ""}
                </div>
            </div>
        `);

        this.$header_slot.find(".srt-tab").on("click", e => {
            const tab = $(e.currentTarget).data("tab");
            if (tab === this.current_tab) return;
            this.current_tab = tab;
            this._render_header();
            this._render_page_actions();
            this._load_grid();
        });
        this.$header_slot.find(".srt-refresh").on("click", () => this._load_counts_then_grid());

        // v0.0.9.15: item filter picker
        const $if_host = this.$header_slot.find(".srt-item-filter-field");
        if ($if_host.length) {
            const ifc = frappe.ui.form.make_control({
                df: { fieldtype: "Link", fieldname: "item_filter", options: "Item",
                      placeholder: __("All items") },
                parent: $if_host[0], render_input: true,
            });
            if (this.item_filter) ifc.set_value(this.item_filter);
            ifc.df.onchange = () => {
                const v = ifc.get_value() || null;
                if (v === this.item_filter) return;
                this.item_filter = v;
                this._render_header();
                this._load_grid();
            };
            this._ctrl_item_filter = ifc;
        }
        this.$header_slot.find(".srt-item-filter-clear").on("click", () => {
            this.item_filter = null;
            this._render_header();
            this._load_grid();
        });
    }

    _render_page_actions() {
        this.page.clear_primary_action();
        this.page.clear_secondary_action();
        this.page.set_primary_action(__("New SRT"), () => this._open_form_panel());
        // v0.0.9.27 — hide the empty Frappe page-header "..." menu (we never
        // call page.add_menu_item, so the dropdown was always empty). Frappe
        // still renders the button by default — defensive hide via direct
        // jQuery so it doesn't visually clutter the dashboard header.
        try {
            const $wrapper = $(this.page.wrapper);
            $wrapper.find(".menu-btn-group, .btn-menu-options, .page-actions .dropdown-menu").hide();
        } catch (e) { /* defensive */ }
    }

    _load_counts_then_grid() {
        return frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_dashboard_counts",
        }).then(r => {
            this.counts = r.message || this.counts;
            this._render_header();
            return this._load_grid();
        });
    }

    _reload_counts() {
        return frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_dashboard_counts",
        }).then(r => {
            this.counts = r.message || this.counts;
            this._render_header();
        });
    }

    _load_grid(quiet = false) {
        if (!quiet) this._render_skeleton();
        return frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_dashboard_rows",
            args: { tab: this.current_tab, item_filter: this.item_filter || null },
        }).then(r => this._render_grid(r.message || []))
          .catch(err => {
              this.$grid_slot.html(`
                  <div class="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700 text-sm">
                      ${frappe.utils.escape_html(err.message || String(err))}
                  </div>
              `);
          });
    }

    _render_skeleton() {
        const skel_rows = Array(5).fill(0).map(() =>
            `<div class="md-skeleton h-14 mb-2"></div>`).join("");
        this.$grid_slot.html(`
            <div class="md-card-elevated p-4">
                <div class="md-skeleton h-8 w-1/4 mb-4"></div>
                ${skel_rows}
            </div>
        `);
    }

    _render_grid(rows) {
        if (!rows.length) {
            this._render_empty_state();
            return;
        }
        if (typeof Tabulator === "undefined") {
            this.$grid_slot.html(`
                <div class="bg-rose-50 border border-rose-200 rounded-lg p-4 text-rose-700 text-sm">
                    ${__("Tabulator failed to load. Check network access to jsdelivr.net.")}
                </div>
            `);
            return;
        }
        // v0.0.9.17 — let Tabulator handle the scroll directly via its
        // own height so the header position:sticky inside tabulator-tableholder
        // works. The outer wrapper just clips overflow for the rounded corner.
        this.$grid_slot.html(`
            <div class="md-card-elevated overflow-hidden w-full">
                <div class="srt-grid-host w-full"
                     style="height: calc(100vh - 280px); min-height: 320px;"></div>
            </div>
        `);
        const $host = this.$grid_slot.find(".srt-grid-host");
        if (this._tabulator) { try { this._tabulator.destroy(); } catch (e) {} }
        const that = this;

        const fmt_name = (cell) => {
            const v = cell.getValue() || "";
            return `<span class="font-mono text-xs text-slate-700">${frappe.utils.escape_html(v)}</span>`;
        };
        const fmt_state_pill = (cell) => {
            const v = cell.getValue() || "Draft";
            const palette = {
                "Draft":                { bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" },
                "Admin Approval":       { bg: "#fef3c7", fg: "#92400e", dot: "#d97706" },
                "Super Admin Approval": { bg: "#e0e7ff", fg: "#3730a3", dot: "#4f46e5" },
                "Approved By System":   { bg: "#d1fae5", fg: "#065f46", dot: "#059669" },
                "Close":                { bg: "#f1f5f9", fg: "#64748b", dot: "#94a3b8" },
            };
            const p = palette[v] || palette["Draft"];
            return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium"
                          style="background: ${p.bg}; color: ${p.fg};">
                        <span class="w-1.5 h-1.5 rounded-full" style="background: ${p.dot};"></span>
                        ${frappe.utils.escape_html(v)}
                    </span>`;
        };
        const fmt_item = (cell) => {
            const d = cell.getRow().getData();
            return `
                <div class="leading-tight">
                    <div class="text-sm font-medium text-slate-900 truncate"
                         title="${frappe.utils.escape_html(d.item_name || "")}">
                        ${frappe.utils.escape_html(d.item_name || "")}
                    </div>
                    <div class="text-xs text-slate-500 font-mono mt-0.5">
                        ${frappe.utils.escape_html(d.item || "")}
                    </div>
                </div>`;
        };
        const fmt_warehouse = (cell) => {
            const v = cell.getValue() || "";
            return `<span class="text-sm text-slate-700">${frappe.utils.escape_html(v)}</span>`;
        };
        const fmt_uom_stack = (cell) => {
            const d = cell.getRow().getData();
            const def_val = cell.getValue();
            const higher_field = cell.getField().replace("default_uom", "higher_uom");
            const higher_val = d[higher_field];
            // v0.0.9.30 — dual-UOM box-bubble chips. higher_val is already
            // precomputed server-side (total_*_in_higher_uom) so we pass it
            // via opts.higher_val instead of converting from a cf.
            return srt_uom_chips(def_val, d.default_uom, d.higher_uom, null,
                                 { higher_val: higher_val });
        };
        const fmt_date = (cell) => {
            const d = cell.getRow().getData();
            if (!d.posting_date) return "";
            const dt = frappe.datetime.str_to_obj(`${d.posting_date} ${d.posting_time || "00:00:00"}`);
            return `
                <div class="leading-tight">
                    <div class="text-sm text-slate-900">${moment(dt).format("DD MMM YYYY")}</div>
                    <div class="text-xs text-slate-500 mt-0.5">${moment(dt).format("hh:mm A")}</div>
                </div>`;
        };
        const fmt_remark = (cell) => {
            const v = (cell.getValue() || "").replace(/<[^>]*>/g, "").trim();
            if (!v) return '<span class="text-xs text-slate-400">—</span>';
            // v0.0.9.17 — let the cell's white-space:normal CSS wrap the
            // text. Show up to ~3 lines via line-clamp; full text in title.
            return `<span class="text-sm text-slate-700 srt-cell-clamp"
                          title="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(v)}</span>`;
        };
        const fmt_action = () => `
            <button class="srt-view-btn inline-flex items-center justify-center
                           w-7 h-7 rounded-md text-slate-500 hover:text-indigo-600
                           hover:bg-indigo-50 transition-colors"
                    title="${__("View")}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                </svg>
            </button>`;

        // v0.0.9.15: Material 3 checkbox formatter for the bulk-select column.
        // Uses the SAME visual primitive (srt-mdcb-wrap → srt-mdcb → svg) as
        // the form's batches grid so selection chrome is consistent.
        // No <input> element — state is carried by Tabulator's row selection
        // and click is wired through cellClick.
        // v0.0.9.25 — selection state is owned by this controller, not by
        // Tabulator. The formatter reads from this._selected; cellClick
        // mutates the set + re-renders just the affected cells. This sidesteps
        // Tabulator 6.x's "row-click-anywhere selects" default which was
        // double-firing with my cellClick toggle in v0.0.9.15..v0.0.9.24,
        // cancelling each other out.
        const fmt_check_visual = (checked) => `
            <span class="srt-mdcb-wrap">
                <span class="srt-mdcb ${checked ? 'checked' : ''}">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                    </svg>
                </span>
            </span>`;
        const fmt_m3_check_cell = (cell) => {
            const n = cell.getRow().getData().name;
            return fmt_check_visual(that._selected.has(n));
        };
        const fmt_m3_check_header = () => {
            // titleFormatter runs during the Tabulator constructor (before
            // this._tabulator is assigned), so just render unchecked on first
            // paint. The dataLoaded callback re-syncs once Tabulator is up.
            return fmt_check_visual(false);
        };

        // Reset the selection set whenever we re-render the grid (tab switch,
        // refresh, item filter change) — selections don't survive a reload.
        this._selected = new Set();

        this._tabulator = new Tabulator($host[0], {
            data: rows,
            layout: "fitColumns",
            // v0.0.9.17 — variable row height so wrapped text doesn't get
            // clipped. Tabulator's "virtual" renderer breaks variable-height
            // sticky-header layout; "basic" renders all rows in DOM (fine
            // for a typical dashboard queue of <500 rows).
            renderVertical: "basic",
            responsiveLayout: false,
            height: "100%",
            // v0.0.9.25 — Tabulator's built-in row selection is DISABLED.
            // We use a controller-owned Set so the bulk-select column is
            // the only click target, leaving row body / action button clicks
            // free for View/drill-down.
            selectable: false,
            selectableRows: false,
            columns: [
                {
                    formatter: fmt_m3_check_cell,
                    titleFormatter: fmt_m3_check_header,
                    cssClass: "srt-mdcb-cell",
                    hozAlign: "center", headerSort: false, width: 56,
                    cellClick: (e, cell) => {
                        e.stopPropagation();
                        const r = cell.getRow();
                        const n = r.getData().name;
                        if (that._selected.has(n)) that._selected.delete(n);
                        else that._selected.add(n);
                        // Repaint the row so its checkbox formatter re-runs.
                        r.reformat();
                        that._sync_select_visual();
                    },
                    headerClick: (e) => {
                        e.stopPropagation();
                        const tab = that._tabulator;
                        if (!tab) return;
                        const all = tab.getRows("active");
                        const all_sel = all.length > 0
                            && all.every(r => that._selected.has(r.getData().name));
                        if (all_sel) {
                            all.forEach(r => that._selected.delete(r.getData().name));
                        } else {
                            all.forEach(r => that._selected.add(r.getData().name));
                        }
                        all.forEach(r => r.reformat());
                        that._sync_select_visual();
                    },
                },
                // v0.0.9.17 — width distribution rebalanced for text-wrap.
                // Doc/Status/Posting Date/action have fixed widths; Item,
                // Warehouse, Remark grow proportionally with `widthGrow`.
                // Min widths keep columns legible when the viewport narrows.
                { title: __("Doc"), field: "name", formatter: fmt_name,
                  width: 150, minWidth: 130 },
                { title: __("Status"), field: "workflow_state",
                  formatter: fmt_state_pill, width: 170, minWidth: 150 },
                { title: __("Item"), field: "item", formatter: fmt_item,
                  widthGrow: 3, minWidth: 200, headerSort: false },
                { title: __("Warehouse"), field: "default_warehouse",
                  formatter: fmt_warehouse, widthGrow: 2, minWidth: 140 },
                { title: __("Stock Found"),
                  field: "total_qty_found_in_default_uom",
                  formatter: fmt_uom_stack, hozAlign: "right",
                  width: 160, minWidth: 150 },
                { title: __("Stock as on Posting"),
                  field: "total_current_stock_in_default_uom",
                  formatter: fmt_uom_stack, hozAlign: "right",
                  width: 185, minWidth: 165 },
                { title: __("Posting Date"), field: "posting_date",
                  formatter: fmt_date, width: 130, minWidth: 110 },
                { title: __("User Remark"), field: "user_remark",
                  formatter: fmt_remark, widthGrow: 3, minWidth: 180 },
                { title: "", field: "name", formatter: fmt_action,
                  hozAlign: "center", headerSort: false, width: 56,
                  cellClick: (e, cell) => that._on_view(cell.getRow().getData()) },
            ],
            // v0.0.9.25 — only dataLoaded is needed now since we're not using
            // Tabulator's built-in row selection. rowSelectionChanged would
            // never fire with selectableRows: false. dataLoaded fires after
            // initial render so the master header checkbox shows correct state.
            dataLoaded: () => that._sync_select_visual(),
        });
    }

    // v0.0.9.25 — sync the master header checkbox from this._selected, and
    // refresh the bulk bar. Cell checkboxes paint via the formatter when
    // their row is reformat()'d in cellClick / headerClick.
    _sync_select_visual() {
        try {
            if (!this._tabulator) return;
            const rows = this._tabulator.getRows("active");
            const all_sel = rows.length > 0
                && rows.every(r => this._selected.has(r.getData().name));
            const any_sel = rows.some(r => this._selected.has(r.getData().name));
            const headerBox = $(this._tabulator.element)
                .find(".tabulator-headers .tabulator-col").first()
                .find(".srt-mdcb")[0];
            if (headerBox) {
                headerBox.classList.toggle("checked", all_sel);
                headerBox.classList.toggle("partial", any_sel && !all_sel);
            }
        } catch (e) { /* defensive */ }
        this._render_bulk_bar();
    }

    _render_empty_state() {
        this.$grid_slot.html(`
            <div class="md-card-elevated p-12 text-center">
                <div class="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center"
                     style="background: var(--md-sys-color-primary-container);">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         style="color: var(--md-sys-color-on-primary-container);">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                    </svg>
                </div>
                <div class="text-base font-semibold text-slate-900 mb-1">
                    ${this.current_tab === "Admin Approval Pending"
                        ? __("No SRTs pending Admin approval")
                        : __("No SRTs pending Super Admin approval")}
                    ${this.item_filter
                        ? ` <span class="text-slate-500 text-sm font-normal">(${__("for")} ${frappe.utils.escape_html(this.item_filter)})</span>`
                        : ""}
                </div>
                <div class="text-sm text-slate-500 mb-5 max-w-md mx-auto">
                    ${this.item_filter
                        ? __("Clear the item filter to see other queued reconciliations.")
                        : __("Nothing waiting at this stage. New reconciliations land here once a Srt User submits.")}
                </div>
                <button class="srt-empty-add md-btn md-btn-filled">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
                    </svg>
                    ${__("New SRT")}
                </button>
            </div>
        `);
        this.$grid_slot.find(".srt-empty-add").on("click", () => this._open_form_panel());
    }

    _render_bulk_bar() {
        // v0.0.9.25 — selection list now comes from controller-owned set
        // (this._selected) instead of Tabulator's getSelectedData(), since
        // Tabulator's row selection was disabled to avoid double-fire on
        // cellClick. Selection survives only within the current grid render;
        // re-rendering (tab switch, refresh, filter) clears the set.
        const names = Array.from(this._selected || []);
        if (!names.length || !this.is_admin) {
            this.$bulk_slot.empty();
            return;
        }
        // Material 3 snackbar pattern — bottom-centered, single elevation,
        // contained action buttons inside a slate-800 surface (inverse).
        this.$bulk_slot.html(`
            <div class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white
                        rounded-xl px-4 py-2 flex items-center gap-2 z-40
                        srt-anim-fade-in"
                 style="box-shadow: 0 4px 8px 3px rgb(15 23 42 / 0.18);">
                <span class="text-sm pl-2">
                    <span class="font-medium">${names.length}</span> ${__("selected")}
                </span>
                <button class="srt-bulk-approve md-btn md-btn-success" style="min-height: 32px; margin-left: 8px;">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                    </svg>
                    ${__("Approve")}
                </button>
                <button class="srt-bulk-clear md-btn md-btn-text" style="color: #cbd5e1; min-height: 32px;">
                    ${__("Clear")}
                </button>
            </div>
        `);
        const that = this;
        this.$bulk_slot.find(".srt-bulk-approve").on("click", () => {
            that._open_bulk_approve_dialog(names);
        });
        this.$bulk_slot.find(".srt-bulk-clear").on("click", () => {
            that._selected.clear();
            if (that._tabulator) {
                that._tabulator.getRows("active").forEach(r => r.reformat());
            }
            that._sync_select_visual();
        });
    }

    // v0.0.9.15: Bulk approve dialog with optional remark — admin_remark
    // when approving from "Admin Approval Pending" tab, super_admin_remark
    // when approving from "Super Admin Approval Pending" tab. The server
    // appends a [BULK …] audit-trail tag with timestamp + user before each
    // doc's approval is dispatched.
    _open_bulk_approve_dialog(names) {
        const that = this;
        const target_field_label = this.current_tab === "Super Admin Approval Pending"
            ? __("Super Admin Remark")
            : __("Admin Remark");
        const d = new frappe.ui.Dialog({
            title: __("Bulk approve — {0} SRTs", [names.length]),
            size: "large",
            fields: [
                { fieldtype: "HTML", fieldname: "summary",
                  options: `
                    <div class="md-card-elevated p-3 mb-2"
                         style="background: var(--md-sys-color-surface-container, #f1f5f9);">
                        <div class="text-sm text-slate-700">
                            ${__("This will approve {0} selected SRTs from <b>{1}</b>. The remark below (optional) is appended to every selected doc's <b>{2}</b> with a <span class='font-mono'>[BULK]</span> audit-trail tag, before approval is dispatched.",
                                [names.length, this.current_tab, target_field_label])}
                        </div>
                    </div>` },
                { fieldtype: "Text Editor", fieldname: "bulk_remark",
                  label: target_field_label,
                  description: __("Optional. Leave blank to approve without writing a remark.") },
                { fieldtype: "Section Break" },
                { fieldtype: "HTML", fieldname: "names_list",
                  options: `
                    <div class="text-xs text-slate-500 mb-1">
                        ${__("Selected SRTs")}:
                    </div>
                    <div class="flex flex-wrap gap-1">
                        ${names.map(n =>
                            `<span class="md-chip"><span class="font-mono">${frappe.utils.escape_html(n)}</span></span>`
                        ).join("")}
                    </div>` },
            ],
            primary_action_label: __("Approve {0}", [names.length]),
            primary_action: (values) => {
                d.hide();
                const remark = (values.bulk_remark || "").trim();
                that._do_bulk_approve(names, remark);
            },
            secondary_action_label: __("Cancel"),
            secondary_action: () => d.hide(),
        });
        d.show();
    }

    _do_bulk_approve(names, bulk_remark) {
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.bulk_approve_srt",
            args: { srt_names: names, bulk_remark: bulk_remark || null },
            freeze: true,
            freeze_message: __("Approving…"),
        }).then(r => {
            const results = r.message || [];
            const oks  = results.filter(x => x.ok).length;
            const errs = results.filter(x => !x.ok);
            if (errs.length === 0) {
                frappe.show_alert({ message: __("Approved {0} SRTs", [oks]), indicator: "green" });
            } else {
                let html = `<div><b>${__("Bulk approve")}</b></div>`;
                html += `<div class="text-success">${__("Succeeded")}: ${oks}</div>`;
                html += `<div class="text-danger mt-2">${__("Failed")}: ${errs.length}</div>`;
                html += `<ul>` + errs.map(e =>
                    `<li><b>${frappe.utils.escape_html(e.name)}</b>: ${frappe.utils.escape_html(e.error || "")}</li>`
                ).join("") + `</ul>`;
                frappe.msgprint({ title: __("Bulk approve"), message: html, indicator: "orange" });
            }
            this._load_counts_then_grid();
        });
    }

    _on_view(row_data) {
        const that = this;
        const dlg = new frappe.ui.Dialog({
            title: `${row_data.name} — ${row_data.item}`,
            size: "extra-large",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        dlg.show();
        const $body = $(dlg.fields_dict.body.wrapper).addClass("srt-dash-root");
        $body.html(`
            <div class="srt-dash-skeleton h-10 rounded-md mb-2"></div>
            <div class="srt-dash-skeleton h-10 rounded-md mb-2"></div>
            <div class="srt-dash-skeleton h-10 rounded-md"></div>
        `);
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_batch_summary",
            args: { srt_name: row_data.name },
        }).then(r => that._render_view_modal(dlg, row_data, r.message || []));
    }

    _render_view_modal(dlg, row_data, summary) {
        const that = this;
        const $body = $(dlg.fields_dict.body.wrapper);
        // v0.0.9.20 — let Tabulator own the scroll so its sticky header
        // works. Outer wrapper just clips for the rounded corner.
        $body.html(`
            <div class="srt-view-meta flex items-center gap-2 flex-wrap mb-2 text-xs text-slate-600">
                <span class="md-chip">
                    <span class="text-slate-500 mr-1">${__("Item")}</span>
                    <span class="font-mono">${frappe.utils.escape_html(row_data.item || "—")}</span>
                    ${row_data.item_name && row_data.item_name !== row_data.item
                        ? `<span class="text-slate-400 mx-1">·</span><span class="text-slate-700">${frappe.utils.escape_html(row_data.item_name)}</span>`
                        : ""}
                </span>
                <span class="md-chip">
                    <span class="text-slate-500 mr-1">${__("Warehouse")}</span>
                    <span>${frappe.utils.escape_html(row_data.default_warehouse || "—")}</span>
                </span>
                <span class="md-chip">
                    <span class="text-slate-500 mr-1">${__("Posting")}</span>
                    <span>${row_data.posting_date ? moment(row_data.posting_date).format("DD MMM YYYY") : ""}
                          ${row_data.posting_time ? " " + moment(row_data.posting_time, "HH:mm:ss").format("hh:mm A") : ""}</span>
                </span>
                <!-- v0.0.9.31 — In/Out colour legend (cells no longer carry
                     the "In"/"Out" words; direction is shown by chip colour). -->
                <span class="md-chip">
                    <span class="w-2 h-2 rounded-full" style="background:#059669;"></span>
                    <span class="ml-1 mr-2">${__("In")}</span>
                    <span class="w-2 h-2 rounded-full" style="background:#e11d48;"></span>
                    <span class="ml-1">${__("Out")}</span>
                </span>
            </div>
            <!-- v0.0.9.28 — Tabulator's .tabulator-tableholder owns both
                 vertical AND horizontal scroll, so the outer container just
                 clips for the rounded corner. Fixed height (not min/max)
                 because Tabulator needs a known height to lay out the
                 tableholder; otherwise sticky header + internal scroll fail. -->
            <div class="srt-view-grid md-card overflow-hidden"
                 style="height: 50vh; min-height: 280px;"></div>
            <div class="text-xs text-slate-500 mt-2 mb-3">
                ${__("Click any In/Out cell to drill down to per-SLE detail.")}
            </div>
            <!-- v0.0.9.25 — read-only existing-remarks block. Shows all
                 three remark fields (user/admin/super_admin) so approvers
                 see the operator + previous approver's notes before acting.
                 Each block hidden when empty (no clutter). -->
            <div class="srt-view-existing-remarks mb-3"></div>
            <!-- v0.0.9.21 — editable remark panel for the field the user
                 can edit at the current workflow_state per the controller's
                 _enforce_remark_field_permissions gates. -->
            <div class="srt-view-remarks-section"></div>
        `);

        // Render existing remarks (always visible when non-empty).
        const $existing = $body.find(".srt-view-existing-remarks");
        const remark_cards = [
            { field: "user_remark",        label: __("User Remark"),
              icon_color: "#475569", chip: "slate" },
            { field: "admin_remark",       label: __("Admin Remark"),
              icon_color: "#d97706", chip: "amber" },
            { field: "super_admin_remark", label: __("Super Admin Remark"),
              icon_color: "#4f46e5", chip: "indigo" },
        ].filter(c => (row_data[c.field] || "").trim()).map(c => `
            <div class="md-card-elevated p-3 mb-2">
                <div class="flex items-center gap-2 mb-1.5">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         style="color: ${c.icon_color};">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
                    </svg>
                    <span class="text-sm font-semibold text-slate-900">${c.label}</span>
                </div>
                <div class="text-sm text-slate-700 srt-existing-remark-body">${row_data[c.field]}</div>
            </div>`).join("");
        if (remark_cards) {
            $existing.html(remark_cards);
        }
        const $grid = $body.find(".srt-view-grid");

        // v0.0.9.20 — Material 3 formatters with clear vertical hierarchy.
        // In/Out cells now render as a TWO-LINE block (in on top, out below)
        // so values stay aligned column-to-column regardless of magnitude.
        const fmt_origin = cell => {
            const o = cell.getValue();
            if (!o) return '<span class="text-xs text-slate-400">—</span>';
            const dt = o.posting_date
                ? `${moment(o.posting_date).format("DD MMM YYYY")}${o.posting_time ? " " + moment(o.posting_time, "HH:mm:ss").format("hh:mm A") : ""}`
                : "";
            return `
                <div class="leading-tight w-full">
                    <div class="text-sm text-slate-900 font-medium truncate"
                         title="${frappe.utils.escape_html(o.voucher_type)} ${frappe.utils.escape_html(o.voucher_no)}">
                        ${frappe.utils.escape_html(o.voucher_type)}
                    </div>
                    <div class="font-mono text-xs text-slate-600 truncate mt-0.5">
                        ${frappe.utils.escape_html(o.voucher_no)}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">${dt}</div>
                </div>`;
        };
        const fmt_inout = cell => {
            const v = cell.getValue() || { in: 0, out: 0 };
            const in_v  = Number(v.in)  || 0;
            const out_v = Number(v.out) || 0;
            const r = cell.getRow().getData();
            // v0.0.9.32 — opening balance (batch qty AS OF the origin / last SR,
            // in stock UOM, computed server-side) shown as a neutral slate chip
            // ABOVE the In/Out chips. Which balance depends on the column:
            // origin cell → qty_at_origin; last-SR cell → qty_at_last_sr.
            const opening = cell.getField() === "summary_lastsr_to_posting"
                ? r.qty_at_last_sr : r.qty_at_origin;
            const has_opening = opening !== undefined && opening !== null;
            if (!in_v && !out_v && !has_opening) return '<span class="text-xs text-slate-400">—</span>';
            // v0.0.9.30/31 — dual-UOM box-bubble chips. In/Out word labels
            // removed; direction is colour-coded (emerald = In, rose = Out)
            // with a legend in the modal header. SLE sums are in STOCK UOM;
            // srt_uom_chips converts to the higher UOM via higher_uom_cf.
            const su = row_data.default_uom, hu = row_data.higher_uom, hcf = row_data.higher_uom_cf;
            let html = `<div class="srt-inout-stack w-full cursor-pointer"
                 title="${__("Green = In · Red = Out · click for per-SLE drill-down")}">`;
            if (has_opening) {
                html += `<div class="srt-io-open"><span class="srt-io-open-lbl">${__("Qty")}</span>`
                      + srt_uom_chips(opening, su, hu, hcf, { tone: "slate" }) + `</div>`;
            }
            html += srt_uom_chips(in_v, su, hu, hcf, { tone: "emerald" });
            html += `<div class="mt-1">${srt_uom_chips(out_v, su, hu, hcf, { tone: "rose" })}</div>`;
            return html + `</div>`;
        };
        const fmt_last_sr = cell => {
            const v = cell.getValue();
            if (!v) return '<span class="text-xs text-slate-400">—</span>';
            return `
                <div class="leading-tight">
                    <div class="text-sm text-slate-900">${moment(v).format("DD MMM YYYY")}</div>
                    <div class="text-xs text-slate-500 mt-0.5">${moment(v).format("hh:mm A")}</div>
                </div>`;
        };
        const fmt_batch_no = c => `
            <span class="font-mono text-sm text-slate-900 truncate"
                  title="${frappe.utils.escape_html(c.getValue() || "")}">
                ${frappe.utils.escape_html(c.getValue() || "")}
            </span>`;

        // v0.0.9.22 — Reconcile-state pill. Three visual states the user
        // needs to scan at a glance in the view modal:
        //   1. Not counted (is_counted=0)  → low-light row (gray pill, dim row)
        //   2. Matched   (is_counted=1, qty_found ≈ current)  → neutral pill
        //   3. Real delta (is_counted=1, delta ≠ 0) → actionable highlight
        const compute_reco_state = (r) => {
            if (!r.is_counted) {
                return { kind: "uncounted", label: __("No change"),
                         bg: "#f1f5f9", fg: "#64748b", dot: "#94a3b8" };
            }
            const cf = Number(r.conversion_factor) || 1;
            const found_in_stock = (Number(r.qty_found) || 0) * cf;
            const current_in_stock = Number(r.current_stock_in_stock_uom) || 0;
            const delta = found_in_stock - current_in_stock;
            if (Math.abs(delta) < 0.001) {
                return { kind: "matched", label: __("Matched"),
                         bg: "#d1fae5", fg: "#065f46", dot: "#059669" };
            }
            const delta_sel = (Number(r.qty_found) || 0) - (Number(r.current_stock_in_selected_uom) || 0);
            // v0.0.9.29 — BUGFIX: the View-modal "State" column rendered raw
            // HTML tags (e.g. "<div style='text-al…"). Root cause chain:
            //   1. frappe.format(x, {fieldtype:"Float"}) (and Int/Currency/
            //      Percent) wraps its output in
            //      `<div style='text-align: right'>…</div>` for number types.
            //   2. That markup became part of this *text* `label`.
            //   3. fmt_reco_state() (below) renders the pill text via
            //      `frappe.utils.escape_html(s.label)` — correct for a text
            //      node — which escaped the <div> into visible `&lt;div…`.
            // Fix: use format_number() (window.format_number, frappe core) —
            // it returns the locale-formatted number as PLAIN text, no wrapper.
            // RESTRICT: never feed frappe.format(..., {fieldtype:"Float"|"Int"|
            // "Currency"|"Percent"}) into a text node / escape_html() — always
            // format_number() or frappe.utils.strip_html() it first.
            // See srt_dashboard.md § "6a. State column HTML-leak fix".
            if (delta_sel > 0) {
                return { kind: "over", label: `+${format_number(delta_sel)} ${r.select_uom || ""}`,
                         delta_stock: delta,
                         bg: "#fef3c7", fg: "#92400e", dot: "#d97706" };
            }
            return { kind: "short", label: `${format_number(delta_sel)} ${r.select_uom || ""}`,
                     delta_stock: delta,
                     bg: "#fee2e2", fg: "#991b1b", dot: "#dc2626" };
        };
        const fmt_reco_state = (cell) => {
            const r = cell.getRow().getData();
            const s = compute_reco_state(r);
            // v0.0.9.33 — "Difference" column. over/short render the delta in
            // BOTH UOMs as box-bubble chips, ALWAYS amber/orange — never rose,
            // because rose = Out and would read as an outward movement. The
            // sign (+/−) carries over vs short. Hover shows the calculation.
            if (s.kind === "over" || s.kind === "short") {
                const su = row_data.default_uom, hu = row_data.higher_uom, hcf = row_data.higher_uom_cf;
                const cf = Number(r.conversion_factor) || 1;
                const found = (Number(r.qty_found) || 0) * cf;
                const current = Number(r.current_stock_in_stock_uom) || 0;
                const tip = `${__("Difference")} = ${__("Counted")} (${format_number(found)}) − ${__("Current stock")} (${format_number(current)}) = ${format_number(s.delta_stock)} ${su}`;
                return `<span title="${frappe.utils.escape_html(tip)}">`
                    + srt_uom_chips(s.delta_stock, su, hu, hcf, { tone: "amber" })
                    + `</span>`;
            }
            const tip2 = s.kind === "matched"
                ? __("Counted qty equals current stock — no difference.")
                : __("Batch not counted in this reconciliation — no change.");
            return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap"
                          title="${frappe.utils.escape_html(tip2)}"
                          style="background: ${s.bg}; color: ${s.fg};">
                        <span class="w-1.5 h-1.5 rounded-full" style="background: ${s.dot};"></span>
                        ${frappe.utils.escape_html(s.label)}
                    </span>`;
        };

        new Tabulator($grid[0], {
            // v0.0.9.33 — hide "No change" (uncounted) batches from the View
            // modal. Only batches actually counted in this reconciliation
            // (is_counted=1) are relevant to an approver; uncounted rows just
            // retain their prior Bin qty and added noise. Filtered client-side
            // so get_batch_summary stays a faithful full snapshot.
            data: (summary || []).filter(r => r && r.is_counted),
            // v0.0.9.28 — switched from "fitColumns" to "fitColumns" with
            // `responsiveLayout: false` PLUS horizontal scroll on the holder.
            // The issue with plain fitColumns: when total minWidth exceeds
            // available width, Tabulator silently squeezes columns BELOW
            // their minWidth instead of overflowing, which clipped the
            // Origin block / In-Out stack / reconcile-state pill on narrow
            // dialogs. Using fitDataStretch instead: respects each column's
            // natural+min width AND stretches the last column to fill any
            // remainder. Wider tables overflow horizontally inside
            // .srt-view-grid (CSS scoped below sets overflow-x: auto).
            layout: "fitDataStretch",
            renderVertical: "basic",
            responsiveLayout: false,
            height: "100%",
            placeholder: __("No batches in this SRT"),
            // v0.0.9.22 — rowFormatter low-lights uncounted (no change)
            // rows + highlights actionable (real delta) rows. The
            // background tints + opacity make the modal scannable: an
            // approver immediately sees which batches drive the ledger
            // movements vs which were just inspected and left as-is.
            rowFormatter: (row) => {
                const r = row.getData();
                const s = compute_reco_state(r);
                const el = row.getElement();
                el.style.removeProperty("border-left");
                el.style.removeProperty("background");
                el.style.removeProperty("opacity");
                if (s.kind === "uncounted") {
                    el.style.opacity = "0.6";
                    el.style.borderLeft = "3px solid transparent";
                } else if (s.kind === "matched") {
                    el.style.borderLeft = `3px solid ${s.dot}`;
                    el.style.background = "rgba(16, 185, 129, 0.04)";
                } else {
                    // over / short — actionable
                    el.style.borderLeft = `3px solid ${s.dot}`;
                    el.style.background = (s.kind === "over")
                        ? "rgba(217, 119, 6, 0.06)"
                        : "rgba(220, 38, 38, 0.06)";
                }
            },
            // v0.0.9.28 — explicit pixel widths so columns can't get
            // squeezed below readable size; horizontal scroll kicks in on
            // narrow viewports.
            columns: [
                // v0.0.9.31 — headerSort:false on EVERY view-modal column
                // (user: no sorting on the modal table). In/Out columns
                // narrowed (no more "In"/"Out" words → colour-coded chips).
                { title: __("Batch"), field: "batch_no",
                  formatter: fmt_batch_no, width: 160, headerSort: false },
                { title: __("Difference"), field: "is_counted",
                  formatter: fmt_reco_state, width: 165, headerSort: false },
                { title: __("Origin"), field: "origin",
                  formatter: fmt_origin, width: 220, headerSort: false },
                { title: __("Origin → Posting"), field: "summary_origin_to_posting",
                  formatter: fmt_inout, width: 160, minWidth: 150, hozAlign: "right", headerSort: false,
                  cellClick: (e, c) => that._on_drilldown(row_data, c.getRow().getData(), "origin") },
                { title: __("Last SR"), field: "last_sr_date",
                  formatter: fmt_last_sr, width: 150, headerSort: false },
                { title: __("Last SR → Posting"), field: "summary_lastsr_to_posting",
                  formatter: fmt_inout, width: 160, minWidth: 150, hozAlign: "right", headerSort: false,
                  cellClick: (e, c) => that._on_drilldown(row_data, c.getRow().getData(), "lastsr") },
            ],
        });

        // v0.0.9.29 — Tabulator-in-Dialog timing fix.
        // The Frappe Dialog opens with a CSS transition; when our HTML is
        // injected and Tabulator instantiates, the .srt-view-grid host's
        // height:50vh has not yet resolved to actual pixels (modal-content
        // is still mid-animation). Tabulator measures 0px, lays out
        // accordingly, and the batch table appears blank/hidden until the
        // browser resizes (which triggers Tabulator's own resize observer).
        //
        // Fix: capture the instance and call redraw(true) on the next
        // animation frame AND once the dialog reports its shown event.
        // Also a defensive 200ms fallback in case the dialog signals shown
        // synchronously before paint completes.
        //
        // RESTRICT: Do NOT remove the redraw chain — without it, every
        // first-open of the view modal shows an empty/clipped grid until
        // the user resizes their browser. The two extra redraws are cheap
        // (Tabulator no-ops if dimensions are unchanged).
        const _view_tab = this.__last_view_tabulator =
            $grid[0].querySelector(".tabulator")
                ? Tabulator.findTable($grid[0])[0]
                : null;
        const redraw_view = () => {
            try {
                const inst = Tabulator.findTable($grid[0])[0];
                if (inst) inst.redraw(true);
            } catch (e) { /* defensive */ }
        };
        requestAnimationFrame(() => requestAnimationFrame(redraw_view));
        setTimeout(redraw_view, 200);
        // Frappe Dialog fires "shown.bs.modal" when transition completes —
        // the most reliable time to measure final dimensions.
        try {
            $(dlg.$wrapper).off("shown.bs.modal.srtview").on("shown.bs.modal.srtview", redraw_view);
        } catch (e) { /* defensive */ }

        const labels = {
            "Draft":                { approve: __("Approve"), reject: __("Reject") },
            "Admin Approval":       { approve: __("Approve"), reject: __("Reject") },
            "Super Admin Approval": { approve: __("Close"),   reject: __("Reject") },
        };
        const lab = labels[this.current_tab] || labels["Draft"];
        const can_approve = this.is_admin;
        const can_reject  = this.is_admin;

        // v0.0.9.21 — Remarks panel above the action bar. Field surfaced
        // matches the controller's _enforce_remark_field_permissions gates:
        //   workflow_state "Draft" / "" → admin_remark (writable by Srt Admin)
        //   workflow_state "Admin Approval" → super_admin_remark (Srt Super Admin)
        // The existing value is pre-loaded so admins can extend rather than
        // overwrite. On Approve, the value is read out, prefixed with the
        // [via SRT Dashboard …] tag server-side, and persisted before the
        // workflow advance dispatches.
        const $remarks_section = $body.find(".srt-view-remarks-section");
        const doc_state = (row_data.workflow_state || "Draft").trim();
        let remark_ctrl = null;
        let target_field = null;
        let target_label = null;
        // v0.0.9.33 — access check on the editable remark: admin_remark is
        // editable only by a Srt Admin (Draft stage); super_admin_remark only
        // by a Srt Super Admin (Admin Approval stage). Mirrors the controller's
        // _enforce_remark_field_permissions so the UI never offers a field the
        // server will reject. (is_super ⊆ is_admin, see roles setup.)
        const _can_edit_remark = (doc_state === "Admin Approval") ? this.is_super : this.is_admin;
        if (_can_edit_remark && (doc_state === "Draft" || doc_state === "" || doc_state === "Admin Approval")) {
            target_field = (doc_state === "Admin Approval") ? "super_admin_remark" : "admin_remark";
            target_label = (target_field === "super_admin_remark")
                ? __("Super Admin Remark")
                : __("Admin Remark");
            const existing_remark = row_data[target_field] || "";
            $remarks_section.html(`
                <div class="md-card-elevated p-4 mb-2">
                    <div class="flex items-center gap-2 mb-2">
                        <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                        <span class="text-sm font-semibold text-slate-900">${target_label}</span>
                        <span class="text-xs text-slate-500">
                            ${__("Optional — appended to existing remark before approval.")}
                        </span>
                    </div>
                    <!-- v0.0.9.25 — the read-only existing remarks block
                         above already shows the current value, so the
                         editable panel just hosts the new-input editor. -->
                    <div class="srt-view-remark-host"></div>
                </div>
            `);
            const $host = $remarks_section.find(".srt-view-remark-host");
            remark_ctrl = frappe.ui.form.make_control({
                df: { fieldtype: "Text Editor", fieldname: "approval_remark", label: "" },
                parent: $host[0],
                render_input: true,
            });
        }

        if (can_approve) {
            dlg.set_primary_action(lab.approve, () => {
                const remark = remark_ctrl ? (remark_ctrl.get_value() || "").trim() : "";
                frappe.call({
                    method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.approve_srt",
                    args: { srt_name: row_data.name, remark: remark || null },
                    freeze: true, freeze_message: __("Approving…"),
                }).then(r => {
                    const m = r.message || {};
                    if (m.ok) {
                        frappe.show_alert({
                            message: __("Approved: {0} → {1}", [row_data.name, m.new_state || "Close"]),
                            indicator: "green",
                        });
                        dlg.hide();
                        this._load_counts_then_grid();
                    }
                });
            });
        }
        if (can_reject) {
            dlg.set_secondary_action_label(lab.reject);
            dlg.set_secondary_action(() => {
                frappe.prompt({
                    fieldtype: "Small Text", fieldname: "reason",
                    label: __("Reason"), reqd: 1,
                }, (vals) => {
                    frappe.call({
                        method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.reject_srt",
                        args: { srt_name: row_data.name, reason: vals.reason },
                        freeze: true, freeze_message: __("Rejecting…"),
                    }).then(r => {
                        if (r.message && r.message.ok) {
                            frappe.show_alert({
                                message: __("Rejected: {0}", [row_data.name]),
                                indicator: "red",
                            });
                            dlg.hide();
                            this._load_counts_then_grid();
                        }
                    });
                }, __("Reject {0}", [row_data.name]), __("Reject"));
            });
        }
        if (this.current_tab === "Draft") {
            dlg.add_custom_action(__("Edit"), () => {
                dlg.hide();
                this._open_form_panel(row_data.name);
            });
        }
    }

    _on_drilldown(srt_row, batch_row, which) {
        let from_date = null;
        if (which === "origin" && batch_row.origin) from_date = batch_row.origin.posting_date;
        else if (which === "lastsr" && batch_row.last_sr_date) from_date = String(batch_row.last_sr_date).slice(0, 10);
        if (!from_date) {
            frappe.msgprint({
                title: __("Unavailable"),
                message: __("No origin or last SR timestamp for batch {0}", [batch_row.batch_no]),
                indicator: "orange",
            });
            return;
        }
        const to_date = srt_row.posting_date;
        const dlg = new frappe.ui.Dialog({
            title: __("Batch {0}", [batch_row.batch_no]),
            size: "large",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        dlg.show();
        const $body = $(dlg.fields_dict.body.wrapper).addClass("srt-dash-root");
        $body.html(`<div class="srt-dash-skeleton h-32 rounded-md"></div>`);
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_batch_drilldown",
            args: {
                item_code: srt_row.item, warehouse: srt_row.default_warehouse,
                batch_no: batch_row.batch_no, from_date: from_date, to_date: to_date,
            },
        }).then(r => this._render_drilldown(dlg, r.message || { in: [], out: [] }, srt_row));
    }

    _render_drilldown(dlg, data, srt_row) {
        const $body = $(dlg.fields_dict.body.wrapper);
        // v0.0.9.30 — srt_row carries default_uom / higher_uom / higher_uom_cf
        // so each SLE qty + the column total render as dual-UOM chips.
        const su = srt_row ? srt_row.default_uom : "";
        const hu = srt_row ? srt_row.higher_uom : "";
        const hcf = srt_row ? srt_row.higher_uom_cf : 0;
        const col_html = (entries, color, label) => {
            const total = entries.reduce((s, e) => s + Number(e.qty || 0), 0);
            const list = entries.length
                ? entries.map(e => `
                    <div class="border-b border-slate-100 py-2">
                        <div class="text-sm text-slate-900">
                            ${frappe.utils.escape_html(e.voucher_type)}
                            <span class="font-mono text-xs text-slate-600 ml-1">${frappe.utils.escape_html(e.voucher_no)}</span>
                        </div>
                        <div class="text-xs text-slate-500 mt-0.5 flex items-center justify-between gap-2">
                            <span>${moment(e.posting_datetime).format("DD MMM YYYY HH:mm")}</span>
                            ${srt_uom_chips(e.qty, su, hu, hcf, { tone: color === "rose" ? "rose" : "emerald" })}
                        </div>
                    </div>`).join("")
                : `<div class="text-sm text-slate-400 py-6 text-center">${__("None in window")}</div>`;
            return `
                <div class="md-card p-4">
                    <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                        <h5 class="text-sm font-semibold text-${color}-700 m-0 flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full bg-${color}-500"></span>
                            ${label}
                        </h5>
                        ${srt_uom_chips(total, su, hu, hcf, { tone: color === "rose" ? "rose" : "emerald" })}
                    </div>
                    <div style="max-height: 40vh; overflow-y: auto;">${list}</div>
                </div>`;
        };
        $body.html(`
            <div class="grid grid-cols-2 gap-4">
                ${col_html(data.out || [], "rose", __("Out"))}
                ${col_html(data.in  || [], "emerald", __("In"))}
            </div>
        `);
    }

    // ── Contained slide-down form panel ───────────────────────────────
    _open_form_panel(edit_name = null) {
        document.body.style.overflow = "hidden";
        // v0.0.9.13: panel + backdrop must respect Frappe's left sidebar
        // (.layout-side-section / .body-sidebar) so it stays visible and
        // navigable. Compute the main content area's left edge dynamically
        // — the offset varies (collapsed vs expanded sidebar, mobile, etc).
        const navbar_h = $(".navbar").outerHeight() || 56;
        let content_left = 0;
        // Try common Frappe v15+ selectors in priority order
        const $main = $(".layout-main, .page-container, .content").filter(":visible").first();
        if ($main.length) {
            try {
                const rect = $main[0].getBoundingClientRect();
                content_left = Math.max(0, Math.floor(rect.left));
            } catch (e) { /* fallback to 0 */ }
        }
        this.$backdrop_slot.html(`
            <div class="srt-backdrop srt-anim-fade-in"
                 style="position: fixed; left: ${content_left}px; right: 0;
                        top: ${navbar_h}px; bottom: 0;
                        background: rgba(15, 23, 42, 0.35);
                        backdrop-filter: blur(2px); z-index: 1010;"></div>
        `);
        this.$panel_slot.html(`
            <div class="srt-form-panel bg-white srt-anim-slide-down flex flex-col
                        border-b border-slate-200 shadow-sm"
                 style="position: fixed; left: ${content_left}px; right: 0;
                        top: ${navbar_h}px; bottom: 0;
                        z-index: 1015; overflow: hidden;">
                <div class="srt-form-panel-inner w-full h-full flex flex-col
                            overflow-hidden relative"></div>
            </div>
        `);
        this.$backdrop_slot.find(".srt-backdrop").on("click", () => this._close_form_panel());
        this._esc_handler = (e) => { if (e.key === "Escape") this._close_form_panel(); };
        document.addEventListener("keydown", this._esc_handler);

        // v0.0.9.13: Recompute panel + backdrop offsets if the user toggles
        // the Frappe sidebar (or resizes the window) while the panel is open
        this._resize_handler = () => {
            const nh = $(".navbar").outerHeight() || 56;
            const $m = $(".layout-main, .page-container, .content").filter(":visible").first();
            let cl = 0;
            if ($m.length) try { cl = Math.max(0, Math.floor($m[0].getBoundingClientRect().left)); } catch (e) {}
            this.$backdrop_slot.find(".srt-backdrop").css({ left: `${cl}px`, top: `${nh}px` });
            this.$panel_slot.find(".srt-form-panel").css({ left: `${cl}px`, top: `${nh}px` });
        };
        window.addEventListener("resize", this._resize_handler);

        this._form_panel = new SRTFormPanel({
            $host: this.$panel_slot.find(".srt-form-panel-inner"),
            name: edit_name,
            on_close: () => this._close_form_panel(),
            on_saved: () => {
                this._close_form_panel();
                this._load_counts_then_grid();
            },
        });
        this._form_panel.start();
    }

    _close_form_panel() {
        document.body.style.overflow = "";
        this.$panel_slot.empty();
        this.$backdrop_slot.empty();
        if (this._esc_handler) {
            document.removeEventListener("keydown", this._esc_handler);
            this._esc_handler = null;
        }
        if (this._resize_handler) {
            window.removeEventListener("resize", this._resize_handler);
            this._resize_handler = null;
        }
        this._form_panel = null;
    }

    _subscribe_realtime() {
        try {
            frappe.realtime.doctype_subscribe("Stock Reconciliation SRT");
            frappe.realtime.on("list_update", (data) => {
                if (data && data.doctype === "Stock Reconciliation SRT") {
                    this._reload_counts();
                    if (this._tabulator) this._load_grid(true);
                }
            });
        } catch (e) {
            console.warn("[SRT Dashboard] realtime subscribe failed:", e);
        }
    }
}

// =============================================================================
// SRTFormPanel — slide-down form (replaces /app/srt-form)
// =============================================================================
class SRTFormPanel {
    constructor({ $host, name, on_close, on_saved }) {
        this.$host = $host;
        this.name = name;
        this.on_close = on_close;
        this.on_saved = on_saved;
        this.state = {};
        this.meta = null;
    }

    start() {
        this._render_loading();
        Promise.all([this._load_meta(), this._load_state()])
            .then(() => this._render())
            .catch(err => this._show_error(err.message || String(err)));
    }

    _render_loading() {
        this.$host.html(`
            <div class="p-6 w-full max-w-[1600px] mx-auto flex-1">
                <div class="srt-dash-skeleton h-10 w-1/3 rounded-md mb-6"></div>
                <div class="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-6">
                    <div class="xl:col-span-7 srt-dash-skeleton h-48 rounded-md"></div>
                    <div class="xl:col-span-5 srt-dash-skeleton h-48 rounded-md"></div>
                </div>
                <div class="srt-dash-skeleton h-64 rounded-md"></div>
            </div>
        `);
    }

    _load_meta() {
        return frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_form_meta",
        }).then(r => { this.meta = r.message; });
    }

    _load_state() {
        return frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.load_srt_form",
            args: { name: this.name },
        }).then(r => {
            this.state = Object.assign({ batches: [] }, r.message || {});
            // v0.0.9.16: belt-and-braces — guarantee posting_date + posting_time
            // are populated even if the server response somehow omitted them.
            // Frappe Time control rejects empty + microseconds, so we set
            // explicit safe defaults here.
            if (!this.state.posting_date) {
                this.state.posting_date = frappe.datetime.nowdate();
            }
            if (!this.state.posting_time) {
                this.state.posting_time = frappe.datetime.now_time().slice(0, 8);
            } else if (this.state.posting_time.length > 8) {
                // Strip microseconds — Time control parses only HH:MM:SS
                this.state.posting_time = this.state.posting_time.slice(0, 8);
            }
        });
    }

    _render() {
        const title = this.state.is_new
            ? __("New Stock Reconciliation")
            : __("Edit {0}", [this.state.name]);
        const state = this.state.workflow_state || "Draft";
        const state_palette = {
            "Draft":                "bg-slate-100 text-slate-700",
            "Admin Approval":       "bg-amber-50 text-amber-700",
            "Super Admin Approval": "bg-indigo-50 text-indigo-700",
            "Approved By System":   "bg-emerald-50 text-emerald-700",
            "Close":                "bg-slate-100 text-slate-500",
        };
        const state_cls = state_palette[state] || state_palette["Draft"];

        // Material 3 audit strip — assist chips on surface-1 tint
        // v0.0.9.14: added naming_series + amended_from chips for full
        // DocType parity (every json field reachable from the dashboard form)
        const audit_html = !this.state.is_new ? `
            <div class="flex flex-wrap items-center gap-2 px-6 py-3
                        bg-slate-50 border-b border-slate-200 text-xs">
                <span class="md-chip">
                    <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <span class="text-slate-500 mr-1">${__("Doc")}</span>
                    <span class="font-mono">${frappe.utils.escape_html(this.state.name || "")}</span>
                </span>
                ${this.state.naming_series ? `
                    <span class="md-chip" title="${__("Naming series this doc was created under")}">
                        <span class="text-slate-500 mr-1">${__("Series")}</span>
                        <span class="font-mono">${frappe.utils.escape_html(this.state.naming_series)}</span>
                    </span>` : ""}
                <span class="md-chip" style="background: ${state_cls.includes('amber') ? '#fef3c7' : state_cls.includes('indigo') ? '#e0e7ff' : state_cls.includes('emerald') ? '#d1fae5' : '#f1f5f9'};">
                    <span class="w-1.5 h-1.5 rounded-full" style="background: ${state_cls.includes('amber') ? '#d97706' : state_cls.includes('indigo') ? '#4f46e5' : state_cls.includes('emerald') ? '#059669' : '#64748b'};"></span>
                    ${frappe.utils.escape_html(state)}
                </span>
                ${this.state.amended_from ? `
                    <a href="/app/stock-reconciliation-srt/${frappe.utils.escape_html(this.state.amended_from)}"
                       target="_blank"
                       class="md-chip hover:bg-amber-50 hover:border-amber-200 transition-colors"
                       style="color: #b45309; text-decoration: none;"
                       title="${__("This doc is an amendment of the linked original")}">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                        </svg>
                        <span class="text-slate-500 mr-1">${__("Amended from")}</span>
                        <span class="font-mono">${frappe.utils.escape_html(this.state.amended_from)}</span>
                    </a>` : ""}
                ${this.state.admin_approved_by ? `
                    <span class="md-chip">
                        <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                        </svg>
                        <span class="text-slate-500 mr-1">${__("Admin")}</span>
                        <span>${frappe.utils.escape_html(this.state.admin_approved_by)}</span>
                    </span>` : ""}
                ${this.state.super_admin_approved_by ? `
                    <span class="md-chip">
                        <svg class="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                        </svg>
                        <span class="text-slate-500 mr-1">${__("Super Admin")}</span>
                        <span>${frappe.utils.escape_html(this.state.super_admin_approved_by)}</span>
                    </span>` : ""}
                ${this.state.linked_erpnext_sr ? `
                    <a href="/app/stock-reconciliation/${frappe.utils.escape_html(this.state.linked_erpnext_sr)}"
                       target="_blank"
                       class="md-chip hover:bg-indigo-50 hover:border-indigo-200 transition-colors ml-auto"
                       style="color: #4f46e5; text-decoration: none;">
                        <span class="text-slate-500 mr-1">${__("Linked SR")}</span>
                        <span class="font-mono">${frappe.utils.escape_html(this.state.linked_erpnext_sr)}</span>
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                        </svg>
                    </a>` : ""}
            </div>
        ` : "";

        this.$host.html(`
            <!-- M3 Full-screen sheet header — close icon LEFT (mobile-app convention) -->
            <div class="flex-none bg-white border-b border-slate-200">
                <div class="flex items-center justify-between px-4 py-2 gap-2">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <button class="srt-form-close md-icon-btn" title="${__("Close (Esc)")}">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                        <h2 class="text-lg font-semibold text-slate-900 m-0 truncate">${title}</h2>
                        ${this.state.is_new ? `<span class="md-chip" style="background: ${state_cls.includes('amber') ? '#fef3c7' : '#f1f5f9'};">${state}</span>` : ""}
                    </div>
                </div>
            </div>

            ${audit_html}

            <!-- Body -->
            <div class="flex-1 w-full overflow-y-auto bg-slate-50">
                <div class="w-full max-w-[1600px] mx-auto relative">
                    <div class="srt-form-banner px-6 pt-4"></div>
                    <div class="px-6 pt-6 pb-4 grid grid-cols-1 xl:grid-cols-12 gap-4">
                        <div class="xl:col-span-7 srt-form-context"></div>
                        <div class="xl:col-span-5 srt-form-totals"></div>
                    </div>
                    <div class="px-6 pb-4 srt-form-batches"></div>
                    <div class="px-6 pb-6 srt-form-remarks"></div>
                </div>
            </div>

            <!-- Footer -->
            <div class="flex-none bg-white border-t border-slate-200">
                <div class="w-full max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div class="text-xs text-slate-500 srt-footer-meta">
                        ${this.state.naming_series
                            ? `${__("Series")}: <span class="font-mono text-slate-700">${frappe.utils.escape_html(this.state.naming_series)}</span>`
                            : ""}
                    </div>
                    <div class="flex items-center gap-2 flex-wrap srt-form-actions"></div>
                </div>
            </div>
        `);

        this.$host.find(".srt-form-close").on("click", () => this.on_close());

        this.$banner  = this.$host.find(".srt-form-banner");
        this.$context = this.$host.find(".srt-form-context");
        this.$totals  = this.$host.find(".srt-form-totals");
        this.$batches = this.$host.find(".srt-form-batches");
        this.$remarks = this.$host.find(".srt-form-remarks");

        this._render_context();
        this._render_totals();
        this._render_batches();
        this._render_remarks();
        this._render_footer_actions();
    }

    // -- Context panel --
    _render_context() {
        this.$context.html(`
            <div class="md-card-elevated p-5">
                <h3 class="text-base font-semibold text-slate-900 mb-4 m-0">
                    ${__("Item & Location")}
                </h3>
                <div class="space-y-3">
                    <div>
                        <label class="text-xs font-medium text-slate-600 mb-1 block">
                            ${__("Item")} <span class="text-rose-500">*</span>
                        </label>
                        <div class="srt-item-field"></div>
                        <div class="srt-item-preview text-xs text-emerald-700 mt-1 hidden"></div>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-slate-600 mb-1 block">
                            ${__("Warehouse")} <span class="text-rose-500">*</span>
                        </label>
                        <div class="srt-warehouse-field"></div>
                    </div>
                    <div>
                        <label class="text-xs font-medium text-slate-600 mb-1 block">
                            ${__("Company")} <span class="text-rose-500">*</span>
                        </label>
                        <div class="srt-company-field"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium text-slate-600 mb-1 block">
                                ${__("Posting Date")}
                            </label>
                            <div class="srt-posting-date-field"></div>
                        </div>
                        <div>
                            <label class="text-xs font-medium text-slate-600 mb-1 block">
                                ${__("Posting Time")}
                            </label>
                            <div class="srt-posting-time-field"></div>
                        </div>
                    </div>
                    <label class="inline-flex items-center text-sm text-slate-700 cursor-pointer gap-3">
                        <span class="md-switch">
                            <input type="checkbox" class="srt-edit-posting">
                            <span class="md-switch-track">
                                <span class="md-switch-thumb"></span>
                            </span>
                        </span>
                        ${__("Edit posting date/time")}
                    </label>
                </div>
            </div>
        `);
        const that = this;
        const mk = (fieldtype, fieldname, parent, options, on_change) => {
            const ctrl = frappe.ui.form.make_control({
                df: { fieldtype, fieldname, options },
                parent, render_input: true,
            });
            if (that.state[fieldname]) ctrl.set_value(that.state[fieldname]);
            ctrl.df.onchange = () => on_change(ctrl.get_value());
            return ctrl;
        };
        this._ctrl_item = mk("Link", "item",
            this.$context.find(".srt-item-field")[0], "Item",
            v => { this.state.item = v; this._refresh_item_preview(); this._maybe_load_batches(); });
        this._ctrl_wh = mk("Link", "default_warehouse",
            this.$context.find(".srt-warehouse-field")[0], "Warehouse",
            v => { this.state.default_warehouse = v; this._maybe_load_batches(); });
        this._ctrl_co = mk("Link", "company",
            this.$context.find(".srt-company-field")[0], "Company",
            v => { this.state.company = v; });
        this._ctrl_pd = mk("Date", "posting_date",
            this.$context.find(".srt-posting-date-field")[0], null,
            v => { this.state.posting_date = v; this._maybe_load_batches(); });
        this._ctrl_pt = mk("Time", "posting_time",
            this.$context.find(".srt-posting-time-field")[0], null,
            v => { this.state.posting_time = v; this._maybe_load_batches(); });
        this.$context.find(".srt-edit-posting").prop("checked", !!this.state.edit_posting)
            .on("change", e => {
                this.state.edit_posting = e.target.checked ? 1 : 0;
                this._ctrl_pd.df.read_only = !this.state.edit_posting; this._ctrl_pd.refresh();
                this._ctrl_pt.df.read_only = !this.state.edit_posting; this._ctrl_pt.refresh();
            });
        this._ctrl_pd.df.read_only = !this.state.edit_posting; this._ctrl_pd.refresh();
        this._ctrl_pt.df.read_only = !this.state.edit_posting; this._ctrl_pt.refresh();
        this._refresh_item_preview();
    }

    _refresh_item_preview() {
        const $p = this.$context.find(".srt-item-preview");
        if (this.state.item_name) {
            $p.text(this.state.item_name).removeClass("hidden");
        } else {
            $p.text("").addClass("hidden");
        }
    }

    _maybe_load_batches() {
        if (!(this.state.item && this.state.default_warehouse)) return;
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.api.get_item_defaults",
            args: {
                item_code: this.state.item,
                warehouse: this.state.default_warehouse,
                posting_date: this.state.posting_date || null,
                posting_time: this.state.posting_time || null,
            },
            freeze: true, freeze_message: __("Loading batches…"),
        }).then(r => {
            const d = r.message || {};
            Object.assign(this.state, {
                item_name: d.item_name,
                default_uom: d.default_uom,
                higher_uom: d.higher_uom,
                higher_uom_cf: d.higher_uom_cf,
                total_current_stock_in_default_uom: d.total_current_stock_in_default_uom,
                total_current_stock_in_higher_uom: d.total_current_stock_in_higher_uom,
                total_qty_found_in_default_uom: d.total_current_stock_in_default_uom,
                total_qty_found_in_higher_uom: d.total_current_stock_in_higher_uom,
                batches: (d.batches || []).map(b =>
                    Object.assign({ is_counted: 0, qty_found: 0, _origin_autopop: 1 }, b)),
            });
            this._refresh_item_preview();
            this._render_totals();
            this._render_batches();
        }).catch(err => this._show_error(err.message || String(err)));
    }

    // -- Totals panel --
    _render_totals() {
        const no_data = !(this.state.item && this.state.default_warehouse);
        if (no_data) {
            this.$totals.html(`
                <div class="md-card-elevated p-8 flex flex-col items-center justify-center text-center min-h-[240px]">
                    <svg class="w-10 h-10 text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                    </svg>
                    <div class="text-base font-semibold text-slate-900 mb-1">${__("Totals")}</div>
                    <div class="text-sm text-slate-500 max-w-xs">
                        ${__("Pick an item and warehouse to load the live baseline.")}
                    </div>
                </div>
            `);
            return;
        }
        const t = this._compute_totals();
        const fmt = v => frappe.format(v, { fieldtype: "Float" });
        const isMatched = Math.abs(t.delta) < 0.001;
        const delta_cls = isMatched ? "text-slate-600"
            : (t.delta > 0 ? "text-emerald-700" : "text-rose-700");
        const delta_label = isMatched ? __("matched")
            : (t.delta > 0 ? __("over") : __("short"));
        const sign = t.delta >= 0 ? "+" : "";

        // Material 3 card — elevated surface, M3 type scale
        // title-medium / body-medium / display-small for the delta
        this.$totals.html(`
            <div class="md-card-elevated p-5">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-base font-semibold text-slate-900 m-0">${__("Totals")}</h3>
                    <span class="md-chip">
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 8 8" style="color: #059669;">
                            <circle cx="4" cy="4" r="3"/>
                        </svg>
                        ${__("Live")}
                    </span>
                </div>
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="rounded-lg p-3" style="background: var(--md-sys-color-surface-1);">
                        <div class="text-xs text-slate-500 mb-1.5">${__("Current Stock")}</div>
                        ${srt_uom_chips(t.current, this.state.default_uom, this.state.higher_uom,
                                        this.state.higher_uom_cf, { higher_val: t.higher_current })}
                    </div>
                    <div class="rounded-lg p-3" style="background: var(--md-sys-color-surface-1);">
                        <div class="text-xs text-slate-500 mb-1.5">${__("Stock Found")}</div>
                        ${srt_uom_chips(t.found, this.state.default_uom, this.state.higher_uom,
                                        this.state.higher_uom_cf, { higher_val: t.higher_found })}
                    </div>
                </div>
                <div class="pt-4 border-t border-slate-100">
                    <div class="flex items-baseline justify-between">
                        <div>
                            <div class="text-xs text-slate-500 mb-1">${__("Delta")}</div>
                            <div class="flex items-baseline gap-1.5">
                                <span class="text-lg font-semibold tabular-nums ${delta_cls}">${sign}${fmt(t.delta)}</span>
                                <span class="text-sm text-slate-500">${frappe.utils.escape_html(this.state.default_uom || "")}</span>
                            </div>
                        </div>
                        <span class="md-chip" style="background: ${isMatched ? '#f1f5f9' : (t.delta > 0 ? '#d1fae5' : '#fee2e2')}; color: ${isMatched ? '#475569' : (t.delta > 0 ? '#065f46' : '#991b1b')};">
                            ${delta_label}
                        </span>
                    </div>
                </div>
            </div>
        `);
    }

    _compute_totals() {
        let total_current = 0, total_found = 0;
        for (const r of (this.state.batches || [])) {
            const cur = Number(r.current_stock_in_stock_uom) || 0;
            total_current += cur;
            if (r.is_counted) {
                const cf = this._resolve_cf(r);
                total_found += (Number(r.qty_found) || 0) * cf;
            } else {
                total_found += cur;
            }
        }
        const hcf = Number(this.state.higher_uom_cf) || 1;
        return {
            current: total_current, found: total_found,
            delta: total_found - total_current,
            higher_current: total_current / hcf,
            higher_found: total_found / hcf,
        };
    }

    _resolve_cf(row) {
        let cf = Number(row.conversion_factor);
        if (cf && Number.isFinite(cf) && cf > 0) return cf;
        const sq = Number(row.current_stock_in_stock_uom);
        const sl = Number(row.current_stock_in_selected_uom);
        if (sq > 0 && sl > 0) { cf = sq / sl; if (cf > 0) return cf; }
        if (row.select_uom === this.state.higher_uom) {
            cf = Number(this.state.higher_uom_cf); if (cf > 0) return cf;
        }
        return 1.0;
    }

    // -- Batches grid --
    _render_batches() {
        if (!(this.state.batches && this.state.batches.length)) {
            this.$batches.html(`
                <div class="md-card-elevated p-12 text-center">
                    <svg class="w-10 h-10 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                    </svg>
                    <div class="text-sm text-slate-700 font-medium">${__("No batches loaded")}</div>
                    <div class="text-sm text-slate-500 mt-1">${__("Pick item and warehouse above to load batches for this reconciliation.")}</div>
                </div>
            `);
            return;
        }
        // v0.0.9.14: snapshot badge — surfaces the (item, warehouse, posting)
        // tuple the batches table is showing. When operator changes any axis,
        // the badge updates so they can verify the snapshot they're seeing
        // matches their intent. The actual fetch is already wired in
        // _maybe_load_batches; this is the visible confirmation.
        const snap_date = this.state.posting_date || frappe.datetime.nowdate();
        const snap_time = this.state.posting_time || frappe.datetime.now_time();
        const snap_label = `${moment(snap_date).format("DD MMM YYYY")} ${moment(snap_time, "HH:mm:ss").format("hh:mm A")}`;
        this.$batches.html(`
            <div class="md-card-elevated overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-3 border-b border-slate-200 flex-wrap">
                    <h3 class="text-base font-semibold text-slate-900 m-0 mr-2">${__("Batches")}</h3>
                    <span class="md-chip" title="${__("Stock snapshot as of this date/time")}">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <span class="text-slate-500 mr-1">${__("As of")}</span>
                        <span>${snap_label}</span>
                    </span>
                    <span class="md-chip" title="${__("Warehouse the snapshot is scoped to")}">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                        </svg>
                        <span>${frappe.utils.escape_html(this.state.default_warehouse || "—")}</span>
                    </span>
                    <input type="text" class="srt-batches-search flex-grow px-3 py-1.5 text-sm
                                              border border-slate-300 rounded-md
                                              focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20
                                              focus:outline-none max-w-xs"
                           placeholder="${__("Search batch…")}">
                    <button class="srt-tick-all md-btn md-btn-text" style="min-height: 32px;">
                        ${__("Select all")}
                    </button>
                    <button class="srt-untick-all md-btn md-btn-text" style="min-height: 32px;">
                        ${__("Clear")}
                    </button>
                    <button class="srt-add-row md-btn md-btn-tonal" style="min-height: 32px;">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/>
                        </svg>
                        ${__("Add row")}
                    </button>
                    <span class="text-xs text-slate-500 ml-auto srt-batches-count"></span>
                </div>
                <div class="srt-batches-grid" style="max-height: 50vh; overflow-y: auto;"></div>
            </div>
        `);
        const $grid = this.$batches.find(".srt-batches-grid");
        const that = this;
        const fmt_status = cell => {
            const r = cell.getRow().getData();
            if (!r.is_counted) {
                return `<span class="text-xs text-slate-400">${__("Not counted")}</span>`;
            }
            const cf = that._resolve_cf(r);
            const delta = (Number(r.qty_found) || 0) * cf - (Number(r.current_stock_in_stock_uom) || 0);
            if (Math.abs(delta) < 0.001) {
                return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">${__("Matched")}</span>`;
            }
            const delta_sel = (Number(r.qty_found) || 0) - (Number(r.current_stock_in_selected_uom) || 0);
            const cls = delta_sel >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
            const sign = delta_sel >= 0 ? "+" : "";
            // v0.0.9.29 — same RESTRICT as compute_reco_state above: never put
            // frappe.format(..., {fieldtype:"Float"}) inside a pill. It wraps
            // the number in `<div style='text-align:right'>…</div>`, which
            // here renders as a block and breaks the inline pill layout.
            // Use format_number() for plain inline text.
            return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}">
                ${sign}${format_number(delta_sel)} ${frappe.utils.escape_html(r.select_uom || "")}
            </span>`;
        };
        const on_edit = cell => {
            const r = cell.getRow().getData();
            const f = cell.getField();
            if (f === "is_counted") r.is_counted = cell.getValue() ? 1 : 0;
            if (f === "qty_found")  r.qty_found  = Number(cell.getValue()) || 0;
            if (f === "select_uom") {
                frappe.call({
                    method: "kavach.stock_reconciliation_tracking.api.get_uom_conversion",
                    args: { item_code: that.state.item, uom: r.select_uom },
                }).then(resp => {
                    const cf = Number(resp.message) || 1;
                    r.conversion_factor = cf;
                    const sq = Number(r.current_stock_in_stock_uom) || 0;
                    r.current_stock_in_selected_uom = cf > 0 ? sq / cf : sq;
                    // v0.0.9.19 — updateData alone doesn't re-trigger cell
                    // formatters without a row `id` field (same gotcha as
                    // is_counted in v0.0.9.9). Status pill + UOM-derived
                    // cells stayed stale after a UOM change. Force a row
                    // re-render via row.reformat() so fmt_status, qty_found
                    // formatting, and Current Stock (in Selected UOM) all
                    // reflect the new conversion_factor.
                    const row = cell.getRow();
                    row.update(r);
                    row.reformat();
                    that._render_totals();
                });
                return;
            }
            // Same gotcha applies to qty_found edits — the Status column
            // depends on (qty_found, current_stock_in_selected_uom). Use
            // row.reformat() to repaint all column formatters in this row.
            const row = cell.getRow();
            row.update(r);
            row.reformat();
            that._render_totals();
        };
        this._tab = new Tabulator($grid[0], {
            data: this.state.batches,
            layout: "fitColumns",
            height: "100%",
            // v0.0.9.7 — row-level "Do Reconcile" checkbox brought back per
            // user feedback. Mirrors the DocType's is_counted (label
            // "Do Reconcile" per stock_reconciliation_srt.json). Click in
            // the dedicated column OR the Status pill toggles. Unticked rows
            // show qty_found cell dimmed so the operator sees at a glance
            // which rows will reach the ERPNext SR.
            // v0.0.9.7 — batch list dropdown also fetches on open (no typed
            // filter required). filterRemote removed; full list of up to 50
            // batches loads when the editor opens. Type-filter still works
            // client-side via Tabulator's built-in matching.
            columns: [
                // Material 3 row checkbox — full-circle hover state layer.
                // FIX (v0.0.9.9): cell.setValue() + row.reformat() instead of
                // _tab.updateData() — updateData doesn't re-trigger cell
                // formatters without an `id` field, so the checkbox appeared
                // unchanged even though state changed. setValue both updates
                // data AND re-renders the cell. reformat() re-runs all column
                // formatters so qty_found dim + batch_no dim + status pill
                // all reflect the new is_counted state.
                { title: __("Reconcile"), field: "is_counted",
                  headerSort: false, width: 100, hozAlign: "center",
                  cssClass: "srt-mdcb-cell",
                  formatter: c => {
                      const checked = !!c.getValue();
                      return `<span class="srt-mdcb-wrap">
                                <span class="srt-mdcb ${checked ? 'checked' : ''}">
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                                    </svg>
                                </span>
                              </span>`;
                  },
                  cellClick: (e, cell) => {
                      e.stopPropagation();
                      const r = cell.getRow().getData();
                      const new_val = r.is_counted ? 0 : 1;
                      cell.setValue(new_val, true);   // updates data + re-renders cell
                      cell.getRow().reformat();        // re-render whole row formatters
                      that._render_totals();
                  }
                },
                // Batch ID: list editor wired to frappe.db.get_list("Batch")
                // FIX (v0.0.9.10): listOnEmpty=true → dropdown shows the FULL
                // batch list immediately on click (no typing required).
                // autocomplete=true narrows as the operator types.
                // Already-picked batches are excluded server-side.
                { title: __("Batch"), field: "batch_no", widthGrow: 2,
                  editor: "list",
                  editable: cell => !cell.getRow().getData()._origin_autopop,
                  editorParams: {
                      autocomplete: true,
                      listOnEmpty: true,         // show full list on click — no typing needed
                      clearable: true,
                      filterFunc: (term, label) => {
                          // Case-insensitive substring on the visible label
                          if (!term) return true;
                          return String(label).toLowerCase().includes(String(term).toLowerCase());
                      },
                      valuesLookup: (cell) => {
                          const taken = (that.state.batches || [])
                              .filter(r => r.batch_no && r !== cell.getRow().getData())
                              .map(r => r.batch_no);
                          return new Promise(resolve => {
                              const filters = {
                                  disabled: 0,
                                  ...(that.state.item ? { item: that.state.item } : {}),
                                  ...(taken.length ? { name: ["not in", taken] } : {}),
                              };
                              frappe.db.get_list("Batch", {
                                  filters,
                                  fields: ["name"],
                                  limit: 0,            // 0 = no limit; return ALL matching batches
                                  order_by: "creation desc",
                              }).then(rows => resolve((rows || []).map(r => r.name)))
                               .catch(() => resolve([]));
                          });
                      },
                  },
                  cellEdited: cell => {
                      const r = cell.getRow().getData();
                      const new_batch = (cell.getValue() || "").trim();
                      if (!new_batch || !that.state.item) return;
                      frappe.call({
                          method: "kavach.stock_reconciliation_tracking.api.get_batch_current_state",
                          args: {
                              item_code: that.state.item,
                              batch_no: new_batch,
                              posting_date: that.state.posting_date || null,
                              posting_time: that.state.posting_time || null,
                          },
                      }).then(resp => {
                          const d = resp.message || {};
                          Object.assign(r, {
                              warehouse: d.warehouse || that.state.default_warehouse,
                              stock_uom: d.stock_uom || that.state.default_uom,
                              current_stock_in_stock_uom: Number(d.qty) || 0,
                              valuation_rate: Number(d.valuation_rate) || 0,
                              select_uom: that.state.higher_uom || that.state.default_uom,
                              conversion_factor: Number(that.state.higher_uom_cf) || 1,
                              item_name_selected: that.state.item_name,
                          });
                          const cf = r.conversion_factor || 1;
                          r.current_stock_in_selected_uom = cf > 0 ? r.current_stock_in_stock_uom / cf : r.current_stock_in_stock_uom;
                          // v0.0.9.19 — row.reformat() instead of updateData
                          // so the Status pill repaints after a fresh batch
                          // is picked (current_stock_in_stock_uom changes,
                          // delta calculation changes).
                          const row = cell.getRow();
                          row.update(r);
                          row.reformat();
                          that._render_totals();
                      });
                  },
                  formatter: c => {
                      const v = c.getValue();
                      const r = c.getRow().getData();
                      if (!v) return `<span class="text-xs text-slate-400 italic">${__("Click to pick batch…")}</span>`;
                      const dim = r.is_counted ? "" : "opacity-60";
                      return `<span class="font-mono text-sm text-slate-800 ${dim}">${frappe.utils.escape_html(v)}</span>`;
                  } },
                { title: __("Qty Found"), field: "qty_found",
                  editor: "number", hozAlign: "right", cellEdited: on_edit,
                  formatter: c => {
                      const ticked = c.getRow().getData().is_counted;
                      const v = c.getValue();
                      const cls = ticked ? "text-slate-900 font-medium" : "text-slate-400";
                      return `<span class="text-sm tabular-nums ${cls}">${v}</span>`;
                  } },
                { title: __("UOM"), field: "select_uom",
                  editor: "list", editorParams: () => ({
                      valuesLookup: () => that._uom_options(), autocomplete: true,
                  }),
                  cellEdited: on_edit,
                  formatter: c => `<span class="text-sm text-slate-700">${frappe.utils.escape_html(c.getValue() || "")}</span>` },
                { title: __("Current (Selected UOM)"), field: "current_stock_in_selected_uom",
                  hozAlign: "right", minWidth: 140,
                  formatter: c => {
                      const r = c.getRow().getData();
                      const v = Number(c.getValue()) || 0;
                      // v0.0.9.30 — box-bubble chip (format_number per § 6a RESTRICT).
                      return `<div class="srt-uom-chips">${srt_uom_chip(v, r.select_uom, true, "srt-chip-indigo")}</div>`;
                  } },
                { title: __("Current (Stock UOM)"), field: "current_stock_in_stock_uom",
                  hozAlign: "right", minWidth: 140,
                  formatter: c => {
                      const r = c.getRow().getData();
                      const v = Number(c.getValue()) || 0;
                      return `<div class="srt-uom-chips">${srt_uom_chip(v, r.stock_uom, false, "srt-chip-slate")}</div>`;
                  } },
                { title: __("Status"), field: "is_counted",
                  formatter: fmt_status, headerSort: false,
                  widthGrow: 1, hozAlign: "center",
                  cellClick: (e, cell) => {
                      const r = cell.getRow().getData();
                      const new_val = r.is_counted ? 0 : 1;
                      // setValue on is_counted field updates the data;
                      // reformat re-renders all formatters in this row
                      // so the Reconcile checkbox + qty_found dim state
                      // also flip with the same click.
                      r.is_counted = new_val;
                      cell.getRow().reformat();
                      that._render_totals();
                  } },
                { title: "", field: "_remove", headerSort: false, width: 56,
                  hozAlign: "center",
                  formatter: () => `
                      <button class="srt-remove-row md-icon-btn"
                              style="width: 36px; height: 36px;"
                              title="${__("Remove row")}">
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3"/>
                          </svg>
                      </button>`,
                  cellClick: (e, cell) => {
                      const row = cell.getRow();
                      const r = row.getData();
                      that.state.batches = that.state.batches.filter(b => b !== r);
                      row.delete();
                      that.$batches.find(".srt-batches-count").text(
                          `${that.state.batches.length} ${__("batches")}`);
                      that._render_totals();
                  } },
            ],
        });
        this.$batches.find(".srt-batches-search").on("input", e => {
            const q = e.target.value.trim();
            if (q) this._tab.setFilter("batch_no", "like", q);
            else this._tab.clearFilter();
        });
        // FIX (v0.0.9.9): replaceData rebuilds the whole grid (loses scroll
        // position, edit state). Use redraw(true) after mutating in-place
        // to force formatter re-run while keeping the existing Tabulator
        // row instances.
        this.$batches.find(".srt-tick-all").on("click", () => {
            this.state.batches.forEach(r => r.is_counted = 1);
            this._tab.getRows().forEach(row => row.reformat());
            this._render_totals();
        });
        this.$batches.find(".srt-untick-all").on("click", () => {
            this.state.batches.forEach(r => r.is_counted = 0);
            this._tab.getRows().forEach(row => row.reformat());
            this._render_totals();
        });
        // v0.0.9.7 — FIX double-click bug: addRow returns a Promise that
        // resolves AFTER the row is committed to DOM. Using `then(row => …)`
        // guarantees scrollTo + edit() run on a real attached cell. The
        // prior setTimeout(80ms) was racing the Tabulator render and the
        // first click silently failed the .edit() call.
        this.$batches.find(".srt-add-row").on("click", () => {
            if (!this.state.item) {
                frappe.show_alert({
                    message: __("Pick an item first."), indicator: "orange",
                });
                return;
            }
            const new_row = {
                batch_no: "",
                item_code: this.state.item,
                warehouse: this.state.default_warehouse,
                stock_uom: this.state.default_uom,
                select_uom: this.state.higher_uom || this.state.default_uom,
                conversion_factor: Number(this.state.higher_uom_cf) || 1,
                current_stock_in_stock_uom: 0,
                current_stock_in_selected_uom: 0,
                valuation_rate: 0,
                item_name_selected: this.state.item_name,
                is_counted: 1,
                qty_found: 0,
                _origin_autopop: 0,
            };
            this.state.batches.push(new_row);
            this.$batches.find(".srt-batches-count").text(
                `${this.state.batches.length} ${__("batches")}`);
            // Tabulator.addRow returns a Promise<RowComponent>. Awaiting
            // it ensures the row is in the DOM before we try to scroll +
            // edit. False positional arg = append to bottom.
            const result = this._tab.addRow(new_row, false);
            const handle_added = (row) => {
                if (!row) return;
                try {
                    row.scrollTo("center");
                    const cell = row.getCell("batch_no");
                    if (cell) cell.edit(true);
                } catch (e) {
                    // Defensive: if edit() throws (cell not yet ready),
                    // operator can still click the cell manually.
                    console.warn("[SRT] add-row edit failed:", e);
                }
            };
            if (result && typeof result.then === "function") {
                result.then(handle_added);
            } else {
                // Fallback for older Tabulator (returns RowComponent directly)
                handle_added(result);
            }
        });
        this.$batches.find(".srt-batches-count").text(`${this.state.batches.length} ${__("batches")}`);
    }

    _uom_options() {
        return new Promise(resolve => {
            frappe.call({
                method: "kavach.stock_reconciliation_tracking.api.get_item_uoms",
                args: { item_code: this.state.item },
            }).then(r => resolve(r.message || [])).catch(() => resolve([]));
        });
    }

    // -- Remarks --
    // v0.0.9.9: switched from plain <textarea> to Frappe's "Text Editor"
    // control (TinyMCE-style rich text) to match the DocType field type.
    // DocType json declares user_remark / admin_remark / super_admin_remark
    // as `Text Editor`. Using frappe.ui.form.make_control({ df: { fieldtype:
    // "Text Editor" } }) gets us the same widget the native form uses —
    // toolbar, bullet lists, links, etc. — so what operators see in the
    // dashboard form matches what they'd see on the doctype form.
    _render_remarks() {
        const roles = new Set(frappe.user_roles || []);
        const is_super = roles.has("Srt Super Admin") || roles.has("System Manager")
                         || frappe.session.user === "Administrator";
        const is_admin = is_super || roles.has("Srt Admin");
        // v0.0.9.33 — STRICT stage-based remark freeze. In the FORM PANEL only
        // user_remark is editable (the creator's note). admin_remark and
        // super_admin_remark are edited by approvers via the View modal's
        // Approve flow (stage + role gated), so they are ALWAYS read-only here,
        // regardless of whether the form's editor also holds admin/super roles.
        // The controller's _enforce_remark_field_permissions stays authoritative.
        const ro_admin = true;
        const ro_super_admin = true;
        void is_admin; void is_super;   // still computed above; not used to unlock here

        // v0.0.9.11: remarks stacked vertically (one column) instead of
        // a 3-column row — per spec, each remark is a rich-text region and
        // deserves full panel width for proper Text Editor toolbar usability.
        this.$remarks.html(`
            <div class="md-card-elevated p-5">
                <h3 class="text-base font-semibold text-slate-900 mb-4 m-0">${__("Remarks")}</h3>
                <div class="flex flex-col gap-5 srt-remarks-grid"></div>
            </div>
        `);

        const $grid = this.$remarks.find(".srt-remarks-grid");
        const that = this;

        const blocks = [
            { field: "user_remark",        label: __("User remark"),        hint: __("Owner · Draft"),                  ro: false,           tone: "bg-slate-100 text-slate-700" },
            { field: "admin_remark",       label: __("Admin remark"),       hint: __("Admin · Draft"),                  ro: ro_admin,        tone: "bg-indigo-50 text-indigo-700" },
            { field: "super_admin_remark", label: __("Super admin remark"), hint: __("Super Admin · Admin Approval"),   ro: ro_super_admin,  tone: "bg-amber-50 text-amber-700" },
        ];

        // Build each block + mount a Frappe Text Editor control inside it
        blocks.forEach(b => {
            const $block = $(`
                <div class="flex flex-col">
                    <div class="flex items-center justify-between mb-1.5">
                        <label class="text-sm font-medium text-slate-700">${b.label}</label>
                        <span class="md-chip ${b.ro ? '' : b.tone}">
                            ${b.ro ? `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>` : ""}
                            ${b.hint}
                        </span>
                    </div>
                    <div class="srt-remark-editor-host"
                         style="${b.ro ? 'opacity: 0.7; pointer-events: none;' : ''}"></div>
                </div>
            `);
            $grid.append($block);
            const $host = $block.find(".srt-remark-editor-host");
            const ctrl = frappe.ui.form.make_control({
                df: {
                    fieldtype: "Text Editor",
                    fieldname: b.field,
                    label: "",  // we render our own label above
                    read_only: b.ro ? 1 : 0,
                },
                parent: $host[0],
                render_input: true,
            });
            // Hydrate with existing value (server returned HTML)
            if (that.state[b.field]) {
                ctrl.set_value(that.state[b.field]);
            }
            // On change, push value back to state (HTML preserved)
            ctrl.df.onchange = () => {
                that.state[b.field] = ctrl.get_value();
            };
            // Cache control so we can read it on save if onchange didn't fire
            that[`_ctrl_${b.field}`] = ctrl;
        });
    }

    // -- Footer actions: role + state aware (DocType parity) --
    _render_footer_actions() {
        const $actions = this.$host.find(".srt-form-actions");
        if (!$actions.length) return;
        const roles = new Set(frappe.user_roles || []);
        const is_super = roles.has("Srt Super Admin") || roles.has("System Manager")
                         || frappe.session.user === "Administrator";
        const is_admin = is_super || roles.has("Srt Admin");
        const state = this.state.workflow_state || "Draft";
        const is_draft = !this.state.name || state === "Draft";
        const is_admin_approval = state === "Admin Approval";

        // v0.0.9.8 — Material 3 button hierarchy
        // Cancel (text) · Save (outlined) · Submit (filled) · Submit Linked SR (success-filled)
        let html = `
            <button class="srt-form-cancel md-btn md-btn-text">
                ${__("Cancel")}
            </button>`;
        if (is_draft) {
            html += `
                <button class="srt-form-save md-btn md-btn-outlined">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M5 13l4 4L19 7"/>
                    </svg>
                    ${__("Save")}
                </button>`;
        }
        if (is_draft && is_admin && this.state.name) {
            html += `
                <button class="srt-form-submit md-btn md-btn-filled">
                    ${__("Submit for Approval")}
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                    </svg>
                </button>`;
        }
        if (is_admin_approval && is_super && this.state.linked_erpnext_sr) {
            html += `
                <button class="srt-form-submit-linked-sr md-btn md-btn-success">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    ${__("Submit Linked SR")}
                </button>`;
        }
        $actions.html(html);
        $actions.find(".srt-form-cancel").on("click", () => this.on_close());
        $actions.find(".srt-form-save").on("click", () => this._save());
        $actions.find(".srt-form-submit").on("click", () => this._submit());
        $actions.find(".srt-form-submit-linked-sr").on("click", () => this._submit_linked_sr());
    }

    _submit() {
        if (!this.state.name) {
            this._show_error(__("Save the draft first."));
            return;
        }
        frappe.confirm(__("Submit SRT {0} for approval?", [this.state.name]), () => {
            this.$banner.empty();
            frappe.call({
                method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.submit_srt_form",
                args: { name: this.state.name },
                freeze: true, freeze_message: __("Submitting…"),
            }).then(r => {
                const m = r.message || {};
                frappe.show_alert({
                    message: __("Submitted: {0} → {1}", [m.name, m.workflow_state || "?"]),
                    indicator: "green",
                });
                this.on_saved();
            }).catch(err => this._show_error(err.message || String(err)));
        });
    }

    _submit_linked_sr() {
        if (!this.state.linked_erpnext_sr) {
            this._show_error(__("No linked ERPNext SR yet."));
            return;
        }
        frappe.confirm(__("Submit linked ERPNext SR {0}? This posts SLE/GL movements.",
                          [this.state.linked_erpnext_sr]), () => {
            this.$banner.empty();
            frappe.call({
                method: "kavach.stock_reconciliation_tracking.doctype.stock_reconciliation_srt.stock_reconciliation_srt.submit_linked_sr",
                args: { srt_name: this.state.name },
                freeze: true, freeze_message: __("Submitting SR…"),
            }).then(r => {
                frappe.show_alert({
                    message: __("ERPNext SR submitted: {0}", [r.message]),
                    indicator: "green",
                });
                this.on_saved();
            }).catch(err => this._show_error(err.message || String(err)));
        });
    }

    _build_payload() {
        // FIX (v0.0.9.9): Text Editor controls may have unsaved HTML in
        // their iframe DOM that hasn't fired onchange yet (TinyMCE delays
        // the change event). Read the latest value from each control
        // before building the payload.
        ["user_remark", "admin_remark", "super_admin_remark"].forEach(f => {
            const ctrl = this[`_ctrl_${f}`];
            if (ctrl && typeof ctrl.get_value === "function") {
                try { this.state[f] = ctrl.get_value() || ""; } catch (e) {}
            }
        });
        return {
            item: this.state.item,
            default_warehouse: this.state.default_warehouse,
            company: this.state.company,
            item_name: this.state.item_name,
            default_uom: this.state.default_uom,
            higher_uom: this.state.higher_uom,
            higher_uom_cf: this.state.higher_uom_cf,
            posting_date: this.state.posting_date,
            posting_time: this.state.posting_time,
            edit_posting: this.state.edit_posting ? 1 : 0,
            user_remark: this.state.user_remark || "",
            admin_remark: this.state.admin_remark || "",
            super_admin_remark: this.state.super_admin_remark || "",
            modified: this.state.modified,
            batches: (this.state.batches || []).map(b => ({
                batch_no: b.batch_no,
                item_code: this.state.item,
                warehouse: this.state.default_warehouse,
                stock_uom: b.stock_uom,
                select_uom: b.select_uom,
                conversion_factor: b.conversion_factor,
                current_stock_in_stock_uom: b.current_stock_in_stock_uom,
                current_stock_in_selected_uom: b.current_stock_in_selected_uom,
                valuation_rate: b.valuation_rate,
                item_name_selected: b.item_name_selected,
                is_counted: b.is_counted ? 1 : 0,
                qty_found: Number(b.qty_found) || 0,
            })),
        };
    }

    _save() {
        this.$banner.empty();
        frappe.call({
            method: "kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.save_srt_form",
            args: { payload: this._build_payload(), name: this.name || null },
            freeze: true, freeze_message: __("Saving…"),
        }).then(r => {
            const m = r.message || {};
            frappe.show_alert({
                message: __("Saved: {0}", [m.name]), indicator: "green",
            });
            this.on_saved();
        }).catch(err => this._show_error(err.message || String(err)));
    }

    _show_error(msg) {
        // Material 3 error banner — error-container surface, with leading
        // icon + dismiss action. Inline (not snackbar) per M3 banner spec.
        this.$banner.html(`
            <div class="md-banner-error srt-anim-fade-in mb-4">
                <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none"
                     stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <div class="flex-grow text-sm leading-relaxed">
                    ${frappe.utils.escape_html(msg)}
                </div>
                <button class="srt-form-banner-close md-icon-btn" style="width: 32px; height: 32px; color: inherit;"
                        title="${__("Dismiss")}">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `);
        this.$banner.find(".srt-form-banner-close").on("click", () => this.$banner.empty());
        const $panel = this.$host.closest(".srt-form-panel");
        if ($panel.length) $panel[0].scrollTop = 0;
    }
}
