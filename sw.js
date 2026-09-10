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

const SW_VERSION = 'hm-v1.10.0';
const SHELL_CACHE = `hm-shell-${SW_VERSION}`;
const DATA_CACHE_PREFIX = 'hm-data-';
const DATA_CACHE = `${DATA_CACHE_PREFIX}${SW_VERSION}`;
const TILE_CACHE = 'hm-tiles-v2';
const RADAR_CACHE = 'hm-radar-v1';
// Frames the user explicitly saved live apart from the ones they merely
// browsed past. RADAR_CACHE is an LRU: a 120-frame pack plus ordinary browsing
// crossed its 240-entry cap, so saving a third pack silently deleted the first
// one's frames while the pack index still listed it as saved. Nothing trims
// this cache, and trimCache is never pointed at it.
const RADAR_PACK_CACHE = 'hm-radar-saved-v1';
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
// self.location.href is the worker script's own URL in both a module worker
// and a classic one, whereas import.meta is a SyntaxError outside a module. The
// file has no import statements, so this one line is what kept it from parsing
// as a classic script, and Firefox 146 and earlier reject a module worker
// registration outright: on Firefox ESR 140, still supported, the atlas had no
// offline at all. src/sw-updates.js retries as classic when module is refused.
const WORKER_BASE_URL = new URL('./', self.location.href);
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
    // An install that fails after opening its caches leaves versioned caches
    // for a version that never activates, and only that version's activate
    // would remove them. Clean up what this install created, and only that: a
    // repair install of the version already serving shares these caches, so
    // deleting them unconditionally would take a working offline shell down
    // with the failed install.
    //
    // null, not an empty set, when the list cannot be read. caches.keys()
    // rejects under the same conditions that make an install fail (blocked site
    // data, storage corruption), and an empty set would have said "this install
    // created everything", which on a same-version reinstall means deleting the
    // running worker's shell. Not knowing means deleting nothing.
    const preexisting = await caches.keys().then(names => new Set(names)).catch(() => null);
    try {
      const cache = await caches.open(SHELL_CACHE);
      await precacheShell(cache);
      await precacheOfflineData();
      await validateReleaseBundle();
    } catch (error) {
      if (preexisting) {
        for (const name of [SHELL_CACHE, DATA_CACHE]) {
          if (!preexisting.has(name)) await caches.delete(name).catch(() => {});
        }
      }
      throw error;
    }
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

// What happened the last time this worker instance activated, so the
// diagnostics panel can say why a worker is serving without having verified
// its bundle. Null carries its own meaning and is not the same as a clean run:
// a worker terminated for idleness and respawned to answer a message has not
// activated in this instance and knows nothing, which used to be impossible to
// tell apart from an activate that found nothing wrong.
let lastActivate = null;

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    lastActivate = { at: new Date().toISOString(), failures: [] };
    const recordFailure = (error) => {
      const message = String(error?.message || error).slice(0, 240);
      if (!lastActivate.failures.includes(message)) lastActivate.failures.push(message);
    };

    // Taking control is not housekeeping, and it must not queue behind it
    // either. This sat in a finally inside withReleaseLock, which takes an
    // origin-wide exclusive lock that install holds across a full precache and
    // that repairOfflineData holds across a re-download started from the
    // diagnostics panel. A finally defends against a throw and nothing else:
    // behind a lock somebody else is holding, the handler never arrives there
    // at all. A worker activates whether or not its waitUntil settles, so
    // either way the result was an activated worker controlling no page, with
    // every open tab left on the previous version and nothing said about it
    // until a manual reload, which is exactly when nobody performs one.
    try {
      await self.clients.claim();
    } catch (error) {
      recordFailure(error);
    }

    try {
      await withReleaseLock(async () => {
      // Validation must not be able to skip the cleanup either. It was the
      // first await in one straight-line handler, so a throw there abandoned
      // the cache deletion, the navigation preload and the pruning alike.
      try {
        await validateReleaseBundle();
      } catch (error) {
        recordFailure(error);
      }

      try {
        // The names this deletes belong to no version the worker still serves,
        // so they are worth reclaiming even when the bundle did not verify.
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => {
          if (k !== SHELL_CACHE && k !== DATA_CACHE && k !== TILE_CACHE && k !== RADAR_CACHE && k !== RADAR_PACK_CACHE && k !== SOURCE_BUNDLE_CACHE) return caches.delete(k);
        }));
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
        await pruneOfflineData();
        await pruneSourceBundle();
        await deleteLegacyDataDbs();
      } catch (error) {
        recordFailure(error);
      }
      });
    } catch (error) {
      // Both blocks inside catch, so the task cannot throw. Acquiring the lock
      // can: storage denied, or an origin with no access to it. Unwrapped, that
      // left failures empty and reported exactly the "nothing was wrong" signal
      // this is here to distinguish from silence.
      recordFailure(error);
    }
  })());
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
    event.respondWith(radarFrame(req, event));
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

