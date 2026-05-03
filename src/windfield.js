// Wind-field swath overlay using HURDAT2 best-track wind radii (2004+).
//
// HURDAT2 records wind extents at three thresholds — 34 kt (TS-force),
// 50 kt, 64 kt (hurricane-force) — in each of 4 quadrants (NE/SE/SW/NW),
// in nautical miles. We draw a single asymmetric polygon per threshold per
// track point, then layer them: lightest 34 kt outline, medium 50 kt fill,
// darkest 64 kt fill. A toggle in the storm panel attaches all of them so
// you can see the full evolution of the wind field along the path.
//
// For pre-2004 storms we have no radii data and do nothing — the toggle
// is hidden in the panel for those.

import { getMap } from './map.js';

// Indices into the 12-int radii array set by preprocess_hurdat2.py:
//   [r34_NE, r34_SE, r34_SW, r34_NW,
//    r50_NE, r50_SE, r50_SW, r50_NW,
//    r64_NE, r64_SE, r64_SW, r64_NW]
const QUADS = [
  { name: 'NE', startBearing:   0, endBearing:  90 },
  { name: 'SE', startBearing:  90, endBearing: 180 },
  { name: 'SW', startBearing: 180, endBearing: 270 },
  { name: 'NW', startBearing: 270, endBearing: 360 },
];

const POINTS_PER_QUADRANT = 14;

const NM_PER_DEG_LAT = 60;  // close enough at this scale

let activeLayer = null;

/** Convert (lat, lon, distance in nm, bearing deg) → [lat2, lon2] using a
 *  flat-earth approximation (good enough for storm-sized scales). */
function offsetByBearing(lat, lon, distNm, bearingDeg) {
  const br = (bearingDeg * Math.PI) / 180;
  const dLat = (distNm / NM_PER_DEG_LAT) * Math.cos(br);
  const dLon = (distNm / NM_PER_DEG_LAT) * Math.sin(br) / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

/** Build a polygon (array of [lat, lon]) for one wind threshold at one
 *  track point, using 4 quadrant radii. Collapses toward center for any
 *  quadrant whose radius is 0/missing. */
function buildPolygon(lat, lon, quadRadiiNm) {
  const ring = [];
  for (let q = 0; q < 4; q++) {
    const r = quadRadiiNm[q];
    const { startBearing, endBearing } = QUADS[q];
    if (!r || r <= 0) {
      // No analyzed extent in this quadrant — collapse to center.
      ring.push([lat, lon]);
      continue;
    }
    for (let i = 0; i < POINTS_PER_QUADRANT; i++) {
      const f = i / (POINTS_PER_QUADRANT - 1);
      const bearing = startBearing + (endBearing - startBearing) * f;
      ring.push(offsetByBearing(lat, lon, r, bearing));
    }
  }
  return ring;
}

/** Return how many of this storm's track records carry radii data. Used to
 *  decide whether to expose the windfield toggle for this storm. */
export function radiiCount(storm) {
  if (!storm?.track) return 0;
  return storm.track.reduce((n, r) => n + (r.radii ? 1 : 0), 0);
}

/** Show wind-field swaths for the given storm. */
export function showWindField(storm) {
  hideWindField();
  const recs = storm.track.filter(r => r.radii && (r.status === 'HU' || r.status === 'TS' || r.status === 'SS'));
  if (!recs.length) return null;

  const group = L.layerGroup();

  // Build three threshold passes — paint 34 kt outline first (lightest), then
  // 50 kt and 64 kt fills on top so the strongest core sits visually inside.
  const PASSES = [
    { offset: 0,  color: '#74c7ec', fillOpacity: 0.04, weight: 1, dashArray: null },     // 34 kt sapphire
    { offset: 4,  color: '#fab387', fillOpacity: 0.07, weight: 1, dashArray: null },     // 50 kt peach
    { offset: 8,  color: '#f38ba8', fillOpacity: 0.10, weight: 1.2, dashArray: null },   // 64 kt pink (hurricane)
  ];

  for (const pass of PASSES) {
    for (const r of recs) {
      const quadRadii = r.radii.slice(pass.offset, pass.offset + 4);
      if (!quadRadii.some(v => v > 0)) continue;
      const ring = buildPolygon(r.lat, r.lon, quadRadii);
      if (ring.length < 4) continue;
      L.polygon(ring, {
        color: pass.color,
        weight: pass.weight,
        opacity: 0.5,
        fillColor: pass.color,
        fillOpacity: pass.fillOpacity,
        interactive: false,
        className: 'wind-swath',
      }).addTo(group);
    }
  }

  group.addTo(getMap());
  activeLayer = group;
  return group;
}

export function hideWindField() {
  if (activeLayer) {
    getMap().removeLayer(activeLayer);
    activeLayer = null;
  }
}
