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
assert.equal(BILLIONS_DATASET_STATUS.retirement_citation.url, dataset.retirement_citation.url);

console.log('dataset status contracts ok (lifecycle metadata, closed-row gate, and unavailable state)');
