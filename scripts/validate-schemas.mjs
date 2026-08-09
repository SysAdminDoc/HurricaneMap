import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import Ajv2020 from 'ajv/dist/2020.js';

import { STAC_FILE_EXTENSION, STAC_SCHEMA_URLS, STAC_VERSION } from './generate-stac-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFiles = [
  'metadata-v1.schema.json',
  'coverage-v1.schema.json',
  'hurdat2-sources-v1.schema.json',
  'aoml-landfalls-v1.schema.json',
  'landfalls-v1.schema.json',
  'storms-v1.schema.json',
  'impacts-v1.schema.json',
  'saved-views-v1.schema.json',
  'release-manifest-v1.schema.json',
  'distribution-v1.schema.json',
  'advisories-v1.schema.json',
  'stac-v1.schema.json',
];
const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemas = new Map();
for (const filename of schemaFiles) {
  const schema = JSON.parse(await readFile(path.join(root, 'schemas', filename), 'utf8'));
  schemas.set(filename, schema);
  ajv.addSchema(schema);
}

const fixtures = [
  ['metadata-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/metadata.json'), 'utf8'))],
  ['coverage-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/coverage.json'), 'utf8'))],
  ['hurdat2-sources-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/hurdat2-sources.json'), 'utf8'))],
  ['aoml-landfalls-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/aoml-landfalls.json'), 'utf8'))],
  ['landfalls-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/landfalls.json'), 'utf8'))],
  ['storms-v1.schema.json', JSON.parse(gunzipSync(await readFile(path.join(root, 'data/storms.json.gz'))))],
  ['impacts-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/impacts.json'), 'utf8'))],
  ['saved-views-v1.schema.json', {
    schema_version: 1,
    views: [{
      id: 'katrina-overview',
      name: 'Katrina overview',
      hash: '#v=1&storm=AL122005',
      created_at: '2026-07-29T00:00:00.000Z',
    }],
  }],
  ['release-manifest-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/release-manifest.json'), 'utf8'))],
  ['distribution-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/distribution.json'), 'utf8'))],
  ['advisories-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/advisories.json'), 'utf8'))],
  ['stac-v1.schema.json', JSON.parse(await readFile(path.join(root, 'data/stac/catalog.json'), 'utf8'))],
];

for (const [schemaName, data] of fixtures) {
  const validate = ajv.getSchema(schemas.get(schemaName).$id);
  assert(validate, `schema was not registered: ${schemaName}`);
  if (!validate(data)) {
    const details = ajv.errorsText(validate.errors, { separator: '\n' });
    throw new Error(`${schemaName} rejected its release fixture:\n${details}`);
  }
}

const stacSchema = schemas.get('stac-v1.schema.json');
assert.equal(stacSchema.$defs.base.properties.stac_version.const, STAC_VERSION, 'local STAC schema version drifted from generator');
assert(Object.values(STAC_SCHEMA_URLS).every(url => url.includes(`/v${STAC_VERSION}/`)), 'official STAC schema URLs are not pinned to the generated version');
const stacValidator = ajv.getSchema(stacSchema.$id);
const stacItemPaths = (await readdir(path.join(root, 'data/stac/items/radar'), { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
  .map(entry => `data/stac/items/radar/${entry.name}`)
  .sort();
const stacPaths = [
  'data/stac/catalog.json',
  'data/stac/collections/hurdat2.json',
  'data/stac/collections/radar.json',
  'data/stac/items/hurdat2.json',
  ...stacItemPaths,
];
for (const relative of stacPaths) {
  const document = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
  if (!stacValidator(document)) {
    const details = ajv.errorsText(stacValidator.errors, { separator: '\n' });
    throw new Error(`stac-v1.schema.json rejected ${relative}:\n${details}`);
  }
  assert.equal(document.stac_version, STAC_VERSION, `${relative} has an unexpected STAC version`);
  assert(document.stac_extensions?.includes(STAC_FILE_EXTENSION), `${relative} does not declare the file extension`);
}

const savedViewsValidator = ajv.getSchema(schemas.get('saved-views-v1.schema.json').$id);
assert.equal(
  savedViewsValidator({ schema_version: 2, views: [] }),
  false,
  'saved-view schema must reject future versions',
);

console.log(`JSON schemas ok (${schemaFiles.length} Draft 2020-12 contracts, ${stacPaths.length} STAC 1.1.0 documents and release fixtures validated)`);
