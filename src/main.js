// HurricaneMap entry point.
import {
  loadInitial, getLandfalls, getStats, filterLandfalls,
  searchStorms, categoryLabel, ensureStormsLoaded, getStorm,
} from './data.js';
import { initMap, renderLandfalls, focusLandfall, fitToLandfalls, showTrack, clearTracks, setHeatmap } from './map.js';
import { showStorm } from './panel.js';
import { toggleStats } from './stats.js';
import { showOnThisDate } from './on-this-date.js';
import './compare.js';  // wires up the Compare button + pin tray
import { enableStateClicks, openState } from './state.js';
import { setSurgeCategory } from './surge.js';
import { startActiveStormPolling } from './active.js';
import { setPopulation } from './population.js';
import { applyPaletteToBody, applyThemeToRoot, getSetting, setSetting } from './settings.js';
import { initLocale, setLocale } from './i18n.js';
import { maybeStartOnboarding } from './onboarding.js';
import { mountTimeline, highlightYearRange } from './timeline.js';
import { buildSparkline } from './sparkline.js';
import { refreshSeasonSummary } from './season.js';
import { fuzzyAugment } from './fuzzy.js';
import { recordView, getHistory } from './search-history.js';
import { initPerformanceMonitoring } from './perf.js';
import { initGlossary, showGlossary } from './glossary.js';
import { init as initKeyboard } from './keyboard.js';
import { exportPublicationCSV } from './export.js';
import { generateStatisticalReport, downloadReportAsText } from './report.js';
import { exportQGISGeoJSON } from './qgis.js';
import { escapeHtml } from './html-utils.js';

const filters = {
  yearMin: 1851,
  yearMax: 2025,
  categories: new Set(['ts', '1', '2', '3', '4', '5']),
  state: '',
  showTracks: false,
  showHeatmap: false,
};

// Track currently-opened storm so URL hash can encode it.
let openStormId = null;
let activeSearchIndex = -1;

// ---------------- URL hash state (permalinks) ----------------
// Format: #y=1990-2025&c=3,4,5&s=Florida&t=1&h=0&storm=AL092005
// Falsy/default values are omitted to keep links short.
const DEFAULT_HASH = {
  y: '1851-2025',
  c: 'ts,1,2,3,4,5',
  s: '',
  t: '0',
  h: '0',
  storm: '',
};

function encodeHash() {
  const cur = {
    y: `${filters.yearMin}-${filters.yearMax}`,
    c: [...filters.categories].sort().join(','),
    s: filters.state,
    t: filters.showTracks ? '1' : '0',
    h: filters.showHeatmap ? '1' : '0',
    storm: openStormId || '',
  };
  const parts = [];
  for (const k of Object.keys(cur)) {
    if (cur[k] && cur[k] !== DEFAULT_HASH[k]) {
      parts.push(`${k}=${encodeURIComponent(cur[k])}`);
    }
  }
  return parts.length ? '#' + parts.join('&') : '';
}

function writeHash() {
  const newHash = encodeHash();
  // Avoid re-firing hashchange when nothing actually changed.
  const cur = location.hash || '';
  if (cur === newHash) return;
  history.replaceState(null, '', newHash || location.pathname + location.search);
}

function decodeHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return null;
  const out = {};
  for (const pair of h.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq);
    const v = decodeURIComponent(pair.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

function applyHashToFilters() {
  const h = decodeHash();
  if (!h) return null;
  if (h.y && /^\d{4}-\d{4}$/.test(h.y)) {
    const [a, b] = h.y.split('-').map(Number);
    filters.yearMin = Math.max(1851, Math.min(a, b));
    filters.yearMax = Math.min(2025, Math.max(a, b));
  }
  if (h.c) {
    filters.categories = new Set(h.c.split(',').filter(Boolean));
  }
  if (h.s !== undefined) filters.state = h.s;
  if (h.t !== undefined) filters.showTracks = h.t === '1';
  if (h.h !== undefined) filters.showHeatmap = h.h === '1';
  return h;
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
  surgeCategory: document.getElementById('surge-category'),
  showPopulation: document.getElementById('show-population'),
  resetFilters: document.getElementById('reset-filters'),
  visibleCount: document.getElementById('visible-count'),
  stormCount: document.getElementById('storm-count'),
  toggleFiltersBtn: document.getElementById('toggle-filters'),
  toggleStatsBtn: document.getElementById('toggle-stats'),
  toggleOnThisDateBtn: document.getElementById('toggle-on-this-date'),
  toggleInfoBtn: document.getElementById('toggle-info'),
  exportBtn: document.getElementById('export-publication'),
  reportBtn: document.getElementById('generate-report'),
  qgisBtn: document.getElementById('export-qgis'),
  infoModal: document.getElementById('info-modal'),
  closeInfo: document.getElementById('close-info'),
  loading: document.getElementById('loading'),
};

async function boot() {
  // Initialize locale (before any rendering)
  initLocale();
  const savedLocale = getSetting('locale');
  if (savedLocale) setLocale(savedLocale);

  // Start performance monitoring early
  initPerformanceMonitoring();
  
  applyThemeToRoot();
  applyPaletteToBody();
  // Apply high-contrast mode if enabled
  if (getSetting('highContrast')) {
    document.documentElement.classList.add('high-contrast');
  }
  const map = initMap();
  await loadInitial();
  populateStateFilter();
  // Restore filters from URL hash BEFORE first render so the user's
  // permalink reproduces what they shared.
  const restored = applyHashToFilters();
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
  enableStateClicks(map).catch(() => { /* non-fatal */ });
  // Live NHC active-storm feed — appears only when a storm is active.
  startActiveStormPolling().catch(() => { /* non-fatal */ });
  els.stormCount.textContent = `${getStats().total_storms.toLocaleString()} storms · ${getStats().total_landfall_events.toLocaleString()} landfalls`;
  
  // Initialize glossary (loads data asynchronously, non-blocking)
  initGlossary().catch(() => { /* non-fatal */ });
  
  // Initialize keyboard shortcuts and navigation
  // Wire macro filter functions to window
  window.filterByMacro = (mode) => {
    if (mode === 'major') {
      // Major hurricanes only (Cat 3-5)
      filters.categories = new Set(['3', '4', '5']);
    } else if (mode === 'tropical') {
      // Tropical storms only
      filters.categories = new Set(['ts']);
    }
    syncFilterUiFromState();
    applyFilters();
  };
  initKeyboard();
  
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
    setTimeout(() => openState(restored.s), 80);
  }
  // Onboarding disabled — users go straight to the map with no interruption.
  // setTimeout(() => maybeStartOnboarding(), 600);
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
    const ensembleToggle = menu.querySelector('#toggle-ensemble-tracks');
    if (ensembleToggle) {
      ensembleToggle.checked = getSetting('ensembleTracks');
    }
    const hcToggle = menu.querySelector('#toggle-high-contrast');
    if (hcToggle) {
      hcToggle.checked = getSetting('highContrast');
    }
  }
  syncMenu();

  cog.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hasAttribute('hidden') ? false : true;
    if (open) {
      menu.setAttribute('hidden', '');
      cog.setAttribute('aria-expanded', 'false');
    } else {
      menu.removeAttribute('hidden');
      cog.setAttribute('aria-expanded', 'true');
      syncMenu();
    }
  });
  document.addEventListener('click', (e) => {
    if (menu.hasAttribute('hidden')) return;
    if (!menu.contains(e.target) && e.target !== cog) {
      menu.setAttribute('hidden', '');
      cog.setAttribute('aria-expanded', 'false');
    }
  });
  // ESC closes the settings menu and returns focus to the cog button.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menu.hasAttribute('hidden')) return;
    menu.setAttribute('hidden', '');
    cog.setAttribute('aria-expanded', 'false');
    cog.focus();
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

  // Ensemble tracks toggle
  const ensembleToggle = menu.querySelector('#toggle-ensemble-tracks');
  if (ensembleToggle) {
    ensembleToggle.addEventListener('change', () => {
      setSetting('ensembleTracks', ensembleToggle.checked);
    });
  }

  // High-contrast accessibility toggle
  const hcToggle = menu.querySelector('#toggle-high-contrast');
  if (hcToggle) {
    hcToggle.addEventListener('change', () => {
      setSetting('highContrast', hcToggle.checked);
    });
  }

  const replayTour = menu.querySelector('#replay-tour');
  if (replayTour) {
    replayTour.addEventListener('click', () => {
      menu.setAttribute('hidden', '');
      cog.setAttribute('aria-expanded', 'false');
      maybeStartOnboarding({ force: true });
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
  const isYearFiltered = filters.yearMin > 1851 || filters.yearMax < 2025;
  if (yearFilterRow) yearFilterRow.classList.toggle('active-filter', isYearFiltered);
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

function applyFilters() {
  const visible = filterLandfalls(getLandfalls(), filters);
  renderLandfalls(visible, onLandfallClick);
  const totalLandfalls = getLandfalls().length;
  els.visibleCount.textContent = visible.length === totalLandfalls
    ? `${visible.length.toLocaleString()} landfalls`
    : `${visible.length.toLocaleString()} of ${totalLandfalls.toLocaleString()}`;
  updateFilterResetState();
  if (filters.showTracks) {
    redrawTracks(visible);
  } else {
    clearTracks();
  }
  setHeatmap(filters.showHeatmap, visible);
  highlightYearRange(filters.yearMin, filters.yearMax);
  refreshSeasonSummary({ yearMin: filters.yearMin, yearMax: filters.yearMax });
  writeHash();
}

function hasActiveFilters() {
  return filters.yearMin !== 1851 ||
    filters.yearMax !== 2025 ||
    filters.state !== '' ||
    filters.showTracks ||
    filters.showHeatmap ||
    filters.categories.size !== 6 ||
    !['ts', '1', '2', '3', '4', '5'].every(cat => filters.categories.has(cat)) ||
    Boolean(els.surgeCategory?.value) ||
    Boolean(els.showPopulation?.checked);
}

function updateFilterResetState() {
  if (!els.resetFilters) return;
  const active = hasActiveFilters();
  els.resetFilters.disabled = !active;
  els.resetFilters.title = active ? 'Reset all filters and map layers' : 'No active filters';
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
  showStorm(landfall);
  openStormId = landfall.storm_id;
  recordView(landfall);
  writeHash();
}

document.addEventListener('storm-panel:close', () => {
  openStormId = null;
  writeHash();
});

function wireUI() {
  wireFilterPanel();

  // Year inputs
  const onYearChange = () => {
    const a = parseInt(els.yearMin.value, 10);
    const b = parseInt(els.yearMax.value, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    filters.yearMin = Math.max(1851, Math.min(a, b));
    filters.yearMax = Math.min(2025, Math.max(a, b));
    applyFilters();
  };
  els.yearMin.addEventListener('change', onYearChange);
  els.yearMax.addEventListener('change', onYearChange);
  
  // Escape key resets year filter to full range
  els.yearMin.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      filters.yearMin = 1851;
      filters.yearMax = 2025;
      syncFilterUiFromState();
      applyFilters();
    }
  });
  els.yearMax.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      filters.yearMin = 1851;
      filters.yearMax = 2025;
      syncFilterUiFromState();
      applyFilters();
    }
  });

  // Clear year filter button
  if (els.clearYearFilter) {
    els.clearYearFilter.addEventListener('click', () => {
      filters.yearMin = 1851;
      filters.yearMax = 2025;
      syncFilterUiFromState();
      applyFilters();
    });
  }

  // Category toggles
  for (const btn of els.catBtns) {
    btn.setAttribute('aria-pressed', String(btn.classList.contains('on')));
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (filters.categories.has(cat)) {
        filters.categories.delete(cat);
        btn.classList.remove('on');
      } else {
        filters.categories.add(cat);
        btn.classList.add('on');
      }
      btn.setAttribute('aria-pressed', String(filters.categories.has(cat)));
      applyFilters();
    });
  }

  // State filter — additionally opens the state deep-dive panel when set.
  els.stateFilter.addEventListener('change', () => {
    filters.state = els.stateFilter.value;
    applyFilters();
    if (filters.state) openState(filters.state);
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
        const name = (h.name === 'UNNAMED') ? 'Unnamed' : titleCase(h.name);
        const cat = categoryLabel(h.category);
        return `<li data-storm-id="${h.storm_id}" data-t="${h.t}" data-lat="${h.lat}" data-lon="${h.lon}" role="option" tabindex="-1">
          <span class="search-result-spark-host" data-storm-id="${h.storm_id}" aria-hidden="true"></span>
          <span class="search-result-text"><strong>${h.year}</strong> ${name} <span class="search-result-meta">· ${cat} ${h.state || ''}</span></span>
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
      const name = (lf.name === 'UNNAMED') ? 'Unnamed' : titleCase(lf.name);
      const cat = categoryLabel(lf.category);
      const safeName = escapeHtml(name);
      const safeState = escapeHtml(lf.state || '');
      return `<li data-storm-id="${lf.storm_id}" data-t="${lf.t}" data-lat="${lf.lat}" data-lon="${lf.lon}" role="option" tabindex="-1">
        <span class="search-result-spark-host" data-storm-id="${lf.storm_id}" aria-hidden="true"></span>
        <span class="search-result-text"><strong>${lf.year}</strong> ${safeName} <span class="search-result-meta">· ${cat} ${safeState}</span></span>
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

  // Storm-surge SLOSH MOM tile layer (per category).
  els.surgeCategory.addEventListener('change', () => {
    const v = parseInt(els.surgeCategory.value, 10);
    setSurgeCategory(Number.isFinite(v) && v > 0 ? v : null);
  });

  // Population density overlay.
  els.showPopulation.addEventListener('change', () => {
    setPopulation(els.showPopulation.checked);
  });

  // Reset
  els.resetFilters.addEventListener('click', () => {
    filters.yearMin = 1851; filters.yearMax = 2025;
    filters.categories = new Set(['ts', '1', '2', '3', '4', '5']);
    filters.state = '';
    filters.showTracks = false;
    filters.showHeatmap = false;
    syncFilterUiFromState();
    els.surgeCategory.value = '';
    els.showPopulation.checked = false;
    setSurgeCategory(null);
    setPopulation(false);
    lastTracksKey = '';
    applyFilters();
  });

  // Escape key: reset year filter if one is active
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Only reset if year filter is active (not full range)
    if (filters.yearMin === 1851 && filters.yearMax === 2025) return;
    // Reset to full range
    filters.yearMin = 1851;
    filters.yearMax = 2025;
    syncFilterUiFromState();
    applyFilters();
  });

  // Stats panel toggle
  els.toggleStatsBtn.addEventListener('click', toggleStats);

  // On this date panel
  els.toggleOnThisDateBtn.addEventListener('click', showOnThisDate);

  // Info modal
  els.toggleInfoBtn.addEventListener('click', () => { els.infoModal.hidden = false; });
  els.closeInfo.addEventListener('click', () => { els.infoModal.hidden = true; });
  els.infoModal.addEventListener('click', (e) => {
    if (e.target === els.infoModal) els.infoModal.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.infoModal.hidden) els.infoModal.hidden = true;
  });

  // Export button
  if (els.exportBtn) {
    els.exportBtn.addEventListener('click', () => {
      exportPublicationCSV(filters);
    });
  }

  // Report button
  if (els.reportBtn) {
    els.reportBtn.addEventListener('click', () => {
      const { markdown, title } = generateStatisticalReport(filters);
      downloadReportAsText(markdown, title);
    });
  }

  // QGIS export button
  if (els.qgisBtn) {
    els.qgisBtn.addEventListener('click', () => {
      exportQGISGeoJSON(filters);
    });
  }

  // Glossary modal
  const glossaryBtn = document.getElementById('toggle-glossary');
  if (glossaryBtn) {
    glossaryBtn.addEventListener('click', showGlossary);
  }
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

function titleCase(name) {
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
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

// Register the service worker for offline-first behavior + tile caching.
// Skipped on file:// (where SW APIs are unavailable) and on insecure origins.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* non-fatal */ });
  });
}
