import { ensureStormsLoaded, getAllStorms, windToCategory, categoryColor } from './data.js';
import { escapeHtml, formatStormName } from './html-utils.js';

const CESIUM_VERSION = '1.140';
const CESIUM_BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_JS_URL = `${CESIUM_BASE_URL}Cesium.js`;
const CESIUM_CSS_URL = `${CESIUM_BASE_URL}Widgets/widgets.css`;

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

let cesiumPromise = null;
let viewer = null;
let cesiumApi = null;
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
  windCones: document.getElementById('globe3d-wind-cones'),
  trigger: document.getElementById('toggle-globe3d'),
};

export function initGlobe3D() {
  if (!els.panel) return;
  els.close?.addEventListener('click', closeGlobe3D);
  els.reset?.addEventListener('click', () => flyToDataset(currentDataset));
  els.focus?.addEventListener('click', () => flyToFocus(currentDataset));
  els.scrubber?.addEventListener('input', () => updateTimeline(Number(els.scrubber.value || 0)));
  els.windCones?.addEventListener('change', () => {
    if (!cesiumApi || !currentDataset) return;
    renderDataset(cesiumApi, currentDataset);
    updateTimeline(Number(els.scrubber?.value || currentDataset.timeline.length - 1));
  });
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
    cesiumApi = Cesium;
    ensureViewer(Cesium);
    configureWindConeControl(dataset);
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
    script.integrity = 'sha384-/3CCvBqqAcykK60EtXn9ML5N8PZKuC/s0Tfsr2CI0HpXU/XPW0iUeOodmYfrQxN1';
    script.crossOrigin = 'anonymous';
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
  const globeBg = getComputedStyle(document.documentElement).getPropertyValue('--globe-bg').trim() || '#050813';
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(globeBg);
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
  if (els.windCones?.checked && dataset.windCones?.length) {
    renderWindCones(Cesium, dataset);
  }
  els.panel.dataset.entities = String(renderedEntities.length);
  els.panel.dataset.windCones = String(dataset.windCones?.length || 0);
  viewer.scene.requestRender();
}

function renderWindCones(Cesium, dataset) {
  for (const cone of dataset.windCones || []) {
    const color = Cesium.Color.fromCssColorString(cone.color).withAlpha(cone.alpha);
    const outlineColor = Cesium.Color.fromCssColorString(cone.color).withAlpha(Math.min(0.78, cone.alpha + 0.36));
    const center = cone.center;
    for (let i = 0; i < cone.ring.length; i++) {
      const a = cone.ring[i];
      const b = cone.ring[(i + 1) % cone.ring.length];
      if (!a || !b) continue;
      const entity = viewer.entities.add({
        name: `${formatStormName(cone.name)} ${cone.year} ${cone.threshold} kt wind cone`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([
            center[0], center[1], center[2],
            a[0], a[1], a[2],
            b[0], b[1], b[2],
          ])),
          perPositionHeight: true,
          material: color,
          outline: false,
        },
        description: `${escapeHtml(formatStormName(cone.name))} ${escapeHtml(cone.year)} · ${escapeHtml(cone.threshold)} kt wind-radii cone`,
      });
      entity._hmEndIndex = cone.endIndex;
      entity._hmStormId = cone.storm_id;
      entity._hmWindCone = true;
      renderedEntities.push(entity);
    }

    const ringPositions = [];
    for (const point of cone.ring) ringPositions.push(point[0], point[1], point[2]);
    const outline = viewer.entities.add({
      name: `${formatStormName(cone.name)} ${cone.year} ${cone.threshold} kt wind-radii outline`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([...ringPositions, ...cone.ring[0]]),
        width: cone.threshold === 64 ? 1.8 : 1.2,
        material: outlineColor,
        arcType: Cesium.ArcType.GEODESIC,
      },
    });
    outline._hmEndIndex = cone.endIndex;
    outline._hmStormId = cone.storm_id;
    outline._hmWindCone = true;
    renderedEntities.push(outline);
  }
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
  const cones = dataset.windCones?.length
    ? ` · ${dataset.windCones.length.toLocaleString()} wind-cone layers`
    : '';
  const cap = dataset.capped ? ' · capped for performance' : '';
  els.subtitle.textContent = `${stormCount.toLocaleString()} ${stormCount === 1 ? 'storm' : 'storms'} · ${dataset.segments.length.toLocaleString()} elevated segments${cones} · ${mode}${cap}`;
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
  return categoryColor(cat);
}
