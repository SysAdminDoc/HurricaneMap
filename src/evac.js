// Florida evacuation-zone lookup. Queries the state-published ArcGIS layer
// directly and fails back to official state resources when either service is
// unavailable. Address text is never stored by HurricaneMap.

import { escapeHtml, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import { getMapOverlayColor } from './map-colors.js';
import { hidePanel, showPanel } from './panels.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

export const FLORIDA_ZONE_LAYER = 'https://services.arcgis.com/3wFbqsFPLeKqOlIK/arcgis/rest/services/KYZ_ZL_Vector_Enriched_Calculated_20230608/FeatureServer/46';
export const ARCGIS_GEOCODER = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
export const FLORIDA_KNOW_YOUR_ZONE = 'https://www.floridadisaster.org/knowyourzone/';

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
  return `
    <div class="evac-linkouts" aria-labelledby="evac-other-states">
      <h3 id="evac-other-states">${escapeHtml(t('evac.otherStates'))}</h3>
      <div>
        <a href="${FLORIDA_KNOW_YOUR_ZONE}" target="_blank" rel="noopener">${escapeHtml(t('evac.florida'))}</a>
        <a href="https://vdem.virginia.gov/know-your-zone/" target="_blank" rel="noopener">${escapeHtml(t('evac.virginia'))}</a>
        <a href="https://mdem.maryland.gov/action/Pages/know-your-zone-md.aspx" target="_blank" rel="noopener">${escapeHtml(t('evac.maryland'))}</a>
        <a href="https://www.mass.gov/info-details/hurricane-evacuation-zones" target="_blank" rel="noopener">${escapeHtml(t('evac.massachusetts'))}</a>
      </div>
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

export async function lookupFloridaPoint(lat, lon, { locationLabel = '' } = {}) {
  setStatus(t('evac.loading'));
  try {
    const payload = await fetchJson(buildFloridaZoneQueryUrl(lat, lon));
    const zone = parseFloridaZoneResponse(payload);
    markLocation(lat, lon);
    if (!zone) {
      renderFailure(t('evac.noZone'));
      return null;
    }
    renderZone(zone, locationLabel);
    return zone;
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn('Florida evacuation-zone lookup failed:', error);
    renderFailure(t('evac.error'));
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
    if (error?.name !== 'AbortError') console.warn('Florida address lookup failed:', error);
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
