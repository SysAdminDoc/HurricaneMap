// README states archive depth in prose; data/coverage.json states it in data.
// A reader has no way to tell which is current, so the prose has to be checked
// against the file rather than typed and trusted. A single "1851 to 2025" line
// overstated the radar and advisory archives for as long as they have existed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bestTrackDepth, layerDepths, nextRevisionExpectation, SHALLOW_LAYERS } from '../src/coverage-claims.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coverage = JSON.parse(await readFile(path.join(root, 'data/coverage.json'), 'utf8'));
const metadata = JSON.parse(await readFile(path.join(root, 'data/metadata.json'), 'utf8'));
const readme = await readFile(path.join(root, 'README.md'), 'utf8');

const best = bestTrackDepth(coverage);
assert.ok(best, 'data/coverage.json must state the best-track year range');
assert.ok(readme.includes(`${best.from}-${best.to}`), `README must state the best-track range ${best.from}-${best.to}`);
assert.ok(
  readme.includes(`${best.storms} storms`),
  `README must state the ${best.storms} storms data/coverage.json counts`,
);

// The shallow layers, each with the years and storm count the data records.
const layers = layerDepths(coverage);
assert.equal(layers.length, SHALLOW_LAYERS.length, 'every shallow layer must be present in data/coverage.json');
for (const layer of layers) {
  assert.ok(
    readme.includes(`${layer.from}-${layer.to}`),
    `README must state ${layer.id} as covering ${layer.from}-${layer.to}`,
  );
  if (layer.storms == null) continue;
  assert.ok(
    new RegExp(`${layer.from}-${layer.to}\\s*\\(${layer.storms} storms\\)`).test(readme),
    `README must pair ${layer.id}'s range with its ${layer.storms} storms`,
  );
}
// And it must say so as a distinction, not bury the numbers in a table.
assert.match(readme, /Layer depth is not the same as best-track depth/);

// A reader who cannot tell whether the data is current assumes it is abandoned.
const revision = nextRevisionExpectation(metadata);
assert.ok(revision, 'data/metadata.json must carry a source revision date');
assert.ok(readme.includes(revision.revised), `README must state the ${revision.revised} HURDAT2 revision`);
assert.ok(
  readme.includes(String(revision.expectedYear)),
  `README must name ${revision.expectedYear} as when the next revision is expected`,
);

// The helpers themselves, so the assertions above cannot pass by reading a
// coverage file that has quietly stopped describing anything.
assert.equal(bestTrackDepth({}), null);
assert.equal(bestTrackDepth({ catalog: { year_range: [1851] } }), null);
assert.deepEqual(
  bestTrackDepth({ catalog: { year_range: [2000, 2009], storm_count: 5, landfall_event_count: 7 } }),
  { from: 2000, to: 2009, years: 10, storms: 5, landfalls: 7 },
);
assert.deepEqual(layerDepths({ datasets: [] }), [], 'a coverage file with no datasets claims no depth');
assert.deepEqual(
  layerDepths({ datasets: [{ id: 'radar-archive', label: 'Radar', year_range: [1995, 2025], availability: { storms: 139 } }] }, ['radar-archive']),
  [{ id: 'radar-archive', label: 'Radar', from: 1995, to: 2025, storms: 139 }],
);
assert.deepEqual(
  layerDepths({ datasets: [{ id: 'radar-archive', label: 'Radar', year_range: null }] }, ['radar-archive']),
  [],
  'a dataset with no range states no depth rather than a broken one',
);
assert.equal(nextRevisionExpectation({ sources: [] }), null);
assert.deepEqual(
  nextRevisionExpectation({ sources: [{ source_date: '2020-02-01' }, { source_date: '2026-02-27' }] }),
  { revised: '2026-02-27', expectedYear: 2027, expectedMonth: 2 },
  'the newest revision is the one that matters, and the next is a year on',
);

console.log(
  `coverage claims ok (best track ${best.from}-${best.to}, ${layers.length} shallower layers, `
  + `next revision ${revision.expectedYear})`,
);
