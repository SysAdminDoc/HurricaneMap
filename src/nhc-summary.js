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

const SUMMARY_SERVICE_ROOT =
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
const SUMMARY_FORECAST_FIELDS = Object.freeze([
  'stormname', 'stormtype', 'basin', 'stormnum', 'binnumber',
  'advisnum', 'advdate', 'maxwind', 'mslp', 'lat', 'lon', 'validtime', 'tau',
]);

const SUMMARY_OUTLOOK_FIELDS = Object.freeze([
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

// An empty layer is the off-season answer, not a broken contract, so the check
// only runs when there is a row to run it against. Every row is checked, not
// just the first: a rename that reaches part of a payload, or a leading feature
// carrying no properties at all, would otherwise pass the whole thing and let
// the rest render as nameless storms at unknown positions.
function assertSummaryFields(features, required, layer) {
  const missing = new Set();
  for (const feature of features) {
    // RFC 7946 permits "properties": null, and such a row carries no storm to
    // check. Skipping it is not the hole the first version of this had: that
    // one stopped at features[0], so a rename reaching every row but the first
    // passed the whole payload.
    const properties = feature?.properties;
    if (!properties) continue;
    for (const field of required) {
      if (!(field in properties)) missing.add(field);
    }
  }
  if (!missing.size) return;
  const names = [...missing].join(', ');
  const error = new Error(`NHC summary layer ${layer} no longer publishes ${names}`);
  error.missingFields = [...missing];
  throw error;
}

function finiteNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) >= MISSING_NUMERIC) return null;
  return numeric;
}

// 9999 is the sentinel here as well, and a marker at 9999N is worse than no
// marker. Anything outside the sphere is refused rather than drawn.
function onEarth(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function featurePosition(feature) {
  const coordinates = feature?.geometry?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (onEarth(lat, lon)) return { lat, lon };
  }
  const lat = Number(feature?.properties?.lat);
  const lon = Number(feature?.properties?.lon);
  if (onEarth(lat, lon)) return { lat, lon };
  return null;
}

// The service publishes "Hurricane Lowell" and "Potential Tropical Cyclone
// Four" where CurrentStorms.json publishes "Lowell" and "Four": the storm's
// own name is the last word, and the words before it repeat stormtype.
function summaryStormName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// The ATCF id the rest of the app matches on (EP122026). basin and stormnum
// give the first six characters; the year comes from the advisory the row was
// cut from, because validtime carries only a day and a clock.
export function summaryStormId(properties, now = Date.now()) {
  const basin = String(properties?.basin || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const number = Number(properties?.stormnum);
  if (basin.length !== 2 || !Number.isFinite(number) || number <= 0 || number > 99) return '';
  return `${basin}${String(Math.trunc(number)).padStart(2, '0')}${summaryYear(properties, now)}`;
}

// This service publishes only live products, so a year outside the current
// season is a misread rather than history. idp_filedate is epoch milliseconds;
// taken as seconds it lands in 1970, and every id then silently stops matching
// the cone service's STORMID. One year either side covers an advisory issued
// on 31 December and read on 1 January.
function plausibleYear(value, now) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  const current = new Date(now).getUTCFullYear();
  return year >= current - 1 && year <= current + 1 ? year : null;
}

function summaryYear(properties, now) {
  const filed = Number(properties?.idp_filedate);
  if (Number.isFinite(filed) && filed > 0) {
    const fromFile = plausibleYear(new Date(filed).getUTCFullYear(), now);
    if (fromFile) return fromFile;
  }
  // The advisory text states its year outright, so it is taken as written. Only
  // the file date is sanity-checked, because a unit mix-up there is silent,
  // whereas rejecting a year the advisory actually names would replace a
  // correct old date with a guess at today's.
  const advisoryYear = String(properties?.advdate || '').match(/\b(?:19|20)\d{2}\b/);
  if (advisoryYear) return Number(advisoryYear[0]);
  return new Date(now).getUTCFullYear();
}

