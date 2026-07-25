import { t } from './i18n.js';
import { closeAllPanels } from './panels.js';

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
