// NHC Potential Storm Surge Flooding, the inundation footprint.
//
// Source: mapservices.weather.noaa.gov NHC_tropical_weather_summary MapServer,
// layer 23 (Footprint_Inun), origin-reflective CORS, f=geojson. Verified
// against the live service on 2026-09-09: the layer is a polygon feature layer
// carrying name, productname, groupname and category, and returned zero
// features that day. Not because of the season, which was at its Atlantic peak
// with two systems live on neighbouring layers, but because P-Surge publishes
// an inundation product only for a storm under a surge watch or warning. That
// is the state this renders as `empty` rather than as an error, and it is the
// state the layer is in most of the time.
//
// The product is P-Surge, and the number it publishes is a 10 percent
// exceedance: the level the water has a one-in-ten chance of going ABOVE, not
// an expected level and not a forecast for any one address. That is the sentence
// people get wrong, so the legend leads with it rather than footnoting it.
// Layer 21 is a mosaic of raster inundation images; this draws the vector
// footprint, which is what a browser can render honestly without a tile server.

import { escapeHtml as escapeText } from './html-utils.js';
import { t } from './i18n.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import { disposeMapLayer, registerMapLayer } from './layer-registry.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';

const SERVICE_BASE =
  'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer';
const FOOTPRINT_LAYER_ID = 23;
const CACHE_MS = 30 * 60 * 1000;

let layerGroup = null;
let layerMap = null;
let legendEl = null;
let cache = null;
let renderGeneration = 0;

export function buildInundationQueryUrl(layerId = FOOTPRINT_LAYER_ID) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'name,productname,groupname,category',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  return `${SERVICE_BASE}/${layerId}/query?${params.toString()}`;
}

/**
 * The footprint is one shape per published product rather than a banded
 * surface, so there is no depth to colour by and pretending otherwise would
 * invent precision the vector layer does not carry. One fill, and the legend
 * says what it means.
 */
export function inundationStyle() {
  return {
    color: '#89dceb',
    weight: 2,
    opacity: 0.9,
    fillColor: '#89dceb',
    fillOpacity: 0.22,
    className: 'surge-inundation-poly',
  };
}

export function inundationLabel(properties) {
  const name = String(properties?.productname || properties?.name || '').trim();
  return name || t('inundation.fallback');
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup();
  // Attached through the registry rather than added directly, so turning the
  // layer off aborts its request, takes the overlay off the map and reports the
  // feed idle in one place instead of three.
  registerMapLayer('inundation', { map, feedId: 'inundation' }).attach(layerGroup);
}

/**
 * The legend exists before anything names it and stays hidden until there is a
 * footprint to explain, so the status card can point at it from the first
 * request rather than from the first success.
 */
export function ensureInundationLegend() {
  if (legendEl && document.body.contains(legendEl)) return legendEl;
  legendEl = document.createElement('div');
  legendEl.id = 'surge-inundation-legend';
  legendEl.className = 'surge-inundation-legend glass';
  legendEl.setAttribute('role', 'group');
  legendEl.hidden = true;
  document.body.appendChild(legendEl);
  return legendEl;
}

function renderLegend(featureCount) {
  const legend = ensureInundationLegend();
  legend.setAttribute('aria-label', t('inundation.legendTitle'));
  if (!featureCount) {
    legend.hidden = true;
    legend.innerHTML = '';
    return;
  }
  legend.innerHTML = `<strong>${escapeText(t('inundation.legendTitle'))}</strong>`
    + `<span><b class="surge-inundation-swatch"></b>${escapeText(t('inundation.legendSwatch'))}</span>`
    + `<small>${escapeText(t('inundation.exceedance'))}</small>`;
  legend.hidden = false;
}

let statusEl = null;

function ensureStatus(map) {
  // The legend first: the card names it, and a card mounted before its target
  // exists names nothing until something else re-renders it.
  ensureInundationLegend();
  if (!statusEl || !document.body.contains(statusEl)) {
    statusEl = document.createElement('div');
    statusEl.id = 'surge-inundation-status';
    statusEl.className = 'optional-feed-status-host optional-feed-status-overlay glass';
    document.body.appendChild(statusEl);
  }
  mountOptionalFeedStatus(statusEl, 'inundation', {
    onRetry: () => renderSurgeInundation([], { map, enabled: true, force: true }),
    busyTarget: () => document.getElementById('surge-inundation-legend'),
  });
}

export async function renderSurgeInundation(activeStorms, { map, enabled = true, force = false } = {}) {
  if (!map || !enabled) {
    clearSurgeInundation();
    return { status: 'idle', featureCount: 0 };
  }
  const generation = ++renderGeneration;
  ensureLayer(map);
  ensureStatus(map);
  try {
    const now = Date.now();
    let features = !force && cache && now - cache.fetchedAt < CACHE_MS ? cache.features : null;
    const cacheOrigin = features ? 'memory' : 'network';
    if (!features) {
      const response = await fetchWithTimeout(
        buildInundationQueryUrl(),
        { cache: 'no-cache' },
        REQUEST_TIMEOUT_MS.active,
      );
      if (generation !== renderGeneration) return { status: 'stale', featureCount: 0 };
      if (!response.ok) {
        const error = new Error(`inundation query returned ${response.status}`);
        error.responseStatus = response.status;
        throw error;
      }
      const data = await response.json();
      if (generation !== renderGeneration) return { status: 'stale', featureCount: 0 };
      features = Array.isArray(data?.features) ? data.features : [];
      cache = { fetchedAt: now, features };
    }
    layerGroup.clearLayers();
    if (features.length) {
      const geoJsonLayer = window.L.geoJSON(
        { type: 'FeatureCollection', features },
        {
          style: () => inundationStyle(),
          onEachFeature: (feature, layer) => {
            layer.bindTooltip(
              t('inundation.tooltip', escapeText(inundationLabel(feature?.properties))),
              { direction: 'top', sticky: true },
            );
          },
        },
      );
      layerGroup.addLayer(geoJsonLayer);
      geoJsonLayer.bringToBack();
    }
    renderLegend(features.length);
    // Out of season the service answers with zero features rather than an
    // error, and reporting that as a failure would put a retry in front of a
    // reader for a product nobody has issued.
    return { status: features.length ? 'rendered' : 'empty', featureCount: features.length, cacheOrigin };
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale', featureCount: 0 };
    console.warn('Storm surge inundation layer unavailable:', error);
    renderLegend(0);
    return {
      status: 'error',
      featureCount: 0,
      error,
      responseStatus: error.responseStatus || 0,
    };
  }
}

export function clearSurgeInundation() {
  renderGeneration++;
  disposeMapLayer('inundation');
  layerGroup = null;
  layerMap = null;
  if (legendEl) {
    legendEl.hidden = true;
    legendEl.innerHTML = '';
  }
}

export function clearSurgeInundationCache() {
  cache = null;
}
