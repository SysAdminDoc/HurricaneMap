import assert from 'node:assert/strict';

import { getDamageMillions, getFatalityCount } from '../src/impact-utils.js';
import { csvEscape } from '../src/export.js';
import { findImpactLeader } from '../src/report.js';

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

console.log('report export ok');
