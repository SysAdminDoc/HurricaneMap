// Advisory replay contract: both routes into the dataset, and the dataset's own
// provenance. 2015-2024 comes from the forecast/advisory product NHC archived
// for each advisory; 2008-2014 comes from the GIS forecast archive, whose reader
// has its own suite in test-gis-archive.mjs. What is checked here is that the
// two reach one shape, and that each record says honestly which route produced
// it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ERA,
  REPLAY_ERAS,
  STORM_IDS,
  conePublishedForYear,
  coneEraForYear,
  parseAdvisoryIndex,
  parseForecastAdvisory,
  parseGisArchiveIndex,
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

// --- forecast/advisory product parsing ------------------------------------

// The shape NHC has published since long before this era starts. The lines
// between the ones that matter are here because they are in the real product
// and a reader has to skip them: the wind-radii block sits between a forecast
// position and the next one, and "REPEAT" restates the current position.
const product = (...body) => [
  'ZCZC MIATCMAT4 ALL',
  'TTAA00 KNHC DDHHMM',
  '',
  'HURRICANE MILTON FORECAST/ADVISORY NUMBER   9',
  'NWS NATIONAL HURRICANE CENTER MIAMI FL       AL142024',
  '1500 UTC SAT OCT 05 2024',
  '',
  'HURRICANE CENTER LOCATED NEAR 19.0N  94.5W AT 05/1500Z',
  'POSITION ACCURATE WITHIN  30 NM',
  '',
  'MAX SUSTAINED WINDS  30 KT WITH GUSTS TO  40 KT.',
  '',
  'REPEAT...CENTER LOCATED NEAR 19.0N  94.5W AT 05/1500Z',
  'AT 05/1200Z CENTER WAS LOCATED NEAR 18.7N  94.9W',
  '',
  ...body,
  '',
  'NEXT ADVISORY AT 05/2100Z',
  '$$',
].join('\n');

const TCM = product(
  'FORECAST VALID 06/0000Z 20.0N  93.5W',
  'MAX WIND  45 KT...GUSTS  55 KT.',
  '34 KT... 40NE  40SE   0SW  30NW.',
  '',
  'FORECAST VALID 06/1200Z 21.3N  92.0W',
  'MAX WIND  65 KT...GUSTS  80 KT.',
  '50 KT... 20NE  20SE   0SW  10NW.',
  '',
  'OUTLOOK VALID 09/1200Z 26.0N  84.0W',
  'MAX WIND  70 KT...GUSTS  85 KT.',
);

const productAdvisory = parseForecastAdvisory(TCM, { issuedIso: '2024-10-05T15:00:00Z', label: 'AL142024 advisory 9' });
assert.equal(productAdvisory.n, 9);
assert.equal(productAdvisory.t, '2024-10-05T12:00:00Z', 'the forecast is initialised on the analysis, not on issuance');
assert.equal(productAdvisory.issued, '2024-10-05T15:00:00Z');
assert.deepEqual(productAdvisory.f, [
  // Where the storm was when the advisory went out, three hours after the
  // analysis its forecast runs from.
  [3, 19.0, -94.5, 30],
  [12, 20.0, -93.5, 45],
  [24, 21.3, -92.0, 65],
  // An outlook is a forecast at a longer lead, and its day-of-month crosses
  // into the range the analysis month does not cover on its own.
  [96, 26.0, -84.0, 70],
], 'every stated position is a row, with leads measured from the analysis');

// A southern/eastern hemisphere product, which the Atlantic archive never
// serves but the sign handling has to get right regardless.
assert.deepEqual(
  parseForecastAdvisory(
    product('FORECAST VALID 06/0000Z 20.0S  93.5E', 'MAX WIND  45 KT...GUSTS  55 KT.')
      .replace('19.0N  94.5W', '19.0S  94.5E')
      .replace('18.7N  94.9W', '18.7S  94.9E'),
    { issuedIso: '2024-10-05T15:00:00Z' },
  ).f,
  [[3, -19.0, 94.5, 30], [12, -20.0, 93.5, 45]],
  'hemisphere suffixes must set the sign',
);

