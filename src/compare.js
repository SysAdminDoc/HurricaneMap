// Storm comparison mode — pin up to 4 storms, view their tracks color-coded
// on the map and side-by-side intensity charts in a comparison panel.

import { ensureStormsLoaded, getStorm, categoryLabel, categoryClass, ktToMph, formatTime } from './data.js';
import { getMap } from './map.js';
import { renderIntensityChart } from './chart.js';
import { hidePanel, showPanel } from './panels.js';
import { computeACE, findRapidIntensification, computeTranslationStats, computeRIRiskScore, generateStormBiography } from './metrics.js';
import { escapeHtml } from './html-utils.js';

// Leaflet is loaded from CDN as a UMD module, available as window.L
const L = window.L;

const MAX_PINS = 4;

// Distinct, high-contrast track colors. Each pin gets one in pin order.
const PIN_COLORS = ['#cba6f7', '#74c7ec', '#fab387', '#a6e3a1'];

const tray = ensureTray();
const compareBtn = document.getElementById('toggle-compare');
const comparePanel = document.getElementById('compare-panel');
const compareBody = document.getElementById('compare-body');
const compareCloseBtn = document.getElementById('close-compare');

const pinned = [];          // [{ id, name, year, color, trackLayer }]

function ensureTray() {
  let el = document.getElementById('compare-tray');
  if (!el) {
    el = document.createElement('div');
    el.id = 'compare-tray';
    el.className = 'compare-tray glass';
    el.hidden = true;
    el.innerHTML = `
      <span class="ct-title">Compare</span>
      <div class="ct-chips" id="ct-chips"></div>
      <button class="ct-btn primary" id="ct-open">View comparison</button>
      <button class="ct-btn" id="ct-clear" title="Remove all pins">Clear</button>
    `;
    document.body.appendChild(el);
    el.querySelector('#ct-open').addEventListener('click', openComparePanel);
    el.querySelector('#ct-clear').addEventListener('click', clearAll);
  }
  return el;
}

if (compareBtn) compareBtn.addEventListener('click', openComparePanel);
if (compareCloseBtn) compareCloseBtn.addEventListener('click', () => {
  hidePanel('compare-panel');
});

export function isPinned(stormId) {
  return pinned.some(p => p.id === stormId);
}

export function getPins() { return pinned.slice(); }

export async function togglePin(storm) {
  await ensureStormsLoaded();
  const fullStorm = getStorm(storm.id) || storm;
  const idx = pinned.findIndex(p => p.id === fullStorm.id);
  if (idx >= 0) {
    removePin(fullStorm.id);
    return false;
  }
  if (pinned.length >= MAX_PINS) {
    // Replace the oldest pin if at capacity.
    removePin(pinned[0].id);
  }
  const used = pinned.map(p => p.color);
  const color = PIN_COLORS.find(c => !used.includes(c)) || PIN_COLORS[pinned.length % PIN_COLORS.length];
  const trackLayer = drawTrack(fullStorm, color);
  pinned.push({
    id: fullStorm.id,
    name: fullStorm.name,
    year: fullStorm.year,
    storm: fullStorm,
    color,
    trackLayer,
  });
  refreshTray();
  refreshComparePanelIfOpen();
  return true;
}

export function removePin(stormId) {
  const idx = pinned.findIndex(p => p.id === stormId);
  if (idx < 0) return;
  const pin = pinned[idx];
  if (pin.trackLayer) getMap().removeLayer(pin.trackLayer);
  pinned.splice(idx, 1);
  refreshTray();
  refreshComparePanelIfOpen();
}

export function clearAll() {
  while (pinned.length) removePin(pinned[0].id);
  hidePanel('compare-panel');
}

function drawTrack(storm, color) {
  const map = getMap();
  const group = L.layerGroup();
  const track = storm.track;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color,
      weight: 3,
      opacity: 0.85,
      lineJoin: 'round',
      className: 'compare-track',
    }).addTo(group);
  }
  // Genesis dot.
  if (track.length) {
    L.circleMarker([track[0].lat, track[0].lon], {
      radius: 3, color, fillColor: color, weight: 1, fillOpacity: 0.9,
    }).bindTooltip(`${titleCase(storm.name)} ${storm.year}`, { direction: 'top' }).addTo(group);
  }
  group.addTo(map);
  return group;
}

