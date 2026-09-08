// One static page per storm.
//
// The app is a single hash-routed page, so until now no storm had an address a
// person could link to, a crawler could index, or a screen reader could read
// without driving a map. These pages are that address. They carry no
// JavaScript: the track is a real table, so the content is there whether or not
// anything executes.
//
// Output is deterministic. Nothing here reads the clock; the access date and
// the revision date both come from data/metadata.json, so regenerating on a
// clean tree produces byte-identical files and the reproducibility gate means
// something.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCitation } from '../src/citation.js';
import { formatStormName } from '../src/html-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sysadmindoc.github.io/HurricaneMap/';
const OUT_DIR = path.join(root, 'storms');

const STATUS_LABELS = new Map([
  ['HU', 'Hurricane'],
  ['TS', 'Tropical storm'],
  ['TD', 'Tropical depression'],
  ['SS', 'Subtropical storm'],
  ['SD', 'Subtropical depression'],
  ['EX', 'Extratropical'],
  ['LO', 'Low'],
  ['DB', 'Disturbance'],
]);

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// JSON-LD sits inside a <script>, where the only sequence that can end the
// element early is "</". Escaping the slash keeps the document well formed
// without disturbing the JSON.
const escapeJsonLd = value => JSON.stringify(value).replace(/</g, '\\u003c');

export function stormSlug(storm) {
  const name = String(storm.name || '').trim();
  const named = name && name.toUpperCase() !== 'UNNAMED';
  if (!named) return String(storm.id).toLowerCase();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `${slug}-${storm.year}` : String(storm.id).toLowerCase();
}

export function categoryLabel(category) {
  if (category === null || category === undefined) return 'Not recorded';
  if (category >= 1) return `Category ${category}`;
  if (category === 0) return 'Tropical depression';
  return 'Tropical storm';
}

function statusLabel(status) {
  return STATUS_LABELS.get(status) || status || 'Not recorded';
}

function displayName(storm) {
  // HURDAT2 stores names in capitals. The app title-cases them for display and
  // these pages have to read the same way, or the same storm looks like two.
  const name = String(storm.name || '').trim();
  return name && name.toUpperCase() !== 'UNNAMED'
    ? formatStormName(name)
    : `Unnamed storm ${storm.id}`;
}

function headline(storm) {
  const peak = storm.landfall_max_category ?? null;
  const kind = peak !== null && peak >= 1 ? 'Hurricane' : 'Storm';
  return `${kind} ${displayName(storm)} (${storm.year})`;
}

function formatUtc(value) {
  if (!value) return 'Not recorded';
  return String(value).replace('T', ' ').replace(':00Z', ' UTC').replace('Z', ' UTC');
}

function formatCoordinate(value, positive, negative) {
  if (!Number.isFinite(value)) return 'Not recorded';
  const hemisphere = value >= 0 ? positive : negative;
  return `${Math.abs(value).toFixed(1)}° ${hemisphere}`;
}

function summarySentence(storm, landfalls) {
  const name = displayName(storm);
  const peakWind = Number.isFinite(storm.peak_wind_kt) ? `${storm.peak_wind_kt} kt` : 'an unrecorded peak';
  const states = [...new Set(landfalls.map(row => row.state).filter(Boolean))];
  if (!landfalls.length) {
    return `${name} was tracked through the ${storm.basin === 'EP' ? 'eastern Pacific' : 'Atlantic'} basin in ${storm.year}, reaching ${peakWind}.`;
  }
  const where = states.length === 1
    ? states[0]
    : `${states.slice(0, -1).join(', ')} and ${states[states.length - 1]}`;
  const count = landfalls.length === 1 ? 'one recorded U.S. landfall' : `${landfalls.length} recorded U.S. landfalls`;
  return `${name} made ${count} in ${where} during ${storm.year}, reaching ${peakWind} at its peak.`;
}