// A saved pack answers before the browsing cache, and a miss there falls
// through to the LRU exactly as before. Without this a pack would be written
// somewhere the fetch handler never looked, which is worse than the eviction
// it was written to survive.
async function radarFrame(req, event) {
  try {
    const packs = await caches.open(RADAR_PACK_CACHE);
    const saved = await packs.match(req);
    if (saved) return saved;
  } catch { /* the pack cache is optional; fall through to the LRU */ }
  return cacheFirst(req, RADAR_CACHE, event);
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
  // The active worker is the only authority on which versioned caches are
  // being served. A client that guesses "highest version present" reports on
  // the leftovers of an install that failed and never activated.
  const active = { sw_version: SW_VERSION, shell_cache: SHELL_CACHE, data_cache: DATA_CACHE };
  const cacheNames = await caches.keys().catch(() => []);
  if (!cacheNames.includes(SHELL_CACHE) || !cacheNames.includes(DATA_CACHE)) {
    return { ...active, state: 'evicted', checked_at_utc: checkedAt, error: 'Offline shell or data cache is missing' };
  }
  try {
    const dataCache = await caches.open(DATA_CACHE);
    if (!await dataCache.match(RELEASE_MARKER_PATH)) {
      return { ...active, state: 'evicted', checked_at_utc: checkedAt, error: 'Offline release marker is missing' };
    }
    try {
      await validateReleaseBundle();
      return { ...active, state: 'intact', checked_at_utc: checkedAt, error: null };
    } catch (strictError) {
      try {
        await validateReleaseBundle({ strictTuple: false });
        return {
          ...active,
          state: 'stale-but-valid',
          checked_at_utc: checkedAt,
          error: String(strictError?.message || strictError).slice(0, 240),
        };
      } catch (relaxedError) {
        const message = String(relaxedError?.message || relaxedError).slice(0, 240);
        return {
          // This branch is the broken-offline answer, which is exactly when the
          // panel most needs to be told which caches are being served. It was
          // the one return that did not carry them, so the client fell back to
          // guessing the highest version present.
          ...active,
          state: /missing|unavailable/i.test(message) ? 'evicted' : 'invalid',
          checked_at_utc: checkedAt,
          error: message,
        };
      }
    }
  } catch (error) {
    const message = String(error?.message || error).slice(0, 240);
    return {
      ...active,
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
      sw_version: SW_VERSION,
      shell_cache: SHELL_CACHE,
      data_cache: DATA_CACHE,
      state: 'invalid',
      checked_at_utc: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 240),
    };
  }
  // A worker that activated without verifying its bundle is serving anyway,
  // and until now the only trace was a rejected waitUntil in a console nobody
  // was watching. Carry it to the panel that exists to answer this question.
  event.source?.postMessage({
    type: 'OFFLINE_INTEGRITY_RESULT',
    ...result,
    last_activate: lastActivate,
  });
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
