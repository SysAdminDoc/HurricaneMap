// HurricaneMap service worker.
//
// Strategy:
//   - Static shell (HTML/CSS/JS, manifest, favicon)  → cache-first, revalidate.
//   - Historical data (JSON/GeoJSON/TXT)              -> compressed IndexedDB,
//     stale-while-revalidate, with CacheStorage fallback.
//   - Local radar PNGs                                → cache-first on demand;
//     not preinstalled because the archive is intentionally large.
//   - Source bundle (raw HURDAT2 + release manifest)  → cache-first only after
//     an explicit user action; the bounded pack is never part of the core.
//   - Map tiles (OpenStreetMap)                      → stale-while-revalidate,
//     capped at TILE_CACHE_MAX_ENTRIES (oldest evicted first).
//   - Everything else                                → network-first, fall back to cache.
//
// Bump SW_VERSION on every release to flush the static shell.

const SW_VERSION = 'hm-v1.9.3';
const SHELL_CACHE = `hm-shell-${SW_VERSION}`;
const DATA_CACHE_PREFIX = 'hm-data-';
const DATA_CACHE = `${DATA_CACHE_PREFIX}${SW_VERSION}`;
const TILE_CACHE = 'hm-tiles-v2';
const RADAR_CACHE = 'hm-radar-v1';
const SOURCE_BUNDLE_CACHE = 'hm-source-bundle-v1';
const SOURCE_BUNDLE_MARKER_PATH = './__hurricanemap-source-bundle.json';
const DATA_DB_PREFIX = 'hm-offline-data-';
const DATA_DB = `${DATA_DB_PREFIX}${SW_VERSION}`;
const DATA_STORE = 'responses';
const DATA_DB_VERSION = 1;
const LEGACY_DATA_CACHES = ['hm-data-v1', 'hm-data-v2'];
const LEGACY_DATA_DBS = ['hm-offline-data-v1', 'hm-offline-data-v2'];
const RELEASE_MARKER_PATH = './__hurricanemap-release.json';
const RELEASE_LOCK_NAME = `hurricanemap-release-${SW_VERSION}`;
const WORKER_BASE_URL = new URL('./', import.meta.url);
const MODULE_ENTRYPOINTS = ['./src/main.js'];

const SHELL_ASSETS = [
  './',
  './index.html',
  './globe.html',
  './manifest.webmanifest',
  './manifest.es.webmanifest',
  './manifest.ht.webmanifest',
  './src/styles.css',
  './src/styles-tokens.css',
  './src/styles-reset.css',
  './src/styles-base.css',
  './src/styles-shell.css',
  './src/styles-components.css',
  './src/styles-utilities.css',
  './src/styles-themes.css',
  './src/styles-accessibility.css',
  './src/globe-host.js',
  './src/globe-host.css',
  './branding/favicon.png',
  './branding/logo-192.png',
  './vendor/leaflet.css',
  './vendor/leaflet.js',
  './vendor/leaflet-heat.js',
  './fonts/inter-latin.woff2',
  './fonts/jetbrains-mono-latin.woff2',
];

