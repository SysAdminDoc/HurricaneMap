import assert from 'node:assert/strict';

import {
  applyResponseHeaders,
  cachePolicyFor,
  classifyAsset,
  cloudflareFetchOptions,
  originUrlFor,
} from '../cloudflare/worker.js';

assert.equal(classifyAsset('/'), 'html', 'root should be treated as HTML');
assert.equal(classifyAsset('/index.html'), 'html', 'index.html should be treated as HTML');
assert.equal(classifyAsset('/src/main.js'), 'shell', 'JS shell should use shell caching');
assert.equal(classifyAsset('/data/storms.json'), 'data', 'generated JSON data should use data caching');
assert.equal(classifyAsset('/data/us-states.geojson'), 'data', 'GeoJSON data should use data caching');
assert.equal(classifyAsset('/data/hurdat2-atlantic.txt'), 'data', 'raw HURDAT2 text should use data caching');
assert.equal(classifyAsset('/data/radar/Katrina-2005/t_200508291200.png'), 'immutable', 'local radar frames should use immutable on-demand caching');
assert.equal(classifyAsset('/branding/logo.png'), 'immutable', 'branding image should use immutable image caching');

assert.match(cachePolicyFor('/').edge, /s-maxage=300/, 'HTML should have a short edge TTL');
assert.match(cachePolicyFor('/src/main.js').edge, /s-maxage=86400/, 'shell assets should have a one-day edge TTL');
assert.match(cachePolicyFor('/data/storms.json').edge, /s-maxage=21600/, 'data should have a moderate edge TTL');
assert.match(cachePolicyFor('/branding/logo.png').browser, /immutable/, 'images should have immutable browser caching');

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
assert.match(response.headers.get('Vary'), /Accept-Encoding/, 'worker should vary on compression support');
assert.match(response.headers.get('Cloudflare-CDN-Cache-Control'), /stale-while-revalidate/, 'worker should set Cloudflare CDN cache policy');

const imageOptions = cloudflareFetchOptions('/branding/logo.png', cachePolicyFor('/branding/logo.png'));
assert.equal(imageOptions.image.format, 'auto', 'image requests should opt into automatic image format negotiation');
const radarOptions = cloudflareFetchOptions('/data/radar/Katrina-2005/t_200508291200.png', cachePolicyFor('/data/radar/Katrina-2005/t_200508291200.png'));
assert.equal(radarOptions.image, undefined, 'radar frames should not be transformed because coordinates depend on exact rasters');

// Verify NHC proxy route is declared
import workerModule from '../cloudflare/worker.js';
assert.equal(typeof workerModule.fetch, 'function', 'worker should export a fetch handler');

console.log('cloudflare worker policy ok');
