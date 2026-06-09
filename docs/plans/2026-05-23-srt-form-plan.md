# SRT Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a custom Frappe Page `srt-form` at `/app/srt-form` (and `/app/srt-form?name=<draft>` for edits) that renders a best-in-class HTML/CSS/JS UI for the existing `Stock Reconciliation SRT` DocType. The form is a pure mask — all validation, workflow, and persistence flow through `doc.save()` / `doc.submit()` on the existing DocType, untouched.

**Architecture:** Standard 5-file Frappe Page (matching `srt-dashboard`). Python is 3 thin whitelisted wrappers (~80 LOC) — `load_srt_form` / `save_srt_form` / `submit_srt_form` — that just delegate to `frappe.get_doc("Stock Reconciliation SRT", ...).save()` or `.submit()`. JS is the whole show: responsive two-column header, Tabulator batches grid with search + tick-all + per-row delta status, live totals panel that mirrors `_recompute_totals`, sticky action bar.

**Tech Stack:** Frappe v16 Page framework, Tabulator (already loaded on dev site by chaizup_toc), Python 3.14. Existing module APIs reused: `api.get_item_defaults`, `api.get_uom_conversion`, `api.get_batch_current_state`, `api.get_item_uoms_for_link`.

**Spec:** `apps/kavach/docs/specs/2026-05-23-srt-form-design.md`

**Source-control note:** SRT app is not a git repo (parent `/workspace` repo `.gitignore`s `development/frappe-bench/`). "Commit" steps mean on-disk save checkpoints.

---

## File Structure

| File | Role | Action |
|---|---|---|
| `apps/.../page/srt_form/__init__.py` | Python package marker | Create |
| `apps/.../page/srt_form/srt_form.json` | Page meta + 4 roles | Create |
| `apps/.../page/srt_form/srt_form.py` | 3 whitelisted thin wrappers | Create |
| `apps/.../page/srt_form/srt_form.js` | Page controller (layout, grid, save/submit) | Create |
| `apps/.../page/srt_form/srt_form.html` | Jinja shell — HTML comments only (Jinja-comment gotcha) | Create |
| `apps/.../page/srt_form/srt_form.md` | In-app dev doc | Create |
| `apps/.../page/srt_dashboard/srt_dashboard.js` | Modify — add `+ Create SRT` page action + `Open Full Form` button in View modal | Modify |
| `apps/.../workspace/kavach/kavach.json` | Modify — add SRT Form shortcut | Modify |
| `apps/.../tests/test_srt_form.py` | 4 assertion-based verification tests | Create |
| `apps/kavach/kavach.md` (app root) | New §18 + Sync Block bump to v0.0.8 | Modify |
| `apps/.../kavach/kavach/kavach.md` (module) | Append paragraph | Modify |
| `~/.claude/projects/-workspace/memory/app_kavach.md` | Bump version + restricted areas + live test | Modify |

Full path prefix is `/workspace/development/frappe-bench/apps/kavach/kavach/kavach/`.

---

## Task 1: Page scaffold (Python wrappers + Page meta + HTML shell + minimal JS) + 4 failing tests

**Files:**
- Create: `…/page/srt_form/__init__.py`
- Create: `…/page/srt_form/srt_form.json`
- Create: `…/page/srt_form/srt_form.py`
- Create: `…/page/srt_form/srt_form.html`
- Create: `…/page/srt_form/srt_form.js`
- Create: `…/page/srt_form/srt_form.md`
- Create: `…/tests/test_srt_form.py`

### Why this is one task

Frappe Page reload requires all 5 files together. Splitting would create a half-installed page. The 4 tests verify the Python wrappers — the JS surface is verified later by browser smoke. TDD: write tests first, confirm RED (ImportError), then implement.

- [ ] **Step 1: Create the package marker**

`…/page/srt_form/__init__.py` — empty file.

- [ ] **Step 2: Create the Page JSON**

`…/page/srt_form/srt_form.json`:

```json
{
  "doctype": "Page",
  "name": "srt-form",
  "page_name": "srt-form",
  "title": "SRT Form",
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

- [ ] **Step 3: Create the HTML shell (HTML comments only — Jinja-comment gotcha)**

`…/page/srt_form/srt_form.html`:

```html
<!-- Containers the JS controller hydrates. The Frappe page shell owns the
     chrome (title, breadcrumb, action items). IMPORTANT: HTML comments are
     stripped by Frappe build:scrub_html_template before bundling. Do NOT
     switch to Jinja-style comments — those pass through, and any apostrophe
     inside them breaks the frappe.templates["srt_form"] = '...' string and
     silently nukes the page. See app-root section 17 gotcha. -->
<div class="srt-form-root">
  <div class="srt-form-banner-slot"></div>
  <div class="row">
    <div class="col-md-7 srt-form-context-slot"></div>
    <div class="col-md-5 srt-form-totals-slot"></div>
  </div>
  <div class="srt-form-batches-slot mt-3"></div>
  <div class="srt-form-remarks-slot mt-3"></div>
</div>
```

- [ ] **Step 4: Create the Python wrappers**

`…/page/srt_form/srt_form.py`:

```python
# =============================================================================
# CONTEXT: SRT Form server-side controller.
#
# Three thin whitelisted wrappers. The form is a pure UI mask on top of the
# existing Stock Reconciliation SRT DocType — NO validation is duplicated
# here. All save / submit dispatches through doc.save() / doc.submit() so the
# DocType's validate() chain runs untouched (duplicate-open guard, gap rule,
# Case 1/2 classifier, remark-permission gate, etc.).
#
# MEMORY: app_kavach.md
# SPEC:   docs/specs/2026-05-23-srt-form-design.md
#
# RESTRICTED:
#   - Do NOT re-implement any validation from stock_reconciliation_srt.py.
#     If a new validation is added there, it must reach this form without
#     code change here.
#   - Do NOT allow editing submitted (docstatus=1) docs via save_srt_form —
#     the remark-permission gate + workflow-state-aware fields would reject
#     most writes anyway; throw early here for a clearer message.
#   - Do NOT bypass doc.submit() in submit_srt_form — the workflow
#     transition + on_submit lifecycle (including Case 1 auto-approve
#     routing and ERPNext SR draft creation) must fire normally.
# =============================================================================

import frappe
from frappe import _


@frappe.whitelist()
def load_srt_form(name=None):
    """Return either the full Stock Reconciliation SRT doc shape (edit mode)
    or an empty defaults dict (new mode).

    Edit mode also includes a `batches` list with the existing rows. The
    client uses this on page load to hydrate the form.
    """
    if not name:
        return {
            "is_new": True,
            "company": frappe.defaults.get_user_default("Company") or "",
            "posting_date": frappe.utils.nowdate(),
            "posting_time": frappe.utils.nowtime(),
        }
    doc = frappe.get_doc("Stock Reconciliation SRT", name)
    if doc.docstatus != 0:
        frappe.throw(_(
            "Only Draft SRTs can be edited via this form. "
            "{0} is at workflow state {1} (docstatus {2})."
        ).format(name, doc.workflow_state or "?", doc.docstatus))
    return {
        "is_new": False,
        "name": doc.name,
        "item": doc.item,
        "item_name": doc.item_name,
        "default_warehouse": doc.default_warehouse,
        "company": doc.company,
        "default_uom": doc.default_uom,
        "higher_uom": doc.higher_uom,
        "higher_uom_cf": doc.higher_uom_cf,
        "total_current_stock_in_default_uom": doc.total_current_stock_in_default_uom,
        "total_qty_found_in_default_uom": doc.total_qty_found_in_default_uom,
        "total_current_stock_in_higher_uom": doc.total_current_stock_in_higher_uom,
        "total_qty_found_in_higher_uom": doc.total_qty_found_in_higher_uom,
        "posting_date": str(doc.posting_date),
        "posting_time": str(doc.posting_time),
        "edit_posting": doc.edit_posting,
        "user_remark": doc.user_remark,
        "admin_remark": doc.admin_remark,
        "super_admin_remark": doc.super_admin_remark,
        "workflow_state": doc.workflow_state,
        "batches": [r.as_dict() for r in (doc.batches or [])],
    }


