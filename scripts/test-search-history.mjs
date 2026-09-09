import assert from 'node:assert/strict';

import { escapeHtml } from '../src/html-utils.js';
import {
  clearHistory,
  getHistory,
  migrateHistoryRecord,
  normalizeHistoryEntry,
  recordView,
} from '../src/search-history.js';

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

// ------------------------------------------------------------ clearing it
//
// The recents were the one piece of reader-generated state with no delete
// control. Driven against the real storage path rather than the pure
// normalisers, because what has to be true afterwards is that nothing is left
// on the device for the next load to read.
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
  };
  const KEY = 'hm-search-history-v1';

  recordView({ storm_id: 'AL122005', name: 'KATRINA', year: 2005, category: 5, state: 'Louisiana', t: '2005-08-29T11:10:00Z', lat: 29.3, lon: -89.6 });
  recordView({ storm_id: 'AL092022', name: 'IAN', year: 2022, category: 4, state: 'Florida', t: '2022-09-28T19:05:00Z', lat: 26.7, lon: -82.2 });
  assert.equal(getHistory().length, 2, 'the two viewed storms must be on the device to begin with');
  assert.ok(store.get(KEY), 'the record must exist to begin with');

  clearHistory();
  assert.deepEqual(getHistory(), [], 'clearing must leave no recents to read');
  // The record is gone, not rewritten empty: an empty versioned record still
  // says this device kept a search history.
  assert.equal(store.has(KEY), false, 'clearing must remove the record, not empty it');

  // The next load reads a device with nothing on it, which is what "persists
  // across a reload" means for a store this side of the browser.
  assert.deepEqual(getHistory(), []);

  // Clearing an empty store is not an error, and viewing a storm afterwards
  // starts a fresh history rather than restoring the old one.
  clearHistory();
  assert.deepEqual(getHistory(), []);
  recordView({ storm_id: 'AL142024', name: 'MILTON', year: 2024, category: 3, state: 'Florida', t: '2024-10-10T00:30:00Z', lat: 27.2, lon: -82.5 });
  assert.deepEqual(getHistory().map(entry => entry.storm_id), ['AL142024'], 'the cleared entries must not come back');

  // Storage that throws on every access is what a locked-down browser looks
  // like. Clearing has to be a no-op there, not an exception into the click
  // handler.
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  clearHistory();
  assert.deepEqual(getHistory(), []);
  delete globalThis.localStorage;
}

console.log('search history ok');
