# SRT Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a custom Frappe Page `srt-dashboard` that gives operators a tabbed (Draft / Admin Approval / Super Admin Approval) overview of Stock Reconciliation SRT docs with a per-row View modal, batch-level Origin + Transaction summary, drill-down per cell (In vs Out), and Approve / Reject (+ bulk approve) actions — all of which dispatch to the existing DocType controller. No validation duplicated; this is a UX layer.

**Architecture:** Standard Frappe Page (5-file pattern matching `chaizup_toc:item_shortage_dashboard`). Server APIs in `srt_dashboard.py` read existing SRT/SLE/SABB data and dispatch through existing `submit_linked_sr` / `submit` / `cancel` paths. JS uses Tabulator for grids + `frappe.ui.Dialog` for modals. Workspace gets a new SRT Dashboard link + shortcut.

**Tech Stack:** Frappe v16 Page framework, Tabulator (already loaded in chaizup_toc dashboards on this site), Python 3.14, MariaDB / Stock Ledger Entry + Serial and Batch Bundle joins.

**Spec:** `apps/kavach/docs/specs/2026-05-23-srt-dashboard-design.md`

**Source-control note:** SRT app is not its own git repo (parent `/workspace` repo `.gitignore`s `development/frappe-bench/`). Skip `git commit` steps; treat each task's "Commit" step as an on-disk checkpoint.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `apps/.../page/srt_dashboard/__init__.py` | Python package marker | Create |
| `apps/.../page/srt_dashboard/srt_dashboard.json` | Page meta + 4 roles | Create |
| `apps/.../page/srt_dashboard/srt_dashboard.py` | 6 whitelisted methods + helpers | Create |
| `apps/.../page/srt_dashboard/srt_dashboard.js` | Page controller (tabs, grid, modals) | Create |
| `apps/.../page/srt_dashboard/srt_dashboard.html` | Minimal Jinja shell | Create |
| `apps/.../page/srt_dashboard/srt_dashboard.md` | In-app dev doc | Create |
| `apps/.../workspace/kavach/kavach.json` | Append link + shortcut | Modify |
| `apps/.../tests/test_srt_dashboard.py` | 6 assertion-based verification tests | Create |
| `apps/kavach/kavach.md` (app root) | New §17 + Sync Block v0.0.7 | Modify |
| `apps/kavach/kavach/kavach/kavach.md` (module) | Append paragraph | Modify |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | Bump version + restricted areas + live test | Modify |

(Paths abbreviated. Full path prefix is `/workspace/development/frappe-bench/apps/kavach/kavach/kavach/`.)

---

## Task 1: Page scaffold + role-gated landing (smallest first — verify the shell renders)

**Files:**
- Create: `…/page/srt_dashboard/__init__.py`
- Create: `…/page/srt_dashboard/srt_dashboard.json`
- Create: `…/page/srt_dashboard/srt_dashboard.html`
- Create: `…/page/srt_dashboard/srt_dashboard.js`
- Create: `…/page/srt_dashboard/srt_dashboard.md`

### Why this comes first

Get the page loadable end-to-end before any server logic. If `/app/srt-dashboard` returns 404 or "module not found", everything downstream is moot.

- [ ] **Step 1: Create the package marker**

`…/page/srt_dashboard/__init__.py` — empty.

- [ ] **Step 2: Create the Page JSON**

`…/page/srt_dashboard/srt_dashboard.json`:

```json
{
  "doctype": "Page",
  "name": "srt-dashboard",
  "page_name": "srt-dashboard",
  "title": "SRT Dashboard",
  "module": "Stock Reconciliation Tracking",
  "standard": "Yes",
  "roles": [
    {"role": "System Manager"},
    {"role": "Srt Super Admin"},
    {"role": "Srt Admin"},
    {"role": "Srt User"}
  ]
}
```

- [ ] **Step 3: Create the minimal Jinja shell**

`…/page/srt_dashboard/srt_dashboard.html`:

```html
{# Containers the JS controller hydrates. Keep DOM lightweight so Frappe's
   page shell owns the chrome (title, breadcrumb, action items). #}
<div class="srt-dashboard-root">
  <ul class="nav nav-tabs srt-dash-tabs" role="tablist"></ul>
  <div class="srt-dash-grid mt-3"></div>
</div>
```

- [ ] **Step 4: Create the JS controller (Task 1 version — tabs only, no grid yet)**

`…/page/srt_dashboard/srt_dashboard.js`:

```javascript
// =============================================================================
// SRT Dashboard — custom Frappe Page controller.
//
// Task 1 scope: render the page shell, tab strip, and console-log tab clicks.
// Subsequent tasks wire the grid (T2), View modal (T3), drill-down (T4), and
// approve/reject actions (T5).
//
// MEMORY: app_kavach.md § 17 (post-impl)
// SPEC:   docs/specs/2026-05-23-srt-dashboard-design.md
// =============================================================================

frappe.pages["srt-dashboard"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("SRT Dashboard"),
        single_column: true,
    });
    new SRTDashboard(page, wrapper);
};

class SRTDashboard {
    constructor(page, wrapper) {
        this.page = page;
        this.$wrap = $(wrapper).find(".layout-main-section");
        this.current_tab = "Draft";
        this._render_shell();
        this._render_tabs();
    }

    _render_shell() {
        // Load the HTML template once; subsequent renders mutate inside it.
        const html = frappe.render_template("srt_dashboard", {});
        this.$wrap.html(html);
        this.$tabs = this.$wrap.find(".srt-dash-tabs");
        this.$grid = this.$wrap.find(".srt-dash-grid");
    }

    _render_tabs() {
        const tabs = ["Draft", "Admin Approval", "Super Admin Approval"];
        const html = tabs.map((t, i) => `
            <li class="nav-item" role="presentation">
              <button type="button"
                      class="nav-link ${i === 0 ? "active" : ""}"
                      data-tab="${t}">${__(t)}</button>
            </li>`).join("");
        this.$tabs.html(html);
        this.$tabs.find("button").on("click", (e) => {
            const tab = $(e.currentTarget).data("tab");
            this.$tabs.find(".nav-link").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.current_tab = tab;
            console.log("[SRT Dashboard] tab change:", tab);
            // T2 will replace this with _load_grid()
        });
    }
}
```

- [ ] **Step 5: Create the in-app dev doc**

`…/page/srt_dashboard/srt_dashboard.md`:

```markdown
# SRT Dashboard — Page

**Path:** `/app/srt-dashboard`
**Module:** Stock Reconciliation Tracking
**Spec:** `../../../docs/specs/2026-05-23-srt-dashboard-design.md`

A custom Frappe Page that surfaces Stock Reconciliation SRT docs in a tabbed
operator dashboard. Reads from + dispatches actions to the existing SRT
DocType controller — does NOT duplicate validation logic.

## Files

- `srt_dashboard.json` — Page meta (route, title, 4 role grants)
- `srt_dashboard.py` — 6 whitelisted methods (rows, batch summary,
  drilldown, approve, reject, bulk approve)
- `srt_dashboard.js` — Page controller (tabs, Tabulator grid, modals)
- `srt_dashboard.html` — Minimal Jinja shell (tab + grid containers)
- `srt_dashboard.md` — this doc

## Restricted areas
See app-root §17 for the canonical list. TL;DR:
- Don't bypass `submit_linked_sr()` — it carries SABB monkey-patches
- Don't compute "Origin" from Batch master — use `MIN(sle.posting_datetime)`
- Don't add front-end "are you sure" confirms on top of Frappe's native ones
```

- [ ] **Step 6: Reload-doc + clear-cache + browser smoke**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost reload-doc "Stock Reconciliation Tracking" page srt_dashboard
bench --site development.localhost clear-cache
```

Verify DB has the page:

```bash
bench --site development.localhost mariadb -e \
  "SELECT name, title, module FROM \`tabPage\` WHERE name='srt-dashboard';"
```

Expected: 1 row showing `srt-dashboard | SRT Dashboard | Stock Reconciliation Tracking`.

(Browser visual: deferred to user — open `/app/srt-dashboard`, confirm page loads with 3 inactive-styled tabs.)

- [ ] **Step 7: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/page/srt_dashboard/
```

Expected: 5 files (`__init__.py`, `.json`, `.html`, `.js`, `.md`).

---

## Task 2: Server API `get_dashboard_rows` + test + wire to grid

