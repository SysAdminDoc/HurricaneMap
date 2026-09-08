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
 * Validate an externally supplied URL before assigning it to a DOM href/src.
 * Returns an absolute URL, or an empty string when its protocol or host is not allowed.
 */
export function safeExternalHref(value, { protocols = ['https:', 'http:'], hosts = null } = {}) {
  if (!value) return '';
  try {
    const base = typeof window !== 'undefined' && window.location?.href
      ? window.location.href
      : 'https://example.invalid/';
    const url = new URL(String(value), base);
    if (!protocols.includes(url.protocol)) return '';
    if (hosts && !hosts.map(host => host.toLowerCase()).includes(url.hostname.toLowerCase())) return '';
    return url.href;
  } catch {
    return '';
  }
}

/**
 * Validate and escape an external URL for insertion into a trusted HTML template.
 */
export function safeExternalUrl(value, options) {
  return escapeHtml(safeExternalHref(value, options));
}

// A dozen surfaces render an unnamed storm, and passing the label in at each
// one meant most of them said "Unnamed" in every locale. i18n.js sets this when
// a catalog is applied, which it can do because it already imports this module;
// the dependency the other way would be a cycle. A caller that wants the English
// word regardless, an export written for publication, passes it explicitly.
let unnamedStormLabel = 'Unnamed';

export function setUnnamedStormLabel(label) {
  unnamedStormLabel = label || 'Unnamed';
}

/**
 * Format HURDAT2 storm names consistently across UI and exports.
 * Data is usually uppercase; unnamed/blank records need stable fallback copy.
 */
export function formatStormName(name, { unnamed = unnamedStormLabel } = {}) {
  if (name == null) return unnamed;
  const value = String(name).trim();
  if (!value || value.toUpperCase() === 'UNNAMED') return unnamed;
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, c => c.toUpperCase());
}

