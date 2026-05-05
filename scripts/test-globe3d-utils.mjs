import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildGlobeTrackDataset,
  categoryFromWind,
  getTrackHeightMeters,
} from '../src/globe3d.js';

const storms = JSON.parse(await readFile(new URL('../data/storms.json', import.meta.url), 'utf8'));
const landfalls = JSON.parse(await readFile(new URL('../data/landfalls.json', import.meta.url), 'utf8'));

const katrina = storms.find(storm => storm.id === 'AL122005');
assert.ok(katrina, 'Katrina 2005 should exist in storms.json');

const focused = buildGlobeTrackDataset(storms, landfalls, {
  focusStormId: katrina.id,
  maxStorms: 1,
});
assert.equal(focused.storms.length, 1, 'focused globe dataset should include one storm');
assert.equal(focused.storms[0].id, katrina.id, 'focused globe dataset should preserve requested storm id');
assert.ok(focused.segments.length > 0, 'focused globe dataset should create 3D track segments');
assert.ok(focused.timeline.length > 0, 'focused globe dataset should expose timeline values');
assert.ok(focused.segments.every(segment => segment.positions.length === 6), 'segments should contain lon/lat/height endpoints');
assert.ok(focused.maxWind >= 150, 'Katrina focused dataset should preserve high wind values');

const capped = buildGlobeTrackDataset(storms, landfalls, { maxStorms: 5 });
assert.ok(capped.storms.length <= 5, 'maxStorms should cap the selected storm count');
assert.ok(capped.segments.length > capped.storms.length, 'capped dataset should still include multi-point tracks');

assert.equal(categoryFromWind(25), -2, 'sub-tropical-depression winds should be below TS');
assert.equal(categoryFromWind(34), -1, '34 kt should map to tropical storm');
assert.equal(categoryFromWind(64), 1, '64 kt should map to category 1');
assert.equal(categoryFromWind(83), 2, '83 kt should map to category 2');
assert.equal(categoryFromWind(96), 3, '96 kt should map to category 3');
assert.equal(categoryFromWind(113), 4, '113 kt should map to category 4');
assert.equal(categoryFromWind(137), 5, '137 kt should map to category 5');
assert.ok(getTrackHeightMeters(140) > getTrackHeightMeters(40), 'track height should increase with wind speed');

console.log('globe3d utils ok');
