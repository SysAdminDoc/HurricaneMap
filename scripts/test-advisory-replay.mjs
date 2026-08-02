// Advisory replay contract: the a-deck parser, the archive-index mapping, the
// best-track verification, and the shipped dataset's own provenance.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ERA,
  STORM_IDS,
  advisoryNumberFor,
  parseAdvisoryIndex,
  parseIssueTime,
  parseOfficialForecasts,
  verifyAgainstBestTrack,
} from './build-advisories.mjs';
import {
  buildAdvisoryConeSamples,
  clipBestTrack,
  getStormAdvisories,
  summarizeAdvisoryErrors,
} from '../src/advisory-replay.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- a-deck parsing -------------------------------------------------------

const ADECK = [
  'AL, 14, 2024100512, 03, OFCL,   0, 190N,  945W,  30, 1004, TD,  34, NEQ,    0,    0,    0,    0',
  'AL, 14, 2024100512, 03, OFCL,  12, 200N,  935W,  45,    0, TS,  34, NEQ,   40,   40,    0,   30',
  // Same lead repeated for the 50 kt radii block: position and intensity are
  // identical, so the duplicate must not become a second forecast point.
  'AL, 14, 2024100512, 03, OFCL,  12, 200N,  935W,  45,    0, TS,  50, NEQ,   20,   20,    0,   10',
  'AL, 14, 2024100512, 03, OFCL,  24, 213N,  920W,  65,    0, HU,  34, NEQ,   50,   50,    0,   40',
  'AL, 14, 2024100518, 03, OFCL,   0, 197N,  938W,  40, 1002, TS,  34, NEQ,   30,   30,    0,   20',
  'AL, 14, 2024100518, 03, OFCL,  12, 205N,  928W,  55,    0, TS,  34, NEQ,   50,   50,    0,   40',
  // Southern/eastern hemisphere sign handling and a non-OFCL model that must be
  // ignored entirely.
  'AL, 14, 2024100518, 03, AVNO,  12, 205N,  928W,  55,    0, TS,  34, NEQ,   50,   50,    0,   40',
].join('\n');

const parsed = parseOfficialForecasts(ADECK);
assert.equal(parsed.length, 2, 'expected two distinct issue times');
assert.equal(parsed[0].t, '2024-10-05T12:00:00Z');
assert.deepEqual(parsed[0].f, [
  [0, 19.0, -94.5, 30],
  [12, 20.0, -93.5, 45],
  [24, 21.3, -92.0, 65],
], 'duplicate wind-radii rows must collapse to one point per lead');
assert.equal(parsed[1].f.length, 2, 'non-OFCL models must be ignored');

assert.equal(parseIssueTime('2024100512'), '2024-10-05T12:00:00Z');
assert.equal(parseIssueTime('nonsense'), null);

const southern = parseOfficialForecasts('AL, 01, 2024100512, 03, OFCL,   0, 190S,  945E,  30, 1004, TD,  34, NEQ, 0, 0, 0, 0');
assert.deepEqual(southern[0].f, [[0, -19.0, 94.5, 30]], 'hemisphere suffixes must set the sign');

// --- archive index --------------------------------------------------------

const INDEX = `
<!-- 20241005 1500 --><a href="/archive/2024/al14/al142024.fstadv.001.shtml">1:&nbsp;1500 UTC</a>
<!-- 20241005 2100 --><a href="/archive/2024/al14/al142024.fstadv.002.shtml">2:&nbsp;2100 UTC</a>
<!-- 20241005 1100 --><a href="/archive/2024/al14/al142024.discus.001.shtml">1:&nbsp;1000 AM CDT</a>
<!-- 20241005 1700 --><a href="/archive/2024/al14/al142024.discus.002.shtml">2:&nbsp;0400 PM CDT</a>
<!-- 20241005 1500 --><a href="/archive/2024/al09/al092024.fstadv.001.shtml">other storm</a>
`;
const index = parseAdvisoryIndex(INDEX, 'al142024');
assert.equal(index.numberByTime.size, 2, 'another storm in the same year must not leak in');
assert.equal(index.discussionByNumber.get(2), 'https://www.nhc.noaa.gov/archive/2024/al14/al142024.discus.002.shtml');

// An a-deck warning time is the synoptic hour; the advisory built on it is
// issued three hours later, which is how the index stamps it.
assert.equal(advisoryNumberFor('2024-10-05T12:00:00Z', index.numberByTime), 1);
assert.equal(advisoryNumberFor('2024-10-05T18:00:00Z', index.numberByTime), 2);
assert.equal(advisoryNumberFor('2024-10-07T00:00:00Z', index.numberByTime), null, 'a post-tropical tail must not be numbered');
// A special advisory stamped at the synoptic hour itself still resolves.
assert.equal(advisoryNumberFor('2024-10-05T15:00:00Z', index.numberByTime), 1);

// --- verification against the best track ----------------------------------

const track = new Map([
  ['2024-10-06T00:00:00Z', { t: '2024-10-06T00:00:00Z', lat: 20.0, lon: -93.5, wind: 60 }],
  ['2024-10-06T12:00:00Z', { t: '2024-10-06T12:00:00Z', lat: 22.0, lon: -91.0, wind: 90 }],
]);
const errors = verifyAgainstBestTrack(parsed[0], track);
assert.deepEqual(errors.map(entry => entry[0]), [12, 24], 'lead 0 is not a forecast and must not be verified');
assert.equal(errors[0][1], 0, 'an exactly correct forecast position must score zero track error');
assert.equal(errors[0][2], 15, 'intensity error is the absolute wind difference');
assert.ok(errors[1][1] > 0, 'a displaced forecast must score a positive track error');

