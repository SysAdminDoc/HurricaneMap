// The per-storm pages exist so a storm has an address that survives without
// JavaScript, so what matters here is that every storm has one, that the page
// carries the content rather than a shell for a script to fill, and that
// regenerating produces the same bytes.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { buildStormPages, citySlug, stormSlug, categoryLabel } from './build-storm-pages.mjs';
import { buildCityPages } from './build-city-pages.mjs';
import { COASTAL_CITIES } from '../src/metrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const storms = JSON.parse(gunzipSync(await readFile(path.join(root, 'data', 'storms.json.gz'))).toString('utf8'));

// Build in memory twice. Nothing in the generator may read the clock, so two
// runs over the same tree have to agree byte for byte; that is the whole basis
// for the checked-in pages being reproducible by anyone else.
const first = await buildStormPages({ write: false });
const second = await buildStormPages({ write: false });
assert.equal(first.checksum, second.checksum, 'storm page generation is not reproducible');
assert.equal(first.files.length, second.files.length);

assert.equal(first.entries.length, storms.length, `expected one page per storm (${storms.length})`);
assert.equal(first.files.length, storms.length + 2, 'expected one page per storm plus the index and the sitemap');
assert.equal(new Set(first.entries.map(entry => entry.slug)).size, storms.length, 'storm slugs are not unique');

// What is on disk has to be what the generator produces, or the published
// pages and the build have drifted.
for (const file of first.files) {
  const onDisk = await readFile(path.join(root, file.path), 'utf8');
  assert.equal(onDisk, file.body, `${file.path} on disk differs from a fresh build; run npm run generate:storm-pages`);
}

const bySlug = new Map(first.files.map(file => [file.path.replace(/\\/g, '/'), file.body]));
const katrina = storms.find(storm => storm.id === 'AL122005');
const katrinaPage = bySlug.get(`storms/${stormSlug(katrina)}/index.html`);
assert.ok(katrinaPage, 'Katrina has no page');