@frappe.whitelist()
def save_srt_form(payload, name=None):
    """Save a SRT through the existing DocType controller. New doc when
    name=None; updates an existing Draft when name is set.

    Wraps frappe.get_doc(...).save() — the full validate() chain runs.
    Returns {name, workflow_state}.
    """
    payload = frappe.parse_json(payload) if isinstance(payload, str) else payload
    if name:
        doc = frappe.get_doc("Stock Reconciliation SRT", name)
        if doc.docstatus != 0:
            frappe.throw(_(
                "Only Draft SRTs can be edited via this form. "
                "Use the workflow actions for {0} (current state: {1})."
            ).format(name, doc.workflow_state or "Submitted"))
        doc.update(payload)
    else:
        payload["doctype"] = "Stock Reconciliation SRT"
        doc = frappe.get_doc(payload)
    doc.save()
    return {"name": doc.name, "workflow_state": doc.workflow_state or "Draft"}


@frappe.whitelist()
def submit_srt_form(name):
    """Submit a Draft SRT through the existing DocType controller.

    Wraps doc.submit() — fires the on_submit lifecycle (workflow
    transition, Case 1 auto-approve routing, ERPNext SR draft creation).
    Returns {name, workflow_state, linked_erpnext_sr}.
    """
    doc = frappe.get_doc("Stock Reconciliation SRT", name)
    if doc.docstatus != 0:
        frappe.throw(_(
            "SRT {0} is not in Draft state (current docstatus: {1})."
        ).format(name, doc.docstatus))
    doc.flags.ignore_permissions = True
    doc.submit()
    return {
        "name": doc.name,
        "workflow_state": doc.workflow_state,
        "linked_erpnext_sr": doc.linked_erpnext_sr,
    }
```

- [ ] **Step 5: Create the minimal JS controller (just renders a placeholder — full UI in T2)**

`…/page/srt_form/srt_form.js`:

```javascript
// =============================================================================
// SRT Form — custom Frappe Page controller.
//
// Task 1 scope: page shell + load API call. Layout, batches grid, save/submit
// wired in Task 2.
//
// MEMORY: app_kavach.md § 18 (post-impl)
// SPEC:   docs/specs/2026-05-23-srt-form-design.md
// =============================================================================

frappe.pages["srt-form"].on_page_load = function (wrapper) {
    // Re-init guard — same pattern as srt-dashboard.
    if (wrapper._srt_form_initialized) return;
    wrapper._srt_form_initialized = true;
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("SRT Form"),
        single_column: true,
    });
    new SRTForm(page, wrapper);
};

class SRTForm {
    constructor(page, wrapper) {
        this.page = page;
        this.$body = $(page.body);
        this.name = frappe.utils.get_query_params().name || null;
        this.state = {};
        this._render_shell();
        this._load();
    }

    _render_shell() {
        const html = frappe.render_template("srt_form", {});
        this.$body.html(html);
        this.$banner   = this.$body.find(".srt-form-banner-slot");
        this.$context  = this.$body.find(".srt-form-context-slot");
        this.$totals   = this.$body.find(".srt-form-totals-slot");
        this.$batches  = this.$body.find(".srt-form-batches-slot");
        this.$remarks  = this.$body.find(".srt-form-remarks-slot");
    }

    _load() {
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_form.srt_form.load_srt_form",
            args: { name: this.name },
            freeze: true,
            freeze_message: __("Loading…"),
        }).then(r => {
            this.state = r.message || {};
            this.page.set_title(this.state.is_new
                ? __("Create Stock Reconciliation SRT")
                : __("Edit SRT {0}", [this.state.name]));
            // T2 will replace this with full UI rendering.
            this.$context.html('<div class="text-muted p-4">' +
                               __("Form UI loads in Task 2 (state loaded: {0})",
                                  [this.state.is_new ? "new" : this.state.name]) +
                               '</div>');
        }).catch(err => {
            this.$banner.html(
                '<div class="alert alert-danger m-3">' +
                frappe.utils.escape_html(err.message || String(err)) +
                '</div>');
        });
    }
}
```

- [ ] **Step 6: Create the in-app dev doc**

`…/page/srt_form/srt_form.md`:

```markdown
# SRT Form — Page

**Path:** `/app/srt-form` (new), `/app/srt-form?name=<draft>` (edit)
**Module:** Stock Reconciliation Tracking
**Spec:** `../../../docs/specs/2026-05-23-srt-form-design.md`

A custom Frappe Page that renders a best-in-class UI mask over the existing
`Stock Reconciliation SRT` DocType. All save / submit dispatches go through
`doc.save()` / `doc.submit()` — zero validation duplicated.

## Files

- `srt_form.json` — Page meta (route, title, 4 role grants)
- `srt_form.py` — 3 whitelisted wrappers: `load_srt_form`, `save_srt_form`,
  `submit_srt_form` (each ≤ 30 LOC; delegates to DocType)
- `srt_form.js` — Page controller (~700 LOC): tab-less layout, Tabulator
  batches grid, live totals, save/submit, error banner
- `srt_form.html` — Minimal Jinja shell (banner + 4 slot containers)
- `srt_form.md` — this doc

## Restricted areas
See app-root §18 for the canonical list. TL;DR:
- Never duplicate validation from `stock_reconciliation_srt.py`
- Never edit submitted (docstatus=1) docs via this form
- Never use Jinja `{# … #}` comments in `srt_form.html` — apostrophe gotcha
  breaks the JS bundle (blank screen)
```

- [ ] **Step 7: Write the 4 failing tests**

Create `…/tests/test_srt_form.py`:

```python
# =============================================================================
# CONTEXT: Runnable verification for the SRT Form page's server-side
# wrappers. Mirrors the convention established in test_case1_case2.py /
# test_srt_settings_gap.py / test_historical_stock.py / test_srt_dashboard.py.
#
# Run with:
#   bench --site development.localhost execute \
#     kavach.tests.test_srt_form.run_all
#
# MEMORY: app_kavach.md § Live test 2026-05-23
# SPEC:   docs/specs/2026-05-23-srt-form-design.md
# =============================================================================

import frappe
from frappe.utils import flt, nowdate, nowtime

from kavach.tests.test_case1_case2 import (
    TEST_ITEM,
    _build_srt,
    _cleanup_open_srt_for_item,
    _pick_warehouse,
)


def _make_draft_srt(item, warehouse):
    """Local copy — see test_srt_dashboard.py for the canonical helper."""
    doc = _build_srt(item, warehouse)
    for r in doc.batches[:1]:
        r.is_counted = 1
        r.qty_found = flt(r.current_stock_in_selected_uom) + 1.0
    doc.posting_date = nowdate()
    doc.insert(ignore_permissions=True)
    return doc


# ── Test 1 ─────────────────────────────────────────────────────────────────
def test_load_new_returns_empty():
    """load_srt_form() with no name returns the new-doc defaults shape."""
    from kavach.stock_reconciliation_tracking.page.srt_form.srt_form import (
        load_srt_form,
    )
    r = load_srt_form()
    assert isinstance(r, dict), f"expected dict, got {type(r)}"
    assert r.get("is_new") is True, f"expected is_new=True, got {r.get('is_new')!r}"
    for k in ("company", "posting_date", "posting_time"):
        assert k in r, f"missing default key {k}"
    print(f"  PASS test_load_new_returns_empty")


