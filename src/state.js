// State deep-dive: per-state landfall history, by-category histogram, by-decade
// trend, and a sortable list of every storm to hit that state.

import { getLandfalls, getStorm, ensureStormsLoaded, categoryLabel, categoryClass } from './data.js';
import { showStorm } from './panel.js';
import { hidePanel, showPanel } from './panels.js';
import { redraw } from './timeline.js';
import { escapeHtml } from './html-utils.js';

const panel = document.getElementById('state-panel');
const body = document.getElementById('state-body');
const closeBtn = document.getElementById('close-state');

if (closeBtn) closeBtn.addEventListener('click', () => {
  hidePanel('state-panel');
});

let stateBoundariesPromise = null;
let stateLayer = null;

/** Lazy-load the US states geojson + draw clickable polygons on the map.
 *  IMPORTANT: state polygons live in a custom pane below the default
 *  overlayPane so the landfall markers (circle dots) sit above them and
 *  always intercept clicks first. Otherwise clicking a dot inside Florida
 *  would select Florida instead of the storm. */
export async function enableStateClicks(map) {
  if (stateBoundariesPromise) return stateBoundariesPromise;
  // Custom pane with z-index lower than overlayPane (400). Markers stay on top.
  if (!map.getPane('statesPane')) {
    map.createPane('statesPane');
    map.getPane('statesPane').style.zIndex = 350;
  }
  stateBoundariesPromise = fetch('data/us-states.geojson')
    .then(r => r.json())
    .then(gj => {
      stateLayer = L.geoJSON(gj, {
        pane: 'statesPane',
        style: () => ({
          color: '#aab7ff',
          weight: 0.8,
          opacity: 0.42,
          fillColor: '#64d2ff',
          fillOpacity: 0,
          interactive: true,
        }),
        onEachFeature: (feature, layer) => {
          const name = feature.properties.name;
          layer.on('mouseover', () => {
            layer.setStyle({ opacity: 0.9, weight: 1.3, fillOpacity: 0.06 });
          });
          layer.on('mouseout', () => {
            layer.setStyle({ opacity: 0.42, weight: 0.8, fillOpacity: 0 });
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
  showPanel('state-panel');
  body.innerHTML = `<p class="state-loading">Loading ${escapeHtml(stateName)}…</p>`;
  await ensureStormsLoaded();

  const allLandfalls = getLandfalls();
  const stateLandfalls = allLandfalls.filter(lf => lf.state === stateName);

  // Update timeline to show only this state's storms
  redraw(stateLandfalls);

  if (!stateLandfalls.length) {
    body.innerHTML = `
      <h2 id="state-panel-title">${escapeHtml(stateName)}</h2>
      <div class="state-empty empty-state">
        <strong>No recorded landfalls here.</strong>
        <span>${escapeHtml(stateName)} is in the coastal-state reference set, but HurricaneMap has no HURDAT2 tropical-storm or hurricane landfall events for it.</span>
      </div>
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
  const catHistogramHtml = catCounts.map((n, i) => {
    const pct = (n / maxCat) * 100;
    const color = `var(${catVarNames[i]})`;
    return `
    <div class="bar-row state-cat-row">
      <span class="label">${catLabels[i]}</span>
      <span class="bar" style="background:rgba(170,183,255,0.06)"><span class="fill" style="width:${pct}%;background:${color};opacity:0.8"></span></span>
      <span class="count" style="color:${color};font-weight:600">${n}</span>
    </div>
  `;
  }).join('');

  // By-decade trend
  const decadeCounts = {};
  for (const lf of stateLandfalls) {
    const d = Math.floor(lf.year / 10) * 10;
    decadeCounts[d] = (decadeCounts[d] || 0) + 1;
  }
  const decadeKeys = Object.keys(decadeCounts).sort();
  const maxDec = Math.max(...Object.values(decadeCounts), 1);
  const decadeHtml = decadeKeys.map(d => {
    const pct = (decadeCounts[d] / maxDec) * 100;
    return `
    <div class="bar-row state-decade-row">
      <span class="label">${d}s</span>
      <span class="bar" style="background:rgba(170,183,255,0.06)"><span class="fill" style="width:${pct}%;background:linear-gradient(90deg,var(--cat-2),var(--cat-4));opacity:0.8"></span></span>
      <span class="count" style="color:var(--cat-3);font-weight:600">${decadeCounts[d]}</span>
    </div>
  `;
  }).join('');

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

  const fullListHtml = renderStateStormRows(sortStateStorms(storms, 'newest'));

  // Headline counters
  const total = stateLandfalls.length;
  const huCount = stateLandfalls.filter(lf => lf.category >= 1).length;
  const majorCount = stateLandfalls.filter(lf => lf.category >= 3).length;

  body.innerHTML = `
    <h2 id="state-panel-title">${escapeHtml(stateName)}</h2>
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

    <div class="state-list-head">
      <h3 class="panel-section-h3">All storms</h3>
      <div class="segmented-control state-sort" role="group" aria-label="Sort state storm list">
        <button class="seg-btn active" type="button" data-sort="newest" aria-pressed="true">Newest</button>
        <button class="seg-btn" type="button" data-sort="strongest" aria-pressed="false">Strongest</button>
        <button class="seg-btn" type="button" data-sort="hits" aria-pressed="false">Most hits</button>
      </div>
    </div>
    <ul class="state-storm-list" id="state-storm-list">${fullListHtml}</ul>
  `;

  wireStateStormRows(body, stateName);
  const list = body.querySelector('#state-storm-list');
  const sortButtons = body.querySelectorAll('.state-sort .seg-btn');
  sortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.sort || 'newest';
      sortButtons.forEach((b) => {
        const isActive = b === button;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', String(isActive));
      });
      list.innerHTML = renderStateStormRows(sortStateStorms(storms, mode));
      wireStateStormRows(list, stateName);
    });
  });
}

function sortStateStorms(storms, mode) {
  const sorted = [...storms];
  if (mode === 'strongest') {
    return sorted.sort((a, b) => b.max_cat - a.max_cat || b.year - a.year || titleCase(a.name).localeCompare(titleCase(b.name)));
  }
  if (mode === 'hits') {
    return sorted.sort((a, b) => b.count - a.count || b.max_cat - a.max_cat || b.year - a.year);
  }
  return sorted.sort((a, b) => b.year - a.year || b.max_cat - a.max_cat || titleCase(a.name).localeCompare(titleCase(b.name)));
}

function renderStateStormRows(storms) {
  return storms.map(s => {
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
}

function wireStateStormRows(container, stateName) {
  container.querySelectorAll('.state-storm-row').forEach((row) => {
    row.addEventListener('click', async () => {
      try {
        const sid = row.dataset.stormId;
        const storm = getStorm(sid);
        if (!storm || !storm.us_landfalls?.length) return;
        const lf = storm.us_landfalls.find(l => l.state === stateName) || storm.us_landfalls[0];
        await showStorm({ ...lf, storm_id: sid });
      } catch (e) {
        console.error('Failed to show storm:', e);
      }
    });
  });
}

function titleCase(name) {
  if (!name || name === 'UNNAMED') return 'Unnamed';
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}
