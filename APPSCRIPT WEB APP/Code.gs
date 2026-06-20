/**
 * SRT Web App — Google Apps Script Entry Point
 *
 * FILE: Code.gs (in GAS editor)
 * PURPOSE: Web app serving, HTML include helper, configuration.
 */

// =====================================================================
// CONFIGURATION (OPTIONAL)
// If you want to lock the app to one Frappe site, set the URL below.
// If left blank, users will enter their Frappe site URL on the login
// page (like the Raven app).
// Must include https:// and NO trailing slash.
// Example: 'https://erp.chaizup.in'
// =====================================================================
const FRAPPE_URL = 'erp.chaizup.in';  // <-- Optional: set to lock to one site

// =====================================================================
// Entry point
// =====================================================================

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'index';
  const template = HtmlService.createTemplateFromFile('index');
  return template
    .evaluate()
    .setTitle('SRT - Stock Reconciliation')
    .addMetaTag('viewport',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Include helper — lets index.html pull in separate CSS/JS files:
 *   <?!= include('styles') ?>
 *   <?!= include('script') ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Returns the Frappe URL.
 * Priority: FRAPPE_URL constant > per-user stored URL > script property.
 * When all empty, login page will ask the user for it.
 *
 * Always normalizes to https://… with no trailing slash. Without the
 * scheme, UrlFetchApp issues a plain HTTP request, Frappe 301s to HTTPS,
 * and (since followRedirects is false on login) we get an empty response
 * with no sid cookie → "No session received — check Frappe URL".
 */
function _normalizeUrl(u) {
  if (!u) return '';
  u = String(u).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function getFrappeUrl() {
  if (FRAPPE_URL) return _normalizeUrl(FRAPPE_URL);
  // UserProperties is unsafe under "Execute as: Me" — it would cross
  // between visitors. The per-session URL lives in the session bucket
  // (see FrappeProxy.gs _readSession).
  const scriptUrl = PropertiesService.getScriptProperties().getProperty('FRAPPE_URL');
  if (scriptUrl) return _normalizeUrl(scriptUrl);
  return '';  // empty = login page will prompt (loginWithUrl)
}

/**
 * Check if a Frappe URL is pre-configured (constant or script property).
 * If yes, the login page hides the URL field.
 */
function isUrlLocked() {
  return !!(FRAPPE_URL ||
    PropertiesService.getScriptProperties().getProperty('FRAPPE_URL'));
}
