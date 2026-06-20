# `report/` — Stock Reconciliation Tracking reports (folder overview)

Standard Frappe report folder for the **Stock Reconciliation Tracking** module
(app `kavach`). Each report is a sub-folder holding `__init__.py`, a `.json`
(Report metadata), a `.py` (Script Report `execute`), an optional `.js`
(filters + cell rendering), and a `.md` (component docs).

```
report/
├── __init__.py
├── report.md                                   ← this overview
├── work_order_consumption_cost_analysis/       ← Script Report
│   ├── __init__.py
│   ├── work_order_consumption_cost_analysis.json
│   ├── work_order_consumption_cost_analysis.py
│   ├── work_order_consumption_cost_analysis.js
│   └── work_order_consumption_cost_analysis.md
└── batch_moving_costing_vs_origin_analysis/    ← Script Report
    ├── __init__.py
    ├── batch_moving_costing_vs_origin_analysis.json
    ├── batch_moving_costing_vs_origin_analysis.py
    ├── batch_moving_costing_vs_origin_analysis.js
    └── batch_moving_costing_vs_origin_analysis.md
```

## Reports

| Report | Type | ref_doctype | What it does |
|--------|------|-------------|--------------|
| **Work Order Consumption Cost Analysis** | Script Report | Work Order | Per-batch consumption cost + batch-origin traceability for every Manufacture Stock Entry of a Work Order. See its `.md`. |
| **Batch Moving Costing vs Origin Analysis** | Script Report | Batch | Per-batch inward vs outward valuation with a **Rate Match** verdict (cost drift) + batch origin. See its `.md`. |

## Conventions (read before adding a report here)

- **Script Report**, not pure "Query Report": these reports need Python
  post-processing (UOM resolution, batch-origin lookup, custom-field guards)
  that raw SQL can't do. `is_standard: "Yes"`, `module: "Stock Reconciliation
  Tracking"`.
- **Batches come from the Serial and Batch Bundle**, never `Batch.batch_qty` /
  `Bin`. Join `Stock Ledger Entry` → `Serial and Batch Entry` (`sbe`). This is
  the site-wide quirk documented in `../api.py` and the report `.md` files.
- **Read-only.** Reports never write. All mutations stay in the SRT DocType
  lifecycle.
- **Cross-app fields are guarded** with `frappe.db.has_column(...)` so a report
  still runs where chaizup_toc / erpnext customisations are absent.
- **Bound params only.** User filter values are SQL parameters; only fixed
  column names are concatenated.
- After adding/editing a report's `.json`, run `bench --site <site> migrate`
  (or `frappe.modules.import_file.import_file_by_path`) to sync it into
  `tabReport`.

## Integrations

These reports sit on top of **ERPNext** (Work Order, Stock Entry, Item, Batch,
Stock Ledger Entry, Serial and Batch Bundle/Entry, UOM Conversion Detail) and
**chaizup_toc** custom fields (e.g. `Work Order.custom_mrp`, `Item.custom_mrp`,
`Work Order.workflow_state`). The kavach app is read-only against all of them.
