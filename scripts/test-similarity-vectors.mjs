import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findSimilarStorms,
  generateStormBiography,
  getSimilarityVector,
  getStormVector,
  STORM_SIMILARITY_VECTOR_LENGTH,
} from '../src/metrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storms = JSON.parse(await readFile(path.join(root, 'data/storms.json'), 'utf8'));

assert.ok(Array.isArray(storms) && storms.length > 0, 'storms.json must contain storms');

for (const storm of storms) {
  assert.equal(
    storm.similarity_vector?.length,
    STORM_SIMILARITY_VECTOR_LENGTH,
    `${storm.id} must include a full precomputed similarity vector`,
  );
  for (const [index, value] of storm.similarity_vector.entries()) {
    assert.ok(
      Number.isFinite(value) && value >= 0 && value <= 1,
      `${storm.id}.similarity_vector[${index}] must be normalized`,
    );
  }
  const embeddedVector = getSimilarityVector(storm);
  const runtimeVector = getStormVector(storm);
  for (let i = 0; i < STORM_SIMILARITY_VECTOR_LENGTH; i++) {
    assert.ok(
      Math.abs(embeddedVector[i] - runtimeVector[i]) <= 0.000001,
      `${storm.id}.similarity_vector[${i}] should match runtime fallback`,
    );
  }
}

const reference = storms.find(storm => storm.id === 'AL122005');
assert.ok(reference, 'Katrina 2005 fixture is expected in storms.json');
assert.match(generateStormBiography(reference, null), /made 3 landfalls in Florida, Louisiana/);

const iniki = storms.find(storm => storm.id === 'EP181992');
assert.ok(iniki, 'Iniki 1992 fixture is expected in storms.json');
assert.match(generateStormBiography(iniki, null), /in the eastern Pacific/);
assert.doesNotMatch(generateStormBiography(iniki, null), /Gulf of Mexico/);

const cloneWithoutVectors = storms.map(storm => {
  const { similarity_vector, ...rest } = storm;
  return rest;
});
const referenceWithoutVector = cloneWithoutVectors.find(storm => storm.id === reference.id);
const embeddedNeighbors = findSimilarStorms(reference, storms, 5).map(row => row.storm_id);
const runtimeNeighbors = findSimilarStorms(referenceWithoutVector, cloneWithoutVectors, 5).map(row => row.storm_id);

assert.deepEqual(
  embeddedNeighbors,
  runtimeNeighbors,
  'precomputed vectors must preserve runtime similarity ordering',
);

// Bearing helpers (spatial search + active-storm distance readout).
const { bearingDeg, compassLabel } = await import('../src/metrics.js');
assert.ok(Math.abs(bearingDeg(29.95, -90.07, 35.0, -90.07) - 0) < 0.5, 'due north bearing');
assert.ok(Math.abs(bearingDeg(29.95, -90.07, 29.95, -85.0) - 90) < 1.5, 'due east bearing');
assert.equal(compassLabel(0), 'N');
assert.equal(compassLabel(44), 'NE');
assert.equal(compassLabel(180), 'S');
assert.equal(compassLabel(292.5), 'NW');
assert.equal(compassLabel(359), 'N');
assert.equal(compassLabel(NaN), '');

console.log('similarity vectors ok');
