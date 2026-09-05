const PROTOCOL = 'hm-globe-v1';
const CESIUM_VERSION = '1.145';
const CESIUM_BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_JS_URL = `${CESIUM_BASE_URL}Cesium.js`;
const CESIUM_CSS_URL = `${CESIUM_BASE_URL}Widgets/widgets.css`;
// Derived from the referrer so the unprompted HOST_READY below can be targeted.
// A `Referrer-Policy: no-referrer` deployment leaves this empty, so the parent's
// PING re-establishes it (see adoptParentOrigin) instead of failing closed.
let parentOrigin = referrerOrigin(document.referrer);
const ALLOWED_MESSAGES = new Set(['PING', 'INIT', 'TIMELINE', 'LAYERS', 'RESET', 'FOCUS']);
const MAX_SEGMENTS = 20_000;
const MAX_CONES = 5_000;
const MAX_TIMELINE = 10_000;

let cesiumPromise = null;
let viewer = null;
let renderedEntities = [];
let currentDataset = null;

window.addEventListener('message', async event => {
  if (event.source !== window.parent) return;
  if (!adoptParentOrigin(event.origin)) return;
  const message = event.data;
  if (!isEnvelope(message) || !ALLOWED_MESSAGES.has(message.type)) return;
  try {
    if (message.type === 'PING') {
      if (message.payload === null) post('HOST_READY', null);
    } else if (message.type === 'INIT') {
      if (!validInitPayload(message.payload)) throw new Error('Invalid INIT payload');
      currentDataset = message.payload.dataset;
      const Cesium = await loadCesium();
      ensureViewer(Cesium, message.payload.background);
      renderDataset(Cesium, currentDataset, message.payload.showWindCones);
      updateTimeline(message.payload.timelineIndex);
      flyToDataset(currentDataset);
      post('READY', {
        entities: renderedEntities.length,
        windCones: currentDataset.windCones.length,
      });
    } else if (message.type === 'TIMELINE') {
      if (!Number.isInteger(message.payload?.index)) return;
      updateTimeline(message.payload.index);
    } else if (message.type === 'LAYERS') {
      if (!validLayersPayload(message.payload) || !currentDataset || !viewer) return;
      const Cesium = await loadCesium();
      renderDataset(Cesium, currentDataset, message.payload.showWindCones);
      updateTimeline(message.payload.timelineIndex);
    } else if (message.type === 'RESET') {
      if (message.payload != null) return;
      flyToDataset(currentDataset);
    } else if (message.type === 'FOCUS') {
      if (message.payload != null) return;
      flyToFocus(currentDataset);
    }
  } catch (error) {
    post('ERROR', { message: String(error?.message || 'Globe initialization failed').slice(0, 240) });
  }
});

post('HOST_READY', null);

function referrerOrigin(referrer) {
  try {
    return new URL(referrer).origin;
  } catch {
    return '';
  }
}

// The embedder is the only possible `window.parent`, so learning its origin from
// its first message is equivalent to reading it from the referrer — but it also
// survives referrer stripping. Once known, the origin is pinned for good.
function adoptParentOrigin(origin) {
  if (parentOrigin) return origin === parentOrigin;
  if (!origin || origin === 'null') return false;
  parentOrigin = origin;
  return true;
}

function isEnvelope(value) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.protocol === PROTOCOL &&
    typeof value.type === 'string' &&
    Object.keys(value).every(key => ['protocol', 'type', 'payload'].includes(key));
}

function validInitPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (!['boolean'].includes(typeof payload.showWindCones)) return false;
  if (!Number.isInteger(payload.timelineIndex)) return false;
  if (typeof payload.background !== 'string' || !/^#[a-f0-9]{6}$/i.test(payload.background)) return false;
  const dataset = payload.dataset;
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) return false;
  if (!Array.isArray(dataset.segments) || dataset.segments.length > MAX_SEGMENTS) return false;
  if (!Array.isArray(dataset.windCones) || dataset.windCones.length > MAX_CONES) return false;
  if (!Array.isArray(dataset.timeline) || dataset.timeline.length > MAX_TIMELINE) return false;
  if (dataset.focusStormId != null && typeof dataset.focusStormId !== 'string') return false;
  if (!dataset.timeline.every(Number.isFinite)) return false;
  return dataset.segments.every(validSegment) && dataset.windCones.every(validCone);
}