const MODULE_IMPORT_RE = /\bimport(?:\s+(?:(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"])|\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

const OFFLINE_DATA_ASSETS = [
  './data/landfalls.json',
  './data/storms.json.gz',
  './data/enso.json',
  './data/outlook.json',
  './data/cone-radii.json',
  './data/advisories.json',
  './data/forecast-skill.json',
  './data/tide-stations.json',
  './data/surge-obs/index.json',
  './data/stats.json',
  './data/metadata.json',
  './data/coverage.json',
  './data/aoml-landfalls.json',
  './data/distribution.json',
  './data/impacts.json',
  './data/billions.json',
  './data/glossary.json',
  './data/storm-events.json',
  './data/rainfall.json',
  './data/us-states.geojson',
  './data/hurdat2-sources.json',
  './data/radar/manifest.json',
  './data/stac/catalog.json',
  './schemas/metadata-v1.schema.json',
  './schemas/coverage-v1.schema.json',
  './schemas/aoml-landfalls-v1.schema.json',
  './schemas/landfalls-v1.schema.json',
  './schemas/storms-v1.schema.json',
  './schemas/impacts-v1.schema.json',
  './schemas/saved-views-v1.schema.json',
  './schemas/release-manifest-v1.schema.json',
];

const SOURCE_BUNDLE_ASSETS = [
  './data/hurdat2-atlantic.txt',
  './data/hurdat2-nepac.txt',
  './data/release-manifest.json',
];

async function withReleaseLock(task) {
  const locks = self.navigator?.locks;
  if (!locks?.request) return task();
  return locks.request(RELEASE_LOCK_NAME, { mode: 'exclusive' }, task);
}

function assetPathFor(url) {
  if (url.origin !== WORKER_BASE_URL.origin || !url.pathname.startsWith(WORKER_BASE_URL.pathname)) {
    throw new Error(`Module import escapes the application origin: ${url.href}`);
  }
  return `./${url.pathname.slice(WORKER_BASE_URL.pathname.length)}`;
}

async function discoverModuleGraph() {
  const assets = new Set();
  const queue = MODULE_ENTRYPOINTS.map(asset => ({
    asset,
    url: new URL(asset, WORKER_BASE_URL),
  }));
  while (queue.length) {
    const current = queue.shift();
    if (assets.has(current.asset)) continue;
    assets.add(current.asset);
    const response = await fetch(new Request(current.url, { cache: 'reload' }));
    if (!response.ok) throw new Error(`Required module failed: ${current.asset} (${response.status})`);
    const source = await response.text();
    MODULE_IMPORT_RE.lastIndex = 0;
    for (const match of source.matchAll(MODULE_IMPORT_RE)) {
      const specifier = match[1] || match[2];
      if (!specifier?.startsWith('.')) continue;
      const importedUrl = new URL(specifier, current.url);
      if (importedUrl.origin !== WORKER_BASE_URL.origin) continue;
      const asset = assetPathFor(importedUrl);
      if (!assets.has(asset)) queue.push({ asset, url: importedUrl });
    }
  }
  return [...assets];
}

self.addEventListener('install', (event) => {
  event.waitUntil(withReleaseLock(async () => {
    const cache = await caches.open(SHELL_CACHE);
    await precacheShell(cache);
    await precacheOfflineData();
    await validateReleaseBundle();
  }));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'REPAIR_OFFLINE_DATA') {
    event.waitUntil(repairOfflineData(event));
    return;
  }
  if (event.data?.type === 'CHECK_OFFLINE_INTEGRITY') {
    event.waitUntil(reportOfflineIntegrity(event));
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(withReleaseLock(async () => {
    await validateReleaseBundle();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL_CACHE && k !== DATA_CACHE && k !== TILE_CACHE && k !== RADAR_CACHE && k !== SOURCE_BUNDLE_CACHE) return caches.delete(k);
    }));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await pruneOfflineData();
    await pruneSourceBundle();
    await deleteLegacyDataDbs();
    self.clients.claim();
  }));
});

function isShell(url) {
  if (url.origin !== location.origin) return false;
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) return true;
  return /\.(css|js|webmanifest|png|svg|ico)$/.test(url.pathname);
}

function isData(url) {
  if (url.origin !== location.origin) return false;
  // Only the generated /data/ bundle counts as offline data. Matching every
  // same-origin .json would also capture live feeds like /nhc/CurrentStorms.json
  // and serve them stale-first, defeating their no-cache polling.
  return /\/data\/.+\.(json|geojson|txt)(\.gz)?$/.test(url.pathname);
}

function isRadarAsset(url) {
  if (url.origin !== location.origin) return false;
  return /\/data\/radar\/.+\.png$/.test(url.pathname);
}

