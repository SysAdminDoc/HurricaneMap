// Source-faithful replay of archived NHC official forecasts.
//
// Every forecast position, intensity and issue time below is read verbatim from
// what NHC archived. Nothing is modelled, interpolated or synthesised here.
//
// Two eras, reaching the same record shape by different routes.
//
// 2015-2024 reads the OFCL rows of the archived ATCF a-decks and draws the cone
// from the published radii of the advisory's own era. The 2020-2024 records use
// the NHC five-year table published for 2025, whose sample is exactly 2020-2024;
// the 2015-2019 records carry the annual operational table for the year each
// advisory was issued in, taken from the NHC annual verification reports and
// never borrowed from a neighbouring year.
//
// 2008-2014 reads NHC's GIS forecast archive instead, one zip per advisory. It
// has to: `data/cone-radii.json` has no era that far back, and the tables that
// would fill it are prose in decade-old PDFs. The GIS package carries the cone
// NHC actually drew, as a polygon, which is better than any reconstruction, so
// those records ship the published outline and say so. scripts/gis-archive.mjs
// documents what that archive does to a reader who trusts the specifications.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { haversineKm, KM_PER_NAUTICAL_MILE } from '../src/geodesy.js';
import { readAdvisoryArchive } from './gis-archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'advisories.json');

export const REPLAY_ERAS = Object.freeze([
  Object.freeze({
    startYear: 2008,
    endYear: 2014,
    label: '2008-2014',
    // No radii table reaches back here, and none is needed: every advisory in
    // this era carries the cone NHC drew, as a polygon, in its GIS package.
    coneEra: null,
    publishedCone: true,
  }),
  Object.freeze({
    startYear: 2015,
    endYear: 2019,
    label: '2015-2019',
    coneEraByYear: Object.freeze({
      2015: '2015',
      2016: '2016',
      2017: '2017',
      2018: '2018',
      2019: '2019',
    }),
  }),
  Object.freeze({
    startYear: 2020,
    endYear: 2024,
    label: '2020-2024',
    coneEra: '2025',
  }),
]);

export const ERA = Object.freeze({
  startYear: REPLAY_ERAS[0].startYear,
  endYear: REPLAY_ERAS.at(-1).endYear,
  coneEra: 'per-record',
  label: `${REPLAY_ERAS[0].startYear}-${REPLAY_ERAS.at(-1).endYear}`,
});

/** Does this year's cone come from the archive, or from a radii table? */
export function conePublishedForYear(year) {
  const numericYear = Number(year);
  const era = REPLAY_ERAS.find(({ startYear, endYear }) => numericYear >= startYear && numericYear <= endYear);
  return Boolean(era?.publishedCone);
}

export function coneEraForYear(year) {
  const numericYear = Number(year);
  const era = REPLAY_ERAS.find(({ startYear, endYear }) => numericYear >= startYear && numericYear <= endYear);
  if (!era) return null;
  return era.coneEraByYear?.[numericYear] || era.coneEra || null;
}

/**
 * Whether this storm can be built at all, and by which route. A year inside a
 * published-cone era needs no radii; a year outside every era needs both and
 * has neither, which is an error rather than a silent skip.
 */
export function replayRouteForYear(year) {
  const numericYear = Number(year);
  const era = REPLAY_ERAS.find(({ startYear, endYear }) => numericYear >= startYear && numericYear <= endYear);
  if (!era) return null;
  return era.publishedCone ? 'gis-archive' : 'adeck';
}

// U.S.-landfalling Atlantic storms of the era. Each is present in HURDAT2 with
// at least one attributed U.S. landfall, so every replay has a best track to sit
// beside.
export const STORM_IDS = Object.freeze([
  // 2008-2014, built from the GIS archive.
  'AL042008', 'AL052008', 'AL062008', 'AL072008', 'AL082008', 'AL092008',
  'AL042009',
  'AL022010', 'AL032010', 'AL102010',
  'AL042011', 'AL092011', 'AL132011',
  'AL022012', 'AL042012', 'AL092012', 'AL182012',
  'AL012013',
  'AL012014',
  // 2015-2024, built from the a-decks.
  'AL012015', 'AL022015',
  'AL022016', 'AL032016', 'AL092016', 'AL112016', 'AL142016',
  'AL032017', 'AL062017', 'AL092017', 'AL112017', 'AL152017', 'AL162017',
  'AL012018', 'AL062018', 'AL072018', 'AL142018',
  'AL022019', 'AL052019', 'AL112019', 'AL122019',
  'AL132020', 'AL192020', 'AL282020',
  'AL092021',
  'AL092022', 'AL172022',
  'AL102023',
  'AL022024', 'AL042024', 'AL062024', 'AL092024', 'AL142024',
]);

