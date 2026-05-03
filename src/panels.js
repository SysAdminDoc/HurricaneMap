// Right-side panel manager — keeps the four mode-panels (storm details,
// statistics, comparison, state deep-dive) mutually exclusive so they don't
// stack on top of each other. Any side panel that opens kicks the others
// closed; closing a panel doesn't restore a previous one.

const PANEL_IDS = ['storm-panel', 'stats-panel', 'compare-panel', 'state-panel'];

/** Close every right-side panel except the named one. Pass null to close all. */
export function closePanelsExcept(keepId) {
  for (const id of PANEL_IDS) {
    if (id === keepId) continue;
    const el = document.getElementById(id);
    if (el && !el.hidden) el.hidden = true;
  }
}

/** Show one of the right-side panels, hiding the rest. */
export function showPanel(id) {
  closePanelsExcept(id);
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
