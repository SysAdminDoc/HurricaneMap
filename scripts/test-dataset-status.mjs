import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  validateClosedSeriesRows,
  validateDatasetStatuses,
} from './dataset-status.mjs';
import {
  getBundledDatasetState,
  getBundledDatasetStatus,
} from '../src/optional-feeds.js';
import {
  BILLIONS_DATASET_STATUS,
  isClosedSeries,
  seriesEndYear,
} from '../src/inflation.js';

const metadata = JSON.parse(await readFile('data/metadata.json', 'utf8'));
const billions = JSON.parse(await readFile('data/billions.json', 'utf8'));
const knownPaths = new Set(metadata.datasets.flatMap(dataset => dataset.paths));
assert.deepEqual(validateDatasetStatuses(metadata.datasets, knownPaths), []);

const dataset = getBundledDatasetStatus(metadata, 'ncei-billions');
assert.equal(dataset.status, 'closed');
assert.equal(dataset.end_date, '2024-12-31');
assert.equal(dataset.retirement_citation.date, '2025-05-08');
assert.equal(isClosedSeries(dataset), true);
assert.equal(seriesEndYear(dataset), 2024);
assert.equal(getBundledDatasetState(dataset, true), 'closed');
assert.equal(getBundledDatasetState(dataset, false), 'unavailable');

assert.deepEqual(validateClosedSeriesRows(dataset, {
  AL122005: billions.AL122005,
}), []);
assert.match(
  validateClosedSeriesRows(dataset, {
    AL032025: { begin: '2025-07-06', end: '2025-07-07' },
  })[0],
  /after closed series end_date 2024-12-31/,
);
// src/inflation.js carries a frozen copy of this dataset's lifecycle so the UI
// can render closed-series copy before metadata.json has loaded. Only the
// citation URL was compared, so every other field could drift silently: the
// successor block could be edited or deleted and nothing would notice.
function assertMirrors(mirror, source, path = 'BILLIONS_DATASET_STATUS') {
  assert.ok(source && typeof source === 'object', `${path} has no counterpart in data/metadata.json`);
  assert.deepEqual(
    Object.keys(mirror).sort(),
    Object.keys(source).filter(key => key in mirror).sort(),
    `${path} names a field data/metadata.json does not have`,
  );
  for (const [key, value] of Object.entries(mirror)) {
    if (value && typeof value === 'object') assertMirrors(value, source[key], `${path}.${key}`);
    else assert.equal(value, source[key], `${path}.${key} has drifted from data/metadata.json`);
  }
}
assertMirrors(BILLIONS_DATASET_STATUS, dataset);
// The mirror must also not fall behind: a citation field added to the metadata
// has to be copied across, or the pre-load render quietly omits it.
assert.deepEqual(
  Object.keys(BILLIONS_DATASET_STATUS.retirement_citation).sort(),
  Object.keys(dataset.retirement_citation).sort(),
  'the mirrored retirement citation must carry every field the metadata has',
);
assert.deepEqual(
  Object.keys(BILLIONS_DATASET_STATUS.retirement_citation.successor).sort(),
  Object.keys(dataset.retirement_citation.successor).sort(),
  'the mirrored successor must carry every field the metadata has',
);

console.log('dataset status contracts ok (lifecycle metadata, closed-row gate, and unavailable state)');
