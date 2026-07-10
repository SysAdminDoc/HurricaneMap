// NHC Peak Storm Surge forecast layer for active storms.
//
// Source: mapservices.weather.noaa.gov NHC_PeakStormSurge MapServer
// (origin-reflective CORS, f=geojson). The service is Esri-ingested from
// NHC's KML product, so features carry generic fields — the surge range
// lives in the `name` string (e.g. "Peak Surge 3-6 ft"). Empty outside
// active surge events; renders nothing when no data is published.

const SERVICE_BASE =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_PeakStormSurge/MapServer';
const POLYGON_LAYER_ID = 2;
const CACHE_MS = 30 * 60 * 1000;

let layerGroup = null;
let layerMap = null;
let cache = null;

export function buildPeakSurgeQueryUrl(layerId = POLYGON_LAYER_ID) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'name,popupinfo',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  return `${SERVICE_BASE}/${layerId}/query?${params.toString()}`;
}

/** Pull the lower-bound feet out of the NHC label text ("3-6 ft", ">9 ft"). */
export function parseSurgeFeet(name) {
  const match = String(name || '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export function surgeStyle(feet) {
  const fill =
    feet == null ? '#89b4fa'
      : feet >= 9 ? '#f38ba8'
        : feet >= 6 ? '#fab387'
          : feet >= 3 ? '#f9e2af'
            : '#74c7ec';
  return {
    color: fill,
    weight: 1,
    opacity: 0.8,
    fillColor: fill,
    fillOpacity: 0.28,
    className: 'peak-surge-poly',
  };
}

function escapeText(value) {
  return String(value ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

export async function renderPeakSurge(activeStorms, { map, enabled = true } = {}) {
  if (!map || !enabled || !Array.isArray(activeStorms) || activeStorms.length === 0) {
    clearPeakSurge();
    return { status: 'idle', featureCount: 0 };
  }
  ensureLayer(map);
  try {
    const now = Date.now();
    let features = cache && now - cache.fetchedAt < CACHE_MS ? cache.features : null;
    if (!features) {
      const response = await fetch(buildPeakSurgeQueryUrl(), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`peak surge query returned ${response.status}`);
      const data = await response.json();
      features = Array.isArray(data?.features) ? data.features : [];
      cache = { fetchedAt: now, features };
    }
    layerGroup.clearLayers();
    if (features.length) {
      const geoJsonLayer = window.L.geoJSON(
        { type: 'FeatureCollection', features },
        {
          style: feature => surgeStyle(parseSurgeFeet(feature?.properties?.name)),
          onEachFeature: (feature, layer) => {
            const label = feature?.properties?.name || 'Peak storm surge';
            layer.bindTooltip(`NHC peak surge: ${escapeText(label)}`, { direction: 'top', sticky: true });
          },
        },
      );
      layerGroup.addLayer(geoJsonLayer);
      geoJsonLayer.bringToBack();
    }
    return { status: features.length ? 'rendered' : 'empty', featureCount: features.length };
  } catch (error) {
    console.warn('Peak storm surge layer unavailable:', error);
    clearPeakSurge();
    return { status: 'error', featureCount: 0 };
  }
}

export function clearPeakSurge() {
  if (layerGroup) layerGroup.clearLayers();
}

export function clearPeakSurgeCache() {
  cache = null;
}
