import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import {
  MAX_RADAR_PACK_FRAMES,
  RADAR_PACK_CACHE,
  activeCacheNames,
  compareCacheNames,
  selectCacheName,
  SOURCE_BUNDLE_ASSETS,
  SOURCE_BUNDLE_CACHE,
  cacheSourceBundle,
  cacheRadarPack,
  clearOptionalStorageScope,
  formatStorageBytes,
  hasOptionalOfflineData,
  inspectStorage,
  renderStorageManager,
  requestStoragePersistence,
  inspectRadarFrameCache,
  isQuotaExceededError,
  selectBoundedRadarFrames,
  summarizeStorageEstimate,
} from '../src/storage-manager.js';

globalThis.crypto ||= webcrypto;

assert.equal(formatStorageBytes(0), '0 B');
assert.equal(formatStorageBytes(1536), '1.5 KB');
assert.equal(formatStorageBytes(25 * 1024 * 1024), '25 MB');
assert.deepEqual(summarizeStorageEstimate({ usage: 25, quota: 100 }), { usage: 25, quota: 100, percent: 25 });
assert.equal(isQuotaExceededError({ name: 'QuotaExceededError' }), true);

const inspected = await inspectStorage({
  storageApi: {
    estimate: async () => ({ usage: 10, quota: 100 }),
    persisted: async () => true,
  },
  cachesApi: {
    keys: async () => ['hm-shell-hm-v1.9.3'],
    open: async () => ({
      keys: async () => [new Request('https://example.test/index.html')],
      match: async () => new Response('12345', { headers: { 'content-length': '5' } }),
    }),
  },
  packStorage: null,
});
assert.equal(inspected.persisted, true);
assert.equal(inspected.scopes.find(scope => scope.id === 'shell').sizeBytes, 5);

const manyFrames = Array.from({ length: 300 }, (_, index) => ({
  url: `data/radar/Test/frame-${String(index).padStart(3, '0')}.png`,
}));
const bounded = selectBoundedRadarFrames(manyFrames);
assert.equal(bounded.length, MAX_RADAR_PACK_FRAMES);
assert.equal(bounded[0].url, manyFrames[0].url);
assert.equal(bounded.at(-1).url, manyFrames.at(-1).url);

