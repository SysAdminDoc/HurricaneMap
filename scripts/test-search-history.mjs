import assert from 'node:assert/strict';

import { escapeHtml } from '../src/html-utils.js';
import { migrateHistoryRecord, normalizeHistoryEntry } from '../src/search-history.js';

const normalized = normalizeHistoryEntry({
  storm_id: 'AL122005\u0000',
  name: '<img src=x onerror=alert(1)>',
  year: '2005',
  category: '99',
  state: 'Louisiana',
  t: '2005-08-29T11:10:00Z',
  lat: '29.3',
  lon: '-89.6',
});

assert.equal(normalized.storm_id, 'AL122005');
assert.equal(normalized.year, 2005);
assert.equal(normalized.category, -1);
assert.equal(normalized.lat, 29.3);
assert.equal(normalized.lon, -89.6);
assert.equal(escapeHtml(normalized.name), '&lt;img src=x onerror=alert(1)&gt;');

assert.equal(normalizeHistoryEntry({ storm_id: 'AL122005', year: 2005, lat: 'bad', lon: -89.6 }), null);
assert.equal(normalizeHistoryEntry({ storm_id: 'AL122005', year: 1799, lat: 29.3, lon: -89.6 }), null);
assert.equal(normalizeHistoryEntry(null), null);

const legacy = migrateHistoryRecord([normalized, { storm_id: '', year: 2005, lat: 1, lon: 1 }]);
assert.equal(legacy.status, 'legacy');
assert.equal(legacy.shouldPersist, true);
assert.deepEqual(legacy.value, [normalized]);

const future = migrateHistoryRecord({ schema_version: 999, entries: [normalized] });
assert.equal(future.status, 'unsupported');
assert.equal(future.shouldPersist, false);
assert.deepEqual(future.value, []);

console.log('search history ok');
