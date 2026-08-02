// Application-level DOM actions.
//
// main.js owns boot, canonical filter/hash state, and data/map orchestration.
// This module owns listeners for top-level controls and injects the small set
// of callbacks it needs, preventing a second state or metric authority.
import { activateDialogFocus } from './dialog-focus.js';
import { initSearchController } from './search-controller.js';
import { wireShellNavigation } from './shell-navigation.js';

export function wireApplicationShell({
  elements,
  filters,
  filterController,
  load,
  onLandfallClick,
  getVisibleLandfalls,
  getOpenStormId,
  openGlossary,
  refreshTimelineScope,
}) {
  const els = elements;
  wireShellNavigation({
    filtersButton: els.toggleFiltersBtn,
    filtersPanel: els.filtersPanel,
    mobileActionsButton: els.toggleMobileActionsBtn,
    mobileActionsMenu: els.mobileActionsMenu,
  });
  filterController.wire();

  initSearchController({
    input: els.searchInput,
    results: els.searchResults,
    onSelect: onLandfallClick,
  });

  els.toggleStatsBtn.addEventListener('click', async () => {
    const { toggleStats } = await load.stats();
    toggleStats();
  });

  els.toggleCompareBtn?.addEventListener('click', async () => {
    const { openComparePanel } = await load.compare();
    openComparePanel();
  });

  els.toggleOnThisDateBtn.addEventListener('click', async () => {
    const { showOnThisDate } = await load.onThisDate();
    showOnThisDate();
  });

  els.toggleGlobeBtn?.addEventListener('click', async () => {
    const globe = await load.globe3d();
    globe.initGlobe3D();
    globe.openGlobe3D({ landfalls: getVisibleLandfalls(), focusStormId: getOpenStormId() });
  });

  let releaseInfoFocus = null;
  const closeInfoModal = () => {
    els.infoModal.hidden = true;
    releaseInfoFocus?.();
    releaseInfoFocus = null;
  };
  els.toggleInfoBtn.addEventListener('click', () => {
    els.infoModal.hidden = false;
    releaseInfoFocus = activateDialogFocus(els.infoModal, { initialFocus: '#close-info' });
  });
  els.closeInfo.addEventListener('click', closeInfoModal);
  els.infoModal.addEventListener('click', event => {
    if (event.target === els.infoModal) closeInfoModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !els.infoModal.hidden) {
      event.preventDefault();
      closeInfoModal();
    }
  });

  els.exportBtn?.addEventListener('click', async () => {
    const { exportPublicationCSV } = await load.export();
    exportPublicationCSV(filters);
  });

  els.reportBtn?.addEventListener('click', async () => {
    const { generateStatisticalReport, downloadReportAsText } = await load.report();
    const { markdown, title } = generateStatisticalReport(filters);
    downloadReportAsText(markdown, title);
  });

  els.qgisBtn?.addEventListener('click', async () => {
    try {
      const { exportQGISGeoJSON } = await load.qgis();
      await exportQGISGeoJSON(filters);
    } catch (error) {
      console.error('QGIS export failed:', error);
    }
  });

  els.tableViewBtn?.addEventListener('click', async () => {
    const tableView = await load.tableView();
    if (tableView.isOpen()) {
      tableView.hide();
      return;
    }
    tableView.show(getVisibleLandfalls(), landfall => onLandfallClick(landfall, null));
  });

  els.prepBtn?.addEventListener('click', async () => {
    const { openPrepPanel } = await load.prep();
    openPrepPanel();
  });

  els.headerActions?.addEventListener('click', event => {
    if (innerWidth <= 720 || !event.target.closest('.mobile-actions-menu > .icon-btn')) return;
    requestAnimationFrame(() => { els.headerActions.scrollLeft = 0; });
  });

  els.evacBtn?.addEventListener('click', async () => {
    const { openEvacPanel } = await load.evac();
    await openEvacPanel();
  });

  els.posterBtn?.addEventListener('click', async () => {
    const { openPoster } = await load.poster();
    openPoster({
      landfalls: getVisibleLandfalls(),
      filters: { ...filters, categories: new Set(filters.categories) },
      returnFocus: els.toggleMobileActionsBtn,
    });
  });

  const spatialButton = document.getElementById('toggle-spatial-search');
  if (spatialButton) {
    spatialButton.addEventListener('click', async () => {
      const { toggleSpatialMode } = await load.spatialSearch();
      toggleSpatialMode();
    });
    document.addEventListener('spatial-mode:change', event => {
      const active = Boolean(event.detail?.active);
      spatialButton.setAttribute('aria-pressed', String(active));
      spatialButton.classList.toggle('active', active);
    });
  }

  document.addEventListener('hm-panel:hidden', event => {
    if (event.detail?.id === 'state-panel') refreshTimelineScope(true);
  });

  if (els.glossaryBtn) els.glossaryBtn.addEventListener('click', openGlossary);
}
