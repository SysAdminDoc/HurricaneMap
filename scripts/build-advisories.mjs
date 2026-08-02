// Source-faithful replay of archived NHC official forecasts.
//
// Every forecast position, intensity and issue time below is read verbatim from
// the OFCL rows of NHC's archived ATCF a-decks — the same records the forecaster
// issued at the time. Nothing is modelled, interpolated or synthesised here.
//
// The bounded initial era is 2020-2024. That window is not arbitrary: the
// published cone radii the app draws with (`data/cone-radii.json` era "2025")
// are computed from exactly the 2020-2024 forecast sample, so an advisory from
// this era is drawn with its own error statistics rather than a neighbouring
// era's.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { haversineKm, KM_PER_NAUTICAL_MILE } from '../src/geodesy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'advisories.json');

export const ERA = Object.freeze({
  startYear: 2020,
  endYear: 2024,
  coneEra: '2025',
  label: '2020-2024',
});

// U.S.-landfalling Atlantic storms of the era. Each is present in HURDAT2 with
// at least one attributed U.S. landfall, so every replay has a best track to sit
// beside.
export const STORM_IDS = Object.freeze([
  'AL132020', 'AL192020', 'AL282020',
  'AL092021',
  'AL092022', 'AL172022',
  'AL102023',
  'AL022024', 'AL042024', 'AL062024', 'AL092024', 'AL142024',
]);

const ADECK_URL = id => `https://ftp.nhc.noaa.gov/atcf/archive/${id.slice(4)}/a${id.toLowerCase()}.dat.gz`;
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

// An a-deck warning time is the synoptic analysis hour (00/06/12/18Z); NHC issues
// the advisory built on it three hours later, and the archive index is stamped
// with that issuance time. Exact synoptic stamps are accepted too, so a special
// advisory issued off-cycle still resolves.
export function advisoryNumberFor(adeckTime, numberByTime) {
  const issued = new Date(Date.parse(adeckTime) + 3 * 3_600_000).toISOString().replace('.000Z', 'Z');
  return numberByTime.get(issued) ?? numberByTime.get(adeckTime) ?? null;
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
    if (storm.year < ERA.startYear || storm.year > ERA.endYear) {
      throw new Error(`${stormId}: ${storm.year} falls outside the documented ${ERA.label} era`);
    }
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
    model: 'OFCL',
    labels: {
      forecast: 'Preliminary operational forecast as issued (ATCF a-deck, OFCL)',
      actual: 'Final post-season best track (HURDAT2)',
    },
    definitions: {
      forecast: 'Official NHC forecast position and maximum sustained wind at each lead time, verbatim from the archived a-deck.',
      trackError: 'Great-circle distance in nautical miles between the issued forecast position and the best-track position at the same verification time.',
      intensityError: 'Absolute difference in knots between the issued forecast wind and the best-track wind at the same verification time.',
      coverage: 'Errors are reported only where HURDAT2 carries a best-track point at the exact verification time; other leads are omitted rather than interpolated.',
    },
    sources: {
      adeckArchive: 'https://ftp.nhc.noaa.gov/atcf/archive/',
      productArchive: 'https://www.nhc.noaa.gov/archive/',
      format: 'https://www.nrlmry.navy.mil/atcf_web/docs/database/new/abrdeck.html',
      coneRadii: 'https://www.nhc.noaa.gov/verification/pdfs/Verification_2024.pdf',
    },
    totals: { storms: STORM_IDS.length, advisories: totalAdvisories, missingDiscussions: totalMissing },
    storms: output,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const storms = JSON.parse(await readFile(path.join(root, 'data', 'storms.json'), 'utf8'));
  const data = await buildAdvisories(Array.isArray(storms) ? storms : storms.storms);
  await writeFile(outputPath, `${JSON.stringify(data)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)} (${data.totals.storms} storms, ${data.totals.advisories} advisories, ${data.totals.missingDiscussions} without a discussion)`);
}