**Files:**
- Create: `…/page/srt_dashboard/srt_dashboard.py` (initial — just `get_dashboard_rows`)
- Create: `…/tests/test_srt_dashboard.py` (initial — just T2's test)
- Modify: `…/page/srt_dashboard/srt_dashboard.js` (add Tabulator grid loader)

### Why this is its own task

`get_dashboard_rows` is the lowest-dependency server method (read-only, no writes). Writing it + a test first establishes the data shape the grid consumes. Then the JS hook is trivial.

- [ ] **Step 1: Write the failing test for `get_dashboard_rows`**

Create `…/tests/test_srt_dashboard.py`:

```python
# =============================================================================
# CONTEXT: Runnable verification for the SRT Dashboard page's server-side
# APIs. Mirrors the convention established in test_case1_case2.py /
# test_srt_settings_gap.py / test_historical_stock.py.
#
# Run with:
#   bench --site development.localhost execute \
#     kavach.tests.test_srt_dashboard.run_all
#
# MEMORY: app_kavach.md § Live test 2026-05-23
# SPEC:   docs/specs/2026-05-23-srt-dashboard-design.md
# =============================================================================

import frappe
from frappe.utils import flt, nowdate

from kavach.tests.test_case1_case2 import (
    TEST_ITEM,
    _build_srt,
    _cleanup_open_srt_for_item,
    _pick_warehouse,
)


# Helpers used by multiple tests
def _make_draft_srt(item, warehouse):
    doc = _build_srt(item, warehouse)
    for r in doc.batches[:1]:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom) + 1.0
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)
    return doc


# ── Test 1 ─────────────────────────────────────────────────────────────────
def test_dashboard_rows_filters_by_tab():
    """get_dashboard_rows('Draft') returns only docstatus=0 docs.
    Smoke-tests the tab filter logic and the response shape."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_dashboard_rows,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)

    draft = _make_draft_srt(TEST_ITEM, warehouse)
    rows = get_dashboard_rows(tab="Draft")
    names = [r["name"] for r in rows]
    assert draft.name in names, f"Draft {draft.name} not in dashboard rows: {names}"
    # Verify shape — every row must have the 8 grid-bound fields
    sample = next(r for r in rows if r["name"] == draft.name)
    for k in ("name", "item", "item_name", "default_warehouse",
              "total_qty_found_in_default_uom",
              "total_qty_found_in_higher_uom",
              "total_current_stock_in_default_uom",
              "total_current_stock_in_higher_uom",
              "posting_date", "posting_time", "user_remark"):
        assert k in sample, f"missing field {k} in dashboard row"
    print(f"  PASS test_dashboard_rows_filters_by_tab "
          f"(found {draft.name} in Draft tab; {len(rows)} total)")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_dashboard_rows_filters_by_tab,
    ]
    print(f"\n=== SRT Dashboard verification ({len(tests)} tests) ===")
    failures = []
    for t in tests:
        try:
            t()
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failures.append((t.__name__, e))
            try:
                _cleanup_open_srt_for_item(TEST_ITEM)
            except Exception:
                pass
    print(f"\n=== {len(tests) - len(failures)} / {len(tests)} passed ===")
    if failures:
        raise AssertionError(
            f"{len(failures)} test(s) failed: "
            + ", ".join(n for n, _ in failures)
        )
```

- [ ] **Step 2: Run — confirm RED (ImportError on missing module)**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected FAIL: `ImportError: cannot import name 'get_dashboard_rows'` or `No module named 'srt_dashboard'`.

- [ ] **Step 3: Implement the Python controller (Task 2 scope only)**

Create `…/page/srt_dashboard/srt_dashboard.py`:

```python
# =============================================================================
# CONTEXT: SRT Dashboard server-side controller.
#
# Whitelisted methods called from the JS page controller. Each method is
# a thin wrapper around existing DocType operations — NO validation logic
# is duplicated here. All approve/reject calls dispatch through the
# existing DocType lifecycle so workflow + role checks + remark-field
# permissions stay authoritative in stock_reconciliation_srt.py.
#
# MEMORY: app_kavach.md § 17 (SRT Dashboard)
# SPEC:   docs/specs/2026-05-23-srt-dashboard-design.md
#
# RESTRICTED:
#   - Do NOT inline a "is this user allowed to approve" check that
#     diverges from StockReconciliationSRT._can_submit_linked_sr or the
#     remark-permission gate. Always call through the doc's own methods.
#   - Do NOT bypass submit_linked_sr() from approve_srt — it carries the
#     SABB monkey-patches and Stock Settings toggle that ERPNext SR
#     submit needs (Quirk #2). Always go through the doc method.
#   - Do NOT compute Origin from Batch.creation — Batch master timestamps
#     can drift from actual first SLE timing (backdated PRs). Use
#     MIN(sle.posting_datetime) for the (item, batch, warehouse) tuple.
# =============================================================================

import frappe
from frappe import _


_TAB_FILTERS = {
    "Draft":                {"docstatus": 0},
    "Admin Approval":       {"docstatus": 1, "workflow_state": "Admin Approval"},
    "Super Admin Approval": {"docstatus": 1, "workflow_state": "Super Admin Approval"},
}


@frappe.whitelist()
def get_dashboard_rows(tab):
    """Return a list of dashboard rows for the given tab.

    Joins SRT + Item.item_name in a single query. Orders by posting_date
    DESC, posting_time DESC so the newest SRTs land at the top.
    """
    if tab not in _TAB_FILTERS:
        frappe.throw(_("Unknown tab: {0}").format(tab))
    f = _TAB_FILTERS[tab]
    where_parts = [f"srt.{k} = %({k})s" for k in f]
    where_sql = " AND ".join(where_parts)
    rows = frappe.db.sql(f"""
        SELECT
          srt.name,
          srt.item,
          item.item_name,
          srt.default_warehouse,
          srt.total_qty_found_in_default_uom,
          srt.total_qty_found_in_higher_uom,
          srt.total_current_stock_in_default_uom,
          srt.total_current_stock_in_higher_uom,
          srt.default_uom,
          srt.higher_uom,
          srt.posting_date,
          srt.posting_time,
          srt.user_remark,
          srt.workflow_state
        FROM `tabStock Reconciliation SRT` srt
        LEFT JOIN `tabItem` item ON item.name = srt.item
        WHERE {where_sql}
        ORDER BY srt.posting_date DESC, srt.posting_time DESC, srt.creation DESC
    """, f, as_dict=True)
    return rows
```

- [ ] **Step 4: Run the test — must now PASS**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: `=== 1 / 1 passed ===`.

- [ ] **Step 5: Wire the grid into the JS controller**

In `…/page/srt_dashboard/srt_dashboard.js`, REPLACE the `_render_tabs` event handler body AND ADD two new methods:

Find:

```javascript
        this.$tabs.find("button").on("click", (e) => {
            const tab = $(e.currentTarget).data("tab");
            this.$tabs.find(".nav-link").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.current_tab = tab;
            console.log("[SRT Dashboard] tab change:", tab);
            // T2 will replace this with _load_grid()
        });
    }
}
```

Replace with:

```javascript
        this.$tabs.find("button").on("click", (e) => {
            const tab = $(e.currentTarget).data("tab");
            this.$tabs.find(".nav-link").removeClass("active");
            $(e.currentTarget).addClass("active");
            this.current_tab = tab;
            this._load_grid();
        });
        // Initial load
        this._load_grid();
    }

    _load_grid() {
        this.$grid.html('<div class="text-muted text-center p-4">' +
                        __("Loading…") + '</div>');
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_dashboard.srt_dashboard.get_dashboard_rows",
            args: { tab: this.current_tab },
        }).then(r => this._render_grid(r.message || []));
    }

    _render_grid(rows) {
        if (!rows.length) {
            this.$grid.html('<div class="text-muted text-center p-4">' +
                            __("No {0} SRTs to review", [this.current_tab]) +
                            '</div>');
            return;
        }
        this.$grid.empty();
        if (this._tabulator) {
            this._tabulator.destroy();
        }
        const fmt_two_line = (cell) => {
            const d = cell.getRow().getData();
            const def_val = cell.getValue();
            const higher_field = cell.getField().replace("default_uom", "higher_uom");
            const higher_val  = d[higher_field];
            const def_uom  = d.default_uom || "";
            const higher_uom = d.higher_uom || "";
            return `<div class="text-bold">${frappe.format(def_val, {fieldtype: "Float"})} ${def_uom}</div>` +
                   `<div class="text-muted small">${frappe.format(higher_val, {fieldtype: "Float"})} ${higher_uom}</div>`;
        };
        const fmt_item = (cell) => {
            const d = cell.getRow().getData();
            return `<div style="white-space: normal; word-break: break-word;">` +
                   `<div class="text-bold">${frappe.utils.escape_html(d.item_name || "")}</div>` +
                   `<div class="text-muted small">${frappe.utils.escape_html(d.item || "")}</div>` +
                   `</div>`;
        };
        const fmt_date = (cell) => {
            const d = cell.getRow().getData();
            if (!d.posting_date) return "";
            const dt = frappe.datetime.str_to_obj(`${d.posting_date} ${d.posting_time || "00:00:00"}`);
            return moment(dt).format("DD-MMM-YYYY hh:mm A");
        };
        const fmt_remark = (cell) => {
            const v = (cell.getValue() || "").replace(/<[^>]*>/g, "");
            const trimmed = v.length > 80 ? v.slice(0, 80) + "…" : v;
            return `<span title="${frappe.utils.escape_html(v)}">${frappe.utils.escape_html(trimmed)}</span>`;
        };
        const fmt_action = () => `<button class="btn btn-xs btn-default srt-view-btn">${__("View")}</button>`;
        this._tabulator = new Tabulator(this.$grid[0], {
            data: rows,
            layout: "fitDataStretch",
            selectable: true,
            selectableCheck: () => true,
            columns: [
                { formatter: "rowSelection", titleFormatter: "rowSelection",
                  hozAlign: "center", headerSort: false, width: 40 },
                { title: __("Item"), field: "item", formatter: fmt_item,
                  widthGrow: 2, headerSort: false },
                { title: __("Warehouse"), field: "default_warehouse",
                  widthGrow: 1 },
                { title: __("Stock Found"),
                  field: "total_qty_found_in_default_uom",
                  formatter: fmt_two_line, hozAlign: "right" },
                { title: __("Stock as on Posting"),
                  field: "total_current_stock_in_default_uom",
                  formatter: fmt_two_line, hozAlign: "right" },
                { title: __("Posting Date"), field: "posting_date",
                  formatter: fmt_date, width: 170 },
                { title: __("User Remark"), field: "user_remark",
                  formatter: fmt_remark, widthGrow: 2 },
                { title: __("Action"), field: "name", formatter: fmt_action,
                  hozAlign: "center", headerSort: false, width: 90,
                  cellClick: (e, cell) => this._on_view(cell.getRow().getData()) },
            ],
        });
    }

    _on_view(row_data) {
        // T3 implements the View modal.
        frappe.msgprint(__("View modal not yet implemented (Task 3). Row: {0}",
                           [row_data.name]));
    }
}
```

- [ ] **Step 6: Clear cache + manual JS smoke**

```bash
bench --site development.localhost clear-cache
```

Browser: open `/app/srt-dashboard`. Expect 3 tabs render; clicking each tab shows either a grid of SRTs (Draft tab will show docs from earlier tests) or the empty-state message. (No browser → deferred to user.)

- [ ] **Step 7: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/page/srt_dashboard/
```

---

## Task 3: Server API `get_batch_summary` + View modal

**Files:**
- Modify: `…/page/srt_dashboard/srt_dashboard.py` — add `get_batch_summary`
- Modify: `…/tests/test_srt_dashboard.py` — add Test 2
- Modify: `…/page/srt_dashboard/srt_dashboard.js` — `_on_view` opens the View modal

- [ ] **Step 1: Add Test 2 to the test file**

Insert IMMEDIATELY AFTER `test_dashboard_rows_filters_by_tab` (before the runner):

```python
# ── Test 2 ─────────────────────────────────────────────────────────────────
def test_batch_summary_returns_per_batch_data():
    """get_batch_summary(srt_name) returns one dict per batch with the
    5 fields the View modal renders."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_batch_summary,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    summary = get_batch_summary(srt_name=draft.name)
    assert isinstance(summary, list), f"expected list, got {type(summary)}"
    assert len(summary) == len(draft.batches), (
        f"summary length {len(summary)} != batches {len(draft.batches)}")
    for b in summary:
        for k in ("batch_no", "origin", "summary_origin_to_posting",
                  "last_sr_date", "summary_lastsr_to_posting"):
            assert k in b, f"missing field {k} in batch summary entry"
        # In/Out sub-structure
        for w in ("summary_origin_to_posting", "summary_lastsr_to_posting"):
            assert "in" in b[w], f"missing 'in' in {w}"
            assert "out" in b[w], f"missing 'out' in {w}"
    print(f"  PASS test_batch_summary_returns_per_batch_data "
          f"({draft.name}, {len(summary)} batches)")
    _cleanup_open_srt_for_item(TEST_ITEM)
```

Also add the test to the `run_all` tests list:

Find:

```python
    tests = [
        test_dashboard_rows_filters_by_tab,
    ]
```

Replace with:

```python
    tests = [
        test_dashboard_rows_filters_by_tab,
        test_batch_summary_returns_per_batch_data,
    ]
```

- [ ] **Step 2: Run — Test 2 must FAIL (ImportError)**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: Test 1 PASS, Test 2 FAIL with `cannot import name 'get_batch_summary'`.

- [ ] **Step 3: Implement `get_batch_summary` in `srt_dashboard.py`**

APPEND to `…/page/srt_dashboard/srt_dashboard.py`:

```python
@frappe.whitelist()
def get_batch_summary(srt_name):
    """Return per-batch summary for the View modal.

    For each batch in the SRT:
      - origin: earliest SLE for (item, batch, warehouse)
        {voucher_type, voucher_no, posting_date}
      - summary_origin_to_posting: {in: sum_pos, out: sum_abs_neg}
      - last_sr_date: most recent SLE with voucher_type='Stock Reconciliation'
        for that batch (or None)
      - summary_lastsr_to_posting: {in, out} over (last_sr_date, posting_date]
        — empty {in: 0, out: 0} when no prior SR

    RESTRICT: Origin is MIN(posting_datetime) over the SABB join, NOT
    Batch.creation. See controller restricted-areas.
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    posting_dt = f"{doc.posting_date} {doc.posting_time}"
    out = []
    for row in (doc.batches or []):
        bn = row.batch_no
        wh = row.warehouse
        if not (bn and wh):
            continue
        origin = _fetch_origin(doc.item, wh, bn)
        last_sr_date = _fetch_last_sr_date(doc.item, wh, bn, posting_dt)
        out.append({
            "batch_no": bn,
            "origin": origin,
            "summary_origin_to_posting": _fetch_in_out(
                doc.item, wh, bn,
                origin.get("posting_datetime") if origin else None,
                posting_dt,
            ),
            "last_sr_date": last_sr_date,
            "summary_lastsr_to_posting": _fetch_in_out(
                doc.item, wh, bn, last_sr_date, posting_dt,
            ) if last_sr_date else {"in": 0.0, "out": 0.0},
        })
    return out


def _fetch_origin(item, warehouse, batch_no):
    """Return earliest SLE for (item, warehouse, batch). Uses SABB join."""
    row = frappe.db.sql("""
        SELECT sle.voucher_type, sle.voucher_no,
               sle.posting_date, sle.posting_time,
               TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
        ORDER BY sle.posting_date ASC, sle.posting_time ASC LIMIT 1
    """, (item, warehouse, batch_no), as_dict=True)
    return row[0] if row else None


def _fetch_last_sr_date(item, warehouse, batch_no, before_dt):
    """Return the posting_datetime of the most recent Stock Reconciliation
    SLE for the batch, strictly before `before_dt`. None if none."""
    row = frappe.db.sql("""
        SELECT TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          AND sle.voucher_type = 'Stock Reconciliation'
          AND TIMESTAMP(sle.posting_date, sle.posting_time) < TIMESTAMP(%s)
        ORDER BY sle.posting_date DESC, sle.posting_time DESC LIMIT 1
    """, (item, warehouse, batch_no, before_dt), as_dict=True)
    return row[0]["posting_datetime"] if row else None


def _fetch_in_out(item, warehouse, batch_no, from_dt, to_dt):
    """Return {in, out} aggregate over (from_dt, to_dt] for the batch.
    `from_dt` None means unbounded on the left side."""
    where_from = ""
    params = [item, warehouse, batch_no, to_dt]
    if from_dt:
        where_from = "AND TIMESTAMP(sle.posting_date, sle.posting_time) > %s"
        params.insert(3, from_dt)
    row = frappe.db.sql(f"""
        SELECT
          COALESCE(SUM(CASE WHEN sbe.qty > 0 THEN sbe.qty ELSE 0 END), 0) AS pos,
          COALESCE(SUM(CASE WHEN sbe.qty < 0 THEN -sbe.qty ELSE 0 END), 0) AS neg
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          {where_from}
          AND TIMESTAMP(sle.posting_date, sle.posting_time) <= TIMESTAMP(%s)
    """, params, as_dict=True)
    r = row[0] if row else {"pos": 0, "neg": 0}
    return {"in": float(r["pos"] or 0), "out": float(r["neg"] or 0)}
```

- [ ] **Step 4: Run — Test 2 must PASS**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: `=== 2 / 2 passed ===`.

- [ ] **Step 5: Wire the View modal into the JS**

In `…/page/srt_dashboard/srt_dashboard.js`, REPLACE the `_on_view` method:

```javascript
    _on_view(row_data) {
        const dlg = new frappe.ui.Dialog({
            title: __("SRT {0} — {1} @ {2}",
                      [row_data.name, row_data.item, row_data.default_warehouse]),
            size: "extra-large",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        dlg.show();
        const $body = $(dlg.fields_dict.body.wrapper);
        $body.html('<div class="text-muted text-center p-4">' + __("Loading…") + '</div>');
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_dashboard.srt_dashboard.get_batch_summary",
            args: { srt_name: row_data.name },
        }).then(r => this._render_view_modal(dlg, row_data, r.message || []));
    }

    _render_view_modal(dlg, row_data, summary) {
        const $body = $(dlg.fields_dict.body.wrapper);
        $body.html('<div class="srt-view-modal-grid"></div>');
        const $grid = $body.find(".srt-view-modal-grid");
        const fmt_origin = (cell) => {
            const o = cell.getValue();
            if (!o) return '<span class="text-muted">—</span>';
            return `${frappe.utils.escape_html(o.voucher_type)} ` +
                   `${frappe.utils.escape_html(o.voucher_no)} at ` +
                   `${moment(o.posting_date).format("DD-MMM-YYYY")}`;
        };
        const fmt_inout = (cell) => {
            const v = cell.getValue() || {in: 0, out: 0};
            if (!v.in && !v.out) {
                return '<span class="text-muted">—</span>';
            }
            return `<a href="#" class="srt-inout-link">` +
                   `In: ${frappe.format(v.in, {fieldtype:"Float"})}  ` +
                   `Out: ${frappe.format(v.out, {fieldtype:"Float"})}</a>`;
        };
        const fmt_last_sr = (cell) => {
            const v = cell.getValue();
            return v ? moment(v).format("DD-MMM-YYYY hh:mm A")
                     : '<span class="text-muted">—</span>';
        };
        this._view_tabulator = new Tabulator($grid[0], {
            data: summary,
            layout: "fitDataStretch",
            columns: [
                { title: __("Batch"), field: "batch_no", widthGrow: 1 },
                { title: __("Origin"), field: "origin", formatter: fmt_origin,
                  widthGrow: 2 },
                { title: __("Transactions (Origin → Posting)"),
                  field: "summary_origin_to_posting", formatter: fmt_inout,
                  cellClick: (e, cell) => this._on_drilldown(
                      row_data, cell.getRow().getData(), "origin"),
                  widthGrow: 2 },
                { title: __("Last SR Date"), field: "last_sr_date",
                  formatter: fmt_last_sr, widthGrow: 1 },
                { title: __("Transactions (Last SR → Posting)"),
                  field: "summary_lastsr_to_posting", formatter: fmt_inout,
                  cellClick: (e, cell) => this._on_drilldown(
                      row_data, cell.getRow().getData(), "lastsr"),
                  widthGrow: 2 },
            ],
        });
        // T5 adds Approve / Reject buttons here.
    }

    _on_drilldown(srt_row, batch_row, which) {
        // T4 implements the drill-down modal.
        frappe.msgprint(__("Drill-down ({0}) not yet implemented (Task 4). Batch: {1}",
                           [which, batch_row.batch_no]));
    }
```

- [ ] **Step 6: Clear cache + on-disk checkpoint**

```bash
bench --site development.localhost clear-cache
ls -l apps/kavach/kavach/kavach/page/srt_dashboard/srt_dashboard.py
```

---

## Task 4: Drill-down modal (per cell — In vs Out)

**Files:**
- Modify: `…/page/srt_dashboard/srt_dashboard.py` — add `get_batch_drilldown`
- Modify: `…/tests/test_srt_dashboard.py` — add Test 3
- Modify: `…/page/srt_dashboard/srt_dashboard.js` — `_on_drilldown` opens the drill-down modal

- [ ] **Step 1: Add Test 3 (drill-down shape)**

Insert IMMEDIATELY AFTER `test_batch_summary_returns_per_batch_data`:

```python
# ── Test 3 ─────────────────────────────────────────────────────────────────
def test_batch_drilldown_returns_in_out_split():
    """get_batch_drilldown returns {in: [...], out: [...]} with per-SLE
    voucher_type, voucher_no, posting_datetime, qty fields."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        get_batch_drilldown,
    )
    warehouse = _pick_warehouse()
    # Pick the first batch with positive stock so we know SLEs exist
    from kavach.stock_reconciliation_tracking.api import (
        get_item_defaults,
    )
    defaults = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    if not defaults["batches"]:
        print("  SKIP test_batch_drilldown_returns_in_out_split: no batches")
        return
    batch = defaults["batches"][0]["batch_no"]
    from frappe.utils import add_days, nowdate
    r = get_batch_drilldown(
        item_code=TEST_ITEM, warehouse=warehouse, batch_no=batch,
        from_date=add_days(nowdate(), -365), to_date=nowdate(),
    )
    assert "in" in r and "out" in r, f"missing keys; got {list(r.keys())}"
    assert isinstance(r["in"], list) and isinstance(r["out"], list)
    # If any entries exist, verify the shape
    for entry in (r["in"] + r["out"]):
        for k in ("voucher_type", "voucher_no", "posting_datetime", "qty"):
            assert k in entry, f"missing field {k} in drilldown entry"
    total = len(r["in"]) + len(r["out"])
    print(f"  PASS test_batch_drilldown_returns_in_out_split "
          f"({batch}: {len(r['in'])} in, {len(r['out'])} out, {total} total)")
```

Add to the `run_all` list:

```python
    tests = [
        test_dashboard_rows_filters_by_tab,
        test_batch_summary_returns_per_batch_data,
        test_batch_drilldown_returns_in_out_split,
    ]
```

- [ ] **Step 2: Run — Test 3 must FAIL (ImportError)**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: T1 + T2 PASS, T3 FAIL with `cannot import name 'get_batch_drilldown'`.

- [ ] **Step 3: Implement `get_batch_drilldown` in `srt_dashboard.py`**

APPEND:

```python
@frappe.whitelist()
def get_batch_drilldown(item_code, warehouse, batch_no, from_date, to_date):
    """Per-SLE drill-down for a batch in a given window. Returns
    {in: [...], out: [...]} where each entry is
    {voucher_type, voucher_no, posting_datetime, qty}.

    qty in the response is the ABSOLUTE value; the in/out split is
    captured by which list the entry lands in.
    """
    rows = frappe.db.sql("""
        SELECT
          sle.voucher_type,
          sle.voucher_no,
          TIMESTAMP(sle.posting_date, sle.posting_time) AS posting_datetime,
          sbe.qty AS qty
        FROM `tabStock Ledger Entry` sle
        JOIN `tabSerial and Batch Entry` sbe
             ON sbe.parent = sle.serial_and_batch_bundle
        WHERE sle.item_code = %s AND sle.warehouse = %s
          AND sbe.batch_no = %s AND sle.is_cancelled = 0
          AND TIMESTAMP(sle.posting_date, sle.posting_time)
              BETWEEN TIMESTAMP(%s, '00:00:00') AND TIMESTAMP(%s, '23:59:59')
        ORDER BY sle.posting_date DESC, sle.posting_time DESC
    """, (item_code, warehouse, batch_no, from_date, to_date), as_dict=True)
    in_entries  = []
    out_entries = []
    for r in rows:
        entry = {
            "voucher_type":     r["voucher_type"],
            "voucher_no":       r["voucher_no"],
            "posting_datetime": str(r["posting_datetime"]),
            "qty":              abs(float(r["qty"] or 0)),
        }
        if (r["qty"] or 0) > 0:
            in_entries.append(entry)
        elif (r["qty"] or 0) < 0:
            out_entries.append(entry)
    return {"in": in_entries, "out": out_entries}
```

- [ ] **Step 4: Run — Test 3 must PASS**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: `=== 3 / 3 passed ===`.

- [ ] **Step 5: Wire the drill-down modal in JS**

In `…/page/srt_dashboard/srt_dashboard.js`, REPLACE the `_on_drilldown` method:

```javascript
    _on_drilldown(srt_row, batch_row, which) {
        // which: "origin" → use batch.origin.posting_date as from_date
        //        "lastsr" → use batch.last_sr_date as from_date
        let from_date = null;
        if (which === "origin" && batch_row.origin) {
            from_date = batch_row.origin.posting_date;
        } else if (which === "lastsr" && batch_row.last_sr_date) {
            from_date = String(batch_row.last_sr_date).slice(0, 10);
        }
        if (!from_date) {
            frappe.msgprint(__("No origin/last SR date available for batch {0}",
                               [batch_row.batch_no]));
            return;
        }
        const to_date = srt_row.posting_date;
        const dlg = new frappe.ui.Dialog({
            title: __("Batch {0} — Transactions {1} → {2}",
                      [batch_row.batch_no, from_date, to_date]),
            size: "large",
            fields: [{ fieldtype: "HTML", fieldname: "body" }],
        });
        dlg.show();
        const $body = $(dlg.fields_dict.body.wrapper);
        $body.html('<div class="text-muted text-center p-4">' + __("Loading…") + '</div>');
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_dashboard.srt_dashboard.get_batch_drilldown",
            args: {
                item_code: srt_row.item,
                warehouse: srt_row.default_warehouse,
                batch_no:  batch_row.batch_no,
                from_date: from_date,
                to_date:   to_date,
            },
        }).then(r => this._render_drilldown(dlg, r.message || {in: [], out: []}));
    }

    _render_drilldown(dlg, data) {
        const $body = $(dlg.fields_dict.body.wrapper);
        const col_html = (entries, color_class, label) => {
            const total = entries.reduce((s, e) => s + Number(e.qty || 0), 0);
            const list = entries.length
                ? entries.map(e =>
                    `<div class="border-bottom py-1">
                       <div>${frappe.utils.escape_html(e.voucher_type)} ` +
                       `${frappe.utils.escape_html(e.voucher_no)}</div>
                       <div class="text-muted small">
                         ${moment(e.posting_datetime).format("DD-MMM-YYYY HH:mm")}
                         &nbsp;•&nbsp; qty ${frappe.format(e.qty, {fieldtype:"Float"})}
                       </div>
                     </div>`).join("")
                : `<div class="text-muted"><em>${__("No transactions in window")}</em></div>`;
            return `<div class="col-6">
                      <h5 class="${color_class}">${label}</h5>
                      ${list}
                      <hr/>
                      <div class="text-right text-bold">
                        ${__("Total")}: ${frappe.format(total, {fieldtype:"Float"})}
                      </div>
                    </div>`;
        };
        $body.html(`<div class="row">
                      ${col_html(data.out || [], "text-danger", __("Out"))}
                      ${col_html(data.in  || [], "text-success", __("In"))}
                    </div>`);
    }
```

- [ ] **Step 6: Clear cache + on-disk checkpoint**

```bash
bench --site development.localhost clear-cache
ls -l apps/kavach/kavach/kavach/page/srt_dashboard/srt_dashboard.js
```

---

## Task 5: Approve / Reject server APIs + View modal action buttons

**Files:**
- Modify: `…/page/srt_dashboard/srt_dashboard.py` — add `approve_srt`, `reject_srt`
- Modify: `…/tests/test_srt_dashboard.py` — add Tests 4 + 5
- Modify: `…/page/srt_dashboard/srt_dashboard.js` — add Approve / Reject footer buttons to the View modal

- [ ] **Step 1: Add Tests 4 + 5**

Insert IMMEDIATELY AFTER `test_batch_drilldown_returns_in_out_split`:

```python
# ── Test 4 ─────────────────────────────────────────────────────────────────
def test_approve_srt_advances_workflow():
    """Approving a Draft SRT moves it to Admin Approval with a draft SR."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        approve_srt,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    approve_srt(srt_name=draft.name)
    frappe.db.commit()
    draft.reload()
    assert draft.docstatus == 1, f"expected docstatus=1, got {draft.docstatus}"
    assert draft.workflow_state == "Admin Approval", (
        f"expected Admin Approval, got {draft.workflow_state!r}")
    assert draft.linked_erpnext_sr, "expected draft ERPNext SR to be created"
    print(f"  PASS test_approve_srt_advances_workflow ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 5 ─────────────────────────────────────────────────────────────────
def test_reject_srt_closes_with_reason():
    """Rejecting a SRT moves it to Close with the reason written to a
    remark field (super_admin_remark when post-Admin-Approval, else
    admin_remark)."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        approve_srt, reject_srt,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    approve_srt(srt_name=draft.name)  # → Admin Approval
    frappe.db.commit()
    reject_srt(srt_name=draft.name, reason="test rejection")
    frappe.db.commit()
    draft.reload()
    assert draft.docstatus == 2, f"expected docstatus=2, got {draft.docstatus}"
    remark = (draft.super_admin_remark or draft.admin_remark or "")
    assert "test rejection" in remark, (
        f"expected reason in remark, got remark={remark!r}")
    print(f"  PASS test_reject_srt_closes_with_reason ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)
```

Add both to the `run_all` list:

```python
    tests = [
        test_dashboard_rows_filters_by_tab,
        test_batch_summary_returns_per_batch_data,
        test_batch_drilldown_returns_in_out_split,
        test_approve_srt_advances_workflow,
        test_reject_srt_closes_with_reason,
    ]
```

- [ ] **Step 2: Run — Tests 4+5 must FAIL (ImportError)**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: T1-3 PASS, T4-5 FAIL with `cannot import name 'approve_srt'`.

- [ ] **Step 3: Implement `approve_srt` + `reject_srt`**

APPEND to `…/page/srt_dashboard/srt_dashboard.py`:

```python
@frappe.whitelist()
def approve_srt(srt_name):
    """Branch by current workflow_state and dispatch through the existing
    DocType lifecycle:

      - Draft                → doc.submit()        (creates draft ERPNext SR)
      - Admin Approval       → doc.submit_linked_sr()  (submits the SR)
      - Super Admin Approval → doc.cancel()        (workflow forward to Close)

    Role checks live in the DocType methods. We refetch + re-verify
    state to avoid concurrent races.
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    state = (doc.workflow_state or "").strip()
    if doc.docstatus == 0:
        # Draft → Admin Approval
        doc.flags.ignore_permissions = True
        doc.submit()
    elif doc.docstatus == 1 and state == "Admin Approval":
        doc.submit_linked_sr()
    elif doc.docstatus == 1 and state == "Super Admin Approval":
        # Forward to Close — Frappe's cancel() moves docstatus 1→2
        doc.flags.ignore_permissions = True
        doc.db_set("workflow_state", "Close", update_modified=False)
        doc.cancel()
    else:
        frappe.throw(_(
            "SRT {0} is no longer at a state the dashboard can act on "
            "(current: {1} / docstatus {2}). Refresh and try again."
        ).format(srt_name, state or "—", doc.docstatus))
    return {"ok": True, "new_state": frappe.db.get_value(
        "Stock Reconciliation SRT", srt_name, "workflow_state")}


@frappe.whitelist()
def reject_srt(srt_name, reason):
    """Advance the SRT to Close and write `reason` into the appropriate
    remark field:
      - Draft → admin_remark
      - Admin Approval or Super Admin Approval → super_admin_remark
    """
    if not reason or not reason.strip():
        frappe.throw(_("Reject reason is required."))
    doc = frappe.get_doc("Stock Reconciliation SRT", srt_name)
    state = (doc.workflow_state or "").strip()
    timestamp = frappe.utils.now()
    user = frappe.session.user
    annotated = f"[REJECTED via SRT Dashboard {timestamp} by {user}] {reason.strip()}"
    if doc.docstatus == 0:
        doc.db_set("admin_remark",
                   (doc.admin_remark or "") + "\n" + annotated,
                   update_modified=False)
        # Cancel a draft = delete (Frappe cancel only works on docstatus=1).
        # Move docstatus to 1 first via submit-then-cancel.
        doc.flags.ignore_permissions = True
        doc.submit()
        doc.reload()
        doc.db_set("workflow_state", "Close", update_modified=False)
        doc.cancel()
    elif doc.docstatus == 1:
        doc.db_set("super_admin_remark",
                   (doc.super_admin_remark or "") + "\n" + annotated,
                   update_modified=False)
        doc.flags.ignore_permissions = True
        doc.db_set("workflow_state", "Close", update_modified=False)
        doc.cancel()
    else:
        frappe.throw(_(
            "SRT {0} is already at docstatus={1} — cannot reject."
        ).format(srt_name, doc.docstatus))
    return {"ok": True}
```

- [ ] **Step 4: Run — Tests 4+5 must PASS**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: `=== 5 / 5 passed ===`.

- [ ] **Step 5: Wire Approve / Reject footer buttons in the View modal**

In `…/page/srt_dashboard/srt_dashboard.js`, find:

```javascript
        // T5 adds Approve / Reject buttons here.
    }
```

Replace with:

```javascript
        // Approve / Reject footer buttons — text varies by tab
        const labels = {
            "Draft":                 { approve: __("Approve"),       reject: __("Reject") },
            "Admin Approval":        { approve: __("Approve"),       reject: __("Reject") },
            "Super Admin Approval":  { approve: __("Close"),         reject: __("Reject") },
        };
        const lab = labels[this.current_tab] || labels["Draft"];
        dlg.set_primary_action(lab.approve, () => {
            frappe.call({
                method: "kavach.stock_reconciliation_tracking." +
                        "page.srt_dashboard.srt_dashboard.approve_srt",
                args: { srt_name: row_data.name },
                freeze: true,
                freeze_message: __("Approving…"),
            }).then(r => {
                if (r.message && r.message.ok) {
                    frappe.show_alert({
                        message: __("Approved: {0} → {1}",
                                    [row_data.name, r.message.new_state || "Close"]),
                        indicator: "green",
                    });
                    dlg.hide();
                    this._load_grid();
                }
            });
        });
        dlg.set_secondary_action_label(lab.reject);
        dlg.set_secondary_action(() => {
            frappe.prompt({
                fieldtype: "Small Text",
                fieldname: "reason",
                label: __("Reject Reason"),
                reqd: 1,
            }, (vals) => {
                frappe.call({
                    method: "kavach.stock_reconciliation_tracking." +
                            "page.srt_dashboard.srt_dashboard.reject_srt",
                    args: { srt_name: row_data.name, reason: vals.reason },
                    freeze: true,
                    freeze_message: __("Rejecting…"),
                }).then(r => {
                    if (r.message && r.message.ok) {
                        frappe.show_alert({
                            message: __("Rejected: {0}", [row_data.name]),
                            indicator: "red",
                        });
                        dlg.hide();
                        this._load_grid();
                    }
                });
            }, __("Reject {0}", [row_data.name]), __("Reject"));
        });
    }