// Content contract, checked on a storm whose facts are well known.
assert.match(katrinaPage, /<html lang="en">/);
assert.match(katrinaPage, /<title>Hurricane Katrina \(2005\) landfalls and track \| HurricaneMap<\/title>/);
assert.match(katrinaPage, /<link rel="canonical" href="https:\/\/sysadmindoc\.github\.io\/HurricaneMap\/storms\/katrina-2005\/">/);
assert.match(katrinaPage, /property="og:title"/);
assert.match(katrinaPage, /name="twitter:card"/);
assert.match(katrinaPage, /#v=1&amp;storm=AL122005/, 'the page must link into the map at this storm');
assert.match(katrinaPage, /NOAA HURDAT2 best track, revision \d{4}-\d{2}-\d{2}/, 'the page must state the HURDAT2 revision');
assert.match(katrinaPage, /@software\{hurricanemap_/, 'the page must carry a BibTeX citation');
// A storm page cites the storm, not just the release. The old form asserted
// here, `SysAdminDoc. (YYYY). HurricaneMap`, was identical on all 595 pages,
// which is the defect: two storms could not sit in one bibliography and neither
// entry recorded which storm the reader used.
assert.match(
  katrinaPage,
  /SysAdminDoc\. \(\d{4}\)\. Katrina \(2005\) \[AL122005\] in HurricaneMap/,
  'the page must carry an APA citation naming the storm',
);
assert.match(katrinaPage, /@software\{hurricanemap_al122005_\d{4},/, 'the BibTeX key must carry the HURDAT2 id');
assert.match(katrinaPage, /TY {2}- DATA/, 'the page must offer RIS beside APA and BibTeX');

// A real table, not a placeholder: one row per observation, and no script.
const bodyRows = [...katrinaPage.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(match => (match[1].match(/<tr>/g) || []).length);
assert.equal(bodyRows.length, 2, 'expected a landfall table and a track table');
assert.equal(bodyRows[1], katrina.track.length, `track table must carry all ${katrina.track.length} observations`);
assert.ok(bodyRows[0] >= 1, 'Katrina must list its landfalls');
assert.equal((katrinaPage.match(/<script(?! type="application\/ld\+json")/g) || []).length, 0, 'storm pages must not depend on JavaScript');

// Structured data has to parse and describe this storm.
const jsonLd = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(katrinaPage)[1]);
const dataset = jsonLd['@graph'].find(node => node['@type'] === 'Dataset');
const article = jsonLd['@graph'].find(node => node['@type'] === 'Article');
assert.ok(dataset && article, 'storm pages must carry Dataset and Article structured data');
assert.equal(dataset.identifier, 'AL122005');
assert.match(dataset.temporalCoverage, /^\d{4}-\d{2}-\d{2}T/);

// Every page, not just the sampled one.
let scriptless = 0;
for (const file of first.files) {
  if (!file.path.includes('storms')) continue;
  if ((file.body.match(/<script(?! type="application\/ld\+json")/g) || []).length === 0) scriptless += 1;
  assert.match(file.body, /<link rel="canonical"/, `${file.path} has no canonical URL`);
}
assert.equal(scriptless, storms.length + 1, 'every storm page and the index must be script-free');

// The sitemap has to list them, or nothing can find them.
const sitemap = bySlug.get('sitemap.xml');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.equal(
  locations.length,
  storms.length + COASTAL_CITIES.length + 4,
  'sitemap must list the site, both indexes, the catalog, every storm and every city',
);
assert.ok(locations.includes('https://sysadmindoc.github.io/HurricaneMap/storms/katrina-2005/'));
assert.equal(new Set(locations).size, locations.length, 'sitemap contains duplicate URLs');

// Category wording is the app's, not a second vocabulary for the same numbers.
assert.equal(categoryLabel(3), 'Category 3');
assert.equal(categoryLabel(0), 'Tropical depression');
assert.equal(categoryLabel(-1), 'Tropical storm');

const megabytes = first.bytes / 1024 / 1024;
assert.ok(megabytes < 40, `storm pages grew to ${megabytes.toFixed(1)} MB, which needs a deliberate decision`);

// ------------------------------------------------------------- city pages
//
// The city pages answer the question a resident actually asks, so what matters
// is that each one is about its own city and says so where a search engine and
// a reader both look: the title, the heading and the description.
const cityFirst = await buildCityPages({ write: false });
const citySecond = await buildCityPages({ write: false });
assert.equal(cityFirst.checksum, citySecond.checksum, 'city page generation is not reproducible');
assert.equal(cityFirst.entries.length, COASTAL_CITIES.length, `expected one page per coastal city (${COASTAL_CITIES.length})`);
assert.equal(cityFirst.files.length, COASTAL_CITIES.length + 1, 'expected one page per city plus the index');
assert.equal(new Set(cityFirst.entries.map(entry => entry.slug)).size, COASTAL_CITIES.length, 'city slugs are not unique');

for (const file of cityFirst.files) {
  const onDisk = await readFile(path.join(root, file.path), 'utf8');
  assert.equal(onDisk, file.body, `${file.path} on disk differs from a fresh build; run npm run generate:city-pages`);
}

const cityPages = new Map(cityFirst.files.map(file => [file.path.replace(/\\/g, '/'), file.body]));
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const descriptions = new Map();
for (const city of COASTAL_CITIES) {
  const slug = citySlug(city);
  const page = cityPages.get(`cities/${slug}/index.html`);
  assert.ok(page, `${city.name} has no page`);

  // Named in all three places, or the page is about hurricanes in general and
  // ranks for nothing.
  const title = /<title>([^<]*)<\/title>/.exec(page)?.[1] || '';
  const heading = /<h1>([^<]*)<\/h1>/.exec(page)?.[1] || '';
  const description = /<meta name="description" content="([^"]*)">/.exec(page)?.[1] || '';
  assert.match(title, new RegExp(escapeRe(city.name)), `${city.name} is not named in its <title>`);
  assert.match(heading, new RegExp(escapeRe(city.name)), `${city.name} is not named in its <h1>`);
  // The description leads with the count and reads better without the state
  // repeated, so the short form is what it has to carry. A city with no record
  // names itself in full, which contains the short form either way.
  assert.match(
    description,
    new RegExp(escapeRe(city.name.split(',')[0].trim())),
    `${city.name} is not named in its meta description`,
  );

  assert.ok(
    !descriptions.has(description),
    `${city.name} shares its description with ${descriptions.get(description)}`,
  );
  descriptions.set(description, city.name);

  assert.match(
    page,
    /<link rel="canonical" href="https:\/\/sysadmindoc\.github\.io\/HurricaneMap\/cities\//,
    `${city.name} has no canonical URL`,
  );
  assert.equal(
    (page.match(/<script(?! type="application\/ld\+json")/g) || []).length,
    0,
    `${city.name}: city pages must not depend on JavaScript`,
  );

  const cityJsonLd = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)[1]);
  const cityDataset = cityJsonLd['@graph'].find(node => node['@type'] === 'Dataset');
  assert.ok(cityDataset, `${city.name}: city pages must carry Dataset structured data`);
  assert.equal(
    cityDataset.spatialCoverage.geo.latitude,
    city.lat,
    `${city.name}: structured data must carry the city's own coordinates`,
  );

  assert.ok(
    locations.includes(`https://sysadmindoc.github.io/HurricaneMap/cities/${slug}/`),
    `${city.name} is missing from the sitemap`,
  );
}

// A sampled city whose record is well known, so the page is checked against
// facts rather than only against its own shape.
const miami = cityPages.get('cities/miami-fl/index.html');
assert.match(miami, /Category 1 or stronger/, 'the return-period table is missing');
assert.match(miami, /<a href="\.\.\/\.\.\/storms\/andrew-1992\/">/, 'Miami must list Andrew and link to its page');
assert.match(
  miami,
  /href="\.\.\/\.\.\/#v=1&amp;y=\d{4}-\d{4}&amp;s=Florida"/,
  'Miami must deep-link into the map scoped to its own record',
);
// The chronological list and the summary have to be counting the same events,
// or the page argues with itself.
const miamiRows = (/<caption>Every archived storm[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(miami)?.[1].match(/<tr>/g) || []).length;
const miamiSummary = /(\d+) storms in the HurricaneMap archive/.exec(miami)?.[1];
assert.equal(miamiRows, Number(miamiSummary), `Miami's list has ${miamiRows} rows but its summary claims ${miamiSummary}`);

console.log(`storm pages ok (${first.entries.length} storms, ${cityFirst.entries.length} cities, reproducible, ${megabytes.toFixed(1)} MB, ${locations.length} sitemap URLs)`);
