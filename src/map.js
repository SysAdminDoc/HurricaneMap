// Leaflet map + landfall markers + track overlays.
import { categoryColor, ensureStormsLoaded, getStorm } from './data.js';

let map;
let landfallLayer;
let trackLayer;
let heatLayer = null;
let activeMarker = null;
const markersByEventKey = new Map();

function addBasemap(targetMap) {
  const primaryLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a> | Hurricane data: <a href="https://www.nhc.noaa.gov/data/">NOAA HURDAT2</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  });
  const fallbackLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Hurricane data: <a href="https://www.nhc.noaa.gov/data/">NOAA HURDAT2</a>',
    maxZoom: 19,
  });
  let fallbackActive = false;

  primaryLayer.on('tileerror', () => {
    if (fallbackActive) return;
    fallbackActive = true;
    if (targetMap.hasLayer(primaryLayer)) targetMap.removeLayer(primaryLayer);
    fallbackLayer.addTo(targetMap);
  });

  primaryLayer.addTo(targetMap);
}

export function initMap() {
  map = L.map('map', {
    center: [29.5, -84.0],
    zoom: 5,
    minZoom: 3,
    maxZoom: 11,
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  });

  addBasemap(map);

  landfallLayer = L.layerGroup().addTo(map);
  trackLayer = L.layerGroup().addTo(map);
  return map;
}

function radiusForCategory(cat) {
  if (cat <= 0) return 4;
  return 4 + cat * 1.4;
}

function eventKey(lf) {
  return `${lf.storm_id}|${lf.t}|${lf.lat}|${lf.lon}`;
}

export function renderLandfalls(landfalls, onSelect) {
  landfallLayer.clearLayers();
  markersByEventKey.clear();
  // Render major hurricanes on top of weaker storms so a TS dot doesn't bury a Cat 5.
  const sorted = [...landfalls].sort((a, b) => a.category - b.category);
  for (const lf of sorted) {
    const baseRadius = radiusForCategory(lf.category);
    const marker = L.circleMarker([lf.lat, lf.lon], {
      radius: baseRadius,
      color: '#070b12',
      weight: 1.5,
      opacity: 0.78,
      fillColor: categoryColor(lf.category),
      fillOpacity: 0.9,
      className: 'landfall-marker',
    });
    marker._baseRadius = baseRadius;
    const tt = `${lf.year} ${titleCase(lf.name)} — ${shortCat(lf.category)} • ${lf.state}`;
    marker.bindTooltip(tt, { direction: 'top', offset: [0, -4] });
    // Grow on hover via Leaflet setStyle (NOT CSS transform — see styles.css).
    marker.on('mouseover', () => {
      if (marker !== activeMarker) {
        marker.setStyle({ radius: baseRadius + 3, weight: 2 });
        marker.bringToFront();
      }
    });
    marker.on('mouseout', () => {
      if (marker !== activeMarker) {
        marker.setStyle({ radius: baseRadius, weight: 1.2 });
      }
    });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      onSelect(lf, marker);
    });
    marker.addTo(landfallLayer);
    markersByEventKey.set(eventKey(lf), marker);
  }
}

function shortCat(c) {
  if (c <= 0) return 'TS';
  return `Cat ${c}`;
}
function titleCase(name) {
  if (!name || name === 'UNNAMED') return 'Unnamed storm';
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}

export function focusLandfall(lf, panTo = true) {
  const key = eventKey(lf);
  const marker = markersByEventKey.get(key);
  if (activeMarker) {
    activeMarker.setStyle({
      weight: 1.5,
      color: '#070b12',
      radius: activeMarker._baseRadius,
    });
  }
  if (marker) {
    activeMarker = marker;
    marker.bringToFront();
    marker.setStyle({
      weight: 3,
      color: '#f7fbff',
      radius: (marker._baseRadius || 6) + 4,
    });
    if (panTo) {
      map.flyTo([lf.lat, lf.lon], Math.max(map.getZoom(), 7), { duration: 0.6 });
    }
  }
}

export function clearTracks() {
  trackLayer.clearLayers();
}

export async function showTrack(stormId, opts = {}) {
  await ensureStormsLoaded();
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
    const cat = saffirSimpson(b.wind);
    segs.push({
      coords: [[a.lat, a.lon], [b.lat, b.lon]],
      cat,
    });
  }
  return segs;
}

function saffirSimpson(kt) {
  if (kt == null || kt < 34) return -2; // td
  if (kt < 64) return -1;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}

export function fitToLandfalls(landfalls) {
  if (!landfalls.length) return;
  const bounds = L.latLngBounds(landfalls.map(l => [l.lat, l.lon]));
  map.fitBounds(bounds, { padding: [40, 40] });
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
