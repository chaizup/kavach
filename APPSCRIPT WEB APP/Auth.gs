/**
 * SRT Web App — Authentication
 *
 * FILE: Auth.gs (in GAS editor)
 * PURPOSE: Login / logout / session check against Frappe backend.
 *
 * Session cookie (sid) is stored in UserProperties so each Google
 * user gets their own isolated Frappe session.
 */

/**
 * Log in to Frappe with email + password.
 * On success, fetches the user's roles and stores everything.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ success:boolean, error?:string, email?:string, roles?:string[], fullName?:string }}
 */
function login(email, password) {
  const base = getFrappeUrl();

  // --- Step 1: POST /api/method/login ---
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
    try {
      const body = JSON.parse(loginResp.getContentText());
      msg = body.message || msg;
    } catch (_) {}
    return { success: false, error: msg };
  }

  // --- Step 2: extract sid cookie ---
  const rawCookies = loginResp.getAllHeaders()['Set-Cookie'] || [];
  const cookieArr = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
  let sid = '';
  for (const c of cookieArr) {
    const m = c.match(/sid=([^;]+)/);
    if (m && m[1] !== 'Guest') { sid = m[1]; break; }
  }
  if (!sid) {
    return { success: false, error: 'No session received — check Frappe URL' };
  }

  // --- Step 3: get logged-in user email ---
  const userResp = _frappeGet('/api/method/frappe.auth.get_logged_user', {}, sid);
  const confirmedEmail = (userResp.message || email);

  // --- Step 4: get full name ---
  let fullName = '';
  try {
    const nameResp = _frappeGet('/api/resource/User/' + encodeURIComponent(confirmedEmail), {
      fields: '["full_name"]',
    }, sid);
    fullName = (nameResp.data || {}).full_name || '';
  } catch (_) {}

  // --- Step 5: get roles (via form meta — includes SRT-specific roles) ---
  let roles = [];
  try {
    const meta = _frappePost(
      '/api/method/kavach.stock_reconciliation_tracking.page.srt_dashboard.srt_dashboard.get_form_meta',
      {}, sid
    );
    roles = (meta.message || {}).user_roles || [];
  } catch (_) {
    // Fall back to generic roles endpoint
    try {
      const rolesResp = _frappeGet('/api/method/frappe.client.get_list', {
        doctype: 'Has Role',
        filters: JSON.stringify([['parent', '=', confirmedEmail]]),
        fields: '["role"]',
        limit_page_length: 100,
      }, sid);
      roles = ((rolesResp.message || rolesResp.data) || []).map(r => r.role);
    } catch (_2) {}
  }

  // --- Step 6: persist session ---
  PropertiesService.getUserProperties().setProperties({
    frappe_sid:       sid,
    frappe_email:     confirmedEmail,
    frappe_full_name: fullName,
    frappe_roles:     JSON.stringify(roles),
  });

  return {
    success:  true,
    email:    confirmedEmail,
    fullName: fullName,
    roles:    roles,
  };
}

/**
 * Check if the current user has a valid Frappe session.
 * Returns user info if yes, { loggedIn: false } otherwise.
 */
function checkSession() {
  const props = PropertiesService.getUserProperties();
  const sid   = props.getProperty('frappe_sid');
  if (!sid) return { loggedIn: false };

  try {
    const resp = _frappeGet('/api/method/frappe.auth.get_logged_user', {}, sid);
    if (resp.message && resp.message !== 'Guest') {
      return {
        loggedIn: true,
        email:    resp.message,
        fullName: props.getProperty('frappe_full_name') || '',
        roles:    JSON.parse(props.getProperty('frappe_roles') || '[]'),
      };
    }
  } catch (_) { /* session expired */ }

  props.deleteAllProperties();
  return { loggedIn: false };
}

/**
 * Log out — clears Frappe session and local storage.
 */
function logout() {
  const props = PropertiesService.getUserProperties();
  const sid   = props.getProperty('frappe_sid');
  if (sid) {
    try { _frappeGet('/api/method/logout', {}, sid); } catch (_) {}
  }
  props.deleteAllProperties();
  return { success: true };
}
