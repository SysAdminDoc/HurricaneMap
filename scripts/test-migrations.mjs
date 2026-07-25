import assert from 'node:assert/strict';
import {
  CACHE_CONTRACT,
  DATA_SCHEMA_VERSION,
  PREP_SCHEMA_VERSION,
  SAVED_VIEWS_SCHEMA_VERSION,
  SEARCH_HISTORY_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  URL_STATE_VERSION,
  assertSupportedDataSchema,
  createVersionedRecord,
} from '../src/schema-contract.js';

assert.equal(DATA_SCHEMA_VERSION, 1);
assert.equal(SETTINGS_SCHEMA_VERSION, 1);
assert.equal(SEARCH_HISTORY_SCHEMA_VERSION, 1);
assert.equal(PREP_SCHEMA_VERSION, 1);
assert.equal(SAVED_VIEWS_SCHEMA_VERSION, 1);
assert.equal(URL_STATE_VERSION, '1');
assert.deepEqual(createVersionedRecord(1, 'state', { safe: true }), {
  schema_version: 1,
  state: { safe: true },
});
assert.deepEqual(CACHE_CONTRACT.legacyOfflineDbs, ['hm-offline-data-v1']);
assert.doesNotThrow(() => assertSupportedDataSchema({ schema_version: DATA_SCHEMA_VERSION }));
assert.throws(
  () => assertSupportedDataSchema({ schema_version: DATA_SCHEMA_VERSION + 1 }),
  /incompatible with supported schema/,
);
assert.throws(
  () => assertSupportedDataSchema({ generated_at: '2026-07-25' }),
  /schema missing is incompatible/,
);
assert.equal(new Set([
  CACHE_CONTRACT.data,
  CACHE_CONTRACT.tiles,
  CACHE_CONTRACT.radar,
  CACHE_CONTRACT.offlineDb,
]).size, 4);

console.log('migration schema contract ok');
