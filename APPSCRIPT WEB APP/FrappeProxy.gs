/**
 * SRT Web App — Frappe API Proxy
 *
 * FILE: FrappeProxy.gs (in GAS editor)
 * PURPOSE: All Frappe API calls, routed through the sid cookie
 *          stored by Auth.gs. Client JS calls these via
 *          google.script.run.<functionName>().
 *
 * PATTERN:
 *   Client JS  -->  google.script.run.getDashboardRows(tab)
 *                       |
 *                       v
 *   FrappeProxy.gs  -->  _frappePost('/api/method/kavach...', {tab})
 *                       |
 *                       v
 *   Frappe server   -->  kavach.srt_dashboard.get_dashboard_rows
 */

// ═════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═════════════════════════════════════════════════════════════════

function _getSid() {
  const sid = PropertiesService.getUserProperties().getProperty('frappe_sid');
  if (!sid) throw new Error('SESSION_EXPIRED');
  return sid;
}

function _getUserFrappeUrl() {
  // User-entered URL (stored at login time)
  const url = PropertiesService.getUserProperties().getProperty('frappe_url');
  if (url) return url.replace(/\/+$/, '');
  // Fallback to global config
  return getFrappeUrl();
}

function _frappeGet(path, params, sid) {
  sid = sid || _getSid();
  const base = _getUserFrappeUrl() + path;
  const qs = Object.entries(params || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  const url = qs ? base + '?' + qs : base;

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'Cookie': 'sid=' + sid, 'Accept': 'application/json' },
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 401 || code === 403) throw new Error('SESSION_EXPIRED');
  return JSON.parse(resp.getContentText());
}

function _frappePost(path, data, sid) {
  sid = sid || _getSid();
  const url = _getUserFrappeUrl() + path;

  // Get CSRF token (required for Frappe POST requests)
  let csrf = '';
  try {
    const csrfResp = _frappeGet(
      '/api/method/frappe.auth.get_csrf_token', {}, sid
    );
    csrf = csrfResp.message || '';
  } catch (_) {}

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Cookie': 'sid=' + sid,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Frappe-CSRF-Token': csrf,
    },
    payload: JSON.stringify(data || {}),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 401 || code === 403) throw new Error('SESSION_EXPIRED');

  const body = JSON.parse(resp.getContentText());
  if (code >= 400) {
    let errMsg = 'API error (' + code + ')';
    if (body._server_messages) {
      try {
        const msgs = JSON.parse(body._server_messages);
        errMsg = msgs.map(m => {
          try { return JSON.parse(m).message; } catch(_) { return m; }
        }).join('\n');
      } catch (_) { errMsg = body._server_messages; }
    } else if (body.message) {
      errMsg = body.message;
    } else if (body.exc) {
      errMsg = 'Server error — check Frappe logs';
    }
    throw new Error(errMsg);
  }

  return body;
}


// ═════════════════════════════════════════════════════════════════
// LOGIN (with user-supplied Frappe URL)
// ═════════════════════════════════════════════════════════════════

/**
 * Login with user-provided Frappe site URL + credentials.
 * Stores the Frappe URL per-user so each user can point to their site.
 */
function loginWithUrl(frappeUrl, email, password) {
  // Normalize and store the URL
  frappeUrl = (frappeUrl || '').replace(/\/+$/, '');
  if (!frappeUrl) return { success: false, error: 'Frappe site URL is required' };
  if (!frappeUrl.startsWith('http')) frappeUrl = 'https://' + frappeUrl;

  PropertiesService.getUserProperties().setProperty('frappe_url', frappeUrl);

  // Now call the standard login (Auth.gs) but override getFrappeUrl
  const base = frappeUrl;

  const loginResp = UrlFetchApp.fetch(base + '/api/method/login', {
    method: 'post',
    payload: { usr: email, pwd: password },
    followRedirects: false,
    muteHttpExceptions: true,
  });

  const code = loginResp.getResponseCode();
  if (code === 401 || code === 403) {
    return { success: false, error: 'Invalid email or password' };
  }
  if (code >= 400) {
    let msg = 'Login failed (HTTP ' + code + ')';
    try { msg = JSON.parse(loginResp.getContentText()).message || msg; } catch(_){}
    return { success: false, error: msg };
  }

  // Extract sid
  const rawCookies = loginResp.getAllHeaders()['Set-Cookie'] || [];
  const cookieArr = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
  let sid = '';
  for (const c of cookieArr) {
    const m = c.match(/sid=([^;]+)/);
    if (m && m[1] !== 'Guest') { sid = m[1]; break; }
  }
  if (!sid) return { success: false, error: 'Could not connect — check the site URL' };

  // Get user info
  const userResp = _frappeGet('/api/method/frappe.auth.get_logged_user', {}, sid);
  const confirmedEmail = userResp.message || email;

  let fullName = '';
  try {
    const nr = _frappeGet('/api/resource/User/' + encodeURIComponent(confirmedEmail),
      { fields: '["full_name"]' }, sid);
    fullName = (nr.data || {}).full_name || '';
  } catch(_) {}

  // Get roles
  let roles = [];
  try {
    const meta = _frappePost(
      '/api/method/kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_form_meta',
      {}, sid
    );
    roles = (meta.message || {}).user_roles || [];
  } catch(_) {}

  PropertiesService.getUserProperties().setProperties({
    frappe_url:       frappeUrl,
    frappe_sid:       sid,
    frappe_email:     confirmedEmail,
    frappe_full_name: fullName,
    frappe_roles:     JSON.stringify(roles),
  });

  return { success: true, email: confirmedEmail, fullName: fullName, roles: roles };
}