class FakeCache {
  constructor({ failAt = Infinity } = {}) {
    this.values = new Map();
    this.puts = 0;
    this.failAt = failAt;
  }
  async match(url) { return this.values.get(url); }
  async put(url, response) {
    this.puts += 1;
    if (this.puts === this.failAt) {
      const error = new Error('quota full');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.values.set(url, response);
  }
  async delete(url) { return this.values.delete(url); }
  async keys() { return [...this.values.keys()].map(url => new Request(`https://example.test/${url}`)); }
}

class FakeCaches {
  constructor() { this.caches = new Map(); }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async keys() { return [...this.caches.keys()]; }
  async delete(name) { return this.caches.delete(name); }
}

const successfulCaches = new FakeCaches();
const saved = await cacheRadarPack('AL012026', manyFrames.slice(0, 3), {
  cachesApi: successfulCaches,
  fetchImpl: async () => new Response('frame'),
  storageApi: { estimate: async () => ({ usage: 10, quota: 1_000_000 }) },
  packStorage: null,
});
assert.equal(saved.saved, 3);
// Was hm-radar-v1. That is the service worker's 240-entry LRU, and a pack holds
// up to 120 frames, so a third pack evicted the first one's while the index
// still listed it as saved. The assertion moved because the behaviour it names
// is the defect.
assert.equal((await successfulCaches.open(RADAR_PACK_CACHE)).values.size, 3);
assert.equal(
  (await successfulCaches.open('hm-radar-v1')).values.size,
  0,
  'a deliberately saved pack must not be written into the cache the worker trims',
);
const radarCacheState = await inspectRadarFrameCache(
  [...manyFrames.slice(0, 3), { url: 'data/radar/Test/not-cached.png' }],
  { cachesApi: successfulCaches },
);
assert.deepEqual(
  { state: radarCacheState.state, cached: radarCacheState.cached, total: radarCacheState.total },
  { state: 'partial', cached: 3, total: 4 },
);
const emptyRadarCacheState = await inspectRadarFrameCache(manyFrames.slice(0, 1), { cachesApi: new FakeCaches() });
assert.equal(emptyRadarCacheState.state, 'empty');

// Three full packs, then enough browsing to empty the LRU entirely. Every pack
// still reads complete, because none of its frames were in the LRU to lose.
const packCaches = new FakeCaches();
const packOf = id => Array.from({ length: MAX_RADAR_PACK_FRAMES }, (_, index) => ({
  url: `data/radar/${id}/t_${String(index).padStart(4, '0')}.png`,
}));
const packIds = ['AL012026', 'AL022026', 'AL032026'];
for (const id of packIds) {
  const result = await cacheRadarPack(id, packOf(id), {
    cachesApi: packCaches,
    fetchImpl: async () => new Response('frame'),
    storageApi: { estimate: async () => ({ usage: 10, quota: 1_000_000_000 }) },
    packStorage: null,
  });
  assert.equal(result.saved, MAX_RADAR_PACK_FRAMES, `${id} did not save every frame`);
}
const browsingLru = await packCaches.open('hm-radar-v1');
for (const frame of [...packOf('AL042026'), ...packOf('AL052026')]) {
  await browsingLru.put(frame.url, new Response('frame'));
}
// What the service worker's trim does, taken to its limit.
browsingLru.values.clear();
for (const id of packIds) {
  const state = await inspectRadarFrameCache(packOf(id), { cachesApi: packCaches });
  assert.deepEqual(
    { id, state: state.state, cached: state.cached },
    { id, state: 'complete', cached: MAX_RADAR_PACK_FRAMES },
    `${id} lost frames to radar browsing`,
  );
}

// A frame the reader only browsed past is still reported as held: the two
// caches are read together, so moving the packs did not narrow what counts.
const browsedOnly = new FakeCaches();
const browsedCache = await browsedOnly.open('hm-radar-v1');
await browsedCache.put(manyFrames[0].url, new Response('frame'));
assert.equal(
  (await inspectRadarFrameCache([manyFrames[0]], { cachesApi: browsedOnly })).state,
  'complete',
  'a frame in the browsing cache must still count as cached',
);

// Clearing the radar scope clears both caches, or "Clear" would leave behind
// the larger half of what the panel had just counted.
assert.equal(
  await clearOptionalStorageScope('radar', { cachesApi: packCaches, packStorage: null, notify: false }),
  true,
);
assert.deepEqual(
  (await packCaches.keys()).filter(name => name.startsWith('hm-radar')),
  [],
  'clearing radar must remove the saved packs as well as the browsing cache',
);

const sourceBodies = new Map([
  [SOURCE_BUNDLE_ASSETS[0], 'atlantic source'],
  [SOURCE_BUNDLE_ASSETS[1], 'nepac source'],
]);
const sourceManifest = JSON.stringify({
  schema_version: 1,
  generated_at_utc: '2026-08-02T00:00:00Z',
  source_commit: '0123456789abcdef0123456789abcdef01234567',
  algorithm: 'SHA-256',
  artifacts: [...sourceBodies.entries()].map(([path, body]) => ({
    path: new URL(path, 'https://example.test/').pathname.replace(/^\//, ''),
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
    source_url: 'https://example.test/source',
    source_date: '2026-08-02',
    schema_version: 'HURDAT2-current',
  })),
});
const sourceCaches = new FakeCaches();
const sourceResult = await cacheSourceBundle({
  cachesApi: sourceCaches,
  fetchImpl: async asset => new Response(asset.endsWith('release-manifest.json') ? sourceManifest : sourceBodies.get(asset)),
  storageApi: { estimate: async () => ({ usage: 10, quota: 1_000_000 }) },
});
assert.equal(sourceResult.saved, 3);
assert.equal(sourceResult.bytes, Buffer.byteLength(sourceBodies.get(SOURCE_BUNDLE_ASSETS[0])) + Buffer.byteLength(sourceBodies.get(SOURCE_BUNDLE_ASSETS[1])) + Buffer.byteLength(sourceManifest));
assert.equal((await sourceCaches.open(SOURCE_BUNDLE_CACHE)).values.size, 4, 'source pack must include its integrity marker');

const quotaCaches = new FakeCaches();
quotaCaches.caches.set(RADAR_PACK_CACHE, new FakeCache({ failAt: 2 }));
const core = await quotaCaches.open('hm-data-v2');
core.values.set('data/storms.json.gz', new Response('required'));
await assert.rejects(
  cacheRadarPack('AL022026', manyFrames.slice(0, 3), {
    cachesApi: quotaCaches,
    fetchImpl: async () => new Response('frame'),
    storageApi: { estimate: async () => ({ usage: 10, quota: 1_000_000 }) },
    packStorage: null,
  }),
  error => error.name === 'QuotaExceededError',
);
assert.equal((await quotaCaches.open(RADAR_PACK_CACHE)).values.size, 0, 'failed pack must roll back only its new radar frames');
assert.ok(core.values.has('data/storms.json.gz'), 'quota rollback must preserve required historical data');

await assert.rejects(
  clearOptionalStorageScope('data', { cachesApi: successfulCaches }),
  /Required storage scope cannot be cleared/,
);
await clearOptionalStorageScope('radar', { cachesApi: successfulCaches, packStorage: null });
assert.equal((await successfulCaches.keys()).includes('hm-radar-v1'), false);
await clearOptionalStorageScope('source', { cachesApi: sourceCaches });
assert.equal((await sourceCaches.keys()).includes(SOURCE_BUNDLE_CACHE), false);

// Persistence is requested where there is finally something to protect.
function persistenceApi({ already = false, grant = true, throws = false, supported = true } = {}) {
  const calls = [];
  const api = {
    estimate: async () => ({ usage: 10, quota: 1_000_000 }),
    persisted: async () => already,
  };
  if (supported) {
    api.persist = async () => {
      calls.push('persist');
      if (throws) throw new Error('denied');
      return grant;
    };
  }
  return { api, calls };
}

const granted = persistenceApi({ grant: true });
assert.deepEqual(await requestStoragePersistence(granted.api), { supported: true, persisted: true, timedOut: false });
assert.deepEqual(granted.calls, ['persist']);

const denied = persistenceApi({ grant: false });
assert.deepEqual(await requestStoragePersistence(denied.api), { supported: true, persisted: false, timedOut: false });

const alreadyPersisted = persistenceApi({ already: true });
assert.deepEqual(await requestStoragePersistence(alreadyPersisted.api), { supported: true, persisted: true });
assert.deepEqual(alreadyPersisted.calls, [], 'an origin that is already persistent must not be asked again');

const throwing = persistenceApi({ throws: true });
assert.deepEqual(await requestStoragePersistence(throwing.api), { supported: true, persisted: false }, 'a rejected persist must not escape');

// Firefox answers persist() from a doorhanger the user may never touch.
const neverAnswers = { estimate: async () => ({}), persisted: async () => false, persist: () => new Promise(() => {}) };
const pendingStart = Date.now();
assert.deepEqual(
  await requestStoragePersistence(neverAnswers, { timeoutMs: 40 }),
  { supported: true, persisted: false, timedOut: true },
  'an unanswered prompt must resolve as a refusal, not hang the save',
);
assert.ok(Date.now() - pendingStart < 2000, 'the persistence prompt must not block the save');

assert.deepEqual(await requestStoragePersistence(undefined), { supported: false, persisted: false });
assert.deepEqual(await requestStoragePersistence(persistenceApi({ supported: false }).api), { supported: false, persisted: false });

const radarPersistence = persistenceApi({ grant: true });
const persistedPack = await cacheRadarPack('AL032026', manyFrames.slice(0, 2), {
  cachesApi: new FakeCaches(),
  fetchImpl: async () => new Response('frame'),
  storageApi: radarPersistence.api,
  packStorage: null,
});
assert.equal(persistedPack.persisted, true, 'saving a radar pack must request persistence');
assert.deepEqual(radarPersistence.calls, ['persist']);

const refusedPersistence = persistenceApi({ grant: false });
const unprotectedPack = await cacheRadarPack('AL042026', manyFrames.slice(0, 2), {
  cachesApi: new FakeCaches(),
  fetchImpl: async () => new Response('frame'),
  storageApi: refusedPersistence.api,
  packStorage: null,
});
assert.equal(unprotectedPack.saved, 2, 'a refusal must not abort the save');
assert.equal(unprotectedPack.persisted, false);

const bundlePersistence = persistenceApi({ grant: true });
const bundleCaches = new FakeCaches();
const bundle = await cacheSourceBundle({
  cachesApi: bundleCaches,
  fetchImpl: async asset => new Response(asset.endsWith('release-manifest.json') ? sourceManifest : sourceBodies.get(asset)),
  storageApi: bundlePersistence.api,
});
assert.equal(bundle.persisted, true, 'saving the source bundle must request persistence');
assert.deepEqual(bundlePersistence.calls, ['persist']);

// The eviction warning is driven by "there is evictable data", not by catching
// the moment of refusal, so a reopened panel still shows it.
assert.equal(hasOptionalOfflineData({ scopes: [{ id: 'shell', required: true, entries: 40 }], packs: {} }), false);
assert.equal(hasOptionalOfflineData({ scopes: [{ id: 'radar', required: false, entries: 0 }], packs: {} }), false);
assert.equal(hasOptionalOfflineData({ scopes: [{ id: 'radar', required: false, entries: 12 }], packs: {} }), true);
assert.equal(hasOptionalOfflineData({ scopes: [], packs: { AL012026: { frames: 4 } } }), true);
assert.equal(hasOptionalOfflineData(undefined), false);

// The warning has to actually render, not merely be computable.
function renderWith(snapshot) {
  const host = { innerHTML: '' };
  return renderStorageManager(host, { inspect: async () => snapshot }).then(() => host.innerHTML);
}
const baseSnapshot = {
  usage: 1024,
  quota: 1_000_000,
  percent: 1,
  scopes: [
    { id: 'shell', required: true, entries: 40, sizeBytes: 100, cacheName: 'hm-shell-x' },
    { id: 'radar', required: false, entries: 0, sizeBytes: 0, cacheName: 'hm-radar-v1' },
  ],
  release: { state: 'intact' },
  packs: {},
};
const savedRadar = {
  ...baseSnapshot,
  scopes: baseSnapshot.scopes.map(scope => scope.id === 'radar' ? { ...scope, entries: 12, sizeBytes: 4096 } : scope),
};
const evictionText = 'storage-eviction-risk';
assert.equal((await renderWith({ ...baseSnapshot, persisted: false })).includes(evictionText), false, 'no saved optional data, no warning');
assert.equal((await renderWith({ ...savedRadar, persisted: true })).includes(evictionText), false, 'persistence granted, no warning');
const warned = await renderWith({ ...savedRadar, persisted: false });
assert.equal(warned.includes(evictionText), true, 'saved data plus a refusal must warn');
assert.equal(warned.includes('role="status"'), true, 'the warning must be announced');
assert.equal((await renderWith({ ...savedRadar, persisted: false, packs: { AL012026: {} } })).includes(evictionText), true);

// Cache names carry a version, and a plain string sort ranks 1.9.3 above
// 1.10.0 because "9" sorts after "1". The panel would have reported on the
// wrong release for every version from 1.10.0 onwards.
assert.deepEqual(
  ['hm-shell-hm-v1.9.3', 'hm-shell-hm-v1.10.0', 'hm-shell-hm-v1.2.0'].sort(compareCacheNames),
  ['hm-shell-hm-v1.2.0', 'hm-shell-hm-v1.9.3', 'hm-shell-hm-v1.10.0'],
);
assert.deepEqual(
  ['hm-data-hm-v2.0.0', 'hm-data-hm-v10.0.0'].sort(compareCacheNames),
  ['hm-data-hm-v2.0.0', 'hm-data-hm-v10.0.0'],
);
assert.deepEqual(['hm-tiles-v2', 'hm-tiles-v10'].sort(compareCacheNames), ['hm-tiles-v2', 'hm-tiles-v10']);
assert.deepEqual(['b-cache', 'a-cache'].sort(compareCacheNames), ['a-cache', 'b-cache'], 'unversioned names still order stably');

const shellScope = { id: 'shell', prefix: 'hm-shell-' };
const shellCaches = ['hm-shell-hm-v1.9.3', 'hm-shell-hm-v1.10.0'];
assert.equal(selectCacheName(shellCaches, shellScope, {}), 'hm-shell-hm-v1.10.0');

// An install that fails after opening its caches leaves a versioned pair for a
// version that never activates, and only that version's activate would clean
// them up. The old worker keeps serving correctly while the panel inspects the
// broken tuple and calls the release unverified.
assert.equal(
  selectCacheName(shellCaches, shellScope, { shell: 'hm-shell-hm-v1.9.3' }),
  'hm-shell-hm-v1.9.3',
  'the cache the running worker named must win over the highest version present',
);
assert.equal(
  selectCacheName(shellCaches, shellScope, { shell: 'hm-shell-hm-v1.4.0' }),
  'hm-shell-hm-v1.10.0',
  'a claim for a cache that is not there falls back to the newest one that is',
);
assert.equal(selectCacheName([], shellScope, { shell: 'hm-shell-hm-v1.9.3' }), null);

assert.deepEqual(activeCacheNames({}), { shell: null, data: null });
assert.deepEqual(
  activeCacheNames({ activeShellCache: 'hm-shell-hm-v1.9.3', activeDataCache: 'hm-data-hm-v1.9.3' }),
  { shell: 'hm-shell-hm-v1.9.3', data: 'hm-data-hm-v1.9.3' },
);

// End to end: the panel inspects the tuple the worker is serving, not the
// leftovers of the install that failed.
const versionedCaches = new FakeCaches();
for (const name of ['hm-shell-hm-v1.9.3', 'hm-shell-hm-v1.10.0', 'hm-data-hm-v1.9.3', 'hm-data-hm-v1.10.0']) {
  await versionedCaches.open(name);
}
const servingCache = await versionedCaches.open('hm-data-hm-v1.9.3');
servingCache.values.set('./__hurricanemap-release.json', new Response(JSON.stringify({
  shell_cache: 'hm-shell-hm-v1.9.3',
  data_cache: 'hm-data-hm-v1.9.3',
  sw_version: 'hm-v1.9.3',
})));
const servedSnapshot = await inspectStorage({
  cachesApi: versionedCaches,
  storageApi: null,
  packStorage: null,
  active: { shell: 'hm-shell-hm-v1.9.3', data: 'hm-data-hm-v1.9.3' },
});
assert.equal(servedSnapshot.release.state, 'coherent', 'the running release must read as coherent');
assert.equal(servedSnapshot.scopes.find(scope => scope.id === 'shell').cacheName, 'hm-shell-hm-v1.9.3');

const guessedSnapshot = await inspectStorage({
  cachesApi: versionedCaches,
  storageApi: null,
  packStorage: null,
  active: { shell: null, data: null },
});
assert.equal(
  guessedSnapshot.release.state,
  'unverified',
  'guessing the newest caches must be what reports the half-installed tuple, or the fix above proves nothing',
);

console.log('storage manager ok (quota rollback, required-data guard, bounded radar/source packs, persistence on save, active release tuple over the newest one present)');
