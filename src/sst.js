import { getMap } from './map.js';

const L = window.L;

const ERDDAP_WMS = 'https://coastwatch.pfeg.noaa.gov/erddap/wms/nceiPH53sstd1day/request';
// Fixed historical snapshot (peak of the 2024 season) — the PH53 daily dataset
// lags realtime unpredictably, so a pinned date renders reliably. The UI must
// label this date; use setSSTTime() to point the layer elsewhere.
const DEFAULT_TIME = '2024-09-01T12:00:00Z';

export const SST_SNAPSHOT_LABEL = 'Sep 1, 2024';

let sstLayer = null;

export function setSSTVisible(visible) {
  const map = getMap();
  if (visible) {
    if (!sstLayer) {
      sstLayer = L.tileLayer.wms(ERDDAP_WMS, {
        layers: 'nceiPH53sstd1day:sea_surface_temperature',
        format: 'image/png',
        transparent: true,
        opacity: 0.55,
        time: DEFAULT_TIME,
        colorBarMinimum: 0,
        colorBarMaximum: 32,
        attribution: 'SST: NOAA CoastWatch ERDDAP (Sep 1, 2024 snapshot)',
      });
    }
    sstLayer.addTo(map);
    sstLayer.bringToBack();
  } else {
    if (sstLayer) map.removeLayer(sstLayer);
  }
}

export function setSSTTime(isoTime) {
  if (sstLayer) {
    sstLayer.setParams({ time: isoTime });
  }
}