const ADECK_URL = id => `https://ftp.nhc.noaa.gov/atcf/archive/${id.slice(4)}/a${id.toLowerCase()}.dat.gz`;
const GIS_INDEX_URL = id => `https://www.nhc.noaa.gov/gis/archive_forecast_results.php?id=${id.slice(0, 4).toLowerCase()}&year=${id.slice(4)}`;
const GIS_ADVISORY_URL = name => `https://www.nhc.noaa.gov/gis/forecast/archive/${name}`;
const ARCHIVE_URL = (year, name) => `https://www.nhc.noaa.gov/archive/${year}/${name.toUpperCase()}.shtml`;

// Coverage is measured against the archive index, never against the a-deck: an
// a-deck keeps carrying OFCL rows through the post-tropical stage long after NHC
// stopped issuing advisories, so a large unmatched tail is normal. Failing to
// resolve the advisories NHC actually issued is not — that means the archive
// layout moved and the scrape is silently truncating the replay.
const MIN_ADVISORY_COVERAGE = 0.8;

function parseLatitude(field) {
  const match = /^(\d+)([NS])$/.exec(field);
  if (!match) return NaN;
  const value = Number(match[1]) / 10;
  return match[2] === 'S' ? -value : value;
}

function parseLongitude(field) {
  const match = /^(\d+)([EW])$/.exec(field);
  if (!match) return NaN;
  const value = Number(match[1]) / 10;
  return match[2] === 'W' ? -value : value;
}

export function parseIssueTime(stamp) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return `${year}-${month}-${day}T${hour}:00:00Z`;
}

// ATCF a-decks repeat each forecast hour once per wind-radii threshold (34/50/64
// kt). Position and intensity are identical across those rows, so the first one
// wins and the rest are dropped.
export function parseOfficialForecasts(text) {
  const byIssue = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.includes('OFCL')) continue;
    const fields = line.split(',').map(field => field.trim());
    if (fields[4] !== 'OFCL') continue;
    const issue = parseIssueTime(fields[2]);
    const tau = Number(fields[5]);
    const lat = parseLatitude(fields[6]);
    const lon = parseLongitude(fields[7]);
    const wind = Number(fields[8]);
    if (!issue || !Number.isInteger(tau) || tau < 0) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(wind)) continue;
    if (!byIssue.has(issue)) byIssue.set(issue, new Map());
    const forecasts = byIssue.get(issue);
    if (!forecasts.has(tau)) forecasts.set(tau, [tau, lat, lon, wind]);
  }
  return [...byIssue.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([t, forecasts]) => ({ t, f: [...forecasts.values()].sort((a, b) => a[0] - b[0]) }));
}

// The storm's archive index is the authority on advisory numbering, so nothing
// here counts ordinals. Each link is preceded by an HTML comment carrying the
// product's own timestamp; the forecast/advisory (fstadv) products are stamped
// in UTC and share the a-deck's synoptic times, which is what ties an archived
// discussion to the forecast it explains.
export function parseAdvisoryIndex(html, atcfId) {
  const pattern = new RegExp(
    `<!--\\s*(\\d{8})\\s+(\\d{4})\\s*-->\\s*<a href="(/archive/(\\d{4})/([a-z]{2}\\d{2})/${atcfId}\\.(fstadv|discus)\\.(\\d{3})\\.shtml)`,
    'gi',
  );
  const numberByTime = new Map();
  const discussionByNumber = new Map();
  for (const match of String(html).matchAll(pattern)) {
    const [, date, time, , year, cy, kind, sequence] = match;
    const number = Number(sequence);
    if (kind.toLowerCase() === 'fstadv') {
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2)}:00Z`;
      if (!numberByTime.has(iso)) numberByTime.set(iso, number);
    } else {
      discussionByNumber.set(number, `https://www.nhc.noaa.gov/archive/${year}/${cy}/${atcfId}.discus.${sequence}.shtml`);
    }
  }
  return { numberByTime, discussionByNumber };
}

