import assert from 'node:assert/strict';

import {
  POSTER_HEIGHT,
  POSTER_WIDTH,
  computePosterBounds,
  posterColor,
  projectPosterPoint,
  selectPosterStorms,
} from '../src/poster.js';

const storms = [
  { id: 'weak', peak_wind_kt: 40, track: [{ lat: 20, lon: -80 }, { lat: 22, lon: -78 }] },
  { id: 'strong', peak_wind_kt: 145, track: [{ lat: 15, lon: -60 }, { lat: 28, lon: -82 }, { lat: 35, lon: -75 }] },
  { id: 'hidden', peak_wind_kt: 90, track: [{ lat: 10, lon: -40 }, { lat: 12, lon: -42 }] },
];
const selected = selectPosterStorms(storms, [{ storm_id: 'strong' }, { storm_id: 'strong' }, { storm_id: 'weak' }]);
assert.deepEqual(selected.map(storm => storm.id), ['weak', 'strong'], 'filtered landfalls should select unique matching tracks in draw order');

const bounds = computePosterBounds(selected);
assert(bounds.minLat < 15 && bounds.maxLat > 35 && bounds.minLon < -82 && bounds.maxLon > -60, 'poster bounds should pad all selected points');
const projected = projectPosterPoint(22, -78, bounds);
assert(projected.x > 0 && projected.x < POSTER_WIDTH && projected.y > 0 && projected.y < POSTER_HEIGHT);

assert.equal(posterColor(140), '#fffaf3', 'category 5 should rise to near-white in dark mode');
assert.notEqual(posterColor(35), posterColor(100), 'observed intensity should change track color');
assert.deepEqual(computePosterBounds([]), { minLat: 5, maxLat: 55, minLon: -145, maxLon: -35 });

console.log('filtered gallery poster utilities ok');
