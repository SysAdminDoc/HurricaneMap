// HurricaneMap entry point.
import {
  loadInitial, getLandfalls, getStats, getMetadata, filterLandfalls,
  searchStorms, categoryLabel, ensureStormsLoaded, getStorm,
} from './data.js';
import { initMap, renderLandfalls, focusLandfall, fitToLandfalls, showTrack, clearTracks, setHeatmap, announceToLiveRegion } from './map.js';
import { applyPaletteToBody, applyThemeToRoot, getSetting, setSetting } from './settings.js';
import { initLocale, setLocale, translateStaticElements } from './i18n.js';
import { mountTimeline, highlightYearRange, redraw as redrawTimeline } from './timeline.js';
import { buildSparkline } from './sparkline.js';
import { refreshSeasonSummary } from './season.js';
import { fuzzyAugment } from './fuzzy.js';
import { recordView, getHistory } from './search-history.js';
import { initPerformanceMonitoring } from './perf.js';
import { initServiceWorkerUpdates } from './sw-updates.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import {
  YEAR_FALLBACK_MIN, YEAR_FALLBACK_MAX,
  applyHashToFilters, createDefaultFilters, encodeHashState,
} from './url-state.js';
import {
  hasActiveFilters, isYearFiltered, resetPrimaryFilters, resetYearRange,
  setCategoryMacro, setYearRange, toggleCategory,
} from './filter-state.js';

let YEAR_MIN_DEFAULT = YEAR_FALLBACK_MIN;
let YEAR_MAX_DEFAULT = YEAR_FALLBACK_MAX;

const filters = createDefaultFilters({ yearMin: YEAR_MIN_DEFAULT, yearMax: YEAR_MAX_DEFAULT });

// Track currently-opened storm so URL hash can encode it.
let openStormId = null;
let activeSearchIndex = -1;
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
    yearMinDefault: YEAR_MIN_DEFAULT,
    yearMaxDefault: YEAR_MAX_DEFAULT,
  });
  // Avoid re-firing hashchange when nothing actually changed.
  const cur = location.hash || '';
  if (cur === newHash) return;
  history.replaceState(null, '', newHash || location.pathname + location.search);
}

const els = {
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
  infoModal: document.getElementById('info-modal'),
  closeInfo: document.getElementById('close-info'),
  dataProvenanceBody: document.getElementById('data-provenance-body'),
  loading: document.getElementById('loading'),
};

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
  // Initialize locale (before any rendering)
  initLocale();
  const savedLocale = getSetting('locale');
  if (savedLocale) setLocale(savedLocale);
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
  await loadInitial();
  syncYearBoundsFromData();
  populateStateFilter();
  // Restore filters from URL hash BEFORE first render so the user's
  // permalink reproduces what they shared.
  const restored = applyHashToFilters(filters, location.hash, {
    yearMinDefault: YEAR_MIN_DEFAULT,
    yearMaxDefault: YEAR_MAX_DEFAULT,
    knownStates: getStats()?.by_state || {},
  });
  syncFilterUiFromState();
  applyFilters();
  wireUI();
  wireSettingsControls();
  // 174-year timeline ribbon along the bottom edge.
  mountTimeline(getLandfalls(), {
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
  els.stormCount.textContent = `${getStats().total_storms.toLocaleString()} storms · ${getStats().total_landfall_events.toLocaleString()} landfalls`;
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
  if (restored && restored.s) {
    setTimeout(() => openStateLazy(restored.s), 80);
  }
  // First-run tour is delayed until the map, filters, and timeline are stable.
  setTimeout(() => maybeStartOnboardingLazy(), 700);
}

// Settings menu — palette + wind unit toggles. Wires to the cog button in
// the header and re-renders dependent surfaces on change.
function wireSettingsControls() {
  const cog = document.getElementById('toggle-settings');
  const menu = document.getElementById('settings-menu');
  if (!cog || !menu) return;

  // Reflect current settings into the menu controls.
  function syncMenu() {
    menu.querySelectorAll('[data-set-unit]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.setUnit === getSetting('windUnit'));
      btn.setAttribute('aria-checked', String(btn.dataset.setUnit === getSetting('windUnit')));
    });
    menu.querySelectorAll('[data-set-theme]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.setTheme === getSetting('theme'));
      btn.setAttribute('aria-checked', String(btn.dataset.setTheme === getSetting('theme')));
    });
    menu.querySelectorAll('[data-set-palette]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.setPalette === getSetting('palette'));
      btn.setAttribute('aria-checked', String(btn.dataset.setPalette === getSetting('palette')));
    });
    menu.querySelectorAll('[data-set-locale]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.setLocale === getSetting('locale'));
      btn.setAttribute('aria-checked', String(btn.dataset.setLocale === getSetting('locale')));
    });
    menu.querySelectorAll('[data-set-damage]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.setDamage === getSetting('damageMode'));
      btn.setAttribute('aria-checked', String(btn.dataset.setDamage === getSetting('damageMode')));
    });
    const coneToggle = menu.querySelector('#toggle-nhc-forecast-cone');
    if (coneToggle) {
      coneToggle.checked = getSetting('nhcForecastCone');
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

  const coneToggle = menu.querySelector('#toggle-nhc-forecast-cone');
  if (coneToggle) {
    coneToggle.addEventListener('change', () => {
      setSetting('nhcForecastCone', coneToggle.checked);
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
    }
    if (e.detail.key === 'palette') {
      applyPaletteToBody();
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
    }
  });
}

