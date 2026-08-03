import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

// Official NHC forecast context for active storms.
//
// Uses Esri/NHC's active-hurricane FeatureServer GeoJSON layers:
//   2 = Forecast Track, 3 = Observed Track, 4 = Forecast Error Cone.
// The app already polls CurrentStorms.json frequently; this module caches the
// GIS payload for six hours unless the active storm identity set changes.

const NHC_FEATURE_SERVICE =
  'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';

export const NHC_FORECAST_LAYER_IDS = {
  forecastTrack: 2,
  observedTrack: 3,
  cone: 4,
};

export const NHC_FORECAST_POLL_MS = 6 * 60 * 60 * 1000;

const OUT_FIELDS = [
  'STORMNAME',
  'STORMTYPE',
  'ADVDATE',
  'ADVISNUM',
  'STORMNUM',
  'FCSTPRD',
  'BASIN',
  'STORMID',
];

let forecastLayerGroup = null;
let forecastLayerMap = null;
let forecastLayerVisible = true;
let forecastCache = null;
let renderGeneration = 0;

export function buildNHCFeatureQueryUrl(layerId, options = {}) {
  const params = new URLSearchParams({
    where: options.where || '1=1',
    outFields: (options.outFields || OUT_FIELDS).join(','),
    returnGeometry: 'true',
    f: 'geojson',
    outSR: '4326',
  });
  return `${NHC_FEATURE_SERVICE}/${layerId}/query?${params.toString()}`;
}

export function activeStormCacheKey(activeStorms) {
  return (activeStorms || [])
    .map(storm => [
      normalizeId(storm?.id),
      normalizeId(storm?.binNumber),
      normalizeStormName(storm?.name),
      storm?.forecastTrack?.advNum || '',
      storm?.trackCone?.advNum || '',
      storm?.lastUpdate || '',
    ].join(':'))
    .sort()
    .join('|');
}

export function buildStormMatcher(activeStorms) {
  const ids = new Set();
  const names = new Set();
  const basinNumbers = new Set();

  for (const storm of activeStorms || []) {
    const id = normalizeId(storm?.id);
    const bin = normalizeId(storm?.binNumber);
    const name = normalizeStormName(storm?.name);
    if (id) ids.add(id);
    if (bin) ids.add(bin);
    if (name) names.add(name);

    for (const key of basinNumberKeysFromId(id)) basinNumbers.add(key);
  }

  return { ids, names, basinNumbers };
}

export function featureMatchesActiveStorm(feature, matcher) {
  if (!matcher || (!matcher.ids.size && !matcher.names.size && !matcher.basinNumbers.size)) {
    return true;
  }
  const props = feature?.properties || {};
  const stormId = normalizeId(props.STORMID || props.stormid);
  const stormName = normalizeStormName(props.STORMNAME || props.stormname);
  const basinNumbers = basinNumberKeysFromFeature(props);

  return (stormId && matcher.ids.has(stormId)) ||
    (stormName && matcher.names.has(stormName)) ||
    basinNumbers.some(key => matcher.basinNumbers.has(key));
}

export function filterFeaturesForActiveStorms(features, activeStorms) {
  if (!Array.isArray(features) || features.length === 0) return [];
  const matcher = buildStormMatcher(activeStorms);
  const matched = features.filter(feature => featureMatchesActiveStorm(feature, matcher));
  // The active service only exposes active systems. If NHC/Esri changes field
  // names and our matcher misses, showing all active features is safer than
  // hiding official forecast context.
  return matched.length > 0 ? matched : features;
}

export async function renderOfficialForecastContext(activeStorms, options = {}) {
  const map = options.map || forecastLayerMap;
  const enabled = options.enabled !== false;
  if (!map || !enabled || !Array.isArray(activeStorms) || activeStorms.length === 0) {
    clearOfficialForecastContext();
    return { status: 'idle', coneCount: 0, forecastTrackCount: 0, observedTrackCount: 0 };
  }

  const generation = ++renderGeneration;
  ensureForecastLayer(map);

  try {
    const now = Date.now();
    const cacheOrigin = forecastCache &&
      !options.force &&
      forecastCache.stormKey === activeStormCacheKey(activeStorms) &&
      now - forecastCache.fetchedAt < NHC_FORECAST_POLL_MS
      ? 'memory'
      : 'network';
    const layers = await fetchOfficialForecastLayers(activeStorms, { force: options.force });
    if (generation !== renderGeneration) {
      return { status: 'stale', coneCount: 0, forecastTrackCount: 0, observedTrackCount: 0 };
    }
    const coneFeatures = filterFeaturesForActiveStorms(layers.cones, activeStorms);
    const forecastTrackFeatures = filterFeaturesForActiveStorms(layers.forecastTracks, activeStorms);
    const observedTrackFeatures = filterFeaturesForActiveStorms(layers.observedTracks, activeStorms);

    forecastLayerGroup.clearLayers();
    addGeoJsonLayer(coneFeatures, 'cone');
    addGeoJsonLayer(observedTrackFeatures, 'observedTrack');
    addGeoJsonLayer(forecastTrackFeatures, 'forecastTrack');
    setOfficialForecastVisibility(forecastLayerVisible);

    return {
      status: 'rendered',
      coneCount: coneFeatures.length,
      forecastTrackCount: forecastTrackFeatures.length,
      observedTrackCount: observedTrackFeatures.length,
      cacheOrigin,
    };
  } catch (error) {
    if (generation !== renderGeneration) {
      return { status: 'stale', coneCount: 0, forecastTrackCount: 0, observedTrackCount: 0 };
    }
    console.warn('Failed to fetch official NHC forecast geometry:', error);
    return {
      status: 'error',
      coneCount: 0,
      forecastTrackCount: 0,
      observedTrackCount: 0,
      error,
      responseStatus: error.responseStatus || 0,
    };
  }
}

