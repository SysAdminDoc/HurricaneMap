// Storm comparison mode — pin up to 4 storms, view their tracks color-coded
// on the map and side-by-side intensity charts in a comparison panel.

import { ensureStormsLoaded, getStorm, categoryLabel, categoryClass, ktToMph, formatTime } from './data.js';
import { getMap } from './map.js';
import { renderIntensityChart } from './chart.js';
import { closePanelsExcept, syncPanelControls } from './panels.js';

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
  comparePanel.hidden = true;
  syncPanelControls();
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
  comparePanel.hidden = true;
  syncPanelControls();
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
  closePanelsExcept('compare-panel');
  if (!pinned.length) {
    // If user clicks Compare with no pins, show a hint instead of an empty panel.
    comparePanel.hidden = false;
    compareBody.innerHTML = `
      <div class="cp-empty">
        <h2>Storm comparison</h2>
        <p>Pin up to 4 storms to compare them side-by-side.</p>
        <p class="hint">Click any landfall, then hit <strong>📌 Pin to compare</strong> in the storm panel. Pinned storms appear as a tray at the bottom; come back here for the full breakdown.</p>
      </div>
    `;
    syncPanelControls();
    return;
  }
  comparePanel.hidden = false;
  renderComparePanel();
  syncPanelControls();
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

  // Side-by-side stat table.
  const rows = [
    ['Peak wind', p => `${p.storm.peak_wind_kt} kt (${ktToMph(p.storm.peak_wind_kt)} mph)`],
    ['Min pressure', p => p.storm.min_pres_mb ? `${p.storm.min_pres_mb} mb` : '—'],
    ['Peak category', p => categoryLabel(saffirCat(p.storm.peak_wind_kt))],
    ['Landfall (max)', p => categoryLabel(p.storm.landfall_max_category)],
    ['# US landfalls', p => p.storm.us_landfall_count],
    ['Track points', p => p.storm.track.length],
    ['Genesis', p => formatTime(p.storm.track[0].t).split(',')[0]],
    ['Final', p => formatTime(p.storm.track[p.storm.track.length - 1].t).split(',')[0]],
    ['States hit', p => [...new Set(p.storm.us_landfalls.map(lf => lf.state))].join(', ')],
  ];
  const headerCols = pinned.map(p => `<th style="color:${p.color}">${escapeHtml(titleCase(p.name))} ${p.year}</th>`).join('');
  const tableBody = rows.map(([label, fn]) => {
    const cells = pinned.map(p => `<td>${escapeHtml(String(fn(p) ?? '—'))}</td>`).join('');
    return `<tr><th>${label}</th>${cells}</tr>`;
  }).join('');

  compareBody.innerHTML = `
    <h2>Comparing ${pinned.length} storm${pinned.length === 1 ? '' : 's'}</h2>
    <p class="cp-hint">Tracks are drawn on the map in matching colors. Pin or unpin via the storm panel or the chip tray.</p>
    <div class="cp-cards">${cards}</div>
    <h3 class="panel-section-h3">Side-by-side</h3>
    <div class="cp-table-wrap">
      <table class="cp-table">
        <thead><tr><th></th>${headerCols}</tr></thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>
  `;

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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
