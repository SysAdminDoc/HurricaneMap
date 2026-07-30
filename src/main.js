// HurricaneMap entry point.
import {
  loadInitial, getLandfalls, getStats, getMetadata, filterLandfalls,
} from './data.js';
import { initMap, renderLandfalls, focusLandfall, showTrack, clearTracks, setHeatmap, announceToLiveRegion } from './map.js';
import { applyPaletteToBody, applyThemeToRoot, getSetting, hasStoredSetting, invalidatePaletteCache, setSetting } from './settings.js';
import { initLocale, setLocale, t, translateStaticElements } from './i18n.js';
import { mountTimeline, highlightYearRange, redraw as redrawTimeline } from './timeline.js';
import { refreshSeasonSummary } from './season.js';
import { recordView } from './search-history.js';
import { initPerformanceMonitoring } from './perf.js';
import { initServiceWorkerUpdates } from './sw-updates.js';
import { escapeHtml } from './html-utils.js';
import {
  YEAR_FALLBACK_MIN, YEAR_FALLBACK_MAX,
  applyHashToFilters, createDefaultFilters, encodeHashState, launcherActionFromHash,
  viewOptionsFromDecoded,
} from './url-state.js';
import {
  setCategoryMacro,
} from './filter-state.js';
import { initGlobalErrorSurface } from './errors.js';
import { initHeaderTooltips } from './tooltips.js';
import { initOptionalFeedDiagnostics } from './optional-feeds.js';
import { initStorageManager } from './storage-manager.js';
import { activateDialogFocus } from './dialog-focus.js';
import { initSearchController } from './search-controller.js';
import { createFilterController } from './filter-controller.js';
import { wireShellNavigation } from './shell-navigation.js';
import { initSavedViewsUI } from './saved-views-ui.js';
import { purgeLegacyUserPoint } from './user-point.js';

initGlobalErrorSurface();
purgeLegacyUserPoint();

let YEAR_MIN_DEFAULT = YEAR_FALLBACK_MIN;
let YEAR_MAX_DEFAULT = YEAR_FALLBACK_MAX;

const filters = createDefaultFilters({ yearMin: YEAR_MIN_DEFAULT, yearMax: YEAR_MAX_DEFAULT });

// Track currently-opened storm so URL hash can encode it.
let openStormId = null;
let comparisonIds = [];
let currentVisibleLandfalls = [];

function deferNonCritical(task) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => task(), { timeout: 2500 });
  } else {
    setTimeout(task, 300);
  }
}

function once(loader) {
  let promise = null;
  return () => {
    if (!promise) promise = loader();
    return promise;
  };
}

const loadPanel = once(() => import('./panel.js'));
const loadStats = once(() => import('./stats.js'));
const loadOnThisDate = once(() => import('./on-this-date.js'));
const loadCompare = once(() => import('./compare.js'));
const loadState = once(() => import('./state.js'));
const loadActive = once(() => import('./active.js'));
const loadSurge = once(() => import('./surge.js'));
const loadPopulation = once(() => import('./population.js'));
const loadOnboarding = once(() => import('./onboarding.js'));
const loadGlossary = once(() => import('./glossary.js'));
const loadKeyboard = once(() => import('./keyboard.js'));
const loadGlobe3D = once(() => import('./globe3d.js'));
const loadExport = once(() => import('./export.js'));
const loadReport = once(() => import('./report.js'));
const loadQgis = once(() => import('./qgis.js'));
const loadTableView = once(() => import('./table-view.js'));
const loadSpatialSearch = once(() => import('./spatial-search.js'));
const loadPrep = once(() => import('./prep.js'));
const loadEvac = once(() => import('./evac.js'));
const loadPoster = once(() => import('./poster.js'));
const loadSST = once(() => import('./sst.js'));

async function showStormLazy(landfall) {
  const { showStorm } = await loadPanel();
  return showStorm(landfall);
}

async function openStateLazy(stateName) {
  const { openState } = await loadState();
  return openState(stateName);
}

async function setSurgeCategoryLazy(category) {
  const { setSurgeCategory } = await loadSurge();
  return setSurgeCategory(category);
}

async function setPopulationLazy(enabled) {
  const { setPopulation } = await loadPopulation();
  return setPopulation(enabled);
}

