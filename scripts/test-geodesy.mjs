import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  destinationPointNmi,
  haversineKm,
  initialBearingDeg,
  pointToSegmentDistanceKm,
} from '../src/geodesy.js';
import {
  COASTAL_CITIES,
  closestApproach,
  computeCityReturnPeriods,
} from '../src/metrics.js';

const vectors = JSON.parse(await readFile(
  new URL('../tests/fixtures/geodesy-reference.json', import.meta.url),
  'utf8',
));
const toleranceKm = 1e-6;
for (const vector of vectors.distance_vectors) {
  const actual = haversineKm(...vector.from, ...vector.to);
  assert(Math.abs(actual - vector.expected_km) <= toleranceKm, `${vector.name}: ${actual} km`);
}
for (const vector of vectors.segment_vectors) {
  const actual = pointToSegmentDistanceKm(
    ...vector.point,
    [vector.start[1], vector.start[0]],
    [vector.end[1], vector.end[0]],
  );
  assert(Math.abs(actual - vector.expected_km) <= toleranceKm, `${vector.name}: ${actual} km`);
}
for (const vector of vectors.closest_approach_vectors) {
  const approach = closestApproach(vector.track, ...vector.target);
  assert(approach, `${vector.name}: expected a closest approach`);
  assert(Math.abs(approach.distance_km - vector.expected_km) <= toleranceKm, `${vector.name}: ${approach.distance_km} km`);
  assert.equal(approach.segment?.start_idx, 0, `${vector.name}: segment start`);
  assert.equal(approach.segment?.end_idx, 1, `${vector.name}: segment end`);
  assert(Math.abs(approach.segment.fraction - vector.expected_fraction) <= 1e-9, `${vector.name}: fraction`);
  assert(Math.abs(approach.track_point.lat - vector.expected_lat) <= 1e-9, `${vector.name}: projected latitude`);
  assert(Math.abs(approach.track_point.lon - vector.expected_lon) <= 1e-9, `${vector.name}: projected longitude`);
  assert(Math.abs(approach.track_point.wind - vector.expected_wind) <= 1e-9, `${vector.name}: interpolated wind`);
  assert.equal(approach.track_point.t, vector.expected_time, `${vector.name}: interpolated timestamp`);
  const nearestFixKm = Math.min(
    haversineKm(vector.track[0].lat, vector.track[0].lon, ...vector.target),
    haversineKm(vector.track[1].lat, vector.track[1].lon, ...vector.target),
  );
  assert(nearestFixKm > approach.distance_km + 10, `${vector.name}: nearest-fix regression guard`);
}
assert(Math.abs(initialBearingDeg(0, 0, 10, 0)) < 1e-9, 'north bearing');
assert(Math.abs(initialBearingDeg(0, 179.9, 0, -179.9) - 90) < 1e-9, 'antimeridian bearing');
const north = destinationPointNmi(20, -80, 0, 60);
assert(Math.abs(north[0] - 20.9993) < 0.01 && Math.abs(north[1] + 80) < 1e-9, 'nautical-mile destination');

const storms = JSON.parse(await readFile(new URL('../data/storms.json', import.meta.url), 'utf8'));
const catalogueChecks = [
  ['Miami, FL', 53],
  ['Cape Hatteras, NC', 82],
  ['New York, NY', 34],
];
for (const [cityName, expectedCount] of catalogueChecks) {
  const city = COASTAL_CITIES.find(candidate => candidate.name === cityName);
  assert(city, `${cityName}: city fixture`);
  const count = storms.filter(storm => {
    const approach = closestApproach(storm.track, city.lat, city.lon);
    return approach && approach.distance_mi <= 50;
  }).length;
  assert.equal(count, expectedCount, `${cityName}: true track count`);
}

const segmentOnlyStorms = [2000, 2005].map(year => ({
  year,
  track: [
    { t: `${year}-08-01T00:00:00Z`, lat: 0, lon: 0, wind: 120 },
    { t: `${year}-08-01T06:00:00Z`, lat: 0, lon: 1, wind: 120 },
  ],
}));
const segmentOnlyReturnPeriods = computeCityReturnPeriods(
  { name: 'fixture', lat: 0.3, lon: 0.5 },
  segmentOnlyStorms,
);
assert.equal(segmentOnlyReturnPeriods.cat1_count, 2, 'return periods count segment-only Cat 1 events');
assert.equal(segmentOnlyReturnPeriods.cat3_count, 2, 'return periods count segment-only Cat 3 events');
assert.equal(segmentOnlyReturnPeriods.cat5_count, 0, 'return periods exclude sub-Cat 5 events');
assert.equal(segmentOnlyReturnPeriods.cat3_years, 5, 'return periods use one event per storm');

console.log(`geodesy ok (${vectors.distance_vectors.length} distances, ${vectors.segment_vectors.length} segments, ${catalogueChecks.length} track counts)`);