// ═════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════

const SRT_DASH = 'kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard';

function getDashboardRows(tab, itemFilter) {
  const args = { tab: tab };
  if (itemFilter) args.item_filter = itemFilter;
  return _frappePost('/api/method/' + SRT_DASH + '.get_dashboard_rows', args).message;
}

function getDashboardCounts() {
  return _frappePost('/api/method/' + SRT_DASH + '.get_dashboard_counts', {}).message;
}

function getBatchSummary(srtName) {
  return _frappePost('/api/method/' + SRT_DASH + '.get_batch_summary',
    { srt_name: srtName }).message;
}

function getBatchDrilldown(itemCode, warehouse, batchNo, fromDate, toDate) {
  return _frappePost('/api/method/' + SRT_DASH + '.get_batch_drilldown', {
    item_code: itemCode, warehouse: warehouse, batch_no: batchNo,
    from_date: fromDate, to_date: toDate,
  }).message;
}


// ═════════════════════════════════════════════════════════════════
// FORM CRUD
// ═════════════════════════════════════════════════════════════════

function getFormMeta() {
  return _frappePost('/api/method/' + SRT_DASH + '.get_form_meta', {}).message;
}

function loadSrtForm(name) {
  const args = {};
  if (name) args.name = name;
  return _frappePost('/api/method/' + SRT_DASH + '.load_srt_form', args).message;
}

function saveSrtForm(payload, name) {
  const args = { payload: JSON.stringify(payload) };
  if (name) args.name = name;
  return _frappePost('/api/method/' + SRT_DASH + '.save_srt_form', args).message;
}

function submitSrtForm(name) {
  return _frappePost('/api/method/' + SRT_DASH + '.submit_srt_form',
    { name: name }).message;
}


// ═════════════════════════════════════════════════════════════════
// WORKFLOW ACTIONS
// ═════════════════════════════════════════════════════════════════

function approveSrt(srtName, remark) {
  const args = { srt_name: srtName };
  if (remark) args.remark = remark;
  return _frappePost('/api/method/' + SRT_DASH + '.approve_srt', args).message;
}

function rejectSrt(srtName, reason) {
  return _frappePost('/api/method/' + SRT_DASH + '.reject_srt',
    { srt_name: srtName, reason: reason }).message;
}

function bulkApproveSrt(srtNames, bulkRemark) {
  const args = { srt_names: JSON.stringify(srtNames) };
  if (bulkRemark) args.bulk_remark = bulkRemark;
  return _frappePost('/api/method/' + SRT_DASH + '.bulk_approve_srt', args).message;
}


// ═════════════════════════════════════════════════════════════════
// ITEM / WAREHOUSE SEARCH (for form autocomplete)
// ═════════════════════════════════════════════════════════════════

const SRT_API = 'kavach.stock_reconciliation_tracking.api';

function getItemDefaults(itemCode, warehouse, postingDate, postingTime) {
  const args = { item_code: itemCode };
  if (warehouse)   args.warehouse    = warehouse;
  if (postingDate) args.posting_date = postingDate;
  if (postingTime) args.posting_time = postingTime;
  return _frappePost('/api/method/' + SRT_API + '.get_item_defaults', args).message;
}

function searchItems(txt) {
  // Use frappe.client.get_list via POST — the REST /api/resource/ endpoint
  // doesn't reliably handle or_filters as URL parameters.
  const result = _frappePost('/api/method/frappe.client.get_list', {
    doctype: 'Item',
    filters: { has_batch_no: 1 },
    or_filters: [
      ['name', 'like', '%' + (txt || '') + '%'],
      ['item_name', 'like', '%' + (txt || '') + '%'],
    ],
    fields: ['name', 'item_name'],
    limit_page_length: 20,
    order_by: 'name asc',
  });
  return result.message || [];
}

function searchWarehouses(txt) {
  const result = _frappePost('/api/method/frappe.client.get_list', {
    doctype: 'Warehouse',
    filters: {
      is_group: 0,
    },
    or_filters: [
      ['name', 'like', '%' + (txt || '') + '%'],
    ],
    fields: ['name'],
    limit_page_length: 20,
    order_by: 'name asc',
  });
  return result.message || [];
}


// ═════════════════════════════════════════════════════════════════
// HISTORY (user's past SRTs)
// ═════════════════════════════════════════════════════════════════

function getSrtHistory(pageLength, start) {
  const email = PropertiesService.getUserProperties().getProperty('frappe_email');
  const result = _frappePost('/api/method/frappe.client.get_list', {
    doctype: 'Stock Reconciliation SRT',
    filters: { owner: email || '' },
    fields: ['name','item','item_name','workflow_state','posting_date','default_warehouse','docstatus','creation','owner'],
    order_by: 'creation desc',
    limit_page_length: pageLength || 50,
    limit_start: start || 0,
  });
  return result.message || [];
}

function getAllSrtHistory(pageLength, start) {
  const result = _frappePost('/api/method/frappe.client.get_list', {
    doctype: 'Stock Reconciliation SRT',
    fields: ['name','item','item_name','workflow_state','posting_date','default_warehouse','docstatus','creation','owner'],
    order_by: 'creation desc',
    limit_page_length: pageLength || 50,
    limit_start: start || 0,
  });
  return result.message || [];
}