function isSourceBundleAsset(url) {
  if (url.origin !== location.origin) return false;
  return SOURCE_BUNDLE_ASSETS.some(asset => new URL(asset, self.location.href).pathname === url.pathname);
}

function isTile(url) {
  return /tile\.openstreetmap|mesonet\.agron\.iastate\.edu/.test(url.host);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (!url.protocol.startsWith('http')) return;

  if (isRadarAsset(url)) {
    event.respondWith(cacheFirst(req, RADAR_CACHE, event));
  } else if (isSourceBundleAsset(url)) {
    event.respondWith(sourceBundleWhileRevalidate(req, event));
  } else if (isShell(url)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE, event));
  } else if (isData(url)) {
    event.respondWith(offlineDataWhileRevalidate(req, event));
  } else if (isTile(url)) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE, event));
  }
});

// Keep the tile cache bounded — without a cap it grows with every pan/zoom
// for the life of the origin. Eviction is insertion-order (oldest first).
const TILE_CACHE_MAX_ENTRIES = 600;
const RADAR_CACHE_MAX_ENTRIES = 240;

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
  } catch { /* best-effort */ }
}

async function cacheFirst(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      const write = cache.put(req, res.clone())
        .then(() => cacheName === RADAR_CACHE ? trimCache(RADAR_CACHE, RADAR_CACHE_MAX_ENTRIES) : undefined)
        .catch(() => {});
      if (event && typeof event.waitUntil === 'function') event.waitUntil(write);
    }
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const preloadResponse = event?.preloadResponse;
  const networkFetch = preloadResponse
    ? preloadResponse.then(r => r || fetch(req)).catch(() => fetch(req))
    : fetch(req);
  const refresh = networkFetch.then(async (res) => {
    if (res && res.status === 200) {
      await cache.put(req, res.clone()).catch(() => {});
      if (cacheName === TILE_CACHE) await trimCache(TILE_CACHE, TILE_CACHE_MAX_ENTRIES);
    }
    return res;
  }).catch(() => null);
  // Without waitUntil the SW can be terminated before the background
  // revalidation writes complete, silently losing the refresh.
  if (event && typeof event.waitUntil === 'function') event.waitUntil(refresh);
  return hit || (await refresh) || Response.error();
}

async function offlineDataWhileRevalidate(req, event) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await readOfflineResponse(req);
  const cacheHit = cached ? null : await cache.match(req);
  const refresh = fetch(req).then(async (res) => {
    if (res && res.status === 200) {
      await Promise.all([
        cache.put(req, res.clone()).catch(() => {}),
        writeOfflineResponse(req, res.clone()).catch(() => {}),
      ]);
    }
    return res;
  }).catch(() => null);
  if (event && typeof event.waitUntil === 'function') event.waitUntil(refresh);
  return cached || cacheHit || (await refresh) || Response.error();
}

async function sourceBundleWhileRevalidate(req, event) {
  const cacheNames = await caches.keys().catch(() => []);
  const cache = cacheNames.includes(SOURCE_BUNDLE_CACHE)
    ? await caches.open(SOURCE_BUNDLE_CACHE)
    : null;
  const refresh = req.headers.get('x-hurricanemap-source-bundle') === 'refresh';
  const hit = refresh || !cache ? null : await cache.match(req);
  const response = hit || await fetch(req).catch(() => null);
  if (event && typeof event.waitUntil === 'function' && !hit) {
    event.waitUntil(Promise.resolve(response));
  }
  return response || Response.error();
}

async function precacheShell(cache) {
  const assets = [...new Set([...SHELL_ASSETS, ...await discoverModuleGraph()])];
  await Promise.all(assets.map(async (url) => {
    const req = new Request(url, { cache: 'reload' });
    const res = await fetch(req);
    if (!res.ok) throw new Error(`Required shell asset failed: ${url} (${res.status})`);
    if (url === './sw.js') {
      const source = await res.clone().text();
      if (!source.includes(`const SW_VERSION = '${SW_VERSION}'`)) {
        throw new Error(`Shell service worker does not declare ${SW_VERSION}`);
      }
    }
    await cache.put(req, res);
  }));
}

