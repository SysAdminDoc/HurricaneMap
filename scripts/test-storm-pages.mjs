// The per-storm pages exist so a storm has an address that survives without
// JavaScript, so what matters here is that every storm has one, that the page
// carries the content rather than a shell for a script to fill, and that
// regenerating produces the same bytes.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { buildStormPages, stormSlug, categoryLabel } from './build-storm-pages.mjs';

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
assert.match(katrinaPage, /SysAdminDoc\. \(\d{4}\)\. HurricaneMap/, 'the page must carry an APA citation');

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
assert.equal(locations.length, storms.length + 3, 'sitemap must list the site, the index, the catalog and every storm');
assert.ok(locations.includes('https://sysadmindoc.github.io/HurricaneMap/storms/katrina-2005/'));
assert.equal(new Set(locations).size, locations.length, 'sitemap contains duplicate URLs');

// Category wording is the app's, not a second vocabulary for the same numbers.
assert.equal(categoryLabel(3), 'Category 3');
assert.equal(categoryLabel(0), 'Tropical depression');
assert.equal(categoryLabel(-1), 'Tropical storm');

const megabytes = first.bytes / 1024 / 1024;
assert.ok(megabytes < 40, `storm pages grew to ${megabytes.toFixed(1)} MB, which needs a deliberate decision`);

console.log(`storm pages ok (${first.entries.length} storms, reproducible, ${megabytes.toFixed(1)} MB, ${locations.length} sitemap URLs)`);
