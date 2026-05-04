// Forecast ensemble rendering — GFS/ECMWF spaghetti tracks for active storms.
//
// Ensemble tracks are fetched from public model-track APIs and rendered as
// semi-transparent polylines. Infrastructure for integration with:
// - TROPYCAL Python package (via REST bridge if available)
// - IEM GFS/ECMWF endpoints (when publicly available)
// - Direct NOAA GFS API (if/when CORS-enabled)

import { getMap } from './map.js';

let ensembleLayerGroup = null;
let ensembleCache = {}; // Cache ensemble tracks by storm name to avoid re-fetching

const ENSEMBLE_CONFIG = {
  gfs: {
    name: 'GFS',
    color: '#74c7ec',
    opacity: 0.4,
  },
  ecmwf: {
    name: 'ECMWF',
    color: '#a6e3a1',
    opacity: 0.35,
  },
  hwrf: {
    name: 'HWRF',
    color: '#f9e2af',
    opacity: 0.35,
  },
};

export async function renderEnsembleTracks(activeStorms, enabled = true) {
  const map = getMap();

  // Clear existing ensemble layer
  if (ensembleLayerGroup) {
    map.removeLayer(ensembleLayerGroup);
    ensembleLayerGroup = null;
  }

  if (!enabled || !Array.isArray(activeStorms) || activeStorms.length === 0) {
    return;
  }

  ensembleLayerGroup = L.layerGroup();

  for (const storm of activeStorms) {
    const stormName = storm.name || storm.binNumber || 'unknown';

    // Check cache first
    if (ensembleCache[stormName]) {
      renderCachedEnsembles(ensembleCache[stormName], ensembleLayerGroup);
      continue;
    }

    // Attempt to fetch ensemble tracks (stub for multiple API sources)
    try {
      const ensembles = await fetchEnsembleTracks(stormName);
      if (ensembles && ensembles.length > 0) {
        ensembleCache[stormName] = ensembles;
        renderCachedEnsembles(ensembles, ensembleLayerGroup);
      }
    } catch (_) {
      // Ensemble fetch failed or not available — continue with official track only
    }
  }

  if (ensembleLayerGroup.getLayers().length > 0) {
    ensembleLayerGroup.addTo(map);
  }
}

async function fetchEnsembleTracks(stormName) {
  // Attempt multiple API sources. Return early on first success.
  // For now, this is a stub — real implementation would hit:
  // 1. TROPYCAL bridge (if self-hosted)
  // 2. IEM/GFS endpoints (when available)
  // 3. Direct NOAA GFS API (when CORS-enabled)

  // This is intentionally a no-op for now to avoid dependency bloat.
  // Recommendation: integrate with https://github.com/tropycal/tropycal
  // or https://mesonet.agron.iastate.edu/ for production use.

  return [];
}

function renderCachedEnsembles(ensembles, layerGroup) {
  if (!Array.isArray(ensembles)) return;

  for (const ensemble of ensembles) {
    const { model, tracks } = ensemble;
    const config = ENSEMBLE_CONFIG[model] || ENSEMBLE_CONFIG.gfs;

    if (!Array.isArray(tracks)) continue;

    for (const track of tracks) {
      if (!Array.isArray(track) || track.length < 2) continue;

      // Filter to valid [lat, lon] pairs
      const validPts = track.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (validPts.length < 2) continue;

      // Render as semi-transparent polyline
      L.polyline(validPts, {
        color: config.color,
        weight: 1.5,
        opacity: config.opacity,
        className: `ensemble-track ensemble-${model}`,
      }).addTo(layerGroup);
    }
  }
}

export function hideEnsembleTracks() {
  const map = getMap();
  if (ensembleLayerGroup) {
    map.removeLayer(ensembleLayerGroup);
    ensembleLayerGroup = null;
  }
}

export function clearEnsembleCache() {
  ensembleCache = {};
}