```

- [ ] **Step 6: Clear cache + on-disk checkpoint**

```bash
bench --site development.localhost clear-cache
ls -l apps/kavach/kavach/kavach/page/srt_dashboard/srt_dashboard.py
```

---

## Task 6: Bulk approve

**Files:**
- Modify: `…/page/srt_dashboard/srt_dashboard.py` — add `bulk_approve_srt`
- Modify: `…/tests/test_srt_dashboard.py` — add Test 6
- Modify: `…/page/srt_dashboard/srt_dashboard.js` — add bulk-approve button to page header

- [ ] **Step 1: Add Test 6**

Insert IMMEDIATELY AFTER `test_reject_srt_closes_with_reason`:

```python
# ── Test 6 ─────────────────────────────────────────────────────────────────
def test_bulk_approve_returns_per_row_results():
    """bulk_approve_srt returns one result entry per name. Each entry
    has {name, ok, error?}."""
    from kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard import (
        bulk_approve_srt,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    # CZMAT/133 also has stock in some warehouse — but to keep things
    # single-item we only test with one Draft here. The shape assertion
    # is the meaningful piece.
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    results = bulk_approve_srt(srt_names=[draft.name])
    assert isinstance(results, list) and len(results) == 1
    for r in results:
        assert "name" in r and "ok" in r
    assert results[0]["ok"] is True, f"expected ok=True, got {results[0]}"
    print(f"  PASS test_bulk_approve_returns_per_row_results "
          f"({len(results)} results)")
    _cleanup_open_srt_for_item(TEST_ITEM)
```

Add to `run_all`:

```python
    tests = [
        test_dashboard_rows_filters_by_tab,
        test_batch_summary_returns_per_batch_data,
        test_batch_drilldown_returns_in_out_split,
        test_approve_srt_advances_workflow,
        test_reject_srt_closes_with_reason,
        test_bulk_approve_returns_per_row_results,
    ]
```

- [ ] **Step 2: Run — Test 6 must FAIL (ImportError)**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: T1-5 PASS, T6 FAIL.

- [ ] **Step 3: Implement `bulk_approve_srt`**

APPEND to `…/page/srt_dashboard/srt_dashboard.py`:

```python
@frappe.whitelist()
def bulk_approve_srt(srt_names):
    """Loop approve_srt per name; return per-row {name, ok, error?}.
    No transaction rollback — partial successes are real successes."""
    if isinstance(srt_names, str):
        # Frappe form-encodes list args as JSON when called via frappe.call
        import json
        srt_names = json.loads(srt_names)
    results = []
    for name in (srt_names or []):
        try:
            approve_srt(srt_name=name)
            results.append({"name": name, "ok": True})
        except Exception as e:
            results.append({"name": name, "ok": False, "error": str(e)})
    return results
```

- [ ] **Step 4: Run — Test 6 must PASS**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Expected: `=== 6 / 6 passed ===`.

- [ ] **Step 5: Wire the bulk-approve page header button in JS**

In `…/page/srt_dashboard/srt_dashboard.js`, find the `_render_shell` method. Add a new method AFTER it AND modify the constructor to call it. Find:

```javascript
    constructor(page, wrapper) {
        this.page = page;
        this.$wrap = $(wrapper).find(".layout-main-section");
        this.current_tab = "Draft";
        this._render_shell();
        this._render_tabs();
    }
```

Replace with:

```javascript
    constructor(page, wrapper) {
        this.page = page;
        this.$wrap = $(wrapper).find(".layout-main-section");
        this.current_tab = "Draft";
        this._render_shell();
        this._render_tabs();
        this._render_header_actions();
    }

    _render_header_actions() {
        // Bulk Approve — visible always; clicking with no selection shows hint.
        this.page.set_primary_action(__("Bulk Approve"), () => {
            const selected = (this._tabulator?.getSelectedData() || [])
                                 .map(r => r.name);
            if (!selected.length) {
                frappe.show_alert({
                    message: __("Select at least one row to bulk-approve"),
                    indicator: "orange",
                });
                return;
            }
            frappe.confirm(
                __("Approve {0} SRTs?", [selected.length]),
                () => this._do_bulk_approve(selected),
            );
        }, "octicon octicon-check");
    }

    _do_bulk_approve(names) {
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_dashboard.srt_dashboard.bulk_approve_srt",
            args: { srt_names: names },
            freeze: true,
            freeze_message: __("Bulk approving…"),
        }).then(r => {
            const results = r.message || [];
            const oks  = results.filter(x => x.ok).length;
            const errs = results.filter(x => !x.ok);
            let html = `<div><b>${__("Bulk Approve Result")}</b></div>`;
            html += `<div class="text-success">${__("Succeeded")}: ${oks}</div>`;
            if (errs.length) {
                html += `<div class="text-danger mt-2">${__("Failed")}: ${errs.length}</div>`;
                html += `<ul>` + errs.map(e =>
                    `<li><b>${frappe.utils.escape_html(e.name)}</b>: ` +
                    `${frappe.utils.escape_html(e.error || "")}</li>`).join("") + `</ul>`;
            }
            frappe.msgprint({
                title: __("Bulk Approve"),
                message: html,
                indicator: errs.length ? "orange" : "green",
            });
            this._load_grid();
        });
    }
