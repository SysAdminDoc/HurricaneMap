import { t } from './i18n.js';
import { closeAllPanels, hidePanel, openPanelId } from './panels.js';
import { normalizeLauncherPanel } from './url-state.js';

/** The launcher panel currently on screen as its URL token, '' when none is. */
export function openLauncherPanelId() {
  return normalizeLauncherPanel(openPanelId().replace(/-panel$/, ''));
}

/**
 * Keep the URL's panel token in step with the panel on screen.
 *
 * Compared against the token this module last wrote, not against the token in
 * the address bar. Every re-render of the storm panel fires the same event, and
 * rewriting the whole address from application state then undoes a hash the
 * reader just pasted, in the window after the assignment and before the
 * hashchange that would have applied it runs. Comparing against the address bar
 * stood down only when the incoming link named the panel already on screen,
 * which is the one case needing no protection; a link naming a different panel,
 * which is what this feature exists to share, was clobbered along with its
 * filters. A panel event that does not move this token is a re-render, and a
 * re-render has nothing to write.
 */
let writtenPanel = '';

export function wireLauncherPanelUrl(writeHash) {
  for (const type of ['hm-panel:shown', 'hm-panel:hidden']) {
    document.addEventListener(type, () => {
      const current = openLauncherPanelId();
      if (current === writtenPanel) return;
      writtenPanel = current;
      writeHash();
    });
  }
}

/**
 * Put the panel a link names on screen, or take one off when it names none.
 *
 * `null` means the hash said nothing about panels, which is every unversioned
 * form, and leaves whatever is open alone. The header controls are toggles, so
 * clicking one for a panel already on screen would close it: moving between two
 * links that both carry the statistics panel has to leave it open.
 */
export function applyLauncherPanel(intent, delay = 120) {
  if (intent === null || intent === undefined) return;
  const id = normalizeLauncherPanel(intent);
  if (!id) {
    const open = openLauncherPanelId();
    // Focus stays where the reader put it: nobody clicked anything here.
    if (open) setTimeout(() => hidePanel(`${open}-panel`, { restoreFocus: false }), delay);
    return;
  }
  if (document.getElementById(`${id}-panel`)?.hidden === false) return;
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
