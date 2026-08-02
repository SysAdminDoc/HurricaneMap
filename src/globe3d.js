import { ensureStormsLoaded, getAllStorms, windToCategory, categoryColor } from './data.js';
import { t } from './i18n.js';
import { activateDialogFocus } from './dialog-focus.js';

const GLOBE_PROTOCOL = 'hm-globe-v1';
const ALLOWED_HOST_MESSAGES = new Set(['HOST_READY', 'READY', 'ERROR']);
const MAX_GLOBE_STORMS = 80;
const MIN_TRACK_HEIGHT_M = 80_000;
const HEIGHT_PER_KT_M = 2_200;
const WIND_CONE_POINTS_PER_QUADRANT = 7;
const NM_PER_DEG_LAT = 60;

function getWindConeThresholds() {
  return [
    { threshold: 34, offset: 0, baseHeight: 48_000, color: categoryColor(-1), alpha: 0.11 },
    { threshold: 50, offset: 4, baseHeight: 92_000, color: categoryColor(3), alpha: 0.14 },
    { threshold: 64, offset: 8, baseHeight: 138_000, color: categoryColor(4), alpha: 0.18 },
  ];
}

const WIND_CONE_QUADRANTS = [
  { name: 'NE', startBearing: 0, endBearing: 90 },
  { name: 'SE', startBearing: 90, endBearing: 180 },
  { name: 'SW', startBearing: 180, endBearing: 270 },
  { name: 'NW', startBearing: 270, endBearing: 360 },
];

let currentDataset = null;
let releaseGlobeFocus = null;
let hostReady = false;
let resolveHostReady = null;
let hostReadyPromise = new Promise(resolve => { resolveHostReady = resolve; });

const els = typeof document === 'undefined' ? {} : {
  panel: document.getElementById('globe3d-panel'),
  close: document.getElementById('close-globe3d'),
  frame: document.getElementById('globe3d-frame'),
  status: document.getElementById('globe3d-status'),
  subtitle: document.getElementById('globe3d-subtitle'),
  scrubber: document.getElementById('globe3d-scrubber'),
  timeLabel: document.getElementById('globe3d-time-label'),
  reset: document.getElementById('globe3d-reset'),
  focus: document.getElementById('globe3d-focus'),
  windCones: document.getElementById('globe3d-wind-cones'),
  trigger: document.getElementById('toggle-globe3d'),
};

let wired = false;
let openGeneration = 0;

export function initGlobe3D() {
  if (!els.panel) return;
  // Called on every globe-button click — wire listeners exactly once, or each
  // open stacks duplicate handlers (N wind-cone rebuilds, N Escape handlers).
  if (wired) return;
  wired = true;
  els.close?.addEventListener('click', closeGlobe3D);
  els.reset?.addEventListener('click', () => sendToHost('RESET', null));
  els.focus?.addEventListener('click', () => sendToHost('FOCUS', null));
  els.scrubber?.addEventListener('input', () => updateTimeline(Number(els.scrubber.value || 0)));
  els.windCones?.addEventListener('change', () => {
    if (!currentDataset) return;
    updateLayers();
  });
  window.addEventListener('message', onHostMessage);
  els.frame?.addEventListener('load', () => {
    hostReady = false;
    hostReadyPromise = new Promise(resolve => { resolveHostReady = resolve; });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.panel.hidden) {
      event.preventDefault();
      closeGlobe3D();
    }
  });
}

export async function openGlobe3D({ landfalls = [], focusStormId = null } = {}) {
  if (!els.panel || !els.frame) return;
  const generation = ++openGeneration;
  els.panel.hidden = false;
  els.panel.dataset.ready = 'false';
  els.trigger?.setAttribute('aria-pressed', 'true');
  setStatus(t('globe.loading'));
  releaseGlobeFocus = activateDialogFocus(els.panel, { initialFocus: '#close-globe3d' });

  await ensureStormsLoaded();
  if (generation !== openGeneration || els.panel.hidden) return;
  const dataset = buildGlobeTrackDataset(getAllStorms(), landfalls, {
    focusStormId,
    maxStorms: focusStormId ? 1 : MAX_GLOBE_STORMS,
  });
  currentDataset = dataset;

  if (!dataset.segments.length) {
    setStatus(t('globe.empty'));
    updateSubtitle(dataset);
    return;
  }

  try {
    await waitForHost();
    if (generation !== openGeneration || els.panel.hidden) return;
    configureWindConeControl(dataset);
    configureScrubber(dataset);
    updateSubtitle(dataset);
    initializeHost(dataset);
  } catch (error) {
    if (generation !== openGeneration || els.panel.hidden) return;
    console.warn('3D globe failed to initialize:', error);
    setStatus(t('globe.error'));
  }
}

