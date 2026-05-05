import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildStateDensityIndex,
  estimatePopulationExposure,
  formatExposurePeople,
  inferredInnerCoreAreaSqMi,
  windRadiiAreaSqMi,
} from '../src/exposure.js';

const storms = JSON.parse(await readFile(new URL('../data/storms.json', import.meta.url), 'utf8'));
const states = JSON.parse(await readFile(new URL('../data/us-states.geojson', import.meta.url), 'utf8'));
const stateDensities = buildStateDensityIndex(states);

assert.ok(stateDensities.Florida > 300, 'state density index should read Florida from us-states.geojson');
assert.ok(stateDensities.Louisiana > 90, 'state density index should read Louisiana from us-states.geojson');

const katrina = storms.find(storm => storm.id === 'AL122005');
assert.ok(katrina, 'Katrina 2005 should exist');
const katrinaExposure = estimatePopulationExposure(katrina, { stateDensities });
assert.equal(katrinaExposure.available, true, 'Katrina should have a population exposure estimate');
assert.equal(katrinaExposure.headline_label, 'Cat-2+', 'headline should use the Cat-2+ exposure metric when available');
assert.ok(katrinaExposure.analyzed_records > 0, 'Katrina exposure should analyze landfall-adjacent wind-radii records');
assert.ok(katrinaExposure.affected_states.includes('Florida'), 'Katrina exposure should include Florida');
assert.ok(katrinaExposure.affected_states.includes('Louisiana'), 'Katrina exposure should include Louisiana');
assert.ok(katrinaExposure.exposed.cat1 > katrinaExposure.exposed.cat2, 'Cat-1+ exposure should exceed Cat-2+ exposure');
assert.ok(katrinaExposure.exposed.cat2 > katrinaExposure.exposed.cat3, 'Cat-2+ exposure should exceed Cat-3+ exposure');
assert.ok(katrinaExposure.exposed.cat3 > 0, 'Katrina should have Cat-3+ exposure');

const michael = storms.find(storm => storm.id === 'AL142018');
assert.ok(michael, 'Michael 2018 should exist');
const michaelExposure = estimatePopulationExposure(michael, { stateDensities });
assert.equal(michaelExposure.available, true, 'Michael should have a population exposure estimate');
assert.ok(michaelExposure.exposed.cat5 > 0, 'Michael should have nonzero Cat-5 exposure');
assert.ok(michaelExposure.exposed.cat3 > michaelExposure.exposed.cat5, 'Cat-3+ exposure should exceed Cat-5 exposure');

const donna = storms.find(storm => storm.id === 'AL051960');
assert.ok(donna, 'Donna 1960 should exist');
const donnaExposure = estimatePopulationExposure(donna, { stateDensities });
assert.equal(donnaExposure.available, false, 'pre-radii storms should report exposure unavailable');

const fullCircle64 = windRadiiAreaSqMi([10, 10, 10, 10]);
assert.ok(Math.abs(fullCircle64 - Math.PI * 100 * 1.324293337) < 0.001, 'wind-radii area should sum four quadrant arcs');
assert.equal(inferredInnerCoreAreaSqMi(fullCircle64, 82, 83), 0, 'Cat-2 area should be zero below Cat-2 threshold');
assert.ok(inferredInnerCoreAreaSqMi(fullCircle64, 140, 137) > 0, 'Cat-5 area should be nonzero above Cat-5 threshold');
assert.equal(formatExposurePeople(1_250_000), '1.3M', 'exposure formatter should compact millions');
assert.equal(formatExposurePeople(8_000), '<10K', 'exposure formatter should avoid false precision for very small counts');

console.log('exposure utils ok');
