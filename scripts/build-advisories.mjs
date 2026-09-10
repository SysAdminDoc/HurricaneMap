// Source-faithful replay of archived NHC official forecasts.
//
// Every forecast position, intensity and issue time below is read verbatim from
// what NHC archived. Nothing is modelled, interpolated or synthesised here.
//
// Two eras, reaching the same record shape by different routes.
//
// 2015-2024 reads the forecast/advisory product NHC archived for each advisory
// and draws the cone from the published radii of the advisory's own era. The
// 2020-2024 records use the NHC five-year table published for 2025, whose sample
// is exactly 2020-2024; the 2015-2019 records carry the annual operational table
// for the year each advisory was issued in, taken from the NHC annual
// verification reports and never borrowed from a neighbouring year.
//
// It used to read the ATCF a-decks instead, and that was wrong in a way nothing
// noticed for as long as it existed. An a-deck is a database of forecast cycles
// and a cycle is not an advisory: a special advisory issued off the six-hourly
// clock has no cycle of its own, so it went missing, and where one was issued
// at a synoptic hour exactly it took the number of the advisory that followed
// it. 22 advisories were absent and eight records carried the next advisory's
// forecast.
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

import { haversineKm, KM_PER_NAUTICAL_MILE } from '../src/geodesy.js';
import { CONE_MAX_DEVIATION_KM, parseValidTime, readAdvisoryArchive } from './gis-archive.mjs';

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
  return era.publishedCone ? 'gis-archive' : 'product-archive';
}

// The Atlantic storms this atlas counts as making a U.S. landfall, which is the
// list in data/landfalls.json rather than HURDAT2's `L` rows alone. Every replay
// therefore has a best track to sit beside, and the storm is one a reader can
// already find on the map.
//
// One entry rests on an inference rather than an attributed landfall, and is
// listed here so nobody re-raises it: Hermine 2010's only `L` row is at
// 25.3N 97.4W, in Tamaulipas, and NHC's report puts its landfall on the
// northeastern coast of Mexico. preprocess_hurdat2.py infers a Texas landfall
// from the track crossing the coast north of the Rio Grande, and the atlas shows
// Hermine under Texas. Dropping it here would make the replay disagree with the
// map about the same storm, which is worse than the inference.
export const STORM_IDS = Object.freeze([
  // 2008-2014, built from the GIS archive.
  'AL042008', 'AL052008', 'AL062008', 'AL072008', 'AL082008', 'AL092008',
  'AL042009',
  'AL022010', 'AL032010', 'AL102010',
  'AL042011', 'AL092011', 'AL132011',
  'AL022012', 'AL042012', 'AL092012', 'AL182012',
  'AL012013',
  'AL012014',
  // 2015-2024, built from the archived forecast/advisory products.
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

const GIS_INDEX_URL = id => `https://www.nhc.noaa.gov/gis/archive_forecast_results.php?id=${id.slice(0, 4).toLowerCase()}&year=${id.slice(4)}`;
const GIS_ADVISORY_URL = name => `https://www.nhc.noaa.gov/gis/forecast/archive/${name}`;
const ARCHIVE_URL = (year, name) => `https://www.nhc.noaa.gov/archive/${year}/${name.toUpperCase()}.shtml`;

// The storm's archive index is the authority on which advisories exist, so
// nothing here counts ordinals. Each link is preceded by an HTML comment
// carrying the product's own timestamp in UTC, which is when NHC put that
// advisory out, and the discussion links beside them are what ties an archived
// discussion to the forecast it explains.
export function parseAdvisoryIndex(html, atcfId) {
  const pattern = new RegExp(
    `<!--\\s*(\\d{8})\\s+(\\d{4})\\s*-->\\s*<a href="(/archive/(\\d{4})/([a-z]{2}\\d{2})/${atcfId}\\.(fstadv|discus)\\.(\\d{3})\\.shtml)`,
    'gi',
  );
  const byNumber = new Map();
  const discussionByNumber = new Map();
  for (const match of String(html).matchAll(pattern)) {
    const [, date, time, href, year, cy, kind, sequence] = match;
    const number = Number(sequence);
    if (kind.toLowerCase() === 'fstadv') {
      const issued = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2)}:00Z`;
      if (!byNumber.has(number)) byNumber.set(number, { n: number, issued, url: `https://www.nhc.noaa.gov${href}` });
    } else {
      discussionByNumber.set(number, `https://www.nhc.noaa.gov/archive/${year}/${cy}/${atcfId}.discus.${sequence}.shtml`);
    }
  }
  return { advisories: [...byNumber.values()].sort((a, b) => a.n - b.n), discussionByNumber };
}

