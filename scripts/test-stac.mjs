import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStacFiles, STAC_BROWSER_URL } from './generate-stac-catalog.mjs';
import { validateStac } from './check-stac.mjs';
import { stageDistribution } from './build-distribution.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', '.test-stac-core');
const generated = await buildStacFiles({ root });
assert(generated.size > 1700, `STAC generator produced too few files: ${generated.size}`);
assert(generated.has('data/stac/catalog.json'), 'STAC generator omitted the catalog');
assert(generated.has('data/stac/items/hurdat2.json'), 'STAC generator omitted the HURDAT2 item');
const catalogOnDisk = await readFile(path.join(root, 'data/stac/catalog.json'), 'utf8');
assert.equal(catalogOnDisk, generated.get('data/stac/catalog.json'), 'checked-in catalog is not reproducible');
const hurdat2Collection = JSON.parse(await readFile(path.join(root, 'data/stac/collections/hurdat2.json'), 'utf8'));
const radarCollection = JSON.parse(await readFile(path.join(root, 'data/stac/collections/radar.json'), 'utf8'));
const coverage = JSON.parse(await readFile(path.join(root, 'data/coverage.json'), 'utf8'));
const hurdatCoverage = coverage.datasets.find(dataset => dataset.id === 'hurdat2');
const radarCoverage = coverage.datasets.find(dataset => dataset.id === 'radar-archive');
assert.deepEqual(hurdat2Collection.summaries['hurricanemap:year_range'], hurdatCoverage.year_range);
assert.equal(hurdat2Collection.summaries['hurricanemap:inferred_landfall_count'][0], 50);
assert.deepEqual(radarCollection.summaries['hurricanemap:year_range'], radarCoverage.year_range);
assert.equal(radarCollection.summaries['hurricanemap:storm_count'][0], 139);

// ------------------------------------------------------------- self links
//
// STAC says `self` is the absolute location a document can be found online, and
// a viewer pointed at an external catalog resolves the rest of the tree from
// it. A relative `self` left STAC Browser resolving siblings against its own
// host. Checked on every document, not just the catalog, because the browser
// walks into collections and items from there.
const PUBLIC_BASE = 'https://sysadmindoc.github.io/HurricaneMap/';
let selfLinks = 0;
for (const [relative, body] of generated) {
  const document = JSON.parse(body);
  const self = (document.links || []).filter(link => link.rel === 'self');
  assert.equal(self.length, 1, `${relative} must carry exactly one self link`);
  assert.equal(
    self[0].href,
    `${PUBLIC_BASE}${relative}`,
    `${relative}: self must be this document's own published address`,
  );
  selfLinks += 1;

  // Every other link stays relative, so the catalog still navigates from a
  // checked-out repository or an unpacked release with no server. Absolute
  // links there would send a reader offline to read a file they already have.
  for (const link of document.links || []) {
    if (link.rel === 'self' || link.rel === 'describedby') continue;
    assert.ok(
      !/^https?:\/\//.test(link.href),
      `${relative}: ${link.rel} must stay relative so the catalog works offline (${link.href})`,
    );
  }
}
assert.equal(selfLinks, generated.size, 'every STAC document must declare where it lives');

// The link the About dialog and the README both hand a reader. Pinned here so
// the three cannot drift apart, and pinned to browser.moregeo.it because
// radiantearth.github.io/stac-browser now redirects there.
assert.equal(
  STAC_BROWSER_URL,
  'https://browser.moregeo.it/external/sysadmindoc.github.io/HurricaneMap/data/stac/catalog.json',
);
const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
assert.ok(indexHtml.includes(STAC_BROWSER_URL), 'the About dialog must link the catalog browser');
assert.ok(readme.includes(STAC_BROWSER_URL), 'the README must link the catalog browser');
assert.ok(
  !indexHtml.includes('radiantearth.github.io/stac-browser')
  && !readme.includes('radiantearth.github.io/stac-browser'),
  'the retired STAC Browser host must not be linked; it redirects',
);

// ------------------------------------------------------------------- Monty
//
// The catalog deliberately declares no Monty field. Checked on 2026-09-09
// against the released v1.3.0 schema rather than assumed.
//
// One field does map: monty:src_event_id is "the identifier of the event in the
// source system, used to group items belonging to the same source event", which
// is what hurricanemap:storm_id does for the 1,703 radar items. What blocks
// emitting it is the rest of the contract. Declaring the extension makes
// monty:country_codes, monty:hazard_codes, monty:corr_id and a role from
// event/hazard/impact/response required on an item's properties, with
// additionalProperties:false over the monty: namespace, and nothing here can
// supply those honestly: a radar reflectivity frame is not an event, a hazard,
// an impact or a response, the HURDAT2 item covers 590 storms and so has no
// single country, and monty:corr_id is "the unique identifier assigned by the
// Monty system", which a HURDAT2 storm id is not and which cannot be looked up
// because Monty's API is 401-gated. Emitting src_event_id alone would be a
// monty: field on an item that does not declare the extension, which is worse
// than saying nothing. So this guard stops the extension being adopted by
// halves, and the decision to adopt it properly is a roadmap item.
for (const [relative, body] of generated) {
  assert.ok(!body.includes('monty:'), `${relative} declares a Monty field; see the note above`);
  assert.ok(
    !body.includes('monty-stac-extension'),
    `${relative} declares the Monty extension, whose required fields this catalog cannot honestly supply`,
  );
}

const full = await validateStac({ root, profile: 'full' });
assert.equal(full.collections, 2);
assert(full.radarItems >= 1600);
assert(full.radarAssets >= full.radarItems);

try {
  await stageDistribution('core', output, { allowDirty: true });
  const core = await validateStac({ root: output, profile: 'core' });
  assert.equal(core.collections, 2);
  assert.equal(core.radarItems, full.radarItems);
  assert.equal(core.radarAssets, full.radarAssets);
} finally {
  await rm(output, { recursive: true, force: true });
}

console.log(`STAC tests ok (${full.radarItems} deterministic radar items, ${selfLinks} self links, full/core validation)`);
