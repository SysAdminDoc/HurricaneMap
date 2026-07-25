// Live GOES satellite context for active storms.
//
// NOAA/NESDIS/STAR publishes current sector JPEGs every ~10 minutes. These
// browser-friendly images keep the static app client-only; raw GOES ABI files
// from cloud object storage require server-side reprojection/raster processing
// before they can be overlaid cleanly in Leaflet.

import { completeOptionalFeed, failOptionalFeed } from './optional-feeds.js';

const GOES_PANE_NAME = 'hm-goes-realtime';
const GOES_DEFAULT_SIZE = '900x540';
export const GOES_REFRESH_MS = 10 * 60 * 1000;

export const GOES_SECTORS = Object.freeze({
  taw: {
    id: 'taw',
    satellite: 'GOES19',
    satParam: 'G19',
    sector: 'taw',
    label: 'Tropical Atlantic',
    shortLabel: 'Atlantic',
    bounds: [[-5, -105], [45, 15]],
    opacity: 0.44,
  },
  eep: {
    id: 'eep',
    satellite: 'GOES19',
    satParam: 'G19',
    sector: 'eep',
    label: 'Eastern East Pacific',
    shortLabel: 'E. Pacific',
    bounds: [[-8, -132], [34, -76]],
    opacity: 0.44,
  },
  tpw: {
    id: 'tpw',
    satellite: 'GOES18',
    satParam: 'G18',
    sector: 'tpw',
    label: 'Tropical Pacific',
    shortLabel: 'Tropical Pacific',
    bounds: [[-8, -170], [34, -105]],
    opacity: 0.44,
  },
});

let goesLayerGroup = null;
let goesLayerMap = null;
let statusEl = null;
let activeOverlays = [];
// Bumped whenever layers are cleared so late image load/error events from a
// removed overlay can't resurrect the status badge.
let goesRenderGeneration = 0;

export async function renderGoesRealtimeContext(activeStorms, options = {}) {
  const map = options.map || goesLayerMap;
  const enabled = options.enabled !== false;
  if (!map || !enabled || !Array.isArray(activeStorms) || activeStorms.length === 0) {
    hideGoesRealtimeContext();
    return { status: 'idle', sectorIds: [], imageCount: 0 };
  }

  const sectorIds = selectGoesSectors(activeStorms);
  if (!sectorIds.length) {
    clearGoesLayers();
    updateGoesStatus('unavailable', [], options.now);
    return { status: 'unavailable', sectorIds: [], imageCount: 0 };
  }

  ensureGoesLayer(map);
  const generation = ++goesRenderGeneration;
  const previousOverlays = activeOverlays.slice();
  const loadedOverlays = [];
  let settledCount = 0;
  updateGoesStatus('loading', sectorIds, options.now);

  const L = window.L;
  const now = options.now || Date.now();
  const settle = () => {
    settledCount += 1;
    if (generation !== goesRenderGeneration || settledCount < sectorIds.length) return;
    if (loadedOverlays.length) {
      for (const oldOverlay of previousOverlays) goesLayerGroup.removeLayer(oldOverlay);
      activeOverlays = loadedOverlays;
      updateGoesStatus('ready', sectorIds, now);
      completeOptionalFeed('goes', {
        itemCount: loadedOverlays.length,
        completedAt: now,
        nextRetryAt: now + GOES_REFRESH_MS,
      });
      return;
    }
    updateGoesStatus('error', sectorIds, now);
    failOptionalFeed('goes', { nextRetryAt: now + GOES_REFRESH_MS });
  };
  for (const sectorId of sectorIds) {
    const sector = GOES_SECTORS[sectorId];
    const overlay = L.imageOverlay(
      buildGoesLatestImageUrl(sectorId, { cacheBust: now }),
      sector.bounds,
      {
        pane: GOES_PANE_NAME,
        opacity: sector.opacity,
        interactive: false,
        className: 'goes-realtime-image',
        alt: `${sector.label} GOES GeoColor satellite image`,
        attribution: 'NOAA/NESDIS/STAR GOES',
      },
    );
    overlay.once('load', () => {
      if (generation === goesRenderGeneration) {
        loadedOverlays.push(overlay);
        settle();
      }
    });
    overlay.once('error', () => {
      if (generation === goesRenderGeneration) {
        goesLayerGroup.removeLayer(overlay);
        settle();
      }
    });
    overlay.addTo(goesLayerGroup);
  }

  return { status: 'rendered', sectorIds, imageCount: sectorIds.length };
}

export function hideGoesRealtimeContext() {
  clearGoesLayers();
  if (statusEl) statusEl.hidden = true;
}

export function clearGoesLayers() {
  goesRenderGeneration++;
  if (goesLayerGroup) goesLayerGroup.clearLayers();
  activeOverlays = [];
}

export function selectGoesSectors(activeStorms) {
  const selected = [];
  const seen = new Set();

  for (const storm of activeStorms || []) {
    const sectorId = selectGoesSectorForStorm(storm);
    if (!sectorId || seen.has(sectorId)) continue;
    seen.add(sectorId);
    selected.push(sectorId);
  }

  return selected;
}

