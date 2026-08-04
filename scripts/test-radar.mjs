import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildIemRadarTileProbeUrl,
  buildIemRadarTileUrl,
  buildRadarProbeTimes,
  isRadarFrameResponseAvailable,
} from '../src/radar-utils.js';
import {
  RADAR_COLORBLIND_STOPS,
  RADAR_REFLECTIVITY_STOPS,
  nearestRadarStop,
  remapRadarPixels,
} from '../src/radar-palette.js';

const target = new Date('2024-08-01T12:04:00Z');
const probes = buildRadarProbeTimes(target);
assert(probes.length > 0, 'a valid target should produce radar probe times');
assert.equal(probes[0].toISOString(), '2024-08-01T12:05:00.000Z', 'the nearest future frame should win when it is closer');
assert(probes.every(date => Math.abs(date - target) <= 60 * 60 * 1000), 'probe list must stay inside the advertised ±60 minute window');
assert(probes.some(date => date.toISOString() === '2024-08-01T11:05:00.000Z'), 'the past edge of the ±60 minute window should be included');
assert(probes.some(date => date.toISOString() === '2024-08-01T13:00:00.000Z'), 'the future edge of the ±60 minute window should be included');
assert.deepEqual(buildRadarProbeTimes(new Date('not a date')), []);
assert.deepEqual(buildRadarProbeTimes(null), []);
assert.deepEqual(buildRadarProbeTimes(new Date('2024-08-01T12:00:00Z'), 0), [new Date('2024-08-01T12:00:00Z')]);

const tileUrl = buildIemRadarTileUrl('uscomp', 'n0r', '200508291110');
assert.equal(
  tileUrl,
  'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::USCOMP-N0R-200508291110/{z}/{x}/{y}.png',
  'archived radar should use IEM stable XYZ tiles',
);
assert.equal(
  buildIemRadarTileProbeUrl('hicomp', 'n0q', '201908251200', { z: 3, x: 0, y: 3 }),
  'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::HICOMP-N0Q-201908251200/3/0/3.png',
  'availability probes should use a concrete in-coverage tile',
);
assert.throws(() => buildIemRadarTileUrl('us comp', 'n0r', '200508291110'), /invalid radar tile sector/);
assert.throws(() => buildIemRadarTileUrl('uscomp', 'n0r', 'not-a-stamp'), /invalid radar tile timestamp/);
assert.equal(isRadarFrameResponseAvailable({ ok: true, status: 200 }), true);
assert.equal(isRadarFrameResponseAvailable({ ok: false, status: 404 }), false, '404 should be a normal missing-frame result');
assert.equal(isRadarFrameResponseAvailable({ ok: false, status: 503 }), false, '503 should be a normal missing-frame result');
assert.equal(isRadarFrameResponseAvailable({ ok: false, status: 500 }), false);

assert.deepEqual(
  RADAR_REFLECTIVITY_STOPS.map(stop => stop.dbz),
  [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  'the radar legend must retain the documented 5 dBZ intervals',
);
assert.equal(nearestRadarStop(0, 200, 0).dbz, 25, 'source green should classify as 25 dBZ');
assert.equal(RADAR_COLORBLIND_STOPS.length, RADAR_REFLECTIVITY_STOPS.length);
assert.notEqual(RADAR_COLORBLIND_STOPS[4].color, RADAR_REFLECTIVITY_STOPS[4].color, 'Cividis must differ from the source green');

const sourcePixels = new Uint8ClampedArray([
  0, 0, 0, 255,       // no echo
  0, 200, 0, 255,     // 25 dBZ
  0, 0, 0, 0,         // transparent tile background
]);
assert.deepEqual(
  [...remapRadarPixels(sourcePixels, { colorblind: false })],
  [...sourcePixels],
  'the default radar palette must not rewrite source pixels',
);
const remapped = remapRadarPixels(sourcePixels);
assert.deepEqual([...remapped.slice(0, 4)], [0, 0, 0, 255], 'black no-echo pixels must remain black');
assert.deepEqual([...remapped.slice(8, 12)], [0, 0, 0, 0], 'transparent no-echo pixels must remain transparent');
assert.deepEqual([...remapped.slice(4, 7)], RADAR_COLORBLIND_STOPS[4].rgb, '25 dBZ must use the Cividis LUT stop');

const csp = readFileSync('index.html', 'utf8').match(/Content-Security-Policy" content="([^"]+)/)?.[1] || '';
assert.match(csp, /img-src[^;]*https:\/\/mesonet\.agron\.iastate\.edu/);
assert.match(csp, /connect-src[^;]*https:\/\/mesonet\.agron\.iastate\.edu/);

console.log('radar tiles ok (nearest probing, 404/503 misses, offline URL contract, LUT remap, CSP coverage)');