export function closeGlobe3D() {
  if (!els.panel) return;
  openGeneration += 1;
  els.panel.hidden = true;
  els.trigger?.setAttribute('aria-pressed', 'false');
  releaseGlobeFocus?.();
  releaseGlobeFocus = null;
}

export function buildGlobeTrackDataset(storms, visibleLandfalls = [], options = {}) {
  const stormMap = new Map((storms || []).map(storm => [storm.id, storm]));
  const focusStormId = options.focusStormId || null;
  const maxStorms = Math.max(1, options.maxStorms || MAX_GLOBE_STORMS);
  const visibleStormCount = new Set((visibleLandfalls || []).map(landfall => landfall.storm_id).filter(Boolean)).size;
  const ids = [];
  const seen = new Set();

  if (focusStormId && stormMap.has(focusStormId)) {
    ids.push(focusStormId);
    seen.add(focusStormId);
  }
  if (ids.length < maxStorms) {
    for (const landfall of visibleLandfalls || []) {
      const id = landfall.storm_id;
      if (!id || seen.has(id) || !stormMap.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= maxStorms) break;
    }
  }
  const selectedStorms = ids
    .map(id => stormMap.get(id))
    .filter(storm => storm && Array.isArray(storm.track) && storm.track.length > 1);

  const timelineValues = new Set();
  const segments = [];
  const windCones = [];
  let maxWind = 0;
  for (const storm of selectedStorms) {
    for (let i = 1; i < storm.track.length; i++) {
      const a = storm.track[i - 1];
      const b = storm.track[i];
      if (!validTrackPoint(a) || !validTrackPoint(b)) continue;
      const start = Date.parse(a.t);
      const end = Date.parse(b.t);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      timelineValues.add(start);
      timelineValues.add(end);
      const wind = Number.isFinite(b.wind) ? b.wind : a.wind || 34;
      maxWind = Math.max(maxWind, wind || 0);
      segments.push({
        storm_id: storm.id,
        name: storm.name,
        year: storm.year,
        start,
        end,
        cat: categoryFromWind(wind),
        color: categoryColor(categoryFromWind(wind)),
        wind_kt: wind,
        positions: [
          a.lon, a.lat, getTrackHeightMeters(a.wind || wind),
          b.lon, b.lat, getTrackHeightMeters(wind),
        ],
      });
    }
    if (focusStormId || selectedStorms.length === 1) {
      const layers = buildWindConeLayers(storm);
      for (const layer of layers) {
        timelineValues.add(layer.time);
        windCones.push(layer);
      }
    }
  }

  const timeline = [...timelineValues].sort((a, b) => a - b);
  const indexByTime = new Map(timeline.map((value, index) => [value, index]));
  for (const segment of segments) {
    segment.startIndex = indexByTime.get(segment.start) ?? 0;
    segment.endIndex = indexByTime.get(segment.end) ?? segment.startIndex;
  }
  for (const cone of windCones) {
    cone.endIndex = indexByTime.get(cone.time) ?? 0;
  }

  return {
    focusStormId,
    storms: selectedStorms.map(storm => ({
      id: storm.id,
      name: storm.name,
      year: storm.year,
      peak_wind_kt: storm.peak_wind_kt,
    })),
    segments,
    windCones,
    timeline,
    maxWind,
    capped: !focusStormId && ids.length >= maxStorms && visibleStormCount > maxStorms,
  };
}