export function clearOfficialForecastContext() {
  renderGeneration++;
  if (forecastLayerGroup) forecastLayerGroup.clearLayers();
}

export function clearOfficialForecastCache() {
  forecastCache = null;
}

function setOfficialForecastVisibility(visible) {
  forecastLayerVisible = !!visible;
  setLayerDisplay(forecastLayerGroup, forecastLayerVisible);
}

async function fetchOfficialForecastLayers(activeStorms, { force = false } = {}) {
  const now = Date.now();
  const stormKey = activeStormCacheKey(activeStorms);
  if (
    forecastCache &&
    !force &&
    forecastCache.stormKey === stormKey &&
    now - forecastCache.fetchedAt < NHC_FORECAST_POLL_MS
  ) {
    return forecastCache.layers;
  }

  const [cones, forecastTracks, observedTracks] = await Promise.all([
    fetchFeatureLayer(NHC_FORECAST_LAYER_IDS.cone),
    fetchFeatureLayer(NHC_FORECAST_LAYER_IDS.forecastTrack),
    fetchFeatureLayer(NHC_FORECAST_LAYER_IDS.observedTrack),
  ]);

  forecastCache = {
    fetchedAt: now,
    stormKey,
    layers: { cones, forecastTracks, observedTracks },
  };
  return forecastCache.layers;
}

async function fetchFeatureLayer(layerId) {
  const response = await fetchWithTimeout(
    buildNHCFeatureQueryUrl(layerId),
    { cache: 'no-cache' },
    REQUEST_TIMEOUT_MS.cone,
  );
  if (!response.ok) {
    const error = new Error(`NHC layer ${layerId} returned ${response.status}`);
    error.responseStatus = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data?.features) ? data.features : [];
}

function ensureForecastLayer(map) {
  if (forecastLayerGroup && forecastLayerMap === map) return;
  if (forecastLayerGroup && forecastLayerMap) {
    forecastLayerMap.removeLayer(forecastLayerGroup);
  }
  const L = window.L;
  forecastLayerMap = map;
  forecastLayerGroup = L.layerGroup().addTo(map);
}

function addGeoJsonLayer(features, kind) {
  if (!forecastLayerGroup || !Array.isArray(features) || features.length === 0) return;
  const L = window.L;
  const geoJsonLayer = L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      style: () => layerStyle(kind),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(featureTooltip(feature, kind), { direction: 'top', sticky: true });
      },
    },
  );
  forecastLayerGroup.addLayer(geoJsonLayer);
  if (kind === 'cone') geoJsonLayer.bringToBack();
}

function layerStyle(kind) {
  if (kind === 'cone') {
    return {
      color: '#f9e2af',
      weight: 1.5,
      opacity: 0.75,
      fillColor: '#f9e2af',
      fillOpacity: 0.13,
      dashArray: '6 5',
      lineJoin: 'round',
      className: 'official-cone active-cone',
    };
  }
  if (kind === 'observedTrack') {
    return {
      color: '#89b4fa',
      weight: 3,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      className: 'official-observed-track active-track',
    };
  }
  return {
    color: '#f9e2af',
    weight: 2.5,
    opacity: 0.95,
    dashArray: '7 5',
    lineCap: 'round',
    lineJoin: 'round',
    className: 'official-forecast-track active-forecast',
  };
}

function featureTooltip(feature, kind) {
  const props = feature?.properties || {};
  const storm = props.STORMNAME || props.stormname || 'Active storm';
  const advisory = props.ADVISNUM || props.advisnum;
  const period = props.FCSTPRD ?? props.fcstprd;
  const label = kind === 'cone'
    ? 'NHC forecast cone'
    : kind === 'observedTrack'
      ? 'NHC observed track'
      : 'NHC forecast track';
  const details = [
    advisory ? `Advisory ${escapeText(advisory)}` : '',
    Number.isFinite(Number(period)) ? `${Number(period)}h` : '',
  ].filter(Boolean).join(' · ');
  return `${label}: ${escapeText(storm)}${details ? ` (${details})` : ''}`;
}

function setLayerDisplay(layer, visible) {
  if (!layer) return;
  const element = typeof layer.getElement === 'function' ? layer.getElement() : null;
  if (element) element.style.display = visible ? '' : 'none';
  if (typeof layer.eachLayer === 'function') {
    layer.eachLayer(child => setLayerDisplay(child, visible));
  }
}

function basinNumberKeysFromId(id) {
  const match = String(id || '').match(/^([A-Z]{2})(\d{2})(\d{4})$/);
  if (!match) return [];
  return basinNumberKeys(match[1], Number(match[2]));
}

function basinNumberKeysFromFeature(props) {
  const basin = props.BASIN || props.basin;
  const number = props.STORMNUM ?? props.stormnum;
  return basinNumberKeys(basin, Number(number));
}

function basinNumberKeys(basin, number) {
  if (!Number.isFinite(number)) return [];
  const aliases = basinAliases(basin);
  return aliases.map(alias => `${alias}:${number}`);
}

function basinAliases(value) {
  const basin = normalizeId(value);
  if (!basin) return [];
  if (basin === 'AL' || basin === 'AT' || basin.includes('ATLANTIC')) return ['AL', 'AT'];
  if (basin === 'EP' || basin.includes('EASTERNPACIFIC')) return ['EP'];
  if (basin === 'CP' || basin.includes('CENTRALPACIFIC')) return ['CP'];
  return [basin];
}

function normalizeId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeStormName(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
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