function refreshTray() {
  if (!pinned.length) {
    tray.hidden = true;
    return;
  }
  tray.hidden = false;
  const chips = tray.querySelector('#ct-chips');
  chips.innerHTML = pinned.map(p => `
    <span class="ct-chip" style="--pin-color:${p.color}">
      <span class="ct-dot" style="background:${p.color}"></span>
      <span class="ct-name">${escapeHtml(titleCase(p.name))} ${p.year}</span>
      <button class="ct-remove" data-id="${p.id}" title="Unpin">×</button>
    </span>
  `).join('');
  chips.querySelectorAll('.ct-remove').forEach(b => {
    b.addEventListener('click', () => removePin(b.dataset.id));
  });
}

function openComparePanel() {
  showPanel('compare-panel');
  if (!pinned.length) {
    // If user clicks Compare with no pins, show a hint instead of an empty panel.
    compareBody.innerHTML = `
      <div class="cp-empty">
        <h2>Storm comparison</h2>
        <p>Pin up to four storms to compare their tracks, intensity curves, and landfall metrics side by side.</p>
        <p class="hint">Open any landfall, choose <strong>Pin to compare</strong> in the storm panel, then return here for the full breakdown.</p>
      </div>
    `;
    return;
  }
  renderComparePanel();
}

function refreshComparePanelIfOpen() {
  if (comparePanel && !comparePanel.hidden && pinned.length) renderComparePanel();
}

function renderComparePanel() {
  const cards = pinned.map(p => {
    const s = p.storm;
    const peakLabel = categoryLabel(saffirCat(s.peak_wind_kt));
    const lfLabel = categoryLabel(s.landfall_max_category);
    const lfClass = categoryClass(s.landfall_max_category);
    const minPres = s.min_pres_mb ? `${s.min_pres_mb} mb` : '—';
    const states = [...new Set(s.us_landfalls.map(lf => lf.state))].join(' · ');
    return `
      <div class="cp-card" style="--pin-color:${p.color}">
        <div class="cp-card-head">
          <span class="cp-swatch" style="background:${p.color}"></span>
          <h3>${escapeHtml(titleCase(s.name))} (${s.year})</h3>
          <button class="cp-remove" data-id="${s.id}" title="Unpin">×</button>
        </div>
        <div class="cp-meta">
          <span class="cat-pill ${lfClass}">${lfLabel} at landfall</span>
          <span>Peak: <strong>${peakLabel} · ${s.peak_wind_kt} kt</strong></span>
          <span>Min pres: <strong>${minPres}</strong></span>
          <span>${s.us_landfall_count} landfall${s.us_landfall_count === 1 ? '' : 's'} · ${escapeHtml(states)}</span>
        </div>
        <div class="cp-chart" data-storm-id="${s.id}"></div>
      </div>
    `;
  }).join('');

  // Side-by-side stat table with diff highlighting.
  const rows = [
    ['Peak wind', p => p.storm.peak_wind_kt, 'number'],
    ['Min pressure', p => p.storm.min_pres_mb, 'number'],
    ['Peak category', p => saffirCat(p.storm.peak_wind_kt), 'category'],
    ['Landfall (max)', p => p.storm.landfall_max_category, 'category'],
    ['# US landfalls', p => p.storm.us_landfall_count, 'number'],
    ['Track points', p => p.storm.track?.length || 0, 'number'],
    ['Genesis', p => p.storm.track && p.storm.track.length > 0 ? formatTime(p.storm.track[0].t).split(',')[0] : '—', 'text'],
    ['Final', p => p.storm.track && p.storm.track.length > 0 ? formatTime(p.storm.track[p.storm.track.length - 1].t).split(',')[0] : '—', 'text'],
    ['States hit', p => p.storm.us_landfalls && p.storm.us_landfalls.length > 0 ? [...new Set(p.storm.us_landfalls.map(lf => lf.state))].join(', ') : '—', 'text'],
  ];

  // Compute min/max for diff highlighting.
  const extrema = {};
  for (const [label, fn, type] of rows) {
    const values = pinned.map(fn).filter(v => v != null);
    if (type === 'number' && values.length > 0) {
      extrema[label] = {
        max: Math.max(...values),
        min: Math.min(...values),
      };
    }
  }

  const headerCols = pinned.map(p => `<th style="color:${p.color}">${escapeHtml(titleCase(p.name))} ${p.year}</th>`).join('');
  const tableBody = rows.map(([label, fn, type]) => {
    const cells = pinned.map(p => {
      const val = fn(p);
      let displayVal = val;
      if (type === 'category') {
        displayVal = val == null ? '—' : categoryLabel(val);
      } else if (type === 'number') {
        displayVal = val == null ? '—' : String(val);
      } else {
        displayVal = escapeHtml(String(val ?? '—'));
      }
      
      // Apply diff highlighting for numeric columns.
      let highlight = '';
      if (type === 'number' && extrema[label] && val != null) {
        if (val === extrema[label].max) {
          highlight = ' class="cp-cell-max"';
        } else if (val === extrema[label].min) {
          highlight = ' class="cp-cell-min"';
        }
      }
      
      return `<td${highlight}>${displayVal}</td>`;
    }).join('');
    return `<tr><th>${label}</th>${cells}</tr>`;
  }).join('');

  compareBody.innerHTML = `
    <h2 id="compare-panel-title">Comparing ${pinned.length} storm${pinned.length === 1 ? '' : 's'}</h2>
    <p class="cp-hint">Tracks are drawn on the map in matching colors. Pin or unpin via the storm panel or the chip tray.</p>
    <div class="cp-actions">
      <button class="export-btn" id="cp-export-btn" title="Export comparison as CSV">📥 Export comparison</button>
    </div>
    <div class="cp-cards">${cards}</div>
    <h3 class="panel-section-h3">Side-by-side</h3>
    <div class="cp-table-wrap">
      <table class="cp-table">
        <thead><tr><th></th>${headerCols}</tr></thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>
  `;

  // Wire up export button
  const exportBtn = compareBody.querySelector('#cp-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportComparisonCSV(pinned));
  }

  // Render mini intensity chart for each pinned storm.
  for (const p of pinned) {
    const host = compareBody.querySelector(`.cp-chart[data-storm-id="${p.id}"]`);
    if (host) renderIntensityChart(host, p.storm);
  }
  compareBody.querySelectorAll('.cp-remove').forEach(b => {
    b.addEventListener('click', () => removePin(b.dataset.id));
  });
}

