// Animated Risk Trajectories (ART): an educational ensemble that replaces a
// hard cone boundary with multiple plausible center paths. The paths are
// deterministic for a storm/era so redraws do not imply changing guidance.

import { buildConeSamples, destinationPoint, loadConeRadii } from './cone-retro.js';
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { prefersReducedMotion } from './settings.js';

const DEFAULT_COUNT = 20;
let layerGroup = null;
let layerMap = null;
let legendEl = null;
let renderGeneration = 0;

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function normalPair(random) {
  const u = Math.max(Number.EPSILON, random());
  const v = random();
  const magnitude = Math.sqrt(-2 * Math.log(u));
  return [magnitude * Math.cos(2 * Math.PI * v), magnitude * Math.sin(2 * Math.PI * v)];
}

export function generateRiskTrajectories(storm, radii, { count = DEFAULT_COUNT, seed } = {}) {
  const samples = buildConeSamples(storm, radii);
  if (samples.length < 2) return [];
  const random = seededRandom(seed ?? hashSeed(`${storm?.id || ''}:${Object.values(radii || {}).join(',')}`));
  const trajectories = [];
  for (let pathIndex = 0; pathIndex < count; pathIndex += 1) {
    let alongState = 0;
    let crossState = 0;
    const points = [[samples[0].lat, samples[0].lon]];
    for (const sample of samples.slice(1)) {
      const [alongNoise, crossNoise] = normalPair(random);
      alongState = alongState * 0.62 + alongNoise * 0.38;
      crossState = crossState * 0.62 + crossNoise * 0.38;
      const magnitude = Math.min(1.15, Math.hypot(alongState, crossState) * 0.72);
      const bearing = Math.atan2(crossState, alongState) * 180 / Math.PI;
      points.push(destinationPoint(sample.lat, sample.lon, bearing, sample.radius * magnitude));
    }
    trajectories.push(points);
  }
  return trajectories;
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function updateLegend({ era, count, reduced }) {
  if (!legendEl) {
    legendEl = document.createElement('div');
    legendEl.id = 'art-mode-legend';
    legendEl.className = 'art-mode-legend glass';
    legendEl.setAttribute('role', 'group');
    document.body.appendChild(legendEl);
  }
  legendEl.setAttribute('aria-label', t('art.legend'));
  legendEl.innerHTML = `<strong>${escapeHtml(t('art.legend'))}</strong><span>${escapeHtml(t('art.legendDetail', count, era))}</span>${reduced ? `<small>${escapeHtml(t('art.reduced'))}</small>` : ''}`;
  legendEl.hidden = false;
}

export async function renderRiskTrajectories(storm, { map, era = '2026', count = DEFAULT_COUNT } = {}) {
  if (!storm || !map) return { status: 'idle', pathCount: 0 };
  const generation = ++renderGeneration;
  try {
    const data = await loadConeRadii();
    if (generation !== renderGeneration) return { status: 'stale', pathCount: 0 };
    const eraData = data.eras[String(era)] || data.eras['2026'];
    const radii = storm.basin === 'EP' ? eraData.easternPacific : eraData.atlantic;
    const trajectories = generateRiskTrajectories(storm, radii, { count });
    if (!trajectories.length) throw new Error('Storm track is too short for risk trajectories');
    const reduced = prefersReducedMotion();
    ensureLayer(map);
    layerGroup.clearLayers();
    trajectories.forEach((points, index) => {
      const polyline = window.L.polyline(points, {
        color: index % 2 ? '#89b4fa' : '#cba6f7',
        weight: 1.45,
        opacity: 0.42,
        lineCap: 'round',
        className: `art-risk-path ${reduced ? 'art-risk-path--static' : 'art-risk-path--animated'}`,
      }).bindTooltip(escapeHtml(t('art.pathTooltip')), { sticky: true });
      if (!reduced) {
        polyline.once('add', () => {
          const element = polyline.getElement();
          if (element) element.style.animationDelay = `${-(index % 10) * 0.16}s`;
        });
      }
      polyline.addTo(layerGroup);
    });
    updateLegend({ era: String(era), count: trajectories.length, reduced });
    return { status: 'rendered', pathCount: trajectories.length, reduced };
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale', pathCount: 0 };
    clearRiskTrajectories();
    return { status: 'error', pathCount: 0, error };
  }
}

export function clearRiskTrajectories() {
  renderGeneration += 1;
  if (layerGroup) layerGroup.clearLayers();
  if (legendEl) legendEl.hidden = true;
}