// The last advisory of a storm forecasts nothing, and says so in words. That is
// a complete advisory, not a truncated read.
const dissipating = parseForecastAdvisory(
  product('FORECAST VALID 06/0000Z...DISSIPATED'),
  { issuedIso: '2024-10-05T15:00:00Z' },
);
assert.deepEqual(dissipating.f, [[3, 19.0, -94.5, 30]], 'a dissipating advisory carries its position and no forecast');

// Everything that would shorten or skew a forecast silently has to throw.
const refusesProduct = (text, why) => assert.throws(
  () => parseForecastAdvisory(text, { issuedIso: '2024-10-05T15:00:00Z', label: 'fixture' }),
  new RegExp(why),
  `parsing did not refuse ${why}`,
);
refusesProduct(product('FORECAST VALID 06/0000Z 20.0N  93.5W'), 'states no maximum wind');
refusesProduct(product('FORECAST VALID 06/0000Z 20.0N', 'MAX WIND  45 KT.'), 'cannot read the forecast line');
refusesProduct(TCM.replace(/^FORECAST VALID.*$/gm, '').replace(/^OUTLOOK VALID.*$/gm, ''), 'no forecast or outlook line');
refusesProduct(TCM.replace('AT 05/1200Z CENTER WAS LOCATED NEAR', 'AT 05/1200Z THE CENTRE SAT NEAR'), 'states no analysis time');
refusesProduct(TCM.replace('FORECAST/ADVISORY NUMBER   9', 'ADVISORY NUMBER   9'), 'no forecast/advisory number');
refusesProduct(TCM.replace('MAX SUSTAINED WINDS  30 KT', 'WINDS ARE  30 KT'), 'states no current intensity');
// An analysis that is not a synoptic hour, and a lead that is not a whole
// number of twelve-hour steps from it: two readings of the same instant, so a
// misread analysis line cannot pass both.
refusesProduct(TCM.replace('AT 05/1200Z CENTER WAS', 'AT 05/1300Z CENTER WAS'), 'not on a synoptic hour');
refusesProduct(TCM.replace('FORECAST VALID 06/0000Z', 'FORECAST VALID 06/0600Z'), 'twelve-hour steps');
// A forecast that verifies before the analysis it runs from is a rollover the
// day-of-month stamp cannot express, not a forecast.
refusesProduct(TCM.replace('FORECAST VALID 06/0000Z', 'FORECAST VALID 04/0000Z'), 'inside the forecast window');

// --- archive index --------------------------------------------------------

const INDEX = `
<!-- 20241005 1500 --><a href="/archive/2024/al14/al142024.fstadv.001.shtml">1:&nbsp;1500 UTC</a>
<!-- 20241005 2100 --><a href="/archive/2024/al14/al142024.fstadv.002.shtml">2:&nbsp;2100 UTC</a>
<!-- 20241005 1100 --><a href="/archive/2024/al14/al142024.discus.001.shtml">1:&nbsp;1000 AM CDT</a>
<!-- 20241005 1700 --><a href="/archive/2024/al14/al142024.discus.002.shtml">2:&nbsp;0400 PM CDT</a>
<!-- 20241005 1500 --><a href="/archive/2024/al09/al092024.fstadv.001.shtml">other storm</a>
`;
const index = parseAdvisoryIndex(INDEX, 'al142024');
assert.equal(index.advisories.length, 2, 'another storm in the same year must not leak in');
assert.deepEqual(index.advisories[0], {
  n: 1,
  issued: '2024-10-05T15:00:00Z',
  url: 'https://www.nhc.noaa.gov/archive/2024/al14/al142024.fstadv.001.shtml',
}, 'each advisory carries the moment it went out and the product that states it');
assert.deepEqual(index.advisories.map(entry => entry.n), [1, 2], 'the index is ordered by advisory number');
assert.equal(index.discussionByNumber.get(2), 'https://www.nhc.noaa.gov/archive/2024/al14/al142024.discus.002.shtml');

// --- verification against the best track ----------------------------------

const track = new Map([
  ['2024-10-06T00:00:00Z', { t: '2024-10-06T00:00:00Z', lat: 20.0, lon: -93.5, wind: 60 }],
  ['2024-10-06T12:00:00Z', { t: '2024-10-06T12:00:00Z', lat: 22.0, lon: -91.0, wind: 90 }],
]);
const errors = verifyAgainstBestTrack(productAdvisory, track);
assert.deepEqual(errors.map(entry => entry[0]), [12, 24], 'lead 0 is not a forecast and must not be verified');
assert.equal(errors[0][1], 0, 'an exactly correct forecast position must score zero track error');
assert.equal(errors[0][2], 15, 'intensity error is the absolute wind difference');
assert.ok(errors[1][1] > 0, 'a displaced forecast must score a positive track error');

