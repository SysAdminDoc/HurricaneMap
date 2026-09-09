// NHC Graphical Marine Wind Warnings. The layer is opt-in because the polygons
// span broad offshore forecast areas and can visually dominate historical
// tracks.
//
// NHC publishes this experimental product for two forecast bands, 0-24 h and
// 24-48 h, regenerated together four times a day, and the layer draws one of
// them at a time. Do not try to tell the two apart by the KML's own
// <name>, which reads GMWW24Hr.kml in both files: the band lives in the URL
// and nowhere in the document. When no warning is in force anywhere, the two
// files for a basin are byte-identical, because both are then the same grid of
// #none placemarks that parseMarineWarningKml drops.
//
// Each feed is tried through the fixed Cloudflare allowlist first, then
// straight from NHC. Unlike CurrentStorms.json and the outlook KMZs, the
// /gis/ products answer with Access-Control-Allow-Origin, so a deployment with
// no worker in front of it (GitHub Pages, for one) can read them directly
// instead of losing the layer to a 404 on the proxy path.

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
import { nhcProxyAvailable, nhcProxyUrl } from './nhc-proxy.js';

export const MARINE_HORIZONS = Object.freeze(['00to24', '24to48']);
export const DEFAULT_MARINE_HORIZON = '00to24';

const BASINS = Object.freeze([
  Object.freeze({ id: 'atlantic', file: 'Atlantic' }),
  Object.freeze({ id: 'pacific', file: 'Pacific' }),
]);

/** The two basin feeds for one forecast band. An unknown band falls back to
 *  0-24 h rather than building a URL NHC does not publish. */
export function marineFeedsFor(horizon = DEFAULT_MARINE_HORIZON) {
  const band = MARINE_HORIZONS.includes(horizon) ? horizon : DEFAULT_MARINE_HORIZON;
  return BASINS.map(basin => Object.freeze({
    id: `${basin.id}-${band}`,
    horizon: band,
    proxy: `/nhc/marine/${basin.id}-${band}.kml`,
    direct: `https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_${band}_${basin.file}.kml`,
  }));
}
const CACHE_MS = 6 * 60 * 60 * 1000;
const STYLE = {
  low: { color: '#b45f9d', fillColor: '#dda0dd', fillOpacity: 0.20 },
  moderate: { color: '#94005f', fillColor: '#d30094', fillOpacity: 0.24 },
  high: { color: '#9f3131', fillColor: '#cd5c5c', fillOpacity: 0.28 },
  extreme: { color: '#7a007a', fillColor: '#cc00cc', fillOpacity: 0.32 },
};

// One entry per band. A shared slot would hand a reader the other band's
// polygons for up to six hours after switching, which is the exact failure
// this layer's whole point is to avoid.
const cache = new Map();
// Which band's polygons are currently on the map, or null when none are. A
// failed fetch keeps the last good polygons, which is right while the band has
// not changed and wrong the moment it has: the reader would be looking at the
// 0-24 h ocean under a legend and a settings pill that both say 24-48 h.
let drawnHorizon = null;
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

/**
 * Read one marine feed, preferring the proxy and falling back to NHC directly.
 * The last failure is rethrown so the optional-feed state still reports the
 * real status code rather than a generic "unavailable".
 */
/** A KML document, as opposed to a host's 200-response SPA shell or error page. */
export function looksLikeKml(body) {
  return /<\s*kml[\s>]/i.test(String(body || ''));
}

export async function fetchMarineFeed(feed, { fetchImpl, signal, useProxy = true } = {}) {
  let lastError = null;
  // One deadline for the whole feed, not one per attempt: two sequential
  // 12-second budgets would let a dead proxy hold the layer for 24.
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS.active);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  // The relay route is resolved against the document base so a worker mounted
  // under a project path is found rather than missed. Unlike the other two
  // feeds this one has a real fallback: NHC's /gis/ paths do send CORS headers,
  // so a deployment without the relay still gets its warnings, and skipping
  // straight to NHC saves it two 404s it already knows the answer to.
  const sources = useProxy ? [nhcProxyUrl(feed.proxy), feed.direct] : [feed.direct];
  for (const url of sources) {
    try {
      const response = await fetchWithTimeout(url, { cache: 'no-cache', signal: budget }, REQUEST_TIMEOUT_MS.active, fetchImpl);
      if (!response.ok) {
        const error = new Error(`${url} returned ${response.status}`);
        error.responseStatus = response.status;
        lastError = error;
        continue;
      }
      // A host that answers 200 with its own app shell (static-site fallbacks
      // do this for unknown paths) would otherwise parse to zero polygons and
      // be cached for six hours as a quiet ocean.
      const body = await response.text();
      if (!looksLikeKml(body)) {
        lastError = new Error(`${url} returned ${body.length} bytes that are not KML`);
        continue;
      }
      return parseMarineWarningKml(body);
    } catch (error) {
      lastError = error;
      if (budget.aborted) break;
    }
  }
  throw lastError || new Error(`${feed.id} marine warning feed unavailable`);
}

