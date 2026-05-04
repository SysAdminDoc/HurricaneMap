// Side-panel manager. Every analytical/details surface uses one lane so panels
// never stack or fight for viewport space.

const PANEL_IDS = ['storm-panel', 'stats-panel', 'compare-panel', 'state-panel', 'on-this-date-panel'];
const PANEL_BUTTONS = {
  'stats-panel': 'toggle-stats',
  'compare-panel': 'toggle-compare',
  'on-this-date-panel': 'toggle-on-this-date',
};

function getPanel(id) {
  return document.getElementById(id);
}

function setPanelState() {
  const anyOpen = PANEL_IDS.some(id => {
    const panel = getPanel(id);
    return panel && !panel.hidden;
  });
  document.body.classList.toggle('side-panel-open', anyOpen);
  syncPanelControls();
}

/** Close every managed side panel except the named one. Pass null to close all. */
export function closePanelsExcept(keepId = null) {
  for (const id of PANEL_IDS) {
    if (id === keepId) continue;
    const el = getPanel(id);
    if (el && !el.hidden) el.hidden = true;
  }
  setPanelState();
}

/** Show one side panel and hide all others. */
export function showPanel(id) {
  closePanelsExcept(id);
  const el = getPanel(id);
  if (el) el.hidden = false;
  setPanelState();
}

/** Hide one side panel without reopening any previous surface. */
export function hidePanel(id) {
  const el = getPanel(id);
  if (el) el.hidden = true;
  setPanelState();
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