export function parseSummaryActiveStorms(payload, { now = Date.now() } = {}) {
  const features = summaryFeatures(payload, SUMMARY_LAYERS.forecastPoints);
  assertSummaryFields(features, SUMMARY_FORECAST_FIELDS, SUMMARY_LAYERS.forecastPoints);

  // One row per forecast hour, so the storm is whichever row sits earliest on
  // its own timeline. tau 0 is the current fix in every advisory seen so far,
  // but taking the minimum survives an advisory that omits it. An unreadable
  // tau sorts last on both sides of the comparison, so a bad value on the row
  // already held cannot let a five-day forecast point take its place.
  // Number('') and Number(null) are both 0, which is finite and is tau zero,
  // the current fix. A row with no readable forecast hour has to sort last on
  // both sides of the comparison, or a five-day forecast point takes the
  // current position's place.
  const forecastHour = properties => {
    const raw = properties?.tau;
    if (raw === null || raw === undefined || String(raw).trim() === '') return Infinity;
    const tau = Number(raw);
    return Number.isFinite(tau) ? tau : Infinity;
  };
  // Keyed on basin and storm number, which is the identity every consumer
  // matches on, not on binnumber. The bin is a display slot: Lowell was EP12
  // in CP4 after crossing into the central Pacific, so two storms can share a
  // bin and collapse into one, and one storm can change bin mid-advisory and
  // split into two.
  const earliest = new Map();
  for (const feature of features) {
    const properties = feature?.properties;
    if (!properties) continue;
    const basin = String(properties.basin || '').trim().toUpperCase();
    // Number('') and Number(null) are both 0, which is finite. Without the
    // positive test a blank storm number gave every such row the key "AL:0" and
    // collapsed two live storms into one.
    const number = Number(properties.stormnum);
    const key = basin && Number.isFinite(number) && number > 0
      ? `${basin}:${number}`
      : String(properties.binnumber || '').trim().toUpperCase();
    if (!key) continue;
    const previous = earliest.get(key);
    if (previous && forecastHour(previous.properties) <= forecastHour(properties)) continue;
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

// The category is what sets the symbol, and it has to be read loosely: NHC
// decorates it ("High (>60%)"), and exact matching turned an 80% disturbance
// into the low-risk marker. The percentage is consulted only when there is no
// category at all, and only for the one value that changes the symbol, because
// folding it into the category let "high confidence 20%" read as high.
function outlookRisk(properties) {
  const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const category = normalize(properties?.risk7day);
  if (category) {
    if (category.includes('nearzero') || category.includes('near0')) return 'near-zero';
    if (category.includes('high')) return 'high';
    if (category.includes('medium')) return 'medium';
    return 'low';
  }
  const percentage = normalize(properties?.prob7day);
  if (percentage.includes('near0')) return 'near-zero';
  // A bare percentage with no category. NHC's own thresholds: 60% and above is
  // high, 40% is medium, and anything under that is low.
  const chance = Number(String(properties?.prob7day ?? '').match(/\d+/)?.[0]);
  if (!Number.isFinite(chance)) return 'low';
  if (chance >= 60) return 'high';
  if (chance >= 40) return 'medium';
  return 'low';
}

// The KMZ numbers its disturbances 1..N within a basin, because NHC issues one
// outlook per basin and the app fetches one KMZ per basin. This layer carries
// every basin at once in objectid order, so the ordinal has to be counted per
// basin or a marker's number stops matching NHC's own text product: two
// Atlantic systems and one Pacific one read 1, 2 and 1, never 1, 2, 3. The
// discussion paragraph exists only in the KMZ.
export function parseSummaryOutlookPoints(payload) {
  const features = summaryFeatures(payload, SUMMARY_LAYERS.outlook);
  assertSummaryFields(features, SUMMARY_OUTLOOK_FIELDS, SUMMARY_LAYERS.outlook);

  const ordered = [...features].sort(
    (a, b) => Number(a?.properties?.objectid ?? 0) - Number(b?.properties?.objectid ?? 0),
  );
  const points = [];
  const perBasin = new Map();
  for (const feature of ordered) {
    const properties = feature.properties || {};
    const basin = String(properties.basin || '').trim().toLowerCase();
    // Counted before the position check, because NHC numbers the disturbances
    // it issues, not the ones this parser can place. Skipping the count for a
    // dropped row renumbered the survivors and stopped them matching the text
    // product.
    const ordinal = (perBasin.get(basin) || 0) + 1;
    perBasin.set(basin, ordinal);
    const position = featurePosition(feature);
    if (!position) continue;
    points.push({
      basin,
      disturbance: String(ordinal),
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