export function buildWindConeLayers(storm) {
  if (!storm?.track) return [];
  const layers = [];
  for (const point of storm.track) {
    if (!validTrackPoint(point) || !Array.isArray(point.radii)) continue;
    if (!['HU', 'TS', 'SS'].includes(point.status)) continue;
    const time = Date.parse(point.t);
    if (!Number.isFinite(time)) continue;
    for (const pass of getWindConeThresholds()) {
      const quadRadii = point.radii.slice(pass.offset, pass.offset + 4);
      if (!quadRadii.some(value => Number(value) > 0)) continue;
      const ring = buildWindConeRing(point.lat, point.lon, quadRadii, pass.baseHeight);
      if (ring.length < 4) continue;
      const wind = Number.isFinite(point.wind) ? point.wind : pass.threshold;
      layers.push({
        storm_id: storm.id,
        name: storm.name,
        year: storm.year,
        time,
        threshold: pass.threshold,
        color: pass.color,
        alpha: pass.alpha,
        center: [point.lon, point.lat, getWindConeApexHeightMeters(wind, pass.baseHeight)],
        ring,
      });
    }
  }
  return layers;
}

export function getWindConeApexHeightMeters(windKt, baseHeight = 48_000) {
  return Math.max(baseHeight + 120_000, getTrackHeightMeters(windKt) + 90_000);
}

export function getTrackHeightMeters(windKt) {
  const wind = Number.isFinite(windKt) ? Math.max(0, windKt) : 34;
  return MIN_TRACK_HEIGHT_M + wind * HEIGHT_PER_KT_M;
}

export function categoryFromWind(windKt) {
  return windToCategory(windKt);
}

function validTrackPoint(point) {
  return point &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lon >= -180 &&
    point.lon <= 180;
}

function buildWindConeRing(lat, lon, quadRadiiNm, baseHeight) {
  const ring = [];
  for (let q = 0; q < WIND_CONE_QUADRANTS.length; q++) {
    const radius = Number(quadRadiiNm[q]) || 0;
    const { startBearing, endBearing } = WIND_CONE_QUADRANTS[q];
    if (radius <= 0) {
      ring.push([lon, lat, baseHeight]);
      continue;
    }
    for (let i = 0; i < WIND_CONE_POINTS_PER_QUADRANT; i++) {
      const fraction = i / (WIND_CONE_POINTS_PER_QUADRANT - 1);
      const bearing = startBearing + (endBearing - startBearing) * fraction;
      ring.push([...offsetByBearing(lat, lon, radius, bearing), baseHeight]);
    }
  }
  return ring;
}

