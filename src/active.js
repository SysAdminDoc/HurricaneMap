// Active storm tracking — pulls NHC's live CurrentStorms.json feed at boot
// (and every 10 min thereafter). When storms are active, renders their
// advisory tracks + cones of uncertainty in a distinctive electric-blue
// style. Off-season the feature contributes zero pixels.

import { getMap } from './map.js';

const CURRENT_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const REFRESH_MS = 10 * 60 * 1000;  // every 10 minutes

let layerGroup = null;
let badgeEl = null;

export async function startActiveStormPolling() {
  await fetchAndRender();
  setInterval(fetchAndRender, REFRESH_MS);
}

async function fetchAndRender() {
  let data = null;
  try {
    const r = await fetch(CURRENT_URL, { cache: 'no-cache' });
    if (!r.ok) return;
    data = await r.json();
  } catch (_) {
    // Off-season or no internet — silently skip.
    return;
  }
  const storms = (data && data.activeStorms) || [];
  ensureBadge(storms.length);
  if (!storms.length) {
    if (layerGroup) {
      getMap().removeLayer(layerGroup);
      layerGroup = null;
    }
    return;
  }
  renderActive(storms);
}

function ensureBadge(count) {
  if (!badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = 'active-storm-badge';
    badgeEl.className = 'active-badge glass';
    document.body.appendChild(badgeEl);
  }
  if (count > 0) {
    badgeEl.hidden = false;
    badgeEl.innerHTML = `
      <span class="ab-pulse"></span>
      <span class="ab-text">${count} active storm${count === 1 ? '' : 's'}</span>
    `;
  } else {
    badgeEl.hidden = true;
  }
}

async function renderActive(storms) {
  const map = getMap();
  if (layerGroup) map.removeLayer(layerGroup);
  layerGroup = L.layerGroup();

  for (const s of storms) {
    // Best-track points so far + forecast advisory points (5d cone).
    // The exact JSON schema varies; we tolerate missing fields gracefully.
    const advisoryPts = [];
    if (Array.isArray(s.forecastTrack)) {
      for (const p of s.forecastTrack) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) advisoryPts.push([p.lat, p.lon]);
      }
    }
    const bestTrackPts = [];
    if (Array.isArray(s.track)) {
      for (const p of s.track) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) bestTrackPts.push([p.lat, p.lon]);
      }
    }
    // Best-track polyline (solid).
    if (bestTrackPts.length > 1) {
      L.polyline(bestTrackPts, {
        color: '#89b4fa', weight: 3, opacity: 0.9, className: 'active-track',
      }).addTo(layerGroup);
    }
    // Forecast track (dashed).
    if (advisoryPts.length > 1) {
      L.polyline(advisoryPts, {
        color: '#f9e2af', weight: 2.5, opacity: 0.85, dashArray: '6 5',
        className: 'active-forecast',
      }).addTo(layerGroup);
    }
    // Current position marker.
    const cur = bestTrackPts[bestTrackPts.length - 1] || advisoryPts[0];
    if (cur) {
      L.circleMarker(cur, {
        radius: 8, color: '#11111b', weight: 2,
        fillColor: '#89b4fa', fillOpacity: 0.95,
      }).bindTooltip(
        `${s.name || s.binNumber || 'Active storm'}${s.classification ? ' · ' + s.classification : ''}${s.intensity ? ' · ' + s.intensity + ' kt' : ''}`,
        { direction: 'top' },
      ).addTo(layerGroup);
    }
    // Cone of uncertainty (if provided as a polygon).
    if (s.cone && Array.isArray(s.cone.coordinates)) {
      try {
        L.polygon(s.cone.coordinates.map(p => [p[1], p[0]]), {
          color: '#89b4fa', weight: 1, opacity: 0.5,
          fillColor: '#89b4fa', fillOpacity: 0.10,
          className: 'active-cone',
        }).addTo(layerGroup);
      } catch (_) { /* skip malformed cone */ }
    }
  }
  layerGroup.addTo(map);
}
