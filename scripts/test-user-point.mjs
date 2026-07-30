import assert from 'node:assert/strict';
import {
  LEGACY_USER_POINT_KEY,
  USER_POINT_PERSISTED_KEY,
  USER_POINT_RETENTION_MS,
  USER_POINT_SCHEMA_VERSION,
  USER_POINT_SESSION_KEY,
  clearUserPoint,
  loadUserPoint,
  saveUserPoint,
} from '../src/user-point.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class WriteBlockedStorage extends MemoryStorage {
  setItem() { throw new Error('storage blocked'); }
}

const now = Date.UTC(2026, 6, 29);
const localStore = new MemoryStorage({
  [LEGACY_USER_POINT_KEY]: JSON.stringify({ lat: 25, lon: -80 }),
});
const sessionStore = new MemoryStorage();

assert.equal(loadUserPoint({ localStore, sessionStore, now }), null);
assert.equal(localStore.getItem(LEGACY_USER_POINT_KEY), null, 'legacy indefinite coordinates must be purged');

saveUserPoint(25.75, -80.2, { localStore, sessionStore, now });
assert.deepEqual(loadUserPoint({ localStore, sessionStore, now }), {
  lat: 25.75,
  lon: -80.2,
  retention: 'session',
  expires_at: null,
});
assert.equal(localStore.getItem(USER_POINT_PERSISTED_KEY), null, 'session-default location leaked into localStorage');
assert.equal(JSON.parse(sessionStore.getItem(USER_POINT_SESSION_KEY)).schema_version, USER_POINT_SCHEMA_VERSION);

const remembered = saveUserPoint(18.47, -66.1, { remember: true, localStore, sessionStore, now });
assert.equal(remembered.expires_at, now + USER_POINT_RETENTION_MS);
assert.equal(sessionStore.getItem(USER_POINT_SESSION_KEY), null);
assert.deepEqual(loadUserPoint({ localStore, sessionStore, now: now + 1000 }), remembered);
assert.equal(loadUserPoint({ localStore, sessionStore, now: now + USER_POINT_RETENTION_MS }), null);
assert.equal(localStore.getItem(USER_POINT_PERSISTED_KEY), null, 'expired location was not removed');

assert.throws(
  () => saveUserPoint(91, -80, { localStore, sessionStore, now }),
  /outside valid latitude\/longitude bounds/,
);

const blockedLocal = new WriteBlockedStorage();
const fallbackSession = new MemoryStorage();
const fallback = saveUserPoint(30, -75, {
  remember: true,
  localStore: blockedLocal,
  sessionStore: fallbackSession,
  now,
});
assert.equal(fallback.retention, 'session');
assert.equal(JSON.parse(fallbackSession.getItem(USER_POINT_SESSION_KEY)).lat, 30);
clearUserPoint({ localStore: blockedLocal, sessionStore: fallbackSession });

localStore.setItem(USER_POINT_PERSISTED_KEY, JSON.stringify({
  schema_version: USER_POINT_SCHEMA_VERSION + 1,
  lat: 25,
  lon: -80,
  expires_at: now + USER_POINT_RETENTION_MS,
}));
assert.equal(loadUserPoint({ localStore, sessionStore, now }), null);
assert.notEqual(localStore.getItem(USER_POINT_PERSISTED_KEY), null, 'unknown future location schema should remain untouched');

clearUserPoint({ localStore, sessionStore });
assert.equal(localStore.getItem(USER_POINT_PERSISTED_KEY), null);
assert.equal(sessionStore.getItem(USER_POINT_SESSION_KEY), null);

console.log('user point storage ok (session default, 24-hour opt-in, legacy purge, expiry)');
