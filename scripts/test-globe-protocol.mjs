import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, hostHtml, controller, host] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../globe.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/globe3d.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/globe-host.js', import.meta.url), 'utf8'),
]);

const mainCsp = index.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
const hostCsp = hostHtml.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
assert(mainCsp, 'main document CSP is missing');
assert.doesNotMatch(mainCsp, /unsafe-eval|wasm-unsafe-eval|cesium\.com/, 'main CSP grants Cesium execution privileges');
assert.match(mainCsp, /script-src 'self';/, 'main CSP must restrict scripts to the application origin');
assert.match(mainCsp, /frame-src 'self';/, 'main CSP must allow only the local globe host frame');
assert.match(hostCsp, /script-src 'self' https:\/\/cesium\.com 'unsafe-eval' 'wasm-unsafe-eval'/, 'globe host lacks its isolated Cesium execution policy');
assert.match(index, /id="globe3d-frame"[^>]+sandbox="allow-scripts"/, 'globe iframe must use the least-privilege script-only sandbox');
assert.doesNotMatch(index, /sandbox="[^"]*allow-same-origin/, 'globe iframe must retain an opaque origin');

for (const source of [controller, host]) {
  assert.match(source, /hm-globe-v1/, 'globe protocol must be explicitly versioned');
  assert.match(source, /event\.source\s*!==/, 'message receiver must reject unexpected sources');
  assert.match(source, /ALLOWED_[A-Z_]*MESSAGES/, 'message receiver must use an explicit type allowlist');
}
// The frame is sandboxed without allow-same-origin, so the controller only ever
// accepts the opaque origin; the host pins its embedder's origin on first contact.
assert.match(controller, /event\.origin\s*!==\s*'null'/, 'controller must require the opaque frame origin');
assert.match(host, /if \(parentOrigin\) return origin === parentOrigin;/, 'host must pin and re-check its embedder origin');
assert.match(host, /origin === 'null'/, 'host must refuse to adopt an opaque embedder origin');
assert.match(host, /validInitPayload/, 'host must validate initialization payloads before rendering');
assert.match(controller, /validReadyPayload/, 'controller must validate host result payloads');
assert.match(controller, /sendToHost\('LAYERS'/, 'controller must use LAYERS for wind-cone toggles');
assert.match(controller, /showWindCones: Boolean\(els\.windCones\?\.checked\)/, 'LAYERS must carry the requested wind-cone state');
assert.match(controller, /timelineIndex: index/, 'LAYERS must carry the current timeline index');
assert.match(host, /message\.type === 'LAYERS'/, 'host must handle LAYERS without reinitializing the dataset');
assert.match(host, /validLayersPayload/, 'host must validate LAYERS payloads');
assert.match(host, /renderDataset\(Cesium, currentDataset, message\.payload\.showWindCones\);\s+updateTimeline\(message\.payload\.timelineIndex\);/, 'LAYERS must render and update time without a camera flight');

console.log('globe isolation protocol ok (main CSP strict, opaque sandbox, versioned source/origin/type/payload allowlists)');
