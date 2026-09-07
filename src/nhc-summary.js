// NHC's Tropical Weather Summary MapServer is the one live NHC source a
// browser can read for itself. It answers with an Access-Control-Allow-Origin
// header for this origin, while www.nhc.noaa.gov/CurrentStorms.json and the
// Graphical Tropical Weather Outlook KMZ send no CORS header at all and can
// only be reached through cloudflare/worker.js. On a deployment with no relay
// in front of it — GitHub Pages, serve.py, the Docker image — this module is
// what keeps active-storm tracking and the outlook working instead of both
// reporting "not available on this deployment".
//
// The shapes below are deliberately the shapes the rest of the app already
// consumes: fetchSummaryActiveStorms() returns entries in CurrentStorms.json's
// `activeStorms` shape and fetchSummaryOutlookPoints() returns points in
// parseOutlookKml()'s shape, so nothing downstream has to know which source
// answered. What the MapServer cannot supply is the advisory and discussion
// URLs, which live only in CurrentStorms.json; activeStormCardElement() drops
// links whose URL is missing, so the card degrades to the storm's fixed NHC
// links rather than breaking.

import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

export const SUMMARY_SERVICE_ROOT =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';

export const SUMMARY_LAYERS = Object.freeze({
  // Seven-Day: Current Location. The seven-day set contains every disturbance
  // the two-day set does, so reading layer 1 as well would only duplicate it.
  outlook: 2,
  // One row per storm per forecast hour, tau 0 being the current fix.
  forecastPoints: 5,
});

// Recorded 2026-09-07 against the live service. A rename upstream would turn
// every storm into a nameless blank at an unknown position rather than raise
// anything, so the parsers refuse a payload that has lost one of these.
export const SUMMARY_FORECAST_FIELDS = Object.freeze([
  'stormname', 'stormtype', 'basin', 'stormnum', 'binnumber',
  'advisnum', 'advdate', 'maxwind', 'mslp', 'lat', 'lon', 'validtime', 'tau',
]);

export const SUMMARY_OUTLOOK_FIELDS = Object.freeze([
  'basin', 'prob2day', 'risk2day', 'prob7day', 'risk7day',
]);

// NHC writes 9999 into numeric fields it has no value for, and the forecast
// rows past tau 0 carry it for pressure, direction and speed.
const MISSING_NUMERIC = 9999;

export function buildSummaryQueryUrl(layer, { outFields = ['*'], where = '1=1' } = {}) {
  const params = new URLSearchParams({
    where,
    outFields: outFields.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  return `${SUMMARY_SERVICE_ROOT}/${layer}/query?${params.toString()}`;
}

function summaryFeatures(payload, layer) {
  if (payload?.error) {
    const error = new Error(`NHC summary layer ${layer} returned ${payload.error.message || 'an error'}`);
    error.responseStatus = Number(payload.error.code) || 0;
    throw error;
  }
  return Array.isArray(payload?.features) ? payload.features : [];
}

// An empty layer is the off-season answer, not a broken contract, so the field
// check only runs when there is a row to check it against.
function assertSummaryFields(features, required, layer) {
  const properties = features[0]?.properties;
  if (!properties) return;
  const missing = required.filter(field => !(field in properties));
  if (!missing.length) return;
  const error = new Error(
    `NHC summary layer ${layer} no longer publishes ${missing.join(', ')}`,
  );
  error.missingFields = missing;
  throw error;
}

function finiteNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) >= MISSING_NUMERIC) return null;
  return numeric;
}