// Reflect the in-memory `filters` state back into the DOM controls. Used
// after restoring a permalink so the toggles match what was applied.
function syncFilterUiFromState() {
  if (els.yearMin) els.yearMin.value = String(filters.yearMin);
  if (els.yearMax) els.yearMax.value = String(filters.yearMax);
  // Highlight year filter row when a non-default year range is selected
  const yearFilterRow = document.querySelector('.filter-row--year');
  const yearActive = isYearFiltered(filters, yearDefaults());
  if (yearFilterRow) yearFilterRow.classList.toggle('active-filter', yearActive);
  els.catBtns.forEach((btn) => {
    const cat = btn.dataset.cat;
    const on = filters.categories.has(cat);
    btn.classList.toggle('active', on);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  if (els.stateFilter) els.stateFilter.value = filters.state;
  if (els.showTracks) els.showTracks.checked = filters.showTracks;
  if (els.showHeatmap) els.showHeatmap.checked = filters.showHeatmap;
  if (els.showRetiredOnly) els.showRetiredOnly.checked = filters.retiredOnly;
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
    ? `${visible.length.toLocaleString()} landfalls`
    : `${visible.length.toLocaleString()} of ${totalLandfalls.toLocaleString()}`;
  els.visibleCount.textContent = countText;
  announceToLiveRegion(`Showing ${countText}`);
  updateFilterResetState();
  if (filters.showTracks) {
    redrawTracks(visible);
  } else {
    clearTracks();
  }
  setHeatmap(filters.showHeatmap, visible);
  refreshTimelineScope();
  highlightYearRange(filters.yearMin, filters.yearMax);
  refreshSeasonSummary({ yearMin: filters.yearMin, yearMax: filters.yearMax });
  writeHash();
}

function updateFilterResetState() {
  if (!els.resetFilters) return;
  const active = hasActiveFilters(filters, yearDefaults(), {
    surgeCategory: els.surgeCategory?.value,
    showPopulation: els.showPopulation?.checked,
    showSST: els.showSST?.checked,
  });
  els.resetFilters.disabled = !active;
  els.resetFilters.title = active ? 'Reset all filters and map layers' : 'No active filters';
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
  wireFilterPanel();

  // Year inputs
  const onYearChange = () => {
    if (setYearRange(filters, els.yearMin.value, els.yearMax.value, yearDefaults())) {
      applyFilters();
    }
  };
  els.yearMin.addEventListener('change', onYearChange);
  els.yearMax.addEventListener('change', onYearChange);
  
  // Escape key resets year filter to full range
  els.yearMin.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      resetYearRange(filters, yearDefaults());
      syncFilterUiFromState();
      applyFilters();
    }
  });
  els.yearMax.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      resetYearRange(filters, yearDefaults());
      syncFilterUiFromState();
      applyFilters();
    }
  });

  // Clear year filter button
  if (els.clearYearFilter) {
    els.clearYearFilter.addEventListener('click', () => {
      resetYearRange(filters, yearDefaults());
      syncFilterUiFromState();
      applyFilters();
    });
  }

  // Category toggles
  for (const btn of els.catBtns) {
    btn.setAttribute('aria-pressed', String(btn.classList.contains('on')));
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      const on = toggleCategory(filters, cat);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
      applyFilters();
    });
  }

  // State filter — additionally opens the state deep-dive panel when set.
  els.stateFilter.addEventListener('change', () => {
    filters.state = els.stateFilter.value;
    applyFilters();
    if (filters.state) openStateLazy(filters.state);
  });

  // Search
  // Warm the storms cache as soon as the user focuses the search input so that
  // sparklines can render without a perceptible lag on the first keystroke.
  els.searchInput.addEventListener('focus', () => { ensureStormsLoaded(); }, { once: true });
  // History dropdown when input is focused with empty value.
  els.searchInput.addEventListener('focus', () => {
    if (els.searchInput.value.trim()) return;
    showHistoryDropdown();
  });

  function setSearchOpen(open) {
    els.searchResults.hidden = !open;
    els.searchInput.setAttribute('aria-expanded', String(open));
    if (!open) {
      activeSearchIndex = -1;
      els.searchInput.removeAttribute('aria-activedescendant');
      els.searchResults.querySelectorAll('[aria-selected="true"]').forEach(el => el.setAttribute('aria-selected', 'false'));
    }
  }

  function getSearchOptions() {
    return [...els.searchResults.querySelectorAll('li[data-storm-id]')];
  }

  function updateActiveSearchOption(nextIndex) {
    const options = getSearchOptions();
    if (!options.length) return;
    activeSearchIndex = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
      const active = index === activeSearchIndex;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
      if (!option.id) option.id = `search-option-${option.dataset.stormId}-${index}`;
      if (active) {
        els.searchInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function showHistoryDropdown() {
    const history = getHistory();
    if (!history.length) return;
    setSearchOpen(true);
    els.searchResults.innerHTML = `<li class="search-section-label" aria-hidden="true">Recently viewed</li>` +
      history.map(h => {
        const name = escapeHtml(formatStormName(h.name));
        const cat = escapeHtml(categoryLabel(h.category));
        const state = escapeHtml(h.state || '');
        const stormId = escapeHtml(h.storm_id);
        return `<li data-storm-id="${stormId}" data-t="${escapeHtml(h.t)}" data-lat="${escapeHtml(h.lat)}" data-lon="${escapeHtml(h.lon)}" role="option" tabindex="-1">
          <span class="search-result-spark-host" data-storm-id="${stormId}" aria-hidden="true"></span>
          <span class="search-result-text"><strong>${escapeHtml(h.year)}</strong> ${name} <span class="search-result-meta">· ${cat} ${state}</span></span>
        </li>`;
      }).join('');
    backfillSparklines();
    wireResultClicks();
  }

  function backfillSparklines() {
    ensureStormsLoaded().then(() => {
      for (const host of els.searchResults.querySelectorAll('.search-result-spark-host')) {
        const storm = getStorm(host.dataset.stormId);
        if (storm && storm.track) {
          host.innerHTML = buildSparkline(storm.track, { title: `${storm.name || 'Storm'} ${storm.year || ''} wind profile` });
        }
      }
    });
  }

  function showNoSearchResults(query) {
    const safeQuery = escapeHtml(query.trim());
    setSearchOpen(true);
    els.searchResults.innerHTML = `
      <li class="search-empty" role="status">
        <strong>No storm matches "${safeQuery}"</strong>
        <span>Try a storm name, state, or year, such as Andrew, Florida, or 2005.</span>
      </li>
    `;
  }

  function wireResultClicks() {
    for (const li of els.searchResults.querySelectorAll('li[data-storm-id]')) {
      li.addEventListener('click', () => {
        // Resolve via getLandfalls so we always click a real, current landfall record.
        const lf = getLandfalls().find(x =>
          x.storm_id === li.dataset.stormId &&
          x.t === li.dataset.t &&
          String(x.lat) === li.dataset.lat
        ) || getLandfalls().find(x => x.storm_id === li.dataset.stormId);
        if (lf) onLandfallClick(lf);
        setSearchOpen(false);
        els.searchInput.value = '';
      });
    }
  }

  els.searchInput.addEventListener('keydown', (e) => {
    if (els.searchResults.hidden) return;
    const options = getSearchOptions();
    if (!options.length) {
      if (e.key === 'Escape') setSearchOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateActiveSearchOption(activeSearchIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateActiveSearchOption(activeSearchIndex - 1);
    } else if (e.key === 'Enter' && activeSearchIndex >= 0) {
      e.preventDefault();
      options[activeSearchIndex].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchOpen(false);
    }
  });

  els.searchInput.addEventListener('input', () => {
    const q = els.searchInput.value;
    if (!q.trim()) {
      // Empty query → show history dropdown if any.
      const history = getHistory();
      if (history.length) { showHistoryDropdown(); return; }
      setSearchOpen(false);
      els.searchResults.innerHTML = '';
      return;
    }
    let results = searchStorms(q, getLandfalls());
    let fuzzy = [];
    if (results.length < 5) {
      fuzzy = fuzzyAugment(q, getLandfalls(), results, { limit: 5 });
    }
    if (!results.length && !fuzzy.length) {
      showNoSearchResults(q);
      return;
    }
    setSearchOpen(true);
    const renderRow = (lf) => {
      const name = formatStormName(lf.name);
      const cat = categoryLabel(lf.category);
      const safeName = escapeHtml(name);
      const safeState = escapeHtml(lf.state || '');
      const safeStormId = escapeHtml(lf.storm_id);
      return `<li data-storm-id="${safeStormId}" data-t="${escapeHtml(lf.t)}" data-lat="${escapeHtml(lf.lat)}" data-lon="${escapeHtml(lf.lon)}" role="option" tabindex="-1">
        <span class="search-result-spark-host" data-storm-id="${safeStormId}" aria-hidden="true"></span>
        <span class="search-result-text"><strong>${escapeHtml(lf.year)}</strong> ${safeName} <span class="search-result-meta">· ${escapeHtml(cat)} ${safeState}</span></span>
      </li>`;
    };
    let html = results.map(renderRow).join('');
    if (fuzzy.length) {
      html += `<li class="search-section-label" aria-hidden="true">Did you mean…</li>`;
      html += fuzzy.map(renderRow).join('');
    }
    els.searchResults.innerHTML = html;
    updateActiveSearchOption(0);
    backfillSparklines();
    wireResultClicks();
  });
  els.searchInput.addEventListener('blur', () => {
    setTimeout(() => { setSearchOpen(false); }, 180);
  });

  // Tracks toggle
  els.showTracks.addEventListener('change', () => {
    filters.showTracks = els.showTracks.checked;
    applyFilters();
  });

  // Heatmap toggle
  els.showHeatmap.addEventListener('change', () => {
    filters.showHeatmap = els.showHeatmap.checked;
    applyFilters();
  });

  if (els.showRetiredOnly) {
    els.showRetiredOnly.addEventListener('change', () => {
      filters.retiredOnly = els.showRetiredOnly.checked;
      applyFilters();
    });
  }

  // Storm-surge SLOSH MOM tile layer (per category).
  els.surgeCategory.addEventListener('change', () => {
    const v = parseInt(els.surgeCategory.value, 10);
    setSurgeCategoryLazy(Number.isFinite(v) && v > 0 ? v : null);
  });

  // Population density overlay.
  els.showPopulation.addEventListener('change', () => {
    setPopulationLazy(els.showPopulation.checked);
  });

  // Sea surface temperature overlay.
  if (els.showSST) {
    els.showSST.addEventListener('change', async () => {
      const { setSSTVisible } = await loadSST();
      setSSTVisible(els.showSST.checked);
      updateFilterResetState();
    });
  }

  // Reset
  els.resetFilters.addEventListener('click', async () => {
    resetPrimaryFilters(filters, yearDefaults());
    syncFilterUiFromState();
    els.surgeCategory.value = '';
    els.showPopulation.checked = false;
    setSurgeCategoryLazy(null);
    setPopulationLazy(false);
    if (els.showSST?.checked) {
      els.showSST.checked = false;
      const { setSSTVisible } = await loadSST();
      setSSTVisible(false);
    }
    lastTracksKey = '';
    applyFilters();
  });

  // Escape resets the year filter only when focus is inside the year controls.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.defaultPrevented) return;
    if (document.activeElement !== els.yearMin && document.activeElement !== els.yearMax) return;
    if (filters.yearMin === YEAR_MIN_DEFAULT && filters.yearMax === YEAR_MAX_DEFAULT) return;
    resetYearRange(filters, yearDefaults());
    syncFilterUiFromState();
    applyFilters();
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

  wireMobileActionsMenu();

  // Info modal
  els.toggleInfoBtn.addEventListener('click', () => { els.infoModal.hidden = false; });
  els.closeInfo.addEventListener('click', () => { els.infoModal.hidden = true; });
  els.infoModal.addEventListener('click', (e) => {
    if (e.target === els.infoModal) els.infoModal.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.infoModal.hidden) {
      e.preventDefault();
      els.infoModal.hidden = true;
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

function wireMobileActionsMenu() {
  const trigger = els.toggleMobileActionsBtn;
  const menu = els.mobileActionsMenu;
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

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.dataset.open === 'true') closeMenu();
    else openMenu();
  });

  menu.addEventListener('click', (event) => {
    if (event.target.closest('.icon-btn')) {
      closeMenu();
    }
  }, true);

  document.addEventListener('click', (event) => {
    if (menu.dataset.open !== 'true') return;
    if (menu.contains(event.target) || event.target === trigger) return;
    closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (menu.dataset.open !== 'true') return;
    event.preventDefault();
    closeMenu({ restoreFocus: true });
  });
}

function wireFilterPanel() {
  if (!els.toggleFiltersBtn || !els.filtersPanel) return;
  const mobileQuery = window.matchMedia('(max-width: 720px)');
  let userChanged = false;

  const setCollapsed = (collapsed) => {
    els.filtersPanel.classList.toggle('collapsed', collapsed);
    els.toggleFiltersBtn.setAttribute('aria-expanded', String(!collapsed));
    els.toggleFiltersBtn.setAttribute('aria-label', collapsed ? 'Show filters' : 'Hide filters');
    els.toggleFiltersBtn.title = collapsed ? 'Show filters' : 'Hide filters';
  };

  setCollapsed(mobileQuery.matches);
  els.toggleFiltersBtn.addEventListener('click', () => {
    userChanged = true;
    setCollapsed(!els.filtersPanel.classList.contains('collapsed'));
  });

  const onViewportChange = () => {
    if (!userChanged) setCollapsed(mobileQuery.matches);
  };
  if (mobileQuery.addEventListener) {
    mobileQuery.addEventListener('change', onViewportChange);
  } else if (mobileQuery.addListener) {
    mobileQuery.addListener(onViewportChange);
  }
}

boot().catch(err => {
  console.error('[boot] Boot failed', err);
  const safeMsg = escapeHtml(err.message || 'Unknown error');
  els.loading.innerHTML = `
    <div class="boot-error-state" role="alert">
      <strong>HurricaneMap could not load its data.</strong>
      <span>${safeMsg}</span>
      <span>If this file was opened directly, serve the folder first: <code>python -m http.server 8765</code>.</span>
      <button class="text-btn boot-retry-btn" type="button">Retry</button>
    </div>`;
  els.loading.querySelector('.boot-retry-btn')?.addEventListener('click', () => window.location.reload());
});

initServiceWorkerUpdates();