function saffirCat(kt) {
  if (kt == null || kt < 34) return 0;
  if (kt < 64) return -1;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}

function titleCase(name) {
  if (!name || name === 'UNNAMED') return 'Unnamed';
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}

/** Export comparison table + narratives as CSV. */
function exportComparisonCSV(storms) {
  if (!storms || storms.length === 0) return;

  // Generate header
  const header = ['Metric', ...storms.map(p => `${titleCase(p.name)} (${p.year})`)].map(escapeCSV).join(',');

  // Generate comparison table rows
  const rows = [
    ['Peak wind (kt)', p => p.storm.peak_wind_kt],
    ['Min pressure (mb)', p => p.storm.min_pres_mb],
    ['Peak category', p => {
      const cat = saffirCat(p.storm.peak_wind_kt);
      return cat === -1 ? 'TS' : cat === 0 ? 'TD' : `Cat ${cat}`;
    }],
    ['Landfall category', p => {
      const cat = p.storm.landfall_max_category;
      return cat === -1 ? 'TS' : cat === 0 ? 'TD' : cat ? `Cat ${cat}` : '—';
    }],
    ['US landfalls', p => p.storm.us_landfall_count],
    ['Track points', p => p.storm.track.length],
    ['ACE (10⁴ kt²)', p => {
      const ace = computeACE(p.storm.track);
      return typeof ace === 'object' ? ace.value.toFixed(2) : ace.toFixed(2);
    }],
    ['Forward speed (km/h)', p => {
      const trans = computeTranslationStats(p.storm.track);
      return trans ? trans.mean.toFixed(1) : '—';
    }],
    ['RI detected', p => {
      const ri = findRapidIntensification(p.storm.track);
      return ri ? `+${ri.gain_kt} kt` : 'No';
    }],
    ['RI risk category', p => {
      const risk = computeRIRiskScore(p.storm, []);
      return risk ? risk.category : '—';
    }],
  ];

  const tableRows = rows.map(([label, fn]) => {
    const cells = [escapeCSV(label)];
    for (const p of storms) {
      try {
        const val = fn(p);
        cells.push(escapeCSV(String(val ?? '—')));
      } catch {
        cells.push('—');
      }
    }
    return cells.join(',');
  });

  // Generate narratives
  const narrativeSection = ['', '', 'COMPARISON NARRATIVES', ...storms.map(p => {
    const bio = generateStormBiography(p.storm, {});
    return escapeCSV(`${titleCase(p.name)} (${p.year}): ${bio}`);
  })];

  // Combine all rows
  const csvContent = [
    header,
    ...tableRows,
    ...narrativeSection,
    '',
    'Data source: NOAA HURDAT2 best-track database',
    'Generated: ' + new Date().toISOString(),
  ].join('\n');

  // Trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `HurricaneMap-comparison-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

/** Escape a value for CSV (wrap in quotes if contains comma/quote/newline). */
function escapeCSV(s) {
  const str = String(s ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

