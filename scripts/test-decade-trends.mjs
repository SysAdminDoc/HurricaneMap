import assert from 'node:assert/strict';

import { buildDecadeTrendSeries } from '../src/decade-trends.js';

const track = (year, wind) => [{ t: `${year}-08-01T00:00:00Z`, wind }];
const storms = new Map([
  ['A', { name: 'ALPHA', track: track(2001, 100) }],
  ['B', { name: 'BETA', track: track(2008, 80) }],
  ['C', { name: 'CHARLIE', track: track(2011, 120) }],
  ['D', { name: 'DELTA', track: track(2012, 20) }],
]);
const impacts = new Map([
  ['A', { deaths_total: 10, deaths: '10', damage_millions_usd: 500, damages: '$500 million' }],
  ['B', { deaths_total: 50, deaths: '50', damage_millions_usd: 100, damages: '$100 million' }],
  ['C', { deaths_total: 5, deaths: '5', damage_millions_usd: 700, damages: '$700 million' }],
]);
const landfalls = [
  { storm_id: 'A', year: 2001 },
  { storm_id: 'A', year: 2001 },
  { storm_id: 'B', year: 2008 },
  { storm_id: 'C', year: 2011 },
  { storm_id: 'D', year: 2012 },
];

const series = buildDecadeTrendSeries(
  landfalls,
  id => storms.get(id),
  id => impacts.get(id),
);
assert.deepEqual(series.map(({ decade, named, major, majorPct }) => ({ decade, named, major, majorPct })), [
  { decade: '2000s', named: 2, major: 1, majorPct: '50' },
  { decade: '2010s', named: 1, major: 1, majorPct: '100' },
]);
assert.ok(Math.abs(series[0].ace - 1.64) < 1e-12, `unexpected 2000s ACE: ${series[0].ace}`);
assert.ok(Math.abs(series[1].ace - 1.44) < 1e-12, `unexpected 2010s ACE: ${series[1].ace}`);
assert.deepEqual(series[0].deadliest, {
  id: 'B', name: 'BETA', year: 2008, deaths: 50, rawDeaths: '50',
});
assert.deepEqual(series[0].costliest, {
  id: 'A', name: 'ALPHA', year: 2001, damages: 500, rawDamages: '$500 million',
});
assert.equal(series[1].deadliest.id, 'C');
assert.equal(series[1].costliest.id, 'C');
assert.deepEqual(buildDecadeTrendSeries([], () => null, () => null), []);

console.log('decade trends aggregation ok (buckets, major share, ACE, and impact rankings)');
