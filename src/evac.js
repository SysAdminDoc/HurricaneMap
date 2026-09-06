// Evacuation-zone lookup. Florida has a state-published ArcGIS layer that this
// module can query directly; other states remain labelled official link-outs
// because their zone boundaries and lookup services are state/local specific.
// Typed addresses go to Esri's World Geocoding Service; map-point checks send
// only coordinates to Florida's zone layer, and HurricaneMap stores neither.

import { escapeHtml, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import { getMapOverlayColor } from './map-colors.js';
import { hidePanel, showPanel } from './panels.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import {
  beginOptionalFeed,
  cancelOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  registerOptionalFeedRetry,
} from './optional-feeds.js';

export const FLORIDA_ZONE_LAYER = 'https://services.arcgis.com/3wFbqsFPLeKqOlIK/arcgis/rest/services/KYZ_ZL_Vector_Enriched_Calculated_20230608/FeatureServer/46';
export const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
export const FLORIDA_KNOW_YOUR_ZONE = 'https://www.floridadisaster.org/knowyourzone/';
export const FLORIDA_ZONE_LAYER_METADATA = `${FLORIDA_ZONE_LAYER}?f=json`;

export const EVACUATION_SOURCES = Object.freeze({
  FL: Object.freeze({
    code: 'FL',
    labelKey: 'evac.florida',
    authority: 'Florida Division of Emergency Management',
    officialUrl: FLORIDA_KNOW_YOUR_ZONE,
    directLayer: true,
  }),
  NC: Object.freeze({
    code: 'NC',
    labelKey: 'evac.northCarolina',
    authority: 'North Carolina Department of Public Safety / Emergency Management',
    officialUrl: 'https://www.ncdps.gov/our-organization/emergency-management/emergency-preparedness/know-your-zone',
    directLayer: false,
  }),
  SC: Object.freeze({
    code: 'SC',
    labelKey: 'evac.southCarolina',
    authority: 'South Carolina Emergency Management Division',
    officialUrl: 'https://scemd.org/prepare/know-your-zone/',
    directLayer: false,
  }),
  GA: Object.freeze({
    code: 'GA',
    labelKey: 'evac.georgia',
    authority: 'Georgia Emergency Management and Homeland Security Agency',
    officialUrl: 'https://gema.georgia.gov/hurricanes',
    directLayer: false,
  }),
  TX: Object.freeze({
    code: 'TX',
    labelKey: 'evac.texas',
    authority: 'Texas Division of Emergency Management / Texas Hurricane Center',
    officialUrl: 'https://gov.texas.gov/hurricane',
    directLayer: false,
  }),
  VA: Object.freeze({
    code: 'VA',
    labelKey: 'evac.virginia',
    authority: 'Virginia Department of Emergency Management',
    officialUrl: 'https://vdem.virginia.gov/know-your-zone/',
    directLayer: false,
  }),
  MD: Object.freeze({
    code: 'MD',
    labelKey: 'evac.maryland',
    authority: 'Maryland Emergency Management Agency',
    officialUrl: 'https://mdem.maryland.gov/action/Pages/know-your-zone-md.aspx',
    directLayer: false,
  }),
  MA: Object.freeze({
    code: 'MA',
    labelKey: 'evac.massachusetts',
    authority: 'Massachusetts Emergency Management Agency',
    officialUrl: 'https://www.mass.gov/info-details/hurricane-evacuation-zones',
    directLayer: false,
  }),
});

