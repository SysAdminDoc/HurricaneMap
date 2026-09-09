// The per-storm pages exist so a storm has an address that survives without
// JavaScript, so what matters here is that every storm has one, that the page
// carries the content rather than a shell for a script to fill, and that
// regenerating produces the same bytes.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import {
  buildStormPages,
  categoryLabel,
  citySlug,
  decadeSlug,
  stateSlug,
  stormSlug,
} from './build-storm-pages.mjs';
import { buildCityPages } from './build-city-pages.mjs';
import { buildSocialImages } from './build-social-images.mjs';
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
assert.ok(first.files.length > storms.length + 2, 'expected the storm pages, the index, the sitemap and the season, decade and state indexes');
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
const seasonCount = new Set(storms.map(storm => storm.year)).size;
const decadeCount = new Set(storms.map(storm => decadeSlug(storm.year))).size;
const stateCount = new Set(
  JSON.parse(await readFile(path.join(root, 'data', 'landfalls.json'), 'utf8'))
    .map(row => row.state)
    .filter(Boolean),
).size;
assert.equal(
  locations.length,
  storms.length + COASTAL_CITIES.length + seasonCount + decadeCount + stateCount + 7,
  'sitemap must list the site, the four listings, the catalog, every storm, city, season, decade and state',
);
assert.ok(locations.includes('https://sysadmindoc.github.io/HurricaneMap/storms/katrina-2005/'));
assert.equal(new Set(locations).size, locations.length, 'sitemap contains duplicate URLs');

// Category wording is the app's, not a second vocabulary for the same numbers.
assert.equal(categoryLabel(3), 'Category 3');
assert.equal(categoryLabel(0), 'Tropical depression');
assert.equal(categoryLabel(-1), 'Tropical storm');

const megabytes = first.bytes / 1024 / 1024;
assert.ok(megabytes < 40, `storm pages grew to ${megabytes.toFixed(1)} MB, which needs a deliberate decision`);

// --------------------------------------------------- season, decade and state
//
// storms/index.html was the only index, so nothing could rank for "hurricanes
// in 1935" and there was no crawl path from a year or a state down to the
// storms in it. What matters is that the three sets cover every storm exactly,
// that a storm and the pages listing it agree, and that a crawler can walk both
// directions.
const indexPages = new Map(
  first.files
    .map(file => [file.path.replace(/\\/g, '/'), file.body])
    .filter(([relative]) => /^(seasons|decades|states)\//.test(relative)),
);
const seasonYears = [...new Set(storms.map(storm => storm.year))].sort((a, b) => a - b);
const stormStates = new Map(storms.map(storm => [storm.id, new Set()]));
for (const row of JSON.parse(await readFile(path.join(root, 'data', 'landfalls.json'), 'utf8'))) {
  if (row.state) stormStates.get(row.storm_id)?.add(row.state);
}
const allStates = [...new Set([...stormStates.values()].flatMap(set => [...set]))].sort();
const allDecades = [...new Set(seasonYears.map(decadeSlug))].sort();

assert.equal(
  indexPages.size,
  seasonYears.length + allDecades.length + allStates.length + 3,
  'expected one page per season, decade and state, plus the three listings',
);

// Every storm is listed by its own season, its own decade and each state it hit
// and by nothing else, and every one of those pages is linked back from it.
const listedBy = new Map(storms.map(storm => [stormSlug(storm), new Set()]));
for (const [relative, body] of indexPages) {
  for (const match of body.matchAll(/href="\.\.\/\.\.\/storms\/([^/"]+)\//g)) {
    const set = listedBy.get(match[1]);
    assert.ok(set, `${relative} links a storm page that does not exist: ${match[1]}`);
    set.add(relative);
  }
  assert.match(body, /<link rel="canonical" href="https:\/\/sysadmindoc\.github\.io\/HurricaneMap\//, `${relative} has no canonical URL`);
  const url = /<link rel="canonical" href="([^"]+)">/.exec(body)?.[1];
  assert.equal(url, `https://sysadmindoc.github.io/HurricaneMap/${relative.replace(/index\.html$/, '')}`, `${relative}: canonical is not its own address`);
  assert.equal((body.match(/<script(?! type="application\/ld\+json")/g) || []).length, 0, `${relative} must not depend on JavaScript`);
  const structured = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body)[1]);
  const collection = structured['@graph'].find(node => node['@type'] === 'CollectionPage');
  assert.ok(collection, `${relative} must carry CollectionPage structured data`);
  assert.equal(collection.url, url, `${relative}: structured data and canonical disagree`);
  assert.equal(
    collection.mainEntity.numberOfItems,
    collection.mainEntity.itemListElement.length,
    `${relative}: the item list says a different length than it holds`,
  );
  assert.ok(locations.includes(url), `${relative} is missing from the sitemap`);
}

