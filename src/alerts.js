// 2026 NHC cone parity — coastal AND inland tropical watches/warnings.
//
// Since the 2026 season the official NHC cone graphic includes inland
// tropical-storm/hurricane watches and warnings (CONUS, HI, PR, USVI) with a
// pink/blue diagonal hatch where a Hurricane Watch overlaps a Tropical Storm
// Warning. NWS alerts are zone-based, so hazard stacking is resolved per UGC
// zone (no geometry math needed); zone polygons come from the CORS-enabled
// api.weather.gov /zones endpoint and are cached for the session.
import { t } from './i18n.js';

const API_BASE = 'https://api.weather.gov';
const TROPICAL_EVENTS = [
  'Hurricane Warning',
  'Hurricane Watch',
  'Tropical Storm Warning',
  'Tropical Storm Watch',
];
const REQUEST_TIMEOUT_MS = 12 * 1000;
const ALERTS_CACHE_MS = 10 * 60 * 1000;
const ZONE_FETCH_CONCURRENCY = 8;
const MAX_ZONES = 250;
const HATCH_PATTERN_ID = 'hm-ww-hatch';

// The 2026 cone shows land watches/warnings (CONUS, HI, PR, USVI); marine
// zones (AMZ/ANZ/GMZ/PZZ…) would only clutter the map. UGC prefixes are
// USPS state/territory codes for land zones.
const LAND_UGC_PREFIXES = new Set([
  'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA',
  'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO',
  'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK',
  'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VI', 'VT',
  'WA', 'WI', 'WV', 'WY', 'GU', 'AS', 'MP',
]);

export const EVENT_TO_FLAG = {
  'Hurricane Warning': 'huWarning',
  'Hurricane Watch': 'huWatch',
  'Tropical Storm Warning': 'tsWarning',
  'Tropical Storm Watch': 'tsWatch',
};

// 2026 NHC cone legend colors: warning red, hurricane watch pink,
// TS warning blue, TS watch yellow, watch+warning overlap pink/blue hatch.
export const HAZARD_STYLE = {
  huWarning: { color: '#e64553', fillColor: '#e64553', fillOpacity: 0.34 },
  huWatchTsWarning: { color: '#f5a8d3', fillColor: `url(#${HATCH_PATTERN_ID})`, fillOpacity: 0.55 },
  huWatch: { color: '#f5a8d3', fillColor: '#f5a8d3', fillOpacity: 0.32 },
  tsWarning: { color: '#4c8ce6', fillColor: '#4c8ce6', fillOpacity: 0.30 },
  tsWatch: { color: '#f9e2af', fillColor: '#f9e2af', fillOpacity: 0.26 },
};

// Render order: watches under warnings so the higher hazard reads on top.
export const HAZARD_PRIORITY = ['tsWatch', 'huWatch', 'tsWarning', 'huWatchTsWarning', 'huWarning'];

let layerGroup = null;
let layerMap = null;
let legendEl = null;
let alertsCache = null;
let renderGeneration = 0;
const zoneGeometryCache = new Map();

export function buildAlertsUrl() {
  // Multi-value filters must be comma-separated in ONE param — repeated
  // event= params silently override each other (verified live 2026-07-09).
  const params = new URLSearchParams({
    status: 'actual',
    message_type: 'alert,update',
    event: TROPICAL_EVENTS.join(','),
  });
  return `${API_BASE}/alerts/active?${params.toString()}`;
}

// The /zones list endpoint ignores include_geometry (verified live
// 2026-07-09); only the single-zone endpoint returns geometry. UGC format:
// SSZNNN = forecast zone, SSCNNN = county.
export function buildZoneUrl(zoneId) {
  const type = zoneId[2] === 'C' ? 'county' : 'forecast';
  return `${API_BASE}/zones/${type}/${zoneId}`;
}

export function isLandZone(zoneId) {
  return typeof zoneId === 'string' && zoneId.length === 6 && LAND_UGC_PREFIXES.has(zoneId.slice(0, 2));
}

/** Resolve the stacked hazard for one zone per the 2026 cone rules. */
export function resolveHazard(flags) {
  if (flags.has('huWarning')) return 'huWarning';
  if (flags.has('huWatch') && flags.has('tsWarning')) return 'huWatchTsWarning';
  if (flags.has('huWatch')) return 'huWatch';
  if (flags.has('tsWarning')) return 'tsWarning';
  if (flags.has('tsWatch')) return 'tsWatch';
  return null;
}

/** Map alert features to per-zone hazard flag sets plus any alerts that carry
 *  their own polygon geometry (rendered directly, no zone lookup needed). */
export function classifyAlerts(features) {
  const zoneFlags = new Map();
  const directGeometries = [];
  for (const feature of features || []) {
    const flag = EVENT_TO_FLAG[feature?.properties?.event];
    if (!flag) continue;
    if (feature.geometry) {
      directGeometries.push({ geometry: feature.geometry, flags: new Set([flag]) });
      continue;
    }
    const ugcCodes = feature?.properties?.geocode?.UGC || [];
    for (const zone of ugcCodes) {
      if (!isLandZone(zone)) continue;
      if (!zoneFlags.has(zone)) zoneFlags.set(zone, new Set());
      zoneFlags.get(zone).add(flag);
    }
  }
  return { zoneFlags, directGeometries };
}

