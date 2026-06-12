# SRT Web App — Google Apps Script Setup Guide

Mobile-friendly web app for Stock Reconciliation Tracking (SRT).
Connects to your Frappe/ERPNext site via API.

---

## Prerequisites

1. A Google account (for Google Apps Script)
2. A running Frappe/ERPNext site with the **kavach** app installed
3. The Frappe site must be publicly accessible (HTTPS) — not `localhost`

---

## Step 1: Create a Google Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click **New Project**
3. Rename the project to **SRT Web App** (click "Untitled project" at top)

---

## Step 2: Copy Files into the Project

The GAS editor has a flat file structure. Create each file using **+** > **Script** (for `.gs`) or **+** > **HTML** (for `.html`).

### Server-side files (.gs)
| Local File | GAS File Name | Type |
|---|---|---|
| `Code.gs` | `Code` | Script (.gs) |
| `Auth.gs` | `Auth` | Script (.gs) |
| `FrappeProxy.gs` | `FrappeProxy` | Script (.gs) |

### Client-side files (.html)
| Local File | GAS File Name | Type |
|---|---|---|
| `index.html` | `index` | HTML (.html) |
| `styles.html` | `styles` | HTML (.html) |
| `script.html` | `script` | HTML (.html) |

**How to create each file:**
1. In the GAS editor sidebar, click **+** next to "Files"
2. Select **Script** for `.gs` files or **HTML** for `.html` files
3. Name it exactly as shown above (without extension — GAS adds it)
4. Copy-paste the contents from the local file
5. Delete the default `Code.gs` content before pasting

---

## Step 3: Configure Frappe URL (Optional)

You have two options:

### Option A: Let users enter the URL on login (recommended)
Leave `FRAPPE_URL` empty in `Code.gs`. Users will see a "Frappe Site URL" field on the login page (like the Raven app). Each user can point to their own site.

### Option B: Lock to one site
In `Code.gs`, set the constant:
```javascript
const FRAPPE_URL = 'https://erp.yourcompany.com';
```
The URL field will be hidden on login — all users connect to this site.

---

## Step 4: Configure Frappe CORS (IMPORTANT)

Your Frappe site must allow API calls from the GAS domain. Add this to your Frappe site's `site_config.json`:

```json
{
  "allow_cors": "*"
}
```

Or more restrictively:
```json
{
  "allow_cors": ["https://script.google.com", "https://script.googleusercontent.com"]
}
```

After changing `site_config.json`, restart the Frappe bench:
```bash
bench restart
```

---

## Step 5: Deploy the Web App

1. In the GAS editor, click **Deploy** > **New deployment**
2. Click the gear icon next to "Select type" > choose **Web app**
3. Configure:
   - **Description**: `SRT Web App v1.0`
   - **Execute as**: `User accessing the web app` (each user gets their own session)
   - **Who has access**: `Anyone` (or `Anyone with Google account` for restricted access)
4. Click **Deploy**
5. Click **Authorize access** and grant permissions
6. Copy the **Web app URL** — this is what you share with users

---

## Step 6: Share with Users

Send the Web app URL to your team. Users will:
1. Open the URL in their mobile browser
2. Enter the Frappe site URL (if not locked)
3. Enter their Frappe email + password
4. Start using the app

### Add to Home Screen (iOS/Android)
For a native app feel:
- **iOS**: Safari > Share > "Add to Home Screen"
- **Android**: Chrome > Menu (three dots) > "Add to Home Screen"

---

## User Roles

The app automatically detects roles from the Frappe account:

| Role | What they can do |
|---|---|
| **Srt User** | Create SRT, save draft, submit, view history |
| **Srt Admin** | All above + see "Admin Approval" tab + approve/reject drafts |
| **Srt Super Admin** | All above + see "Super Admin Approval" tab + final approve (submits linked ERPNext SR) |
| **System Manager** | Full access to all features |

---

## Features

### For Users (Srt User)
- Create SRT: Search item > select warehouse > batches auto-populate
- Enter "Qty Found" on each batch > tick "Do Reconcile"
- Save as draft or submit
- View history with status tracking

### For Admins (Srt Admin)
- Dashboard with "Admin Approval Pending" tab
- View SRT details with batch breakdown
- Approve or reject with remarks
- Bulk approve multiple SRTs at once

### For Super Admins (Srt Super Admin)
- Dashboard with "Super Admin Approval Pending" tab
- Final approval (submits the linked ERPNext Stock Reconciliation)
- Approve or reject with remarks
- Bulk approve

### Auto-Approval (Case 1)
When all ticked batches match current stock (qty_found == current_stock), the SRT is automatically approved by the system — no admin intervention needed.

---

## Troubleshooting

### "Could not connect — check the site URL"
- Ensure the Frappe URL includes `https://`
- Ensure the site is publicly accessible (not localhost)
- Check CORS configuration (Step 4)

### "SESSION_EXPIRED" errors
- Your Frappe session has timed out
- Log out and log in again

### "API error" on save/submit
- The error message comes from Frappe's validation
- Check that all required fields are filled
- Ensure the item has batch tracking enabled

### Login works but no SRTs appear
- Check that the user has the correct roles (Srt User, Srt Admin, etc.) assigned in Frappe

### CORS errors in browser console
- Double-check `allow_cors` in `site_config.json`
- Restart bench after config changes

---

## File Structure

```
APPSCRIPT WEB APP/
  Code.gs           ← Entry point: doGet(), include(), config
  Auth.gs           ← Login/logout/session check
  FrappeProxy.gs    ← All Frappe API proxy calls (17 endpoints)
  index.html        ← HTML shell (pages, nav, modal, toast)
  styles.html       ← Mobile-first CSS (no external deps except Inter font)
  script.html       ← SPA JavaScript (login, dashboard, form, history, view)
  SETUP.md          ← This file
  INSTRUCTIONS.MD   ← Original requirements
```

---

## Updating the App

After making changes:
1. Edit files in the GAS editor
2. Click **Deploy** > **Manage deployments**
3. Click the pencil icon on your deployment
4. Change **Version** to "New version"
5. Add a description
6. Click **Deploy**

Users will get the new version on their next page load (no cache issues — GAS handles this).

---

## Security Notes

- Frappe session cookies are stored server-side in Google's UserProperties (per-user, isolated)
- No credentials are stored in the browser — only the Google session manages access
- The GAS server acts as a proxy: browser → GAS → Frappe → response
- All validation runs on the Frappe server — the web app cannot bypass DocType controllers
