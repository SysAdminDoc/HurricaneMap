// USGS observed high-water marks — surveyed peak-water elevations per storm
// (Short-Term Network, systematic from ~2005). Ground truth beside the
// modeled SLOSH MOM overlay. Preprocessed by scripts/build_hwm.py into
// data/surge-obs/<STORMID>.json ([[lat, lon, elev_ft, env], ...]).
import { getMap } from './map.js';
import { t } from './i18n.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import { disposeMapLayer, registerMapLayer } from './layer-registry.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  registerOptionalFeedRetry,
} from './optional-feeds.js';

let indexPromise = null;
let layerGroup = null;
let shownStormId = null;

function loadIndex() {
  if (!indexPromise) {
    const request = beginOptionalFeed('hwm', { cacheOrigin: 'bundled' });
    indexPromise = fetchWithTimeout('data/surge-obs/index.json', {}, REQUEST_TIMEOUT_MS.data)
      .then(res => {
        if (!res.ok) {
          const error = new Error(`high-water mark index returned ${res.status}`);
          error.responseStatus = res.status;
          throw error;
        }
        return res.json();
      })
      .then(index => {
        const stormCount = Object.keys(index || {}).length;
        completeOptionalFeed('hwm', {
          empty: stormCount === 0,
          cacheOrigin: 'bundled',
          itemCount: stormCount,
          requestId: request.requestId,
        });
        return index;
      })
      .catch(error => {
        failOptionalFeed('hwm', {
          error,
          responseStatus: error.responseStatus || 0,
          cacheOrigin: 'bundled',
          requestId: request.requestId,
        });
        indexPromise = null;
        return null;
      });
  }
  return indexPromise;
}

registerOptionalFeedRetry('hwm', () => {
  indexPromise = null;
  return loadIndex();
});

/** {event, count} when preprocessed marks exist for this storm, else null. */
export async function hwmInfo(stormId) {
  const index = await loadIndex();
  return index?.[stormId] || null;
}

function elevationColor(ft) {
  if (ft >= 20) return '#f38ba8';
  if (ft >= 12) return '#fab387';
  if (ft >= 6) return '#f9e2af';
  return '#94e2d5';
}

export async function showHwm(stormId) {
  // Registering supersedes any previous storm's marks: it removes that layer
  // and aborts its fetch, where the old generation counter let the superseded
  // request run to completion and then discarded the bytes. The marks carry no
  // feedId because that belongs to the index load, not to one storm's overlay.
  const handle = registerMapLayer('hwm-marks', { map: getMap(), feedId: null });
  const response = await fetchWithTimeout(
    `data/surge-obs/${stormId}.json`,
    { signal: handle.signal },
    REQUEST_TIMEOUT_MS.data,
  ).catch(() => null);
  if (handle.disposed) return 0;
  if (!response?.ok) return 0;
  const points = await response.json();
  if (handle.disposed) return 0;
  if (!Array.isArray(points) || !points.length) return 0;
  const L = window.L;
  const nextLayerGroup = L.layerGroup();
  for (const [lat, lon, elevFt, env] of points) {
    L.circleMarker([lat, lon], {
      radius: 4,
      color: '#0a0f1a',
      weight: 1,
      fillColor: elevationColor(elevFt),
      fillOpacity: 0.85,
      className: 'hwm-marker',
    }).bindTooltip(
      `${t('hwm.mark')}: ${escapeText(elevFt.toFixed(1))} ft · ${env === 'R' ? t('hwm.riverine') : t('hwm.coastal')}`,
      { direction: 'top' },
    ).addTo(nextLayerGroup);
  }
  if (!handle.attach(nextLayerGroup)) return 0;
  layerGroup = nextLayerGroup;
  shownStormId = stormId;
  return points.length;
}

export function hideHwm() {
  disposeMapLayer('hwm-marks');
  layerGroup = null;
  shownStormId = null;
}

export function hwmShownFor() {
  return shownStormId;
}
