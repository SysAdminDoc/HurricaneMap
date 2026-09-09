// One static page per coastal city.
//
// "How often does a hurricane hit my town" is the question a resident actually
// asks, and it is the one this project already answers in the storm panel and
// nowhere a search engine can reach. These pages are that answer at an address:
// the return periods the app computes, and the chronological record they were
// computed from, with no JavaScript involved.
//
// Output is deterministic for the same reason the storm pages are: nothing here
// reads the clock. The revision and access dates both come from
// data/metadata.json, so regenerating on a clean tree produces identical bytes.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COASTAL_CITIES, closestApproach, computeCityReturnPeriods } from '../src/metrics.js';
import { windToCategory } from '../src/data.js';
import {
  PAGE_CSS,
  SITE,
  categoryLabel,
  citySlug,
  displayName,
  escapeHtml,
  escapeJsonLd,
  formatUtc,
  stormSlug,
} from './build-storm-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'cities');

// The same radius computeCityReturnPeriods uses. The table on the page and the
// list underneath it have to be counting the same events, or the page argues
// with itself.
const RADIUS_KM = 50;

// The archive names states in full, and the city list abbreviates them. Only
// states that actually appear in data/landfalls.json can be linked, because the
// app's state filter rejects anything its own data does not know and would open
// an empty panel.
const STATE_NAMES = new Map([
  ['AL', 'Alabama'], ['CT', 'Connecticut'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MS', 'Mississippi'], ['NJ', 'New Jersey'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['PR', 'Puerto Rico'],
  ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['TX', 'Texas'],
  ['VA', 'Virginia'],
]);

function cityStateName(city, knownStates) {
  const abbreviation = String(city.name || '').split(',').pop().trim().toUpperCase();
  const full = STATE_NAMES.get(abbreviation);
  return full && knownStates.has(full) ? full : '';
}

function cityShortName(city) {
  return String(city.name || '').split(',')[0].trim();
}

function formatYears(value) {
  if (!Number.isFinite(value)) return 'Not enough events';
  return `${value} years`;
}

function formatWind(value) {
  return Number.isFinite(value) ? `${Math.round(value)} kt` : 'Not recorded';
}

function formatDistance(km) {
  return Number.isFinite(km) ? `${Math.round(km)} km (${Math.round(km * 0.621371)} mi)` : 'Not recorded';
}

/** Every storm in the archive whose track came within RADIUS_KM of the city. */
export function cityPasses(city, storms) {
  const passes = [];
  for (const storm of storms) {
    const approach = closestApproach(storm.track, city.lat, city.lon);
    if (!approach || approach.distance_km > RADIUS_KM) continue;
    const point = approach.track_point || {};
    passes.push({
      id: storm.id,
      slug: stormSlug(storm),
      name: displayName(storm),
      year: storm.year,
      when: point.t || '',
      distanceKm: approach.distance_km,
      wind: point.wind,
      category: windToCategory(point.wind),
    });
  }
  // Oldest first: the point of the list is reading a record forwards, and the
  // gaps between rows are the return periods the table above states.
  passes.sort((a, b) => a.year - b.year || String(a.when).localeCompare(String(b.when)));
  return passes;
}

function summarySentence(city, passes, periods) {
  const short = cityShortName(city);
  if (!passes.length) {
    return `No storm in the HurricaneMap archive of U.S.-landfalling hurricanes passed within ${RADIUS_KM} km of ${city.name}.`;
  }
  const first = passes[0].year;
  const last = passes[passes.length - 1].year;
  const hurricanes = passes.filter(pass => pass.category >= 1).length;
  const rate = Number.isFinite(periods.cat1_years)
    ? `A hurricane has passed that close about once every ${periods.cat1_years} years.`
    : 'There are too few hurricane passes to state an interval.';
  return `${passes.length} storms in the HurricaneMap archive passed within ${RADIUS_KM} km of ${short} between ${first} and ${last}, ${hurricanes} of them at hurricane strength. ${rate}`;
}

function returnPeriodTable(city, periods) {
  const rows = [
    ['Category 1 or stronger', periods.cat1_years, periods.cat1_count],
    ['Category 3 or stronger', periods.cat3_years, periods.cat3_count],
    ['Category 5', periods.cat5_years, periods.cat5_count],
  ].map(([label, years, count]) => `      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(formatYears(years))}</td>
        <td>${escapeHtml(count)}</td>
      </tr>`).join('\n');
  return `    <table>
      <caption>Average years between passes within ${RADIUS_KM} km of ${escapeHtml(city.name)}, measured over the whole archive</caption>
      <thead>
        <tr><th scope="col">Intensity at closest approach</th><th scope="col">Average interval</th><th scope="col">Events</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

function passTable(city, passes) {
  if (!passes.length) {
    return `    <p>The archive covers storms that made a U.S. landfall, so a city the archive has never recorded a pass for is a city those storms did not reach, not a city with no weather.</p>`;
  }
  const rows = passes.map(pass => `      <tr>
        <td>${escapeHtml(pass.year)}</td>
        <td><a href="../../storms/${escapeHtml(pass.slug)}/">${escapeHtml(pass.name)}</a></td>
        <td>${escapeHtml(formatUtc(pass.when))}</td>
        <td>${escapeHtml(formatDistance(pass.distanceKm))}</td>
        <td>${escapeHtml(categoryLabel(pass.category))}</td>
        <td>${escapeHtml(formatWind(pass.wind))}</td>
      </tr>`).join('\n');
  return `    <table>
      <caption>Every archived storm that passed within ${RADIUS_KM} km of ${escapeHtml(city.name)}, oldest first</caption>
      <thead>
        <tr><th scope="col">Year</th><th scope="col">Storm</th><th scope="col">Closest approach (UTC)</th><th scope="col">Distance</th><th scope="col">Intensity there</th><th scope="col">Wind there</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

// The map cannot be filtered to a city: no hash key carries a location. What it
// can be filtered to is the city's state and the years the city's own record
// spans, so that is what the link does and what the link text says.
function mapLink(city, passes, stateName) {
  const parts = [];
  if (passes.length) parts.push(`y=${passes[0].year}-${passes[passes.length - 1].year}`);
  if (stateName) parts.push(`s=${encodeURIComponent(stateName)}`);
  if (!parts.length) return { href: '../../', label: 'Open the interactive map' };
  const years = passes.length ? `${passes[0].year} to ${passes[passes.length - 1].year}` : '';
  const scope = stateName
    ? `filtered to ${stateName}${years ? `, ${years}` : ''}`
    : `for ${years}`;
  return {
    href: `../../#v=1&${parts.join('&')}`,
    label: `Open the interactive map ${scope}`,
  };
}

function longestGap(passes) {
  const hurricaneYears = [...new Set(passes.filter(pass => pass.category >= 1).map(pass => pass.year))];
  if (hurricaneYears.length < 2) return null;
  let worst = 0;
  for (let index = 1; index < hurricaneYears.length; index += 1) {
    worst = Math.max(worst, hurricaneYears[index] - hurricaneYears[index - 1]);
  }
  return worst;
}

function renderCityPage(city, passes, periods, stateName, context) {
  const { revisionDate, appVersion } = context;
  const slug = citySlug(city);
  const url = `${SITE}cities/${slug}/`;
  const short = cityShortName(city);
  const title = `Hurricanes that have hit ${city.name}`;
  const summary = summarySentence(city, passes, periods);
  const link = mapLink(city, passes, stateName);
  const strongest = passes.reduce(
    (best, pass) => (best === null || (pass.category ?? -9) > (best.category ?? -9) ? pass : best),
    null,
  );
  const mostRecent = passes.length ? passes[passes.length - 1] : null;
  const gap = longestGap(passes);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Dataset',
        name: `Storms passing within ${RADIUS_KM} km of ${city.name}`,
        description: summary,
        url,
        spatialCoverage: {
          '@type': 'Place',
          name: city.name,
          geo: { '@type': 'GeoCoordinates', latitude: city.lat, longitude: city.lon },
        },
        creator: { '@type': 'Organization', name: 'NOAA National Hurricane Center' },
        isBasedOn: 'https://www.nhc.noaa.gov/data/#hurdat',
        license: 'https://github.com/SysAdminDoc/HurricaneMap/blob/main/LICENSE.md',
        variableMeasured: ['Closest approach distance', 'Maximum sustained wind', 'Saffir-Simpson category'],
        version: appVersion,
      },
      {
        '@type': 'Article',
        headline: title,
        description: summary,
        url,
        datePublished: revisionDate,
        isPartOf: { '@type': 'WebSite', name: 'HurricaneMap', url: SITE },
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} | HurricaneMap</title>
<meta name="description" content="${escapeHtml(summary)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(summary)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(`${SITE}example.png`)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<header><a href="../../">HurricaneMap</a> <span aria-hidden="true">·</span> <a href="../">All cities</a> <span aria-hidden="true">·</span> <a href="../../storms/">All storms</a></header>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(summary)}</p>
  <dl class="facts">
    <div><dt>Storms within ${RADIUS_KM} km</dt><dd>${escapeHtml(passes.length)}</dd></div>
    <div><dt>Hurricane-strength passes</dt><dd>${escapeHtml(passes.filter(pass => pass.category >= 1).length)}</dd></div>
    <div><dt>Most recent</dt><dd>${mostRecent ? escapeHtml(`${mostRecent.name} (${mostRecent.year})`) : 'None recorded'}</dd></div>
    <div><dt>Strongest at closest approach</dt><dd>${strongest ? escapeHtml(`${strongest.name} (${strongest.year}), ${categoryLabel(strongest.category)}`) : 'None recorded'}</dd></div>
    <div><dt>Longest gap between hurricanes</dt><dd>${gap === null ? 'Not enough events' : escapeHtml(`${gap} years`)}</dd></div>
    <div><dt>Coordinates</dt><dd>${escapeHtml(`${city.lat.toFixed(4)}, ${city.lon.toFixed(4)}`)}</dd></div>
  </dl>

  <h2>How often ${escapeHtml(short)} is hit</h2>
  <div class="table-scroll">
${returnPeriodTable(city, periods)}
  </div>
  <p>An interval is the average number of years between one qualifying pass and the next, taken across the whole archive. It is a long-run average, not a schedule: two hurricanes can arrive in the same season and the interval will not change.</p>

  <h2>Every storm on record</h2>
  <div class="table-scroll">
${passTable(city, passes)}
  </div>

  <p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>
</main>
<footer>
  <p>Source: NOAA HURDAT2 best track, revision ${escapeHtml(revisionDate)}. Generated for HurricaneMap ${escapeHtml(appVersion)}.</p>
  <p>Distances are measured to the nearest point on the interpolated best track, which is itself an estimate. Positions before the aircraft and satellite eras are reanalysed and carry real uncertainty.</p>
</footer>
</body>
</html>
`;
}

function renderIndexPage(entries, context) {
  const { revisionDate, appVersion } = context;
  const url = `${SITE}cities/`;
  const description = `How often a hurricane passes within ${RADIUS_KM} km of ${entries.length} coastal cities, with the full record behind every interval.`;
  const items = entries.map(entry => `    <li><a href="${escapeHtml(entry.slug)}/">${escapeHtml(entry.name)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hurricane history by city | HurricaneMap</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="Hurricane history by city | HurricaneMap">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<style>${PAGE_CSS}</style>
</head>
<body>
<header><a href="../">HurricaneMap</a> <span aria-hidden="true">·</span> <a href="../storms/">All storms</a></header>
<main>
  <h1>Hurricane history by city</h1>
  <p>${escapeHtml(description)}</p>
  <ul class="storm-index">
${items}
  </ul>
</main>
<footer><p>Source: NOAA HURDAT2 best track, revision ${escapeHtml(revisionDate)}. Generated for HurricaneMap ${escapeHtml(appVersion)}.</p></footer>
</body>
</html>
`;
}

export async function buildCityPages({ write = true } = {}) {
  const [stormsGz, landfallsRaw, metadataRaw] = await Promise.all([
    readFile(path.join(root, 'data', 'storms.json.gz')),
    readFile(path.join(root, 'data', 'landfalls.json'), 'utf8'),
    readFile(path.join(root, 'data', 'metadata.json'), 'utf8'),
  ]);
  const storms = JSON.parse(gunzipSync(stormsGz).toString('utf8'));
  const metadata = JSON.parse(metadataRaw);
  const knownStates = new Set(
    JSON.parse(landfallsRaw).map(row => row.state).filter(Boolean),
  );

  const revisionDate = (metadata.sources || [])
    .map(source => String(source.modified_utc || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) || String(metadata.generated_at_utc || '').slice(0, 10);
  const appVersion = metadata.generator?.app_version || 'unversioned';
  const context = { revisionDate, appVersion };

  const seen = new Map();
  const files = [];
  const entries = [];
  for (const city of COASTAL_CITIES) {
    const slug = citySlug(city);
    if (seen.has(slug)) {
      throw new Error(`city slug collision: ${slug} is claimed by ${seen.get(slug)} and ${city.name}`);
    }
    seen.set(slug, city.name);
    const passes = cityPasses(city, storms);
    // Given the same storms, so the table and the list cannot disagree about
    // which events they counted.
    const periods = computeCityReturnPeriods(city, storms);
    const stateName = cityStateName(city, knownStates);
    entries.push({ slug, name: city.name, passes: passes.length });
    files.push({
      path: path.join('cities', slug, 'index.html'),
      body: renderCityPage(city, passes, periods, stateName, context),
    });
  }

  files.push({ path: path.join('cities', 'index.html'), body: renderIndexPage(entries, context) });

  if (write) {
    await rm(OUT_DIR, { recursive: true, force: true });
    for (const file of files) {
      const target = path.join(root, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.body, 'utf8');
    }
  }

  const bytes = files.reduce((total, file) => total + Buffer.byteLength(file.body, 'utf8'), 0);
  const digest = createHash('sha256');
  for (const file of files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    digest.update(file.path.replace(/\\/g, '/'));
    digest.update(file.body);
  }
  return { files, entries, bytes, revisionDate, checksum: digest.digest('hex') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildCityPages({ write: true });
  const kb = (result.bytes / 1024).toFixed(1);
  console.log(`city pages ok (${result.entries.length} cities, ${result.files.length} files, ${kb} KB, HURDAT2 revision ${result.revisionDate}, checksum ${result.checksum.slice(0, 12)})`);
}
