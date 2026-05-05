import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getStormEventRecord,
  renderStormEventsHtml,
} from '../src/storm-events.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(await readFile(path.join(root, 'data/storm-events.json'), 'utf8'));

assert.equal(data.schema_version, 1);
assert.ok(data.source?.name?.includes('Storm Events'));
assert.ok(data.methodology?.window_before_hours >= 0);
assert.ok(data.methodology?.window_after_hours >= 0);
assert.ok(Object.keys(data.storms).length > 0, 'expected at least one storm-events aggregate');

const sampleId = Object.keys(data.storms)[0];
const sample = getStormEventRecord(data, sampleId);
assert.ok(Number.isInteger(sample.tornado_count));
assert.ok(Number.isInteger(sample.hail_count));
assert.ok(Array.isArray(sample.states));

const html = renderStormEventsHtml({ id: sampleId, year: 2005 }, sample, data);
assert.match(html, /Storm Events near landfall/);
assert.match(html, /Tornado activity during landfall/);
assert.match(html, /Hail activity during landfall/);

const oldHtml = renderStormEventsHtml({ id: 'AL011851', year: 1851 }, null, data);
assert.match(oldHtml, /begin in 1950/);

console.log('storm events ok');