// Every VALID line in a forecast/advisory either names a position or says in
// words that there is none left to name. Anything else is the format having
// moved, and dropping it silently would shorten a forecast without saying so.
const FORECAST_LINE = /^(?:FORECAST|OUTLOOK) VALID\s+(\d{2}\/\d{4})Z(.*)$/;
const FORECAST_POSITION = /^\s+(\d+\.\d+)([NS])\s+(\d+\.\d+)([EW])/;
const NO_POSITION = /^\.\.\.[A-Z][A-Z0-9 /-]*$/;
const FORECAST_WIND = /^MAX WIND\s+(\d+)\s+KT/;

const signedDegrees = (value, hemisphere) => (hemisphere === 'S' || hemisphere === 'W' ? -Number(value) : Number(value));

/**
 * One advisory, read from the forecast/advisory product NHC archived for it.
 *
 * This is the only per-advisory source. The a-deck the replay used to read is a
 * database of forecast cycles, and a cycle is not an advisory: a special
 * advisory issued off the six-hourly clock has no cycle of its own, and the
 * cycle's rows carry whichever advisory's position happened to land on them.
 * Read against the whole 2015-2024 era, that cost 22 advisories outright and
 * gave eight records the neighbouring advisory's forecast.
 *
 * The shape, all of it upper case and fixed since well before 2015:
 *
 *   HURRICANE IRMA FORECAST/ADVISORY NUMBER  26
 *   HURRICANE CENTER LOCATED NEAR 16.8N  58.4W AT 05/1500Z
 *   MAX SUSTAINED WINDS 155 KT WITH GUSTS TO 190 KT.
 *   AT 05/1200Z CENTER WAS LOCATED NEAR 16.7N  57.8W
 *   FORECAST VALID 06/0000Z 17.2N  60.3W
 *   MAX WIND 155 KT...GUSTS 190 KT.
 *
 * "CENTER WAS LOCATED" is the analysis the forecast is initialised on, which is
 * the synoptic hour the 2008-2014 records are also keyed on. FORECAST and
 * OUTLOOK differ only in lead. A day-of-month is all a VALID stamp carries, so
 * the month comes from the issue time the index recorded.
 */
