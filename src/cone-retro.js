// Educational retrospective forecast cones for historical best tracks.
// This does not reconstruct a past advisory. It treats up to five days of the
// observed centerline as a stable comparison path, then applies published NHC
// cone-error radii from a selected era so skill changes are visually legible.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import {
  destinationPointNmi,
  initialBearingDeg,
  toDegrees,
} from './geodesy.js';

const RADII_URL = new URL('../data/cone-radii.json', import.meta.url);
let radiiPromise = null;
let layerGroup = null;
let layerMap = null;
let legendEl = null;
let renderGeneration = 0;

export async function loadConeRadii() {
  if (!radiiPromise) {
    radiiPromise = fetch(RADII_URL).then(response => {
      if (!response.ok) throw new Error(`Cone radii returned ${response.status}`);
      return response.json();
    }).catch(error => {
      radiiPromise = null;
      throw error;
    });
  }
  return radiiPromise;
}

export function destinationPoint(lat, lon, bearing, distanceNmi) {
  return destinationPointNmi(lat, lon, bearing, distanceNmi);
}

function bearingBetween(a, b) {
  return initialBearingDeg(a.lat, a.lon, b.lat, b.lon);
}

export function interpolateTrackPoint(track, timestampMs) {
  const points = (Array.isArray(track) ? track : [])
    .map(point => ({ ...point, timeMs: Date.parse(point.t) }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs);
  if (!points.length || timestampMs < points[0].timeMs || timestampMs > points.at(-1).timeMs) return null;
  const exact = points.find(point => point.timeMs === timestampMs);
  if (exact) return exact;
  const afterIndex = points.findIndex(point => point.timeMs > timestampMs);
  if (afterIndex <= 0) return null;
  const before = points[afterIndex - 1];
  const after = points[afterIndex];
  const fraction = (timestampMs - before.timeMs) / (after.timeMs - before.timeMs);
  return {
    lat: before.lat + (after.lat - before.lat) * fraction,
    lon: before.lon + (after.lon - before.lon) * fraction,
    timeMs: timestampMs,
  };
}

export function buildConeSamples(storm, radii) {
  const entries = Object.entries(radii || {})
    .map(([hours, radius]) => ({ hours: Number(hours), radius: Number(radius) }))
    .filter(item => Number.isFinite(item.hours) && Number.isFinite(item.radius) && item.hours > 0 && item.radius > 0)
    .sort((a, b) => a.hours - b.hours);
  if (!entries.length) return [];
  const validTimes = (storm?.track || []).map(point => Date.parse(point.t)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!validTimes.length) return [];
  const maxLeadMs = entries.at(-1).hours * 60 * 60 * 1000;
  const landfallTimes = (storm?.us_landfalls || []).map(point => Date.parse(point.t)).filter(Number.isFinite).sort((a, b) => a - b);
  const targetMs = landfallTimes[0] || validTimes.at(-1);
  const referenceMs = Math.max(validTimes[0], Math.min(targetMs - maxLeadMs, validTimes.at(-1) - maxLeadMs));
  const origin = interpolateTrackPoint(storm.track, referenceMs);
  if (!origin) return [];
  const samples = [{ ...origin, hours: 0, radius: 0 }];
  for (const entry of entries) {
    const point = interpolateTrackPoint(storm.track, referenceMs + entry.hours * 60 * 60 * 1000);
    if (point) samples.push({ ...point, ...entry });
  }
  return samples;
}

function unwrapLongitude(lon, reference) {
  let value = lon;
  while (value - reference > 180) value -= 360;
  while (value - reference < -180) value += 360;
  return value;
}

function convexHull(points) {
  if (points.length < 4) return points;
  const reference = points[0][1];
  const projected = points.map(([lat, lon]) => ({ lat, lon: unwrapLongitude(lon, reference) }));
  const sorted = projected.sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const cross = (o, a, b) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map(point => [point.lat, point.lon]);
}

export function buildConeEnvelope(samples, {
  ellipse = false,
  alongTrackScale = 1.35,
  crossTrackScale = 1.05,
} = {}) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const perimeter = [[samples[0].lat, samples[0].lon]];
  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    const before = samples[index - 1];
    const after = samples[index + 1] || sample;
    const bearing = bearingBetween(before, after.lat === sample.lat && after.lon === sample.lon ? sample : after);
    const along = sample.radius * (ellipse ? alongTrackScale : 1);
    const cross = sample.radius * (ellipse ? crossTrackScale : 1);
    for (let step = 0; step < 32; step += 1) {
      const angle = step * Math.PI * 2 / 32;
      const forward = along * Math.cos(angle);
      const right = cross * Math.sin(angle);
      const distance = Math.hypot(forward, right);
      const offsetBearing = bearing + toDegrees(Math.atan2(right, forward));
      perimeter.push(destinationPoint(sample.lat, sample.lon, offsetBearing, distance));
    }
  }
  return convexHull(perimeter);
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function updateLegend({ era, ellipse, sampleYears }) {
  if (!legendEl) {
    legendEl = document.createElement('div');
    legendEl.id = 'cone-retro-legend';
    legendEl.className = 'cone-retro-legend glass';
    legendEl.setAttribute('role', 'group');
    document.body.appendChild(legendEl);
  }
  const mode = ellipse ? t('coneRetro.ellipse') : t('coneRetro.circle');
  legendEl.setAttribute('aria-label', t('coneRetro.legend'));
  legendEl.innerHTML = `<strong>${escapeHtml(t('coneRetro.legend'))}</strong><span>${escapeHtml(`${era} · ${mode}`)}</span><small>${escapeHtml(t('coneRetro.sample', sampleYears))}</small>`;
  legendEl.hidden = false;
}