for (const storm of storms) {
  const slug = stormSlug(storm);
  const expected = new Set([
    `seasons/${storm.year}/index.html`,
    `decades/${decadeSlug(storm.year)}/index.html`,
    ...[...stormStates.get(storm.id)].map(state => `states/${stateSlug(state)}/index.html`),
  ]);
  assert.deepEqual(
    [...listedBy.get(slug)].sort(),
    [...expected].sort(),
    `${slug} is listed by the wrong set of index pages`,
  );

  // And back the other way, so a crawler that lands on a storm can walk up.
  const page = bySlug.get(`storms/${slug}/index.html`);
  for (const target of expected) {
    const href = `../../${target.replace(/index\.html$/, '')}`;
    assert.ok(page.includes(`href="${href}"`), `${slug} does not link back to ${target}`);
  }
}

// The listings are a crawl path in their own right: three pages that link to
// every season, decade and state, reachable from the all-storms index.
for (const [listing, count] of [['seasons', seasonYears.length], ['decades', allDecades.length], ['states', allStates.length]]) {
  const body = indexPages.get(`${listing}/index.html`);
  const links = [...body.matchAll(/<a href="([^"./][^"]*)\/">/g)].map(match => match[1]);
  assert.equal(links.length, count, `${listing}/index.html links ${links.length} of ${count} pages`);
  assert.ok(
    bySlug.get('storms/index.html').includes(`href="../${listing}/"`),
    `the all-storms index does not link ${listing}/`,
  );
}

// A sampled season whose facts are well known. 1935 is the Labor Day hurricane.
const season1935 = indexPages.get('seasons/1935/index.html');
assert.match(season1935, /<h1>Hurricanes and tropical storms of the 1935 season<\/h1>/);
assert.match(season1935, /href="\.\.\/\.\.\/decades\/1930s\/"/, 'a season must link its decade');
assert.match(season1935, /href="\.\.\/1934\/"/, 'a season must link the one before it');
assert.match(indexPages.get('states/florida/index.html'), /<h1>Hurricanes that have hit Florida<\/h1>/);

// ---------------------------------------------------------- social images
//
// Every storm page shared one og:image, so a share of any storm showed the same
// generic screenshot. What matters is that each page points at a card of its
// own storm, that the card on disk is the one the current data produces, and
// that the card was drawn from that storm's track rather than from a template.
const stormPageFiles = first.files.filter(file => /^storms\/[^/]+\/index\.html$/.test(file.path.replace(/\\/g, '/')));
assert.equal(stormPageFiles.length, storms.length, 'expected to find every storm page');

const cardBuild = await buildSocialImages({ write: false });
assert.equal(cardBuild.cards.length, storms.length, 'expected one card per storm');
const cardsBySlug = new Map(cardBuild.cards.map(card => [stormSlug(card.storm), card]));
const cardManifest = JSON.parse(await readFile(path.join(root, 'social', 'manifest.json'), 'utf8'));
assert.equal(cardManifest.width, 1200);
assert.equal(cardManifest.height, 630);
assert.equal(
  Object.keys(cardManifest.cards).length,
  storms.length,
  'the card manifest and the storm list disagree; run npm run generate:social-images',
);

