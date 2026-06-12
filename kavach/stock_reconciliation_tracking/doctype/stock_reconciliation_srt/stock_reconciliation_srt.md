# Stock Reconciliation SRT — DocType

**Module:** Stock Reconciliation Tracking
**Type:** Submittable, workflow-enabled, amendable
**Current version:** v0.0.9.26 (2026-05-25)
**Reference:** `../../../kavach.md` (app root), `../../../kavach/kavach.md` (module), `../../page/srt_dashboard/srt_dashboard.md` (UI)

---

## 1. Purpose

Wrapper DocType for `Stock Reconciliation` (ERPNext). Lets stock-team operators reconcile one item × one warehouse at a time with full PCAOB-grade audit trail. The reconciliation Engine UX cost (manually identifying every (item, warehouse, batch) tuple, looking up Bin qty, typing valuation rates) is unworkable at chaizup scale (SFG items with 1009 batches). SRT cuts that to: pick item → pick warehouse → tick the rows you actually counted → type Qty Found.

On submit, SRT creates a *draft* ERPNext SR; the Srt Super Admin then submits the linked SR separately (segregation of duties).

## 2. In-depth use cases

- **Monthly cycle count (the daily driver)**: operator counts WH 1.9 at month-end, files SRT against (item, WH 1.9, today_date). The 9 controller validations catch ticked rows with no qty_found, duplicate (batch, warehouse) tuples, missing item_name, and stale modifications.
- **Backdated reconciliation (the v0.0.9.26 fix is for this)**: operator counts Friday at 5pm closing, files SRT Monday morning. SRT's `edit_posting` toggle lets the operator backdate `posting_date` + `posting_time` so the ledger entry lands on Friday. The linked ERPNext SR must carry the SRT's backdated timestamp — anything else breaks the audit trail.
- **Auto-approved no-delta confirmations (Case 1)**: operator counts and confirms every batch matches current stock. `_classify_zero_delta_ticks` flags `flags.all_matched_no_delta`; on_submit routes to `workflow_state = "Approved By System"` without ever creating an ERPNext SR. System note auto-fills both approval remarks (only if empty — preserves user-typed notes).
- **Mixed match + delta (Case 2)**: some ticked rows match, others don't. `_classify_zero_delta_ticks` silently unticks the matches so only real-delta rows reach the SR.
- **Rejected with reason**: Srt Admin or Super Admin closes the SRT via the dashboard's Reject action; reason gets prefixed `[REJECTED via SRT Dashboard <ts> by <user>]` and persisted to the appropriate remark field; workflow advances to `Close` (docstatus=2).

## 3. Dependencies

- **`erpnext` app** — Stock Reconciliation, Bin, Stock Ledger Entry, Serial and Batch Bundle, Account (Stock Adjustment).
- **`erpnext.stock.serial_and_batch_bundle.SerialandBatchBundle`** — monkey-patched at submit time per [[erpnext_bulk_reconcile_quirks]] Quirk #2 (six validators bypassed inside try/finally to handle legitimate reconciliations that ERPNext's SABB validators would otherwise reject).
- **`erpnext.utilities.transaction_base.TransactionBase.validate_posting_time`** — **CRITICAL**: this is the framework code that forced the v0.0.9.26 fix. Read this method before touching anything posting-date-related.
- **`Stock Settings`** — toggles `allow_negative_stock` + `allow_negative_stock_for_batch` to 1 during `submit_linked_sr`, restored in finally block.
- **Same-app `SRT Settings` Single DocType** — provides `gap_between_stock_reconciliation_days` for the min-gap rule.
- **Same-app `Batch List` child DocType** — child table rows.
- **Same-app `srt_dashboard` page** — the only UI for this DocType (standalone form route deleted in v0.0.9).
- **Same-app `api.py`** — `get_item_defaults` + `get_batch_current_state` (used by the dashboard form panel for batch autopopulate).

## 4. Reasoning (why this DocType exists)

