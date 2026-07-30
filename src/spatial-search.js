import { ensureStormsLoaded, getStorm, getLandfalls, categoryLabel, categoryStrength } from './data.js';
import { bearingDeg, closestApproach, compassLabel, kmToMi } from './metrics.js';
import { getMap } from './map.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { showPanel, hidePanel } from './panels.js';
import { t } from './i18n.js';
import { renderWindContextForPoint } from './wind-context.js';
import { clearUserPoint, loadUserPoint, saveUserPoint } from './user-point.js';

export function getSavedUserPoint() {
  return loadUserPoint();
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
let searchGeneration = 0;
let windContextController = null;
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
  searchGeneration++;
  windContextController?.abort();
  windContextController = null;
  if (circle) { getMap().removeLayer(circle); circle = null; }
  if (panelEl && !panelEl.hidden) hidePanel('spatial-results');
}

async function performSearch(lat, lon) {
  const generation = ++searchGeneration;
  windContextController?.abort();
  windContextController = new AbortController();
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
  if (!active || generation !== searchGeneration) return;
  const peakCatByStorm = new Map();
  for (const lf of getLandfalls()) {
    const prev = peakCatByStorm.get(lf.storm_id);
    if (prev == null || categoryStrength(lf.category) > categoryStrength(prev)) peakCatByStorm.set(lf.storm_id, lf.category);
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
  const windHost = renderResults(results, lat, lon);
  renderWindContextForPoint(windHost, lat, lon, { signal: windContextController.signal }).then(() => {
    if (!active || generation !== searchGeneration) windHost.replaceChildren();
  });
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
    const status = spBody.querySelector('.sp-location-status');
    if (!navigator.geolocation) {
      status.textContent = t('spatial.errorUnavailable');
      event.target.disabled = true;
      return;
    }
    event.target.disabled = true;
    event.target.textContent = t('spatial.locating');
    status.textContent = '';
    navigator.geolocation.getCurrentPosition(
      position => {
        if (!active) return;
        const { latitude, longitude } = position.coords;
        const remember = !!spBody.querySelector('.sp-remember-location')?.checked;
        saveUserPoint(latitude, longitude, { remember });
        getMap().setView([latitude, longitude], Math.max(getMap().getZoom(), 6));
        performSearch(latitude, longitude);
      },
      error => {
        if (!active) return;
        event.target.disabled = false;
        event.target.textContent = `📍 ${t('spatial.useMyLocation')}`;
        const key = error?.code === 1
          ? 'spatial.errorPermission'
          : error?.code === 3
            ? 'spatial.errorTimeout'
            : 'spatial.errorUnavailable';
        status.textContent = t(key);
      },
      { maximumAge: 300_000, timeout: 15_000 },
    );
  });
  spBody.querySelector('.sp-clear-location')?.addEventListener('click', event => {
    clearUserPoint();
    const remember = spBody.querySelector('.sp-remember-location');
    if (remember) remember.checked = false;
    event.currentTarget.disabled = true;
    spBody.querySelector('.sp-location-status').textContent = t('spatial.locationCleared');
  });
}

function locationPrivacyControls() {
  const point = getSavedUserPoint();
  const remembered = point?.retention === 'device';
  const status = point
    ? t(remembered ? 'spatial.locationDevice' : 'spatial.locationSession')
    : '';
  return `
    <div class="sp-location-privacy">
      <p>${escapeHtml(t('spatial.locationPrivacy'))}</p>
      <label>
        <input class="sp-remember-location" type="checkbox"${remembered ? ' checked' : ''}>
        <span><strong>${escapeHtml(t('spatial.rememberLocation'))}</strong><small>${escapeHtml(t('spatial.rememberHelp'))}</small></span>
      </label>
      <div class="sp-location-actions">
        <button class="text-btn sp-clear-location" type="button"${point ? '' : ' disabled'}>${escapeHtml(t('spatial.clearLocation'))}</button>
        <span class="sp-location-status" role="status" aria-live="polite">${escapeHtml(status)}</span>
      </div>
    </div>`;
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
    ${locationPrivacyControls()}
  `;
  spBody.querySelector('.close-btn').addEventListener('click', () => {
    clearSearch();
    if (active) toggleSpatialMode();
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
    ${locationPrivacyControls()}
    <div class="sp-count">${results.length} storm${results.length === 1 ? '' : 's'} within ${currentRadius.label}</div>
    <ul class="sp-list">
      ${results.map(r => `
        <li data-sid="${escapeHtml(r.storm_id)}" tabindex="0">
          <span class="sp-name">${escapeHtml(formatStormName(r.name))} ${escapeHtml(r.year)}</span>
          <span class="sp-meta">${escapeHtml(categoryLabel(r.category))} · ${escapeHtml(r.distance_mi)} mi${r.bearing ? ` ${escapeHtml(r.bearing)}` : ''}${r.wind_at_closest ? ` · ${escapeHtml(r.wind_at_closest)} kt` : ''}</span>
        </li>
      `).join('')}
    </ul>
    <div class="wind-context-host"></div>
  `;

  spBody.querySelector('.close-btn').addEventListener('click', () => {
    clearSearch();
    if (active) toggleSpatialMode();
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
  return spBody.querySelector('.wind-context-host');
}
