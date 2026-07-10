import { ensureStormsLoaded, getStorm, getLandfalls, categoryLabel } from './data.js';
import { bearingDeg, closestApproach, compassLabel, kmToMi } from './metrics.js';
import { getMap } from './map.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { showPanel, hidePanel } from './panels.js';
import { t } from './i18n.js';

// Geolocated "my location" points persist so active-storm tooltips can show
// live distance/bearing; right-click search points stay session-only.
const USER_POINT_KEY = 'hm-user-point-v1';

export function getSavedUserPoint() {
  try {
    const raw = localStorage.getItem(USER_POINT_KEY);
    if (!raw) return null;
    const point = JSON.parse(raw);
    return Number.isFinite(point?.lat) && Number.isFinite(point?.lon) ? point : null;
  } catch {
    return null;
  }
}

function saveUserPoint(lat, lon) {
  try {
    localStorage.setItem(USER_POINT_KEY, JSON.stringify({ lat, lon }));
  } catch { /* private mode — session-only */ }
}

const L = window.L;

const RADIUS_OPTIONS = [
  { label: '50 mi', km: 80.5 },
  { label: '100 mi', km: 160.9 },
  { label: '200 mi', km: 321.9 },
];

let circle = null;
let panelEl = null;
let active = false;
let currentRadius = RADIUS_OPTIONS[1];
let onSelectStorm = null;

export function initSpatialSearch(onSelect) {
  onSelectStorm = onSelect;
  const map = getMap();
  map.on('contextmenu', async (e) => {
    if (!active) return;
    e.originalEvent.preventDefault();
    await performSearch(e.latlng.lat, e.latlng.lng);
  });
}

export function toggleSpatialMode() {
  active = !active;
  const map = getMap();
  map.getContainer().style.cursor = active ? 'crosshair' : '';
  if (active) renderPrompt();
  if (!active) clearSearch();
  // Keep the header toggle in sync even when mode is exited from the results
  // panel's close button rather than the toolbar.
  document.dispatchEvent(new CustomEvent('spatial-mode:change', { detail: { active } }));
  return active;
}

export function isSpatialActive() { return active; }

export function clearSearch() {
  if (circle) { getMap().removeLayer(circle); circle = null; }
  if (panelEl && !panelEl.hidden) hidePanel('spatial-results');
}

async function performSearch(lat, lon) {
  const map = getMap();
  if (circle) map.removeLayer(circle);
  circle = L.circle([lat, lon], {
    radius: currentRadius.km * 1000,
    color: '#cba6f7',
    weight: 2,
    opacity: 0.7,
    fillColor: '#cba6f7',
    fillOpacity: 0.08,
    interactive: false,
  }).addTo(map);

  await ensureStormsLoaded();
  const peakCatByStorm = new Map();
  for (const lf of getLandfalls()) {
    const prev = peakCatByStorm.get(lf.storm_id);
    if (prev == null || lf.category > prev) peakCatByStorm.set(lf.storm_id, lf.category);
  }
  const seenStorms = new Set();
  const results = [];
  for (const lf of getLandfalls()) {
    if (seenStorms.has(lf.storm_id)) continue;
    const storm = getStorm(lf.storm_id);
    if (!storm?.track) continue;
    const ca = closestApproach(storm.track, lat, lon);
    if (!ca || ca.distance_km > currentRadius.km) continue;
    seenStorms.add(lf.storm_id);
    const bearing = ca.track_point && Number.isFinite(ca.track_point.lat) && Number.isFinite(ca.track_point.lon)
      ? compassLabel(bearingDeg(lat, lon, ca.track_point.lat, ca.track_point.lon))
      : '';
    results.push({
      storm_id: lf.storm_id,
      name: lf.name,
      year: lf.year,
      category: peakCatByStorm.get(lf.storm_id) ?? lf.category,
      distance_mi: Math.round(ca.distance_mi),
      bearing,
      wind_at_closest: ca.track_point?.wind ?? null,
    });
  }
  results.sort((a, b) => a.distance_mi - b.distance_mi);
  renderResults(results, lat, lon);
}

