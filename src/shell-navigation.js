import { t } from './i18n.js';
import { closeAllPanels, openPanelId } from './panels.js';
import { launcherActionFromHash, normalizeLauncherPanel } from './url-state.js';

/** The launcher panel currently on screen as its URL token, '' when none is. */
export function openLauncherPanelId() {
  return normalizeLauncherPanel(openPanelId().replace(/-panel$/, ''));
}

/**
 * Keep the URL's panel token in step with the panel on screen.
 *
 * Only when that token actually changed. Every re-render of the storm panel
 * fires the same event, and rewriting the whole address from application state
 * then can undo a hash the reader just pasted, in the window after the
 * assignment and before the hashchange that would have applied it runs. When
 * the panel the URL names is already the panel on screen there is nothing here
 * to write, so the navigation is left alone.
 */
export function wireLauncherPanelUrl(writeHash) {
  const inSync = () => openLauncherPanelId() === (launcherActionFromHash(location.hash) || '');
  for (const type of ['hm-panel:shown', 'hm-panel:hidden']) {
    document.addEventListener(type, () => { if (!inSync()) writeHash(); });
  }
}

/**
 * Open the launcher panel a link names, unless it is already on screen.
 *
 * The header controls are toggles, so clicking one for a panel that is already
 * open closes it. That matters on a hashchange: moving between two links that
 * both carry the statistics panel has to leave it open, not flip it shut.
 */
export function openLauncherPanel(action, delay = 120) {
  const id = normalizeLauncherPanel(action);
  if (!id || document.getElementById(`${id}-panel`)?.hidden === false) return;
  setTimeout(() => document.getElementById(`toggle-${id}`)?.click(), delay);
}

export function wireShellNavigation({
  filtersButton,
  filtersPanel,
  mobileActionsButton,
  mobileActionsMenu,
}) {
  wireFilterPanel(filtersButton, filtersPanel);
  wireMobileActionsMenu(mobileActionsButton, mobileActionsMenu);
}

function wireMobileActionsMenu(trigger, menu) {
  if (!trigger || !menu) return;

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.dataset.open = 'false';
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  const openMenu = () => {
    menu.dataset.open = 'true';
    trigger.setAttribute('aria-expanded', 'true');
  };

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    if (menu.dataset.open === 'true') closeMenu();
    else openMenu();
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('.icon-btn')) closeMenu();
  }, true);
  document.addEventListener('click', event => {
    if (menu.dataset.open !== 'true') return;
    if (menu.contains(event.target) || event.target === trigger) return;
    closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.dataset.open !== 'true') return;
    event.preventDefault();
    closeMenu({ restoreFocus: true });
  });
}

function wireFilterPanel(trigger, panel) {
  if (!trigger || !panel) return;
  const mobileQuery = window.matchMedia('(max-width: 720px)');
  let userChanged = false;

  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('filters-open', !collapsed);
    trigger.setAttribute('aria-expanded', String(!collapsed));
    trigger.setAttribute('aria-label', t(collapsed ? 'filters.show' : 'filters.hide'));
    trigger.title = t(collapsed ? 'filters.show' : 'filters.hide');
  };

  setCollapsed(true);
  trigger.addEventListener('click', () => {
    userChanged = true;
    const nextCollapsed = !panel.classList.contains('collapsed');
    if (!nextCollapsed) closeAllPanels();
    setCollapsed(nextCollapsed);
  });
  document.addEventListener('hm-panel:shown', () => setCollapsed(true));

  const onViewportChange = () => {
    if (!userChanged) setCollapsed(true);
  };
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onViewportChange);
  else if (mobileQuery.addListener) mobileQuery.addListener(onViewportChange);
}
