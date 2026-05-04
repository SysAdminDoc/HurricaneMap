// HurricaneMap service worker.
//
// Strategy:
//   - Static shell (HTML/CSS/JS, manifest, favicon)  → cache-first, revalidate.
//   - HURDAT2 data JSON (storms.json, landfalls.json, impacts.json, stats.json)
//     → stale-while-revalidate so users see instant data while we refresh.
//   - Map tiles (CartoDB, OSM)                       → cache-first w/ TTL.
//   - Everything else                                → network-first, fall back to cache.
//
// Bump SW_VERSION on every release to flush the static shell.

const SW_VERSION = 'hm-v0.9.3';
const SHELL_CACHE = `hm-shell-${SW_VERSION}`;
const DATA_CACHE = 'hm-data-v1';
const TILE_CACHE = 'hm-tiles-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/main.js',
  './src/data.js',
  './src/map.js',
  './src/panel.js',
  './src/chart.js',
  './src/chart-export.js',
  './src/animation.js',
  './src/radar.js',
  './src/compare.js',
  './src/windfield.js',
  './src/panels.js',
  './src/metrics.js',
  './src/settings.js',
  './src/onboarding.js',
  './src/timeline.js',
  './src/sparkline.js',
  './src/season.js',
  './src/fuzzy.js',
  './src/search-history.js',
  './src/inflation.js',
  './src/climatology.js',
  './branding/favicon.png',
  './branding/logo.png',
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
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL_CACHE && k !== DATA_CACHE && k !== TILE_CACHE) return caches.delete(k);
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
  return /\/data\/.+\.json$/.test(url.pathname) || /\.json$/.test(url.pathname);
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
    event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
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
