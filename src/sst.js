import { getMap } from './map.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import { disposeMapLayer, registerMapLayer } from './layer-registry.js';
import { createSharedProbe } from './shared-probe.js';
import {
  beginOptionalFeed,
  cancelOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  idleOptionalFeed,
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

function attributionFor(isoTime) {
  return `SST: NOAA Coral Reef Watch CoralTemp via PacIOOS ERDDAP (${String(isoTime).slice(0, 10)})`;
}

let sstLayer = null;
let activeHandle = null;
let resolvedTime = null;
let resolvedTimeAt = 0;
let resolvedTimeFromProbe = false;

function fallbackTime() {
  const date = new Date(Date.now() - FALLBACK_DAYS_BACK * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T12:00:00Z`;
}

async function probeLatestTime(signal) {
  const request = beginOptionalFeed('sst', { cacheOrigin: 'network' });
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
    // Cancelled once nothing wanted the answer any more; that is not a source
    // failure and must not be reported as one.
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
}

// Concurrent enables share one probe. Binding it to whichever handle started
// it meant a quick off/on aborted the request and the second enable then
// awaited that same dead promise: it silently took the three-day fallback,
// attributed the overlay with the older date, and left the feed reading idle
// under a layer that was on the map.
const resolveLatestTime = createSharedProbe(probeLatestTime, {
  abortMessage: 'the sea-surface temperature layer was closed',
});

function applyResolvedTime(resolved) {
  resolvedTime = resolved.time;
  resolvedTimeFromProbe = resolved.fromProbe;
  resolvedTimeAt = Date.now();
}

// Retrying has to move the overlay to the date it just resolved. It used to
// resolve and throw the answer away, so the button reported success over a
// layer still drawing the old day.
//
// With the layer off there is nothing to retry: probing anyway walked the feed
// from idle to loading to success while no layer was on the map, which is the
// feed claiming to describe something that is not there.
registerOptionalFeedRetry('sst', async () => {
  if (!activeHandle || activeHandle.disposed) {
    idleOptionalFeed('sst');
    return { time: resolvedTime, fromProbe: resolvedTimeFromProbe, skipped: 'layer-off' };
  }
  const resolved = await resolveLatestTime(activeHandle.signal);
  applyResolvedTime(resolved);
  if (sstLayer && activeHandle && !activeHandle.disposed) {
    sstLayer.setParams({ time: resolvedTime });
    sstLayer.options.attribution = attributionFor(resolvedTime);
  }
  return resolved;
});

export function getSSTTime() {
  return resolvedTime;
}

export async function setSSTVisible(visible) {
  if (!visible) {
    activeHandle = null;
    disposeMapLayer('sst');
    return;
  }
  const map = getMap();
  // The registry supersedes any previous enable, so a fast off/on stops the
  // first attempt instead of leaving it to finish and repaint a layer nobody
  // asked for, and handle.disposed replaces the old visibility flag.
  const handle = registerMapLayer('sst', { map, feedId: 'sst' });
  activeHandle = handle;
  const shouldRefresh = !resolvedTime || !resolvedTimeFromProbe || Date.now() - resolvedTimeAt >= LATEST_TIME_REFRESH_MS;
  if (shouldRefresh) {
    let resolved;
    try {
      resolved = await resolveLatestTime(handle.signal);
    } catch (error) {
      // Closing the layer while its date was being resolved is not a failure.
      if (error?.name === 'AbortError') return;
      throw error;
    }
    if (handle.disposed) return;
    applyResolvedTime(resolved);
  }
  if (!sstLayer) {
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
      attribution: attributionFor(resolvedTime),
    });
    // The time probe succeeding says nothing about whether the field draws.
    // A throttled or dead WMS endpoint would otherwise leave the feed green
    // over an empty map. The handlers outlive any one enable, so they check
    // that the layer is still on the map: a tile settling after the user
    // switched the layer off used to overwrite the idle state the teardown
    // had just published.
    sstLayer.on('load', () => {
      if (activeHandle?.disposed !== false) return;
      completeOptionalFeed('sst', { cacheOrigin: 'network', itemCount: 1 });
    });
    sstLayer.on('tileerror', () => {
      if (activeHandle?.disposed !== false) return;
      failOptionalFeed('sst', {
        error: new Error('CoralTemp WMS tiles failed to load'),
        responseStatus: 0,
        cacheOrigin: 'network',
      });
    });
  } else {
    sstLayer.setParams({ time: resolvedTime });
    sstLayer.options.attribution = attributionFor(resolvedTime);
  }
  handle.attach(sstLayer);
}

export function setSSTTime(isoTime) {
  if (sstLayer) {
    resolvedTime = isoTime;
    sstLayer.setParams({ time: isoTime });
  }
}