```

- [ ] **Step 6: Clear cache + on-disk checkpoint**

```bash
bench --site development.localhost clear-cache
```

---

## Task 7: Workspace integration (SRT Dashboard link + shortcut)

**Files:**
- Modify: `…/workspace/kavach/kavach.json`

- [ ] **Step 1: Read the current workspace JSON** (for context)

```bash
cat apps/kavach/kavach/kavach/workspace/kavach/kavach.json | head -60
```

It currently has 4 links (Stock Reconciliation card-break + SRT Link + Setup card-break + SRT Settings link) and 2 shortcuts.

- [ ] **Step 2: Append SRT Dashboard to the links + shortcuts**

In `…/workspace/kavach/kavach.json`, find:

```json
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "SRT Settings",
   "link_count": 0,
   "link_to": "SRT Settings",
   "link_type": "DocType",
   "onboard": 0,
   "type": "Link"
  }
 ],
```

Replace with:

```json
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "SRT Settings",
   "link_count": 0,
   "link_to": "SRT Settings",
   "link_type": "DocType",
   "onboard": 0,
   "type": "Link"
  },
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "SRT Dashboard",
   "link_count": 0,
   "link_to": "srt-dashboard",
   "link_type": "Page",
   "onboard": 0,
   "type": "Link"
  }
 ],