const FLORIDA_BOUNDS = { west: -87.75, south: 24.35, east: -79.75, north: 31.15 };

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function buildFloridaZoneQueryUrl(lat, lon) {
  const latitude = finiteCoordinate(lat);
  const longitude = finiteCoordinate(lon);
  if (latitude == null || longitude == null) throw new TypeError('Valid latitude and longitude are required');
  const url = new URL(`${FLORIDA_ZONE_LAYER}/query`);
  url.searchParams.set('f', 'json');
  url.searchParams.set('geometry', `${longitude},${latitude}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'EZone,County_Nam,STATUS,Edit_Date,EM_Web,EZone_2');
  url.searchParams.set('returnGeometry', 'false');
  return url.href;
}

export function buildFloridaLayerMetadataUrl() {
  return FLORIDA_ZONE_LAYER_METADATA;
}

export function buildFloridaGeocodeUrl(address) {
  const value = String(address || '').trim();
  if (!value) throw new TypeError('An address is required');
  const url = new URL(ARCGIS_GEOCODER);
  url.searchParams.set('f', 'json');
  url.searchParams.set('singleLine', value);
  url.searchParams.set('countryCode', 'USA');
  url.searchParams.set('searchExtent', `${FLORIDA_BOUNDS.west},${FLORIDA_BOUNDS.south},${FLORIDA_BOUNDS.east},${FLORIDA_BOUNDS.north}`);
  url.searchParams.set('outFields', 'Region,City,Match_addr');
  url.searchParams.set('maxLocations', '5');
  return url.href;
}

function cleanText(value, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function parseFloridaZoneResponse(payload) {
  if (!payload || typeof payload !== 'object' || payload.error) return null;
  const attributes = payload.features?.[0]?.attributes;
  if (!attributes || typeof attributes !== 'object') return null;
  const zone = cleanText(attributes.EZone || attributes.EZone_2, 20).toUpperCase();
  if (!zone) return null;
  return {
    zone,
    county: cleanText(attributes.County_Nam, 80),
    status: cleanText(attributes.STATUS, 120),
    editDate: cleanText(attributes.Edit_Date, 40),
    emergencyManagementUrl: cleanText(attributes.EM_Web, 500),
  };
}

export function parseFloridaLayerMetadata(payload) {
  if (!payload || typeof payload !== 'object' || payload.error) return null;
  if (payload.type !== 'Feature Layer' || !Array.isArray(payload.fields)) return null;
  const name = cleanText(payload.name, 120);
  const geometryType = cleanText(payload.geometryType, 80);
  if (!name || !geometryType || payload.fields.length === 0) return null;
  return {
    name,
    geometryType,
    fieldCount: payload.fields.length,
  };
}

export function classifyFloridaLayerAvailability(payload) {
  if (payload?.error) return { available: false, reason: 'service-error' };
  if (!parseFloridaLayerMetadata(payload)) return { available: false, reason: 'invalid-response' };
  return { available: true, reason: 'available' };
}

function isInFloridaBounds(lat, lon) {
  return lat >= FLORIDA_BOUNDS.south && lat <= FLORIDA_BOUNDS.north
    && lon >= FLORIDA_BOUNDS.west && lon <= FLORIDA_BOUNDS.east;
}

export function chooseFloridaCandidate(payload) {
  if (!payload || typeof payload !== 'object' || payload.error || !Array.isArray(payload.candidates)) return null;
  for (const candidate of payload.candidates) {
    const lat = finiteCoordinate(candidate?.location?.y);
    const lon = finiteCoordinate(candidate?.location?.x);
    if (lat == null || lon == null || !isInFloridaBounds(lat, lon)) continue;
    const region = cleanText(candidate?.attributes?.Region, 30).toUpperCase();
    if (region && region !== 'FL' && region !== 'FLORIDA') continue;
    return { lat, lon, address: cleanText(candidate.address || candidate?.attributes?.Match_addr, 200) };
  }
  return null;
}

function normalizeOfficialUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return '';
  return safeExternalUrl(/^www\./i.test(text) ? `https://${text}` : text, { protocols: ['https:'] });
}

function officialLinks() {
  const links = Object.values(EVACUATION_SOURCES).map(source => {
    const url = safeExternalUrl(source.officialUrl);
    if (!url) return '';
    return `<a href="${url}" target="_blank" rel="noopener" title="${escapeHtml(source.authority)}" aria-label="${escapeHtml(`${t(source.labelKey)} — ${source.authority}`)}">${escapeHtml(t(source.labelKey))}</a>`;
  }).join('');
  return `
    <div class="evac-linkouts" aria-labelledby="evac-other-states">
      <h3 id="evac-other-states">${escapeHtml(t('evac.otherStates'))}</h3>
      <div>${links}</div>
    </div>`;
}

let wired = false;
let requestController = null;
let mapClickHandler = null;
let locationMarker = null;
let mapModule = null;

function getMap() { return mapModule?.getMap?.() || null; }

function panel() { return document.getElementById('evac-panel'); }

function setStatus(message, tone = '') {
  const result = document.getElementById('evac-result');
  if (!result) return;
  result.className = `evac-result${tone ? ` evac-result--${tone}` : ''}`;
  result.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function renderFailure(message) {
  const result = document.getElementById('evac-result');
  if (!result) return;
  result.className = 'evac-result evac-result--warning';
  result.innerHTML = `<p>${escapeHtml(message)}</p><a href="${FLORIDA_KNOW_YOUR_ZONE}" target="_blank" rel="noopener">${escapeHtml(t('evac.verifyFlorida'))}</a>`;
}

function renderZone(zone, locationLabel = '') {
  const result = document.getElementById('evac-result');
  if (!result) return;
  const localUrl = normalizeOfficialUrl(zone.emergencyManagementUrl);
  result.className = 'evac-result evac-result--found';
  result.innerHTML = `
    ${locationLabel ? `<p class="evac-location">${escapeHtml(locationLabel)}</p>` : ''}
    <div class="evac-zone-badge"><span>${escapeHtml(t('evac.zone'))}</span><strong>${escapeHtml(zone.zone)}</strong></div>
    ${zone.county ? `<p><strong>${escapeHtml(t('evac.county'))}:</strong> ${escapeHtml(zone.county)}</p>` : ''}
    ${zone.status ? `<p class="evac-order"><strong>${escapeHtml(t('evac.currentOrder'))}:</strong> ${escapeHtml(zone.status)}</p>` : ''}
    <p>${escapeHtml(t('evac.caveat'))}</p>
    <div class="evac-result-links">
      <a href="${FLORIDA_KNOW_YOUR_ZONE}" target="_blank" rel="noopener">${escapeHtml(t('evac.verifyFlorida'))}</a>
      ${localUrl ? `<a href="${localUrl}" target="_blank" rel="noopener">${escapeHtml(t('evac.localOfficials'))}</a>` : ''}
    </div>`;
}

function clearMapSelection() {
  const map = getMap();
  if (map && mapClickHandler) map.off('click', mapClickHandler);
  mapClickHandler = null;
  document.getElementById('map')?.classList.remove('evac-map-selecting');
}

function clearLocationMarker() {
  if (locationMarker) locationMarker.remove();
  locationMarker = null;
}

function markLocation(lat, lon) {
  const map = getMap();
  const L = globalThis.L;
  if (!map || !L) return;
  if (locationMarker) locationMarker.remove();
  locationMarker = L.circleMarker([lat, lon], {
    radius: 8, color: getMapOverlayColor('forecast'), weight: 3, fillColor: getMapOverlayColor('location'), fillOpacity: 0.9, className: 'evac-location-marker',
  }).addTo(map);
}

// The layer probe must not share the cancel-the-previous-request controller:
// a user typing an address while the probe is open aborted it, which reported
// the feed idle and took its retry button away after a routine interaction.
async function fetchJsonIsolated(url) {
  const response = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json' },
  }, REQUEST_TIMEOUT_MS.evacuation);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchJson(url) {
  requestController?.abort();
  requestController = new AbortController();
  const controller = requestController;
  try {
    const response = await fetchWithTimeout(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }, REQUEST_TIMEOUT_MS.evacuation);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    if (requestController === controller) requestController = null;
  }
}

