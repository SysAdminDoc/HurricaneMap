import { getMap } from './map.js';

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

let sstLayer = null;
let latestTimePromise = null;
let resolvedTime = null;

function fallbackTime() {
  const date = new Date(Date.now() - FALLBACK_DAYS_BACK * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T12:00:00Z`;
}

function resolveLatestTime() {
  if (!latestTimePromise) {
    latestTimePromise = (async () => {
      try {
        const response = await fetch(LATEST_TIME_PROBE);
        if (response.ok) {
          const data = await response.json();
          const iso = data?.table?.rows?.[0]?.[0];
          if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) return iso;
        }
      } catch { /* probe unreachable — fall back below */ }
      return fallbackTime();
    })();
  }
  return latestTimePromise;
}

export function getSSTTime() {
  return resolvedTime;
}

export async function setSSTVisible(visible) {
  const map = getMap();
  if (!visible) {
    if (sstLayer) map.removeLayer(sstLayer);
    return;
  }
  if (!sstLayer) {
    resolvedTime = await resolveLatestTime();
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
  }
  sstLayer.addTo(map);
}

export function setSSTTime(isoTime) {
  if (sstLayer) {
    resolvedTime = isoTime;
    sstLayer.setParams({ time: isoTime });
  }
}
