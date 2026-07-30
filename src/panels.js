// Side-panel manager. Every analytical/details surface uses one lane so panels
// never stack or fight for viewport space. Each panel gets shared chrome: a
// minimize button that collapses it to a slim edge tab (keeping the map fully
// visible) and a restore bar to bring it back.
import { t } from './i18n.js';

const PANEL_IDS = ['storm-panel', 'stats-panel', 'compare-panel', 'state-panel', 'on-this-date-panel', 'table-view-panel', 'prep-panel', 'evac-panel', 'spatial-results'];
const PANEL_BUTTONS = {
  'stats-panel': 'toggle-stats',
  'compare-panel': 'toggle-compare',
  'on-this-date-panel': 'toggle-on-this-date',
  'prep-panel': 'toggle-prep',
  'evac-panel': 'toggle-evac',
};
const panelInvokers = new Map();

function getPanel(id) {
  return document.getElementById(id);
}

function panelTitle(el) {
  return el.getAttribute('aria-label') || 'Panel';
}

function normalizedInvoker(candidate) {
  if (!(candidate instanceof HTMLElement)) return null;
  if (candidate.closest('.mobile-actions-menu')) {
    return document.getElementById('toggle-mobile-actions') || candidate;
  }
  return candidate;
}

function isVisibleFocusTarget(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected || element.closest('[hidden], [inert]')) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return !element.matches(':disabled') && style.display !== 'none' && style.visibility !== 'hidden'
    && rect.width > 0 && rect.height > 0;
}

function focusPanelEntry(el) {
  requestAnimationFrame(() => {
    if (!el || el.hidden || el.classList.contains('minimized')) return;
    const labelledBy = el.getAttribute('aria-labelledby');
    const heading = labelledBy ? document.getElementById(labelledBy) : el.querySelector('h1, h2, h3');
    const target = heading || el.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])');
    if (!(target instanceof HTMLElement)) return;
    if (heading === target && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  });
}

function restorePanelInvoker(el) {
  const invoker = panelInvokers.get(el.id);
  panelInvokers.delete(el.id);
  if (!el.contains(document.activeElement)) return null;
  return isVisibleFocusTarget(invoker)
    ? invoker
    : document.getElementById('map');
}

function focusPanelInvoker(target) {
  if (target instanceof HTMLElement) {
    requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }
}

/** Inject shared chrome (minimize button + restore tab) once per panel.
 *  Runs lazily from showPanel so late-created panels (spatial results) are
 *  covered too. */
function ensurePanelChrome(el) {
  if (!el || el.dataset.panelChrome) return;
  el.dataset.panelChrome = '1';
  el.classList.add('side-panel');

  const minBtn = document.createElement('button');
  minBtn.type = 'button';
  minBtn.className = 'panel-min-btn';
  minBtn.title = t('panel.minimize');
  minBtn.setAttribute('aria-label', t('panel.minimizeNamed', panelTitle(el).toLowerCase()));
  minBtn.innerHTML = '<span aria-hidden="true">–</span>';
  minBtn.addEventListener('click', () => minimizePanel(el.id));

  const restoreBar = document.createElement('button');
  restoreBar.type = 'button';
  restoreBar.className = 'panel-restore-bar';
  restoreBar.title = t('panel.restore');
  restoreBar.setAttribute('aria-label', t('panel.restoreNamed', panelTitle(el).toLowerCase()));
  restoreBar.innerHTML = `<span class="panel-restore-icon" aria-hidden="true">❐</span><span class="panel-restore-label"></span>`;
  restoreBar.querySelector('.panel-restore-label').textContent = panelTitle(el);
  restoreBar.addEventListener('click', () => restorePanel(el.id));

  el.prepend(restoreBar);
  el.prepend(minBtn);
}

function setPanelState() {
  // A minimized panel intentionally does NOT count as open: the map lanes
  // (timeline width, zoom controls, season shelf) reclaim the full viewport.
  const anyOpen = PANEL_IDS.some(id => {
    const panel = getPanel(id);
    return panel && !panel.hidden && !panel.classList.contains('minimized');
  });
  document.body.classList.toggle('side-panel-open', anyOpen);
  syncPanelControls();
}

export function minimizePanel(id) {
  const el = getPanel(id);
  if (!el || el.hidden) return;
  el.classList.add('minimized');
  setPanelState();
  requestAnimationFrame(() => el.querySelector('.panel-restore-bar')?.focus({ preventScroll: true }));
}

export function restorePanel(id) {
  const el = getPanel(id);
  if (!el) return;
  el.classList.remove('minimized');
  setPanelState();
  focusPanelEntry(el);
}

/** Close every managed side panel except the named one. Pass null to close all. */
export function closePanelsExcept(keepId = null) {
  let focusTarget = null;
  for (const id of PANEL_IDS) {
    if (id === keepId) continue;
    const el = getPanel(id);
    if (el && !el.hidden) {
      focusTarget = restorePanelInvoker(el) || focusTarget;
      el.hidden = true;
      el.classList.remove('minimized');
      document.dispatchEvent(new CustomEvent('hm-panel:hidden', { detail: { id } }));
    }
  }
  setPanelState();
  return focusTarget;
}

function withTransition(fn, after = null) {
  if (document.startViewTransition) {
    // Rapid open/close skips the previous transition; ALL THREE of its
    // promises (finished, ready, updateCallbackDone) then reject with
    // "Transition was skipped" — each must be caught or it surfaces as an
    // unhandled rejection (ready was the one still escaping).
    const transition = document.startViewTransition(fn);
    transition.finished.catch(() => {}).then(() => after?.());
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
  } else {
    fn();
    after?.();
  }
}

/** Show one side panel and hide all others. */
export function showPanel(id) {
  const invoker = normalizedInvoker(document.activeElement);
  withTransition(() => {
    closePanelsExcept(id);
    const el = getPanel(id);
    if (el) {
      panelInvokers.set(id, invoker);
      ensurePanelChrome(el);
      el.classList.remove('minimized');
      el.hidden = false;
      document.dispatchEvent(new CustomEvent('hm-panel:shown', { detail: { id } }));
      focusPanelEntry(el);
    }
    setPanelState();
  });
}

/** Hide one side panel without reopening any previous surface. */
export function hidePanel(id) {
  let focusTarget = null;
  withTransition(() => {
    const el = getPanel(id);
    if (el && !el.hidden) {
      focusTarget = restorePanelInvoker(el);
      el.hidden = true;
      el.classList.remove('minimized');
      document.dispatchEvent(new CustomEvent('hm-panel:hidden', { detail: { id } }));
    }
    setPanelState();
  }, () => focusPanelInvoker(focusTarget));
}

export function closeAllPanels() {
  focusPanelInvoker(closePanelsExcept(null));
}

export function syncPanelControls() {
  for (const [panelId, buttonId] of Object.entries(PANEL_BUTTONS)) {
    const panel = getPanel(panelId);
    const button = document.getElementById(buttonId);
    if (panel && button) button.setAttribute('aria-pressed', String(!panel.hidden));
  }
}