let floridaLayerProbe = { checkedAt: 0, result: null };
const FLORIDA_LAYER_PROBE_TTL_MS = 5 * 60 * 1000;

export async function probeFloridaZoneLayer({ force = false, fetcher = fetchJsonIsolated } = {}) {
  const now = Date.now();
  if (!force && floridaLayerProbe.result && now - floridaLayerProbe.checkedAt < FLORIDA_LAYER_PROBE_TTL_MS) {
    return floridaLayerProbe.result;
  }
  const request = beginOptionalFeed('evac', { cacheOrigin: 'network' });
  try {
    const payload = await fetcher(buildFloridaLayerMetadataUrl());
    const result = classifyFloridaLayerAvailability(payload);
    floridaLayerProbe = { checkedAt: now, result };
    if (result.available) {
      completeOptionalFeed('evac', { cacheOrigin: 'network', itemCount: 1, requestId: request.requestId });
    } else {
      failOptionalFeed('evac', {
        error: new Error(`Florida evacuation zone layer is ${result.reason || 'unavailable'}`),
        responseStatus: 0,
        cacheOrigin: 'network',
        requestId: request.requestId,
      });
    }
    return result;
  } catch (error) {
    const cancelled = error?.name === 'AbortError';
    const result = { available: false, reason: cancelled ? 'cancelled' : 'unreachable' };
    floridaLayerProbe = { checkedAt: now, result };
    if (cancelled) cancelOptionalFeed('evac', { requestId: request.requestId });
    else {
      failOptionalFeed('evac', {
        error,
        responseStatus: error?.responseStatus || 0,
        cacheOrigin: 'network',
        requestId: request.requestId,
      });
    }
    return result;
  }
}

registerOptionalFeedRetry('evac', () => probeFloridaZoneLayer({ force: true }));

function layerFailureMessage(status) {
  return status?.reason === 'invalid-response'
    ? t('evac.layerInvalid')
    : t('evac.layerUnavailable');
}

