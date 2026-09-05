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
// Below the top level the mirror copies whole subtrees, so the key sets have to
// match exactly in both directions. A one-directional check let a field added
// to the metadata pass unnoticed, which is the drift that matters: the pre-load
// render silently omits what it was never given.
function assertMirrors(mirror, source, path = 'BILLIONS_DATASET_STATUS') {
  assert.ok(source && typeof source === 'object', `${path} has no counterpart in data/metadata.json`);
  assert.equal(
    Array.isArray(mirror),
    Array.isArray(source),
    `${path}: one side is an array and the other is not`,
  );
  assert.deepEqual(
    Object.keys(mirror).sort(),
    Object.keys(source).sort(),
    `${path}: the mirror and data/metadata.json do not carry the same fields`,
  );
  for (const [key, value] of Object.entries(mirror)) {
    if (value !== null && typeof value === 'object') assertMirrors(value, source[key], `${path}.${key}`);
    else assert.equal(value, source[key], `${path}.${key} has drifted from data/metadata.json`);
  }
}
// The top level is the one place the mirror is deliberately a subset: it copies
// the lifecycle and leaves the paths and label to the metadata. Pinning the
// whole key set means a new field cannot be added to either side without a
// decision about whether the UI needs it before the data has loaded.
const MIRRORED_FIELDS = ['end_date', 'id', 'retirement_citation', 'status'];
const UNMIRRORED_FIELDS = ['label', 'paths'];
assert.deepEqual(
  Object.keys(BILLIONS_DATASET_STATUS).sort(),
  MIRRORED_FIELDS,
  'src/inflation.js mirrors a different set of lifecycle fields than this test expects',
);
assert.deepEqual(
  Object.keys(dataset).sort(),
  [...MIRRORED_FIELDS, ...UNMIRRORED_FIELDS].sort(),
  'the ncei-billions dataset gained or lost a field; mirror it in src/inflation.js or list it as unmirrored here',
);
for (const field of MIRRORED_FIELDS) {
  const value = BILLIONS_DATASET_STATUS[field];
  if (value !== null && typeof value === 'object') assertMirrors(value, dataset[field], `BILLIONS_DATASET_STATUS.${field}`);
  else assert.equal(value, dataset[field], `BILLIONS_DATASET_STATUS.${field} has drifted from data/metadata.json`);
}

console.log('dataset status contracts ok (lifecycle metadata, closed-row gate, and unavailable state)');
