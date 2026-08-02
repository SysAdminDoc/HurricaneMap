import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStacFiles } from './generate-stac-catalog.mjs';
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

console.log(`STAC tests ok (${full.radarItems} deterministic radar items, full/core validation)`);