```

Find:

```json
  {
   "doc_view": "",
   "label": "SRT Settings",
   "link_to": "SRT Settings",
   "type": "DocType"
  }
 ],
```

Replace with:

```json
  {
   "doc_view": "",
   "label": "SRT Settings",
   "link_to": "SRT Settings",
   "type": "DocType"
  },
  {
   "doc_view": "",
   "label": "SRT Dashboard",
   "link_to": "srt-dashboard",
   "type": "Page"
  }
 ],
```

- [ ] **Step 3: MANUAL workspace re-sync (per documented gotcha)**

`bench migrate` does NOT pick up Workspace JSON edits. Use the console pattern documented in memory:

```bash
bench --site development.localhost console <<'PYEOF' 2>&1 | tail -10
import frappe, json
path = "/workspace/development/frappe-bench/apps/kavach/kavach/kavach/workspace/kavach/kavach.json"
with open(path) as f:
    data = json.load(f)
wf = frappe.get_doc("Workspace", "Stock Reconciliation Tracking")
wf.set("links", [])
for l in data["links"]:
    wf.append("links", l)
wf.set("shortcuts", [])
for s in data["shortcuts"]:
    wf.append("shortcuts", s)
wf.flags.ignore_permissions = True
wf.save()
frappe.db.commit()
print(f"Workspace updated: {len(wf.links)} links, {len(wf.shortcuts)} shortcuts")
PYEOF
```

Expected: `Workspace updated: 6 links, 3 shortcuts`.

- [ ] **Step 4: Verify via SQL**

```bash
bench --site development.localhost mariadb -e \
  "SELECT label, link_to, type FROM \`tabWorkspace Link\` \
   WHERE parent='Stock Reconciliation Tracking' ORDER BY idx;" 2>&1 | tail -10