# ── Test 2 ─────────────────────────────────────────────────────────────────
def test_load_existing_draft_returns_full_doc():
    """load_srt_form(name) for a Draft returns full doc shape with batches."""
    from kavach.stock_reconciliation_tracking.page.srt_form.srt_form import (
        load_srt_form,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    r = load_srt_form(name=draft.name)
    assert r["is_new"] is False
    assert r["name"] == draft.name
    assert r["item"] == TEST_ITEM
    assert r["default_warehouse"] == warehouse
    assert isinstance(r["batches"], list)
    assert len(r["batches"]) > 0, "expected at least one batch row"
    print(f"  PASS test_load_existing_draft_returns_full_doc ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 3 ─────────────────────────────────────────────────────────────────
def test_save_new_creates_draft():
    """save_srt_form(payload) with no name creates a new Draft and runs
    the DocType validate() chain."""
    from kavach.stock_reconciliation_tracking.page.srt_form.srt_form import (
        save_srt_form,
    )
    from kavach.stock_reconciliation_tracking.api import (
        get_item_defaults,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    defaults = get_item_defaults(item_code=TEST_ITEM, warehouse=warehouse)
    if not defaults["batches"]:
        print("  SKIP test_save_new_creates_draft: no batches on test item")
        return
    # Build minimal payload — one ticked batch with a +1 delta
    b = defaults["batches"][0]
    payload = {
        "item": TEST_ITEM,
        "default_warehouse": warehouse,
        "company": frappe.defaults.get_user_default("Company")
                   or frappe.db.get_value("Company", {}, "name"),
        "item_name": defaults["item_name"],
        "default_uom": defaults["default_uom"],
        "higher_uom": defaults["higher_uom"],
        "higher_uom_cf": defaults["higher_uom_cf"],
        "posting_date": nowdate(),
        "posting_time": nowtime(),
        "batches": [{
            "batch_no":                       b["batch_no"],
            "item_code":                      TEST_ITEM,
            "warehouse":                      warehouse,
            "stock_uom":                      b["stock_uom"],
            "select_uom":                     b["select_uom"],
            "conversion_factor":              b["conversion_factor"],
            "current_stock_in_stock_uom":     b["current_stock_in_stock_uom"],
            "current_stock_in_selected_uom":  b["current_stock_in_selected_uom"],
            "valuation_rate":                 b["valuation_rate"],
            "item_name_selected":             b["item_name_selected"],
            "is_counted":                     1,
            "qty_found":                      flt(b["current_stock_in_selected_uom"]) + 1.0,
        }],
    }
    r = save_srt_form(payload=payload)
    assert r["name"], "expected returned name"
    assert r["workflow_state"] == "Draft"
    # Sanity: the saved doc exists in DB
    doc = frappe.get_doc("Stock Reconciliation SRT", r["name"])
    assert doc.item == TEST_ITEM
    assert len(doc.batches) == 1
    assert doc.batches[0].is_counted == 1
    print(f"  PASS test_save_new_creates_draft ({r['name']})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Test 4 ─────────────────────────────────────────────────────────────────
def test_save_existing_submitted_throws():
    """save_srt_form on a submitted (docstatus=1) doc must throw with
    'Only Draft SRTs can be edited via this form'."""
    from kavach.stock_reconciliation_tracking.page.srt_form.srt_form import (
        save_srt_form,
    )
    warehouse = _pick_warehouse()
    _cleanup_open_srt_for_item(TEST_ITEM)
    draft = _make_draft_srt(TEST_ITEM, warehouse)
    draft.flags.ignore_permissions = True
    draft.submit()
    frappe.db.commit()
    threw = False
    try:
        save_srt_form(payload={"user_remark": "edit attempt"}, name=draft.name)
    except frappe.ValidationError as e:
        if "Only Draft SRTs" in str(e):
            threw = True
    assert threw, "expected ValidationError 'Only Draft SRTs can be edited'"
    print(f"  PASS test_save_existing_submitted_throws ({draft.name})")
    _cleanup_open_srt_for_item(TEST_ITEM)


# ── Runner ─────────────────────────────────────────────────────────────────
def run_all():
    tests = [
        test_load_new_returns_empty,
        test_load_existing_draft_returns_full_doc,
        test_save_new_creates_draft,
        test_save_existing_submitted_throws,
    ]
    print(f"\n=== SRT Form verification ({len(tests)} tests) ===")
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

- [ ] **Step 8: Run — confirm RED (ImportError on missing module)**

```bash
bench --site development.localhost execute \
  kavach.tests.test_srt_form.run_all
```

Expected: 4 FAIL with `ImportError: cannot import name 'load_srt_form' / 'save_srt_form'` — that's the RED state. (If the Python wrappers WERE all in place from Step 4, expect 4 PASS straight away — also acceptable since the wrappers are trivial.)

- [ ] **Step 9: Reload-doc + clear-cache + GREEN test run**

```bash
cd /workspace/development/frappe-bench
bench --site development.localhost reload-doc "Stock Reconciliation Tracking" page srt_form
bench --site development.localhost clear-cache
bench --site development.localhost execute \
  kavach.tests.test_srt_form.run_all
```

Expected: `=== 4 / 4 passed ===`.

- [ ] **Step 10: Verify the Page row in DB**

```bash
bench --site development.localhost mariadb -e \
  "SELECT name, title, module FROM \`tabPage\` WHERE name='srt-form';"
```

Expected: 1 row showing `srt-form | SRT Form | Stock Reconciliation Tracking`.

- [ ] **Step 11: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach/kavach/page/srt_form/
```

---

## Task 2: Full form UI in JS (layout, batches grid, save/submit, live totals)

**Files:**
- Modify: `…/page/srt_form/srt_form.js` — REPLACE the entire file with the full controller

### Why a single large task

The form's JS is one cohesive controller. Splitting into "context panel", "totals panel", "batches grid" would force the implementer to invent intermediate stubs between subtasks. The whole controller is ~700 LOC but every piece references the same `this.state` object — easier to write it in one pass. Reviewer can audit at the end.

- [ ] **Step 1: Replace the JS file with the full controller**

REPLACE `…/page/srt_form/srt_form.js` with this complete file (delete old contents):

```javascript
// =============================================================================
// SRT Form — custom Frappe Page controller.
//
// A pure UI mask on top of Stock Reconciliation SRT DocType. All saves go
// through doc.save() server-side (see srt_form.py). Validation, workflow,
// permissions, lifecycle — all unchanged from the DocType.
//
// LAYOUT (≥1200px two-column; below = single):
//   [Header strip — sticky]
//   [Context panel — item/warehouse/posting]   [Totals panel — current/found/delta]
//   [Batches grid — Tabulator with search]
//   [Remarks panel — user/admin/super_admin remarks]
//
// MEMORY: app_kavach.md § 18
// SPEC:   docs/specs/2026-05-23-srt-form-design.md
// RESTRICT: see app-root §18; key rules:
//   - Never duplicate validation client-side
//   - Never use Jinja {# … #} comments in srt_form.html (blank-screen gotcha)
//   - Mirror _recompute_totals exactly — same fields, same formula
// =============================================================================

frappe.pages["srt-form"].on_page_load = function (wrapper) {
    if (wrapper._srt_form_initialized) return;
    wrapper._srt_form_initialized = true;
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("SRT Form"),
        single_column: true,
    });
    new SRTForm(page, wrapper);
};

class SRTForm {
    constructor(page, wrapper) {
        this.page = page;
        this.$body = $(page.body);
        this.name = frappe.utils.get_query_params().name || null;
        this.state = {};
        this._render_shell();
        this._load();
    }

    // ── Shell ──────────────────────────────────────────────────────────
    _render_shell() {
        const html = frappe.render_template("srt_form", {});
        this.$body.html(html);
        this.$banner   = this.$body.find(".srt-form-banner-slot");
        this.$context  = this.$body.find(".srt-form-context-slot");
        this.$totals   = this.$body.find(".srt-form-totals-slot");
        this.$batches  = this.$body.find(".srt-form-batches-slot");
        this.$remarks  = this.$body.find(".srt-form-remarks-slot");
    }

    _load() {
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_form.srt_form.load_srt_form",
            args: { name: this.name },
            freeze: true,
            freeze_message: __("Loading…"),
        }).then(r => {
            this.state = Object.assign({ batches: [] }, r.message || {});
            this._hydrate();
        }).catch(err => this._show_banner("danger", err.message || String(err)));
    }

    _hydrate() {
        this.page.set_title(this.state.is_new
            ? __("Create Stock Reconciliation SRT")
            : __("Edit SRT {0}", [this.state.name]));
        this._render_header_actions();
        this._render_context();
        this._render_totals();
        this._render_batches();
        this._render_remarks();
        // If editing an existing draft with auto-populated batches, totals are
        // already in state. Otherwise, defer to first item/warehouse pick.
    }

    _render_header_actions() {
        this.page.clear_primary_action();
        this.page.clear_secondary_action();
        this.page.set_primary_action(__("Save Draft"), () => this._save());
        this.page.set_secondary_action(__("Cancel"), () => {
            frappe.set_route("srt-dashboard");
        });
        if (this.state.name && this.state.workflow_state === "Draft") {
            this.page.add_menu_item(__("Submit for Approval"), () => this._submit());
        }
    }

    // ── Context panel (item / warehouse / posting) ────────────────────
    _render_context() {
        const html = `
            <div class="card p-3">
              <h5 class="mb-3">${__("Item & Location")}</h5>
              <div class="form-group">
                <label>${__("Item")} <span class="text-danger">*</span></label>
                <div class="srt-item-field"></div>
                <div class="srt-item-preview text-muted small mt-1"></div>
              </div>
              <div class="form-group">
                <label>${__("Warehouse")} <span class="text-danger">*</span></label>
                <div class="srt-warehouse-field"></div>
              </div>
              <div class="form-group">
                <label>${__("Company")}</label>
                <div class="srt-company-field"></div>
              </div>
              <div class="form-row">
                <div class="form-group col-md-6">
                  <label>${__("Posting Date")}</label>
                  <div class="srt-posting-date-field"></div>
                </div>
                <div class="form-group col-md-6">
                  <label>${__("Posting Time")}</label>
                  <div class="srt-posting-time-field"></div>
                </div>
              </div>
              <div class="form-check">
                <input type="checkbox" class="form-check-input srt-edit-posting"
                       id="srt-edit-posting-${frappe.utils.get_random(6)}">
                <label class="form-check-label">${__("Edit posting date/time")}</label>
              </div>
            </div>`;
        this.$context.html(html);
        // Hydrate the field widgets with frappe.ui.form.make_control
        this._mk_link("item", "Item", this.$context.find(".srt-item-field")[0], v => {
            this.state.item = v;
            this._refresh_item_preview();
            this._maybe_load_defaults();
        });
        this._mk_link("default_warehouse", "Warehouse", this.$context.find(".srt-warehouse-field")[0], v => {
            this.state.default_warehouse = v;
            this._maybe_load_defaults();
        });
        this._mk_link("company", "Company", this.$context.find(".srt-company-field")[0], v => {
            this.state.company = v;
        });
        this._mk_date("posting_date", this.$context.find(".srt-posting-date-field")[0], v => {
            this.state.posting_date = v;
            this._maybe_load_defaults();
        });
        this._mk_time("posting_time", this.$context.find(".srt-posting-time-field")[0], v => {
            this.state.posting_time = v;
            this._maybe_load_defaults();
        });
        this.$context.find(".srt-edit-posting").prop("checked", !!this.state.edit_posting)
            .on("change", e => {
                this.state.edit_posting = e.target.checked ? 1 : 0;
                this._refresh_posting_read_only();
            });
        this._refresh_item_preview();
        this._refresh_posting_read_only();
    }

    _mk_link(fieldname, options, parent, on_change) {
        const ctrl = frappe.ui.form.make_control({
            df: { fieldtype: "Link", fieldname, options, placeholder: __(options) },
            parent: parent, render_input: true,
        });
        if (this.state[fieldname]) ctrl.set_value(this.state[fieldname]);
        ctrl.df.onchange = () => on_change(ctrl.get_value());
        this[`_ctrl_${fieldname}`] = ctrl;
    }

    _mk_date(fieldname, parent, on_change) {
        const ctrl = frappe.ui.form.make_control({
            df: { fieldtype: "Date", fieldname }, parent: parent, render_input: true,
        });
        if (this.state[fieldname]) ctrl.set_value(this.state[fieldname]);
        ctrl.df.onchange = () => on_change(ctrl.get_value());
        this[`_ctrl_${fieldname}`] = ctrl;
    }

    _mk_time(fieldname, parent, on_change) {
        const ctrl = frappe.ui.form.make_control({
            df: { fieldtype: "Time", fieldname }, parent: parent, render_input: true,
        });
        if (this.state[fieldname]) ctrl.set_value(this.state[fieldname]);
        ctrl.df.onchange = () => on_change(ctrl.get_value());
        this[`_ctrl_${fieldname}`] = ctrl;
    }

    _refresh_item_preview() {
        const $p = this.$context.find(".srt-item-preview");
        if (this.state.item_name && this.state.item) {
            $p.html(`<span class="text-success">↳ ${frappe.utils.escape_html(this.state.item_name)}</span>`);
        } else {
            $p.html("");
        }
    }

    _refresh_posting_read_only() {
        const ro = !this.state.edit_posting;
        if (this._ctrl_posting_date) this._ctrl_posting_date.df.read_only = ro,
                                       this._ctrl_posting_date.refresh();
        if (this._ctrl_posting_time) this._ctrl_posting_time.df.read_only = ro,
                                       this._ctrl_posting_time.refresh();
    }

    _maybe_load_defaults() {
        if (!(this.state.item && this.state.default_warehouse)) return;
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "api.get_item_defaults",
            args: {
                item_code:    this.state.item,
                warehouse:    this.state.default_warehouse,
                posting_date: this.state.posting_date || null,
                posting_time: this.state.posting_time || null,
            },
            freeze: true,
            freeze_message: __("Loading batches…"),
        }).then(r => {
            const d = r.message || {};
            this.state.item_name      = d.item_name;
            this.state.default_uom    = d.default_uom;
            this.state.higher_uom     = d.higher_uom;
            this.state.higher_uom_cf  = d.higher_uom_cf;
            this.state.total_current_stock_in_default_uom = d.total_current_stock_in_default_uom;
            this.state.total_current_stock_in_higher_uom  = d.total_current_stock_in_higher_uom;
            // Initial Found totals = current (no rows ticked yet)
            this.state.total_qty_found_in_default_uom = d.total_current_stock_in_default_uom;
            this.state.total_qty_found_in_higher_uom  = d.total_current_stock_in_higher_uom;
            this.state.batches = (d.batches || []).map(b =>
                Object.assign({ is_counted: 0, qty_found: 0 }, b));
            this._refresh_item_preview();
            this._render_totals();
            this._render_batches();
        });
    }

    // ── Totals panel ──────────────────────────────────────────────────
    _render_totals() {
        const t = this._compute_totals();
        const fmt = v => frappe.format(v, { fieldtype: "Float" });
        const delta_cls = Math.abs(t.delta) < 0.001 ? "text-muted"
                         : (t.delta > 0 ? "text-success" : "text-danger");
        const delta_label = Math.abs(t.delta) < 0.001 ? __("matched")
                          : (t.delta > 0 ? __("over") : __("short"));
        this.$totals.html(`
            <div class="card p-3">
              <h5 class="mb-3">${__("Live Totals")}</h5>
              <div class="srt-totals-row mb-3">
                <div class="text-muted small">${__("Current Stock")}</div>
                <div class="text-bold">${fmt(t.current)} ${frappe.utils.escape_html(this.state.default_uom || "")}</div>
                <div class="text-muted small">${fmt(t.higher_current)} ${frappe.utils.escape_html(this.state.higher_uom || "")}</div>
              </div>
              <div class="srt-totals-row mb-3">
                <div class="text-muted small">${__("Stock Found")}</div>
                <div class="text-bold">${fmt(t.found)} ${frappe.utils.escape_html(this.state.default_uom || "")}</div>
                <div class="text-muted small">${fmt(t.higher_found)} ${frappe.utils.escape_html(this.state.higher_uom || "")}</div>
              </div>
              <div class="srt-totals-row">
                <div class="text-muted small">${__("Delta")}</div>
                <div class="text-bold ${delta_cls}">
                  ${t.delta >= 0 ? "+" : ""}${fmt(t.delta)} ${frappe.utils.escape_html(this.state.default_uom || "")}
                  <span class="small ml-2">(${delta_label})</span>
                </div>
              </div>
            </div>`);
    }

    _compute_totals() {
        // Mirror of stock_reconciliation_srt.py:_recompute_totals.
        let total_current = 0, total_found = 0;
        for (const row of (this.state.batches || [])) {
            const cur = Number(row.current_stock_in_stock_uom) || 0;
            total_current += cur;
            if (row.is_counted) {
                const cf = this._resolve_cf(row);
                total_found += (Number(row.qty_found) || 0) * cf;
            } else {
                total_found += cur;
            }
        }
        const hcf = Number(this.state.higher_uom_cf) || 1;
        return {
            current:        total_current,
            found:          total_found,
            delta:          total_found - total_current,
            higher_current: total_current / hcf,
            higher_found:   total_found   / hcf,
        };
    }

    _resolve_cf(row) {
        // Mirror of _resolve_row_cf — see stock_reconciliation_srt.js for
        // the rationale (grid can drop conversion_factor on cell re-render).
        let cf = Number(row.conversion_factor);
        if (cf && Number.isFinite(cf) && cf > 0) return cf;
        const stock_qty    = Number(row.current_stock_in_stock_uom);
        const selected_qty = Number(row.current_stock_in_selected_uom);
        if (stock_qty > 0 && selected_qty > 0) {
            cf = stock_qty / selected_qty;
            if (Number.isFinite(cf) && cf > 0) return cf;
        }
        if (row.select_uom && row.select_uom === this.state.higher_uom) {
            cf = Number(this.state.higher_uom_cf);
            if (Number.isFinite(cf) && cf > 0) return cf;
        }
        return 1.0;
    }

    // ── Batches grid ──────────────────────────────────────────────────
    _render_batches() {
        if (!(this.state.batches && this.state.batches.length)) {
            this.$batches.html(`
                <div class="card p-3">
                  <h5 class="mb-3">${__("Batches")}</h5>
                  <div class="text-muted text-center p-4">
                    ${__("Pick item & warehouse to load batches.")}
                  </div>
                </div>`);
            return;
        }
        this.$batches.html(`
            <div class="card p-3">
              <div class="d-flex align-items-center mb-3">
                <h5 class="mb-0 mr-3">${__("Batches")}</h5>
                <input type="text" class="form-control srt-batches-search"
                       placeholder="${__("Search batch…")}" style="max-width:260px;">
                <button class="btn btn-xs btn-default ml-2 srt-tick-all">${__("Tick all")}</button>
                <button class="btn btn-xs btn-default ml-1 srt-untick-all">${__("Untick all")}</button>
                <span class="text-muted small ml-auto srt-batches-count"></span>
              </div>
              <div class="srt-batches-grid"></div>
            </div>`);
        const $grid = this.$batches.find(".srt-batches-grid");
        const that = this;
        const fmt_status = (cell) => {
            const r = cell.getRow().getData();
            if (!r.is_counted) return '<span class="text-muted">—</span>';
            const cf = that._resolve_cf(r);
            const found_in_stock = (Number(r.qty_found) || 0) * cf;
            const cur_in_stock   = Number(r.current_stock_in_stock_uom) || 0;
            const delta = found_in_stock - cur_in_stock;
            if (Math.abs(delta) < 0.001) return '<span class="text-muted">' + __("Matched") + '</span>';
            const sign = delta >= 0 ? "+" : "";
            const cls  = delta >= 0 ? "text-success" : "text-danger";
            const delta_sel = (Number(r.qty_found) || 0)
                              - (Number(r.current_stock_in_selected_uom) || 0);
            const sign_sel  = delta_sel >= 0 ? "+" : "";
            return `<span class="${cls}">Δ ${sign_sel}${frappe.format(delta_sel, {fieldtype:"Float"})} ${frappe.utils.escape_html(r.select_uom || "")}</span>`;
        };
        const on_edit = (cell) => {
            const r = cell.getRow().getData();
            const f = cell.getField();
            if (f === "is_counted") r.is_counted = cell.getValue() ? 1 : 0;
            if (f === "qty_found")  r.qty_found  = Number(cell.getValue()) || 0;
            // select_uom change requires CF refetch
            if (f === "select_uom") {
                frappe.call({
                    method: "kavach.stock_reconciliation_tracking." +
                            "api.get_uom_conversion",
                    args: { item_code: that.state.item, uom: r.select_uom },
                }).then(resp => {
                    const cf = Number(resp.message) || 1;
                    r.conversion_factor = cf;
                    const stock_qty = Number(r.current_stock_in_stock_uom) || 0;
                    r.current_stock_in_selected_uom = cf > 0 ? stock_qty / cf : stock_qty;
                    that._tab.updateData([r]);
                    that._render_totals();
                });
                return;
            }
            that._tab.updateData([r]);
            that._render_totals();
        };
        this._tab = new Tabulator($grid[0], {
            data: this.state.batches,
            layout: "fitDataStretch",
            columns: [
                { title: "", field: "is_counted",
                  formatter: "tickCross", editor: true, width: 50,
                  hozAlign: "center", headerSort: false,
                  cellEdited: on_edit },
                { title: __("Batch"), field: "batch_no", widthGrow: 2 },
                { title: __("Qty Found"), field: "qty_found",
                  editor: "number", hozAlign: "right", cellEdited: on_edit },
                { title: __("UOM"), field: "select_uom",
                  editor: "list",
                  editorParams: () => ({ valuesLookup: () =>
                      that._uom_options(), autocomplete: true }),
                  cellEdited: on_edit },
                { title: __("Current (UOM)"), field: "current_stock_in_selected_uom",
                  formatter: "money", formatterParams: { precision: 3 },
                  hozAlign: "right" },
                { title: __("Stock UOM"), field: "stock_uom" },
                { title: __("Current (Stock)"), field: "current_stock_in_stock_uom",
                  formatter: "money", formatterParams: { precision: 3 },
                  hozAlign: "right" },
                { title: __("Status"), formatter: fmt_status, headerSort: false },
            ],
        });
        this.$batches.find(".srt-batches-search").on("input", e => {
            const q = e.target.value.trim();
            if (q) this._tab.setFilter("batch_no", "like", q);
            else   this._tab.clearFilter();
        });
        this.$batches.find(".srt-tick-all").on("click", () => {
            this.state.batches.forEach(r => r.is_counted = 1);
            this._tab.replaceData(this.state.batches);
            this._render_totals();
        });
        this.$batches.find(".srt-untick-all").on("click", () => {
            this.state.batches.forEach(r => r.is_counted = 0);
            this._tab.replaceData(this.state.batches);
            this._render_totals();
        });
        this.$batches.find(".srt-batches-count").text(
            `${this.state.batches.length} ${__("batches")}`);
    }

    _uom_options() {
        return new Promise(resolve => {
            frappe.call({
                method: "kavach.stock_reconciliation_tracking." +
                        "api.get_item_uoms",
                args: { item_code: this.state.item },
            }).then(r => resolve(r.message || []));
        });
    }

    // ── Remarks panel ─────────────────────────────────────────────────
    _render_remarks() {
        const ro_admin       = this.state.workflow_state !== "Draft" && !this.state.is_new;
        const ro_super_admin = this.state.workflow_state !== "Admin Approval";
        const tag = (txt, cls) => `<span class="badge badge-${cls} ml-2">${txt}</span>`;
        this.$remarks.html(`
            <div class="card p-3">
              <h5 class="mb-3">${__("Remarks")}</h5>
              <div class="form-group">
                <label>${__("User Remark")} ${tag(__("owner @ Draft"), "secondary")}</label>
                <textarea class="form-control srt-user-remark" rows="2">${frappe.utils.escape_html(this.state.user_remark || "")}</textarea>
              </div>
              <div class="form-group">
                <label>${__("Admin Remark")} ${tag(__("Srt Admin @ Draft"), "info")}</label>
                <textarea class="form-control srt-admin-remark" rows="2" ${ro_admin ? "readonly" : ""}>${frappe.utils.escape_html(this.state.admin_remark || "")}</textarea>
              </div>
              <div class="form-group">
                <label>${__("Super Admin Remark")} ${tag(__("Srt Super Admin @ Admin Approval"), "warning")}</label>
                <textarea class="form-control srt-super-admin-remark" rows="2" ${ro_super_admin ? "readonly" : ""}>${frappe.utils.escape_html(this.state.super_admin_remark || "")}</textarea>
              </div>
            </div>`);
        this.$remarks.find(".srt-user-remark").on("input", e => this.state.user_remark = e.target.value);
        this.$remarks.find(".srt-admin-remark").on("input", e => this.state.admin_remark = e.target.value);
        this.$remarks.find(".srt-super-admin-remark").on("input", e => this.state.super_admin_remark = e.target.value);
    }

    // ── Save / Submit ─────────────────────────────────────────────────
    _build_payload() {
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
            batches: (this.state.batches || []).map(b => ({
                batch_no:                       b.batch_no,
                item_code:                      this.state.item,
                warehouse:                      this.state.default_warehouse,
                stock_uom:                      b.stock_uom,
                select_uom:                     b.select_uom,
                conversion_factor:              b.conversion_factor,
                current_stock_in_stock_uom:     b.current_stock_in_stock_uom,
                current_stock_in_selected_uom:  b.current_stock_in_selected_uom,
                valuation_rate:                 b.valuation_rate,
                item_name_selected:             b.item_name_selected,
                is_counted:                     b.is_counted ? 1 : 0,
                qty_found:                      Number(b.qty_found) || 0,
            })),
        };
    }

    _save() {
        this._clear_banner();
        frappe.call({
            method: "kavach.stock_reconciliation_tracking." +
                    "page.srt_form.srt_form.save_srt_form",
            args: { payload: this._build_payload(), name: this.name || null },
            freeze: true,
            freeze_message: __("Saving…"),
        }).then(r => {
            const m = r.message || {};
            frappe.show_alert({
                message: __("Saved: {0}", [m.name]), indicator: "green",
            });
            // Switch to edit mode if we just created a new doc
            if (!this.name && m.name) {
                this.name = m.name;
                frappe.set_route("srt-form", { name: m.name });
            } else {
                this._load();
            }
        }).catch(err => this._show_banner("danger", err.message || String(err)));
    }

    _submit() {
        if (!this.name) {
            this._show_banner("warning", __("Save the draft first, then submit."));
            return;
        }
        frappe.confirm(__("Submit SRT {0} for approval?", [this.name]), () => {
            this._clear_banner();
            frappe.call({
                method: "kavach.stock_reconciliation_tracking." +
                        "page.srt_form.srt_form.submit_srt_form",
                args: { name: this.name },
                freeze: true,
                freeze_message: __("Submitting…"),
            }).then(r => {
                const m = r.message || {};
                frappe.show_alert({
                    message: __("Submitted: {0} → {1}",
                                [m.name, m.workflow_state || "?"]),
                    indicator: "green",
                });
                frappe.set_route("srt-dashboard");
            }).catch(err => this._show_banner("danger", err.message || String(err)));
        });
    }

    _show_banner(level, msg) {
        this.$banner.html(
            `<div class="alert alert-${level} m-3 d-flex">
               <div class="flex-grow-1">${frappe.utils.escape_html(msg)}</div>
               <button class="close srt-banner-dismiss" aria-label="${__("Close")}">×</button>
             </div>`);
        this.$banner.find(".srt-banner-dismiss").on("click", () => this._clear_banner());
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    _clear_banner() { this.$banner.empty(); }
}
```

- [ ] **Step 2: Validate JS syntax**

```bash
node -c apps/kavach/kavach/kavach/page/srt_form/srt_form.js
echo "exit: $?"
```

Expected: `exit: 0`.

- [ ] **Step 3: Validate the Frappe-bundled JS has no apostrophe escape issue**

```bash
bench --site development.localhost console <<'PYEOF' 2>&1 | tail -8
import frappe
frappe.set_user("Administrator")
page = frappe.get_doc("Page", "srt-form")
page.load_assets()
with open("/tmp/srt_form_bundle.js", "w") as f:
    f.write(page.script)
