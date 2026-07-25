import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { basinForStorm, renderForecastSkillData } from '../src/forecast-skill.js';

const data = JSON.parse(await readFile(new URL('../data/forecast-skill.json', import.meta.url), 'utf8'));
const leads = [0, 12, 24, 36, 48, 60, 72, 96, 120];

assert.equal(data.schema, 1);
assert.equal(data.period.label, '2021-2025');
assert.equal(data.model, 'OFCL');
assert.equal(data.bestTrackAsOf, '2026-05-18');
assert.match(data.sources.methodology, /^https:\/\/www\.nhc\.noaa\.gov\/verification\//);
assert.match(data.sources.summary, /OFCL_5-yr_averages\.pdf$/);

for (const basinId of ['AL', 'EP']) {
  const basin = data.basins[basinId];
  assert.deepEqual(basin.rows.map(row => row.leadHours), leads);
  assert.match(basin.sourceSubsetSha256, /^[a-f0-9]{64}$/);
  assert(basin.rows.every(row =>
    row.trackErrorNmi >= 0 &&
    row.intensityErrorKt >= 0 &&
    Number.isInteger(row.trackSampleSize) &&
    Number.isInteger(row.intensitySampleSize)));
}

assert.deepEqual(
  data.basins.AL.rows.find(row => row.leadHours === 120),
  {
    leadHours: 120,
    trackErrorNmi: 181,
    trackSampleSize: 464,
    intensityErrorKt: 14.7,
    intensitySampleSize: 464,
  },
);
assert.deepEqual(
  data.basins.EP.rows.find(row => row.leadHours === 72),
  {
    leadHours: 72,
    trackErrorNmi: 74,
    trackSampleSize: 574,
    intensityErrorKt: 14.2,
    intensitySampleSize: 573,
  },
  'track and intensity samples must remain distinct when NHC counts differ',
);

assert.equal(basinForStorm({ basin: 'EP' }), 'EP');
assert.equal(basinForStorm({ basin: 'AL' }), 'AL');
const host = { innerHTML: '' };
renderForecastSkillData(host, { basin: 'EP', name: 'GENEVIEVE' }, data);
assert.match(host.innerHTML, /Actual NHC forecast skill/);
assert.match(host.innerHTML, /Measured/);
assert.match(host.innerHTML, /Eastern North Pacific · 2021-2025 · OFCL official forecasts/);
assert.match(host.innerHTML, /archived official forecasts compared with the final post-season best track/);
assert.match(host.innerHTML, /74\.0/);
assert.match(host.innerHTML, /574 \/ 573/);
assert.match(host.innerHTML, /Individual error file/);
assert.match(host.innerHTML, /https:\/\/www\.nhc\.noaa\.gov\/verification\/errors\//);

const panelSource = await readFile(new URL('../src/panel.js', import.meta.url), 'utf8');
assert(
  panelSource.indexOf('forecast-skill-host') < panelSource.indexOf('cone-retro-control'),
  'measured skill must appear separately before illustrative cone controls',
);
assert.match(panelSource, /renderForecastSkill\(document\.getElementById\('forecast-skill-host'\), storm\)/);

console.log('official forecast skill ok (2021-2025 OFCL vs best track, basin tables, distinct samples)');
