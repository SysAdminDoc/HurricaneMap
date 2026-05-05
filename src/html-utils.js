// HTML sanitization utilities for safe DOM manipulation.
// Use these to prevent XSS when rendering user data or external content.

/**
 * Escape HTML special characters to prevent injection.
 * Converts: & < > " '
 * Use before inserting user data or external strings into innerHTML/template literals.
 */
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/**
 * Format HURDAT2 storm names consistently across UI and exports.
 * Data is usually uppercase; unnamed/blank records need stable fallback copy.
 */
export function formatStormName(name, { unnamed = 'Unnamed' } = {}) {
  if (name == null) return unnamed;
  const value = String(name).trim();
  if (!value || value.toUpperCase() === 'UNNAMED') return unnamed;
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, c => c.toUpperCase());
}

/**
 * Safely create a text node instead of using innerHTML.
 * Preferred method when you only need to set text content (no HTML).
 */
export function safeSetText(element, text) {
  if (!element) return;
  // Clear existing content and add safe text node
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  if (text) {
    element.appendChild(document.createTextNode(String(text)));
  }
}

/**
 * Safely set innerHTML with escaped content.
 * This is less safe than safeSetText but safer than raw innerHTML with variables.
 */
export function safeSetHtml(element, html) {
  if (!element) return;
  element.innerHTML = html; // Only call after ensuring content is safe
}
