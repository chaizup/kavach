/**
 * SRT Web App — Frappe API Proxy (per-user session via sessionKey)
 *
 * FILE: FrappeProxy.gs (in GAS editor)
 *
 * WHY THIS LOOKS DIFFERENT FROM PropertiesService-based GAS code:
 *   The web app is deployed "Execute as: Me", so PropertiesService.User
 *   is keyed to the script owner — every visitor would share one bucket
 *   and overwrite each other's sid. Instead each browser session gets a
 *   UUID sessionKey (stored client-side in localStorage). The server
 *   keeps the Frappe sid in a per-session record in ScriptProperties
 *   (durable) mirrored to CacheService (fast).
 *
 * PATTERN:
 *   Client JS  -->  google.script.run.getDashboardRows(sessionKey, tab)
 *                       |
 *                       v
 *   FrappeProxy.gs  -->  _frappePost(sessionKey, '/api/method/...', {tab})
 *                       |
 *                       v
 *   Frappe server   -->  kavach.srt_dashboard.get_dashboard_rows
 */

// ═════════════════════════════════════════════════════════════════
// SESSION STORE
// ═════════════════════════════════════════════════════════════════

const SESSION_TTL_MS  = 24 * 60 * 60 * 1000;  // 24h sliding window
const SESSION_CACHE_S = 21600;                // 6h (CacheService max)
const SESSION_PREFIX  = 'srt_sess_';

function _sessionKeyOf(sessionKey) {
  return SESSION_PREFIX + sessionKey;
}

/**
 * Returns the Google identity of the current visitor (set by the
 * "Execute as: User accessing the web app" deployment). Empty string
 * is possible if the visitor's Google session isn't readable for any
 * reason — we treat that as "no binding" and let the session through,
 * but only if the stored record also has no binding.
 */
function _currentGoogleUser() {
  try { return (Session.getActiveUser().getEmail() || '').toLowerCase(); }
  catch (_) { return ''; }
}

function _readSession(sessionKey) {
  if (!sessionKey) return null;
  const k = _sessionKeyOf(sessionKey);

  // Hot path — CacheService is fast but evictable.
  const cache = CacheService.getScriptCache();
  let raw = cache.get(k);
  let fromCache = !!raw;

  // Cold path — ScriptProperties is durable.
  if (!raw) {
    raw = PropertiesService.getScriptProperties().getProperty(k);
  }
  if (!raw) return null;

  let data;
  try { data = JSON.parse(raw); } catch (_) { return null; }
  if (!data || !data.frappe_sid) return null;

  if (data.expires_at && Date.now() > data.expires_at) {
    _deleteSession(sessionKey);
    return null;
  }

  // Google-identity binding: a session record is usable only by the
  // Google account that created it. If the stored record was bound to
  // a Google user (it always is under "User accessing the web app")
  // and the current visitor is someone else, refuse — and DON'T delete
  // the record (the rightful owner may still be using it).
  const bound = (data.google_user || '').toLowerCase();
  const current = _currentGoogleUser();
  if (bound && bound !== current) return null;

  // Repopulate cache if we read from properties.
  if (!fromCache) {
    try { cache.put(k, raw, SESSION_CACHE_S); } catch (_) {}
  }
  return data;
}

function _writeSession(sessionKey, data) {
  data.expires_at = Date.now() + SESSION_TTL_MS;
  const json = JSON.stringify(data);
  const k = _sessionKeyOf(sessionKey);
  // Durable first, then mirror to cache.
  PropertiesService.getScriptProperties().setProperty(k, json);
  try { CacheService.getScriptCache().put(k, json, SESSION_CACHE_S); } catch (_) {}
}

function _deleteSession(sessionKey) {
  if (!sessionKey) return;
  const k = _sessionKeyOf(sessionKey);
  try { PropertiesService.getScriptProperties().deleteProperty(k); } catch (_) {}
  try { CacheService.getScriptCache().remove(k); } catch (_) {}
}

function _getSession(sessionKey) {
  const s = _readSession(sessionKey);
  if (!s) throw new Error('SESSION_EXPIRED');
  return s;
}

/**
 * Lazy GC of expired session records. Cheap to call (one ScriptProperties
 * read of the key list) so do it on every login.
 */
