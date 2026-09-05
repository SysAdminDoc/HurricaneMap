// Leaflet map + landfall markers + track overlays.
import { categoryColor, ensureStormsLoaded, getStorm, windToCategory } from './data.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { prefersReducedMotion } from './settings.js';

// Leaflet is loaded from CDN as a UMD module, available as window.L
const L = window.L;

let map;
let landfallLayer;
let trackLayer;
let heatLayer = null;
let activeMarker = null;
let hoveredMarker = null;
let landfallTooltip = null;
const markersByEventKey = new Map();

function addBasemap(targetMap) {
  // OpenStreetMap standard tiles, darkened for the dark theme by the
  // .basemap-osm CSS filter. CARTO's keyless dark_all service now composites an
  // "API KEY REQUIRED" watermark into every tile at its CDN edge and still
  // answers HTTP 200, so no tileerror fallback can ever detect it. OSM's tile
  // usage policy applies: this is a low-volume static atlas and the
  // attribution below is required.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Hurricane data: <a href="https://www.nhc.noaa.gov/data/">NOAA HURDAT2</a>',
    maxZoom: 19,
    className: 'basemap-tiles basemap-osm',
  }).addTo(targetMap);
}

export function initMap() {
  map = L.map('map', {
    center: [29.5, -84.0],
    zoom: 5,
    minZoom: 3,
    maxZoom: 11,
    worldCopyJump: true,
    zoomControl: false,
    attributionControl: true,
  });

  L.control.zoom({ position: 'topright' }).addTo(map);

  const FullscreenControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const a = L.DomUtil.create('a', 'leaflet-fullscreen-btn', btn);
      a.href = '#';
      a.role = 'button';
      a.title = 'Toggle fullscreen';
      a.setAttribute('aria-label', 'Toggle fullscreen');
      a.innerHTML = '⛶';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(a, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      });
      return btn;
    },
  });
  new FullscreenControl().addTo(map);

  addBasemap(map);

  landfallLayer = L.layerGroup().addTo(map);
  trackLayer = L.layerGroup().addTo(map);

  map.on('mousemove', (e) => {
    if (!hoveredMarker) return;
    if (!isLandfallMarkerTarget(e.originalEvent?.target)) clearHoveredMarker(hoveredMarker);
  });
  map.on('mouseout click dragstart zoomstart movestart', () => clearHoveredMarker());
  return map;
}

function radiusForCategory(cat) {
  if (cat <= 0) return 4;
  return 4 + cat * 1.4;
}

function dashForCategory(cat) {
  if (cat <= 0) return null;
  if (cat <= 2) return '4 3';
  if (cat <= 4) return '2 2';
  return '1 2 1 2';
}

function eventKey(lf) {
  return `${lf.storm_id}|${lf.t}|${lf.lat}|${lf.lon}`;
}

function isLandfallMarkerTarget(target) {
  return target instanceof Element && Boolean(target.closest('.landfall-marker'));
}

function resetMarkerStyle(marker) {
  if (!marker) return;
  // Restore the exact creation style — hardcoded constants here drifted from
  // renderLandfalls (e.g. a major hurricane's 2.2 border became 1.2 after the
  // first hover and never came back).
  const radius = marker._baseRadius || 4;
  marker.setStyle(marker._baseStyle || {
    weight: radius >= radiusForCategory(3) ? 2.2 : 1.6,
    color: '#0a0f1a',
    radius,
  });
}

function ensureLandfallTooltip() {
  if (!landfallTooltip) {
    landfallTooltip = L.tooltip({
      direction: 'top',
      offset: [0, -4],
      permanent: false,
      sticky: false,
      opacity: 0.96,
      className: 'landfall-tooltip',
    });
  }
  return landfallTooltip;
}

function openLandfallTooltip(marker) {
  if (!map || !marker) return;
  ensureLandfallTooltip()
    // Tooltip content is HTML to Leaflet — escape so a poisoned data bundle
    // (storm name / state string) can't become markup (CVE-2025-69993 class).
    .setContent(escapeHtml(marker._tooltipText || ''))
    .setLatLng(marker.getLatLng())
    .addTo(map);
}

function setHoveredMarker(marker) {
  if (hoveredMarker && hoveredMarker !== marker) clearHoveredMarker(hoveredMarker);
  hoveredMarker = marker;
  if (marker !== activeMarker) {
    marker.setStyle({ radius: (marker._baseRadius || 4) + 3, weight: 2 });
    marker.bringToFront();
  }
  openLandfallTooltip(marker);
}

function clearHoveredMarker(marker = hoveredMarker) {
  if (!marker) return;
  const isCurrentHover = marker === hoveredMarker;
  if (isCurrentHover && map && landfallTooltip) map.removeLayer(landfallTooltip);
  if (marker !== activeMarker) resetMarkerStyle(marker);
  if (isCurrentHover) hoveredMarker = null;
}

