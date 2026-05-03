// HurricaneMap entry point.
import {
  loadInitial, getLandfalls, getStats, filterLandfalls,
  searchStorms, categoryLabel,
} from './data.js';
import { initMap, renderLandfalls, focusLandfall, fitToLandfalls, showTrack, clearTracks, setHeatmap } from './map.js';
import { showStorm } from './panel.js';
import { toggleStats } from './stats.js';
import './compare.js';  // wires up the Compare button + pin tray
import { enableStateClicks, openState } from './state.js';
import { setSurgeCategory } from './surge.js';
import { startActiveStormPolling } from './active.js';

const filters = {
  yearMin: 1851,
  yearMax: 2025,
  categories: new Set(['ts', '1', '2', '3', '4', '5']),
  state: '',
  showTracks: false,
  showHeatmap: false,
};

const els = {
  yearMin: document.getElementById('year-min'),
  yearMax: document.getElementById('year-max'),
  catBtns: document.querySelectorAll('.cat-btn'),
  stateFilter: document.getElementById('state-filter'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  showTracks: document.getElementById('show-tracks'),
  showHeatmap: document.getElementById('show-heatmap'),
  surgeCategory: document.getElementById('surge-category'),
  resetFilters: document.getElementById('reset-filters'),
  visibleCount: document.getElementById('visible-count'),
  stormCount: document.getElementById('storm-count'),
  toggleStatsBtn: document.getElementById('toggle-stats'),
  toggleInfoBtn: document.getElementById('toggle-info'),
  infoModal: document.getElementById('info-modal'),
  closeInfo: document.getElementById('close-info'),
  loading: document.getElementById('loading'),
};

async function boot() {
  const map = initMap();
  await loadInitial();
  populateStateFilter();
  applyFilters();
  wireUI();
  // State polygons (clickable for deep-dive). Lazy — fetches the geojson once.
  enableStateClicks(map).catch(() => { /* non-fatal */ });
  // Live NHC active-storm feed — appears only when a storm is active.
  startActiveStormPolling().catch(() => { /* non-fatal */ });
  els.stormCount.textContent = `${getStats().total_storms.toLocaleString()} storms · ${getStats().total_landfall_events.toLocaleString()} landfalls`;
  els.loading.classList.add('fade-out');
  setTimeout(() => { els.loading.style.display = 'none'; }, 420);
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
  els.visibleCount.textContent = `${visible.length} visible`;
  if (filters.showTracks) {
    redrawTracks(visible);
  } else {
    clearTracks();
  }
  setHeatmap(filters.showHeatmap, visible);
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
}

function wireUI() {
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

  // Category toggles
  for (const btn of els.catBtns) {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (filters.categories.has(cat)) {
        filters.categories.delete(cat);
        btn.classList.remove('on');
      } else {
        filters.categories.add(cat);
        btn.classList.add('on');
      }
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
  els.searchInput.addEventListener('input', () => {
    const q = els.searchInput.value;
    const results = searchStorms(q, getLandfalls());
    if (!results.length) {
      els.searchResults.hidden = true;
      els.searchResults.innerHTML = '';
      return;
    }
    els.searchResults.hidden = false;
    els.searchResults.innerHTML = results.map(lf => {
      const name = (lf.name === 'UNNAMED') ? 'Unnamed' : titleCase(lf.name);
      const cat = categoryLabel(lf.category);
      return `<li data-storm-id="${lf.storm_id}" data-t="${lf.t}" data-lat="${lf.lat}" data-lon="${lf.lon}">
        <strong>${lf.year}</strong> ${name} · <span style="color:var(--subtext)">${cat} ${lf.state}</span>
      </li>`;
    }).join('');
    for (const li of els.searchResults.children) {
      li.addEventListener('click', () => {
        const lf = getLandfalls().find(x =>
          x.storm_id === li.dataset.stormId &&
          x.t === li.dataset.t &&
          String(x.lat) === li.dataset.lat
        );
        if (lf) onLandfallClick(lf);
        els.searchResults.hidden = true;
        els.searchInput.value = '';
      });
    }
  });
  els.searchInput.addEventListener('blur', () => {
    setTimeout(() => { els.searchResults.hidden = true; }, 180);
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

  // Reset
  els.resetFilters.addEventListener('click', () => {
    filters.yearMin = 1851; filters.yearMax = 2025;
    els.yearMin.value = 1851; els.yearMax.value = 2025;
    filters.categories = new Set(['ts', '1', '2', '3', '4', '5']);
    for (const btn of els.catBtns) btn.classList.add('on');
    filters.state = '';
    els.stateFilter.value = '';
    filters.showTracks = false;
    els.showTracks.checked = false;
    applyFilters();
  });

  // Stats panel toggle
  els.toggleStatsBtn.addEventListener('click', toggleStats);

  // Info modal
  els.toggleInfoBtn.addEventListener('click', () => { els.infoModal.hidden = false; });
  els.closeInfo.addEventListener('click', () => { els.infoModal.hidden = true; });
  els.infoModal.addEventListener('click', (e) => {
    if (e.target === els.infoModal) els.infoModal.hidden = true;
  });
}

function titleCase(name) {
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}

boot().catch(err => {
  console.error('Boot failed', err);
  els.loading.innerHTML = `<p style="color:var(--cat-4);max-width:480px;text-align:center;padding:0 24px;">
    Failed to load data: ${err.message}<br><br>If you opened the file directly, run a local web server first
    (e.g. <code>python -m http.server</code>) — modern browsers block <code>fetch()</code> from <code>file://</code>.
  </p>`;
});
