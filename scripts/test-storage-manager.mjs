import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import {
  MAX_RADAR_PACK_FRAMES,
  SOURCE_BUNDLE_ASSETS,
  SOURCE_BUNDLE_CACHE,
  cacheSourceBundle,
  cacheRadarPack,
  clearOptionalStorageScope,
  formatStorageBytes,
  inspectStorage,
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
    keys: async () => ['hm-shell-hm-v1.9.1'],
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
assert.equal((await successfulCaches.open('hm-radar-v1')).values.size, 3);
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
quotaCaches.caches.set('hm-radar-v1', new FakeCache({ failAt: 2 }));
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
assert.equal((await quotaCaches.open('hm-radar-v1')).values.size, 0, 'failed pack must roll back only its new radar frames');
assert.ok(core.values.has('data/storms.json.gz'), 'quota rollback must preserve required historical data');

await assert.rejects(
  clearOptionalStorageScope('data', { cachesApi: successfulCaches }),
  /Required storage scope cannot be cleared/,
);
await clearOptionalStorageScope('radar', { cachesApi: successfulCaches, packStorage: null });
assert.equal((await successfulCaches.keys()).includes('hm-radar-v1'), false);
await clearOptionalStorageScope('source', { cachesApi: sourceCaches });
assert.equal((await sourceCaches.keys()).includes(SOURCE_BUNDLE_CACHE), false);

console.log('storage manager ok (quota rollback, required-data guard, bounded radar/source packs)');