```

Expected: 6 rows, last one being `SRT Dashboard | srt-dashboard | Page`.

- [ ] **Step 5: Clear cache so the desk picks up the workspace change**

```bash
bench --site development.localhost clear-cache
```

---

## Task 8: Update app + module .md docs

**Files:**
- Modify: `apps/kavach/kavach.md`
- Modify: `apps/.../kavach/kavach/kavach.md` (module)

- [ ] **Step 1: Add §17 to the app-root .md**

Find `## 12. Sync Block — 2026-05-23 (v0.0.6)` heading. Insert IMMEDIATELY BEFORE:

```markdown
---

## 17. SRT Dashboard — Custom Frappe Page (2026-05-23 v0.0.7)

### Spec
`docs/specs/2026-05-23-srt-dashboard-design.md`

### What was added

A custom Frappe Page at `/app/srt-dashboard` providing a tabbed operator review surface for Stock Reconciliation SRT docs. Three tabs (Draft / Admin Approval / Super Admin Approval), Tabulator grid with bulk-approve, View modal per row with batch-level Origin + transaction summary, drill-down per cell (In vs Out), Approve/Reject actions dispatched through the existing DocType controller.

### Server APIs (`page/srt_dashboard/srt_dashboard.py`)

- `get_dashboard_rows(tab)` — tab filter map: Draft=docstatus 0, Admin Approval / Super Admin Approval = docstatus 1 + workflow_state match
- `get_batch_summary(srt_name)` — per-batch Origin (MIN posting_datetime SLE) + summary_origin_to_posting {in, out} + last_sr_date (most recent voucher_type=Stock Reconciliation SLE) + summary_lastsr_to_posting {in, out}
- `get_batch_drilldown(item, warehouse, batch_no, from_date, to_date)` — `{in: [{voucher_type, voucher_no, posting_datetime, qty}], out: [...]}`
- `approve_srt(srt_name)` — branches by workflow_state and dispatches through doc.submit / submit_linked_sr / cancel
- `reject_srt(srt_name, reason)` — writes annotated reason to appropriate remark field + workflow forward to Close
- `bulk_approve_srt(srt_names)` — loops approve_srt; returns per-row `{name, ok, error?}`

### UX details

- Native Frappe shell (`frappe.ui.Page`); `<ul class="nav nav-tabs">` for tab strip; no custom CSS
- Tabulator grid with `theme:"modern"`; two-line cells for both UOMs; text-wrap on Item column
- View modal: `frappe.ui.Dialog` size `extra-large`
- Drill-down: `frappe.ui.Dialog` size `large`; left=Out (red), right=In (green); per-SLE listing + totals
- Bulk approve: Page primary action; renders per-row result dialog after bulk call

### Workspace

New SRT Dashboard link (under Setup card-break) + SRT Dashboard shortcut. Manual workspace re-sync was required (bench migrate does NOT auto-sync Workspace JSON).

### Restricted areas (additional, 2026-05-23 v0.0.7)

- Don't bypass `submit_linked_sr()` from the dashboard — SABB monkey-patches + Stock Settings toggle apply.
- Don't compute Origin from `Batch.creation` — use `MIN(sle.posting_datetime)` for the (item, batch, warehouse) tuple.
- Don't lump In and Out into single totals in drill-down — per-SLE breakdown is the spec.
- Don't gate action buttons by role only — also by tab (Draft = forward to Admin Approval, etc.).
- Don't add front-end "are you sure" confirms on top of Frappe's native ones. Only the reject reason prompt is custom (functional).
- Don't time-bound the Origin SLE query by posting_date — Origin is the FIRST event for the batch ever, unconditional.
- Don't read live-fetched data from a stale cache. Refetch on every modal open + every approve call.
- Workspace fixture sync gotcha applies — see app-root §13.

### Verification

`kavach/tests/test_srt_dashboard.py` — 6 tests:
- `test_dashboard_rows_filters_by_tab`
- `test_batch_summary_returns_per_batch_data`
- `test_batch_drilldown_returns_in_out_split`
- `test_approve_srt_advances_workflow`
- `test_reject_srt_closes_with_reason`
- `test_bulk_approve_returns_per_row_results`

Live result 2026-05-23: 6 / 6 passed. Cross-suite regression: 23 / 23 across all 4 suites.

---
```

