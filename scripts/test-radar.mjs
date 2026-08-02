import assert from 'node:assert/strict';

import { buildRadarProbeTimes } from '../src/radar-utils.js';

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

console.log('radar probing ok (nearest frame ordering and symmetric fallback bounds)');