function _sweepExpiredSessions() {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const now = Date.now();
    for (const k in all) {
      if (k.indexOf(SESSION_PREFIX) !== 0) continue;
      try {
        const v = JSON.parse(all[k]);
        if (!v || !v.expires_at || v.expires_at < now) {
          props.deleteProperty(k);
        }
      } catch (_) {
        props.deleteProperty(k);
      }
    }
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════
// SID ROTATION
// ═════════════════════════════════════════════════════════════════

/**
 * Frappe rotates the sid cookie on roughly every request. Persist the
 * new sid so the next call doesn't drift into a 403. Always re-read the
 * session before writing in case another in-flight call already rotated
 * it (last-write-wins; both rotated sids are valid for a short window so
 * either ends up fine).
 */
function _captureRotatedSid(resp, sessionKey, currentSid) {
  try {
    const headers = resp.getAllHeaders() || {};
    let cookies = headers['Set-Cookie'] || headers['set-cookie'];
    if (!cookies) return;
    if (!Array.isArray(cookies)) cookies = [cookies];
    for (const c of cookies) {
      const m = String(c).match(/sid=([^;]+)/);
      if (m && m[1] && m[1] !== 'Guest' && m[1] !== currentSid) {
        const fresh = _readSession(sessionKey);
        if (!fresh) return;
        fresh.frappe_sid = m[1];
        _writeSession(sessionKey, fresh);
        return;
      }
    }
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═════════════════════════════════════════════════════════════════

function _frappeGet(sessionKey, path, params) {
  const session = _getSession(sessionKey);
  const base = session.frappe_url + path;
  const qs = Object.entries(params || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  const url = qs ? base + '?' + qs : base;

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'Cookie': 'sid=' + session.frappe_sid, 'Accept': 'application/json' },
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    _deleteSession(sessionKey);
    throw new Error('SESSION_EXPIRED');
  }
  _captureRotatedSid(resp, sessionKey, session.frappe_sid);
  return JSON.parse(resp.getContentText());
}

function _frappePost(sessionKey, path, data) {
  let session = _getSession(sessionKey);
  const url = session.frappe_url + path;

  // Fetch CSRF token. _frappeGet may rotate the sid in storage — re-read
  // session before issuing the POST so we use the freshest sid and don't
  // drift into a 403.
  let csrf = '';
  try {
    const csrfResp = _frappeGet(sessionKey, '/api/method/frappe.auth.get_csrf_token', {});
    csrf = csrfResp.message || '';
    session = _getSession(sessionKey);
  } catch (_) {}

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Cookie': 'sid=' + session.frappe_sid,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Frappe-CSRF-Token': csrf,
    },
    payload: JSON.stringify(data || {}),
    muteHttpExceptions: true,
  });

  const code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    _deleteSession(sessionKey);
    throw new Error('SESSION_EXPIRED');
  }
  _captureRotatedSid(resp, sessionKey, session.frappe_sid);

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
// LOGIN (user-supplied Frappe URL path)
// ═════════════════════════════════════════════════════════════════

/**
 * Login with user-provided Frappe site URL + credentials.
 * Returns a sessionKey the client must store in localStorage and pass
 * back as the first arg to every subsequent server call.
 */
