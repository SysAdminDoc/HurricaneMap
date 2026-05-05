import { ensureStormsLoaded, getAllStorms } from './data.js';
import { escapeHtml, formatStormName } from './html-utils.js';

const CESIUM_VERSION = '1.140';
const CESIUM_BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_JS_URL = `${CESIUM_BASE_URL}Cesium.js`;
const CESIUM_CSS_URL = `${CESIUM_BASE_URL}Widgets/widgets.css`;

const MAX_GLOBE_STORMS = 80;
const MIN_TRACK_HEIGHT_M = 80_000;
const HEIGHT_PER_KT_M = 2_200;

let cesiumPromise = null;
let viewer = null;
let renderedEntities = [];
let currentDataset = null;
let previouslyFocused = null;

const els = typeof document === 'undefined' ? {} : {
  panel: document.getElementById('globe3d-panel'),
  close: document.getElementById('close-globe3d'),
  canvas: document.getElementById('globe3d-canvas'),
  status: document.getElementById('globe3d-status'),
  subtitle: document.getElementById('globe3d-subtitle'),
  scrubber: document.getElementById('globe3d-scrubber'),
  timeLabel: document.getElementById('globe3d-time-label'),
  reset: document.getElementById('globe3d-reset'),
  focus: document.getElementById('globe3d-focus'),
  trigger: document.getElementById('toggle-globe3d'),
};

export function initGlobe3D() {
  if (!els.panel) return;
  els.close?.addEventListener('click', closeGlobe3D);
  els.reset?.addEventListener('click', () => flyToDataset(currentDataset));
  els.focus?.addEventListener('click', () => flyToFocus(currentDataset));
  els.scrubber?.addEventListener('input', () => updateTimeline(Number(els.scrubber.value || 0)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.panel.hidden) {
      event.preventDefault();
      closeGlobe3D();
    }
  });
}

export async function openGlobe3D({ landfalls = [], focusStormId = null } = {}) {
  if (!els.panel || !els.canvas) return;
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.panel.hidden = false;
  els.panel.dataset.ready = 'false';
  els.trigger?.setAttribute('aria-pressed', 'true');
  setStatus('Loading 3D engine...');
  els.close?.focus();

  await ensureStormsLoaded();
  const dataset = buildGlobeTrackDataset(getAllStorms(), landfalls, {
    focusStormId,
    maxStorms: focusStormId ? 1 : MAX_GLOBE_STORMS,
  });
  currentDataset = dataset;

  if (!dataset.segments.length) {
    setStatus('No storm tracks available for the current selection.');
    updateSubtitle(dataset);
    return;
  }

  try {
    const Cesium = await loadCesium();
    ensureViewer(Cesium);
    renderDataset(Cesium, dataset);
    configureScrubber(dataset);
    updateTimeline(dataset.timeline.length - 1);
    flyToDataset(dataset);
    updateSubtitle(dataset);
    setStatus('3D globe ready');
    els.panel.dataset.ready = 'true';
  } catch (error) {
    console.warn('3D globe failed to initialize:', error);
    setStatus('3D globe could not load. Check your connection and try again.');
  }
}

export function closeGlobe3D() {
  if (!els.panel) return;
  els.panel.hidden = true;
  els.trigger?.setAttribute('aria-pressed', 'false');
  if (previouslyFocused) previouslyFocused.focus();
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
  if (!ids.length) {
    for (const storm of storms || []) {
      if (!storm?.id || seen.has(storm.id)) continue;
      seen.add(storm.id);
      ids.push(storm.id);
      if (ids.length >= maxStorms) break;
    }
  }

  const selectedStorms = ids
    .map(id => stormMap.get(id))
    .filter(storm => storm && Array.isArray(storm.track) && storm.track.length > 1);

  const timelineValues = new Set();
  const segments = [];
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
        wind_kt: wind,
        positions: [
          a.lon, a.lat, getTrackHeightMeters(a.wind || wind),
          b.lon, b.lat, getTrackHeightMeters(wind),
        ],
      });
    }
  }

  const timeline = [...timelineValues].sort((a, b) => a - b);
  const indexByTime = new Map(timeline.map((value, index) => [value, index]));
  for (const segment of segments) {
    segment.startIndex = indexByTime.get(segment.start) ?? 0;
    segment.endIndex = indexByTime.get(segment.end) ?? segment.startIndex;
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
    timeline,
    maxWind,
    capped: !focusStormId && ids.length >= maxStorms && visibleStormCount > maxStorms,
  };
}

export function getTrackHeightMeters(windKt) {
  const wind = Number.isFinite(windKt) ? Math.max(0, windKt) : 34;
  return MIN_TRACK_HEIGHT_M + wind * HEIGHT_PER_KT_M;
}