const noOverlap = verifyAgainstBestTrack(parsed[0], new Map());
assert.deepEqual(noOverlap, [], 'leads without a best-track point are omitted, never interpolated');

// --- presentation helpers -------------------------------------------------

const cone = buildAdvisoryConeSamples(
  { f: [[0, 19, -94.5, 30], [12, 20, -93.5, 45], [24, 21.3, -92, 65], [168, 30, -80, 20]] },
  { 12: 25, 24: 39 },
);
assert.deepEqual(cone.map(sample => sample.hours), [0, 12, 24], 'leads without a published radius cannot enter the cone');
assert.equal(cone[0].radius, 0, 'the initial position carries no cone radius');

const summary = summarizeAdvisoryErrors({ e: [[12, 10, 5], [48, 90, null], [24, 40, 15]] });
assert.equal(summary.verifiedLeads, 3);
assert.equal(summary.longestLeadHours, 48, 'the longest verified lead drives the headline error');
assert.equal(summary.longestLeadTrackErrorNmi, 90);
assert.equal(summary.meanIntensityErrorKt, 10, 'null intensity errors must not count toward the mean');
assert.equal(summarizeAdvisoryErrors({ e: [] }).meanTrackErrorNmi, null);

const clipped = clipBestTrack(
  {
    track: [
      { t: '2024-10-05T06:00:00Z', lat: 18, lon: -95 },
      { t: '2024-10-05T12:00:00Z', lat: 19, lon: -94.5 },
      { t: '2024-10-06T12:00:00Z', lat: 22, lon: -91 },
      { t: '2024-10-08T00:00:00Z', lat: 28, lon: -82 },
    ],
  },
  parsed[0],
);
assert.equal(clipped.length, 2, 'the comparison line is clipped to the forecast window');
assert.deepEqual(clipped[0], [19, -94.5]);

// --- the shipped dataset --------------------------------------------------

const archive = JSON.parse(await readFile(path.join(root, 'data/advisories.json'), 'utf8'));
assert.equal(archive.schema, 1);
assert.equal(archive.model, 'OFCL');
assert.equal(archive.era.startYear, ERA.startYear);
assert.equal(archive.era.endYear, ERA.endYear);
assert.deepEqual(Object.keys(archive.storms).sort(), [...STORM_IDS].sort());
assert.equal(archive.totals.storms, STORM_IDS.length);

const storms = JSON.parse(await readFile(path.join(root, 'data/storms.json'), 'utf8'));
const stormsById = new Map((Array.isArray(storms) ? storms : storms.storms).map(storm => [storm.id, storm]));
const radii = JSON.parse(await readFile(path.join(root, 'data/cone-radii.json'), 'utf8'));
assert.ok(radii.eras[archive.era.coneEra], 'the declared cone era must exist in cone-radii.json');
assert.equal(
  radii.eras[archive.era.coneEra].sampleYears,
  `${ERA.startYear}-${ERA.endYear}`,
  'the cone radii must be derived from the same years the replay covers',
);

for (const [stormId, record] of Object.entries(archive.storms)) {
  const storm = stormsById.get(stormId);
  assert.ok(storm, `${stormId}: replayed storm is absent from storms.json`);
  assert.equal(record.name, storm.name, `${stormId}: name disagrees with HURDAT2`);
  assert.equal(record.year, storm.year, `${stormId}: year disagrees with HURDAT2`);
  assert.ok(storm.year >= ERA.startYear && storm.year <= ERA.endYear, `${stormId}: outside the declared era`);
  assert.equal(record.advisories.length, record.advisoryCount, `${stormId}: advisory count disagrees with its own list`);
  assert.equal(record.advisories[0].n, 1, `${stormId}: replay must start at advisory 1`);

  let previous = 0;
  for (const advisory of record.advisories) {
    assert.ok(advisory.n > previous, `${stormId}: advisory numbers must strictly increase`);
    previous = advisory.n;
    assert.ok(advisory.f.length, `${stormId}/${advisory.n}: an advisory with no forecast is not a replay`);
    assert.equal(advisory.f[0][0], 0, `${stormId}/${advisory.n}: forecasts must start at the initial position`);
    if (advisory.discussion) {
      assert.ok(
        advisory.discussion.startsWith(`https://www.nhc.noaa.gov/archive/${record.year}/`),
        `${stormId}/${advisory.n}: discussion link leaves the NHC archive for that season`,
      );
    }
    // Every verified lead must correspond to a lead that was actually forecast.
    const forecastLeads = new Set(advisory.f.map(entry => entry[0]));
    for (const [lead] of advisory.e) {
      assert.ok(forecastLeads.has(lead), `${stormId}/${advisory.n}: verified a ${lead} h lead that was never forecast`);
    }
  }
  assert.equal(
    getStormAdvisories(archive, stormId).advisoryCount,
    record.advisoryCount,
    `${stormId}: lookup helper disagrees with the archive`,
  );
}
assert.equal(getStormAdvisories(archive, 'AL121851'), null, 'a storm outside the era must degrade to null');

console.log(`advisory replay ok (${archive.totals.storms} storms, ${archive.totals.advisories} archived advisories, ${archive.totals.missingDiscussions} without a discussion)`);