function ensurePanel() {
  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'spatial-results';
    panelEl.className = 'spatial-results glass';
    panelEl.hidden = true;
    panelEl.setAttribute('role', 'region');
    panelEl.setAttribute('aria-label', 'Nearby storm search results');
    // Results render into a child body so the panel manager's injected chrome
    // (minimize button / restore tab) on the root survives re-renders.
    const bodyEl = document.createElement('div');
    bodyEl.className = 'sp-body';
    panelEl.appendChild(bodyEl);
    document.body.appendChild(panelEl);
  }
  return panelEl.querySelector('.sp-body');
}

function wireLocateButton(spBody) {
  spBody.querySelector('.sp-locate-btn')?.addEventListener('click', event => {
    if (!navigator.geolocation) {
      event.target.textContent = t('spatial.denied');
      event.target.disabled = true;
      return;
    }
    event.target.disabled = true;
    event.target.textContent = t('spatial.locating');
    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords;
        saveUserPoint(latitude, longitude);
        getMap().setView([latitude, longitude], Math.max(getMap().getZoom(), 6));
        performSearch(latitude, longitude);
      },
      () => {
        event.target.disabled = false;
        event.target.textContent = t('spatial.denied');
      },
      { maximumAge: 300_000, timeout: 15_000 },
    );
  });
}

/** Empty-state prompt shown when spatial mode is armed but nothing searched. */
function renderPrompt() {
  const spBody = ensurePanel();
  showPanel('spatial-results');
  spBody.innerHTML = `
    <div class="sp-header">
      <h3>${t('spatial.title')}</h3>
      <button class="close-btn" aria-label="Close spatial search">×</button>
    </div>
    <p class="sp-hint">${t('spatial.hint')}</p>
    <button class="text-btn sp-locate-btn" type="button">📍 ${t('spatial.useMyLocation')}</button>
  `;
  spBody.querySelector('.close-btn').addEventListener('click', () => {
    clearSearch();
    toggleSpatialMode();
  });
  wireLocateButton(spBody);
}

function renderResults(results, lat, lon) {
  const spBody = ensurePanel();

  const radiusBtns = RADIUS_OPTIONS.map(r =>
    `<button class="sp-radius-btn${r === currentRadius ? ' active' : ''}" data-km="${r.km}">${r.label}</button>`
  ).join('');

  // Route through the shared panel manager: results claim the exclusive side
  // lane instead of stacking on top of whatever panel was already open.
  showPanel('spatial-results');
  spBody.innerHTML = `
    <div class="sp-header">
      <h3>Storms near ${lat.toFixed(2)}, ${lon.toFixed(2)}</h3>
      <button class="close-btn" aria-label="Close spatial search">×</button>
    </div>
    <div class="sp-controls">${radiusBtns}<button class="text-btn sp-locate-btn" type="button">📍 ${t('spatial.useMyLocation')}</button></div>
    <div class="sp-count">${results.length} storm${results.length === 1 ? '' : 's'} within ${currentRadius.label}</div>
    <ul class="sp-list">
      ${results.map(r => `
        <li data-sid="${escapeHtml(r.storm_id)}" tabindex="0">
          <span class="sp-name">${escapeHtml(formatStormName(r.name))} ${r.year}</span>
          <span class="sp-meta">${escapeHtml(categoryLabel(r.category))} · ${r.distance_mi} mi${r.bearing ? ` ${r.bearing}` : ''}${r.wind_at_closest ? ` · ${r.wind_at_closest} kt` : ''}</span>
        </li>
      `).join('')}
    </ul>
  `;

  spBody.querySelector('.close-btn').addEventListener('click', () => {
    clearSearch();
    toggleSpatialMode();
  });

  spBody.querySelectorAll('.sp-radius-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRadius = RADIUS_OPTIONS.find(r => r.km === Number(btn.dataset.km)) || RADIUS_OPTIONS[1];
      performSearch(lat, lon);
    });
  });
  wireLocateButton(spBody);

  if (onSelectStorm) {
    spBody.querySelectorAll('li[data-sid]').forEach(li => {
      const handler = () => {
        const lf = getLandfalls().find(x => x.storm_id === li.dataset.sid);
        if (lf) onSelectStorm(lf);
      };
      li.addEventListener('click', handler);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
    });
  }
}
