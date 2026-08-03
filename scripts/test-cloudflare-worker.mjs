import assert from 'node:assert/strict';

import {
  applyResponseHeaders,
  cachePolicyFor,
  classifyAsset,
  cloudflareFetchOptions,
  nhcProxyTargetFor,
  originUrlFor,
} from '../cloudflare/worker.js';

assert.equal(classifyAsset('/'), 'html', 'root should be treated as HTML');
assert.equal(classifyAsset('/index.html'), 'html', 'index.html should be treated as HTML');
assert.equal(classifyAsset('/src/main.js'), 'shell', 'JS shell should use shell caching');
assert.equal(classifyAsset('/data/storms.json'), 'data', 'generated JSON data should use data caching');
assert.equal(classifyAsset('/data/us-states.geojson'), 'data', 'GeoJSON data should use data caching');
assert.equal(classifyAsset('/data/hurdat2-atlantic.txt'), 'data', 'raw HURDAT2 text should use data caching');
assert.equal(classifyAsset('/data/radar/Katrina-2005/t_200508291200.png'), 'immutable', 'local radar frames should use immutable on-demand caching');
assert.equal(classifyAsset('/data/storms.json.gz'), 'data', 'compressed storms bundle refreshes with HURDAT2 revisions — data TTL, not shell');
assert.equal(classifyAsset('/branding/logo.png'), 'shell', 'branding images live at stable un-fingerprinted paths — immutable would pin stale logos for a year');
assert.equal(classifyAsset('/fonts/inter-latin.woff2'), 'immutable', 'vendored fonts are content-stable and safe to cache immutably');

assert.match(cachePolicyFor('/').edge, /s-maxage=300/, 'HTML should have a short edge TTL');
assert.match(cachePolicyFor('/src/main.js').edge, /s-maxage=86400/, 'shell assets should have a one-day edge TTL');
assert.match(cachePolicyFor('/data/storms.json').edge, /s-maxage=21600/, 'data should have a moderate edge TTL');
assert.match(cachePolicyFor('/data/storms.json.gz').edge, /s-maxage=21600/, 'compressed data should share the data edge TTL');

const origin = originUrlFor(new URL('https://map.example.com/data/storms.json?x=1'), {
  ORIGIN_BASE_URL: 'https://sysadmindoc.github.io/HurricaneMap',
});
assert.equal(origin.href, 'https://sysadmindoc.github.io/HurricaneMap/data/storms.json?x=1', 'origin URL should preserve the GitHub Pages base path and query');

const response = applyResponseHeaders(new Response('ok', {
  headers: {
    'Content-Type': 'text/plain',
    'Vary': 'Accept',
  },
}), cachePolicyFor('/src/main.js'));
assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', 'worker should set nosniff');
assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin', 'worker should set the referrer policy');
assert.equal(response.headers.get('Permissions-Policy'), 'geolocation=(self), microphone=(), camera=()', 'worker should preserve same-origin geolocation and deny unused sensors');
assert.match(response.headers.get('Vary'), /Accept-Encoding/, 'worker should vary on compression support');
assert.match(response.headers.get('Cloudflare-CDN-Cache-Control'), /stale-while-revalidate/, 'worker should set Cloudflare CDN cache policy');

const errorResponse = applyResponseHeaders(new Response('missing', { status: 404 }), cachePolicyFor('/data/radar/missing.png'));
assert.equal(errorResponse.headers.get('Cache-Control'), 'no-store', 'error responses must not be pinned in browser caches');
assert.equal(errorResponse.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store', 'error responses must not be pinned at the edge');

const imageOptions = cloudflareFetchOptions('/branding/logo.png', cachePolicyFor('/branding/logo.png'));
assert.equal(imageOptions.image.format, 'auto', 'image requests should opt into automatic image format negotiation');
const radarOptions = cloudflareFetchOptions('/data/radar/Katrina-2005/t_200508291200.png', cachePolicyFor('/data/radar/Katrina-2005/t_200508291200.png'));
assert.equal(radarOptions.image, undefined, 'radar frames should not be transformed because coordinates depend on exact rasters');

assert.equal(nhcProxyTargetFor('/nhc/outlook/atl.kmz'), 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz');
assert.equal(nhcProxyTargetFor('/nhc/outlook/pac.kmz'), 'https://www.nhc.noaa.gov/xgtwo/gtwo_pac.kmz');
assert.equal(nhcProxyTargetFor('/nhc/outlook/cpac.kmz'), 'https://www.nhc.noaa.gov/xgtwo/gtwo_cpac.kmz');
assert.equal(nhcProxyTargetFor('/nhc/marine/atlantic.kml'), 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_00to24_Atlantic.kml');
assert.equal(nhcProxyTargetFor('/nhc/marine/pacific.kml'), 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_00to24_Pacific.kml');
assert.equal(nhcProxyTargetFor('/nhc/outlook/../../secrets'), null, 'proxy must reject every path outside the fixed allowlist');

// Verify NHC proxy route is declared
import workerModule from '../cloudflare/worker.js';
assert.equal(typeof workerModule.fetch, 'function', 'worker should export a fetch handler');

const originalCaches = globalThis.caches;
const originalFetch = globalThis.fetch;
let cachePutCalls = 0;
globalThis.caches = {
  default: {
    match: async () => null,
    put: async () => { cachePutCalls += 1; },
  },
};
globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'Content-Type': 'text/plain' } });
try {
  const waitUntilCalls = [];
  const headResponse = await workerModule.fetch(
    new Request('https://map.example.com/src/main.js', { method: 'HEAD' }),
    { ORIGIN_BASE_URL: 'https://sysadmindoc.github.io/HurricaneMap' },
    { waitUntil: promise => waitUntilCalls.push(promise) },
  );
  assert.equal(headResponse.status, 200, 'HEAD request should return the origin status');
  assert.equal(headResponse.body, null, 'HEAD response must not expose a body');
  assert.equal(cachePutCalls, 0, 'HEAD requests must not call cache.put');
  assert.equal(waitUntilCalls.length, 0, 'HEAD requests must not enqueue cache writes');
} finally {
  globalThis.caches = originalCaches;
  globalThis.fetch = originalFetch;
}

console.log('cloudflare worker policy ok');
