import assert from 'node:assert/strict';

import { buildClimatologySeries } from '../src/climatology.js';

const storms = new Map([
  ['A', {
    track: [
      { t: '2000-08-01T00:00:00Z', wind: 40 },
      { t: '2000-08-01T06:00:00Z', wind: 50 },
      { t: '2000-08-01T12:00:00Z', wind: 20 },
    ],
  }],
  ['B', {
    track: [
      { t: '2001-09-01T00:00:00Z', wind: 60 },
      { t: '2001-09-01T03:00:00Z', wind: 80 },
    ],
  }],
]);
const landfalls = [
  { storm_id: 'A', year: 2000 },
  { storm_id: 'A', year: 2000 },
  { storm_id: 'B', year: 2001 },
  { storm_id: 'missing', year: 2001 },
];

const result = buildClimatologySeries(landfalls, id => storms.get(id));
assert.equal(result.yearMin, 2000);
assert.equal(result.yearMax, 2001);
assert.deepEqual(result.series.map(({ year, named, landfalls: count }) => ({ year, named, landfalls: count })), [
  { year: 2000, named: 1, landfalls: 2 },
  { year: 2001, named: 1, landfalls: 2 },
]);
assert.ok(Math.abs(result.series[0].ace - 0.41) < 1e-12, `unexpected 2000 ACE: ${result.series[0].ace}`);
assert.ok(Math.abs(result.series[1].ace - 0.36) < 1e-12, `unexpected 2001 ACE: ${result.series[1].ace}`);
assert.deepEqual(buildClimatologySeries([], () => null), { series: [], yearMin: null, yearMax: null });

console.log('climatology aggregation ok (year buckets, named threshold, ACE, and missing tracks)');