export function selectGoesSectorForStorm(storm) {
  const basin = inferStormBasin(storm);
  if (basin === 'AL') return 'taw';
  if (basin === 'EP') return 'eep';
  if (basin === 'CP') return 'tpw';

  const point = latestStormPoint(storm);
  if (!point) return null;
  if (point.lon <= -132) return 'tpw';
  if (point.lon <= -88 && point.lat <= 38) return 'eep';
  return 'taw';
}

export function inferStormBasin(storm) {
  for (const value of [
    storm?.basin,
    storm?.id,
    storm?.stormId,
    storm?.stormID,
    storm?.binNumber,
  ]) {
    const basin = normalizeBasinCandidate(value);
    if (basin) return basin;
  }
  return null;
}

export function latestStormPoint(storm) {
  const track = Array.isArray(storm?.track) ? storm.track : [];
  for (let i = track.length - 1; i >= 0; i -= 1) {
    const point = normalizePoint(track[i]);
    if (point) return point;
  }

  const forecastTrack = Array.isArray(storm?.forecastTrack) ? storm.forecastTrack : [];
  for (const forecastPoint of forecastTrack) {
    const point = normalizePoint(forecastPoint);
    if (point) return point;
  }

  return normalizePoint(storm);
}

export function buildGoesLatestImageUrl(sectorId, options = {}) {
  const sector = GOES_SECTORS[sectorId];
  if (!sector) return null;
  const size = options.size || GOES_DEFAULT_SIZE;
  const base = `https://cdn.star.nesdis.noaa.gov/${sector.satellite}/ABI/SECTOR/${sector.sector}/GEOCOLOR/${size}.jpg`;
  if (options.cacheBust === false) return base;
  return `${base}?t=${goesCacheStamp(options.cacheBust ?? Date.now())}`;
}

export function goesSourcePageUrl(sectorId) {
  const sector = GOES_SECTORS[sectorId];
  if (!sector) return 'https://www.star.nesdis.noaa.gov/goes/';
  return `https://www.goes.noaa.gov/sector.php?sat=${sector.satParam}&sector=${sector.sector}`;
}

export function goesCacheStamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return String(Math.floor(numeric / GOES_REFRESH_MS) * GOES_REFRESH_MS);
  }
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'live';
}

function ensureGoesLayer(map) {
  if (goesLayerGroup && goesLayerMap === map) return;
  if (goesLayerGroup && goesLayerMap) {
    goesLayerMap.removeLayer(goesLayerGroup);
  }

  ensureGoesPane(map);
  goesLayerMap = map;
  goesLayerGroup = window.L.layerGroup().addTo(map);
}

function ensureGoesPane(map) {
  let pane = map.getPane(GOES_PANE_NAME);
  if (!pane) pane = map.createPane(GOES_PANE_NAME);
  pane.classList.add('goes-realtime-pane');
  pane.style.zIndex = '250';
  pane.style.pointerEvents = 'none';
}

function updateGoesStatus(state, sectorIds, timestamp = Date.now()) {
  ensureStatusEl();
  statusEl.hidden = false;

  const sectors = sectorIds.map(id => GOES_SECTORS[id]).filter(Boolean);
  const label = sectors.length
    ? sectors.map(sector => sector.shortLabel).join(' + ')
    : 'basin unavailable';
  const sourceUrl = goesSourcePageUrl(sectors[0]?.id);
  const time = formatUtcTime(timestamp);
  const stateLabel = {
    loading: 'Loading',
    ready: 'GOES live',
    error: 'GOES unavailable',
    unavailable: 'GOES unavailable',
  }[state] || 'GOES live';

  statusEl.dataset.state = state;
  statusEl.innerHTML = `
    <span class="goes-live-dot" aria-hidden="true"></span>
    <span class="goes-live-text">${escapeText(stateLabel)} · ${escapeText(label)}${state === 'ready' ? ` · ${escapeText(time)} UTC` : ''}</span>
    <a class="goes-source-link" href="${sourceUrl}" target="_blank" rel="noopener">STAR</a>
  `;
}

function ensureStatusEl() {
  if (statusEl && document.body.contains(statusEl)) return;
  statusEl = document.createElement('div');
  statusEl.id = 'goes-live-badge';
  statusEl.className = 'goes-live-badge glass';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(statusEl);
}

function normalizeBasinCandidate(value) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!text) return null;
  if (text.startsWith('AL') || text.startsWith('AT') || text.includes('ATLANTIC')) return 'AL';
  if (text.startsWith('EP') || text.includes('EASTERNPACIFIC') || text.includes('EASTPACIFIC')) return 'EP';
  if (text.startsWith('CP') || text.includes('CENTRALPACIFIC')) return 'CP';
  return null;
}

function normalizePoint(point) {
  const lat = numericCoordinate(point?.lat ?? point?.latitude);
  const lon = numericCoordinate(point?.lon ?? point?.lng ?? point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function numericCoordinate(value) {
  if (Number.isFinite(value)) return Number(value);
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  const numeric = Number.parseFloat(text);
  if (!Number.isFinite(numeric)) return null;
  if (/[SW]$/.test(text)) return -Math.abs(numeric);
  if (/[NE]$/.test(text)) return Math.abs(numeric);
  return numeric;
}

function formatUtcTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'latest';
  return date.toISOString().slice(11, 16);
}

function escapeText(value) {
  return String(value ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
