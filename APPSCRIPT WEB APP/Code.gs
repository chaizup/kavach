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
const FRAPPE_URL = '';  // <-- Optional: set to lock to one site

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
 */
function getFrappeUrl() {
  if (FRAPPE_URL) return FRAPPE_URL.replace(/\/+$/, '');
  const userUrl = PropertiesService.getUserProperties().getProperty('frappe_url');
  if (userUrl) return userUrl.replace(/\/+$/, '');
  const scriptUrl = PropertiesService.getScriptProperties().getProperty('FRAPPE_URL');
  if (scriptUrl) return scriptUrl.replace(/\/+$/, '');
  return '';  // empty = login page will prompt
}

/**
 * Check if a Frappe URL is pre-configured (constant or script property).
 * If yes, the login page hides the URL field.
 */
function isUrlLocked() {
  return !!(FRAPPE_URL ||
    PropertiesService.getScriptProperties().getProperty('FRAPPE_URL'));
}