async function precacheOfflineData() {
  const cache = await caches.open(DATA_CACHE);
  const manifestRequest = new Request('./data/release-manifest.json', { cache: 'reload' });
  const manifestResponse = await fetch(manifestRequest);
  if (!manifestResponse.ok) throw new Error(`Required release manifest failed (${manifestResponse.status})`);
  const manifestBytes = await manifestResponse.clone().arrayBuffer();
  const manifest = parseReleaseManifest(new TextDecoder().decode(manifestBytes));
  const artifacts = assertReleaseManifest(manifest);
  const runtimeArtifacts = {};

  for (const url of OFFLINE_DATA_ASSETS) {
    const req = new Request(url, { cache: 'reload' });
    const res = await fetch(req);
    if (!res.ok) throw new Error(`Required offline asset failed: ${url} (${res.status})`);
    const key = cacheKeyFor(req);
    const artifact = artifacts.get(key);
    if (key.startsWith('data/')) {
      await assertResponseMatchesArtifact(res, artifact, key);
      runtimeArtifacts[key] = artifact;
    }
    await cache.put(req, res.clone());
    await writeOfflineResponse(req, res.clone());
  }

  await cache.put(RELEASE_MARKER_PATH, new Response(JSON.stringify({
    schema_version: 1,
    sw_version: SW_VERSION,
    shell_cache: SHELL_CACHE,
    data_cache: DATA_CACHE,
    data_db: DATA_DB,
    source_commit: manifest.source_commit,
    manifest_sha256: await sha256Hex(manifestBytes),
    manifest_generated_at_utc: manifest.generated_at_utc,
    runtime_artifacts: runtimeArtifacts,
    verified_at_utc: new Date().toISOString(),
  }), {
    headers: { 'content-type': 'application/json' },
  }));
}

function parseReleaseManifest(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Release manifest is not valid JSON');
  }
}

function assertReleaseManifest(manifest) {
  if (manifest?.schema_version !== 1 || manifest.algorithm !== 'SHA-256') {
    throw new Error('Release manifest contract is unsupported');
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.source_commit || '')) {
    throw new Error('Release manifest has no source revision');
  }
  const artifacts = new Map((manifest.artifacts || []).map(artifact => [artifact.path, artifact]));
  for (const url of OFFLINE_DATA_ASSETS) {
    const key = new URL(url, self.location.href).pathname.replace(/^\//, '');
    if (key.startsWith('data/') && key !== 'data/release-manifest.json' && !artifacts.has(key)) {
      throw new Error(`Release manifest is missing required data artifact: ${key}`);
    }
  }
  return artifacts;
}

async function assertResponseMatchesArtifact(response, artifact, key) {
  if (!artifact || !Number.isInteger(artifact.bytes) || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
    throw new Error(`Release manifest has no valid checksum for ${key}`);
  }
  const body = await response.clone().arrayBuffer();
  const digest = await sha256Hex(body);
  if (body.byteLength !== artifact.bytes || digest !== artifact.sha256) {
    throw new Error(`Offline asset checksum mismatch: ${key}`);
  }
}

