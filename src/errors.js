// Global runtime error surface — last-resort visibility for failures that
// escape module-level handling. Shows a rate-limited toast instead of dying
// silently in the console; the browser's own console output carries the detail.
import { t } from './i18n.js';

const REPEAT_WINDOW_MS = 8000;
const TOAST_FLOOR_MS = 1500;
const TOAST_LIFETIME_MS = 4000;

let lastShownAt = 0;
let lastKey = '';

function isNoise(message, source) {
  const msg = String(message || '');
  // Benign, self-recovering browser chatter.
  if (msg.includes('ResizeObserver loop')) return true;
  // Cross-origin/extension scripts surface as an unactionable "Script error."
  if (msg === 'Script error.' && !source) return true;
  return false;
}

function isAbort(reason) {
  return !!reason && (reason.name === 'AbortError' || reason.code === 20);
}

function showErrorToast(msg) {
  let host = document.getElementById('hm-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'hm-toast-host';
    host.className = 'hm-toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'hm-toast hm-toast--warn';
  el.setAttribute('role', 'alert');
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 240);
  }, TOAST_LIFETIME_MS);
}

function surface(detail) {
  const now = Date.now();
  const key = String(detail || '').slice(0, 120);
  // Same failure repeating (e.g. an error loop) gets one toast per window;
  // distinct failures still respect an absolute floor between toasts.
  if (key === lastKey && now - lastShownAt < REPEAT_WINDOW_MS) return;
  if (now - lastShownAt < TOAST_FLOOR_MS) return;
  lastShownAt = now;
  lastKey = key;
  showErrorToast(t('error.unexpected'));
}

export function initGlobalErrorSurface() {
  // Bubble-phase listener: runtime script errors only (resource-load errors
  // such as a missing radar frame do not reach window without capture=true).
  window.addEventListener('error', event => {
    if (isNoise(event.message, event.filename)) return;
    surface(event.message);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    // Aborted fetches are routine cancellation from the async race guards.
    if (isAbort(reason)) return;
    const msg = reason && reason.message ? reason.message : String(reason);
    if (isNoise(msg, 'promise')) return;
    surface(msg);
  });
  window.__hmErrorSurface = true;
}
