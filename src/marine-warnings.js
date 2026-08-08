// NHC Graphical Marine Wind Warnings (0-24 hour outlook), proxied through the
// fixed Cloudflare allowlist. The layer is opt-in because the polygons span
// broad offshore forecast areas and can visually dominate historical tracks.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  idleOptionalFeed,
} from './optional-feeds.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';

const URLS = ['/nhc/marine/atlantic.kml', '/nhc/marine/pacific.kml'];
const CACHE_MS = 6 * 60 * 60 * 1000;
const STYLE = {
  low: { color: '#b45f9d', fillColor: '#dda0dd', fillOpacity: 0.20 },
  moderate: { color: '#94005f', fillColor: '#d30094', fillOpacity: 0.24 },
  high: { color: '#9f3131', fillColor: '#cd5c5c', fillOpacity: 0.28 },
  extreme: { color: '#7a007a', fillColor: '#cc00cc', fillOpacity: 0.32 },
};

let cache = null;
let layerGroup = null;
let layerMap = null;
let legendEl = null;
let renderGeneration = 0;
let statusEl = null;

function xmlText(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').trim();
}

export function parseMarineWarningKml(kml) {
  const features = [];
  const placemarks = String(kml || '').match(/<Placemark(?:\s[^>]*)?>[\s\S]*?<\/Placemark>/gi) || [];
  for (const placemark of placemarks) {
    const style = xmlText(placemark.match(/<styleUrl(?:\s[^>]*)?>([\s\S]*?)<\/styleUrl>/i)?.[1]).replace(/^#/, '').toLowerCase();
    if (!STYLE[style]) continue;
    const name = xmlText(placemark.match(/<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/i)?.[1]) || style;
    for (const match of placemark.matchAll(/<Polygon(?:\s[^>]*)?>[\s\S]*?<coordinates(?:\s[^>]*)?>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Polygon>/gi)) {
      const ring = match[1].trim().split(/\s+/).map(token => {
        const [lon, lat] = token.split(',').map(Number);
        return [lon, lat];
      }).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
      if (ring.length >= 4) features.push({ type: 'Feature', properties: { risk: style, name }, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
  }
  return features;
}

async function fetchWarnings(force) {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.features;
  const results = await Promise.allSettled(URLS.map(async url => {
    const response = await fetchWithTimeout(url, { cache: 'no-cache' }, REQUEST_TIMEOUT_MS.active);
    if (!response.ok) {
      const error = new Error(`${url} returned ${response.status}`);
      error.responseStatus = response.status;
      throw error;
    }
    return parseMarineWarningKml(await response.text());
  }));
  const features = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!features.length && results.every(result => result.status === 'rejected')) throw new Error('NHC marine warning feeds unavailable');
  cache = { fetchedAt: Date.now(), features };
  return features;
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function updateLegend(risks) {
  if (!risks.size) {
    if (legendEl) legendEl.hidden = true;
    return;
  }
  if (!legendEl) {
    legendEl = document.createElement('div');
    legendEl.id = 'marine-warning-legend';
    legendEl.className = 'marine-warning-legend glass';
    legendEl.setAttribute('role', 'group');
    document.body.appendChild(legendEl);
  }
  legendEl.setAttribute('aria-label', t('marine.legendTitle'));
  legendEl.innerHTML = `<strong>${t('marine.legendTitle')}</strong>${Object.keys(STYLE).filter(risk => risks.has(risk)).map(risk => `<span><b class="marine-risk-swatch marine-risk-swatch--${risk}"></b>${escapeHtml(t(`marine.${risk}`))}</span>`).join('')}`;
  legendEl.hidden = false;
}

function ensureStatus(map) {
  if (!statusEl || !document.body.contains(statusEl)) {
    statusEl = document.createElement('div');
    statusEl.id = 'marine-warning-status';
    statusEl.className = 'optional-feed-status-overlay glass';
    document.body.appendChild(statusEl);
  }
  mountOptionalFeedStatus(statusEl, 'marine', {
    onRetry: () => renderMarineWarnings({ map, enabled: true, force: true }),
  });
}

export async function renderMarineWarnings({ map, enabled = false, force = false } = {}) {
  if (!map || !enabled) {
    clearMarineWarnings();
    idleOptionalFeed('marine');
    return { status: 'idle', polygonCount: 0 };
  }
  const generation = ++renderGeneration;
  const request = beginOptionalFeed('marine', { cacheOrigin: 'network' });
  ensureLayer(map);
  ensureStatus(map);
  try {
    const cacheOrigin = !force && cache && Date.now() - cache.fetchedAt < CACHE_MS
      ? 'memory'
      : 'network';
    const features = await fetchWarnings(force);
    if (generation !== renderGeneration) return { status: 'stale', polygonCount: 0, requestId: request.requestId };
    layerGroup.clearLayers();
    const risks = new Set(features.map(feature => feature.properties.risk));
    const layer = window.L.geoJSON({ type: 'FeatureCollection', features }, {
      style: feature => ({ ...STYLE[feature.properties.risk], weight: 1, opacity: 0.85, className: 'marine-warning-zone' }),
      onEachFeature: (feature, polygon) => polygon.bindTooltip(escapeHtml(`${feature.properties.name} · ${t('marine.window')}`), { sticky: true }),
    });
    layerGroup.addLayer(layer);
    updateLegend(risks);
    const result = { status: features.length ? 'rendered' : 'empty', polygonCount: features.length, cacheOrigin };
    completeOptionalFeed('marine', {
      empty: result.status === 'empty',
      itemCount: features.length,
      cacheOrigin,
      requestId: request.requestId,
    });
    return result;
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale', polygonCount: 0 };
    const result = {
      status: 'error',
      polygonCount: 0,
      error,
      responseStatus: error.responseStatus || 0,
    };
    failOptionalFeed('marine', { ...result, requestId: request.requestId });
    return result;
  }
}

export function clearMarineWarnings() {
  renderGeneration += 1;
  if (layerGroup) layerGroup.clearLayers();
  if (legendEl) legendEl.hidden = true;
  if (statusEl) statusEl.hidden = true;
}