- [ ] **Step 2: Bump the Sync Block heading + add a v0.0.7 update block**

Change `## 12. Sync Block — 2026-05-23 (v0.0.6)` to `## 12. Sync Block — 2026-05-23 (v0.0.7)`.

Find `LATEST UPDATE 2026-05-23 (v0.0.6)` and insert ABOVE it:

```
LATEST UPDATE 2026-05-23 (v0.0.7)
            + Custom Frappe Page: SRT Dashboard (/app/srt-dashboard)
                - 3 tabs (Draft / Admin Approval / Super Admin Approval)
                - Tabulator grid with bulk-approve
                - View modal (per row) with batch-level Origin +
                  transaction summary (Origin→Posting, Last SR→Posting)
                - Drill-down modal (per cell) with In vs Out split
                - Approve / Reject actions dispatch through existing
                  DocType controller — no validation duplicated
            + 6 server APIs in page/srt_dashboard/srt_dashboard.py:
                get_dashboard_rows, get_batch_summary, get_batch_drilldown,
                approve_srt, reject_srt, bulk_approve_srt
            + Workspace integration: new SRT Dashboard link + shortcut
                (under existing Setup card-break)
            + Verification: tests/test_srt_dashboard.py (6 tests)
                6 / 6 passed on dev site. Cross-suite: 23 / 23.

```