export function parseForecastAdvisory(html, { label = 'advisory', issuedIso } = {}) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const at = (stamp, what) => {
    try {
      return parseValidTime(stamp, issuedIso).iso;
    } catch (error) {
      throw new Error(`${label}: ${what} ${error.message}`);
    }
  };

  const number = /FORECAST\/ADVISORY NUMBER\s+(\d+[A-Z]?)/.exec(text);
  if (!number) throw new Error(`${label}: the product carries no forecast/advisory number`);
  // "REPEAT...CENTER LOCATED NEAR" restates the same position further down, so
  // the first match is the one and the rest agree with it by construction.
  const current = /CENTER LOCATED NEAR\s+(\d+\.\d+)([NS])\s+(\d+\.\d+)([EW])\s+AT\s+(\d{2}\/\d{4})Z/.exec(text);
  if (!current) throw new Error(`${label}: the product states no current centre position`);
  const analysis = /AT\s+(\d{2}\/\d{4})Z\s+CENTER WAS LOCATED NEAR/.exec(text);
  if (!analysis) throw new Error(`${label}: the product states no analysis time`);
  const intensity = /MAX SUSTAINED WINDS\s+(\d+)\s+KT/.exec(text);
  if (!intensity) throw new Error(`${label}: the product states no current intensity`);

  const initialIso = at(analysis[1], 'the analysis time');
  const initialMs = Date.parse(initialIso);
  const leadFrom = iso => Math.round((Date.parse(iso) - initialMs) / 3_600_000);

  // The current position first: it is where the storm was when the advisory
  // went out, which is three hours after the analysis for a full advisory and
  // whenever a special one was issued for the rest.
  const rows = [[
    leadFrom(at(current[5], 'the current position time')),
    signedDegrees(current[1], current[2]),
    signedDegrees(current[3], current[4]),
    Number(intensity[1]),
  ]];

  const lines = text.split(/\r?\n/).map(line => line.trim());
  let forecastLines = 0;
  for (const [position, line] of lines.entries()) {
    const valid = FORECAST_LINE.exec(line);
    if (!valid) continue;
    forecastLines += 1;
    const place = FORECAST_POSITION.exec(valid[2]);
    if (!place) {
      // "FORECAST VALID 20/1200Z...DISSIPATED" is the last advisory of a storm
      // saying there is nothing left to forecast.
      if (NO_POSITION.test(valid[2].trim())) continue;
      throw new Error(`${label}: cannot read the forecast line ${JSON.stringify(line)}`);
    }
    // The intensity is on its own line under the position, past the wind-radii
    // rows of the lead before it. Stop at the next VALID line so a lead whose
    // wind is missing cannot borrow the next lead's.
    let wind = null;
    for (const following of lines.slice(position + 1)) {
      if (FORECAST_LINE.test(following)) break;
      const match = FORECAST_WIND.exec(following);
      if (match) { wind = Number(match[1]); break; }
    }
    if (wind === null) throw new Error(`${label}: the forecast valid ${valid[1]}Z states no maximum wind`);
    rows.push([
      leadFrom(at(valid[1], `the forecast valid ${valid[1]}Z`)),
      signedDegrees(place[1], place[2]),
      signedDegrees(place[3], place[4]),
      wind,
    ]);
  }
  if (!forecastLines) throw new Error(`${label}: the product carries no forecast or outlook line`);

  for (const [lead] of rows) {
    if (lead < 0) throw new Error(`${label}: a position at lead ${lead} h runs before the analysis it is initialised on`);
  }
  // Two independent readings of the same instant, because everything else is
  // measured from it. The analysis is stated in words; the forecast leads are
  // whole multiples of twelve hours from it, and the run is initialised on a
  // synoptic hour. A wrong analysis line breaks both.
  const initial = new Date(initialMs);
  if (initial.getUTCHours() % 6 !== 0 || initial.getUTCMinutes() !== 0 || initial.getUTCSeconds() !== 0) {
    throw new Error(`${label}: the analysis at ${initialIso} is not on a synoptic hour`);
  }
  for (const [lead] of rows.slice(1)) {
    if (lead <= 0 || lead % 12 !== 0) {
      throw new Error(`${label}: a forecast lead of ${lead} h is not a whole number of twelve-hour steps from ${initialIso}`);
    }
  }
  // A lead can be stated twice, once as a forecast and once as an outlook, and
  // the two agree where they overlap. First wins, as everywhere else here.
  const byLead = new Map();
  for (const row of rows) if (!byLead.has(row[0])) byLead.set(row[0], row);

  return {
    n: /^\d+$/.test(number[1]) ? Number(number[1]) : number[1],
    t: initialIso,
    issued: issuedIso,
    f: [...byLead.values()].sort((a, b) => a[0] - b[0]),
  };
}

// Verified against the post-season best track only where HURDAT2 carries a point
// at the exact verification time. No interpolation: a forecast that verifies
// between synoptic times simply reports no error for that lead.
/**
 * Forecast error against the final best track, for the leads that were
 * forecasts.
 *
 * The first entry is where the storm already was when the advisory went out,
 * not something anybody predicted, so it is skipped. This used to skip
 * `tau <= 0`, which is the same thing in the a-deck era and nothing at all in
 * the GIS era, where the current position sits at lead 3, 6 or 7. That scored
 * an observation as a forecast for 335 of 776 advisories and pulled the
 * reported mean track error down 13 percent.
 */