function cachedFeatures(horizon) {
  const entry = cache.get(horizon);
  return entry && Date.now() - entry.fetchedAt < CACHE_MS ? entry.features : null;
}

async function fetchWarnings(horizon, force) {
  if (!force) {
    const fresh = cachedFeatures(horizon);
    if (fresh) return fresh;
  }
  const useProxy = await nhcProxyAvailable();
  const feeds = marineFeedsFor(horizon);
  const results = await Promise.allSettled(feeds.map(feed => fetchMarineFeed(feed, { useProxy })));
  const features = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!features.length && results.every(result => result.status === 'rejected')) throw new Error('NHC marine warning feeds unavailable');
  cache.set(horizon, { fetchedAt: Date.now(), features });
  return features;
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function updateLegend(risks, horizon) {
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
  // The band is named in the legend, not only in the settings menu. Two
  // forecast periods drawn in the same four colours are otherwise
  // indistinguishable once the menu is closed.
  legendEl.innerHTML = `<strong>${t('marine.legendTitle')}</strong>`
    + `<span class="marine-warning-horizon">${escapeHtml(t(`marine.window.${horizon}`))}</span>`
    + Object.keys(STYLE).filter(risk => risks.has(risk)).map(risk => `<span><b class="marine-risk-swatch marine-risk-swatch--${risk}"></b>${escapeHtml(t(`marine.${risk}`))}</span>`).join('');
  legendEl.hidden = false;
}

function ensureStatus(map, horizon) {
  if (!statusEl || !document.body.contains(statusEl)) {
    statusEl = document.createElement('div');
    statusEl.id = 'marine-warning-status';
    statusEl.className = 'optional-feed-status-overlay glass';
    document.body.appendChild(statusEl);
  }
  mountOptionalFeedStatus(statusEl, 'marine', {
    onRetry: () => renderMarineWarnings({ map, enabled: true, horizon, force: true }),
  });
}

export async function renderMarineWarnings({
  map,
  enabled = false,
  horizon = DEFAULT_MARINE_HORIZON,
  force = false,
} = {}) {
  if (!map || !enabled) {
    clearMarineWarnings();
    idleOptionalFeed('marine');
    return { status: 'idle', polygonCount: 0, horizon: null };
  }
  const band = MARINE_HORIZONS.includes(horizon) ? horizon : DEFAULT_MARINE_HORIZON;
  const generation = ++renderGeneration;
  const request = beginOptionalFeed('marine', { cacheOrigin: 'network' });
  ensureLayer(map);
  ensureStatus(map, band);
  try {
    const cacheOrigin = !force && cachedFeatures(band) ? 'memory' : 'network';
    const features = await fetchWarnings(band, force);
    if (generation !== renderGeneration) return { status: 'stale', polygonCount: 0, horizon: band, requestId: request.requestId };
    layerGroup.clearLayers();
    const risks = new Set(features.map(feature => feature.properties.risk));
    const layer = window.L.geoJSON({ type: 'FeatureCollection', features }, {
      style: feature => ({ ...STYLE[feature.properties.risk], weight: 1, opacity: 0.85, className: 'marine-warning-zone' }),
      onEachFeature: (feature, polygon) => polygon.bindTooltip(escapeHtml(`${feature.properties.name} · ${t(`marine.window.${band}`)}`), { sticky: true }),
    });
    layerGroup.addLayer(layer);
    updateLegend(risks, band);
    drawnHorizon = band;
    const result = { status: features.length ? 'rendered' : 'empty', polygonCount: features.length, horizon: band, cacheOrigin };
    completeOptionalFeed('marine', {
      empty: result.status === 'empty',
      itemCount: features.length,
      cacheOrigin,
      requestId: request.requestId,
    });
    return result;
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale', polygonCount: 0, horizon: band };
    // Keeping the last good polygons through a transient failure is worth
    // doing, but only for the band they belong to. Showing another band's
    // ocean is worse than showing none, because nothing on screen says so.
    const droppedStaleBand = drawnHorizon !== null && drawnHorizon !== band;
    if (droppedStaleBand) {
      layerGroup.clearLayers();
      if (legendEl) legendEl.hidden = true;
      drawnHorizon = null;
    }
    const result = {
      status: 'error',
      polygonCount: 0,
      horizon: band,
      droppedStaleBand,
      error,
      responseStatus: error.responseStatus || 0,
    };
    failOptionalFeed('marine', { ...result, requestId: request.requestId });
    return result;
  }
}

export function clearMarineWarnings() {
  renderGeneration += 1;
  drawnHorizon = null;
  if (layerGroup) layerGroup.clearLayers();
  if (legendEl) legendEl.hidden = true;
  if (statusEl) statusEl.hidden = true;
}