const ogImages = new Set();
const geometries = new Map();
for (const file of stormPageFiles) {
  const slug = file.path.replace(/\\/g, '/').split('/')[1];
  const og = /<meta property="og:image" content="([^"]+)">/.exec(file.body)?.[1];
  const twitter = /<meta name="twitter:image" content="([^"]+)">/.exec(file.body)?.[1];
  const alt = /<meta property="og:image:alt" content="([^"]+)">/.exec(file.body)?.[1] || '';
  assert.ok(og, `${file.path} has no og:image`);
  assert.equal(twitter, og, `${file.path}: twitter:image and og:image disagree`);
  assert.equal(
    og,
    `https://sysadmindoc.github.io/HurricaneMap/social/${slug}.png`,
    `${file.path} points at another storm's card`,
  );
  ogImages.add(og);

  const card = cardsBySlug.get(slug);
  assert.ok(card, `${slug} has a page but no card`);

  // The alt text describes the picture, so the picture has to agree with it.
  // The page called a storm a hurricane by its strongest U.S. landfall while
  // the card called it one by its peak anywhere, and 35 pages carried an alt
  // reading "Storm Love (1950)" over a card reading "Hurricane Love".
  const cardTitle = /<text[^>]*font-size="52"[^>]*>([^<]*)</.exec(card.svg)?.[1] || '';
  assert.ok(cardTitle, `${slug}: the card has no title`);
  assert.equal(
    alt,
    `The best track of ${cardTitle}`,
    `${slug}: the page's og:image:alt and the card it labels name the storm differently`,
  );

  // Drawn from this storm's own track: one segment per gap between usable
  // positions, or a single dot for a storm with only one. A card that drew
  // nothing, or drew a fixed shape, fails here.
  const positions = card.storm.track.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon)).length;
  const segments = (card.svg.match(/<line /g) || []).length;
  const dots = (card.svg.match(/<circle /g) || []).length;
  if (positions >= 2) {
    assert.equal(segments, positions - 1, `${slug}: ${segments} track segments for ${positions} positions`);
    // Two storms that differ have to look different. Compared without the text,
    // which carries the unique storm id and would make any two cards distinct
    // even if neither drew a track.
    const geometry = card.svg.replace(/<text[\s\S]*?<\/text>/g, '');
    assert.ok(!geometries.has(geometry), `${slug} and ${geometries.get(geometry)} were drawn identically`);
    geometries.set(geometry, slug);
  } else {
    assert.equal(segments, 0, `${slug}: a storm with ${positions} positions cannot have segments`);
    assert.ok(dots >= 1, `${slug}: a single-position storm must still be drawn`);
  }

  // The card on disk is the one this data produces, and it has not been
  // swapped, truncated or edited since. The rasteriser is not reproducible, so
  // this is the only thing that can tie a committed PNG to a storm.
  const entry = cardManifest.cards[`${slug}.png`];
  assert.ok(entry, `${slug} is missing from the card manifest`);
  assert.equal(entry.storm_id, card.storm.id, `${slug}: the manifest names a different storm`);
  assert.equal(
    entry.svg_sha256,
    createHash('sha256').update(card.svg).digest('hex'),
    `${slug}: the committed card predates a change to this storm's data; run npm run generate:social-images`,
  );
  const png = await readFile(path.join(root, 'social', `${slug}.png`));
  assert.equal(
    createHash('sha256').update(png).digest('hex'),
    entry.png_sha256,
    `social/${slug}.png is not the file that was generated for it`,
  );
  // The size the meta tags claim, read out of IHDR rather than trusted.
  assert.equal(png.readUInt32BE(0), 0x89504e47, `social/${slug}.png is not a PNG`);
  assert.equal(png.readUInt32BE(16), 1200, `social/${slug}.png is not 1200 wide`);
  assert.equal(png.readUInt32BE(20), 630, `social/${slug}.png is not 630 tall`);
}
// Restating the acceptance directly. It follows from the per-page equality
// above, and is cheap enough to say out loud.
assert.equal(
  ogImages.size,
  storms.length,
  `expected one distinct og:image per storm page, found ${ogImages.size} across ${storms.length} pages`,
);

const katrinaCard = cardsBySlug.get('katrina-2005');
assert.match(katrinaCard.svg, /Hurricane Katrina \(2005\)/, "Katrina's card must name her");
assert.match(katrinaCard.svg, /Peak 150 kt/, "Katrina's card must carry her peak wind");
assert.match(katrinaCard.svg, /Category 5/, "Katrina's card must state her peak category");

// windToCategory codes a depression 0 and a tropical storm -1, so the codes do
// not sort by intensity and a plain max over them picks the depression. Driven
// on a storm that carries both, because a storm whose every observation is
// already tropical-storm strength gets the right answer from the buggy
// comparison by accident.
const tropicalStormOnly = storms.find(storm => {
  const winds = storm.track.map(point => point.wind).filter(Number.isFinite);
  if (!winds.length) return false;
  const peak = Math.max(...winds);
  return peak >= 34 && peak < 64 && Math.min(...winds) < 34;
});
assert.ok(tropicalStormOnly, 'no storm peaks in the tropical-storm band after a depression, which cannot be right');
assert.match(
  cardsBySlug.get(stormSlug(tropicalStormOnly)).svg,
  />Tropical storm</,
  `${tropicalStormOnly.id} peaks at tropical-storm strength but its card does not say so`,
);

