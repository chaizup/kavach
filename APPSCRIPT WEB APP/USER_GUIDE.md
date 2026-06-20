# SRT Web App — User Guide

Stock Reconciliation Tracking (SRT) mobile web app for creating, submitting, and approving stock reconciliation records.

---

## Getting Started

1. Open the web app URL shared by your admin
2. Enter your **Email** and **Password** (same as your Frappe/ERPNext login)
3. Tap **Sign In**

Your session stays active until you log out or it expires. If you see "Session expired", log in again.

### Add to Home Screen (optional)

For a native app feel:

- **iPhone**: Open in Safari > tap Share > "Add to Home Screen"
- **Android**: Open in Chrome > tap Menu (3 dots) > "Add to Home Screen"

---

## Navigation

The app has 3 pages, accessible from the bottom navigation bar:

| Tab | Icon | Purpose |
|-----|------|---------|
| **Dashboard** | Grid | View pending approvals (Admin / Super Admin) |
| **New SRT** | Plus | Create a new Stock Reconciliation |
| **History** | Clock | View past SRT records and their status |

The **Logout** button (door icon) is at the top-right corner.

---

## For Users (Srt User Role)

### Creating a New SRT

1. Tap **New SRT** in the bottom nav

2. **Select Item**
   - Start typing the item code or name in the search box
   - A dropdown appears with matching items (format: `ITEM-CODE : Item Name`)
   - Tap to select

3. **Select Warehouse**
   - Start typing the warehouse name
   - Tap to select from the dropdown

4. **Set Posting Date & Time**
   - Defaults to today's date and current time
   - Change if you're recording a count done at a different time
   - The stock snapshot is taken as of this date/time

5. **Batch Cards Auto-Populate**
   - All batches with positive stock (as of the posting date/time) appear automatically
   - Each batch card shows 4 fields:

   | Field | Description |
   |-------|-------------|
   | **Current (Higher UOM)** | System stock in the higher UOM (e.g., `2.5 Kg`) — read-only |
   | **Qty Found (Higher UOM)** | Your physical count input — enter in the same higher UOM (e.g., Kg). Disabled until you tick Reconcile. |
   | **Current (Stock UOM)** | System stock in the base/stock UOM (e.g., `2500 Gm`) — read-only |
   | **Conv. Factor** | Conversion factor between higher UOM and stock UOM (e.g., `1000` means 1 Kg = 1000 Gm) |

   > **Example**: If the item's stock UOM is **Gm** and higher UOM is **Kg** with conversion factor **1000**:
   > - Current (Kg) = 2.5, Current (Gm) = 2500
   > - You enter Qty Found in **Kg** (e.g., 2.3)
   > - The system automatically converts to Gm internally (2.3 x 1000 = 2300 Gm)

6. **Tick "Reconcile" and Enter Qty Found**
   - Tick the **Reconcile** checkbox on each batch you physically counted
   - Each batch card has **two input fields** — you can enter Qty Found in **either UOM**:
     - **Found (Kg)** — enter in the higher UOM; the stock UOM field auto-fills
     - **Found (Gm)** — enter in the stock UOM; the higher UOM field auto-fills
   - The two fields stay in sync via the conversion factor — change one, the other updates instantly
   - Unticked batches are treated as "not counted" — their current stock carries forward as-is

7. **Adding Batches Not Listed (0 Stock)**
   - Below the batch cards, find the **"Add Batch (0 stock / not listed)"** section
   - Search for any batch of the selected item by typing the batch number
   - Batches already in the list are excluded from results
   - Tap a batch to add it — it appears in the batch list with "Reconcile" pre-ticked and current stock = 0
   - Use this when you physically found stock for a batch that the system shows as 0

8. **Totals Panel (Both UOMs)**
   - Updates live as you tick batches and enter quantities
   - Shows 4 totals in a 2x2 grid:

   | | Stock/Default UOM (e.g., Gm) | Higher UOM (e.g., Kg) |
   |---|---|---|
   | **Current Stock** | Total system stock | Same, converted |
   | **Actually Found** | Total physical count | Same, converted |

   - Below the grid: **Delta** — the difference (Found - Current) in default UOM
   - Green delta = surplus (+), Red delta = shortage (-)

9. **User Remark** (required for submit)
   - Enter a note explaining why you're doing this reconciliation
   - This remark is visible to Admin during approval

10. **Save or Submit**
    - **Save as Draft** — saves your work, you can come back and edit later
    - **Save & Submit** — saves and submits for approval
    - You must tick at least one batch and fill the User Remark to submit

### What Happens After Submit?

- **Case 1 (Auto-Approve)**: If ALL ticked batches have Qty Found = Current Stock (no difference), the system auto-approves it instantly. You'll see a toast: "All batches matched — Auto-Approved by System!"
- **Case 2 (Manual Approval)**: If there's any difference, the SRT goes to the Admin for approval. Status changes to "Draft" (pending Admin approval).

---

