// P10.2 — NHC Cone of Uncertainty: Render official forecast track cones on the map

import L from 'leaflet';

let coneLayer = null;
let conePolylines = [];
let lastPolledStorm = null;
let conePollingInterval = null;

const CONE_API = 'https://services1.arcgis.com/hRUr1F8lE8Jz2Ppj/arcgis/rest/services/NHC_Viewable/FeatureServer/1/query';
const CONE_UPDATE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

export function initConeLayer(map) {
  // Create a feature group for cone layers
  coneLayer = L.featureGroup();
  map.addLayer(coneLayer);
  coneLayer.bringToBack(); // Behind track lines
}

export function showConeForStorm(stormId, map) {
  // Clear existing cones
  clearCone();
  
  // Check if storm is active (born in last 10 days)
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  
  // For now, only show cones for active storms
  // This would be enhanced with actual active-storm data from the app
  if (!isStormRecent(stormId, tenDaysAgo)) {
    return;
  }
  
  // Fetch and render cone
  fetchAndRenderCone(stormId, map);
}

function isStormRecent(stormId, sinceDate) {
  // Parse storm ID: e.g., "AL092005" -> year 2005
  const yearMatch = stormId.match(/\d{4}$/);
  if (!yearMatch) return false;
  const year = parseInt(yearMatch[0], 10);
  const currentYear = new Date().getFullYear();
  
  // Only show cones for current or very recent season
  return year === currentYear || year === currentYear - 1;
}

async function fetchAndRenderCone(stormId, map) {
  try {
    // Query NHC GIS server for cone data
    // Format: e.g., "AL092005" for 2005 Hurricane Katrina
    const where = `StormNumber='${stormId.substring(0, 2)}${parseInt(stormId.substring(2, 4), 10)}' AND Season=${stormId.substring(4)}`;
    
    const response = await fetch(`${CONE_API}?where=${encodeURIComponent(where)}&f=geojson&outSR=4326`);
    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      renderConeFeatures(data.features, map);
      lastPolledStorm = stormId;
    }
  } catch (err) {
    console.warn('Failed to fetch NHC cone data:', err);
  }
}

function renderConeFeatures(features, map) {
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;
    
    if (geom.type === 'Polygon') {
      renderConePolygon(geom.coordinates, map);
    } else if (geom.type === 'MultiLineString') {
      // Render cone outline as connected lines
      for (const lineCoords of geom.coordinates) {
        renderConeLine(lineCoords, map);
      }
    }
  }
}

function renderConePolygon(coords, map) {
  // coords[0] is the outer ring, coords[1...] are holes
  const latLngs = coords[0].map(([lon, lat]) => [lat, lon]);
  
  const polygon = L.polygon(latLngs, {
    color: '#FF6B35',
    weight: 2,
    opacity: 0.5,
    fillColor: '#FF6B35',
    fillOpacity: 0.1,
    dashArray: '5, 5',
    lineCap: 'round',
    lineJoin: 'round',
  });
  
  polygon.bindPopup('NHC Forecast Cone of Uncertainty');
  coneLayer.addLayer(polygon);
  conePolylines.push(polygon);
}

function renderConeLine(coords, map) {
  const latLngs = coords.map(([lon, lat]) => [lat, lon]);
  
  const polyline = L.polyline(latLngs, {
    color: '#FF6B35',
    weight: 2,
    opacity: 0.6,
    dashArray: '3, 3',
    lineCap: 'round',
    lineJoin: 'round',
  });
  
  coneLayer.addLayer(polyline);
  conePolylines.push(polyline);
}

export function clearCone() {
  if (conePollingInterval) {
    clearInterval(conePollingInterval);
    conePollingInterval = null;
  }
  
  for (const poly of conePolylines) {
    if (coneLayer) coneLayer.removeLayer(poly);
  }
  conePolylines = [];
  lastPolledStorm = null;
}

export function startConePolling(stormId, map) {
  // Initial fetch
  showConeForStorm(stormId, map);
  
  // Poll for updates every 6 hours
  if (conePollingInterval) clearInterval(conePollingInterval);
  conePollingInterval = setInterval(() => {
    showConeForStorm(stormId, map);
  }, CONE_UPDATE_INTERVAL);
}

export function toggleConeVisibility(visible) {
  if (!coneLayer) return;
  if (visible) {
    coneLayer.setOpacity(1);
  } else {
    coneLayer.setOpacity(0);
  }
}
