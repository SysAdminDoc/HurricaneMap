// Search-engine and no-JavaScript discovery contract.
//
// The app was invisible to a crawler and to a reader with scripting off: no
// canonical URL, no sitemap, no structured data, and an empty body. These are
// the pieces that let the atlas be found and cited rather than only demoed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

const [indexHtml, robots, sitemap, metadata, coverage] = await Promise.all([
  read('index.html'),
  read('robots.txt'),
  read('sitemap.xml'),
  read('data/metadata.json').then(JSON.parse),
  read('data/coverage.json').then(JSON.parse),
]);

const SITE = 'https://sysadmindoc.github.io/HurricaneMap/';

// robots.txt
assert.match(robots, /^User-agent: \*/m, 'robots.txt must address every crawler');
assert.match(robots, /^Allow: \//m, 'robots.txt must allow the site');
const sitemapDirective = robots.match(/^Sitemap: (\S+)$/m)?.[1];
assert.equal(sitemapDirective, `${SITE}sitemap.xml`, 'robots.txt must point at the published sitemap');

// sitemap.xml
assert.match(sitemap, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/, 'sitemap must use the sitemaps.org 0.9 namespace');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.ok(locations.includes(SITE), 'the sitemap must list the site root');
for (const location of locations) {
  assert.ok(location.startsWith(SITE), `${location} is outside the published site`);
}
for (const lastmod of [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(match => match[1])) {
  assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/, `sitemap lastmod ${lastmod} must be an ISO date`);
}

// Canonical URL
assert.match(indexHtml, /<link rel="canonical" href="https:\/\/sysadmindoc\.github\.io\/HurricaneMap\/" \/>/, 'index.html needs a canonical URL');

// schema.org Dataset, checked against the data rather than trusted as prose.
const jsonLdBlock = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(jsonLdBlock, 'index.html must carry a JSON-LD block');
let dataset;
assert.doesNotThrow(() => { dataset = JSON.parse(jsonLdBlock[1]); }, 'the JSON-LD block must be valid JSON');
assert.equal(dataset['@context'], 'https://schema.org/');
assert.equal(dataset['@type'], 'Dataset');
for (const field of ['name', 'description', 'url', 'license', 'citation', 'temporalCoverage', 'isBasedOn', 'distribution']) {
  assert.ok(dataset[field], `the Dataset needs a ${field}`);
}
assert.equal(dataset.url, SITE);
assert.ok(Array.isArray(dataset.distribution) && dataset.distribution.length >= 3, 'the Dataset must offer downloads');
for (const download of dataset.distribution) {
  assert.equal(download['@type'], 'DataDownload');
  assert.ok(download.contentUrl.startsWith(SITE), `${download.contentUrl} is outside the published site`);
  assert.ok(download.encodingFormat, 'each download needs an encodingFormat');
}

// The advertised HURDAT2 revision must be the one actually shipped, so the
// structured data cannot drift into advertising a source the app is not using.
const atlantic = metadata.sources.find(source => source.basin === 'AL');
assert.equal(dataset.isBasedOn.url, atlantic.source_url, 'JSON-LD must cite the HURDAT2 file this build used');
assert.equal(dataset.isBasedOn.datePublished, atlantic.source_date, 'JSON-LD must cite the revision date of that file');
const [firstYear, lastYear] = coverage.catalog.year_range;
assert.equal(dataset.temporalCoverage, `${firstYear}/${lastYear}`, 'JSON-LD coverage must match data/coverage.json');
assert.ok(dataset.description.includes(String(coverage.catalog.storm_count)), 'the description must state the real storm count');
assert.ok(dataset.description.includes(String(coverage.catalog.landfall_event_count)), 'the description must state the real landfall count');

// noscript
const noscript = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/);
assert.ok(noscript, 'index.html must carry a noscript fallback');
const noscriptHtml = noscript[1];
assert.match(noscriptHtml, /HurricaneMap/, 'the noscript block must say what the page is');
for (const target of ['data/landfalls.json', 'data/storms.json', 'data/metadata.json', 'data/stac/catalog.json']) {
  assert.ok(noscriptHtml.includes(`href="${target}"`), `the noscript block must link ${target}`);
}
assert.match(noscriptHtml, /Landsea/, 'the noscript block must carry the citation');

console.log(
  `discovery contract ok (canonical, robots, ${locations.length} sitemap URLs, `
  + `Dataset JSON-LD citing ${atlantic.source_date}, noscript with ${(noscriptHtml.match(/href=/g) || []).length} links)`,
);
