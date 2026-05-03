// State deep-dive: per-state landfall history, by-category histogram, by-decade
// trend, and a sortable list of every storm to hit that state.

import { getLandfalls, getStats, getStorm, ensureStormsLoaded, categoryLabel, categoryClass, formatTime } from './data.js';
import { showStorm } from './panel.js';

const panel = document.getElementById('state-panel');
const body = document.getElementById('state-body');
const closeBtn = document.getElementById('close-state');

if (closeBtn) closeBtn.addEventListener('click', () => { panel.hidden = true; });

let stateBoundariesPromise = null;
let stateLayer = null;

/** Lazy-load the US states geojson + draw clickable polygons on the map. */
export async function enableStateClicks(map) {
  if (stateBoundariesPromise) return stateBoundariesPromise;
  stateBoundariesPromise = fetch('data/us-states.geojson')
    .then(r => r.json())
    .then(gj => {
      stateLayer = L.geoJSON(gj, {
        style: () => ({
          color: '#cdd6f4',
          weight: 0.6,
          opacity: 0.18,
          fillColor: '#cdd6f4',
          fillOpacity: 0,
          interactive: true,
        }),
        onEachFeature: (feature, layer) => {
          const name = feature.properties.name;
          layer.on('mouseover', () => {
            layer.setStyle({ opacity: 0.5, fillOpacity: 0.04 });
          });
          layer.on('mouseout', () => {
            layer.setStyle({ opacity: 0.18, fillOpacity: 0 });
          });
          layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            openState(name);
          });
        },
      }).addTo(map);
      return stateLayer;
    });
  return stateBoundariesPromise;
}