function featurePosition(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  const lat = Number(feature?.properties?.lat);
  const lon = Number(feature?.properties?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
}

// The service publishes "Hurricane Lowell" and "Potential Tropical Cyclone
// Four" where CurrentStorms.json publishes "Lowell" and "Four": the storm's
// own name is the last word, and the words before it repeat stormtype.
export function summaryStormName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// The ATCF id the rest of the app matches on (EP122026). basin and stormnum
// give the first six characters; the year comes from the advisory the row was
// cut from, because validtime carries only a day and a clock.
export function summaryStormId(properties, now = Date.now()) {
  const basin = String(properties?.basin || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const number = Number(properties?.stormnum);
  if (basin.length !== 2 || !Number.isFinite(number) || number <= 0) return '';
  return `${basin}${String(Math.trunc(number)).padStart(2, '0')}${summaryYear(properties, now)}`;
}

function summaryYear(properties, now) {
  const filed = Number(properties?.idp_filedate);
  if (Number.isFinite(filed) && filed > 0) {
    const filedDate = new Date(filed);
    if (Number.isFinite(filedDate.getTime())) return filedDate.getUTCFullYear();
  }
  const advisoryYear = String(properties?.advdate || '').match(/\b(?:19|20)\d{2}\b/);
  if (advisoryYear) return Number(advisoryYear[0]);
  return new Date(now).getUTCFullYear();
}

export function parseSummaryActiveStorms(payload, { now = Date.now() } = {}) {
  const features = summaryFeatures(payload, SUMMARY_LAYERS.forecastPoints);
  assertSummaryFields(features, SUMMARY_FORECAST_FIELDS, SUMMARY_LAYERS.forecastPoints);

  // One row per forecast hour, so the storm is whichever row sits earliest on
  // its own timeline. tau 0 is the current fix in every advisory seen so far,
  // but taking the minimum survives an advisory that omits it.
  const earliest = new Map();
  for (const feature of features) {
    const properties = feature?.properties;
    if (!properties) continue;
    const key = String(properties.binnumber || '').trim().toUpperCase()
      || `${properties.basin}:${properties.stormnum}`;
    const tau = Number(properties.tau);
    const previous = earliest.get(key);
    if (previous && Number(previous.properties.tau) <= (Number.isFinite(tau) ? tau : Infinity)) continue;
    earliest.set(key, feature);
  }

  const storms = [];
  for (const feature of earliest.values()) {
    const properties = feature.properties;
    const position = featurePosition(feature);
    if (!position) continue;
    storms.push({
      id: summaryStormId(properties, now),
      binNumber: String(properties.binnumber || '').trim(),
      name: summaryStormName(properties.stormname),
      classification: String(properties.stormtype || '').trim(),
      intensity: finiteNumber(properties.maxwind),
      pressure: finiteNumber(properties.mslp),
      movementDir: finiteNumber(properties.tcdir),
      movementSpeed: finiteNumber(properties.tcspd),
      lat: position.lat,
      lon: position.lon,
      latitudeNumeric: position.lat,
      longitudeNumeric: position.lon,
      advNum: String(properties.advisnum || '').trim(),
      lastUpdate: String(properties.advdate || '').trim(),
      basin: String(properties.basin || '').trim(),
    });
  }
  return storms.sort((a, b) => a.id.localeCompare(b.id) || a.binNumber.localeCompare(b.binNumber));
}

function outlookRisk(properties) {
  const category = `${properties?.risk7day ?? ''} ${properties?.prob7day ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (category.includes('nearzero') || category.includes('near0')) return 'near-zero';
  if (category.includes('high')) return 'high';
  if (category.includes('medium')) return 'medium';
  return 'low';
}

// The KMZ numbers its disturbances 1..N in the order NHC lists them, and the
// MapServer returns the same set in objectid order. The position in that order
// is the same ordinal, so a marker still reads "Disturbance 2" rather than a
// bare word. The discussion paragraph exists only in the KMZ.
export function parseSummaryOutlookPoints(payload) {
  const features = summaryFeatures(payload, SUMMARY_LAYERS.outlook);
  assertSummaryFields(features, SUMMARY_OUTLOOK_FIELDS, SUMMARY_LAYERS.outlook);

  const ordered = [...features].sort(
    (a, b) => Number(a?.properties?.objectid ?? 0) - Number(b?.properties?.objectid ?? 0),
  );
  const points = [];
  for (const feature of ordered) {
    const position = featurePosition(feature);
    if (!position) continue;
    const properties = feature.properties || {};
    points.push({
      basin: String(properties.basin || '').trim().toLowerCase(),
      disturbance: String(points.length + 1),
      lat: position.lat,
      lon: position.lon,
      risk: outlookRisk(properties),
      twoDay: String(properties.prob2day || '').trim(),
      sevenDay: String(properties.prob7day || '').trim(),
      discussion: '',
    });
  }
  return points;
}

async function fetchSummaryLayer(layer, { fetchImpl = fetchWithTimeout, signal } = {}) {
  const response = await fetchImpl(buildSummaryQueryUrl(layer), {
    signal,
    headers: { Accept: 'application/geo+json, application/json' },
  }, REQUEST_TIMEOUT_MS.active);
  if (!response.ok) {
    const error = new Error(`NHC summary layer ${layer} returned ${response.status}`);
    error.responseStatus = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchSummaryActiveStorms({ fetchImpl = fetchWithTimeout, signal, now = Date.now() } = {}) {
  const payload = await fetchSummaryLayer(SUMMARY_LAYERS.forecastPoints, { fetchImpl, signal });
  return parseSummaryActiveStorms(payload, { now });
}

export async function fetchSummaryOutlookPoints({ fetchImpl = fetchWithTimeout, signal } = {}) {
  const payload = await fetchSummaryLayer(SUMMARY_LAYERS.outlook, { fetchImpl, signal });
  return parseSummaryOutlookPoints(payload);
}
