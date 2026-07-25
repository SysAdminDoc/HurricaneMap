// Compatibility versions shared by runtime state, generated data, tests, and
// release gates. A version changes only when its persisted shape becomes
// incompatible; application releases do not automatically bump these values.

export const DATA_SCHEMA_VERSION = 1;
export const SETTINGS_SCHEMA_VERSION = 1;
export const SEARCH_HISTORY_SCHEMA_VERSION = 1;
export const PREP_SCHEMA_VERSION = 1;
export const URL_STATE_VERSION = '1';

export const CACHE_CONTRACT = Object.freeze({
  data: 'hm-data-v2',
  tiles: 'hm-tiles-v1',
  radar: 'hm-radar-v1',
  offlineDb: 'hm-offline-data-v2',
  offlineDbVersion: 1,
  legacyOfflineDbs: Object.freeze(['hm-offline-data-v1']),
});

export function migrateVersionedRecord(record, {
  schemaVersion,
  payloadKey,
  normalize,
}) {
  const fallback = normalize(null);
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { value: fallback, status: 'invalid', shouldPersist: false };
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'schema_version')) {
    return { value: normalize(record), status: 'legacy', shouldPersist: true };
  }
  if (record.schema_version !== schemaVersion) {
    return { value: fallback, status: 'unsupported', shouldPersist: false };
  }
  return {
    value: normalize(record[payloadKey]),
    status: 'current',
    shouldPersist: false,
  };
}

export function createVersionedRecord(schemaVersion, payloadKey, value) {
  return {
    schema_version: schemaVersion,
    [payloadKey]: value,
  };
}

export function assertSupportedDataSchema(metadata) {
  const actual = metadata?.schema_version ?? 'missing';
  if (!metadata || typeof metadata !== 'object' || actual !== DATA_SCHEMA_VERSION) {
    throw new Error(
      `metadata.json schema ${actual} is incompatible with supported schema ${DATA_SCHEMA_VERSION}`,
    );
  }
  return metadata;
}
