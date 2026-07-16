// Side-panel manager. Every analytical/details surface uses one lane so panels
// never stack or fight for viewport space. Each panel gets shared chrome: a
// minimize button that collapses it to a slim edge tab (keeping the map fully
// visible) and a restore bar to bring it back.

const PANEL_IDS = ['storm-panel', 'stats-panel', 'compare-panel', 'state-panel', 'on-this-date-panel', 'table-view-panel', 'prep-panel', 'evac-panel', 'spatial-results'];
const PANEL_BUTTONS = {
  'stats-panel': 'toggle-stats',
  'compare-panel': 'toggle-compare',
  'on-this-date-panel': 'toggle-on-this-date',
  'prep-panel': 'toggle-prep',
  'evac-panel': 'toggle-evac',
};

function getPanel(id) {
  return document.getElementById(id);
}

function panelTitle(el) {
  return el.getAttribute('aria-label') || 'Panel';
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
  minBtn.title = 'Minimize panel — keep it as a tab at the edge of the map';
  minBtn.setAttribute('aria-label', `Minimize ${panelTitle(el).toLowerCase()}`);
  minBtn.innerHTML = '<span aria-hidden="true">–</span>';
  minBtn.addEventListener('click', () => minimizePanel(el.id));

  const restoreBar = document.createElement('button');
  restoreBar.type = 'button';
  restoreBar.className = 'panel-restore-bar';
  restoreBar.title = 'Restore panel';
  restoreBar.setAttribute('aria-label', `Restore ${panelTitle(el).toLowerCase()}`);
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
}

export function restorePanel(id) {
  const el = getPanel(id);
  if (!el) return;
  el.classList.remove('minimized');
  setPanelState();
}

/** Close every managed side panel except the named one. Pass null to close all. */
export function closePanelsExcept(keepId = null) {
  for (const id of PANEL_IDS) {
    if (id === keepId) continue;
    const el = getPanel(id);
    if (el && !el.hidden) {
      el.hidden = true;
      el.classList.remove('minimized');
      document.dispatchEvent(new CustomEvent('hm-panel:hidden', { detail: { id } }));
    }
  }
  setPanelState();
}

function withTransition(fn) {
  if (document.startViewTransition) {
    // Rapid open/close skips the previous transition; ALL THREE of its
    // promises (finished, ready, updateCallbackDone) then reject with
    // "Transition was skipped" — each must be caught or it surfaces as an
    // unhandled rejection (ready was the one still escaping).
    const transition = document.startViewTransition(fn);
    transition.finished.catch(() => {});
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
  } else {
    fn();
  }
}

/** Show one side panel and hide all others. */
export function showPanel(id) {
  withTransition(() => {
    closePanelsExcept(id);
    const el = getPanel(id);
    if (el) {
      ensurePanelChrome(el);
      el.classList.remove('minimized');
      el.hidden = false;
      document.dispatchEvent(new CustomEvent('hm-panel:shown', { detail: { id } }));
    }
    setPanelState();
  });
}

/** Hide one side panel without reopening any previous surface. */
export function hidePanel(id) {
  withTransition(() => {
    const el = getPanel(id);
    if (el && !el.hidden) {
      el.hidden = true;
      el.classList.remove('minimized');
      document.dispatchEvent(new CustomEvent('hm-panel:hidden', { detail: { id } }));
    }
    setPanelState();
  });
}

export function closeAllPanels() {
  closePanelsExcept(null);
}

export function syncPanelControls() {
  for (const [panelId, buttonId] of Object.entries(PANEL_BUTTONS)) {
    const panel = getPanel(panelId);
    const button = document.getElementById(buttonId);
    if (panel && button) button.setAttribute('aria-pressed', String(!panel.hidden));
  }
}
