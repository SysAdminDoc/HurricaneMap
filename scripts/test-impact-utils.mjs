import assert from 'node:assert/strict';

import {
  formatFatalityCount,
  getDamageMillions,
  getFatalityCount,
  getNominalDamageUsd,
} from '../src/impact-utils.js';

assert.equal(getFatalityCount({ deaths: '506 direct, 7 indirect' }), 513);
assert.equal(getFatalityCount({ deaths: '592-1,192' }), 1192);
assert.equal(getFatalityCount({ deaths: 'None reported' }), 0);
assert.equal(getFatalityCount({ deaths_total: 1601, deaths: 'stale raw value' }), 1601);

assert.equal(getDamageMillions({ damages: '150000000' }), 150);
assert.equal(getDamageMillions({ damages: '75000' }), 0.075);
assert.equal(getDamageMillions({ damages: '1419800000+14000000' }), 1433.8);
assert.equal(getDamageMillions({ damages: '3.75' }), 3.75);
assert.equal(getDamageMillions({ damages: '$1.2 billion' }), 1200);
assert.equal(getDamageMillions({ damage_millions_usd: 125000, damages: 'legacy' }), 125000);
assert.equal(getNominalDamageUsd({ damage_millions_usd: 150 }), 150000000);

assert.equal(formatFatalityCount(1192), '1,192');
assert.equal(formatFatalityCount(12000), '12k');

console.log('impact utils ok');