## For Admins (Srt Admin Role)

### Dashboard — Admin Approval Tab

1. Tap **Dashboard** in the bottom nav
2. The **Admin** tab shows all SRTs pending your approval
3. The badge number shows the count of pending items

### Understanding the Approval Cards

Each card shows:

| Field | Description |
|-------|-------------|
| **Item : Item Name** | Which item was reconciled |
| **SRT Name** | The document ID (e.g., SRT-RECO-2026-00003) |
| **Warehouse** | Where the count was done |
| **Snapshot Stock** | System stock at the posting date/time (in default UOM) |
| **Physical Found** | What the user actually counted (in default UOM) |
| **Difference** | The gap — **green** if positive (e.g., +904 Gm surplus), **red** if negative (e.g., -323 Gm shortage) |
| **Date** | Posting date |

### Viewing SRT Details

1. Tap any card or the **View** button
2. A modal opens showing:
   - **Totals in both UOMs**:
     - Snapshot Stock vs Physical Found — in default UOM (e.g., Gm) AND higher UOM (e.g., Kg)
     - Difference shown in both UOMs with color (green = surplus, red = shortage)
   - **User Remark** — what the user wrote when submitting
   - **Batch cards** — each batch shows:
     - Current vs Found in the **higher/selected UOM** (e.g., Kg)
     - Current in the **stock UOM** (e.g., Gm) — so you can cross-verify
     - Counted batches are highlighted; uncounted are dimmed

### Approving an SRT

1. Open the SRT detail modal
2. Read the User Remark and review the batch-level comparison (both UOMs)
3. Enter your **Admin Remark** (required)
4. Tap **Approve**
5. The SRT moves to Super Admin for final approval

### Rejecting an SRT

