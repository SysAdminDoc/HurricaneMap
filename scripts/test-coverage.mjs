import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildCoverage } from './build-coverage.mjs';

const coverage = JSON.parse(await readFile('data/coverage.json', 'utf8'));
const metadata = JSON.parse(await readFile('data/metadata.json', 'utf8'));
const byId = new Map(coverage.datasets.map(dataset => [dataset.id, dataset]));

assert.equal(coverage.schema_version, 1);
assert.equal(coverage.generated_at_utc, metadata.generated_at_utc);
assert.equal(coverage.source_commit, metadata.generator.source_commit);
assert.deepEqual(coverage.catalog, {
  basins: ['AL', 'EP'],
  year_range: [1851, 2025],
  storm_count: 595,
  landfall_event_count: 759,
  hurricane_landfall_count: 374,
});
assert.equal(coverage.datasets.length, 15);
for (const dataset of coverage.datasets) {
  assert(dataset.sources.length > 0, `${dataset.id} needs a source`);
  assert(dataset.sources.every(source => /^https:\/\//.test(source.url)), `${dataset.id} has a non-HTTPS source`);
  assert(['active', 'closed', 'deprecated'].includes(dataset.lifecycle_status), `${dataset.id} lifecycle`);
  assert(['final', 'inferred', 'operational', 'stale', 'closed', 'unavailable'].includes(dataset.value_status), `${dataset.id} value status`);
}

assert.equal(byId.get('hurdat2').availability.storms, 595);
assert.equal(byId.get('hurdat2').availability.records, 759);
assert.match(byId.get('hurdat2').availability.detail, /56 inferred/);
assert.equal(byId.get('aoml-landfalls').availability.records, 386);
assert.equal(byId.get('storm-impacts').value_status, 'inferred');
assert.equal(byId.get('storm-impacts').availability.records, 244);
assert.equal(byId.get('ncei-billions').lifecycle_status, 'closed');
assert.equal(byId.get('ncei-billions').availability.runnable, false);
assert.equal(byId.get('ncei-billions').end_date, '2024-12-31');
assert.equal(byId.get('enso').availability.records, 76);
assert.equal(byId.get('advisory-replay').availability.storms, 33);
assert.equal(byId.get('advisory-replay').availability.advisories, 886);
assert.equal(byId.get('radar-archive').availability.storms, 139);
assert.equal(byId.get('radar-archive').availability.frames, 1703);
assert.deepEqual(byId.get('radar-archive').year_range, [1995, 2025]);
assert.equal(byId.get('hwm').availability.storms, 25);
assert.equal(byId.get('hwm').availability.marks, 10741);
assert.equal(byId.get('tide-stations').availability.records, 301);

const regenerated = await buildCoverage();
assert.deepEqual(regenerated, coverage, 'coverage.json must be generated from the canonical data sources');

console.log('coverage contracts ok (15 datasets, lifecycle/value statuses, archive counts, and deterministic generation)');