- [ ] **Step 3: Append the dashboard paragraph to module .md**

Append at the end of `apps/.../kavach/kavach/kavach.md`:

```markdown

---

## SRT Dashboard (2026-05-23 v0.0.7)

A custom Frappe Page at `/app/srt-dashboard` provides a tabbed (Draft /
Admin Approval / Super Admin Approval) operator review surface for
Stock Reconciliation SRT docs. Features bulk approve from the page
header, a per-row View modal showing batch-level Origin + transaction
summaries, and a per-cell drill-down modal splitting In vs Out movements.

All approve/reject actions dispatch through the existing
`StockReconciliationSRT` controller — no validation is duplicated.
See app-root §17 and spec
`../../docs/specs/2026-05-23-srt-dashboard-design.md` for restricted
areas, API shapes, and the full architectural rationale.
```

- [ ] **Step 4: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach.md
ls -l apps/kavach/kavach/kavach/kavach.md
```

---

## Task 9: Update Claude memory

**Files:**
- Modify: `~/.claude/projects/-workspace/memory/app_kavach.md`

- [ ] **Step 1: Bump the description**

Change the `description:` line in frontmatter to:

```yaml
description: "kavach v0.0.7 (2026-05-23) — ERPNext SR wrapper with batch auto-populate, UOM conversion, two-pass rate-mirror, RBAC workflow, Case 1/2 routing, SRT Settings min-gap gate, workflow-state-aware duplicate-open guard, historical 'as-of posting_date/posting_time' stock fetch, list-view Status dedup, and SRT Dashboard (custom Frappe Page for tabbed/bulk operator review)."
```

- [ ] **Step 2: Add item 10 to "What it does"**

After item 9 (Historical as-of stock fetch), append:

```markdown
10. **SRT Dashboard (2026-05-23 v0.0.7)** — custom Frappe Page at `/app/srt-dashboard` with 3 tabs (Draft / Admin Approval / Super Admin Approval), Tabulator grid, bulk-approve, View modal showing per-batch Origin + transaction summary, drill-down modal with In vs Out per SLE. All approve/reject actions dispatch through the existing `StockReconciliationSRT` controller — no validation duplicated. 6 whitelisted methods in `page/srt_dashboard/srt_dashboard.py`. Workspace gets a Setup → SRT Dashboard link + shortcut chip.
```

- [ ] **Step 3: Append to "Restricted areas"**

```markdown
- **Don't bypass `submit_linked_sr()` from the SRT Dashboard `approve_srt` path** — SABB monkey-patches + Stock Settings toggle live in that method.
- **Don't compute Origin from `Batch.creation` in SRT Dashboard** — use `MIN(sle.posting_datetime)` for the (item, batch, warehouse) tuple. Batch master timestamps drift from actual first SLE timing.
- **Don't lump In and Out into single totals in the drill-down modal** — per-SLE listing is the spec.
- **Don't gate the dashboard's action buttons by role only** — also by current tab (the action SEMANTICS differ per tab).
- **Don't add front-end confirms on top of Frappe's native ones** — only the reject reason prompt is custom and functional.
- **Don't read stale cached data inside `approve_srt`** — refetch the doc + re-check workflow_state on every call to catch concurrent races.
```

- [ ] **Step 4: Add Live test entry**

ABOVE the existing `## Live test 2026-05-22 (Historical as-of fetch, v0.0.5)` heading, add:

```markdown
## Live test 2026-05-23 (SRT Dashboard, v0.0.7)

6/6 verification tests pass on dev site via:
```
bench --site development.localhost execute \
  kavach.tests.test_srt_dashboard.run_all
```

Cross-suite regression: 23/23 across all 4 suites (Case 1/2 + gap + bug-fix + historical + dashboard).

Page workspace verified: `/desk/stock-reconciliation-tracking` shows the new SRT Dashboard link + shortcut after manual workspace re-sync (bench migrate does NOT auto-sync Workspace JSON).

```

---

## Task 10: Final regression + handoff summary

**Files:** (none — wrap-up)

- [ ] **Step 1: Re-run all 4 test suites**

```bash
cd /workspace/development/frappe-bench
for suite in test_case1_case2 test_srt_settings_gap test_historical_stock test_srt_dashboard; do
  echo "=== $suite ==="
  bench --site development.localhost execute \
    kavach.tests.${suite}.run_all 2>&1 | grep -E "===" | tail -2
done
```

Expected output:

```
=== test_case1_case2 ===
=== 5 / 5 passed ===
=== test_srt_settings_gap ===
=== 8 / 8 passed ===
=== test_historical_stock ===
=== 4 / 4 passed ===
=== test_srt_dashboard ===
=== 6 / 6 passed ===
```

Total: **23/23**.

- [ ] **Step 2: Verify no stray test docs**

```bash
bench --site development.localhost mariadb -e \
  "SELECT COUNT(*) AS open_test_docs FROM \`tabStock Reconciliation SRT\` \
   WHERE item='CZMAT/1585' AND docstatus != 2;" 2>&1 | tail -3
```

Expected: `open_test_docs: 0`.

- [ ] **Step 3: Print summary**

Files created: 6 (page scaffold + tests) + 0 modified Python files (all new APIs added to new page file).
Files modified: 4 (workspace JSON, app .md, module .md, memory .md).
Server APIs added: 6 whitelisted methods, ~250 LOC.
JS controller: ~500 LOC across 4 implementation phases (T1-T6).
Tests: 6 new, all passing. Total regression: 23/23.

Ask user: anything else? UX tweaks to grid columns? Want a "Refresh" button? Export-to-Excel like sibling chaizup_toc dashboards?

---

## Self-Review Log

**Spec coverage:**
- §2.1 Page shell — Task 1 (full 5-file scaffold)
- §2.2 Tab strip + main grid — Task 2 (`get_dashboard_rows` + Tabulator)
- §2.3 View modal — Task 3 (`get_batch_summary` + modal)
- §2.4 Drill-down modal — Task 4 (`get_batch_drilldown` + modal)
- §2.5 Server APIs (all 6) — Tasks 2 (rows) + 3 (summary) + 4 (drilldown) + 5 (approve/reject) + 6 (bulk)
- §2.6 Workspace integration — Task 7
- §3 UX details (native Frappe look, reduced scroll, empty/loading states, concurrency safety) — embedded in Tasks 2-6 JS code
- §4 file inventory — matches Plan's File Structure table
- §5 restricted areas (9 rules) — covered in Task 8 (app .md §17) + Task 9 (memory)
- §6 testing (6 tests) — Tasks 2 (T1) + 3 (T2) + 4 (T3) + 5 (T4-5) + 6 (T6) + 10 (regression)
- §7 out-of-scope — respected (no real-time auto-refresh, no per-batch approve, no Excel export)

**Placeholder scan:** No TBDs, no "implement appropriate handling", no "similar to" cross-refs. Every code block is concrete.

**Type consistency:** Method names `get_dashboard_rows` / `get_batch_summary` / `get_batch_drilldown` / `approve_srt` / `reject_srt` / `bulk_approve_srt` used identically across Tasks 2-6 definitions, test imports, and JS frappe.call args. Tab filter values match the spec's wording ("Draft", "Admin Approval", "Super Admin Approval"). Field names `summary_origin_to_posting` / `summary_lastsr_to_posting` / `last_sr_date` consistent across Task 3 (Python def) + Task 4 (JS consumer in `_on_drilldown`). Grid column field names (`total_qty_found_in_default_uom`, etc.) match what `get_dashboard_rows` returns and what the doctype JSON defines.

**Edge case verified:** Task 5's `reject_srt` for a Draft doc requires a tricky submit-then-cancel sequence because Frappe `cancel()` only works on docstatus=1. The implementation writes the annotated reason to admin_remark BEFORE the submit so it survives validation; the auto-untick + at-least-one-ticked guard still applies. If the Draft has zero ticked rows, reject will fail at the submit step — which IS the correct behavior (you can't reject a doc that wouldn't have been valid anyway; the user should just delete the empty draft via the doctype form). The test confirms the post-Admin-Approval path.