1. Open the SRT detail modal
2. Enter your **Admin Remark** in the remark field (required — explain why you're rejecting)
3. Tap **Reject**
4. The SRT is marked as "Closed" (rejected) — the user can see it in their History

### Bulk Approve

1. On the dashboard, tick the checkboxes on multiple cards
2. Use **Select All** to select everything
3. The bulk action bar appears at the bottom: "X selected — Approve All / Reject All"
4. Tap **Approve All**
5. Enter a remark (applies to all selected)
6. All selected SRTs are approved at once

### Bulk Reject

1. Select multiple cards using checkboxes (same as bulk approve)
2. Tap **Reject All** in the bulk action bar
3. Enter a rejection reason (mandatory — cannot proceed without it)
4. All selected SRTs are rejected at once

### What Admin Can See

| What | Visible? |
|------|----------|
| User Remark | Yes — always shown when viewing an SRT |
| Admin Remark (own) | Written by you at approve/reject |
| Super Admin Remark | Not visible to Admin |

---

## For Super Admins (Srt Super Admin Role)

### Dashboard — Super Admin Approval Tab

1. Tap **Dashboard** in the bottom nav
2. Switch to the **Super Admin** tab
3. These are SRTs that have already been approved by Admin and need your final approval

### Viewing SRT Details

Same as Admin view, plus you can see **both** prior remarks:

- **User Remark** — what the user wrote at submit
- **Admin Remark** — what the admin wrote during their approval

The totals and batch cards show both UOMs (default + higher), same as Admin view.

### Approving (Final Approval)

1. Open the SRT detail modal
2. Review User Remark + Admin Remark + batch details (check both UOMs)
3. Enter your **Super Admin Remark** (required)
4. Tap **Approve**
5. This triggers the final stock reconciliation in ERPNext — the system stock is officially updated

### Rejecting an SRT

1. Open the SRT detail modal
2. Enter your **Super Admin Remark** in the remark field (required — explain why you're rejecting)
3. Tap **Reject**
4. The SRT is marked as "Closed" (rejected) — goes back to the user's History

### Bulk Approve / Bulk Reject

Same as Admin — select multiple cards using checkboxes and tap "Approve All" or "Reject All". Rejection reason is mandatory.

### What Super Admin Can See

| What | Visible? |
|------|----------|
| User Remark | Yes |
| Admin Remark | Yes — to understand admin's reasoning |
| Super Admin Remark (own) | Written by you at approve/reject, stored for audit trail |

---

## History

1. Tap **History** in the bottom nav
2. Shows all your past SRT records (Admins/Super Admins see all users' records)
3. Each card shows: Item, SRT Name, Warehouse, Date, and Status
4. Tap any card to open the full detail modal

### Status Meanings

| Status | Meaning |
|--------|---------|
| **Draft** | Submitted, waiting for Admin approval |
| **Admin Approved** | Admin approved, waiting for Super Admin final approval |
| **Completed** | Super Admin approved — stock updated in ERPNext |
| **Auto-Approved** | System auto-approved (all batches matched — no difference) |
| **Closed** | Rejected by Admin or Super Admin |
| **Cancelled** | Document was cancelled |

---

## Understanding UOMs

### Two UOMs Per Item

Most items have two Units of Measure:

| UOM Type | Example | Where Used |
|----------|---------|------------|
| **Stock/Default UOM** | Gm (grams) | Internal storage, ERPNext Stock Ledger, totals |
| **Higher UOM** | Kg (kilograms) | User-facing — what you count on the floor |

The **Conversion Factor** links them: e.g., 1 Kg = 1000 Gm (CF = 1000).

### Where Each UOM Appears

**Create Form — Batch Cards:**
| Field | UOM | Editable? |
|-------|-----|-----------|
| Current (Kg) | Higher UOM | Read-only |
| Found (Kg) | Higher UOM | Editable — auto-syncs Gm field |
| Current (Gm) | Stock UOM | Read-only |
| Found (Gm) | Stock UOM | Editable — auto-syncs Kg field |
| CF footnote | — | Read-only (e.g., "CF: 1 Kg = 1000 Gm") |

**Create Form — Totals Panel:**
| Row | Default UOM (Gm) | Higher UOM (Kg) |
|-----|-------------------|-----------------|
| Current Stock | Shown | Shown |
| Actually Found | Shown | Shown |
| Delta | Shown | — |

**View Modal (Admin/Super Admin) — Totals:**
| Row | Default UOM (Gm) | Higher UOM (Kg) |
|-----|-------------------|-----------------|
| Snapshot Stock | Shown | Shown |
| Physical Found | Shown | Shown |
| Difference | Shown (colored) | Shown (colored) |

**View Modal — Batch Cards:**
| Field | UOM |
|-------|-----|
| Current (Kg) | Higher/Selected UOM |
| Found (Kg) | Higher/Selected UOM |
| Current (Gm) | Stock UOM |
| Found (Gm) | Stock UOM (auto-converted) |

### How Conversion Works

- You can **enter Qty Found in either UOM** — both fields are editable and stay in sync
- Example: Enter 2.3 in the Kg field → the Gm field auto-fills with 2300 (2.3 x 1000)
- Or: Enter 2300 in the Gm field → the Kg field auto-fills with 2.3 (2300 / 1000)
- Internally, the system stores qty in the higher UOM and converts via the Conversion Factor
- Totals are computed in Stock UOM (Gm), then divided by CF for the higher UOM display

### If Item Has Only One UOM

When the stock UOM and higher UOM are the same (e.g., both "Nos"), only one set of columns appears — no duplicate display.

---

## Understanding the Numbers

### Snapshot Stock vs Physical Found

- **Snapshot Stock** = what the system says the stock is, as of the posting date and time
- **Physical Found** = what was actually counted on the warehouse floor

### Difference (Delta)

- **Green (e.g., +904 Gm / +0.904 Kg)** = you found MORE than the system expected — surplus
- **Red (e.g., -323 Gm / -0.323 Kg)** = you found LESS than the system expected — shortage
- **Green 0** = exact match — no discrepancy

### Counted vs Uncounted Batches

- **Counted** (Reconcile ticked) = you physically counted this batch. The Qty Found you entered is used.
- **Uncounted** (Reconcile not ticked) = you did NOT count this batch. The system assumes Current Stock = Found (no change). These rows appear dimmed.

---

## Remarks — Who Sees What

| Remark | Written By | When | Visible To |
|--------|-----------|------|------------|
| **User Remark** | SRT User | At submit | Admin, Super Admin |
| **Admin Remark** | Admin | At approve or reject | Super Admin only |
| **Super Admin Remark** | Super Admin | At approve or reject | Audit trail only |

All remarks are **mandatory** — you cannot submit, approve, or reject without entering a remark.

The remark field appears in:
- **Create Form** — "User Remark" textarea (required at submit, optional at save)
- **View Modal** — remark textarea appears for Admin (on Draft SRTs) and Super Admin (on Admin-approved SRTs), used for both Approve and Reject actions

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Session expired" | Log out and log in again |
| Login fails | Check your email/password — same as Frappe desk login |
| No batches appear after selecting item + warehouse | The item has no stock at that posting date/time. Use "Add Batch" below the batch list to manually add 0-stock batches. |
| "Add Batch" shows no results | The item may not have any batches at all in the system, or you've already added them all |
| Dropdown doesn't appear | Type at least 1 character for item/warehouse/batch search, or tap the field to see all options |
| Search feels slow the first time | The first search after login (or after 1 hour) fetches data from the server and caches it — subsequent searches are instant |
| Can't submit | Make sure: (1) at least one batch has Reconcile ticked, (2) User Remark is filled |
| Can't approve/reject | Make sure the remark field is filled — it's required for both approve and reject |
| Dashboard shows 0 pending | All SRTs have been processed — check History for past records |
| "Approve All" doesn't work | Select at least one card using the checkboxes first |
| Toast says "API error" | The error message comes from Frappe — read it for details (e.g., missing field, permission issue) |
| UOM looks wrong | Check the Conversion Factor on the batch card — if CF = 1, both UOMs are the same |