export function verifyAgainstBestTrack(advisory, trackByTime) {
  const issueMs = Date.parse(advisory.t);
  const errors = [];
  for (const [index, [tau, lat, lon, wind]] of advisory.f.entries()) {
    if (index === 0 || tau <= 0) continue;
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
  const contents = createHash('sha256');
  for (const file of files) {
    const buffer = await fetchBinary(GIS_ADVISORY_URL(file), fetchImpl);
    // Name and bytes, so a package swapped between two advisories moves this.
    contents.update(file).update('\0').update(buffer);
    advisories.push(readAdvisoryArchive(buffer, { stormId, label: `${stormId} ${file}` }));
  }
  const digest = contents.digest('hex');
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

  return { atcfId, indexUrl, files, digest, advisories };
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
      const { atcfId: gisAtcfId, indexUrl, files, digest, advisories } = await buildStormFromGisArchive(storm, stormId, fetchImpl);
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
        // The bytes that were read, not the names of the files they came from.
        // Hashing the names meant every shapefile upstream could change without
        // moving this, while the a-deck half hashes its own source lines.
        sourceSubsetSha256: digest,
        advisoryCount: advisories.length,
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
    const archiveUrl = ARCHIVE_URL(storm.year, storm.name);

    const { advisories: listed, discussionByNumber } = parseAdvisoryIndex(await fetchText(archiveUrl, fetchImpl), atcfId);
    if (!listed.length) throw new Error(`${stormId}: no advisories found at ${archiveUrl}`);
    if (listed[0].n !== 1) throw new Error(`${stormId}: the archive index starts at advisory ${listed[0].n} instead of 1`);

    const contents = createHash('sha256');
    const advisories = [];
    const unresolved = [];
    for (const entry of listed) {
      let product;
      try {
        product = await fetchText(entry.url, fetchImpl);
      } catch (error) {
        unresolved.push(`${entry.n} (${error.message})`);
        continue;
      }
      // URL and bytes, so a product swapped between two advisories moves this.
      contents.update(entry.url).update('\0').update(product);
      advisories.push(parseForecastAdvisory(product, { label: `${stormId} advisory ${entry.n}`, issuedIso: entry.issued }));
      if (advisories.at(-1).n !== entry.n) {
        throw new Error(`${stormId}: ${entry.url} is advisory ${advisories.at(-1).n}, which the index numbers ${entry.n}`);
      }
    }
    // The index says these advisories exist. Shipping the replay without them
    // would leave a gap in the numbering that nothing reports, which is how
    // 22 of this era's advisories went missing for as long as it read a-decks.
    if (unresolved.length) {
      throw new Error(`${stormId}: ${unresolved.length} archived advisories could not be read: ${unresolved.join(', ')}`);
    }
    for (let index = 1; index < advisories.length; index += 1) {
      if (Date.parse(advisories[index].issued) <= Date.parse(advisories[index - 1].issued)) {
        throw new Error(`${stormId}: advisory ${advisories[index].n} is issued at or before ${advisories[index - 1].n}`);
      }
    }

    // A hole in the numbering is either NHC's or this scrape's, and from the
    // index alone the two look the same. Ask the archive directly: if the
    // product the index skipped is in fact there, the index read is truncating
    // the replay and the build stops rather than ship a gap nobody sees. The
    // URL is the archive's own link shape with the number swapped, not one
    // rebuilt from parts.
    const numbers = new Set(advisories.map(advisory => advisory.n));
    const absent = [];
    for (let number = 1; number < advisories.at(-1).n; number += 1) {
      if (numbers.has(number)) continue;
      const url = listed[0].url.replace(/\.fstadv\.\d{3}\.shtml$/, `.fstadv.${String(number).padStart(3, '0')}.shtml`);
      const response = await fetchImpl(url);
      if (response.ok) {
        throw new Error(`${stormId}: the index skipped advisory ${number}, but ${url} exists`);
      }
      absent.push(number);
    }
    if (absent.length) {
      console.log(`${stormId}: NHC issued no forecast/advisory numbered ${absent.join(', ')} (nothing at that number in the archive)`);
    }

    const trackByTime = bestTrackIndex(storm);
    const missing = advisories.filter(advisory => !discussionByNumber.has(advisory.n)).length;
    totalAdvisories += advisories.length;
    totalMissing += missing;

    output[stormId] = {
      name: storm.name,
      year: storm.year,
      basin: storm.basin,
      atcfId,
      coneEra,
      sourceUrl: archiveUrl,
      archiveUrl,
      sourceSubsetSha256: contents.digest('hex'),
      advisoryCount: advisories.length,
      missingDiscussions: missing,
      advisories: advisories.map(advisory => ({
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
      forecast: 'Preliminary operational forecast as issued (NHC forecast/advisory products from 2015, NHC GIS forecast archive before it)',
      actual: 'Final post-season best track (HURDAT2)',
    },
    definitions: {
      forecast: "Official NHC forecast position and maximum sustained wind at each lead time, verbatim from the advisory's own archived product.",
      trackError: 'Great-circle distance in nautical miles between the issued forecast position and the best-track position at the same verification time.',
      intensityError: 'Absolute difference in knots between the issued forecast wind and the best-track wind at the same verification time.',
      coverage: 'Errors are reported only where HURDAT2 carries a best-track point at the exact verification time; other leads are omitted rather than interpolated.',
      cone: `From 2015 the cone is drawn around the issued forecast positions with the published error radii of that advisory's era. Before 2015 no radii table exists, and the record instead carries the cone polygon NHC published with the advisory, read from its GIS package and simplified to within ${CONE_MAX_DEVIATION_KM} km of the outline, measured over every cone in the era.`,
    },
    sources: {
      productArchive: 'https://www.nhc.noaa.gov/archive/',
      format: 'https://www.nhc.noaa.gov/help/tcm.shtml',
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