function trackTable(storm) {
  const rows = storm.track.map(point => `      <tr>
        <td>${escapeHtml(formatUtc(point.t))}</td>
        <td>${escapeHtml(formatCoordinate(point.lat, 'N', 'S'))}</td>
        <td>${escapeHtml(formatCoordinate(point.lon, 'E', 'W'))}</td>
        <td>${Number.isFinite(point.wind) ? `${point.wind} kt` : 'Not recorded'}</td>
        <td>${Number.isFinite(point.pres) ? `${point.pres} mb` : 'Not recorded'}</td>
        <td>${escapeHtml(statusLabel(point.status))}</td>
      </tr>`).join('\n');
  return `    <table>
      <caption>Six-hourly best-track positions, ${storm.track.length} observations</caption>
      <thead>
        <tr><th scope="col">Time (UTC)</th><th scope="col">Latitude</th><th scope="col">Longitude</th><th scope="col">Wind</th><th scope="col">Pressure</th><th scope="col">Status</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

function landfallTable(landfalls) {
  if (!landfalls.length) {
    return '    <p>HURDAT2 records no U.S. landfall for this storm.</p>';
  }
  const rows = landfalls.map(row => `      <tr>
        <td>${escapeHtml(formatUtc(row.t))}</td>
        <td>${escapeHtml(row.state || 'Not recorded')}</td>
        <td>${escapeHtml(categoryLabel(row.category))}</td>
        <td>${Number.isFinite(row.wind) ? `${row.wind} kt` : 'Not recorded'}</td>
        <td>${Number.isFinite(row.pres) ? `${row.pres} mb` : 'Not recorded'}</td>
        <td>${row.inferred ? 'Inferred from the track' : 'Marked in HURDAT2'}</td>
      </tr>`).join('\n');
  return `    <table>
      <caption>U.S. landfalls recorded for this storm</caption>
      <thead>
        <tr><th scope="col">Time (UTC)</th><th scope="col">State</th><th scope="col">Category</th><th scope="col">Wind</th><th scope="col">Pressure</th><th scope="col">Source</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

const PAGE_CSS = `:root{color-scheme:dark light;--bg:#11111b;--fg:#cdd6f4;--muted:#a6adc8;--line:#313244;--link:#89b4fa}
@media(prefers-color-scheme:light){:root{--bg:#eff1f5;--fg:#4c4f69;--muted:#6c6f85;--line:#ccd0dd;--link:#1e66f5}}
*{box-sizing:border-box}
body{margin:0;padding:0 1rem 4rem;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main,header{max-width:64rem;margin:0 auto}
header{padding:1rem 0;border-bottom:1px solid var(--line)}
a{color:var(--link)}
h1{font-size:1.6rem;line-height:1.25;margin:1.5rem 0 .5rem}
h2{font-size:1.15rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
dl.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:.75rem 1rem;margin:1rem 0}
dl.facts div{border:1px solid var(--line);border-radius:.5rem;padding:.5rem .75rem}
dl.facts dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
dl.facts dd{margin:.15rem 0 0;font-weight:600}
.table-scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.9rem}
caption{text-align:left;color:var(--muted);font-size:.8rem;padding-bottom:.4rem}
th,td{text-align:left;padding:.35rem .6rem;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
pre{overflow-x:auto;background:rgba(127,127,127,.12);border:1px solid var(--line);border-radius:.5rem;padding:.75rem;font-size:.8rem;white-space:pre-wrap;word-break:break-word}
footer{max-width:64rem;margin:2.5rem auto 0;padding-top:1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
ul.storm-index{columns:3 14rem;list-style:none;padding:0}
ul.storm-index li{break-inside:avoid;padding:.1rem 0}`;

function renderStormPage(storm, landfalls, context) {
  const { revisionDate, accessDate, appVersion } = context;
  const slug = stormSlug(storm);
  const url = `${SITE}storms/${slug}/`;
  const title = `${headline(storm)} landfalls and track`;
  const summary = summarySentence(storm, landfalls);
  const citation = buildCitation({ accessDate, url });
  const basin = storm.basin === 'EP' ? 'Eastern Pacific' : 'Atlantic';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Dataset',
        name: `${headline(storm)} best track`,
        description: summary,
        url,
        identifier: storm.id,
        temporalCoverage: storm.track.length
          ? `${storm.track[0].t}/${storm.track[storm.track.length - 1].t}`
          : String(storm.year),
        creator: { '@type': 'Organization', name: 'NOAA National Hurricane Center' },
        isBasedOn: 'https://www.nhc.noaa.gov/data/#hurdat',
        license: 'https://github.com/SysAdminDoc/HurricaneMap/blob/main/LICENSE.md',
        variableMeasured: ['Latitude', 'Longitude', 'Maximum sustained wind', 'Minimum central pressure', 'System status'],
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
<header><a href="../../">HurricaneMap</a> <span aria-hidden="true">·</span> <a href="../">All storms</a></header>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(summary)}</p>
  <dl class="facts">
    <div><dt>Season</dt><dd>${escapeHtml(storm.year)}</dd></div>
    <div><dt>Basin</dt><dd>${escapeHtml(basin)}</dd></div>
    <div><dt>Peak wind</dt><dd>${Number.isFinite(storm.peak_wind_kt) ? `${storm.peak_wind_kt} kt` : 'Not recorded'}</dd></div>
    <div><dt>Minimum pressure</dt><dd>${Number.isFinite(storm.min_pres_mb) ? `${storm.min_pres_mb} mb` : 'Not recorded'}</dd></div>
    <div><dt>Strongest U.S. landfall</dt><dd>${escapeHtml(categoryLabel(storm.landfall_max_category))}</dd></div>
    <div><dt>U.S. landfalls</dt><dd>${escapeHtml(landfalls.length)}</dd></div>
    <div><dt>HURDAT2 identifier</dt><dd>${escapeHtml(storm.id)}</dd></div>
    <div><dt>Track observations</dt><dd>${escapeHtml(storm.track.length)}</dd></div>
  </dl>

  <h2>U.S. landfalls</h2>
  <div class="table-scroll">
${landfallTable(landfalls)}
  </div>

  <h2>Track</h2>
  <div class="table-scroll">
${trackTable(storm)}
  </div>

  <h2>Cite this release</h2>
  <p>APA</p>
  <pre>${escapeHtml(citation.apa)}</pre>
  <p>BibTeX</p>
  <pre>${escapeHtml(citation.bibtex)}</pre>

  <p><a href="../../#v=1&amp;storm=${escapeHtml(storm.id)}">Open ${escapeHtml(displayName(storm))} on the interactive map</a></p>
</main>
<footer>
  <p>Source: NOAA HURDAT2 best track, revision ${escapeHtml(revisionDate)}. Generated for HurricaneMap ${escapeHtml(appVersion)}.</p>
  <p>Positions before the aircraft and satellite eras are reanalysed estimates and carry real uncertainty.</p>
</footer>
</body>
</html>
`;
}

function renderIndexPage(entries, context) {
  const { revisionDate, appVersion } = context;
  const url = `${SITE}storms/`;
  const description = `Every one of the ${entries.length} U.S.-landfalling storms in the HurricaneMap archive, each with its track, its landfalls and a citation.`;
  const items = entries.map(entry => `    <li><a href="${escapeHtml(entry.slug)}/">${escapeHtml(entry.title)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>All storms | HurricaneMap</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="All storms | HurricaneMap">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<style>${PAGE_CSS}</style>
</head>
<body>
<header><a href="../">HurricaneMap</a></header>
<main>
  <h1>All storms</h1>
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

function renderSitemap(entries, revisionDate) {
  const urls = [
    { loc: SITE, changefreq: 'monthly', priority: '1.0' },
    { loc: `${SITE}storms/`, changefreq: 'monthly', priority: '0.7' },
    { loc: `${SITE}data/stac/catalog.json`, changefreq: 'yearly', priority: '0.5' },
    ...entries.map(entry => ({ loc: `${SITE}storms/${entry.slug}/`, changefreq: 'yearly', priority: '0.6' })),
  ];
  const body = urls.map(entry => `  <url>
    <loc>${escapeHtml(entry.loc)}</loc>
    <lastmod>${escapeHtml(revisionDate)}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export async function buildStormPages({ write = true } = {}) {
  const [stormsGz, landfallsRaw, metadataRaw] = await Promise.all([
    readFile(path.join(root, 'data', 'storms.json.gz')),
    readFile(path.join(root, 'data', 'landfalls.json'), 'utf8'),
    readFile(path.join(root, 'data', 'metadata.json'), 'utf8'),
  ]);
  const storms = JSON.parse(gunzipSync(stormsGz).toString('utf8'));
  const landfalls = JSON.parse(landfallsRaw);
  const metadata = JSON.parse(metadataRaw);

  // Both the revision and the access date come from the build metadata, never
  // from the clock, so the same tree always produces the same bytes.
  const revisionDate = (metadata.sources || [])
    .map(source => String(source.modified_utc || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .at(-1) || String(metadata.generated_at_utc || '').slice(0, 10);
  const accessDate = String(metadata.generated_at_utc || '').slice(0, 10);
  const appVersion = metadata.generator?.app_version || 'unversioned';
  const context = { revisionDate, accessDate, appVersion };

  const landfallsByStorm = new Map();
  for (const row of landfalls) {
    if (!landfallsByStorm.has(row.storm_id)) landfallsByStorm.set(row.storm_id, []);
    landfallsByStorm.get(row.storm_id).push(row);
  }

  const seen = new Map();
  const files = [];
  const entries = [];
  for (const storm of storms) {
    const slug = stormSlug(storm);
    if (seen.has(slug)) {
      throw new Error(`storm slug collision: ${slug} is claimed by ${seen.get(slug)} and ${storm.id}`);
    }
    seen.set(slug, storm.id);
    const stormLandfalls = (landfallsByStorm.get(storm.id) || []).slice().sort((a, b) => String(a.t).localeCompare(String(b.t)));
    entries.push({ slug, title: `${headline(storm)}`, year: storm.year, id: storm.id });
    files.push({ path: path.join('storms', slug, 'index.html'), body: renderStormPage(storm, stormLandfalls, context) });
  }

  entries.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
  files.push({ path: path.join('storms', 'index.html'), body: renderIndexPage(entries, context) });
  files.push({ path: 'sitemap.xml', body: renderSitemap(entries, revisionDate) });

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
  const result = await buildStormPages({ write: true });
  const mb = (result.bytes / 1024 / 1024).toFixed(1);
  console.log(`storm pages ok (${result.entries.length} storms, ${result.files.length} files, ${mb} MB, HURDAT2 revision ${result.revisionDate}, checksum ${result.checksum.slice(0, 12)})`);
}
