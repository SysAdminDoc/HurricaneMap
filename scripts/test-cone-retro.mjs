import assert from 'node:assert/strict';

import {
  buildConeEnvelope,
  buildConeSamples,
  destinationPoint,
  interpolateTrackPoint,
} from '../src/cone-retro.js';

const start = Date.UTC(2026, 7, 20, 0, 0);
const track = Array.from({ length: 9 }, (_, index) => ({
  t: new Date(start + index * 6 * 60 * 60 * 1000).toISOString(),
  lat: 20 + index * 0.25,
  lon: -80 + index * 0.5,
}));
const storm = {
  basin: 'AL',
  track,
  us_landfalls: [{ t: track.at(-1).t, lat: track.at(-1).lat, lon: track.at(-1).lon }],
};

const halfway = interpolateTrackPoint(track, start + 3 * 60 * 60 * 1000);
assert.equal(halfway.lat, 20.125);
assert.equal(halfway.lon, -79.75);
assert.equal(interpolateTrackPoint(track, start - 1), null);

const samples = buildConeSamples(storm, { 12: 25, 24: 39, 48: 62 });
assert.equal(samples.length, 4, 'origin plus three valid forecast leads should be sampled');
assert.deepEqual(samples.slice(1).map(sample => sample.hours), [12, 24, 48]);
assert.deepEqual(samples.slice(1).map(sample => sample.radius), [25, 39, 62]);

const circular = buildConeEnvelope(samples);
const ellipse = buildConeEnvelope(samples, { ellipse: true, alongTrackScale: 1.35, crossTrackScale: 1.05 });
assert(circular.length >= 3, 'circle method should return a polygon envelope');
assert(ellipse.length >= 3, 'ellipse method should return a polygon envelope');
const lonSpan = points => Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
assert(lonSpan(ellipse) > lonSpan(circular), 'along-track ellipse scaling should lengthen the envelope');

const north = destinationPoint(20, -80, 0, 60);
assert(Math.abs(north[0] - 21) < 0.02, '60 n mi north should be approximately one latitude degree');
assert(Math.abs(north[1] + 80) < 0.01);

console.log('retrospective cone utilities ok');
