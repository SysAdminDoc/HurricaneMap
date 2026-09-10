// Advisory replay contract: both routes into the dataset, and the dataset's own
// provenance. 2015-2024 comes from the a-deck parser and the product-archive
// index; 2008-2014 comes from the GIS forecast archive, whose reader has its own
// suite in test-gis-archive.mjs. What is checked here is that the two reach one
// shape, and that each record says honestly which route produced it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ERA,
  REPLAY_ERAS,
  STORM_IDS,
  advisoryNumberFor,
  conePublishedForYear,
  coneEraForYear,
  parseAdvisoryIndex,
  parseGisArchiveIndex,
  parseIssueTime,
  parseOfficialForecasts,
  replayRouteForYear,
  ringContains,
  verifyAgainstBestTrack,
} from './build-advisories.mjs';
import {
  buildAdvisoryBounds,
  buildAdvisoryConeSamples,
  clipBestTrack,
  getAdvisoryReplayPosition,
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
// Some older archive pages contain a special advisory at the exact synoptic
// time and an off-cycle first issue a few minutes later; exact and nearest
// historical matches must not skip the numbered series.
const historicalIndex = new Map([
  ['2017-07-31T10:00:00Z', 1],
  ['2017-07-31T12:00:00Z', 2],
  ['2017-07-31T15:00:00Z', 3],
]);
assert.equal(advisoryNumberFor('2017-07-31T06:00:00Z', historicalIndex), 1);
assert.equal(advisoryNumberFor('2017-07-31T12:00:00Z', historicalIndex), 2);

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

assert.deepEqual(
  buildAdvisoryBounds(
    { f: [[0, 20, -95], [12, 22, -91]] },
    [[21, -94], [23, -90]],
    [[19, -96], [22, -92]],
  ),
  [[19, -96], [23, -90]],
  'advisory bounds must include forecast, cone, and clipped best-track geometry',
);
assert.equal(buildAdvisoryBounds({ f: [] }), null, 'empty advisory geometry has no bounds');

const gappedReplay = {
  advisories: [{ n: 1 }, { n: 3 }, { n: 4 }],
};
const gappedPosition = getAdvisoryReplayPosition(gappedReplay.advisories.length - 1, gappedReplay.advisories.length);
assert.deepEqual(gappedPosition, { index: 2, number: 3, count: 3 });
assert.ok(
  Math.max(...gappedReplay.advisories.map(advisory => advisory.n)) >= gappedPosition.number,
  'a missing NHC advisory number must not inflate the replay ordinal',
);
assert.equal(
  getAdvisoryReplayPosition(99, gappedReplay.advisories.length).index,
  gappedReplay.advisories.length - 1,
  'presentation helper must clamp its index to the replay records',
);

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

// The GIS index decides which advisories exist for a storm, and the numbering
// is not contiguous: an intermediate carries a trailing letter and sorts between
// two whole numbers, not after both.
{
  const html = `
    <a href="/gis/forecast/archive/al092008_5day_020.zip">20</a>
    <a href="/gis/forecast/archive/al092008_5day_019A.zip">19A</a>
    <a href="/gis/forecast/archive/al092008_5day_019.zip">19</a>
    <a href="/gis/forecast/archive/al092008_5day_009.zip">9</a>
    <a href="/gis/forecast/archive/al092008_5day_009.zip">9 again</a>
    <a href="/gis/forecast/archive/al112008_5day_003.zip">another storm</a>`;
  assert.deepEqual(parseGisArchiveIndex(html, 'al092008'), [
    'al092008_5day_009.zip',
    'al092008_5day_019.zip',
    'al092008_5day_019A.zip',
    'al092008_5day_020.zip',
  ], 'the index is ordered by number then letter, deduplicated, and scoped to one storm');
  assert.deepEqual(parseGisArchiveIndex(html, 'al992099'), [], 'a storm with no files lists none');
  // The archive pads its numbers to three digits, so a plain string sort agrees
  // with this today. Ordering on the parsed number and letter is what keeps that
  // a coincidence rather than a dependency, and this is the case that would
  // separate them if the padding ever went away.
  assert.deepEqual(
    parseGisArchiveIndex('<a href="x_5day_9.zip">a</a><a href="x_5day_20.zip">b</a><a href="x_5day_9A.zip">c</a>', 'x'),
    ['x_5day_9.zip', 'x_5day_9A.zip', 'x_5day_20.zip'],
    'unpadded numbers still order numerically, with the intermediate after its own advisory',
  );
}

{
  const square = [[0, 0], [0, 2], [2, 2], [2, 0]];
  assert.equal(ringContains(square, 1, 1), true);
  assert.equal(ringContains(square, 3, 1), false);
  assert.equal(ringContains(square, 1, 3), false);
}

const archive = JSON.parse(await readFile(path.join(root, 'data/advisories.json'), 'utf8'));
assert.equal(archive.schema, 1);
assert.equal(archive.model, 'OFCL');
assert.equal(archive.era.startYear, ERA.startYear);
assert.equal(archive.era.endYear, ERA.endYear);
assert.equal(archive.era.label, ERA.label);
assert.deepEqual(archive.eras, REPLAY_ERAS);
assert.deepEqual(Object.keys(archive.storms).sort(), [...STORM_IDS].sort());
assert.equal(archive.totals.storms, STORM_IDS.length);

const storms = JSON.parse(await readFile(path.join(root, 'data/storms.json'), 'utf8'));
const stormsById = new Map((Array.isArray(storms) ? storms : storms.storms).map(storm => [storm.id, storm]));
const radii = JSON.parse(await readFile(path.join(root, 'data/cone-radii.json'), 'utf8'));
// An era either names a radii table that exists, or publishes its cones and
// needs none. Nothing may do neither, and nothing may claim both.
for (const replayEra of REPLAY_ERAS) {
  if (replayEra.publishedCone) {
    assert.equal(replayEra.coneEra, null, `${replayEra.label}: a published-cone era must not also name a radii table`);
    assert.ok(!replayEra.coneEraByYear, `${replayEra.label}: a published-cone era must not carry per-year radii`);
    continue;
  }
  for (const coneEra of Object.values(replayEra.coneEraByYear || { _: replayEra.coneEra })) {
    assert.ok(radii.eras[coneEra], `${coneEra}: declared cone era must exist in cone-radii.json`);
  }
}
assert.equal(coneEraForYear(2007), null, 'years before the archive remain unavailable');
assert.equal(replayRouteForYear(2007), null);
assert.equal(coneEraForYear(2014), null, 'the GIS era has no radii table');
assert.equal(replayRouteForYear(2014), 'gis-archive');
assert.equal(conePublishedForYear(2014), true);
assert.equal(coneEraForYear(2015), '2015');
assert.equal(replayRouteForYear(2015), 'adeck');
assert.equal(conePublishedForYear(2015), false);
assert.equal(coneEraForYear(2024), '2025');

for (const [stormId, record] of Object.entries(archive.storms)) {
  const storm = stormsById.get(stormId);
  assert.ok(storm, `${stormId}: replayed storm is absent from storms.json`);
  assert.equal(record.name, storm.name, `${stormId}: name disagrees with HURDAT2`);
  assert.equal(record.year, storm.year, `${stormId}: year disagrees with HURDAT2`);
  assert.equal(record.coneEra, coneEraForYear(record.year), `${stormId}: record must use its published cone era`);
  const published = conePublishedForYear(record.year);
  assert.equal(Boolean(record.publishedCone), published, `${stormId}: record disagrees with its era about where the cone comes from`);
  if (published) {
    assert.equal(record.coneEra, null, `${stormId}: a published-cone record must not name a radii era`);
  } else {
    assert.ok(radii.eras[record.coneEra], `${stormId}: record cone era is absent from cone-radii.json`);
    if (record.year <= 2019) {
      assert.equal(radii.eras[record.coneEra].sampleYears, `${record.year - 5}-${record.year - 1}`, `${stormId}: annual cone sample must precede the replay year`);
    } else {
      assert.equal(radii.eras[record.coneEra].sampleYears, '2020-2024', `${stormId}: initial-era cone sample must match its pooled era`);
    }
  }
  assert.ok(storm.year >= ERA.startYear && storm.year <= ERA.endYear, `${stormId}: outside the declared era`);
  assert.equal(record.advisories.length, record.advisoryCount, `${stormId}: advisory count disagrees with its own list`);
  assert.equal(Number(record.advisories[0].n), 1, `${stormId}: replay must start at advisory 1`);

  // NHC's intermediate advisories are numbered 19A, 20A and so on. Only the GIS
  // archive carries them, so the a-deck era never produced one, and a numeric
  // comparison turns '6A' into NaN and passes silently.
  const rank = value => {
    const match = /^(\d+)([A-Za-z]*)$/.exec(String(value));
    assert.ok(match, `${stormId}: advisory number ${JSON.stringify(value)} is not a number with an optional letter`);
    return [Number(match[1]), match[2]];
  };
  let previous = [0, ''];
  for (const advisory of record.advisories) {
    const rankedNow = rank(advisory.n);
    assert.ok(
      rankedNow[0] > previous[0] || (rankedNow[0] === previous[0] && rankedNow[1] > previous[1]),
      `${stormId}: advisory ${advisory.n} does not come after ${previous.join('')}`,
    );
    previous = rankedNow;
    assert.ok(advisory.f.length, `${stormId}/${advisory.n}: an advisory with no forecast is not a replay`);
    // The first entry is where the storm was when the advisory went out. That is
    // lead 0 for an a-deck record, whose clock starts at the synoptic analysis,
    // and lead 3 or 6 for a GIS record, whose first row is the position at
    // issuance. Either way it is the earliest lead.
    const leads = advisory.f.map(entry => entry[0]);
    assert.equal(leads[0], Math.min(...leads), `${stormId}/${advisory.n}: forecasts are not ordered by lead`);
    assert.deepEqual(leads, [...leads].sort((a, b) => a - b), `${stormId}/${advisory.n}: leads are out of order`);
    // Leads are rounded to whole hours, so two rows could in principle collide
    // and one would be dropped silently by the first-wins merge.
    assert.equal(new Set(leads).size, leads.length, `${stormId}/${advisory.n}: two forecast rows share a lead`);
    if (published) {
      assert.ok(
        advisory.f[0][0] > 0 && advisory.f[0][0] <= 12,
        `${stormId}/${advisory.n}: a GIS record opens at issuance, ${advisory.f[0][0]} h after its origin`,
      );
      // Leads are whole hours, because that is how an advisory labels them and
      // what the a-deck era already carries, while `issued` keeps the exact
      // time. A special advisory can go out at a 45-minute offset, as Dolly's
      // first did, so the two agree to within the rounding and no further.
      const gapHours = (Date.parse(advisory.issued) - Date.parse(advisory.t)) / 3600000;
      assert.ok(
        Math.abs(gapHours - advisory.f[0][0]) <= 0.5,
        `${stormId}/${advisory.n}: the first entry is ${advisory.f[0][0]} h in but the advisory went out ${gapHours} h after its origin`,
      );
      assert.ok(Number.isInteger(advisory.f[0][0]), `${stormId}/${advisory.n}: leads are whole hours`);
      assert.ok(Array.isArray(advisory.c) && advisory.c.length >= 3, `${stormId}/${advisory.n}: a published-cone record must carry a polygon`);
      assert.ok([72, 120].includes(advisory.conePeriodHours), `${stormId}/${advisory.n}: cone period ${advisory.conePeriodHours} is not one NHC draws`);
      assert.ok(
        ringContains(advisory.c, advisory.f[0][1], advisory.f[0][2]),
        `${stormId}/${advisory.n}: the cone does not contain the position its own advisory reports`,
      );
    } else {
      assert.equal(advisory.f[0][0], 0, `${stormId}/${advisory.n}: an a-deck record starts at its own analysis`);
      assert.ok(!advisory.c, `${stormId}/${advisory.n}: this era has no published cone to carry`);
    }
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