export function renderLandfalls(landfalls, onSelect) {
  clearHoveredMarker();
  landfallLayer.clearLayers();
  markersByEventKey.clear();
  activeMarker = null;
  // Render major hurricanes on top of weaker storms so a TS dot doesn't bury a Cat 5.
  const sorted = [...landfalls].sort((a, b) => a.category - b.category);
  for (const lf of sorted) {
    const baseRadius = radiusForCategory(lf.category);
    const isMajor = lf.category >= 3;
    const dash = dashForCategory(lf.category);
    const tierClass = lf.category <= 0 ? 'tier-ts' : lf.category <= 2 ? 'tier-minor' : lf.category <= 4 ? 'tier-major' : 'tier-cat5';
    const marker = L.circleMarker([lf.lat, lf.lon], {
      radius: baseRadius,
      color: '#0a0f1a',
      weight: isMajor ? 2.2 : 1.6,
      // Matches setHeatmap(false)'s restore value, which runs after every
      // filter pass — a higher creation value would only last one frame.
      opacity: 0.6,
      fillColor: categoryColor(lf.category),
      fillOpacity: 0.92,
      dashArray: dash,
      className: `landfall-marker ${tierClass}${isMajor ? ' landfall-major' : ''}`,
    });
    marker._baseRadius = baseRadius;
    marker._baseStyle = {
      radius: baseRadius,
      color: '#0a0f1a',
      weight: isMajor ? 2.2 : 1.6,
      opacity: 0.6,
    };
    const tt = `${lf.year} ${formatStormName(lf.name, { unnamed: 'Unnamed storm' })} — ${shortCat(lf.category)} • ${lf.state}`;
    marker._tooltipText = tt;
    // Grow on hover via Leaflet setStyle (NOT CSS transform — see styles.css).
    marker.on('mouseover', () => setHoveredMarker(marker));
    marker.on('mouseout', () => {
      clearHoveredMarker(marker);
    });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      clearHoveredMarker(marker);
      announceToLiveRegion(tt);
      onSelect(lf, marker);
    });
    marker.addTo(landfallLayer);
    markersByEventKey.set(eventKey(lf), marker);
  }
}

export function announceToLiveRegion(text) {
  const el = document.getElementById('map-announce');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

function shortCat(c) {
  if (c <= 0) return 'TS';
  return `Cat ${c}`;
}
export function focusLandfall(lf, panTo = true) {
  clearHoveredMarker();
  const key = eventKey(lf);
  const marker = markersByEventKey.get(key);
  if (activeMarker) {
    resetMarkerStyle(activeMarker);
  }
  if (marker) {
    activeMarker = marker;
    marker.bringToFront();
    marker.setStyle({
      weight: 3,
      color: '#f7fbff',
      radius: (marker._baseRadius || 4) + 4,
    });
    if (panTo) {
      const target = [lf.lat, lf.lon];
      const zoom = Math.max(map.getZoom(), 7);
      if (prefersReducedMotion()) map.setView(target, zoom);
      else map.flyTo(target, zoom, { duration: 0.6 });
    }
  }
}

// Generation token: clearTracks() invalidates every showTrack() still awaiting
// the lazy storms.json load, so stale continuations can't repaint tracks that
// were cleared (toggle-off or storm-switch during the 2 MB first load).
let trackGeneration = 0;

export function clearTracks() {
  trackGeneration++;
  trackLayer.clearLayers();
}

export async function showTrack(stormId, opts = {}) {
  const generation = trackGeneration;
  await ensureStormsLoaded();
  if (generation !== trackGeneration) return null;
  const storm = getStorm(stormId);
  if (!storm) return null;
  const segments = buildIntensitySegments(storm.track);
  const color = opts.color;
  const layers = [];
  for (const seg of segments) {
    const poly = L.polyline(seg.coords, {
      color: color || categoryColor(seg.cat),
      weight: opts.weight || 2.75,
      opacity: 0.88,
      lineJoin: 'round',
      className: 'track-line',
    });
    layers.push(poly);
    poly.addTo(trackLayer);
  }
  // Genesis marker (small empty circle).
  if (storm.track.length) {
    const start = storm.track[0];
    L.circleMarker([start.lat, start.lon], {
      radius: 3, color: '#cdd6f4', weight: 1, fillOpacity: 0,
    }).bindTooltip('Genesis', { direction: 'top' }).addTo(trackLayer);
  }
  return storm;
}

function buildIntensitySegments(track) {
  const segs = [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const cat = windToCategory(b.wind);
    segs.push({
      coords: [[a.lat, a.lon], [b.lat, b.lon]],
      cat,
    });
  }
  return segs;
}


/** Density heatmap toggle. Each landfall becomes a heat point with intensity
 *  weighted by Saffir-Simpson category (TS=0.4 → Cat 5=1.0). When the heatmap
 *  is on, the colored Saffir-Simpson dot layer is dimmed for clarity. */
export function setHeatmap(enabled, landfalls) {
  if (!enabled) {
    if (heatLayer) {
      map.removeLayer(heatLayer);
      heatLayer = null;
    }
    landfallLayer.eachLayer(l => l.setStyle({ fillOpacity: 0.92, opacity: 0.6 }));
    return;
  }
  const points = landfalls.map(lf => {
    const c = lf.category;
    const weight = c <= 0 ? 0.4 : 0.55 + c * 0.09;  // TS .4, Cat1 .64, Cat5 1.0
    return [lf.lat, lf.lon, weight];
  });
  if (heatLayer) {
    heatLayer.setLatLngs(points);
  } else {
    heatLayer = L.heatLayer(points, {
      radius: 22,
      blur: 28,
      maxZoom: 9,
      max: 1.0,
      // Catppuccin-tinted gradient: cold blue → green → yellow → orange → red → mauve
      gradient: {
        0.10: '#74c7ec',
        0.30: '#a6e3a1',
        0.50: '#f9e2af',
        0.70: '#fab387',
        0.85: '#f38ba8',
        1.00: '#cba6f7',
      },
    }).addTo(map);
  }
  // Dim the underlying dots so the heatmap reads cleanly.
  landfallLayer.eachLayer(l => l.setStyle({ fillOpacity: 0.25, opacity: 0.25 }));
}

export function getMap() { return map; }
