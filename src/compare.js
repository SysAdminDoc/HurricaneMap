// Storm comparison mode — pin up to 4 storms, view their tracks color-coded
// on the map and side-by-side intensity charts in a comparison panel.

import { getLocale, t } from './i18n.js';
import { ensureStormsLoaded, getStorm, getAllStorms, categoryClass } from './data.js';
import { getMap } from './map.js';
import { renderIntensityChart } from './chart.js';
import { hidePanel, showPanel } from './panels.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { getSetting } from './settings.js';
import {
  buildComparisonCSVText,
  formatComparisonValue,
  getComparisonRows,
} from './compare-rows.js';

export { buildComparisonCSVText, getComparisonRows } from './compare-rows.js';

// Leaflet is loaded from CDN as a UMD module, available as window.L
const L = window.L;

const MAX_PINS = 4;

// Distinct, high-contrast track colors. Each pin gets one in pin order.
const PIN_COLORS = ['#cba6f7', '#74c7ec', '#fab387', '#a6e3a1'];

const tray = ensureTray();
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
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', t('compare.title'));
    el.hidden = true;
    el.innerHTML = `
      <span class="ct-title">Compare</span>
      <div class="ct-chips" id="ct-chips"></div>
      <button class="ct-btn primary" id="ct-open">View comparison</button>
      <button class="ct-btn" id="ct-clear" title="Remove all pins">Clear</button>
    `;
    (document.querySelector('#main') || document.body).appendChild(el);
    el.querySelector('#ct-open').addEventListener('click', openComparePanel);
    el.querySelector('#ct-clear').addEventListener('click', clearAll);
  }
  return el;
}

if (compareCloseBtn) compareCloseBtn.addEventListener('click', () => {
  hidePanel('compare-panel');
});

export function isPinned(stormId) {
  return pinned.some(p => p.id === stormId);
}

export function getPins() { return pinned.slice(); }

export async function setPinsByIds(ids) {
  await ensureStormsLoaded();
  while (pinned.length) removePin(pinned[0].id);
  for (const id of [...new Set(ids || [])].slice(0, MAX_PINS)) {
    const storm = getStorm(id);
    if (storm) await togglePin(storm);
  }
  notifyPinsChanged();
  return pinned.map(pin => pin.id);
}

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
  notifyPinsChanged();
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
  notifyPinsChanged();
}

function notifyPinsChanged() {
  document.dispatchEvent(new CustomEvent('comparison-pins:change', {
    detail: { ids: pinned.map(pin => pin.id) },
  }));
}

export function clearAll() {
  while (pinned.length) removePin(pinned[0].id);
  hidePanel('compare-panel');
}