export async function lookupFloridaPoint(lat, lon, { locationLabel = '' } = {}) {
  setStatus(t('evac.loading'));
  try {
    const layerStatus = await probeFloridaZoneLayer();
    if (!layerStatus.available) {
      markLocation(lat, lon);
      renderFailure(layerFailureMessage(layerStatus));
      return null;
    }
    const payload = await fetchJson(buildFloridaZoneQueryUrl(lat, lon));
    if (payload?.error) {
      markLocation(lat, lon);
      renderFailure(t('evac.layerUnavailable'));
      return null;
    }
    const zone = parseFloridaZoneResponse(payload);
    markLocation(lat, lon);
    if (!zone) {
      renderFailure(t('evac.noZone'));
      return null;
    }
    renderZone(zone, locationLabel);
    return zone;
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    console.warn('Florida evacuation-zone lookup failed:', error);
    renderFailure(t('evac.layerUnavailable'));
    return null;
  }
}

async function lookupAddress(address) {
  setStatus(t('evac.locating'));
  try {
    const payload = await fetchJson(buildFloridaGeocodeUrl(address));
    const candidate = chooseFloridaCandidate(payload);
    if (!candidate) {
      renderFailure(t('evac.notFlorida'));
      return;
    }
    await lookupFloridaPoint(candidate.lat, candidate.lon, { locationLabel: candidate.address });
  } catch (error) {
    // fetchJson aborts the previous request as soon as a new one starts, so
    // submitting a second address replaced "Locating…" with a generic error
    // while the second lookup was still running. lookupFloridaPoint above
    // already returns on an abort; this path did not.
    if (error?.name === 'AbortError') return;
    console.warn('Florida address lookup failed:', error);
    renderFailure(t('evac.error'));
  }
}

function startMapSelection() {
  const map = getMap();
  if (!map) {
    renderFailure(t('evac.error'));
    return;
  }
  clearMapSelection();
  document.getElementById('map')?.classList.add('evac-map-selecting');
  setStatus(t('evac.mapPrompt'));
  mapClickHandler = event => {
    clearMapSelection();
    const { lat, lng } = event.latlng;
    lookupFloridaPoint(lat, lng, { locationLabel: t('evac.mapLocation') });
  };
  map.once('click', mapClickHandler);
}

export function renderEvacPanel() {
  const body = document.getElementById('evac-body');
  if (!body) return;
  body.innerHTML = `
    <p class="evac-intro">${escapeHtml(t('evac.intro'))}</p>
    <form class="evac-address" id="evac-address-form">
      <label for="evac-address-input">${escapeHtml(t('evac.addressLabel'))}</label>
      <div><input id="evac-address-input" name="address" type="search" autocomplete="street-address" placeholder="${escapeHtml(t('evac.addressPlaceholder'))}" required><button class="text-btn" type="submit">${escapeHtml(t('evac.find'))}</button></div>
      <small>${escapeHtml(t('evac.privacy'))}</small>
    </form>
    <button class="text-btn evac-map-pick" id="evac-map-pick" type="button">${escapeHtml(t('evac.pickMap'))}</button>
    <div class="evac-result" id="evac-result" role="status" aria-live="polite"><p>${escapeHtml(t('evac.ready'))}</p></div>
    <p class="evac-not-flood">${escapeHtml(t('evac.notFlood'))}</p>
    ${officialLinks()}`;
}

function ensureWired() {
  if (wired) return;
  const root = panel();
  if (!root) return;
  wired = true;
  document.getElementById('close-evac')?.addEventListener('click', () => {
    clearMapSelection();
    clearLocationMarker();
    hidePanel('evac-panel');
  });
  root.addEventListener('submit', event => {
    if (!event.target.matches('#evac-address-form')) return;
    event.preventDefault();
    const input = document.getElementById('evac-address-input');
    if (input?.value.trim()) lookupAddress(input.value);
  });
  root.addEventListener('click', event => {
    if (event.target.closest('#evac-map-pick')) startMapSelection();
  });
  document.addEventListener('hm-panel:hidden', event => {
    if (event.detail?.id !== 'evac-panel') return;
    clearMapSelection();
    clearLocationMarker();
    requestController?.abort();
  });
  document.addEventListener('hm-locale:change', () => {
    if (!root.hidden) renderEvacPanel();
  });
}

export async function openEvacPanel() {
  mapModule ||= await import('./map.js');
  ensureWired();
  renderEvacPanel();
  showPanel('evac-panel');
}
