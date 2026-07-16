import assert from 'node:assert/strict';

import { generateRiskTrajectories } from '../src/art-mode.js';

const start = Date.UTC(2026, 7, 20, 0, 0);
const track = Array.from({ length: 21 }, (_, index) => ({
  t: new Date(start + index * 6 * 60 * 60 * 1000).toISOString(),
  lat: 18 + index * 0.2,
  lon: -82 + index * 0.45,
}));
const storm = { id: 'AL992026', basin: 'AL', track, us_landfalls: [{ t: track.at(-1).t }] };
const radii = { 12: 25, 24: 39, 36: 49, 48: 62, 60: 77, 72: 95, 96: 134, 120: 200 };

const first = generateRiskTrajectories(storm, radii, { count: 20, seed: 42 });
const second = generateRiskTrajectories(storm, radii, { count: 20, seed: 42 });
const different = generateRiskTrajectories(storm, radii, { count: 20, seed: 43 });

assert.equal(first.length, 20);
assert(first.every(path => path.length === 9), 'each path should include the origin and every lead time');
assert(first.every(path => path[0][0] === first[0][0][0] && path[0][1] === first[0][0][1]), 'all plausible paths should share one advisory origin');
assert.deepEqual(first, second, 'a fixed storm/era seed should redraw identical paths');
assert.notDeepEqual(first, different, 'different seeds should produce distinct educational ensembles');
assert(new Set(first.map(path => JSON.stringify(path.at(-1)))).size > 15, 'the ensemble should have diverse endpoints');
assert.deepEqual(generateRiskTrajectories({ track: [] }, radii), []);

console.log('animated risk trajectory utilities ok');
