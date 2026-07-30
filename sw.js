// HurricaneMap service worker.
//
// Strategy:
//   - Static shell (HTML/CSS/JS, manifest, favicon)  → cache-first, revalidate.
//   - Historical data (JSON/GeoJSON/TXT)              -> compressed IndexedDB,
//     stale-while-revalidate, with CacheStorage fallback.
//   - Local radar PNGs                                → cache-first on demand;
//     not preinstalled because the archive is intentionally large.
//   - Map tiles (CartoDB, OSM)                       → stale-while-revalidate,
//     capped at TILE_CACHE_MAX_ENTRIES (oldest evicted first).
//   - Everything else                                → network-first, fall back to cache.
//
// Bump SW_VERSION on every release to flush the static shell.

const SW_VERSION = 'hm-v1.7.0';
const SHELL_CACHE = `hm-shell-${SW_VERSION}`;
const DATA_CACHE = 'hm-data-v2';
const TILE_CACHE = 'hm-tiles-v1';
const RADAR_CACHE = 'hm-radar-v1';
const DATA_DB = 'hm-offline-data-v2';
const DATA_STORE = 'responses';
const DATA_DB_VERSION = 1;
const LEGACY_DATA_DBS = ['hm-offline-data-v1'];

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/styles-tokens.css',
  './src/styles-reset.css',
  './src/styles-base.css',
  './src/styles-shell.css',
  './src/styles-components.css',
  './src/styles-utilities.css',
  './src/styles-themes.css',
  './src/styles-accessibility.css',
  './src/main.js',
  './src/outlook.js',
  './src/marine-warnings.js',
  './src/data.js',
  './src/dialog-focus.js',
  './src/diagnostics.js',
  './src/confirm-action.js',
  './src/errors.js',
  './src/map.js',
  './src/metric-presenters.js',
  './src/panel.js',
  './src/panels.js',
  './src/stats.js',
  './src/state.js',
  './src/sw-updates.js',
  './src/on-this-date.js',
  './src/glossary.js',
  './src/goes-realtime.js',
  './src/hwm.js',
  './src/globe3d.js',
  './src/keyboard.js',
  './src/chart.js',
  './src/chart-export.js',
  './src/animation.js',
  './src/art-mode.js',
  './src/active.js',
  './src/active-polling.js',
  './src/alerts.js',
  './src/peak-surge.js',
  './src/climatology.js',
  './src/cone.js',
  './src/cone-retro.js',
  './src/compare.js',
  './src/decade-trends.js',
  './src/export.js',
  './src/exposure.js',
  './src/filter-state.js',
  './src/geodesy.js',
  './src/filter-controller.js',
  './src/forecast-skill.js',
  './src/fuzzy.js',
  './src/html-utils.js',
  './src/i18n.js',
  './src/impact-utils.js',
  './src/impact-coverage.js',
  './src/inflation.js',
  './src/metrics.js',
  './src/perf.js',
  './src/prep.js',
  './src/evac.js',
  './src/poster.js',
  './src/tooltips.js',
  './src/population.js',
  './src/qgis.js',
  './src/radar.js',
  './src/report.js',
  './src/search-history.js',
  './src/schema-contract.js',
  './src/search-controller.js',
  './src/saved-views.js',
  './src/saved-views-ui.js',
  './src/spatial-search.js',
  './src/settings.js',
  './src/shell-navigation.js',
  './src/storage-manager.js',
  './src/onboarding.js',
  './src/optional-feeds.js',
  './src/timeline.js',
  './src/sparkline.js',
  './src/season.js',
  './src/seasonal-outlook.js',
  './src/storm-events.js',
  './src/storms-worker.js',
  './src/sst.js',
  './src/svg-export.js',
  './src/surge.js',
  './src/table-view.js',
  './src/tides.js',
  './src/url-state.js',
  './src/user-point.js',
  './src/windfield.js',
  './src/wind-context.js',
  './branding/favicon.png',
  './branding/logo-192.png',
  './vendor/leaflet.css',
  './vendor/leaflet.js',
  './vendor/leaflet-heat.js',
  './fonts/inter-latin.woff2',
  './fonts/jetbrains-mono-latin.woff2',
];

const OFFLINE_DATA_ASSETS = [
  './data/landfalls.json',
  './data/storms.json.gz',
  './data/enso.json',
  './data/outlook.json',
  './data/cone-radii.json',
  './data/forecast-skill.json',
  './data/tide-stations.json',
  './data/surge-obs/index.json',
  './data/stats.json',
  './data/metadata.json',
  './data/distribution.json',
  './data/release-manifest.json',
  './data/impacts.json',
  './data/billions.json',
  './data/glossary.json',
  './data/storm-events.json',
  './data/rainfall.json',
  './data/us-states.geojson',
  './data/hurdat2-atlantic.txt',
  './data/hurdat2-nepac.txt',
  './data/radar/manifest.json',
  './schemas/metadata-v1.schema.json',
  './schemas/landfalls-v1.schema.json',
  './schemas/storms-v1.schema.json',
  './schemas/impacts-v1.schema.json',
  './schemas/saved-views-v1.schema.json',
  './schemas/release-manifest-v1.schema.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Use individual fetches so one missing file doesn't abort the install.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch { /* offline-first install — ignore */ }
    }));
    await precacheOfflineData();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL_CACHE && k !== DATA_CACHE && k !== TILE_CACHE && k !== RADAR_CACHE) return caches.delete(k);
    }));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await pruneOfflineData();
    await deleteLegacyDataDbs();
    self.clients.claim();
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

function isTile(url) {
  return /tile\.openstreetmap|cartocdn|basemaps\.cartocdn|stamen|tile\.opentopomap/.test(url.host);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (!url.protocol.startsWith('http')) return;

  if (isRadarAsset(url)) {
    event.respondWith(cacheFirst(req, RADAR_CACHE, event));
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

async function precacheOfflineData() {
  const cache = await caches.open(DATA_CACHE);
  await Promise.all(OFFLINE_DATA_ASSETS.map(async (url) => {
    try {
      const req = new Request(url, { cache: 'reload' });
      const res = await fetch(req);
      if (!res.ok) return;
      await Promise.all([
        cache.put(req, res.clone()).catch(() => {}),
        writeOfflineResponse(req, res.clone()).catch(() => {}),
      ]);
    } catch {
      /* Keep install resilient when a data sidecar is temporarily unavailable. */
    }
  }));
}

async function pruneOfflineData() {
  const allowed = new Set(OFFLINE_DATA_ASSETS.map(asset => {
    const url = new URL(asset, self.location.href);
    return url.pathname.replace(/^\//, '');
  }));
  try {
    const cache = await caches.open(DATA_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.map(request => (
      allowed.has(cacheKeyFor(request)) ? undefined : cache.delete(request)
    )));
  } catch { /* best-effort */ }
  try {
    await idbDeleteExcept(allowed);
  } catch { /* IndexedDB may be unavailable */ }
}

async function readOfflineResponse(req) {
  let record = null;
  try {
    record = await idbGet(cacheKeyFor(req));
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

async function writeOfflineResponse(req, res) {
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
  });
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

function openDataDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DATA_DB, DATA_DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DATA_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteLegacyDataDbs() {
  if (!('indexedDB' in self)) return;
  await Promise.all(LEGACY_DATA_DBS.map(name => new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  })));
}

async function idbGet(key) {
  const db = await openDataDb();
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

async function idbPut(record) {
  const db = await openDataDb();
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

async function idbDeleteExcept(allowedKeys) {
  const db = await openDataDb();
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