print(f"Wrote {len(page.script)} chars")
PYEOF
node -c /tmp/srt_form_bundle.js && echo "BUNDLE PARSES CLEAN"
```

Expected: `BUNDLE PARSES CLEAN`. If the HTML template's comment leaked a Jinja-style `{# #}` with an apostrophe, this would fail — fix by re-checking Step 3 of Task 1.

- [ ] **Step 4: Clear cache**

```bash
bench --site development.localhost clear-cache
```

- [ ] **Step 5: On-disk checkpoint**

```bash
wc -l apps/kavach/kavach/kavach/page/srt_form/srt_form.js
```

Expected: ~500-700 lines.

---

## Task 3: Dashboard integration — `+ Create SRT` button + `Edit Full Form` button in View modal

**Files:**
- Modify: `…/page/srt_dashboard/srt_dashboard.js`

- [ ] **Step 1: Add `+ Create SRT` page action**

Find the existing `_render_header_actions` method in `srt_dashboard.js`. Find:

```javascript
    _render_header_actions() {
        // Bulk Approve — page primary action. Empty selection → hint alert.
        this.page.set_primary_action(__("Bulk Approve"), () => {
```

INSERT IMMEDIATELY BEFORE the `this.page.set_primary_action(...)` line:

```javascript
        // Secondary action: jump to the SRT Form for new-doc creation
        this.page.add_menu_item(__("+ Create SRT (Form)"), () => {
            frappe.set_route("srt-form");
        });
```

- [ ] **Step 2: Add `Edit Full Form` button in the View modal**

Find the `_render_view_modal` method. Find:

```javascript
        const labels = {
            "Draft":                 { approve: __("Approve"), reject: __("Reject") },
            "Admin Approval":        { approve: __("Approve"), reject: __("Reject") },
            "Super Admin Approval":  { approve: __("Close"),   reject: __("Reject") },
        };
```

INSERT IMMEDIATELY BEFORE that line:

```javascript
        // For Draft docs, expose an "Edit Full Form" deep-link to the
        // SRT Form — gives the operator a richer editing surface than
        // this view-only modal.
        if (this.current_tab === "Draft") {
            dlg.add_custom_action(__("Edit Full Form"), () => {
                dlg.hide();
                frappe.set_route("srt-form", { name: row_data.name });
            });
        }
```

- [ ] **Step 3: Clear cache + JS syntax check**

```bash
node -c apps/kavach/kavach/kavach/page/srt_dashboard/srt_dashboard.js
bench --site development.localhost clear-cache
```

---

## Task 4: Workspace integration (SRT Form shortcut)

**Files:**
- Modify: `…/workspace/kavach/kavach.json`

- [ ] **Step 1: Append the SRT Form shortcut**

Find:

```json
  {
   "doc_view": "",
   "label": "SRT Dashboard",
   "link_to": "srt-dashboard",
   "type": "Page"
  }
 ],
```

Replace with:

```json
  {
   "doc_view": "",
   "label": "SRT Dashboard",
   "link_to": "srt-dashboard",
   "type": "Page"
  },
  {
   "doc_view": "",
   "label": "SRT Form",
   "link_to": "srt-form",
   "type": "Page"
  }
 ],
```

- [ ] **Step 2: Append the SRT Form link under the Setup card-break**

Find (in the `links` array, after the SRT Dashboard link):

```json
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

Replace with:

```json
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "SRT Dashboard",
   "link_count": 0,
   "link_to": "srt-dashboard",
   "link_type": "Page",
   "onboard": 0,
   "type": "Link"
  },
  {
   "hidden": 0,
   "is_query_report": 0,
   "label": "SRT Form",
   "link_count": 0,
   "link_to": "srt-form",
   "link_type": "Page",
   "onboard": 0,
   "type": "Link"
  }
 ],