export async function renderRetrospectiveCone(storm, { map, era = '2026', ellipse = false } = {}) {
  if (!storm || !map) return { status: 'idle', sampleCount: 0 };
  const generation = ++renderGeneration;
  try {
    const data = await loadConeRadii();
    if (generation !== renderGeneration) return { status: 'stale', sampleCount: 0 };
    const eraData = data.eras[String(era)] || data.eras['2026'];
    const basinData = storm.basin === 'EP' ? eraData.easternPacific : eraData.atlantic;
    const samples = buildConeSamples(storm, basinData);
    const envelope = buildConeEnvelope(samples, {
      ellipse,
      alongTrackScale: data.experimentalEllipse.alongTrackScale,
      crossTrackScale: data.experimentalEllipse.crossTrackScale,
    });
    if (samples.length < 2 || envelope.length < 3) throw new Error('Storm track is too short for a retrospective cone');
    ensureLayer(map);
    layerGroup.clearLayers();
    window.L.polygon(envelope, {
      color: ellipse ? '#cba6f7' : '#89b4fa',
      fillColor: ellipse ? '#cba6f7' : '#89b4fa',
      fillOpacity: 0.15,
      opacity: 0.9,
      weight: 2,
      dashArray: ellipse ? '2 5' : '8 5',
      className: `cone-retro-shape ${ellipse ? 'cone-retro-shape--ellipse' : 'cone-retro-shape--circle'}`,
    }).bindTooltip(t('coneRetro.mapTooltip'), { sticky: true }).addTo(layerGroup);
    window.L.polyline(samples.map(point => [point.lat, point.lon]), {
      color: ellipse ? '#cba6f7' : '#89b4fa',
      weight: 1.5,
      dashArray: '3 5',
      opacity: 0.85,
      className: 'cone-retro-centerline',
    }).addTo(layerGroup);
    for (const sample of samples.slice(1)) {
      window.L.circleMarker([sample.lat, sample.lon], {
        radius: 3,
        color: ellipse ? '#cba6f7' : '#89b4fa',
        fillOpacity: 1,
        className: 'cone-retro-lead',
      }).bindTooltip(escapeHtml(`${sample.hours} h · ${sample.radius} n mi`), { direction: 'top' }).addTo(layerGroup);
    }
    updateLegend({ era: String(era), ellipse, sampleYears: eraData.sampleYears });
    return { status: 'rendered', sampleCount: samples.length, era: String(era), ellipse };
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale', sampleCount: 0 };
    clearRetrospectiveCone();
    return { status: 'error', sampleCount: 0, error };
  }
}

export function clearRetrospectiveCone() {
  renderGeneration += 1;
  if (layerGroup) layerGroup.clearLayers();
  if (legendEl) legendEl.hidden = true;
}