function validLayersPayload(payload) {
  return payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    typeof payload.showWindCones === 'boolean' &&
    Number.isInteger(payload.timelineIndex) &&
    Object.keys(payload).every(key => ['showWindCones', 'timelineIndex'].includes(key));
}

function validSegment(segment) {
  return segment &&
    typeof segment.storm_id === 'string' &&
    typeof segment.name === 'string' &&
    Number.isInteger(segment.year) &&
    Number.isInteger(segment.endIndex) &&
    typeof segment.color === 'string' &&
    Array.isArray(segment.positions) &&
    segment.positions.length === 6 &&
    segment.positions.every(Number.isFinite);
}

function validCone(cone) {
  return cone &&
    typeof cone.storm_id === 'string' &&
    typeof cone.name === 'string' &&
    Number.isInteger(cone.year) &&
    Number.isInteger(cone.threshold) &&
    Number.isInteger(cone.endIndex) &&
    typeof cone.color === 'string' &&
    Number.isFinite(cone.alpha) &&
    validPosition(cone.center) &&
    Array.isArray(cone.ring) &&
    cone.ring.length <= 32 &&
    cone.ring.every(validPosition);
}

function validPosition(position) {
  return Array.isArray(position) && position.length === 3 && position.every(Number.isFinite);
}

function post(type, payload) {
  if (!parentOrigin) return;
  window.parent.postMessage({ protocol: PROTOCOL, type, payload }, parentOrigin);
}

function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (cesiumPromise) return cesiumPromise;
  cesiumPromise = new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = CESIUM_BASE_URL;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CESIUM_CSS_URL;
    link.integrity = 'sha384-ghEeMdcWWzRv/BPeUcX835vcKDGrxvROXisl/Btpv3GeekBUXTSPVcFJpI1Tcrgp';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = CESIUM_JS_URL;
    script.integrity = 'sha384-1G42k2yKVnUMrgZBHAlf+pQXOrpQdoo/lqzpebarn4Wamb2UgdZSZWtWEYfVP3sO';
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

function ensureViewer(Cesium, background) {
  if (viewer) {
    viewer.resize();
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(background);
    return;
  }
  viewer = new Cesium.Viewer('globe-host', {
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
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(background);
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Infinity;
}

function renderDataset(Cesium, dataset, showWindCones) {
  for (const entity of renderedEntities) viewer.entities.remove(entity);
  renderedEntities = [];
  for (const segment of dataset.segments) {
    const color = Cesium.Color.fromCssColorString(segment.color).withAlpha(0.92);
    const entity = viewer.entities.add({
      name: `${segment.name} ${segment.year}`,
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
    });
    tagEntity(entity, segment);
  }
  if (showWindCones) renderWindCones(Cesium, dataset);
  viewer.scene.requestRender();
}

function renderWindCones(Cesium, dataset) {
  for (const cone of dataset.windCones) {
    const color = Cesium.Color.fromCssColorString(cone.color).withAlpha(cone.alpha);
    const outlineColor = Cesium.Color.fromCssColorString(cone.color).withAlpha(Math.min(0.78, cone.alpha + 0.36));
    for (let index = 0; index < cone.ring.length; index += 1) {
      const a = cone.ring[index];
      const b = cone.ring[(index + 1) % cone.ring.length];
      const entity = viewer.entities.add({
        name: `${cone.name} ${cone.year} ${cone.threshold} kt wind cone`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([
            ...cone.center, ...a, ...b,
          ])),
          perPositionHeight: true,
          material: color,
          outline: false,
        },
      });
      tagEntity(entity, cone, true);
    }
    const ringPositions = cone.ring.flat();
    const outline = viewer.entities.add({
      name: `${cone.name} ${cone.year} ${cone.threshold} kt wind-radii outline`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights([...ringPositions, ...cone.ring[0]]),
        width: cone.threshold === 64 ? 1.8 : 1.2,
        material: outlineColor,
        arcType: Cesium.ArcType.GEODESIC,
      },
    });
    tagEntity(outline, cone, true);
  }
}

function tagEntity(entity, item, windCone = false) {
  entity._hmEndIndex = item.endIndex;
  entity._hmStormId = item.storm_id;
  entity._hmWindCone = windCone;
  renderedEntities.push(entity);
}

function updateTimeline(index) {
  if (!currentDataset || !viewer) return;
  const clamped = Math.max(0, Math.min(index, currentDataset.timeline.length - 1));
  for (const entity of renderedEntities) entity.show = (entity._hmEndIndex ?? 0) <= clamped;
  viewer.scene.requestRender();
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