function loginWithUrl(frappeUrl, email, password) {
  frappeUrl = (frappeUrl || '').trim().replace(/\/+$/, '');
  if (!frappeUrl) return { success: false, error: 'Frappe site URL is required' };
  if (!/^https?:\/\//i.test(frappeUrl)) frappeUrl = 'https://' + frappeUrl;

  const base = frappeUrl;

  let loginResp = UrlFetchApp.fetch(base + '/api/method/login', {
    method: 'post',
    payload: { usr: email, pwd: password },
    followRedirects: false,
    muteHttpExceptions: true,
  });

  let code = loginResp.getResponseCode();

  if (code >= 300 && code < 400) {
    const headers = loginResp.getAllHeaders() || {};
    const loc = headers['Location'] || headers['location'];
    if (loc) {
      loginResp = UrlFetchApp.fetch(loc, {
        method: 'post',
        payload: { usr: email, pwd: password },
        followRedirects: false,
        muteHttpExceptions: true,
      });
      code = loginResp.getResponseCode();
    }
  }

  if (code === 401 || code === 403) {
    return { success: false, error: 'Invalid email or password' };
  }
  if (code >= 400) {
    let msg = 'Login failed (HTTP ' + code + ')';
    try { msg = JSON.parse(loginResp.getContentText()).message || msg; } catch(_){}
    return { success: false, error: msg };
  }

  const sid = _extractSid(loginResp);
  if (!sid) {
    return {
      success: false,
      error: 'No session cookie returned by ' + base +
             ' (HTTP ' + code + '). Check the site URL is your Frappe instance.',
    };
  }

  _sweepExpiredSessions();
  const sessionKey = Utilities.getUuid();
  _writeSession(sessionKey, {
    frappe_url:   base,
    frappe_sid:   sid,
    frappe_email: email,
    // Bind to the visitor's Google identity so a leaked sessionKey
    // can't be replayed by a different Google account.
    google_user:  _currentGoogleUser(),
  });

  // Confirm logged-in user
  const userResp = _frappeGet(sessionKey, '/api/method/frappe.auth.get_logged_user', {});
  const confirmedEmail = userResp.message || email;

  let fullName = '';
  try {
    const nr = _frappeGet(sessionKey, '/api/resource/User/' + encodeURIComponent(confirmedEmail),
      { fields: '["full_name"]' });
    fullName = (nr.data || {}).full_name || '';
  } catch(_) {}

  let roles = [];
  try {
    const meta = _frappePost(sessionKey,
      '/api/method/kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_form_meta', {});
    roles = (meta.message || {}).user_roles || [];
  } catch(_) {}

  // Re-read in case rotation already updated frappe_sid, then enrich.
  // Fallback re-includes google_user so the binding survives if the
  // record was reaped between steps.
  const enriched = _readSession(sessionKey) || {
    frappe_url: base, frappe_sid: sid, frappe_email: confirmedEmail,
    google_user: _currentGoogleUser(),
  };
  enriched.frappe_email     = confirmedEmail;
  enriched.frappe_full_name = fullName;
  enriched.frappe_roles     = roles;
  _writeSession(sessionKey, enriched);

  return { success: true, sessionKey: sessionKey,
           email: confirmedEmail, fullName: fullName, roles: roles };
}


// ═════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════

const SRT_DASH = 'kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard';

function getDashboardRows(sessionKey, tab, itemFilter) {
  const args = { tab: tab };
  if (itemFilter) args.item_filter = itemFilter;
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.get_dashboard_rows', args).message;
}

function getDashboardCounts(sessionKey) {
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.get_dashboard_counts', {}).message;
}

function getBatchSummary(sessionKey, srtName) {
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.get_batch_summary',
    { srt_name: srtName }).message;
}

function getBatchDrilldown(sessionKey, itemCode, warehouse, batchNo, fromDate, toDate) {
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.get_batch_drilldown', {
    item_code: itemCode, warehouse: warehouse, batch_no: batchNo,
    from_date: fromDate, to_date: toDate,
  }).message;
}


// ═════════════════════════════════════════════════════════════════
// FORM CRUD
// ═════════════════════════════════════════════════════════════════

function getFormMeta(sessionKey) {
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.get_form_meta', {}).message;
}

function loadSrtForm(sessionKey, name) {
  const args = {};
  if (name) args.name = name;
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.load_srt_form', args).message;
}

/**
 * Read-only fetch of any SRT doc (any docstatus).
 * Used by the View modal — load_srt_form only allows Draft docs.
 */
function getSrtDoc(sessionKey, name) {
  const result = _frappePost(sessionKey, '/api/method/frappe.client.get', {
    doctype: 'Stock Reconciliation SRT',
    name: name,
  });
  return result.message || {};
}

function saveSrtForm(sessionKey, payload, name) {
  const args = { payload: JSON.stringify(payload) };
  if (name) args.name = name;
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.save_srt_form', args).message;
}

function submitSrtForm(sessionKey, name) {
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.submit_srt_form',
    { name: name }).message;
}


// ═════════════════════════════════════════════════════════════════
// WORKFLOW ACTIONS
// ═════════════════════════════════════════════════════════════════

function approveSrt(sessionKey, srtName, remark) {
  const args = { srt_name: srtName };
  if (remark) args.remark = remark;
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.approve_srt', args).message;
}

function rejectSrt(sessionKey, srtName, reason) {
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.reject_srt',
    { srt_name: srtName, reason: reason }).message;
}

function bulkApproveSrt(sessionKey, srtNames, bulkRemark) {
  const args = { srt_names: JSON.stringify(srtNames) };
  if (bulkRemark) args.bulk_remark = bulkRemark;
  return _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.bulk_approve_srt', args).message;
}

function bulkRejectSrt(sessionKey, srtNames, reason) {
  const results = [];
  for (const name of (srtNames || [])) {
    try {
      _frappePost(sessionKey, '/api/method/' + SRT_DASH + '.reject_srt',
        { srt_name: name, reason: reason });
      results.push({ name: name, ok: true });
    } catch (e) {
      results.push({ name: name, ok: false, error: e.message || String(e) });
    }
  }
  return results;
}