export function hazardLabel(hazard) {
  return t(`alerts.${hazard}`);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/geo+json' },
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchActiveAlerts(force = false) {
  const now = Date.now();
  if (!force && alertsCache && now - alertsCache.fetchedAt < ALERTS_CACHE_MS) return alertsCache.features;
  const data = await fetchWithTimeout(buildAlertsUrl());
  const features = Array.isArray(data?.features) ? data.features : [];
  alertsCache = { fetchedAt: now, features };
  return features;
}

async function resolveZoneGeometries(zoneIds) {
  const missing = zoneIds.filter(id => !zoneGeometryCache.has(id));
  if (missing.length > MAX_ZONES) {
    console.warn(`Tropical alerts cover ${missing.length} zones; rendering the first ${MAX_ZONES}.`);
    missing.length = MAX_ZONES;
  }
  // Zone geometry is only served per-zone; fetch through a small worker pool
  // and cache for the session (zone boundaries are effectively static).
  let cursor = 0;
  async function worker() {
    while (cursor < missing.length) {
      const zoneId = missing[cursor];
      cursor += 1;
      try {
        const data = await fetchWithTimeout(buildZoneUrl(zoneId));
        if (data?.geometry) zoneGeometryCache.set(zoneId, data.geometry);
      } catch {
        // Missing/renamed zone — skip; the rest of the overlay still renders.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ZONE_FETCH_CONCURRENCY, missing.length) }, worker));
  return zoneIds.filter(id => zoneGeometryCache.has(id));
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function ensureHatchPattern(map) {
  const svg = map?.getPane('overlayPane')?.querySelector('svg');
  if (!svg || svg.querySelector(`#${HATCH_PATTERN_ID}`)) return;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.prepend(defs);
  }
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', HATCH_PATTERN_ID);
  pattern.setAttribute('width', '8');
  pattern.setAttribute('height', '8');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('patternTransform', 'rotate(45)');
  const pink = document.createElementNS(SVG_NS, 'rect');
  pink.setAttribute('width', '8');
  pink.setAttribute('height', '8');
  pink.setAttribute('fill', '#f5a8d3');
  const blue = document.createElementNS(SVG_NS, 'rect');
  blue.setAttribute('width', '4');
  blue.setAttribute('height', '8');
  blue.setAttribute('fill', '#4c8ce6');
  pattern.appendChild(pink);
  pattern.appendChild(blue);
  defs.appendChild(pattern);
}

function polygonStyle(hazard) {
  const style = HAZARD_STYLE[hazard];
  return {
    ...style,
    weight: 1,
    opacity: 0.85,
    className: `tropical-alert tropical-alert--${hazard}`,
  };
}

function addHazardPolygons(entries) {
  const L = window.L;
  const present = new Set();
  for (const hazard of HAZARD_PRIORITY) {
    const geometries = entries.filter(entry => entry.hazard === hazard).map(entry => entry.geometry);
    if (!geometries.length) continue;
    present.add(hazard);
    const layer = L.geoJSON(
      { type: 'FeatureCollection', features: geometries.map(geometry => ({ type: 'Feature', geometry })) },
      { style: () => polygonStyle(hazard) },
    );
    layer.bindTooltip(hazardLabel(hazard), { direction: 'top', sticky: true });
    layerGroup.addLayer(layer);
  }
  return present;
}

function updateLegend(present) {
  if (!present.size) {
    if (legendEl) legendEl.hidden = true;
    return;
  }
  if (!legendEl) {
    legendEl = document.createElement('div');
    legendEl.id = 'tropical-alert-legend';
    legendEl.className = 'tropical-alert-legend glass';
    legendEl.setAttribute('role', 'group');
    document.body.appendChild(legendEl);
  }
  legendEl.setAttribute('aria-label', t('alerts.legendTitle'));
  const rows = [...HAZARD_PRIORITY].reverse()
    .filter(hazard => present.has(hazard))
    .map(hazard => `
      <li class="tal-row">
        <span class="tal-swatch tal-swatch--${hazard}" aria-hidden="true"></span>
        <span>${hazardLabel(hazard)}</span>
      </li>`)
    .join('');
  legendEl.innerHTML = `
    <strong class="tal-title">${t('alerts.legendTitle')}</strong>
    <ul class="tal-list">${rows}</ul>`;
  legendEl.hidden = false;
}

export async function renderTropicalAlerts(activeStorms, { map, enabled = true, force = false } = {}) {
  if (!map || !enabled || !Array.isArray(activeStorms) || activeStorms.length === 0) {
    clearTropicalAlerts();
    return { status: 'idle', zoneCount: 0 };
  }
  const generation = ++renderGeneration;
  ensureLayer(map);
  try {
    const features = await fetchActiveAlerts(force);
    if (generation !== renderGeneration) return { status: 'stale', zoneCount: 0 };
    const { zoneFlags, directGeometries } = classifyAlerts(features);
    const resolvedZoneIds = await resolveZoneGeometries([...zoneFlags.keys()]);
    if (generation !== renderGeneration) return { status: 'stale', zoneCount: 0 };

    const entries = [];
    for (const zoneId of resolvedZoneIds) {
      const hazard = resolveHazard(zoneFlags.get(zoneId));
      if (hazard) entries.push({ hazard, geometry: zoneGeometryCache.get(zoneId) });
    }
    for (const direct of directGeometries) {
      const hazard = resolveHazard(direct.flags);
      if (hazard) entries.push({ hazard, geometry: direct.geometry });
    }

    layerGroup.clearLayers();
    const present = addHazardPolygons(entries);
    ensureHatchPattern(map);
    updateLegend(present);
    return { status: entries.length ? 'rendered' : 'empty', zoneCount: entries.length };
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale', zoneCount: 0 };
    console.warn('Tropical watch/warning overlay unavailable:', error);
    clearTropicalAlerts();
    return { status: 'error', zoneCount: 0 };
  }
}

export function clearTropicalAlerts() {
  renderGeneration++;
  if (layerGroup) layerGroup.clearLayers();
  if (legendEl) legendEl.hidden = true;
}
