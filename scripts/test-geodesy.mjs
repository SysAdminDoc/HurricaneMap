import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  destinationPointNmi,
  haversineKm,
  initialBearingDeg,
  pointToSegmentDistanceKm,
} from '../src/geodesy.js';

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
assert(Math.abs(initialBearingDeg(0, 0, 10, 0)) < 1e-9, 'north bearing');
assert(Math.abs(initialBearingDeg(0, 179.9, 0, -179.9) - 90) < 1e-9, 'antimeridian bearing');
const north = destinationPointNmi(20, -80, 0, 60);
assert(Math.abs(north[0] - 20.9993) < 0.01 && Math.abs(north[1] + 80) < 1e-9, 'nautical-mile destination');

console.log(`geodesy ok (${vectors.distance_vectors.length} distances, ${vectors.segment_vectors.length} segments)`);