const noOverlap = verifyAgainstBestTrack(productAdvisory, new Map());
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
  productAdvisory,
);
assert.equal(clipped.length, 3, 'a best-track point before the advisory went out is not part of its comparison line');
assert.deepEqual(clipped[0], [19, -94.5]);
assert.deepEqual(clipped.at(-1), [28, -82], 'the window runs to the longest lead the advisory forecast');

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

// The schema's record-level cone rule, driven with the shapes a review found it
// letting through. Blocking the half-claim on a single advisory was not enough:
// a record naming a radii era could carry a full and false published cone on
// every advisory, and the app would tell the reader the rebuilt outline was the
// one NHC drew.
{
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const schema = JSON.parse(await readFile(path.join(root, 'schemas/advisories-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: true, allErrors: false }).compile(schema);

  const cone = [[25, -80], [26, -81], [27, -80]];
  const radiiAdvisory = { n: 1, t: '2017-09-05T00:00:00Z', issued: '2017-09-05T03:00:00Z', f: [[3, 25, -80, 100]], e: [], discussion: null };
  const gisAdvisory = { ...radiiAdvisory, c: cone, conePeriodHours: 120 };
  const record = (extra, advisories) => ({
    schema: 1,
    era: { startYear: 2008, endYear: 2024, coneEra: 'per-record', label: '2008-2024' },
    eras: [{ startYear: 2008, endYear: 2024, label: '2008-2024', coneEra: null, publishedCone: true }],
    model: 'OFCL',
    labels: { forecast: 'x', actual: 'y' },
    definitions: { forecast: 'a', trackError: 'b', intensityError: 'c', coverage: 'd', cone: 'e' },
    sources: {
      productArchive: 'https://b/', format: 'https://c/',
      coneRadii: 'https://d/', gisArchive: 'https://e/',
    },
    totals: { storms: 1, advisories: 1, missingDiscussions: 0 },
    storms: {
      AL092017: {
        name: 'IRMA', year: 2017, basin: 'AL', atcfId: 'al092017',
        coneEra: '2017', sourceUrl: 'https://a/', archiveUrl: 'https://b/',
        sourceSubsetSha256: 'a'.repeat(64), advisoryCount: 1,
        missingDiscussions: 0, advisories, ...extra,
      },
    },
  });

  const refuses = (document, why) => assert.ok(!validate(document), `the schema accepts ${why}`);
  const accepts = (document, why) => assert.ok(validate(document), `the schema refuses ${why}: ${JSON.stringify(validate.errors?.[0])}`);

  accepts(record({}, [radiiAdvisory]), 'an ordinary record drawn from a radii era');
  accepts(record({ coneEra: null, publishedCone: true }, [gisAdvisory]), 'an ordinary published-cone record');

  refuses(record({}, [gisAdvisory]), 'a radii-era record whose advisory carries a full published cone');
  refuses(record({ coneEra: null, publishedCone: true }, [radiiAdvisory]), 'a published-cone record whose advisory carries no cone');
  refuses(record({ publishedCone: true }, [gisAdvisory]), 'a published-cone record that also names a radii era');
  refuses(record({ coneEra: null }, [radiiAdvisory]), 'a record that names no cone source at all');
  refuses(record({}, [{ ...radiiAdvisory, c: cone }]), 'a radii-era advisory carrying only a cone');
  refuses(record({}, [{ ...radiiAdvisory, issued: undefined }]), 'an advisory that does not say when it went out');
  refuses(
    record({ coneEra: null, publishedCone: true }, [{ ...gisAdvisory, c: [[25, -80], [26, -81]] }]),
    'a two-point cone',
  );
  refuses(record({ coneEra: null, publishedCone: true }, [{ ...gisAdvisory, conePeriodHours: 48 }]), 'a 48 h cone period');
  for (const bad of ['0A', '12a', '1AB', '007', 0, -3, 1.5]) {
    refuses(record({ coneEra: null, publishedCone: true }, [{ ...gisAdvisory, n: bad }]), `the advisory number ${JSON.stringify(bad)}`);
  }
  accepts(record({ coneEra: null, publishedCone: true }, [{ ...gisAdvisory, n: '19A' }]), 'an intermediate advisory number');
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
assert.equal(replayRouteForYear(2015), 'product-archive');
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
    // The first entry is where the storm was when the advisory went out, which
    // is after the synoptic hour its forecast runs from and so never lead 0.
    // Either way it is the earliest lead.
    const leads = advisory.f.map(entry => entry[0]);
    assert.equal(leads[0], Math.min(...leads), `${stormId}/${advisory.n}: forecasts are not ordered by lead`);
    assert.deepEqual(leads, [...leads].sort((a, b) => a - b), `${stormId}/${advisory.n}: leads are out of order`);
    // Leads are rounded to whole hours, so two rows could in principle collide
    // and one would be dropped silently by the first-wins merge.
    assert.equal(new Set(leads).size, leads.length, `${stormId}/${advisory.n}: two forecast rows share a lead`);
    // Both routes open at issuance, and both record it. The GIS package states
    // it in its own header, the product archive in the index that lists it.
    assert.ok(
      advisory.f[0][0] > 0 && advisory.f[0][0] <= 12,
      `${stormId}/${advisory.n}: a record opens at issuance, ${advisory.f[0][0]} h after its origin`,
    );
    // Leads are whole hours, because that is how an advisory labels them, while
    // `issued` keeps the exact time. A special advisory can go out at a
    // 45-minute offset, as Dolly's first did and Alberto 2018's eleventh did,
    // so the two agree to within the rounding and no further.
    const gapHours = (Date.parse(advisory.issued) - Date.parse(advisory.t)) / 3600000;
    assert.ok(
      Math.abs(gapHours - advisory.f[0][0]) <= 0.5,
      `${stormId}/${advisory.n}: the first entry is ${advisory.f[0][0]} h in but the advisory went out ${gapHours} h after its origin`,
    );
    assert.ok(Number.isInteger(advisory.f[0][0]), `${stormId}/${advisory.n}: leads are whole hours`);
    if (published) {
      assert.ok(Array.isArray(advisory.c) && advisory.c.length >= 3, `${stormId}/${advisory.n}: a published-cone record must carry a polygon`);
      assert.ok([72, 120].includes(advisory.conePeriodHours), `${stormId}/${advisory.n}: cone period ${advisory.conePeriodHours} is not one NHC draws`);
      assert.ok(
        ringContains(advisory.c, advisory.f[0][1], advisory.f[0][2]),
        `${stormId}/${advisory.n}: the cone does not contain the position its own advisory reports`,
      );
    } else {
      assert.ok(!advisory.c, `${stormId}/${advisory.n}: this era has no published cone to carry`);
      // Every lead past the current position is a whole number of twelve-hour
      // steps from the analysis, which is the second reading that pins the
      // forecast clock down.
      for (const lead of leads.slice(1)) {
        assert.equal(lead % 12, 0, `${stormId}/${advisory.n}: a ${lead} h lead is not a twelve-hour step from the analysis`);
      }
    }
    if (advisory.discussion) {
      assert.ok(
        advisory.discussion.startsWith(`https://www.nhc.noaa.gov/archive/${record.year}/`),
        `${stormId}/${advisory.n}: discussion link leaves the NHC archive for that season`,
      );
    }
    // Every verified lead must correspond to a lead that was actually forecast,
    // and must not be the first one. The first entry is where the storm already
    // was when the advisory went out. Scoring it counted an observation as a
    // forecast for 335 of the 776 GIS-era advisories and pulled the reported
    // mean track error down 13 percent, because the old rule skipped lead 0 and
    // that era's current position sits at 3, 6 or 7.
    const forecastLeads = new Set(advisory.f.map(entry => entry[0]));
    for (const [lead] of advisory.e) {
      assert.ok(forecastLeads.has(lead), `${stormId}/${advisory.n}: verified a ${lead} h lead that was never forecast`);
      assert.notEqual(lead, advisory.f[0][0], `${stormId}/${advisory.n}: scored its own current position as a forecast`);
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