ERPNext's native Stock Reconciliation is fine for small inventories. At chaizup scale:
1. **Manual batch lookup is unworkable** — operator can't manually identify which of 1009 batches have positive stock in WH 1.9.
2. **Rate knowledge gap** — stock operators don't know per-batch valuation rates; ERPNext's SR form invites them to type one, leading to silent valuation drift on submit. SRT's two-pass rate-mirror (insert → ERPNext computes current_valuation_rate → mirror back to valuation_rate → submit) guarantees the SR moves only qty, never rate.
3. **Segregation of duties (PCAOB AS 2401)** — the operator who counts must NOT also be the person who posts the ledger entry. Native SR has no such gate. SRT enforces three role hierarchy: Srt User (counts), Srt Admin (validates count → creates draft SR), Srt Super Admin (submits SR → posts ledger).
4. **Audit-trail visibility** — every SRT carries the full count provenance, two approval timestamps + users, three rich-text remark fields with permission-gated writability, and a backdate-aware posting timestamp that the linked SR mirrors. Native SR has none of these.
5. **Backdate protection (v0.0.9.26)** — operators routinely count "closing" inventory and file the next business day. ERPNext's `validate_posting_time` silently overwrites with `now()` unless `set_posting_time = 1` is set; SRT's `_create_erpnext_sr_draft` MUST set this flag to preserve the audit invariant.
6. **No double-counting between draft and committed states** — `_enforce_no_duplicate_open_srt_for_item` blocks a second SRT for an item until the prior one reaches a complete workflow state (Super Admin Approval or Approved By System). `_enforce_min_gap_between_srts` adds a configurable gap throttle on top.

## 5. Database connections

| Link / table | How SRT uses it |
|---|---|
| `tabStock Reconciliation SRT` | This DocType's own table. |
| `tabBatch List` | Child rows (one per (batch, warehouse) tuple with positive Bin qty at posting time). |
| `tabStock Reconciliation` | Linked ERPNext SR created on SRT submit (draft) and submitted on super admin approve. Foreign-key field: `linked_erpnext_sr`. |
| `tabItem` | `item` link; `item_name` mirrored via `_mirror_item_name`. |
| `tabWarehouse` | `default_warehouse` link; mirrored onto every child row's `warehouse` via `_stamp_child_warehouse_and_item`. |
| `tabCompany` | `company` link; used to resolve Stock Adjustment account in `_create_erpnext_sr_draft`. |
| `tabUOM` | `default_uom` + `higher_uom` links. |
| `tabUOM Conversion Detail` (Item child) | Read by `api.get_uom_conversion` to populate `higher_uom_cf` + child `conversion_factor`. |
| `tabBin` | Read by `api.get_item_defaults` to populate child rows (only batches with `actual_qty > 0` scoped to `default_warehouse`). |
| `tabStock Ledger Entry` | Read by `api.get_batch_current_state` (historical as-of) + `srt_dashboard.py::get_batch_summary` (origin + in/out summary for view modal). |
| `tabSerial and Batch Entry` | Joined onto SLE for batch-level qty resolution in dashboard view modal queries. |
| `tabAccount` | Read in `_create_erpnext_sr_draft` to find the Stock Adjustment account (`account_type='Stock Adjustment'` scoped to company). |
| `tabUser` | `admin_approved_by` + `super_admin_approved_by` links (auto-stamped). |
| `tabWorkflow State` | `workflow_state` link (managed by the Stock Reconciliation SRT Workflow). |

## 6. Lifecycle

```
new() / autoname                  → SRT-RECO-.YYYY.-.#####
validate() (every save)           → 9 gates (see below)
on_update (after every save)
  if flags.all_matched_no_delta AND docstatus==0:
    _reverify_live_stock()        → re-fetch LIVE batch qty from SLE at posting_date/time
                                    compare vs qty_found at precision=3
    if still matches:
      db_set(docstatus=1)         → auto-submit
      _route_to_system_approved() → ws="Approved By System", auto-stamp both approvers,
                                    auto-fill both remarks (only if empty), NO ERPNext SR
    else:
      warn user, skip auto-approve
on_submit (workflow Draft → ?, fallback if manual submit)
  if flags.all_matched_no_delta:
    _route_to_system_approved()   → same as above (fallback for workflow-triggered submit)
  else:
    _create_erpnext_sr_draft()    → builds + inserts ERPNext SR in DRAFT
                                    with sr.set_posting_time = 1 (v0.0.9.26 guard)
                                    + two-pass rate-mirror (insert → mirror valuation_rate)
    db_set("linked_erpnext_sr", sr.name)
    db_set("admin_approved_by", session.user)
    ws moves to "Admin Approval" via workflow
submit_linked_sr() (Srt Super Admin click, separate action)
  monkey-patch SABB validators (Quirk #2)
  toggle Stock Settings allow_negative_stock + allow_negative_stock_for_batch ← 1
  try:  sr._submit()                       ← validate_posting_time still runs but
                                              set_posting_time=1 from insert preserves
                                              our backdated posting_date/time
    db_set("workflow_state", "Super Admin Approval")
    db_set("super_admin_approved_by", session.user)
  finally:  restore Stock Settings, commit
on_cancel
  if linked SR draft:    delete it
  if linked SR submitted: cascade-cancel (Srt Super Admin / System Manager only)
```