async function sha256Hex(body) {
  const digest = await crypto.subtle.digest('SHA-256', body);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function validateReleaseBundle({ cacheName = DATA_CACHE, dbName = DATA_DB, strictTuple = true } = {}) {
  const dataCache = await caches.open(cacheName);
  const markerResponse = await dataCache.match(RELEASE_MARKER_PATH);
  if (!markerResponse) throw new Error('Offline release marker is missing');
  const marker = parseReleaseManifest(await markerResponse.text());
  if (marker.schema_version !== 1 || (strictTuple && (marker.sw_version !== SW_VERSION || marker.shell_cache !== SHELL_CACHE || marker.data_cache !== cacheName || marker.data_db !== dbName))) {
    throw new Error('Offline release tuple is incoherent');
  }
  const shellCache = await caches.open(SHELL_CACHE);
  for (const asset of SHELL_ASSETS) {
    if (!await shellCache.match(asset)) throw new Error(`Offline shell asset is missing: ${asset}`);
  }
  const artifacts = new Map(Object.entries(marker.runtime_artifacts || {}));
  if (!artifacts.size || !/^[a-f0-9]{64}$/.test(marker.manifest_sha256 || '')) {
    throw new Error('Offline runtime manifest is missing');
  }
  for (const url of OFFLINE_DATA_ASSETS) {
    const key = new URL(url, self.location.href).pathname.replace(/^\//, '');
    const cached = await dataCache.match(url);
    if (!cached) throw new Error(`Offline data asset is missing: ${key}`);
    if (key.startsWith('data/')) {
      await assertResponseMatchesArtifact(cached, artifacts.get(key), key);
    }
  }
  const keys = new Set(await idbListKeys(dbName));
  for (const url of OFFLINE_DATA_ASSETS) {
    const key = new URL(url, self.location.href).pathname.replace(/^\//, '');
    if (!keys.has(key)) throw new Error(`Offline database record is missing: ${key}`);
  }
  return marker;
}

async function classifyOfflineIntegrity() {
  const checkedAt = new Date().toISOString();
  const cacheNames = await caches.keys().catch(() => []);
  if (!cacheNames.includes(SHELL_CACHE) || !cacheNames.includes(DATA_CACHE)) {
    return { state: 'evicted', checked_at_utc: checkedAt, error: 'Offline shell or data cache is missing' };
  }
  try {
    const dataCache = await caches.open(DATA_CACHE);
    if (!await dataCache.match(RELEASE_MARKER_PATH)) {
      return { state: 'evicted', checked_at_utc: checkedAt, error: 'Offline release marker is missing' };
    }
    try {
      await validateReleaseBundle();
      return { state: 'intact', checked_at_utc: checkedAt, error: null };
    } catch (strictError) {
      try {
        await validateReleaseBundle({ strictTuple: false });
        return {
          state: 'stale-but-valid',
          checked_at_utc: checkedAt,
          error: String(strictError?.message || strictError).slice(0, 240),
        };
      } catch (relaxedError) {
        const message = String(relaxedError?.message || relaxedError).slice(0, 240);
        return {
          state: /missing|unavailable/i.test(message) ? 'evicted' : 'invalid',
          checked_at_utc: checkedAt,
          error: message,
        };
      }
    }
  } catch (error) {
    const message = String(error?.message || error).slice(0, 240);
    return {
      state: /missing|unavailable/i.test(message) ? 'evicted' : 'invalid',
      checked_at_utc: checkedAt,
      error: message,
    };
  }
}

async function reportOfflineIntegrity(event) {
  let result;
  try {
    result = await classifyOfflineIntegrity();
  } catch (error) {
    result = {
      state: 'invalid',
      checked_at_utc: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 240),
    };
  }
  event.source?.postMessage({ type: 'OFFLINE_INTEGRITY_RESULT', ...result });
}

async function repairOfflineData(event) {
  let result;
  try {
    result = await withReleaseLock(async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await precacheShell(shellCache);
      await precacheOfflineData();
      await validateReleaseBundle();
      await pruneOfflineData();
      return { ok: true, sw_version: SW_VERSION };
    });
  } catch (error) {
    result = { ok: false, error: String(error?.message || error).slice(0, 240) };
  }
  event.source?.postMessage({ type: 'OFFLINE_REPAIR_RESULT', ...result });
}

async function pruneOfflineData() {
  const allowed = new Set(OFFLINE_DATA_ASSETS.map(asset => {
    const url = new URL(asset, self.location.href);
    return url.pathname.replace(/^\//, '');
  }));
  allowed.add(cacheKeyFor(new Request(RELEASE_MARKER_PATH)));
  try {
    const cache = await caches.open(DATA_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.map(request => (
      allowed.has(cacheKeyFor(request)) ? undefined : cache.delete(request)
    )));
  } catch { /* best-effort */ }
  try {
    await idbDeleteExcept(allowed, DATA_DB);
  } catch { /* IndexedDB may be unavailable */ }
}

async function pruneSourceBundle() {
  const cacheNames = await caches.keys().catch(() => []);
  if (!cacheNames.includes(SOURCE_BUNDLE_CACHE)) return;
  const allowed = new Set(SOURCE_BUNDLE_ASSETS.map(asset => {
    const url = new URL(asset, self.location.href);
    return url.pathname.replace(/^\//, '');
  }));
  allowed.add(cacheKeyFor(new Request(SOURCE_BUNDLE_MARKER_PATH)));
  try {
    const cache = await caches.open(SOURCE_BUNDLE_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.map(request => (
      allowed.has(cacheKeyFor(request)) ? undefined : cache.delete(request)
    )));
  } catch { /* best-effort */ }
}

async function readOfflineResponse(req) {
  let record = null;
  try {
    record = await idbGet(cacheKeyFor(req), DATA_DB);
  } catch {
    return null;
  }
  if (!record) return null;
  try {
    const body = await inflateBody(record.body, record.encoding);
    return new Response(body, {
      status: record.status,
      statusText: record.statusText,
      headers: record.headers,
    });
  } catch {
    return null;
  }
}

async function writeOfflineResponse(req, res, dbName = DATA_DB) {
  const body = await res.arrayBuffer();
  const packed = await deflateBody(body);
  await idbPut({
    key: cacheKeyFor(req),
    url: req.url,
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers.entries()],
    body: packed.body,
    encoding: packed.encoding,
    cachedAt: Date.now(),
  }, dbName);
}

function cacheKeyFor(req) {
  const url = new URL(req.url);
  return url.pathname.replace(/^\//, '');
}

async function deflateBody(body) {
  if (!('CompressionStream' in self)) {
    return { body, encoding: null };
  }
  try {
    const compressed = await new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    return { body: compressed, encoding: 'gzip' };
  } catch {
    return { body, encoding: null };
  }
}

async function inflateBody(body, encoding) {
  if (encoding !== 'gzip') return body;
  if (!('DecompressionStream' in self)) throw new Error('gzip data cached but DecompressionStream is unavailable');
  return new Response(
    new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
}

function openDataDb(dbName = DATA_DB) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(dbName, DATA_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATA_STORE)) {
        request.result.createObjectStore(DATA_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteLegacyDataDbs() {
  if (!('indexedDB' in self)) return;
  const names = new Set(LEGACY_DATA_DBS);
  try {
    for (const database of await indexedDB.databases()) {
      if (database.name && database.name.startsWith(DATA_DB_PREFIX) && database.name !== DATA_DB) names.add(database.name);
    }
  } catch { /* databases() is optional; fixed legacy names still retire. */ }
  await Promise.all([...names].map(name => new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  })));
}

async function idbGet(key, dbName = DATA_DB) {
  const db = await openDataDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE, 'readonly');
    const request = tx.objectStore(DATA_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbPut(record, dbName = DATA_DB) {
  const db = await openDataDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE, 'readwrite');
    tx.objectStore(DATA_STORE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbListKeys(dbName = DATA_DB) {
  const db = await openDataDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE, 'readonly');
    const request = tx.objectStore(DATA_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbDeleteExcept(allowedKeys, dbName = DATA_DB) {
  const db = await openDataDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DATA_STORE, 'readwrite');
    const request = tx.objectStore(DATA_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!allowedKeys.has(cursor.key)) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
