import { escapeHtml } from './html-utils.js';
import { getLocale, t } from './i18n.js';
import { pointToSegmentDistanceKm } from './geodesy.js';
import {
  beginOptionalFeed,
  cancelOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  isOptionalFeedRequestCurrent,
} from './optional-feeds.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';

const SERVICE_ROOT = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';
const PRODUCT_URL = 'https://www.nhc.noaa.gov/aboutnhcgraphics.shtml';
const GIS_URL = 'https://www.nhc.noaa.gov/gis/';
const statusMounts = new WeakMap();
const MAX_PRODUCT_AGE_MS = 9 * 60 * 60 * 1000;
const MAX_ARRIVAL_DISTANCE_KM = 75;

const WIND_LAYERS = Object.freeze([
  { layer: 30, knots: 34, mph: 39 },
  { layer: 31, knots: 50, mph: 58 },
  { layer: 32, knots: 64, mph: 74 },
]);

const ARRIVAL_LAYERS = Object.freeze([
  { layer: 18, kind: 'earliest' },
  { layer: 19, kind: 'likely' },
]);

function queryUrl(layer, params) {
  const url = new URL(`${SERVICE_ROOT}/${layer}/query`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}

export function buildWindProbabilityUrl(layer, lat, lon) {
  return queryUrl(layer, {
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'percentage,idp_source,idp_filedate',
    returnGeometry: false,
    f: 'json',
  });
}

export function buildArrivalUrl(layer, lat, lon) {
  return queryUrl(layer, {
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    distance: MAX_ARRIVAL_DISTANCE_KM,
    units: 'esriSRUnit_Kilometer',
    outFields: 'arrival_time,idp_source,idp_subset,idp_filedate',
    returnGeometry: true,
    outSR: 4326,
    f: 'geojson',
  });
}

function issueTime(properties) {
  const value = Number(properties?.idp_filedate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isFreshProduct(timestamp, now = Date.now()) {
  return Number.isFinite(timestamp) && timestamp <= now + (5 * 60 * 1000) &&
    now - timestamp <= MAX_PRODUCT_AGE_MS;
}

function probabilityRank(label) {
  const values = String(label || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return values.length ? Math.max(...values) : -1;
}

export function parseWindProbability(payload, definition, now = Date.now()) {
  const candidates = (payload?.features || [])
    .map(feature => {
      const properties = feature.attributes || feature.properties || {};
      return {
        label: String(properties.percentage || '').trim(),
        issuedAt: issueTime(properties),
        sourceId: String(properties.idp_source || '').trim(),
      };
    })
    .filter(item => item.label && isFreshProduct(item.issuedAt, now))
    .sort((a, b) => probabilityRank(b.label) - probabilityRank(a.label));
  if (!candidates.length) return null;
  return { ...definition, ...candidates[0] };
}

function geometryLines(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

export function parseNearestArrival(payload, definition, lat, lon, now = Date.now()) {
  const candidates = [];
  for (const feature of payload?.features || []) {
    const properties = feature.properties || feature.attributes || {};
    const issuedAt = issueTime(properties);
    const label = String(properties.arrival_time || '').trim();
    if (!label || !isFreshProduct(issuedAt, now)) continue;
    let distanceKm = Infinity;
    for (const line of geometryLines(feature.geometry)) {
      for (let index = 1; index < line.length; index++) {
        distanceKm = Math.min(distanceKm, pointToSegmentDistanceKm(lat, lon, line[index - 1], line[index]));
      }
    }
    if (Number.isFinite(distanceKm) && distanceKm <= MAX_ARRIVAL_DISTANCE_KM) {
      candidates.push({
        ...definition,
        label,
        distanceKm,
        issuedAt,
        sourceId: String(properties.idp_source || '').trim(),
        stormId: String(properties.idp_subset || '').trim(),
      });
    }
  }
  return candidates.sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;
}

async function fetchJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: 'application/json, application/geo+json' },
  });
  if (!response.ok) {
    const error = new Error(`NHC GIS request failed (${response.status})`);
    error.responseStatus = response.status;
    throw error;
  }
  return response.json();
}

export async function loadWindContext(lat, lon, {
  fetchImpl = fetch,
  now = Date.now(),
  signal,
} = {}) {
  const request = beginOptionalFeed('wind-context');
  const requests = [
    ...WIND_LAYERS.map(definition =>
      fetchJson(fetchImpl, buildWindProbabilityUrl(definition.layer, lat, lon), signal)
        .then(payload => parseWindProbability(payload, definition, now))),
    ...ARRIVAL_LAYERS.map(definition =>
      fetchJson(fetchImpl, buildArrivalUrl(definition.layer, lat, lon), signal)
        .then(payload => parseNearestArrival(payload, definition, lat, lon, now))),
  ];

  const settled = await Promise.allSettled(requests);
  if (signal?.aborted) {
    cancelOptionalFeed('wind-context', { requestId: request.requestId });
    return { status: 'aborted', requestId: request.requestId };
  }
  const values = settled.filter(item => item.status === 'fulfilled').map(item => item.value).filter(Boolean);
  const probabilities = values.filter(item => Number.isFinite(item.knots));
  const arrivals = values.filter(item => item.kind);
  const failed = settled.find(item => item.status === 'rejected');

  if (!probabilities.length && !arrivals.length) {
    if (failed) {
      failOptionalFeed('wind-context', {
        error: failed.reason,
        responseStatus: failed.reason?.responseStatus || 0,
        requestId: request.requestId,
      });
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return { status: 'link-only', reason: offline ? 'offline' : 'unavailable', requestId: request.requestId };
    }
    completeOptionalFeed('wind-context', { empty: true, itemCount: 0, requestId: request.requestId });
    return { status: 'link-only', reason: 'unavailable', requestId: request.requestId };
  }

  const issuedAt = Math.max(...values.map(item => item.issuedAt));
  completeOptionalFeed('wind-context', { itemCount: probabilities.length + arrivals.length, requestId: request.requestId });
  return { status: 'current', probabilities, arrivals, issuedAt, requestId: request.requestId };
}

function sourceLinks() {
  return `<a href="${PRODUCT_URL}" target="_blank" rel="noopener">${escapeHtml(t('windContext.productGuide'))}</a>
    · <a href="${GIS_URL}" target="_blank" rel="noopener">${escapeHtml(t('windContext.gisSource'))}</a>`;
}

export function renderWindContext(host, result) {
  if (!host || result?.status === 'aborted') return;
  if (!result || result.status === 'loading') {
    host.innerHTML = `<section class="wind-context" aria-live="polite">
      <h3>${escapeHtml(t('windContext.title'))}</h3>
      <div class="optional-feed-status-host" data-feed-status="wind-context"></div>
      <p class="wind-context-status">${escapeHtml(t('windContext.loading'))}</p>
    </section>`;
    return;
  }

  if (result.status !== 'current') {
    host.innerHTML = `<section class="wind-context" aria-live="polite">
      <h3>${escapeHtml(t('windContext.title'))}</h3>
      <div class="optional-feed-status-host" data-feed-status="wind-context"></div>
      <p class="wind-context-status">${escapeHtml(t(`windContext.${result.reason === 'offline' ? 'offline' : 'unavailable'}`))}</p>
      <p class="wind-context-links">${sourceLinks()}</p>
      <p class="wind-context-disclaimer">${escapeHtml(t('windContext.disclaimer'))}</p>
    </section>`;
    return;
  }

  const locale = getLocale();
  const issued = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(result.issuedAt));
  const probabilityRows = result.probabilities.length
    ? result.probabilities.map(item => `<li><strong>${item.knots} kt (${item.mph} mph)</strong><span>${escapeHtml(item.label)}</span></li>`).join('')
    : `<li class="wind-context-empty">${escapeHtml(t('windContext.noProbability'))}</li>`;
  const arrivalRows = result.arrivals.length
    ? result.arrivals.map(item => `<li><strong>${escapeHtml(t(`windContext.${item.kind}`))}</strong><span>${escapeHtml(item.label)} · ${escapeHtml(t('windContext.nearest', Math.round(item.distanceKm)))}</span></li>`).join('')
    : `<li class="wind-context-empty">${escapeHtml(t('windContext.noArrival'))}</li>`;

  host.innerHTML = `<section class="wind-context" aria-live="polite">
    <h3>${escapeHtml(t('windContext.title'))}</h3>
    <div class="optional-feed-status-host" data-feed-status="wind-context"></div>
    <p class="wind-context-issued">${escapeHtml(t('windContext.issued', issued))}</p>
    <h5>${escapeHtml(t('windContext.probability'))}</h5>
    <ul>${probabilityRows}</ul>
    <h5>${escapeHtml(t('windContext.arrival'))}</h5>
    <ul>${arrivalRows}</ul>
    <p class="wind-context-contour-note">${escapeHtml(t('windContext.contourNote'))}</p>
    <p class="wind-context-links">${sourceLinks()}</p>
    <p class="wind-context-disclaimer">${escapeHtml(t('windContext.disclaimer'))}</p>
  </section>`;
}

function mountWindStatus(host, lat, lon, options) {
  if (!host) return;
  statusMounts.get(host)?.();
  const statusHost = host.querySelector('[data-feed-status="wind-context"]');
  const cleanup = mountOptionalFeedStatus(statusHost, 'wind-context', {
    onRetry: () => renderWindContextForPoint(host, lat, lon, { ...options, signal: undefined }),
  });
  statusMounts.set(host, cleanup);
}

export async function renderWindContextForPoint(host, lat, lon, options = {}) {
  renderWindContext(host, { status: 'loading' });
  mountWindStatus(host, lat, lon, options);
  const result = await loadWindContext(lat, lon, options);
  if (Number.isInteger(result.requestId) && !isOptionalFeedRequestCurrent('wind-context', result.requestId)) {
    return { ...result, status: 'aborted', stale: true };
  }
  renderWindContext(host, result);
  if (result.status !== 'aborted') mountWindStatus(host, lat, lon, options);
  return result;
}