```

- [ ] **Step 3: Manual workspace re-sync (per documented gotcha)**

```bash
bench --site development.localhost console <<'PYEOF' 2>&1 | tail -8
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

Expected: `Workspace updated: 6 links, 4 shortcuts`.

- [ ] **Step 4: Verify via SQL**

```bash
bench --site development.localhost mariadb -e \
  "SELECT label, link_to, type FROM \`tabWorkspace Shortcut\` \
   WHERE parent='Stock Reconciliation Tracking' ORDER BY idx;" 2>&1 | tail -10
```

Expected: 4 rows ending with `SRT Form | srt-form | Page`.

---

## Task 5: Update app + module .md docs

**Files:**
- Modify: `apps/kavach/kavach.md`
- Modify: `apps/.../kavach/kavach/kavach.md`

- [ ] **Step 1: Add §18 to app-root .md**

Find `## 12. Sync Block — 2026-05-23 (v0.0.7)` heading. Insert IMMEDIATELY BEFORE:

```markdown
---

## 18. SRT Form — Best-in-class Front-End Mask (2026-05-23 v0.0.8)

### Spec
`docs/specs/2026-05-23-srt-form-design.md`

### What was added

A custom Frappe Page at `/app/srt-form` (and `/app/srt-form?name=<draft>` for edits) that renders a richer HTML/CSS/JS UI for the existing `Stock Reconciliation SRT` DocType. Pure UI mask — all save / submit dispatches through `doc.save()` / `doc.submit()` on the existing DocType, untouched.

### Layout

Two-column at ≥1200px (collapses to single column below):

- Top sticky action bar — Save Draft, Cancel, Submit for Approval (post-save)
- Left context panel — Item / Warehouse / Company / Posting date+time / Edit posting toggle
- Right live totals panel — Current Stock, Stock Found, Δ Delta (with semantic color)
- Full-width batches grid — Tabulator with search box, tick-all/untick-all, per-row Status column showing live delta in selected UOM
- Full-width remarks panel — User / Admin / Super Admin remarks each with a small "role @ state" hint chip

### Server APIs (`page/srt_form/srt_form.py`)

- `load_srt_form(name=None)` — Returns `{is_new: True, …defaults}` for new docs OR the full doc shape for edits. Throws on submitted (docstatus=1) docs.
- `save_srt_form(payload, name=None)` — Thin wrapper. New: `frappe.get_doc(payload).save()`. Edit: `frappe.get_doc(...).update(payload).save()`. Throws if doc is not in Draft.
- `submit_srt_form(name)` — Thin wrapper over `doc.submit()`. Runs the on_submit lifecycle, workflow transition, Case 1 auto-approve routing, ERPNext SR draft creation.

All approve / reject from the dashboard remain unchanged; this form does NOT introduce a parallel approval path.

### Dashboard integration

- Page menu item `+ Create SRT (Form)` in the dashboard's secondary actions
- Draft-tab View modal gets an `Edit Full Form` button (deep-link to `/app/srt-form?name=<draft>`)
- Workspace gets a new `SRT Form` shortcut + a link under the existing Setup card-break

### Restricted areas (additional, 2026-05-23 v0.0.8)

- Don't duplicate any validation from `stock_reconciliation_srt.py` in the form's JS or Python.
- Don't allow editing submitted (docstatus=1) docs via this form — both `load_srt_form` and `save_srt_form` early-throw.
- Don't bypass `doc.submit()` — Case 1 auto-approve routing and ERPNext SR draft creation must fire normally.
- Don't compute the Delta in the totals panel using a different formula than `_recompute_totals`. The JS mirror MUST stay in sync. If the Python formula changes, update the JS.
- Don't add a CSS file — use Frappe utility classes only.
- Don't use Jinja `{# … #}` comments in `srt_form.html` — Frappe doesn't strip them; apostrophe inside breaks the JS bundle (blank screen, app-root §17 gotcha).
- Don't write to `admin_remark` / `super_admin_remark` for a non-privileged user — the server's `_enforce_remark_field_permissions` will throw. UI also gates these fields read-only by current workflow state.

### Verification

`kavach/tests/test_srt_form.py` — 4 tests:
- `test_load_new_returns_empty`
- `test_load_existing_draft_returns_full_doc`
- `test_save_new_creates_draft`
- `test_save_existing_submitted_throws`

Live result 2026-05-23: 4 / 4 passed. Cross-suite regression: 27 / 27 across all 5 suites.

---
```

- [ ] **Step 2: Bump the Sync Block heading + add a v0.0.8 update block**

Change `## 12. Sync Block — 2026-05-23 (v0.0.7)` to `## 12. Sync Block — 2026-05-23 (v0.0.8)`.

Find the existing `LATEST UPDATE 2026-05-23 (v0.0.7)` line. INSERT ABOVE it:

```
LATEST UPDATE 2026-05-23 (v0.0.8)
            + Custom Frappe Page: SRT Form (/app/srt-form)
                - Best-in-class front-end mask over the existing
                  Stock Reconciliation SRT DocType
                - Two-column responsive layout: Item/Warehouse/Posting
                  on left, live totals (Current/Found/Δ Delta) on right
                - Full-width batches grid: Tabulator + search box +
                  tick-all/untick-all + per-row Status column with live
                  delta in selected UOM
                - Sticky action bar at top (Save Draft / Submit for Approval)
                - Pure UI layer — all save / submit dispatch through
                  doc.save() / doc.submit() — zero validation duplicated
            + 3 thin server wrappers in page/srt_form/srt_form.py:
                load_srt_form, save_srt_form, submit_srt_form
            + Dashboard integration:
                - Page menu item "+ Create SRT (Form)"
                - Draft-tab View modal gains "Edit Full Form" button
                - Workspace gets SRT Form shortcut + Setup link
            + Verification: tests/test_srt_form.py (4 tests)
                4 / 4 passed on dev site. Cross-suite: 27 / 27.

```

- [ ] **Step 3: Append the SRT Form paragraph to the module .md**

Append at the end of `apps/.../kavach/kavach/kavach.md`:

```markdown

---

## SRT Form (2026-05-23 v0.0.8)

A custom Frappe Page at `/app/srt-form` (and `/app/srt-form?name=<draft>` for
edits) provides a best-in-class HTML/CSS/JS UI for the existing
`Stock Reconciliation SRT` DocType.

Pure UI mask — all save and submit dispatches go through the existing
DocType's `doc.save()` / `doc.submit()`, so every validation (duplicate-open
guard, gap rule, Case 1/2 classifier, remark-permission gate, workflow
transition, ERPNext SR draft creation) runs exactly as it does on the
native form. The form simply renders nicer.

Entry points: `+ Create SRT (Form)` menu item in the SRT Dashboard, the
`Edit Full Form` button on each Draft row in the View modal, and the
SRT Form shortcut + Setup link on the module workspace.

See app-root §18 and spec
`../../docs/specs/2026-05-23-srt-form-design.md` for the restricted-areas
list and full architectural rationale.
```

- [ ] **Step 4: On-disk checkpoint**

```bash
ls -l apps/kavach/kavach.md
ls -l apps/kavach/kavach/kavach/kavach.md
```

---

## Task 6: Update Claude memory

**Files:**
- Modify: `~/.claude/projects/-workspace/memory/app_kavach.md`

- [ ] **Step 1: Bump the description**

Change the `description:` line to:

```yaml
description: "kavach v0.0.8 (2026-05-23) — ERPNext SR wrapper with batch auto-populate, UOM conversion, two-pass rate-mirror, RBAC workflow, Case 1/2 routing, SRT Settings min-gap gate, workflow-state-aware duplicate-open guard, historical 'as-of posting_date/posting_time' stock fetch, list-view Status dedup, SRT Dashboard (tabbed operator review with batch drill-down), and SRT Form (best-in-class front-end mask over the existing DocType — zero validation duplicated)."
```

- [ ] **Step 2: Add item 11 to "What it does"**

After item 10 (SRT Dashboard), append:

```markdown
11. **SRT Form (2026-05-23 v0.0.8)** — custom Frappe Page at `/app/srt-form` (and `/app/srt-form?name=<draft>` for edits). Pure UI mask over the existing `Stock Reconciliation SRT` DocType — all save / submit dispatches through `doc.save()` / `doc.submit()`, zero validation duplicated. Responsive two-column layout: Item/Warehouse/Posting context on the left, live Current/Found/Δ totals on the right, full-width Tabulator batches grid with search + tick-all/untick-all + per-row delta status, full-width remarks panel with role-hint chips. 3 thin Python wrappers (`load_srt_form`, `save_srt_form`, `submit_srt_form`). Entry via `+ Create SRT (Form)` menu item + Draft-tab `Edit Full Form` button in the SRT Dashboard + workspace shortcut.
```

- [ ] **Step 3: Append restricted areas**

After the existing v0.0.7 restricted-area bullets, append:

```markdown
- **Don't duplicate any validation in the SRT Form's JS or Python** (v0.0.8 2026-05-23). The form is a UX mask — `save_srt_form` MUST dispatch through `frappe.get_doc(...).save()`.
- **Don't allow editing submitted (docstatus=1) docs via the SRT Form.** Both `load_srt_form` and `save_srt_form` early-throw with a clearer message than the doctype would produce on a remark-permission gate failure.
- **Don't bypass `doc.submit()` in `submit_srt_form`** — Case 1 auto-approve routing and ERPNext SR draft creation must fire normally.
- **Don't compute the SRT Form's Delta with a different formula than `_recompute_totals`** — the JS mirror MUST stay in sync. If `_recompute_totals` changes, update the JS too.
- **Don't use Jinja `{# … #}` comments in `srt_form.html`** — same blank-screen gotcha as the dashboard (see app-root §17). HTML comments only.
```

- [ ] **Step 4: Add Live test entry**

ABOVE the existing `## Live test 2026-05-23 (SRT Dashboard, v0.0.7)` heading, add:

```markdown
## Live test 2026-05-23 (SRT Form, v0.0.8)

4/4 verification tests pass on dev site via:
```
bench --site development.localhost execute \
  kavach.tests.test_srt_form.run_all
```

Cross-suite regression: 27/27 across all 5 suites (Case 1/2 + gap + bug-fix + historical + dashboard + form).

Pattern reuse: 5-file Page convention from `srt-dashboard`; HTML-comment-only gotcha enforced; Tabulator grid; sticky action bar via `frappe.ui.make_app_page` set_primary_action / set_secondary_action.

```

---

## Task 7: Final regression + handoff

**Files:** (none — wrap-up)

- [ ] **Step 1: Re-run all 5 test suites**

```bash
cd /workspace/development/frappe-bench
for suite in test_case1_case2 test_srt_settings_gap test_historical_stock test_srt_dashboard test_srt_form; do
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
=== test_srt_form ===
=== 4 / 4 passed ===
```

Total: **27 / 27**.

- [ ] **Step 2: Verify no stray test docs**

```bash
bench --site development.localhost mariadb -e \
  "SELECT COUNT(*) AS open_test_docs FROM \`tabStock Reconciliation SRT\` \
   WHERE item='CZMAT/1585' AND docstatus != 2;" 2>&1 | tail -3
```

Expected: `open_test_docs: 0`.

- [ ] **Step 3: Verify the Frappe-bundled JS is clean**

```bash
bench --site development.localhost console <<'PYEOF' 2>&1 | tail -6
import frappe
frappe.set_user("Administrator")
page = frappe.get_doc("Page", "srt-form")
page.load_assets()
with open("/tmp/srt_form_final.js", "w") as f:
    f.write(page.script)
print(f"OK: {len(page.script)} chars")
PYEOF
node -c /tmp/srt_form_final.js && echo "BUNDLE PARSES CLEAN"
```

Expected: `BUNDLE PARSES CLEAN`.

- [ ] **Step 4: Print summary**

Files created: 7 (5 page files + 1 test + 1 spec already on disk).
Files modified: 4 (dashboard JS, workspace JSON, app .md, module .md, memory .md).
Server APIs added: 3 thin wrappers, ~80 LOC.
JS controller: ~700 LOC (single file).
Tests: 4 new, all passing. Cross-suite: 27/27.

Ask user: anything to add? Refresh button on the form? Save-and-stay vs save-and-redirect toggle? Anything else?

---

## Self-Review Log

**Spec coverage:**
- §2.1 Page shell + route — Task 1 (full 5-file scaffold)
- §2.2 Form layout (two-column + batches + remarks) — Task 2 (full controller)
- §2.3 UX wins (item preview, live totals, per-row status, search, tick-all, sticky action bar) — Task 2
- §2.4 Save path (dispatch through doc.save()) — Task 1 Step 4 (`save_srt_form` wrapper) + Task 2 (JS save handler)
- §2.5 Live totals + per-row delta — Task 2 (`_compute_totals`, `_resolve_cf`, status formatter)
- §2.6 Dashboard + workspace integration — Tasks 3 + 4
- §3 Server APIs (3) — Task 1 Step 4
- §4 Behaviour matrix — covered by 4 tests in Task 1 Step 7 + JS in Task 2
- §5 Restricted areas (8) — Tasks 5 + 6 (app .md §18 + memory)
- §6 Testing (4 tests) — Task 1 Step 7 (full code) + Task 1 Step 9 (GREEN run) + Task 7 (regression)
- §7 Out of scope — respected (no inline-edit list view, no bulk-create, no autosave, etc.)

**Placeholder scan:** No TBDs, no "implement appropriate handling", no "similar to" cross-refs. Every code block is concrete.

**Type consistency:** Method names `load_srt_form` / `save_srt_form` / `submit_srt_form` used identically across Task 1 (define), Task 1 Step 7 (test imports), Task 2 (JS frappe.call args), Task 5 (docs), Task 6 (memory). Page name `srt-form` consistent in JSON / `frappe.pages[...]` / route navigation. State field names (`item`, `default_warehouse`, `batches`, etc.) match the DocType schema verbatim — so `doc.update(payload)` aligns one-to-one.

**Edge case verified:** Task 1's `save_srt_form` distinguishes new vs edit via the `name` parameter. For new, we set `payload["doctype"]` to `"Stock Reconciliation SRT"` BEFORE calling `frappe.get_doc(payload)` — that's the canonical Frappe way to instantiate a new doc from a dict. For edit, we `frappe.get_doc("Stock Reconciliation SRT", name)` then `.update(payload)` which merges the payload onto the existing doc (preserving fields the form doesn't touch like `naming_series`, `amended_from`, etc.). Both paths converge at `doc.save()` which runs the full validate() chain.
