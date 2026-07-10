// USGS observed high-water marks — surveyed peak-water elevations per storm
// (Short-Term Network, systematic from ~2005). Ground truth beside the
// modeled SLOSH MOM overlay. Preprocessed by scripts/build_hwm.py into
// data/surge-obs/<STORMID>.json ([[lat, lon, elev_ft, env], ...]).
import { getMap } from './map.js';
import { t } from './i18n.js';

let indexPromise = null;
let layerGroup = null;
let shownStormId = null;

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch('data/surge-obs/index.json')
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return indexPromise;
}

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
  hideHwm();
  const response = await fetch(`data/surge-obs/${stormId}.json`).catch(() => null);
  if (!response?.ok) return 0;
  const points = await response.json();
  if (!Array.isArray(points) || !points.length) return 0;
  const L = window.L;
  layerGroup = L.layerGroup();
  for (const [lat, lon, elevFt, env] of points) {
    L.circleMarker([lat, lon], {
      radius: 4,
      color: '#0a0f1a',
      weight: 1,
      fillColor: elevationColor(elevFt),
      fillOpacity: 0.85,
      className: 'hwm-marker',
    }).bindTooltip(
      `${t('hwm.mark')}: ${elevFt.toFixed(1)} ft · ${env === 'R' ? t('hwm.riverine') : t('hwm.coastal')}`,
      { direction: 'top' },
    ).addTo(layerGroup);
  }
  layerGroup.addTo(getMap());
  shownStormId = stormId;
  return points.length;
}

export function hideHwm() {
  if (layerGroup) {
    getMap().removeLayer(layerGroup);
    layerGroup = null;
  }
  shownStormId = null;
}

export function hwmShownFor() {
  return shownStormId;
}
