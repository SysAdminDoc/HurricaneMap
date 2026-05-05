import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findSimilarStorms,
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

console.log('similarity vectors ok');
