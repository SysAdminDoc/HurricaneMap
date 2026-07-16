import assert from 'node:assert/strict';

import { getDamageMillions, getFatalityCount } from '../src/impact-utils.js';
import { tornadoSearchUrl } from '../src/impact-utils.js';
import { getCoverageYearRange } from '../src/data.js';
import { csvEscape, publicationCategoryLabel } from '../src/export.js';
import { inflateUSD } from '../src/inflation.js';
import { buildFilterTitle, findImpactLeader } from '../src/report.js';

const landfalls = [
  { storm_id: 'ALPHA2000', name: 'ALPHA', year: 2000, wind: 80 },
  { storm_id: 'BETA2001', name: 'BETA', year: 2001, wind: 90 },
  { storm_id: 'ALPHA2000', name: 'ALPHA', year: 2000, wind: 60 },
];

const impacts = {
  ALPHA2000: { deaths_total: 12, damage_millions_usd: 450 },
  BETA2001: { deaths_total: 2, damage_millions_usd: 1500 },
};

assert.equal(findImpactLeader(landfalls, getFatalityCount, { getImpacts: id => impacts[id] }).storm_id, 'ALPHA2000');
assert.equal(findImpactLeader(landfalls, getDamageMillions, { getImpacts: id => impacts[id] }).storm_id, 'BETA2001');

assert.equal(csvEscape('=HYPERLINK("https://example.com")', { preventFormula: true }), `"'=HYPERLINK(""https://example.com"")"`);
assert.equal(csvEscape('-89.600', { preventFormula: false }), '-89.600');
assert.equal(csvEscape('Louisiana, USA'), '"Louisiana, USA"');
assert.equal(publicationCategoryLabel(0), 'TD');
assert.equal(publicationCategoryLabel(-1), 'TS');

assert.deepEqual(getCoverageYearRange({ coverage: { year_range: [2026, 1851] } }), [1851, 2026]);
assert.equal(
  buildFilterTitle({ yearMin: 1851, yearMax: 2026, categories: new Set(['ts', '1', '2', '3', '4', '5']), state: '' }, [1851, 2026]),
  'All landfalls (1851-2026, all categories, all states)',
);

const futureDamage = inflateUSD(125, 2025);
assert.deepEqual(futureDamage, { real: 125, factor: 1, baseYear: 2025, currentDollars: true });

const tornadoUrl = tornadoSearchUrl({
  year: 2005,
  track: [{ t: '2005-08-23T18:00:00Z' }, { t: '2005-08-31T18:00:00Z' }],
  us_landfalls: [{ state: 'Louisiana' }, { state: 'Mississippi' }, { state: 'Florida' }, { state: 'Oregon' }],
});
assert(!tornadoUrl.includes('%252C'), 'state filter separators must be encoded only once');
assert.equal(new URL(tornadoUrl).searchParams.get('statefips'), '22,LOUISIANA,28,MISSISSIPPI,12,FLORIDA');

console.log('report export ok');