function drawTrack(storm, color) {
  const map = getMap();
  const group = L.layerGroup();
  const track = storm.track || [];
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
    }).bindTooltip(escapeHtml(`${formatStormName(storm.name)} ${storm.year}`), { direction: 'top' }).addTo(group);
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
      <span class="ct-name">${escapeHtml(formatStormName(p.name))} ${p.year}</span>
      <button class="ct-remove" data-id="${p.id}" title="${t('compare.unpin')}">×</button>
    </span>
  `).join('');
  chips.querySelectorAll('.ct-remove').forEach(b => {
    b.addEventListener('click', () => removePin(b.dataset.id));
  });
}

export function openComparePanel() {
  showPanel('compare-panel');
  if (!pinned.length) {
    // If user clicks Compare with no pins, show a hint instead of an empty panel.
    compareBody.innerHTML = `
      <div class="cp-empty">
        <h2>${t('compare.title')}</h2>
        <p>Pin up to four storms to compare their tracks, intensity curves, and landfall metrics side by side.</p>
        <p class="hint">Open any landfall, choose <strong>Pin to compare</strong> in the storm panel, then return here for the full breakdown.</p>
      </div>
    `;
    return;
  }
  renderComparePanel();
}

function refreshComparePanelIfOpen() {
  if (!comparePanel || comparePanel.hidden) return;
  // Removing the final pin from inside the panel must not leave the stale
  // card behind — fall back to the same hint state openComparePanel() shows.
  if (pinned.length) renderComparePanel();
  else openComparePanel();
}

function renderComparePanel() {
  const comparisonRows = getComparisonRows({
    allStorms: getAllStorms(),
    windUnit: getSetting('windUnit'),
    locale: getLocale(),
  });
  const rowsById = new Map(comparisonRows.map(row => [row.id, row]));
  const cardRows = {
    peakWind: rowsById.get('peak-wind'),
    peakCategory: rowsById.get('peak-category'),
    minPressure: rowsById.get('minimum-pressure'),
    landfallCategory: rowsById.get('landfall-category'),
    landfalls: rowsById.get('us-landfalls'),
    states: rowsById.get('states-hit'),
  };
  const cards = pinned.map(p => {
    const s = p.storm;
    const peakLabel = formatComparisonValue(cardRows.peakCategory, p);
    const peakWind = formatComparisonValue(cardRows.peakWind, p);
    const lfLabel = formatComparisonValue(cardRows.landfallCategory, p);
    const lfClass = categoryClass(s.landfall_max_category);
    const minPres = formatComparisonValue(cardRows.minPressure, p);
    const landfalls = formatComparisonValue(cardRows.landfalls, p);
    const states = formatComparisonValue(cardRows.states, p);
    return `
      <div class="cp-card" style="--pin-color:${p.color}">
        <div class="cp-card-head">
          <span class="cp-swatch" style="background:${p.color}"></span>
          <h3>${escapeHtml(formatStormName(s.name))} (${s.year})</h3>
          <button class="cp-remove" data-id="${s.id}" title="${t('compare.unpin')}">×</button>
        </div>
        <div class="cp-meta">
          <span class="cat-pill ${lfClass}">${escapeHtml(lfLabel)} ${escapeHtml(t('compare.card.atLandfall'))}</span>
          <span>${escapeHtml(cardRows.peakWind.label)}: <strong>${escapeHtml(peakLabel)} · ${escapeHtml(peakWind)}</strong></span>
          <span>${escapeHtml(cardRows.minPressure.label)}: <strong>${escapeHtml(minPres)}</strong></span>
          <span>${escapeHtml(cardRows.landfalls.label)}: <strong>${escapeHtml(landfalls)}</strong> · ${escapeHtml(states)}</span>
        </div>
        <div class="cp-chart" data-storm-id="${s.id}"></div>
      </div>
    `;
  }).join('');

  // Side-by-side stat table with diff highlighting.
  // Compute min/max for diff highlighting.
  const extrema = {};
  for (const row of comparisonRows) {
    const values = pinned.map(row.getValue).filter(Number.isFinite);
    if (row.kind === 'number' && values.length > 0) {
      extrema[row.id] = {
        max: Math.max(...values),
        min: Math.min(...values),
        direction: row.direction || 'higher',
      };
    }
  }

  const headerCols = pinned.map(p => `<th style="color:${p.color}">${escapeHtml(formatStormName(p.name))} ${p.year}</th>`).join('');
  const tableBody = comparisonRows.map(row => {
    const cells = pinned.map(p => {
      const val = row.getValue(p);
      const displayVal = escapeHtml(formatComparisonValue(row, p));
      
      // Apply diff highlighting for numeric columns.
      let highlight = '';
      if (row.kind === 'number' && extrema[row.id] && Number.isFinite(val)) {
        const preferred = extrema[row.id].direction === 'lower' ? extrema[row.id].min : extrema[row.id].max;
        const trailing = extrema[row.id].direction === 'lower' ? extrema[row.id].max : extrema[row.id].min;
        if (val === preferred) {
          highlight = ' class="cp-cell-max"';
        } else if (val === trailing) {
          highlight = ' class="cp-cell-min"';
        }
      }
      
      return `<td${highlight}>${displayVal}</td>`;
    }).join('');
    return `<tr><th>${escapeHtml(row.label)}</th>${cells}</tr>`;
  }).join('');

  compareBody.innerHTML = `
    <h2 id="compare-panel-title">${t('compare.title')}</h2>
    <p class="cp-hint">Tracks are drawn on the map in matching colors. Pin or unpin via the storm panel or the chip tray.</p>
    <div class="cp-actions">
      <button class="export-btn" id="cp-export-btn" title="Export comparison as CSV">📥 ${t('btn.exportCSV')}</button>
    </div>
    <div class="cp-cards">${cards}</div>
    <h3 class="panel-section-h3">Side-by-side</h3>
    <div class="cp-table-wrap">
      <table class="cp-table">
        <thead><tr><th scope="col"><span class="visually-hidden">${escapeHtml(t('table.column.name'))}</span></th>${headerCols}</tr></thead>
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


/** Export comparison table + narratives as CSV. */
function exportComparisonCSV(storms) {
  if (!storms || storms.length === 0) return;
  const csvContent = buildComparisonCSVText({
    storms,
    allStorms: getAllStorms(),
    translate: t,
    windUnit: getSetting('windUnit'),
    locale: getLocale(),
  });

  // Trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = `HurricaneMap-comparison-${new Date().toISOString().split('T')[0]}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