export async function openState(stateName) {
  panel.hidden = false;
  body.innerHTML = `<p class="state-loading">Loading ${escapeHtml(stateName)}…</p>`;
  await ensureStormsLoaded();

  const allLandfalls = getLandfalls();
  const stateLandfalls = allLandfalls.filter(lf => lf.state === stateName);
  const stats = getStats();
  const stateStats = stats.by_state?.[stateName];

  if (!stateLandfalls.length) {
    body.innerHTML = `
      <h2>${escapeHtml(stateName)}</h2>
      <p class="state-empty">No recorded U.S. hurricane or tropical-storm landfalls in HurricaneMap's HURDAT2 dataset for this state.</p>
      <p class="state-empty hint">${escapeHtml(stateName)} is in our coastal-state list but has never had a Saffir-Simpson Cat 1+ direct landfall on record.</p>
    `;
    return;
  }

  // Group landfalls by storm so multi-landfall storms don't double-count.
  const stormsHere = new Map(); // storm_id -> { name, year, max_cat_here, lf_count_here }
  for (const lf of stateLandfalls) {
    const e = stormsHere.get(lf.storm_id) || {
      storm_id: lf.storm_id, name: lf.name, year: lf.year, max_cat: -1, count: 0, latest: lf.t,
    };
    e.max_cat = Math.max(e.max_cat, lf.category);
    e.count += 1;
    if (lf.t > e.latest) e.latest = lf.t;
    stormsHere.set(lf.storm_id, e);
  }
  const storms = [...stormsHere.values()].sort((a, b) => b.year - a.year);

  // By-category histogram (TS, Cat 1..5)
  const catCounts = [0, 0, 0, 0, 0, 0]; // index 0 = TS, 1..5 = Cat
  for (const lf of stateLandfalls) {
    const idx = lf.category <= 0 ? 0 : Math.min(5, lf.category);
    catCounts[idx]++;
  }
  const catLabels = ['TS', 'Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5'];
  const catVarNames = ['--cat-ts', '--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5'];
  const maxCat = Math.max(...catCounts, 1);
  const catHistogramHtml = catCounts.map((n, i) => `
    <div class="bar-row">
      <span class="label">${catLabels[i]}</span>
      <span class="bar"><span class="fill" style="width:${(n / maxCat) * 100}%;background:var(${catVarNames[i]})"></span></span>
      <span class="count">${n}</span>
    </div>
  `).join('');

  // By-decade trend
  const decadeCounts = {};
  for (const lf of stateLandfalls) {
    const d = Math.floor(lf.year / 10) * 10;
    decadeCounts[d] = (decadeCounts[d] || 0) + 1;
  }
  const decadeKeys = Object.keys(decadeCounts).sort();
  const maxDec = Math.max(...Object.values(decadeCounts), 1);
  const decadeHtml = decadeKeys.map(d => `
    <div class="bar-row">
      <span class="label">${d}s</span>
      <span class="bar"><span class="fill" style="width:${(decadeCounts[d] / maxDec) * 100}%;background:linear-gradient(90deg,var(--cat-2),var(--cat-4))"></span></span>
      <span class="count">${decadeCounts[d]}</span>
    </div>
  `).join('');

  // Worst landfalls (top 5 by max category, tiebreak by year)
  const worst = [...stormsHere.values()]
    .sort((a, b) => b.max_cat - a.max_cat || b.year - a.year)
    .slice(0, 5);

  const worstHtml = worst.map(s => {
    const cat = categoryLabel(s.max_cat);
    const cls = categoryClass(s.max_cat);
    return `
      <li class="state-storm-row" data-storm-id="${s.storm_id}">
        <span class="cat-pill ${cls}">${cat}</span>
        <span class="ssr-name">${escapeHtml(titleCase(s.name))}</span>
        <span class="ssr-year">${s.year}</span>
      </li>
    `;
  }).join('');

  // Full sortable storm list
  const fullListHtml = storms.map(s => {
    const cat = categoryLabel(s.max_cat);
    const cls = categoryClass(s.max_cat);
    return `
      <li class="state-storm-row" data-storm-id="${s.storm_id}">
        <span class="cat-pill ${cls}">${cat}</span>
        <span class="ssr-name">${escapeHtml(titleCase(s.name))}</span>
        <span class="ssr-year">${s.year}</span>
        <span class="ssr-count">${s.count} hit${s.count === 1 ? '' : 's'}</span>
      </li>
    `;
  }).join('');

  // Headline counters
  const total = stateLandfalls.length;
  const huCount = stateLandfalls.filter(lf => lf.category >= 1).length;
  const majorCount = stateLandfalls.filter(lf => lf.category >= 3).length;

  body.innerHTML = `
    <h2>${escapeHtml(stateName)}</h2>
    <p class="state-sub">Every hurricane and tropical-storm landfall on record (HURDAT2, 1851 onward).</p>

    <div class="stat-grid">
      <div class="stat"><div class="label">Total events</div><div class="value">${total}</div></div>
      <div class="stat"><div class="label">Hurricane-strength</div><div class="value">${huCount}</div></div>
      <div class="stat"><div class="label">Major (Cat 3+)</div><div class="value">${majorCount}</div></div>
      <div class="stat"><div class="label">Distinct storms</div><div class="value">${storms.length}</div></div>
    </div>

    <h3 class="panel-section-h3">By category</h3>
    ${catHistogramHtml}

    <h3 class="panel-section-h3">By decade</h3>
    ${decadeHtml}

    ${worst.length ? `
      <h3 class="panel-section-h3">Worst on record (top ${worst.length})</h3>
      <ul class="state-storm-list">${worstHtml}</ul>
    ` : ''}

    <h3 class="panel-section-h3">All storms (newest first)</h3>
    <ul class="state-storm-list">${fullListHtml}</ul>
  `;

  // Wire up clickable storm rows.
  body.querySelectorAll('.state-storm-row').forEach((row) => {
    row.addEventListener('click', async () => {
      const sid = row.dataset.stormId;
      const storm = getStorm(sid);
      if (!storm || !storm.us_landfalls?.length) return;
      // Find the first landfall in this state to focus the storm panel on.
      const lf = storm.us_landfalls.find(l => l.state === stateName) || storm.us_landfalls[0];
      showStorm({ ...lf, storm_id: sid });
    });
  });
}

function titleCase(name) {
  if (!name || name === 'UNNAMED') return 'Unnamed';
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