function offsetByBearing(lat, lon, distNm, bearingDeg) {
  const br = (bearingDeg * Math.PI) / 180;
  const dLat = (distNm / NM_PER_DEG_LAT) * Math.cos(br);
  const dLon = (distNm / NM_PER_DEG_LAT) * Math.sin(br) / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

function onHostMessage(event) {
  if (event.source !== els.frame?.contentWindow || event.origin !== 'null') return;
  const message = event.data;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  if (message.protocol !== GLOBE_PROTOCOL || !ALLOWED_HOST_MESSAGES.has(message.type)) return;
  if (!Object.keys(message).every(key => ['protocol', 'type', 'payload'].includes(key))) return;
  if (message.type === 'HOST_READY' && message.payload === null) {
    hostReady = true;
    resolveHostReady?.();
  } else if (message.type === 'READY' && validReadyPayload(message.payload)) {
    els.panel.dataset.entities = String(message.payload.entities);
    els.panel.dataset.windCones = String(message.payload.windCones);
    els.panel.dataset.ready = 'true';
    setStatus(t('globe.ready'));
  } else if (message.type === 'ERROR' && validErrorPayload(message.payload)) {
    console.warn('3D globe host failed:', message.payload.message);
    setStatus(t('globe.error'));
  }
}

function validReadyPayload(payload) {
  return payload &&
    Number.isInteger(payload.entities) &&
    payload.entities >= 0 &&
    Number.isInteger(payload.windCones) &&
    payload.windCones >= 0 &&
    Object.keys(payload).every(key => ['entities', 'windCones'].includes(key));
}

function validErrorPayload(payload) {
  return payload &&
    typeof payload.message === 'string' &&
    payload.message.length <= 240 &&
    Object.keys(payload).length === 1;
}

function sendToHost(type, payload) {
  if (!['PING', 'INIT', 'TIMELINE', 'LAYERS', 'RESET', 'FOCUS'].includes(type)) return;
  els.frame?.contentWindow?.postMessage({ protocol: GLOBE_PROTOCOL, type, payload }, '*');
}

async function waitForHost() {
  if (hostReady) return;
  // The host announces itself on load, but that announcement is lost if the frame
  // is still parsing. Re-PING until it answers: the host replies to a PING even
  // when its own unprompted announcement was dropped.
  sendToHost('PING', null);
  const retry = setInterval(() => sendToHost('PING', null), 250);
  try {
    await Promise.race([
      hostReadyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Globe host did not become ready')), 10_000)),
    ]);
  } finally {
    clearInterval(retry);
  }
}

function initializeHost(dataset) {
  const index = Math.max(0, dataset.timeline.length - 1);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--globe-bg').trim() || '#050813';
  sendToHost('INIT', {
    dataset,
    timelineIndex: index,
    showWindCones: Boolean(els.windCones?.checked),
    background,
  });
  updateTimeline(index);
}

function updateLayers() {
  if (!currentDataset) return;
  const max = Math.max(0, currentDataset.timeline.length - 1);
  const index = Math.max(0, Math.min(Number(els.scrubber?.value ?? max), max));
  sendToHost('LAYERS', {
    showWindCones: Boolean(els.windCones?.checked),
    timelineIndex: index,
  });
}

function configureScrubber(dataset) {
  if (!els.scrubber) return;
  const max = Math.max(0, dataset.timeline.length - 1);
  els.scrubber.min = '0';
  els.scrubber.max = String(max);
  els.scrubber.value = String(max);
  els.scrubber.disabled = max <= 0;
  els.scrubber.setAttribute('aria-valuemin', '0');
  els.scrubber.setAttribute('aria-valuemax', String(max));
  els.scrubber.setAttribute('aria-valuenow', String(max));
}

function configureWindConeControl(dataset) {
  if (!els.windCones) return;
  const count = dataset.windCones?.length || 0;
  els.windCones.disabled = count <= 0;
  els.windCones.checked = count > 0;
  els.windCones.closest('.globe3d-toggle')?.classList.toggle('is-disabled', count <= 0);
  els.windCones.closest('.globe3d-toggle')?.setAttribute(
    'title',
    count > 0
      ? `${count.toLocaleString()} wind-radii cone layers available for this storm`
      : 'Wind-radii cones are available when a focused or single selected storm has 2004+ radii data',
  );
}

function updateTimeline(index) {
  if (!currentDataset) return;
  const clamped = Math.max(0, Math.min(index, currentDataset.timeline.length - 1));
  sendToHost('TIMELINE', { index: clamped });
  if (els.scrubber) {
    els.scrubber.value = String(clamped);
    els.scrubber.setAttribute('aria-valuenow', String(clamped));
  }
  if (els.timeLabel) {
    const value = currentDataset.timeline[clamped];
    const label = value ? formatTimelineDate(value) : t('globe.noTimeline');
    els.timeLabel.textContent = label;
    els.scrubber?.setAttribute('aria-valuetext', label);
  }
}

function updateSubtitle(dataset) {
  if (!els.subtitle || !dataset) return;
  const stormCount = dataset.storms.length;
  const mode = t(dataset.focusStormId ? 'globe.modeFocused' : 'globe.modeSelection');
  const cones = dataset.windCones?.length
    ? t('globe.windConeLayers', dataset.windCones.length.toLocaleString())
    : '';
  const cap = dataset.capped ? t('globe.capped') : '';
  els.subtitle.textContent = stormCount === 1
    ? t('globe.summaryOne', dataset.segments.length.toLocaleString(), cones, mode, cap)
    : t('globe.summary', stormCount.toLocaleString(), dataset.segments.length.toLocaleString(), cones, mode, cap);
}

function setStatus(message) {
  if (els.status) els.status.textContent = message;
}

function formatTimelineDate(value) {
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
}
