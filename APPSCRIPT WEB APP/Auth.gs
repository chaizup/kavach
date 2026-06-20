/**
 * SRT Web App — Authentication
 *
 * FILE: Auth.gs (in GAS editor)
 * PURPOSE: Login / logout / session check against Frappe backend.
 *
 * Each browser session gets a UUID sessionKey (stored client-side in
 * localStorage). The Frappe sid for that key lives in the session store
 * managed by FrappeProxy.gs (_readSession / _writeSession / _deleteSession).
 *
 * The web app is deployed "Execute as: Me" so PropertiesService.User
 * would cross-pollute between visitors — that's why we route everything
 * through the sessionKey-keyed store instead.
 */

/**
 * Pull a non-Guest sid out of UrlFetchApp response headers.
 * Frappe may set 'Set-Cookie' or (rarely) 'set-cookie', and the value
 * may be a single string or an array.
 */
function _extractSid(resp) {
  const headers = resp.getAllHeaders() || {};
  let raw = headers['Set-Cookie'];
  if (!raw) raw = headers['set-cookie'];
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const m = String(c).match(/sid=([^;]+)/);
    if (m && m[1] && m[1] !== 'Guest') return m[1];
  }
  return '';
}

/**
 * Log in to Frappe with email + password using the FRAPPE_URL configured
 * in Code.gs. Returns a sessionKey the client must store and pass back
 * as the first arg to every subsequent server call.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ success:boolean, error?:string, sessionKey?:string,
 *             email?:string, fullName?:string, roles?:string[] }}
 */
function login(email, password) {
  const base = getFrappeUrl();
  if (!base) {
    return { success: false, error: 'FRAPPE_URL is not configured in Code.gs' };
  }

  // --- Step 1: POST /api/method/login ---
  // followRedirects: false so we can read the Set-Cookie on the 200/302
  // ourselves. If Frappe answers with a redirect (e.g. http→https or a
  // trailing-slash normalization), retry once following it.
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
    try {
      const body = JSON.parse(loginResp.getContentText());
      msg = body.message || msg;
    } catch (_) {}
    return { success: false, error: msg };
  }

  // --- Step 2: extract sid cookie ---
  const sid = _extractSid(loginResp);
  if (!sid) {
    return {
      success: false,
      error: 'No session cookie returned by ' + base +
             ' (HTTP ' + code + '). Confirm FRAPPE_URL points to your Frappe site.',
    };
  }

  // --- Step 3: open a session bucket so the helper calls below can
  // route through _frappeGet/_frappePost with the new sid.
  _sweepExpiredSessions();
  const sessionKey = Utilities.getUuid();
  _writeSession(sessionKey, {
    frappe_url:   base,
    frappe_sid:   sid,
    frappe_email: email,
    // Bind to the Google identity from "User accessing the web app".
    // _readSession will reject any other Google user that presents this
    // sessionKey, so a leaked key cannot be replayed across accounts.
    google_user:  _currentGoogleUser(),
  });

  // --- Step 4: get logged-in user email ---
  const userResp = _frappeGet(sessionKey, '/api/method/frappe.auth.get_logged_user', {});
  const confirmedEmail = (userResp.message || email);

  // --- Step 5: get full name ---
  let fullName = '';
  try {
    const nameResp = _frappeGet(sessionKey,
      '/api/resource/User/' + encodeURIComponent(confirmedEmail),
      { fields: '["full_name"]' });
    fullName = (nameResp.data || {}).full_name || '';
  } catch (_) {}

  // --- Step 6: get roles (via form meta — includes SRT-specific roles) ---
  let roles = [];
  try {
    const meta = _frappePost(sessionKey,
      '/api/method/kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_form_meta',
      {});
    roles = (meta.message || {}).user_roles || [];
  } catch (_) {
    // Fall back to generic roles endpoint
    try {
      const rolesResp = _frappeGet(sessionKey, '/api/method/frappe.client.get_list', {
        doctype: 'Has Role',
        filters: JSON.stringify([['parent', '=', confirmedEmail]]),
        fields: '["role"]',
        limit_page_length: 100,
      });
      roles = ((rolesResp.message || rolesResp.data) || []).map(r => r.role);
    } catch (_2) {}
  }

  // --- Step 7: re-read session (in case sid rotated during steps 4-6)
  // and enrich with user metadata before returning. Fallback re-includes
  // google_user so the binding survives even if the record was reaped.
  const enriched = _readSession(sessionKey) || {
    frappe_url: base, frappe_sid: sid, google_user: _currentGoogleUser(),
  };
  enriched.frappe_email     = confirmedEmail;
  enriched.frappe_full_name = fullName;
  enriched.frappe_roles     = roles;
  _writeSession(sessionKey, enriched);

  return {
    success:    true,
    sessionKey: sessionKey,
    email:      confirmedEmail,
    fullName:   fullName,
    roles:      roles,
  };
}

/**
 * Check if the supplied sessionKey still corresponds to a valid Frappe
 * session. Returns user info if yes, { loggedIn: false } otherwise.
 *
 * @param {string} sessionKey  UUID returned by login()
 */
function checkSession(sessionKey) {
  if (!sessionKey) return { loggedIn: false };
  const session = _readSession(sessionKey);
  if (!session || !session.frappe_sid) return { loggedIn: false };

  try {
    const resp = _frappeGet(sessionKey, '/api/method/frappe.auth.get_logged_user', {});
    if (resp.message && resp.message !== 'Guest') {
      return {
        loggedIn: true,
        email:    resp.message,
        fullName: session.frappe_full_name || '',
        roles:    session.frappe_roles || [],
      };
    }
  } catch (_) {
    // SESSION_EXPIRED — fall through.
  }

  _deleteSession(sessionKey);
  return { loggedIn: false };
}

/**
 * Log out — best-effort Frappe logout + clear the server-side session
 * record. Client clears its localStorage entry independently.
 */
function logout(sessionKey) {
  if (!sessionKey) return { success: true };
  const session = _readSession(sessionKey);
  if (session && session.frappe_sid) {
    try { _frappeGet(sessionKey, '/api/method/logout', {}); } catch (_) {}
  }
  _deleteSession(sessionKey);
  return { success: true };
}