// An a-deck warning time is usually the synoptic analysis hour (00/06/12/18Z);
// NHC usually issues the advisory built on it three hours later, and the archive
// index is stamped with that issuance time. Historical archive pages also carry
// special advisories at the exact synoptic stamp or a nearby off-cycle minute,
// so those are accepted before a nearest-time fallback is considered.
export function advisoryNumberFor(adeckTime, numberByTime) {
  const adeckMs = Date.parse(adeckTime);
  if (!Number.isFinite(adeckMs)) return null;
  const exact = numberByTime.get(adeckTime);
  if (exact !== undefined) return exact;
  const issued = new Date(adeckMs + 3 * 3_600_000).toISOString().replace('.000Z', 'Z');
  const scheduled = numberByTime.get(issued);
  if (scheduled !== undefined) return scheduled;
  let nearest = null;
  for (const [stamp, number] of numberByTime) {
    const candidateMs = Date.parse(stamp);
    const distance = Math.abs(candidateMs - (adeckMs + 3 * 3_600_000));
    if (distance > 3 * 60 * 60_000) continue;
    if (!nearest || distance < nearest.distance || (distance === nearest.distance && number < nearest.number)) {
      nearest = { distance, number };
    }
  }
  return nearest?.number ?? null;
}

// Verified against the post-season best track only where HURDAT2 carries a point
// at the exact verification time. No interpolation: a forecast that verifies
// between synoptic times simply reports no error for that lead.
export function verifyAgainstBestTrack(advisory, trackByTime) {
  const issueMs = Date.parse(advisory.t);
  const errors = [];
  for (const [tau, lat, lon, wind] of advisory.f) {
    if (tau <= 0) continue;
    const verifyAt = new Date(issueMs + tau * 3_600_000).toISOString().replace('.000Z', 'Z');
    const actual = trackByTime.get(verifyAt);
    if (!actual) continue;
    const trackErrorNmi = haversineKm(lat, lon, actual.lat, actual.lon) / KM_PER_NAUTICAL_MILE;
    errors.push([
      tau,
      Math.round(trackErrorNmi * 10) / 10,
      Number.isFinite(actual.wind) ? Math.abs(wind - actual.wind) : null,
    ]);
  }
  return errors;
}

