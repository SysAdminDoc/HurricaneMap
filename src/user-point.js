export const USER_POINT_SCHEMA_VERSION = 2;
export const USER_POINT_SESSION_KEY = 'hm-user-point-session-v2';
export const USER_POINT_PERSISTED_KEY = 'hm-user-point-v2';
export const LEGACY_USER_POINT_KEY = 'hm-user-point-v1';
export const USER_POINT_RETENTION_MS = 24 * 60 * 60 * 1000;
let memoryPoint = null;

function validPoint(lat, lon) {
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
}

function readRecord(storage, key, { now, persistent }) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw);
    if (record?.schema_version !== USER_POINT_SCHEMA_VERSION) return null;
    if (!validPoint(record.lat, record.lon)) {
      storage.removeItem(key);
      return null;
    }
    if (persistent && (!Number.isFinite(record.expires_at) || record.expires_at <= now)) {
      storage.removeItem(key);
      return null;
    }
    return {
      lat: record.lat,
      lon: record.lon,
      retention: persistent ? 'device' : 'session',
      expires_at: persistent ? record.expires_at : null,
    };
  } catch {
    return null;
  }
}

export function purgeLegacyUserPoint(localStore = globalThis.localStorage) {
  try {
    localStore?.removeItem(LEGACY_USER_POINT_KEY);
  } catch {
    // Storage can be unavailable in private or policy-restricted contexts.
  }
}

export function loadUserPoint({
  localStore = globalThis.localStorage,
  sessionStore = globalThis.sessionStorage,
  now = Date.now(),
} = {}) {
  purgeLegacyUserPoint(localStore);
  if (memoryPoint?.retention === 'device' && memoryPoint.expires_at <= now) memoryPoint = null;
  return readRecord(sessionStore, USER_POINT_SESSION_KEY, { now, persistent: false }) ||
    readRecord(localStore, USER_POINT_PERSISTED_KEY, { now, persistent: true }) ||
    memoryPoint;
}

export function saveUserPoint(lat, lon, {
  remember = false,
  localStore = globalThis.localStorage,
  sessionStore = globalThis.sessionStorage,
  now = Date.now(),
} = {}) {
  if (!validPoint(lat, lon)) throw new TypeError('User point coordinates are outside valid latitude/longitude bounds.');
  purgeLegacyUserPoint(localStore);
  const base = { schema_version: USER_POINT_SCHEMA_VERSION, lat, lon };
  if (remember) {
    try {
      localStore?.setItem(USER_POINT_PERSISTED_KEY, JSON.stringify({
        ...base,
        expires_at: now + USER_POINT_RETENTION_MS,
      }));
      sessionStore?.removeItem(USER_POINT_SESSION_KEY);
      memoryPoint = { lat, lon, retention: 'device', expires_at: now + USER_POINT_RETENTION_MS };
      return memoryPoint;
    } catch {
      // A blocked localStorage write falls through to session-only retention.
    }
  }
  try {
    sessionStore?.setItem(USER_POINT_SESSION_KEY, JSON.stringify(base));
    localStore?.removeItem(USER_POINT_PERSISTED_KEY);
  } catch {
    // The in-memory fallback below still supports this tab without persistence.
  }
  memoryPoint = { lat, lon, retention: 'session', expires_at: null };
  return memoryPoint;
}

export function clearUserPoint({
  localStore = globalThis.localStorage,
  sessionStore = globalThis.sessionStorage,
} = {}) {
  memoryPoint = null;
  for (const [storage, keys] of [
    [localStore, [LEGACY_USER_POINT_KEY, USER_POINT_PERSISTED_KEY]],
    [sessionStore, [USER_POINT_SESSION_KEY]],
  ]) {
    try {
      for (const key of keys) storage?.removeItem(key);
    } catch {
      // Best effort in storage-restricted contexts.
    }
  }
}
