import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildQGISGeoJSON } from '../src/qgis.js';

const [landfalls, storms] = await Promise.all([
  readFile(new URL('../data/landfalls.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../data/storms.json', import.meta.url), 'utf8').then(JSON.parse),
]);
const document = buildQGISGeoJSON({
  landfalls,
  storms,
  filters: {},
  exportedAt: '2026-07-29T00:00:00.000Z',
});

assert.equal(document.type, 'FeatureCollection');
assert.equal(Object.hasOwn(document, 'crs'), false, 'RFC 7946 forbids alternate CRS declarations');
assert(Array.isArray(document.features) && document.features.length > landfalls.length);
for (const [index, feature] of document.features.entries()) {
  assert.equal(feature.type, 'Feature', `feature ${index} has the wrong type`);
  assert(feature.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties));
  assert(['Point', 'LineString'].includes(feature.geometry?.type), `feature ${index} has unsupported geometry`);
  const positions = feature.geometry.type === 'Point'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
  if (feature.geometry.type === 'LineString') assert(positions.length >= 2);
  for (const position of positions) {
    assert.equal(position.length, 2, `feature ${index} position must be [longitude, latitude]`);
    assert(Number.isFinite(position[0]) && position[0] >= -180 && position[0] <= 180);
    assert(Number.isFinite(position[1]) && position[1] >= -90 && position[1] <= 90);
  }
}

console.log(`RFC 7946 export ok (${document.features.length} Point/LineString features in WGS 84 longitude-latitude order)`);