// ═════════════════════════════════════════════════════════════════
// ITEM / WAREHOUSE / BATCH — PRE-LOADED LISTS (CacheService)
// ═════════════════════════════════════════════════════════════════

const SRT_API = 'kavach.stock_reconciliation_tracking.api';
const CACHE_TTL = 3600; // 1 hour

/**
 * Item/Warehouse/Batch caches are keyed per Frappe site so multi-tenant
 * deployments (different orgs hitting the same web app) don't leak data.
 */
function _sitePrefix(sessionKey) {
  const session = _getSession(sessionKey);
  return Utilities.base64EncodeWebSafe(session.frappe_url).substring(0, 12);
}

function getAllItems(sessionKey) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'srt_items_' + _sitePrefix(sessionKey);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
    doctype: 'Item',
    filters: { has_batch_no: 1, disabled: 0 },
    fields: ['name', 'item_name'],
    limit_page_length: 0,
    order_by: 'name asc',
  });
  const items = result.message || [];
  try { cache.put(cacheKey, JSON.stringify(items), CACHE_TTL); } catch(_) {}
  return items;
}

function getAllWarehouses(sessionKey) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'srt_whs_' + _sitePrefix(sessionKey);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
    doctype: 'Warehouse',
    filters: { is_group: 0 },
    fields: ['name'],
    limit_page_length: 0,
    order_by: 'name asc',
  });
  const whs = result.message || [];
  try { cache.put(cacheKey, JSON.stringify(whs), CACHE_TTL); } catch(_) {}
  return whs;
}

function getAllBatchesForItem(sessionKey, itemCode) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'srt_batches_' + _sitePrefix(sessionKey) + '_' + itemCode;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
    doctype: 'Batch',
    filters: { item: itemCode, disabled: 0 },
    fields: ['name', 'item', 'expiry_date'],
    limit_page_length: 0,
    order_by: 'name asc',
  });
  const batches = result.message || [];
  try { cache.put(cacheKey, JSON.stringify(batches), CACHE_TTL); } catch(_) {}
  return batches;
}

function getItemDefaults(sessionKey, itemCode, warehouse, postingDate, postingTime) {
  const args = { item_code: itemCode };
  if (warehouse)   args.warehouse    = warehouse;
  if (postingDate) args.posting_date = postingDate;
  if (postingTime) args.posting_time = postingTime;
  return _frappePost(sessionKey, '/api/method/' + SRT_API + '.get_item_defaults', args).message;
}

// Legacy search functions — kept for backward compat. Client uses local search.
function searchItems(sessionKey, txt) {
  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
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

function searchWarehouses(sessionKey, txt) {
  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
    doctype: 'Warehouse',
    filters: { is_group: 0 },
    or_filters: [
      ['name', 'like', '%' + (txt || '') + '%'],
    ],
    fields: ['name'],
    limit_page_length: 20,
    order_by: 'name asc',
  });
  return result.message || [];
}

function getBatchCurrentState(sessionKey, itemCode, batchNo, postingDate, postingTime) {
  const args = { item_code: itemCode, batch_no: batchNo };
  if (postingDate) args.posting_date = postingDate;
  if (postingTime) args.posting_time = postingTime;
  return _frappePost(sessionKey, '/api/method/' + SRT_API + '.get_batch_current_state', args).message;
}


// ═════════════════════════════════════════════════════════════════
// HISTORY (user's past SRTs)
// ═════════════════════════════════════════════════════════════════

function getSrtHistory(sessionKey, pageLength, start) {
  const session = _getSession(sessionKey);
  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
    doctype: 'Stock Reconciliation SRT',
    filters: { owner: session.frappe_email || '' },
    fields: ['name','item','item_name','workflow_state','posting_date','default_warehouse','docstatus','creation','owner'],
    order_by: 'creation desc',
    limit_page_length: pageLength || 50,
    limit_start: start || 0,
  });
  return result.message || [];
}

function getAllSrtHistory(sessionKey, pageLength, start) {
  const result = _frappePost(sessionKey, '/api/method/frappe.client.get_list', {
    doctype: 'Stock Reconciliation SRT',
    fields: ['name','item','item_name','workflow_state','posting_date','default_warehouse','docstatus','creation','owner'],
    order_by: 'creation desc',
    limit_page_length: pageLength || 50,
    limit_start: start || 0,
  });
  return result.message || [];
}