// ------------------------------------------------------------- city pages
//
// The city pages answer the question a resident actually asks, so what matters
// is that each one is about its own city and says so where a search engine and
// a reader both look: the title, the heading and the description.
const cityFirst = await buildCityPages({ write: false });
const citySecond = await buildCityPages({ write: false });
assert.equal(cityFirst.checksum, citySecond.checksum, 'city page generation is not reproducible');
// The builder pushes one entry per unfiltered loop iteration and throws on a
// duplicate slug, so counting its own output back proves nothing. What can be
// wrong is the disk: a city removed from the list leaving its page behind, or a
// page never written. That check is at the end of this block.
const archiveStates = new Set(
  JSON.parse(await readFile(path.join(root, 'data', 'landfalls.json'), 'utf8'))
    .map(row => row.state)
    .filter(Boolean),
);

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

  assert.equal(
    /<link rel="canonical" href="([^"]+)">/.exec(page)?.[1],
    `https://sysadmindoc.github.io/HurricaneMap/cities/${slug}/`,
    `${city.name}: the canonical URL is not this page's own address`,
  );
  assert.equal(
    /<meta property="og:url" content="([^"]+)">/.exec(page)?.[1],
    `https://sysadmindoc.github.io/HurricaneMap/cities/${slug}/`,
    `${city.name}: og:url is not this page's own address`,
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

  // The deep link, on every page rather than on the sampled one. It is scoped
  // to the record this page shows, so the years in it have to be the years in
  // the page's own table, and any state in it has to be one the app's filter
  // will accept — a state the archive does not name opens an empty panel.
  const link = /<a href="([^"]*)">Open the interactive map/.exec(page)?.[1];
  assert.ok(link, `${city.name} has no link into the app`);
  const rows = [...(/<caption>Every archived storm[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(page)?.[1] || '')
    .matchAll(/<tr>\s*<td>(\d{4})<\/td>/g)].map(match => match[1]);
  const years = /y=(\d{4})-(\d{4})/.exec(link);
  if (rows.length) {
    assert.ok(years, `${city.name} has ${rows.length} storms but its link carries no year range`);
    assert.equal(years[1], rows[0], `${city.name}: the link starts before or after its own first storm`);
    assert.equal(years[2], rows[rows.length - 1], `${city.name}: the link ends before or after its own last storm`);
  } else {
    assert.equal(years, null, `${city.name} has no storms but its link claims a year range`);
  }
  const state = /s=([^&"]+)/.exec(link);
  if (state) {
    const decoded = decodeURIComponent(state[1]);
    assert.ok(
      archiveStates.has(decoded),
      `${city.name} links a state the archive does not name, which opens an empty panel: ${decoded}`,
    );
  }

  assert.ok(
    locations.includes(`https://sysadmindoc.github.io/HurricaneMap/cities/${slug}/`),
    `${city.name} is missing from the sitemap`,
  );
}

// The three shapes the link can take, pinned on the cities that produce them.
const linkOf = slug => /<a href="([^"]*)">Open the interactive map([^<]*)/.exec(cityPages.get(`cities/${slug}/index.html`));
const miamiLink = linkOf('miami-fl');
assert.match(miamiLink[1], /^\.\.\/\.\.\/#v=1&amp;y=\d{4}-\d{4}&amp;s=Florida$/, 'Miami must link to its state and its years');
assert.match(miamiLink[2], /filtered to Florida, \d{4} to \d{4}/, "Miami's link must say what it does");
// A city the archive knows a state for but has no pass within 50 km of: the
// state is where its storms are, so the link still goes somewhere useful.
const honoluluLink = linkOf('honolulu-hi');
assert.equal(honoluluLink[1], '../../#v=1&amp;s=Hawaii');
// A city with neither. Nothing to filter to, so it must not pretend otherwise.
const sanDiegoLink = linkOf('san-diego-ca');
assert.equal(sanDiegoLink[1], '../../');
assert.equal(sanDiegoLink[2].trim(), '');

// What is on disk is exactly the set of cities, with nothing left behind from a
// city that used to be in the list.
const cityDirs = (await readdir(path.join(root, 'cities'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
assert.deepEqual(
  cityDirs,
  COASTAL_CITIES.map(citySlug).sort(),
  'the cities/ directory does not match COASTAL_CITIES; run npm run generate:city-pages',
);

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
