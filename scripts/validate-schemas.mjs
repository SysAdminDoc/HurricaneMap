import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaFiles = [
  'metadata-v1.schema.json',
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

const savedViewsValidator = ajv.getSchema(schemas.get('saved-views-v1.schema.json').$id);
assert.equal(
  savedViewsValidator({ schema_version: 2, views: [] }),
  false,
  'saved-view schema must reject future versions',
);

console.log(`JSON schemas ok (${schemaFiles.length} Draft 2020-12 contracts, release fixtures validated)`);