export function categoryFromWind(windKt) {
  if (!Number.isFinite(windKt) || windKt < 34) return -2;
  if (windKt < 64) return -1;
  if (windKt < 83) return 1;
  if (windKt < 96) return 2;
  if (windKt < 113) return 3;
  if (windKt < 137) return 4;
  return 5;
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

function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (cesiumPromise) return cesiumPromise;
  cesiumPromise = new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = CESIUM_BASE_URL;

    if (!document.querySelector(`link[href="${CESIUM_CSS_URL}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CESIUM_CSS_URL;
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = CESIUM_JS_URL;
    script.async = true;
    script.onload = () => window.Cesium ? resolve(window.Cesium) : reject(new Error('Cesium global missing'));
    script.onerror = () => {
      cesiumPromise = null;
      reject(new Error('Cesium CDN failed to load'));
    };
    document.head.appendChild(script);
  });
  return cesiumPromise;
}

function ensureViewer(Cesium) {
  if (viewer) {
    viewer.resize();
    return;
  }
  viewer = new Cesium.Viewer(els.canvas, {
    animation: false,
    baseLayer: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    shouldAnimate: false,
  });
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0c1322');
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Infinity;
}

function renderDataset(Cesium, dataset) {
  for (const entity of renderedEntities) viewer.entities.remove(entity);
  renderedEntities = [];

  for (const segment of dataset.segments) {
    const color = Cesium.Color.fromCssColorString(colorForCategory(segment.cat)).withAlpha(0.92);
    const entity = viewer.entities.add({
      name: `${formatStormName(segment.name)} ${segment.year}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(segment.positions),
        width: segment.storm_id === dataset.focusStormId ? 7 : 3.4,
        material: new Cesium.PolylineGlowMaterialProperty({
          color,
          glowPower: segment.storm_id === dataset.focusStormId ? 0.18 : 0.12,
          taperPower: 0.65,
        }),
        arcType: Cesium.ArcType.GEODESIC,
      },
      description: `${escapeHtml(formatStormName(segment.name))} ${escapeHtml(segment.year)} · ${escapeHtml(segment.wind_kt)} kt`,
    });
    entity._hmEndIndex = segment.endIndex;
    entity._hmStormId = segment.storm_id;
    renderedEntities.push(entity);
  }
  els.panel.dataset.entities = String(renderedEntities.length);
  viewer.scene.requestRender();
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

function updateTimeline(index) {
  if (!currentDataset) return;
  const clamped = Math.max(0, Math.min(index, currentDataset.timeline.length - 1));
  for (const entity of renderedEntities) {
    entity.show = (entity._hmEndIndex ?? 0) <= clamped;
  }
  if (els.scrubber) {
    els.scrubber.value = String(clamped);
    els.scrubber.setAttribute('aria-valuenow', String(clamped));
  }
  if (els.timeLabel) {
    const value = currentDataset.timeline[clamped];
    const label = value ? formatTimelineDate(value) : 'No timeline';
    els.timeLabel.textContent = label;
    els.scrubber?.setAttribute('aria-valuetext', label);
  }
  if (viewer) viewer.scene.requestRender();
}

function flyToDataset(dataset) {
  if (!viewer || !dataset || !renderedEntities.length) return;
  viewer.flyTo(renderedEntities, {
    duration: 0.7,
    offset: new window.Cesium.HeadingPitchRange(0, -0.72, 4_900_000),
  });
}

function flyToFocus(dataset) {
  if (!viewer || !dataset?.focusStormId) return flyToDataset(dataset);
  const focused = renderedEntities.filter(entity => entity._hmStormId === dataset.focusStormId);
  viewer.flyTo(focused.length ? focused : renderedEntities, {
    duration: 0.7,
    offset: new window.Cesium.HeadingPitchRange(0, -0.62, 2_400_000),
  });
}

function updateSubtitle(dataset) {
  if (!els.subtitle || !dataset) return;
  const stormCount = dataset.storms.length;
  const mode = dataset.focusStormId ? 'focused storm' : 'visible selection';
  const cap = dataset.capped ? ' · capped for performance' : '';
  els.subtitle.textContent = `${stormCount.toLocaleString()} ${stormCount === 1 ? 'storm' : 'storms'} · ${dataset.segments.length.toLocaleString()} elevated segments · ${mode}${cap}`;
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

function colorForCategory(cat) {
  if (cat <= 0) return '#74c7ec';
  if (cat === 1) return '#a6e3a1';
  if (cat === 2) return '#f9e2af';
  if (cat === 3) return '#fab387';
  if (cat === 4) return '#f38ba8';
  return '#cba6f7';
}