async function maybeStartOnboardingLazy(options) {
  const { maybeStartOnboarding } = await loadOnboarding();
  return maybeStartOnboarding(options);
}

async function openGlossaryLazy() {
  const glossary = await loadGlossary();
  await glossary.initGlossary();
  glossary.showGlossary();
}

async function lazyStartActiveStormPolling() {
  const { startActiveStormPolling } = await loadActive();
  return startActiveStormPolling();
}

function writeHash() {
  const newHash = encodeHashState(filters, {
    openStormId,
    comparisonIds,
    windUnit: getSetting('windUnit'),
    damageMode: getSetting('damageMode'),
    yearMinDefault: YEAR_MIN_DEFAULT,
    yearMaxDefault: YEAR_MAX_DEFAULT,
  });
  // Skip the no-op replaceState when nothing actually changed.
  const cur = location.hash || '';
  if (cur === newHash) return;
  history.replaceState(null, '', newHash || location.pathname + location.search);
}

const els = {
  headerActions: document.querySelector('.header-actions'),
  yearMin: document.getElementById('year-min'),
  yearMax: document.getElementById('year-max'),
  clearYearFilter: document.getElementById('clear-year-filter'),
  catBtns: document.querySelectorAll('.cat-btn'),
  stateFilter: document.getElementById('state-filter'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  filtersPanel: document.getElementById('filters'),
  showTracks: document.getElementById('show-tracks'),
  showHeatmap: document.getElementById('show-heatmap'),
  showRetiredOnly: document.getElementById('show-retired-only'),
  surgeCategory: document.getElementById('surge-category'),
  showPopulation: document.getElementById('show-population'),
  showSST: document.getElementById('show-sst'),
  resetFilters: document.getElementById('reset-filters'),
  visibleCount: document.getElementById('visible-count'),
  stormCount: document.getElementById('storm-count'),
  toggleFiltersBtn: document.getElementById('toggle-filters'),
  toggleStatsBtn: document.getElementById('toggle-stats'),
  toggleCompareBtn: document.getElementById('toggle-compare'),
  toggleOnThisDateBtn: document.getElementById('toggle-on-this-date'),
  toggleGlobeBtn: document.getElementById('toggle-globe3d'),
  toggleInfoBtn: document.getElementById('toggle-info'),
  toggleMobileActionsBtn: document.getElementById('toggle-mobile-actions'),
  mobileActionsMenu: document.getElementById('mobile-actions-menu'),
  exportBtn: document.getElementById('export-publication'),
  reportBtn: document.getElementById('generate-report'),
  qgisBtn: document.getElementById('export-qgis'),
  tableViewBtn: document.getElementById('toggle-table-view'),
  prepBtn: document.getElementById('toggle-prep'),
  evacBtn: document.getElementById('toggle-evac'),
  posterBtn: document.getElementById('toggle-poster'),
  infoModal: document.getElementById('info-modal'),
  closeInfo: document.getElementById('close-info'),
  dataProvenanceBody: document.getElementById('data-provenance-body'),
  loading: document.getElementById('loading'),
};

const filterController = createFilterController({
  filters,
  elements: els,
  yearDefaults,
  applyFilters,
  openState: openStateLazy,
  setSurgeCategory: setSurgeCategoryLazy,
  setPopulation: setPopulationLazy,
  loadSST,
  resetTrackCache: () => { lastTracksKey = ''; },
});

function syncYearBoundsFromData() {
  const range = getMetadata()?.coverage?.year_range || getStats()?.year_range;
  if (!Array.isArray(range) || range.length !== 2) return;
  const [minYear, maxYear] = range.map(Number);
  if (!Number.isInteger(minYear) || !Number.isInteger(maxYear) || minYear > maxYear) return;

  const wasAtFallback = filters.yearMin === YEAR_FALLBACK_MIN && filters.yearMax === YEAR_FALLBACK_MAX;
  YEAR_MIN_DEFAULT = minYear;
  YEAR_MAX_DEFAULT = maxYear;
  if (wasAtFallback) {
    filters.yearMin = YEAR_MIN_DEFAULT;
    filters.yearMax = YEAR_MAX_DEFAULT;
  }
  updateYearControlBounds();
}

function updateYearControlBounds() {
  if (els.yearMin) {
    els.yearMin.min = String(YEAR_MIN_DEFAULT);
    els.yearMin.max = String(YEAR_MAX_DEFAULT);
  }
  if (els.yearMax) {
    els.yearMax.min = String(YEAR_MIN_DEFAULT);
    els.yearMax.max = String(YEAR_MAX_DEFAULT);
  }
  if (els.clearYearFilter) {
    els.clearYearFilter.title = `Reset to the full ${YEAR_MIN_DEFAULT}-${YEAR_MAX_DEFAULT} range`;
  }
}

function formatMetadataDate(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMetadataDateTime(value) {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
}

function renderDataProvenance() {
  if (!els.dataProvenanceBody) return;
  const metadata = getMetadata();
  const stats = getStats();
  if (!metadata) {
    els.dataProvenanceBody.innerHTML = `
      <p class="provenance-empty">Build metadata is unavailable in this data bundle. Counts still come from validated HURDAT2 statistics.</p>`;
    return;
  }

  const coverage = metadata.coverage || {};
  const yearRange = coverage.year_range || stats?.year_range || [];
  const [yearMin, yearMax] = yearRange;
  const sourceRows = Array.isArray(metadata.sources)
    ? metadata.sources.map(source => {
      const range = Array.isArray(source.storm_year_range)
        ? `${escapeHtml(source.storm_year_range[0])}-${escapeHtml(source.storm_year_range[1])}`
        : 'Unavailable';
      return `
        <li>
          <strong>${escapeHtml(source.filename || source.id || 'Source file')}</strong>
          <span>${escapeHtml(source.basin || 'Basin')} · ${formatNumber(source.storm_count)} storms · ${range}</span>
          <span>Modified ${escapeHtml(formatMetadataDate(source.modified_utc))}</span>
        </li>`;
    }).join('')
    : '';

  els.dataProvenanceBody.innerHTML = `
    <div class="provenance-grid">
      <div>
        <span class="provenance-label">Coverage</span>
        <strong>${escapeHtml(yearMin)}-${escapeHtml(yearMax)}</strong>
      </div>
      <div>
        <span class="provenance-label">Records</span>
        <strong>${formatNumber(coverage.storm_count)} storms · ${formatNumber(coverage.landfall_event_count)} landfalls</strong>
      </div>
      <div>
        <span class="provenance-label">Hurricane landfalls</span>
        <strong>${formatNumber(coverage.hurricane_landfall_count)}</strong>
      </div>
      <div>
        <span class="provenance-label">Generated</span>
        <strong>${escapeHtml(formatMetadataDateTime(metadata.generated_at_utc))}</strong>
      </div>
    </div>
    <div class="provenance-generator">
      Generated by <code>${escapeHtml(metadata.generator?.name || 'preprocessor')}</code>
      ${metadata.generator?.app_version ? `for HurricaneMap ${escapeHtml(metadata.generator.app_version)}` : ''}.
    </div>
    ${sourceRows ? `<ul class="provenance-sources">${sourceRows}</ul>` : ''}`;
}

async function boot() {
  // Initialize locale (before any rendering). Browser-language detection in
  // initLocale() only holds when the user hasn't explicitly picked a language
  // — the settings default ('en') is always truthy and previously reverted
  // first-time Spanish/Creole visitors to English unconditionally.
  initLocale();
  if (hasStoredSetting('locale')) setLocale(getSetting('locale'));
  translateStaticElements();

  // Start performance monitoring early
  initPerformanceMonitoring();
  if (navigator.storage?.persist) navigator.storage.persist();
  
  applyThemeToRoot();
  applyPaletteToBody();
  // Apply high-contrast mode if enabled
  if (getSetting('highContrast')) {
    document.documentElement.classList.add('high-contrast');
  }
  if (getSetting('reducedMotion')) {
    document.documentElement.classList.add('reduce-motion');
  }
  const map = initMap();
  const skipLink = document.querySelector('.skip-to-content');
  const mapTarget = document.getElementById('map');
  skipLink?.addEventListener('click', () => {
    requestAnimationFrame(() => mapTarget?.focus({ preventScroll: true }));
  });
  await loadInitial();
  syncYearBoundsFromData();
  populateStateFilter();
  // Capture PWA launcher tokens before applyFilters() canonicalizes the hash.
  const startupLauncherAction = launcherActionFromHash(location.hash);
  // Restore filters from URL hash BEFORE first render so the user's
  // permalink reproduces what they shared.
  const restored = applyHashToFilters(filters, location.hash, {
    yearMinDefault: YEAR_MIN_DEFAULT,
    yearMaxDefault: YEAR_MAX_DEFAULT,
    knownStates: getStats()?.by_state || {},
  });
  restoreExtendedView(restored);
  syncFilterUiFromState();
  applyFilters();
  wireUI();
  wireSettingsControls();
  initOptionalFeedDiagnostics();
  initStorageManager();
  initSavedViewsUI({
    host: document.getElementById('saved-views-manager'),
    getCurrentHash: () => encodeHashState(filters, {
      openStormId,
      comparisonIds,
      windUnit: getSetting('windUnit'),
      damageMode: getSetting('damageMode'),
      yearMinDefault: YEAR_MIN_DEFAULT,
      yearMaxDefault: YEAR_MAX_DEFAULT,
    }) || '#v=1',
    restoreHash: hash => { location.hash = hash; },
  });
  initHeaderTooltips();
  // 174-year timeline ribbon along the bottom edge.
  mountTimeline(getLandfalls(), {
    yearMin: YEAR_MIN_DEFAULT,
    yearMax: YEAR_MAX_DEFAULT,
    onYearRangeChange: ({ yearMin, yearMax }) => {
      filters.yearMin = yearMin;
      filters.yearMax = yearMax;
      syncFilterUiFromState();
      applyFilters();
    },
  });
  highlightYearRange(filters.yearMin, filters.yearMax);
  // State polygons (clickable for deep-dive). Lazy — fetches the geojson once.
  deferNonCritical(() => {
    loadState().then(({ enableStateClicks }) => enableStateClicks(map)).catch(() => { /* non-fatal */ });
  });
  deferNonCritical(() => {
    lazyStartActiveStormPolling();
  });
  deferNonCritical(async () => {
    const { initSpatialSearch } = await loadSpatialSearch();
    initSpatialSearch((lf) => onLandfallClick(lf, null));
  });
  els.stormCount.textContent = t(
    'status.stormCount',
    getStats().total_storms.toLocaleString(),
    getStats().total_landfall_events.toLocaleString(),
  );
  renderDataProvenance();
  
  // Initialize keyboard shortcuts and navigation
  // Wire macro filter functions to window
  window.filterByMacro = (mode) => {
    if (setCategoryMacro(filters, mode)) {
      syncFilterUiFromState();
      applyFilters();
    }
  };
  deferNonCritical(() => {
    loadKeyboard().then(({ init }) => init()).catch(() => { /* non-fatal */ });
  });
  
  els.loading.classList.add('fade-out');
  setTimeout(() => { els.loading.style.display = 'none'; }, 420);

  // Re-open the storm encoded in the hash, if any. Done after first render
  // so the marker exists.
  if (restored && restored.storm) {
    const lf = getLandfalls().find(x => x.storm_id === restored.storm);
    if (lf) {
      // Defer slightly so map zoom/markers settle first.
      setTimeout(() => onLandfallClick(lf), 60);
    }
  }
  // Only open the state panel for a state the hash validator actually
  // accepted — a crafted #s=Bogus otherwise opens an empty panel for a state
  // the filter engine just rejected.
  if (restored && restored.s && filters.state === restored.s) {
    setTimeout(() => openStateLazy(restored.s), 80);
  }
  // PWA launcher shortcuts use bare hash tokens (manifest.webmanifest).
  openLauncherAction(startupLauncherAction);
  // Live permalink navigation: pasting a new hash into this open tab (or
  // back/forward across hash entries) re-applies the shared view. Our own
  // hash writes use history.replaceState, which never fires hashchange, so
  // this only reacts to real navigation.
  window.addEventListener('hashchange', () => {
    const launcherAction = launcherActionFromHash(location.hash);
    const nav = applyHashToFilters(filters, location.hash, {
      yearMinDefault: YEAR_MIN_DEFAULT,
      yearMaxDefault: YEAR_MAX_DEFAULT,
      knownStates: getStats()?.by_state || {},
    });
    restoreExtendedView(nav);
    syncFilterUiFromState();
    applyFilters();
    highlightYearRange(filters.yearMin, filters.yearMax);
    if (nav?.storm) {
      const lf = getLandfalls().find(x => x.storm_id === nav.storm);
      if (lf) setTimeout(() => onLandfallClick(lf), 60);
    }
    if (nav?.s && filters.state === nav.s) {
      setTimeout(() => openStateLazy(nav.s), 80);
    }
    openLauncherAction(launcherAction, 60);
  });

  // First-run tour is delayed until the map, filters, and timeline are stable.
  setTimeout(() => maybeStartOnboardingLazy(), 700);
}

function restoreExtendedView(decoded) {
  const options = viewOptionsFromDecoded(decoded);
  if (options.windUnit) setSetting('windUnit', options.windUnit);
  if (options.damageMode) setSetting('damageMode', options.damageMode);
  comparisonIds = options.comparisonIds;
  if (comparisonIds.length) {
    loadCompare()
      .then(({ setPinsByIds }) => setPinsByIds(comparisonIds))
      .catch(error => console.error('Failed to restore comparison set:', error));
  } else if (decoded?.p !== undefined) {
    loadCompare().then(({ setPinsByIds }) => setPinsByIds([])).catch(() => {});
  }
}

document.addEventListener('comparison-pins:change', event => {
  comparisonIds = Array.isArray(event.detail?.ids) ? event.detail.ids.slice(0, 4) : [];
  writeHash();
});

function openLauncherAction(action, delay = 120) {
  const buttonId = action === 'stats' ? 'toggle-stats' : action === 'compare' ? 'toggle-compare' : null;
  if (buttonId) setTimeout(() => document.getElementById(buttonId)?.click(), delay);
}

// Settings menu — palette + wind unit toggles. Wires to the cog button in
// the header and re-renders dependent surfaces on change.
function wireSettingsControls() {
  const cog = document.getElementById('toggle-settings');
  const menu = document.getElementById('settings-menu');
  if (!cog || !menu) return;

  function syncRadioGroup(selector, setting, dataKey) {
    const buttons = [...menu.querySelectorAll(selector)];
    let selected = null;
    for (const btn of buttons) {
      const checked = btn.dataset[dataKey] === getSetting(setting);
      btn.classList.toggle('on', checked);
      btn.setAttribute('aria-checked', String(checked));
      btn.tabIndex = checked ? 0 : -1;
      if (checked) selected = btn;
    }
    if (!selected && buttons[0]) buttons[0].tabIndex = 0;
  }

  // Reflect current settings into the menu controls.
  function syncMenu() {
    syncRadioGroup('[data-set-unit]', 'windUnit', 'setUnit');
    syncRadioGroup('[data-set-theme]', 'theme', 'setTheme');
    syncRadioGroup('[data-set-palette]', 'palette', 'setPalette');
    syncRadioGroup('[data-set-locale]', 'locale', 'setLocale');
    syncRadioGroup('[data-set-damage]', 'damageMode', 'setDamage');
    const coneToggle = menu.querySelector('#toggle-nhc-forecast-cone');
    if (coneToggle) {
      coneToggle.checked = getSetting('nhcForecastCone');
    }
    const outlookToggle = menu.querySelector('#toggle-nhc-outlook');
    if (outlookToggle) {
      outlookToggle.checked = getSetting('nhcOutlook');
    }
    const marineToggle = menu.querySelector('#toggle-marine-warnings');
    if (marineToggle) {
      marineToggle.checked = getSetting('marineWarnings');
    }
    const goesToggle = menu.querySelector('#toggle-goes-realtime');
    if (goesToggle) {
      goesToggle.checked = getSetting('goesRealtime');
    }
    const hcToggle = menu.querySelector('#toggle-high-contrast');
    if (hcToggle) {
      hcToggle.checked = getSetting('highContrast');
    }
    const rmToggle = menu.querySelector('#toggle-reduced-motion');
    if (rmToggle) {
      rmToggle.checked = getSetting('reducedMotion');
    }
  }
  syncMenu();

  menu.addEventListener('toggle', () => {
    const open = menu.matches(':popover-open');
    cog.setAttribute('aria-expanded', String(open));
    if (open) syncMenu();
  });

  menu.addEventListener('click', (e) => {
    const u = e.target.closest('[data-set-unit]');
    if (u) { setSetting('windUnit', u.dataset.setUnit); syncMenu(); return; }
    const t = e.target.closest('[data-set-theme]');
    if (t) { setSetting('theme', t.dataset.setTheme); syncMenu(); return; }
    const p = e.target.closest('[data-set-palette]');
    if (p) { setSetting('palette', p.dataset.setPalette); syncMenu(); return; }
    const l = e.target.closest('[data-set-locale]');
    if (l) { setSetting('locale', l.dataset.setLocale); location.reload(); return; }
    const d = e.target.closest('[data-set-damage]');
    if (d) { setSetting('damageMode', d.dataset.setDamage); syncMenu(); return; }
  });

  menu.addEventListener('keydown', (event) => {
    const radio = event.target.closest?.('.settings-pill[role="radio"]');
    if (!radio) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const radios = [...radio.closest('[role="radiogroup"]')?.querySelectorAll('[role="radio"]') || []]
      .filter(candidate => !candidate.disabled);
    if (!radios.length) return;
    const current = Math.max(0, radios.indexOf(radio));
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = radios.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % radios.length;
    else next = (current - 1 + radios.length) % radios.length;
    event.preventDefault();
    radios[next].focus();
    radios[next].click();
  });

  const coneToggle = menu.querySelector('#toggle-nhc-forecast-cone');
  if (coneToggle) {
    coneToggle.addEventListener('change', () => {
      setSetting('nhcForecastCone', coneToggle.checked);
    });
  }

  const outlookToggle = menu.querySelector('#toggle-nhc-outlook');
  if (outlookToggle) {
    outlookToggle.addEventListener('change', () => {
      setSetting('nhcOutlook', outlookToggle.checked);
    });
  }

  const marineToggle = menu.querySelector('#toggle-marine-warnings');
  if (marineToggle) {
    marineToggle.addEventListener('change', () => {
      setSetting('marineWarnings', marineToggle.checked);
    });
  }

  const goesToggle = menu.querySelector('#toggle-goes-realtime');
  if (goesToggle) {
    goesToggle.addEventListener('change', () => {
      setSetting('goesRealtime', goesToggle.checked);
    });
  }

  const hcToggle = menu.querySelector('#toggle-high-contrast');
  if (hcToggle) {
    hcToggle.addEventListener('change', () => {
      setSetting('highContrast', hcToggle.checked);
    });
  }

  const rmToggle = menu.querySelector('#toggle-reduced-motion');
  if (rmToggle) {
    rmToggle.addEventListener('change', () => {
      setSetting('reducedMotion', rmToggle.checked);
      document.documentElement.classList.toggle('reduce-motion', rmToggle.checked);
    });
  }

  const replayTour = menu.querySelector('#replay-tour');
  if (replayTour) {
    replayTour.addEventListener('click', () => {
      if (typeof menu.hidePopover === 'function') {
        try { menu.hidePopover(); } catch { /* already closed */ }
      }
      cog.setAttribute('aria-expanded', 'false');
      maybeStartOnboardingLazy({ force: true });
    });
  }

  // Live-react to theme and palette changes — re-stamp the classes.
  document.addEventListener('hm-settings:change', (e) => {
    if (e.detail.key === 'theme') {
      applyThemeToRoot();
      // Marker colors resolve from the theme's --cat-* tokens — repaint so
      // the map matches the re-themed legend.
      lastTracksKey = '';
      applyFilters();
    }
    if (e.detail.key === 'palette') {
      applyPaletteToBody();
      lastTracksKey = '';
      applyFilters();
      // If a storm panel is open, re-open it so its colors refresh too.
      if (openStormId) {
        const lf = getLandfalls().find(x => x.storm_id === openStormId);
        if (lf) onLandfallClick(lf);
      }
    }
    if (e.detail.key === 'windUnit' && openStormId) {
      const lf = getLandfalls().find(x => x.storm_id === openStormId);
      if (lf) onLandfallClick(lf);
    }
    if (e.detail.key === 'damageMode') {
      // Re-render storm panel with new damage formatting + refresh season card.
      if (openStormId) {
        const lf = getLandfalls().find(x => x.storm_id === openStormId);
        if (lf) onLandfallClick(lf);
      }
      refreshSeasonSummary({ yearMin: filters.yearMin, yearMax: filters.yearMax });
    }
    if (e.detail.key === 'highContrast') {
      document.documentElement.classList.toggle('high-contrast', getSetting('highContrast'));
      invalidatePaletteCache();
      lastTracksKey = '';
      applyFilters();
    }
    if (e.detail.key === 'reducedMotion') {
      document.documentElement.classList.toggle('reduce-motion', getSetting('reducedMotion'));
    }
  });
}

// Reflect the in-memory `filters` state back into the DOM controls. Used
// after restoring a permalink so the toggles match what was applied.
function syncFilterUiFromState() {
  filterController.sync();
}

function populateStateFilter() {
  const stats = getStats();
  const states = Object.keys(stats.by_state).sort();
  for (const s of states) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s} (${stats.by_state[s].total})`;
    els.stateFilter.appendChild(opt);
  }
}

// The bottom timeline scopes to the state filter (all years, one state) so
// bars stay meaningful while a state is selected — and restores to the full
// dataset when the state clears or its deep-dive panel closes.
let timelineScopeKey = null;

function refreshTimelineScope(force = false) {
  const key = filters.state || '';
  if (!force && key === timelineScopeKey) return;
  timelineScopeKey = key;
  const scoped = key ? getLandfalls().filter(lf => lf.state === key) : getLandfalls();
  redrawTimeline(scoped);
  highlightYearRange(filters.yearMin, filters.yearMax);
}

function applyFilters() {
  const visible = filterLandfalls(getLandfalls(), filters);
  currentVisibleLandfalls = visible;
  renderLandfalls(visible, onLandfallClick);
  const totalLandfalls = getLandfalls().length;
  const countText = visible.length === totalLandfalls
    ? t('status.landfalls', visible.length.toLocaleString())
    : t('status.landfallsOf', visible.length.toLocaleString(), totalLandfalls.toLocaleString());
  els.visibleCount.textContent = countText;
  announceToLiveRegion(t('status.showing', countText));
  filterController.updateResetState();
  if (filters.showTracks) {
    redrawTracks(visible);
  } else {
    lastTracksKey = '';
    clearTracks();
  }
  setHeatmap(filters.showHeatmap, visible);
  refreshTimelineScope();
  highlightYearRange(filters.yearMin, filters.yearMax);
  refreshSeasonSummary({ yearMin: filters.yearMin, yearMax: filters.yearMax });
  writeHash();
}

function yearDefaults() {
  return { yearMinDefault: YEAR_MIN_DEFAULT, yearMaxDefault: YEAR_MAX_DEFAULT };
}

let lastTracksKey = '';
async function redrawTracks(visible) {
  // Performance guard: only draw tracks for up to N storms when toggled on.
  const MAX_TRACKS = 100;
  const ids = [];
  const seen = new Set();
  for (const lf of visible) {
    if (!seen.has(lf.storm_id)) { seen.add(lf.storm_id); ids.push(lf.storm_id); }
    if (ids.length >= MAX_TRACKS) break;
  }
  const key = ids.join(',');
  if (key === lastTracksKey) return;
  lastTracksKey = key;
  clearTracks();
  for (const id of ids) {
    showTrack(id, { weight: 1.5 });
  }
}

function onLandfallClick(landfall, marker) {
  focusLandfall(landfall);
  openStormId = landfall.storm_id;
  recordView(landfall);
  writeHash();
  showStormLazy(landfall).catch((error) => {
    console.error('Failed to open storm panel:', error);
  });
}

document.addEventListener('storm-panel:close', () => {
  openStormId = null;
  writeHash();
});

function wireUI() {
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

  // Stats panel toggle
  els.toggleStatsBtn.addEventListener('click', async () => {
    const { toggleStats } = await loadStats();
    toggleStats();
  });

  // Compare panel is loaded on first use; pinning from a storm panel imports
  // the same module, so the tray and pinned state stay shared.
  els.toggleCompareBtn?.addEventListener('click', async () => {
    const { openComparePanel } = await loadCompare();
    openComparePanel();
  });

  // On this date panel
  els.toggleOnThisDateBtn.addEventListener('click', async () => {
    const { showOnThisDate } = await loadOnThisDate();
    showOnThisDate();
  });

  // Opt-in 3D globe view. Cesium loads only when the user opens this mode.
  els.toggleGlobeBtn?.addEventListener('click', async () => {
    const globe = await loadGlobe3D();
    globe.initGlobe3D();
    globe.openGlobe3D({ landfalls: currentVisibleLandfalls, focusStormId: openStormId });
  });

  // Info modal
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
  els.infoModal.addEventListener('click', (e) => {
    if (e.target === els.infoModal) closeInfoModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.infoModal.hidden) {
      e.preventDefault();
      closeInfoModal();
    }
  });

  // Export button
  if (els.exportBtn) {
    els.exportBtn.addEventListener('click', async () => {
      const { exportPublicationCSV } = await loadExport();
      exportPublicationCSV(filters);
    });
  }

  // Report button
  if (els.reportBtn) {
    els.reportBtn.addEventListener('click', async () => {
      const { generateStatisticalReport, downloadReportAsText } = await loadReport();
      const { markdown, title } = generateStatisticalReport(filters);
      downloadReportAsText(markdown, title);
    });
  }

  // QGIS export button
  if (els.qgisBtn) {
    els.qgisBtn.addEventListener('click', async () => {
      try {
        const { exportQGISGeoJSON } = await loadQgis();
        await exportQGISGeoJSON(filters);
      } catch (error) {
        console.error('QGIS export failed:', error);
      }
    });
  }

  if (els.tableViewBtn) {
    els.tableViewBtn.addEventListener('click', async () => {
      const tv = await loadTableView();
      if (tv.isOpen()) { tv.hide(); return; }
      tv.show(currentVisibleLandfalls, (lf) => onLandfallClick(lf, null));
    });
  }

  els.prepBtn?.addEventListener('click', async () => {
    const { openPrepPanel } = await loadPrep();
    openPrepPanel();
  });

  // Desktop presents secondary actions inline in a horizontal rail. Return
  // the rail to its primary controls after activating one so Filters and the
  // other core views never remain scrolled underneath the title block.
  els.headerActions?.addEventListener('click', event => {
    if (innerWidth <= 720 || !event.target.closest('.mobile-actions-menu > .icon-btn')) return;
    requestAnimationFrame(() => { els.headerActions.scrollLeft = 0; });
  });

  els.evacBtn?.addEventListener('click', async () => {
    const { openEvacPanel } = await loadEvac();
    await openEvacPanel();
  });

  els.posterBtn?.addEventListener('click', async () => {
    const { openPoster } = await loadPoster();
    await openPoster({
      landfalls: currentVisibleLandfalls,
      filters: { ...filters, categories: new Set(filters.categories) },
      returnFocus: els.toggleMobileActionsBtn,
    });
  });

  const spatialBtn = document.getElementById('toggle-spatial-search');
  if (spatialBtn) {
    spatialBtn.addEventListener('click', async () => {
      const { toggleSpatialMode } = await loadSpatialSearch();
      toggleSpatialMode();
    });
    // Synced via event so exits from the results panel's × (which also turns
    // the mode off) can't leave the toolbar button stuck pressed.
    document.addEventListener('spatial-mode:change', (e) => {
      const on = Boolean(e.detail?.active);
      spatialBtn.setAttribute('aria-pressed', String(on));
      spatialBtn.classList.toggle('active', on);
    });
  }

  // The state deep-dive rescopes the bottom timeline to one state; restore the
  // filter-driven scope whenever that panel goes away.
  document.addEventListener('hm-panel:hidden', (e) => {
    if (e.detail?.id === 'state-panel') refreshTimelineScope(true);
  });

  const glossaryBtn = document.getElementById('toggle-glossary');
  if (glossaryBtn) {
    glossaryBtn.addEventListener('click', openGlossaryLazy);
  }
}

boot().catch(err => {
  console.error('[boot] Boot failed', err);
  const safeMsg = escapeHtml(err.message || 'Unknown error');
  els.loading.innerHTML = `
    <div class="boot-error-state" role="alert">
      <strong>${t('boot.errorTitle')}</strong>
      <span>${safeMsg}</span>
      <span>${t('boot.errorHint')}<code>python -m http.server 8765</code>.</span>
      <button class="text-btn boot-retry-btn" type="button">${t('boot.retry')}</button>
    </div>`;
  els.loading.querySelector('.boot-retry-btn')?.addEventListener('click', () => window.location.reload());
});

initServiceWorkerUpdates();