## 7. The 9 validate() gates (`validate()` runs on every `doc.save()`)

| Order | Gate | What it enforces |
|---|---|---|
| 1 | `_set_default_posting` | nowdate / nowtime if blank. (Dashboard also defaults these in `load_srt_form`.) |
| 2 | `_mirror_item_name` | Mirrors Item.item_name onto self.item_name. Runs BEFORE stamp so children inherit. |
| 3 | `_stamp_child_warehouse_and_item` | Mirrors parent.default_warehouse + parent.item onto every child row (children inherit and the read-only field is server-stamped). |
| 4 | `_enforce_no_duplicate_rows` | Each (batch_no, warehouse) tuple appears at most once. |
| 5 | `_enforce_no_duplicate_open_srt_for_item` | Blocks new SRT for an item that already has one in a non-complete workflow state (anything except "Super Admin Approval" / "Approved By System" / docstatus=2). |
| 6 | `_enforce_min_gap_between_srts` | `SRT Settings.gap_between_stock_reconciliation_days` throttle (symmetric, includes docstatus=1 and 2 priors). |
| 7 | `_classify_zero_delta_ticks` | Routes between Case 1 (all matched → flags.all_matched_no_delta), Case 2 (mixed → untick matches), and normal flow (all real deltas). Rounds both qty_found and current_stock_in_selected_uom to display precision (3) before comparing (2026-06-12 precision fix). Must run BEFORE the next gate. |
| 8 | `_enforce_at_least_one_reconcile_ticked` | Block save when zero rows have `is_counted = 1`. Skipped when item+warehouse not yet set (mid-fill). |
| 9 | `_enforce_remark_field_permissions` | Field-level write gates per role + workflow_state. System Manager + Administrator bypass. Detects changes via `get_doc_before_save` to avoid blocking re-saves where the locked field wasn't actually touched. |

Then `_recompute_totals()` aggregates child rows into the 4 parent total fields:
- `total_current_stock_in_default_uom` = Σ `current_stock_in_stock_uom` (all rows)
- `total_qty_found_in_default_uom` = for `is_counted=1` rows: Σ `qty_found × conversion_factor`; for uncounted rows: Σ `current_stock_in_stock_uom`
- Higher UOM variants = above ÷ `higher_uom_cf`

## 8. Restricted areas (canonical list)

See top-of-file comment in `stock_reconciliation_srt.py`. Hot list:

- **`sr.set_posting_time = 1` (v0.0.9.26)** — in `_create_erpnext_sr_draft`, must stay set BEFORE assigning posting_date / posting_time. Removing it re-introduces silent overwrites; backdated SRTs collapse to whatever time the super admin clicked submit.
- **Two-pass rate-mirror in `_create_erpnext_sr_draft`** — don't downgrade to a single-pass with your own batch-rate query. Tested with `MAX(sle.valuation_rate)` and got 4.09 for a batch where ERPNext considers 1.583 the actual current rate.
- **`_enforce_no_duplicate_open_srt_for_item`'s COMPLETED_STATES tuple** — kept narrow on purpose. Adding "Admin Approval" would let users start a new SRT while the prior's ERPNext SR is still draft, risking parallel-write races on the same item.
- **`_classify_zero_delta_ticks` epsilon = 0.001** — matches the field's `precision=3`. Don't tighten below 0.001; would force users to perceive sub-displayable diffs.
- **SABB monkey-patches in `submit_linked_sr`** — required for legitimate reconciliations to submit (per Quirk #2). Always apply inside try/finally so the site is restored on any error.
- **`Stock Settings.allow_negative_stock` toggle** — same try/finally pattern; never leave it in the toggled state across requests.
- **`_route_to_system_approved` uses db_set with `update_modified=False`** — calling `self.save()` here would re-run validate which would reject the cross-role remark writes via `_enforce_remark_field_permissions`.
- **`autoname` = naming_series** — don't change to `field:` style or autoincrement; the SRT-RECO prefix is on print and audit logs.

## 9. Verification

Cross-suite regression (28/28 as of 2026-05-25):

```bash
for s in test_case1_case2 test_srt_settings_gap test_historical_stock test_srt_dashboard; do
  bench --site development.localhost execute kavach.tests.${s}.run_all
done
```

| Suite | Count | Coverage |
|---|---|---|
| test_case1_case2 | 6 | Case 1 happy / Case 2 mixed / Case 1 preserves admin remark / cancel auto-approved / regression normal submit / **SR posting mirrors SRT (v0.0.9.26)** |
| test_srt_settings_gap | 8 | gap rule edge cases |
| test_historical_stock | 4 | as-of posting_date/time fetch |
| test_srt_dashboard | 10 | 11 server endpoints + form save/concurrency |

## 10. Sync block

```
DOCTYPE:      Stock Reconciliation SRT @ v0.0.9.35 (2026-06-12)
SUBMITTABLE:  yes (docstatus 0=Draft, 1=Submitted, 2=Cancelled)
WORKFLOW:     Stock Reconciliation SRT Workflow (Draft → Admin Approval → Super Admin Approval → Close; Approved By System short-circuits Case 1)
NAMING:       SRT-RECO-.YYYY.-.#####
ROLES:        Srt User (create/edit own drafts), Srt Admin (approve Draft), Srt Super Admin (submit linked SR + cancel submitted), System Manager (bypass)

POSTING-TIMESTAMP GUARD (v0.0.9.26):
  _create_erpnext_sr_draft: sr.set_posting_time = 1 BEFORE posting_date/time
  Without it, validate_posting_time rewrites both fields to now() on insert + submit

CASE1-ON-SAVE (v0.0.9.35):
  _classify_zero_delta_ticks now rounds to precision=3 before comparing (precision fix)
  on_update auto-submits Case 1 on SAVE (not just on manual submit via workflow action)
  _reverify_live_stock re-fetches SLE batch qty at posting_date/time before auto-approving

LIFECYCLE:
  validate (9 gates) → on_update (Case1 auto-submit on save with live re-verify)
  on_submit (fallback Case1 short-circuit OR _create_erpnext_sr_draft + mirror rate + advance to Admin Approval)
  submit_linked_sr (Srt Super Admin) → SABB patches + Stock Settings toggle + sr._submit() → advance to Super Admin Approval
  on_cancel → if SR draft delete; if SR submitted cascade-cancel (Super Admin / System Manager only)

KEY HELPERS:
  _resolve_row_cf  — 4-step fallback for child row conversion factor
  _recompute_totals — Σ over rows, qty_found_in_stock_uom if is_counted else current_stock_in_stock_uom
  _reverify_live_stock — re-fetch SLE batch qty at posting_date/time, compare at precision=3
  _apply_validation_patches — 7 SABB / SLE patches per Quirk #2
  _can_submit_linked_sr — Admin user / System Manager / Srt Super Admin

DEPENDENCIES (read sources):
  erpnext: Stock Reconciliation, Bin, SLE, Serial and Batch Bundle, Account, transaction_base.validate_posting_time
  same-app: SRT Settings (gap), Batch List (child), api.py (3 methods), srt_dashboard page

TESTS: 28/28 (test_case1_case2 6, test_srt_settings_gap 8, test_historical_stock 4, test_srt_dashboard 10)
DOCS:  this file (DocType), ../../../kavach.md (app), ../../../kavach/kavach.md (module), ../../page/srt_dashboard/srt_dashboard.md (UI)
```
