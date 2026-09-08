import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildClimatologySeries } from '../src/climatology.js';
import { computeACE } from '../src/metrics.js';

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
// A literal figure computed from the shipped data rather than from a fixture.
// The smoke run prints "2005 ACE 108.8" and asserted only that it was above
// zero, so every digit of it was unpinned: a change to the summation or to the
// 34 kt threshold could move the number and nothing would notice.
//
// This is not the published 2005 Atlantic ACE of about 250. data/storms.json
// carries the storms that made a US landfall, seven of them in 2005, and 108.8
// is their total. It is the figure the app itself renders, which is what this
// exists to pin.
{
  const stormsPath = new URL('../data/storms.json', import.meta.url);
  const storms = JSON.parse(await readFile(stormsPath, 'utf8'));
  const rows = Array.isArray(storms) ? storms : Object.values(storms);
  const terms = rows
    .filter(storm => String(storm.id || '').startsWith('AL') && String(storm.id || '').endsWith('2005'))
    .map(storm => computeACE(storm.track || []).value);
  const total = terms.reduce((sum, term) => sum + term, 0);
  assert.equal(
    Number(total.toFixed(1)),
    108.8,
    `2005 Atlantic ACE must stay 108.8 across ${terms.length} storms, got ${total.toFixed(3)}`,
  );
}