function bestTrackIndex(storm) {
  const index = new Map();
  for (const point of storm?.track || []) {
    if (!index.has(point.t)) index.set(point.t, point);
  }
  return index;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

/**
 * The advisory files that exist for a storm, in the order they were issued.
 *
 * Read from the archive's own index rather than probed by counting upwards,
 * because the numbering is not contiguous: intermediate advisories carry a
 * trailing letter, and a storm can have 019, 019A, 020 with nothing between.
 */
export function parseGisArchiveIndex(html, atcfId) {
  const names = [...new Set(String(html).match(new RegExp(`${atcfId}_5day_[0-9A-Za-z]+\\.zip`, 'g')) || [])];
  const numbered = names.map(name => {
    const [, digits, letter = ''] = /_5day_(\d+)([A-Za-z]*)\.zip$/.exec(name);
    return { name, number: Number(digits), letter };
  });
  return numbered
    .sort((a, b) => a.number - b.number || (a.letter < b.letter ? -1 : a.letter > b.letter ? 1 : 0))
    .map(entry => entry.name);
}

async function fetchBinary(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * One storm's replay, read from the GIS forecast archive.
 *
 * Every advisory listed has to parse. A gap here is not a post-tropical tail
 * that can be dropped the way an unnumbered a-deck row can: the index says the
 * file exists, so failing to read it means the reader is wrong about the format
 * and the replay would silently skip advisories nobody would miss.
 */
export async function buildStormFromGisArchive(storm, stormId, fetchImpl) {
  const atcfId = stormId.toLowerCase();
  const indexUrl = GIS_INDEX_URL(stormId);
  const files = parseGisArchiveIndex(await fetchText(indexUrl, fetchImpl), atcfId);
  if (!files.length) throw new Error(`${stormId}: the GIS archive index at ${indexUrl} lists no advisory`);

  const advisories = [];
  for (const file of files) {
    const buffer = await fetchBinary(GIS_ADVISORY_URL(file), fetchImpl);
    advisories.push(readAdvisoryArchive(buffer, { stormId, label: `${stormId} ${file}` }));
  }
  advisories.sort((a, b) => Date.parse(a.issued) - Date.parse(b.issued));

  // Two invariants worth failing on rather than shipping. A replay is a
  // sequence, so two advisories at one moment would make the scrubber
  // ambiguous; and a cone that does not contain the position its own advisory
  // reports means the polygon and the points came from different packages.
  for (let index = 1; index < advisories.length; index += 1) {
    if (Date.parse(advisories[index].issued) <= Date.parse(advisories[index - 1].issued)) {
      throw new Error(
        `${stormId}: advisory ${advisories[index].n} is issued at or before ${advisories[index - 1].n}`,
      );
    }
  }
  for (const advisory of advisories) {
    if (!ringContains(advisory.c, advisory.f[0][1], advisory.f[0][2])) {
      throw new Error(`${stormId}: the cone for advisory ${advisory.n} does not contain its own position`);
    }
  }

  return { atcfId, indexUrl, files, advisories };
}

/** Ray casting, on [lat, lon] pairs. */
export function ringContains(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function fetchAdeck(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
}

export async function buildAdvisories(storms, fetchImpl = fetch) {
  const stormsById = new Map((storms || []).map(storm => [storm.id, storm]));
  const output = {};
  let totalAdvisories = 0;
  let totalMissing = 0;

  for (const stormId of STORM_IDS) {
    const storm = stormsById.get(stormId);
    if (!storm) throw new Error(`${stormId}: not present in storms.json`);
    const route = replayRouteForYear(storm.year);
    if (!route) throw new Error(`${stormId}: ${storm.year} falls outside the documented ${ERA.label} era`);

    if (route === 'gis-archive') {
      const { atcfId: gisAtcfId, indexUrl, files, advisories } = await buildStormFromGisArchive(storm, stormId, fetchImpl);
      const trackByTime = bestTrackIndex(storm);
      totalAdvisories += advisories.length;
      output[stormId] = {
        name: storm.name,
        year: storm.year,
        basin: storm.basin,
        atcfId: gisAtcfId,
        // Null on purpose: this era's cone is the one NHC published, not one
        // rebuilt from a radii table, and a reader is told which they are
        // looking at.
        coneEra: null,
        publishedCone: true,
        sourceUrl: indexUrl,
        archiveUrl: indexUrl,
        sourceSubsetSha256: createHash('sha256').update(files.join('\n')).digest('hex'),
        advisoryCount: advisories.length,
        unmatchedForecasts: 0,
        // NHC issues a discussion with a full advisory and not with an
        // intermediate one, and the GIS package carries neither. Linking them
        // would mean a second scrape of the product archive and a rule for
        // mapping 6A onto discussion 6, which is a guess this does not need to
        // make.
        missingDiscussions: advisories.length,
        advisories: advisories.map(advisory => ({
          n: advisory.n,
          t: advisory.t,
          issued: advisory.issued,
          f: advisory.f,
          c: advisory.c,
          conePeriodHours: advisory.conePeriodHours,
          discussion: null,
          e: verifyAgainstBestTrack(advisory, trackByTime),
        })),
      };
      totalMissing += advisories.length;
      continue;
    }

    const coneEra = coneEraForYear(storm.year);
    if (!coneEra) throw new Error(`${stormId}: ${storm.year} has no cone era and no published cone`);
    const atcfId = stormId.toLowerCase();
    const sourceUrl = ADECK_URL(stormId);
    const archiveUrl = ARCHIVE_URL(storm.year, storm.name);

    const adeck = await fetchAdeck(sourceUrl, fetchImpl);
    const advisories = parseOfficialForecasts(adeck);
    if (!advisories.length) throw new Error(`${stormId}: a-deck carries no OFCL forecasts`);

    const { numberByTime, discussionByNumber } = parseAdvisoryIndex(await fetchText(archiveUrl, fetchImpl), atcfId);
    // A forecast whose synoptic time the archive index does not list cannot be
    // numbered, and an unnumbered advisory cannot be tied to its discussion. The
    // commonest reason is a post-tropical continuation: the a-deck keeps carrying
    // OFCL rows after NHC stopped issuing advisories, and those are dropped.
    const numbered = advisories
      .map(advisory => ({ ...advisory, n: advisoryNumberFor(advisory.t, numberByTime) }))
      .filter(advisory => advisory.n !== null);
    if (!numberByTime.size) throw new Error(`${stormId}: no advisories found at ${archiveUrl}`);
    if (numbered.length / numberByTime.size < MIN_ADVISORY_COVERAGE) {
      throw new Error(`${stormId}: only ${numbered.length}/${numberByTime.size} archived advisories resolved from ${archiveUrl}`);
    }
    if (numbered.length && numbered[0].n !== 1) {
      throw new Error(`${stormId}: replay starts at advisory ${numbered[0].n} instead of 1`);
    }
    const covered = numbered.filter(advisory => discussionByNumber.has(advisory.n)).length;

    const trackByTime = bestTrackIndex(storm);
    const ofclSubset = adeck.split(/\r?\n/).filter(line => line.split(',')[4]?.trim() === 'OFCL').join('\n');
    const missing = numbered.length - covered;
    totalAdvisories += numbered.length;
    totalMissing += missing;

    output[stormId] = {
      name: storm.name,
      year: storm.year,
      basin: storm.basin,
      atcfId,
      coneEra,
      sourceUrl,
      archiveUrl,
      sourceSubsetSha256: createHash('sha256').update(ofclSubset).digest('hex'),
      advisoryCount: numbered.length,
      unmatchedForecasts: advisories.length - numbered.length,
      missingDiscussions: missing,
      advisories: numbered.map(advisory => ({
        ...advisory,
        discussion: discussionByNumber.get(advisory.n) || null,
        e: verifyAgainstBestTrack(advisory, trackByTime),
      })),
    };
  }

  return {
    schema: 1,
    era: ERA,
    eras: REPLAY_ERAS,
    model: 'OFCL',
    labels: {
      forecast: 'Preliminary operational forecast as issued (ATCF a-deck OFCL from 2015, NHC GIS forecast archive before it)',
      actual: 'Final post-season best track (HURDAT2)',
    },
    definitions: {
      forecast: 'Official NHC forecast position and maximum sustained wind at each lead time, verbatim from the archived a-deck.',
      trackError: 'Great-circle distance in nautical miles between the issued forecast position and the best-track position at the same verification time.',
      intensityError: 'Absolute difference in knots between the issued forecast wind and the best-track wind at the same verification time.',
      coverage: 'Errors are reported only where HURDAT2 carries a best-track point at the exact verification time; other leads are omitted rather than interpolated.',
      cone: 'From 2015 the cone is drawn around the issued forecast positions with the published error radii of that advisory\'s era. Before 2015 no radii table exists, and the record instead carries the cone polygon NHC published with the advisory, read from its GIS package and simplified to within 1.2 km of the outline.',
    },
    sources: {
      adeckArchive: 'https://ftp.nhc.noaa.gov/atcf/archive/',
      productArchive: 'https://www.nhc.noaa.gov/archive/',
      format: 'https://www.nrlmry.navy.mil/atcf_web/docs/database/new/abrdeck.html',
      coneRadii: 'https://www.nhc.noaa.gov/verification/pdfs/Verification_2024.pdf',
      gisArchive: 'https://www.nhc.noaa.gov/gis/archive_forecast.php',
    },
    totals: { storms: STORM_IDS.length, advisories: totalAdvisories, missingDiscussions: totalMissing },
    storms: output,
  };
}

// Keyed on the URL, under tmp/ so it never reaches a commit. `--no-cache`
// forces every fetch, which is what to use when the question is whether the
// upstream archive has changed.
function cachingFetch(directory) {
  let served = 0;
  let fetched = 0;
  const impl = async url => {
    const key = String(url).replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_').slice(0, 180);
    const file = path.join(directory, key);
    try {
      const body = await readFile(file);
      served += 1;
      return new Response(body, { status: 200 });
    } catch { /* not cached yet */ }
    const response = await fetch(url);
    if (!response.ok) return response;
    const body = Buffer.from(await response.arrayBuffer());
    await mkdir(directory, { recursive: true });
    await writeFile(file, body);
    fetched += 1;
    return new Response(body, { status: 200 });
  };
  impl.report = () => `${fetched} fetched, ${served} from ${path.relative(root, directory)}`;
  return impl;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const storms = JSON.parse(await readFile(path.join(root, 'data', 'storms.json'), 'utf8'));
  const useCache = !process.argv.includes('--no-cache');
  const fetchImpl = useCache ? cachingFetch(path.join(root, 'tmp', 'advisory-archive')) : fetch;
  const data = await buildAdvisories(Array.isArray(storms) ? storms : storms.storms, fetchImpl);
  if (useCache) console.log(`advisory sources: ${fetchImpl.report()}`);
  await writeFile(outputPath, `${JSON.stringify(data)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)} (${data.totals.storms} storms, ${data.totals.advisories} advisories, ${data.totals.missingDiscussions} without a discussion)`);
}
