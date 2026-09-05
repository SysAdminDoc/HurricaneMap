import { getMap } from './map.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import { disposeMapLayer, registerMapLayer } from './layer-registry.js';
import {
  beginOptionalFeed,
  cancelOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  registerOptionalFeedRetry,
} from './optional-feeds.js';

const L = window.L;

// NOAA Coral Reef Watch CoralTemp 5 km daily SST via PacIOOS ERDDAP.
// The previous dataset (nceiPH53sstd1day on coastwatch.pfeg.noaa.gov)
// dead-ended 2023-12-31 and its JSON endpoints serve no CORS; PacIOOS serves
// both the WMS tiles and a CORS-enabled `time[last]` probe from one host.
// ERDDAP WMS only accepts EPSG:4326/CRS:84 — the layer must not inherit the
// map's EPSG:3857 or every tile comes back as a ServiceException.
const ERDDAP_HOST = 'https://pae-paha.pacioos.hawaii.edu/erddap';
const ERDDAP_WMS = `${ERDDAP_HOST}/wms/dhw_5km/request`;
const LATEST_TIME_PROBE = `${ERDDAP_HOST}/griddap/dhw_5km.json?time%5Blast%5D`;
// Dataset lags realtime by ~1-2 days (testOutOfDate: now-2days). If the
// probe fails, a few days back still renders a plausible field.
const FALLBACK_DAYS_BACK = 3;
const LATEST_TIME_REFRESH_MS = 6 * 60 * 60 * 1000;

let sstLayer = null;
let latestTimePromise = null;
let resolvedTime = null;
let resolvedTimeAt = 0;
let resolvedTimeFromProbe = false;

function fallbackTime() {
  const date = new Date(Date.now() - FALLBACK_DAYS_BACK * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T12:00:00Z`;
}

function resolveLatestTime(signal) {
  if (!latestTimePromise) {
    const request = beginOptionalFeed('sst', { cacheOrigin: 'network' });
    latestTimePromise = (async () => {
      try {
        const response = await fetchWithTimeout(LATEST_TIME_PROBE, { signal }, REQUEST_TIMEOUT_MS.default);
        if (response.ok) {
          const data = await response.json();
          const iso = data?.table?.rows?.[0]?.[0];
          if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
            completeOptionalFeed('sst', { cacheOrigin: 'network', itemCount: 1, requestId: request.requestId });
            return { time: iso, fromProbe: true };
          }
        }
        // A reachable probe that cannot name a grid time still leaves the
        // overlay drawing an older day, so this is stale, not success.
        failOptionalFeed('sst', {
          error: new Error(`CoralTemp time probe returned ${response.status}`),
          responseStatus: response.status,
          cacheOrigin: 'network',
          requestId: request.requestId,
        });
      } catch (error) {
        // A dispose or a supersede aborts this deliberately; that is a cancel,
        // not a source failure, and must not be reported as one.
        if (error?.name === 'AbortError') cancelOptionalFeed('sst', { requestId: request.requestId });
        else {
          failOptionalFeed('sst', {
            error,
            responseStatus: error?.responseStatus || 0,
            cacheOrigin: 'network',
            requestId: request.requestId,
          });
        }
      }
      return { time: fallbackTime(), fromProbe: false };
    })().finally(() => {
      // Coalesce only concurrent probes. A fallback is retried next enable,
      // and successful probes refresh periodically in long-lived tabs.
      latestTimePromise = null;
    });
  }
  return latestTimePromise;
}

registerOptionalFeedRetry('sst', () => resolveLatestTime());

export function getSSTTime() {
  return resolvedTime;
}

export async function setSSTVisible(visible) {
  if (!visible) {
    disposeMapLayer('sst');
    return;
  }
  const map = getMap();
  // The registry supersedes any previous enable, so a fast off/on aborts the
  // first probe instead of leaving it to finish and repaint a layer nobody
  // asked for, and handle.disposed replaces the old visibility flag.
  const handle = registerMapLayer('sst', { map, feedId: 'sst' });
  const shouldRefresh = !resolvedTime || !resolvedTimeFromProbe || Date.now() - resolvedTimeAt >= LATEST_TIME_REFRESH_MS;
  if (shouldRefresh) {
    const resolved = await resolveLatestTime(handle.signal);
    if (handle.disposed) return;
    resolvedTime = resolved.time;
    resolvedTimeFromProbe = resolved.fromProbe;
    resolvedTimeAt = Date.now();
  }
  if (!sstLayer) {
    const day = resolvedTime.slice(0, 10);
    sstLayer = L.tileLayer.wms(ERDDAP_WMS, {
      layers: 'dhw_5km:CRW_SST',
      format: 'image/png',
      transparent: true,
      opacity: 0.55,
      time: resolvedTime,
      crs: L.CRS.EPSG4326,
      // Above the opaque basemap (zIndex 1), below vector overlays (which
      // live in the overlay pane). bringToBack() would drop it BEHIND the
      // basemap and hide it entirely — the field is ocean-only/transparent,
      // so sitting above the base tiles is safe.
      zIndex: 2,
      colorBarMinimum: 0,
      colorBarMaximum: 32,
      attribution: `SST: NOAA Coral Reef Watch CoralTemp via PacIOOS ERDDAP (${day})`,
    });
    // The time probe succeeding says nothing about whether the field draws.
    // A throttled or dead WMS endpoint would otherwise leave the feed green
    // over an empty map.
    sstLayer.on('load', () => completeOptionalFeed('sst', { cacheOrigin: 'network', itemCount: 1 }));
    sstLayer.on('tileerror', () => failOptionalFeed('sst', {
      error: new Error('CoralTemp WMS tiles failed to load'),
      responseStatus: 0,
      cacheOrigin: 'network',
    }));
  } else {
    sstLayer.setParams({ time: resolvedTime });
    sstLayer.options.attribution = `SST: NOAA Coral Reef Watch CoralTemp via PacIOOS ERDDAP (${resolvedTime.slice(0, 10)})`;
  }
  handle.attach(sstLayer);
}

export function setSSTTime(isoTime) {
  if (sstLayer) {
    resolvedTime = isoTime;
    sstLayer.setParams({ time: isoTime });
  }
}
