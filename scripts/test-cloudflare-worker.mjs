import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  applyResponseHeaders,
  cachePolicyFor,
  classifyAsset,
  cloudflareFetchOptions,
  getCacheKey,
  MAIN_CONTENT_SECURITY_POLICY,
  nhcProxyTargetFor,
  originUrlFor,
  staticCacheKeyUrl,
  withoutCredentials,
} from '../cloudflare/worker.js';
import { marineFeedsFor, MARINE_HORIZONS } from '../src/marine-warnings.js';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const metaCsp = indexHtml.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
assert(metaCsp, 'index.html should declare its meta CSP');
for (const directive of metaCsp.split(';').map(part => part.trim()).filter(Boolean)) {
  assert(MAIN_CONTENT_SECURITY_POLICY.includes(directive), `worker CSP dropped index.html directive: ${directive}`);
}

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

// The origin is a file server that ignores query strings and returns the same
// bytes for every one of them, so keying the edge cache on the query minted a
// fresh entry per `?x=` and let anyone push the useful entries out.
{
  const base = new URL('https://sysadmindoc.github.io/HurricaneMap/data/storms.json');
  const withQuery = new URL(`${base.href}?utm_source=anything`);
  const withOther = new URL(`${base.href}?utm_source=something-else`);
  assert.equal(
    staticCacheKeyUrl(withQuery),
    staticCacheKeyUrl(withOther),
    'two requests for one static path must share a cache key however they are decorated',
  );
  assert.equal(
    staticCacheKeyUrl(withQuery),
    base.href,
    'the shared key is the path itself',
  );
  // The origin request is a separate thing and keeps what it was given.
  assert.equal(
    originUrlFor(new URL('https://map.example.com/data/storms.json?x=1'), {
      ORIGIN_BASE_URL: 'https://sysadmindoc.github.io/HurricaneMap',
    }).search,
    '?x=1',
    'narrowing the cache key must not change what is asked of the origin',
  );
}

// The /nhc/ proxy is the other direction. Its allowlisted targets carry no
// query today, so nothing would break if one were dropped, which is exactly why
// the stripping lives in the static branch rather than in getCacheKey: the day
// a target does carry one, collapsing it would serve one query's answer for
// another's.
{
  const target = nhcProxyTargetFor('/nhc/outlook/atl.kmz');
  assert.equal(target, 'https://www.nhc.noaa.gov/xgtwo/gtwo_atl.kmz', 'the proxy should resolve a known NHC path');
  const keyed = getCacheKey(target);
  assert.equal(keyed.url, target, 'the proxy must key on its full upstream URL');
  assert.equal(keyed.method, 'GET', 'a Cache API key has to be a GET');
  assert.equal(
    getCacheKey('https://www.nhc.noaa.gov/x.json?basin=atl').url,
    'https://www.nhc.noaa.gov/x.json?basin=atl',
    'getCacheKey itself must never drop a query; only the static path does',
  );
}

// A cache key names an entry. It has no business carrying the caller's cookie.
{
  const keyed = getCacheKey('https://sysadmindoc.github.io/HurricaneMap/index.html');
  assert.equal(keyed.headers.get('cookie'), null, 'a cache key must not carry credentials');
  assert.equal(keyed.headers.get('authorization'), null, 'a cache key must not carry credentials');
}

// Credentials belong to this origin, not to the public file server behind it.
{
  const incoming = new Request('https://map.example.com/index.html', {
    headers: {
      cookie: 'session=secret',
      authorization: 'Bearer secret',
      range: 'bytes=0-99',
      'if-none-match': '"abc"',
      'accept-encoding': 'gzip',
    },
  });
  const forwarded = withoutCredentials(incoming);
  assert.equal(forwarded.headers.get('cookie'), null, 'the origin request must not carry a cookie');
  assert.equal(forwarded.headers.get('authorization'), null, 'the origin request must not carry authorization');
  // Everything that changes what the origin should send back is kept.
  assert.equal(forwarded.headers.get('range'), 'bytes=0-99', 'Range must survive');
  assert.equal(forwarded.headers.get('if-none-match'), '"abc"', 'If-None-Match must survive');
  assert.equal(forwarded.headers.get('accept-encoding'), 'gzip', 'Accept-Encoding must survive');

  const clean = new Request('https://map.example.com/index.html', { headers: { range: 'bytes=0-9' } });
  assert.equal(withoutCredentials(clean), clean, 'a request with nothing to strip is passed through as it is');
}

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

const htmlResponse = applyResponseHeaders(new Response('<!doctype html>', {
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
}), cachePolicyFor('/'), '/');
assert.equal(htmlResponse.headers.get('Content-Security-Policy'), MAIN_CONTENT_SECURITY_POLICY, 'primary HTML should receive the complete response CSP');
assert.match(htmlResponse.headers.get('Content-Security-Policy'), /form-action 'none'/, 'primary HTML CSP should deny form submissions');
assert.match(htmlResponse.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/, 'primary HTML CSP should restrict framing to same origin');

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
assert.equal(nhcProxyTargetFor('/nhc/marine/atlantic-00to24.kml'), 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_00to24_Atlantic.kml');
assert.equal(nhcProxyTargetFor('/nhc/marine/pacific-00to24.kml'), 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_00to24_Pacific.kml');
assert.equal(nhcProxyTargetFor('/nhc/marine/atlantic-24to48.kml'), 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_24to48_Atlantic.kml');
assert.equal(nhcProxyTargetFor('/nhc/marine/pacific-24to48.kml'), 'https://www.nhc.noaa.gov/gis/marine/warnings/GMWW_24to48_Pacific.kml');
assert.equal(nhcProxyTargetFor('/nhc/outlook/../../secrets'), null, 'proxy must reject every path outside the fixed allowlist');

// src/marine-warnings.js falls back to NHC directly when the proxy path is
// absent, so its direct URLs and the worker's allowlist must stay one product.
const relayedMarineTargets = new Set();
for (const horizon of MARINE_HORIZONS) {
  for (const feed of marineFeedsFor(horizon)) {
    assert.equal(
      nhcProxyTargetFor(feed.proxy),
      feed.direct,
      `${feed.id} marine fallback URL has drifted from the worker allowlist target`,
    );
    // Both bands answering with one file is the failure this layer cannot
    // survive: the two forecast periods are byte-identical whenever no warning
    // is in force, so a route collision would show as "it works" all off-season
    // and as the wrong ocean during a storm.
    assert.ok(
      !relayedMarineTargets.has(feed.direct),
      `${feed.proxy} relays a product another marine route already claims: ${feed.direct}`,
    );
    relayedMarineTargets.add(feed.direct);
  }
}
assert.equal(relayedMarineTargets.size, 4, 'two basins across two forecast bands is four distinct NHC products');

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

console.log('cloudflare worker policy ok (one cache key per static path, the proxy keeps its query, credentials reach neither the key nor the origin)');
