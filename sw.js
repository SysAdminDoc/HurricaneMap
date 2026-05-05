// HurricaneMap service worker.
//
// Strategy:
//   - Static shell (HTML/CSS/JS, manifest, favicon)  → cache-first, revalidate.
//   - Historical data (JSON/GeoJSON/TXT)              → compressed IndexedDB,
//     stale-while-revalidate, with CacheStorage fallback.
//   - Local radar PNGs                                → cache-first on demand;
//     not preinstalled because the archive is intentionally large.
//   - Map tiles (CartoDB, OSM)                       → cache-first w/ TTL.
//   - Everything else                                → network-first, fall back to cache.
//
// Bump SW_VERSION on every release to flush the static shell.

const SW_VERSION = 'hm-v1.3.9-q19';
const SHELL_CACHE = `hm-shell-${SW_VERSION}`;
const DATA_CACHE = 'hm-data-v2';
const TILE_CACHE = 'hm-tiles-v1';
const RADAR_CACHE = 'hm-radar-v1';
const DATA_DB = 'hm-offline-data-v2';
const DATA_STORE = 'responses';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/main.js',
  './src/data.js',
  './src/map.js',
  './src/panel.js',
  './src/panels.js',
  './src/stats.js',
  './src/state.js',
  './src/sw-updates.js',
  './src/on-this-date.js',
  './src/glossary.js',
  './src/globe3d.js',
  './src/keyboard.js',
  './src/chart.js',
  './src/chart-export.js',
  './src/animation.js',
  './src/active.js',
  './src/climatology.js',
  './src/cone.js',
  './src/compare.js',
  './src/decade-trends.js',
  './src/ensemble.js',
  './src/export.js',
  './src/exposure.js',
  './src/filter-state.js',
  './src/fuzzy.js',
  './src/html-utils.js',
  './src/i18n.js',
  './src/impact-utils.js',
  './src/inflation.js',
  './src/metrics.js',
  './src/perf.js',
  './src/population.js',
  './src/qgis.js',
  './src/radar.js',
  './src/report.js',
  './src/search-history.js',
  './src/settings.js',
  './src/onboarding.js',
  './src/timeline.js',
  './src/sparkline.js',
  './src/season.js',
  './src/seasonal-outlook.js',
  './src/storm-events.js',
  './src/surge.js',
  './src/url-state.js',
  './src/windfield.js',
  './branding/favicon.png',
  './branding/logo.png',
];

const OFFLINE_DATA_ASSETS = [
  './data/landfalls.json',
  './data/storms.json',
  './data/stats.json',
  './data/metadata.json',
  './data/impacts.json',
  './data/glossary.json',
  './data/storm-events.json',
  './data/us-states.geojson',
  './data/hurdat2-atlantic.txt',
  './data/hurdat2-nepac.txt',
  './data/radar/manifest.json',
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
  return /\/data\/.+\.(json|geojson|txt)$/.test(url.pathname) || /\.(json|geojson|txt)$/.test(url.pathname);
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

  // Skip extension/devtools/non-http.
  if (!url.protocol.startsWith('http')) return;

  if (isShell(url)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
  } else if (isData(url)) {
    event.respondWith(offlineDataWhileRevalidate(req));
  } else if (isRadarAsset(url)) {
    event.respondWith(cacheFirst(req, RADAR_CACHE));
  } else if (isTile(url)) {
    event.respondWith(cacheFirst(req, TILE_CACHE));
  }
  // else: network default
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

async function offlineDataWhileRevalidate(req) {
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
    const request = indexedDB.open(DATA_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DATA_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
