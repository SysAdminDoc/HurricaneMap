import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { categoryLabel, ktToMph } from '../src/data.js';
import { publicationCategoryLabel } from '../src/export.js';
import {
  convertWindKnots,
  presentCategory,
  presentDamageMillions,
  presentFatalities,
  presentNumber,
  presentPressure,
  presentWind,
  roundMetric,
} from '../src/metric-presenters.js';
import { buildQGISGeoJSON } from '../src/qgis.js';

for (const category of [-1, 0, 1, 2, 3, 4, 5]) {
  assert.equal(categoryLabel(category), presentCategory(category));
  assert.equal(
    publicationCategoryLabel(category),
    presentCategory(category, { style: 'short', missing: '' }),
  );
}
assert.equal(presentCategory(null), '—');
assert.equal(presentCategory(6, { style: 'short', missing: '' }), '');
assert.equal(presentCategory(-1, { style: 'long' }), 'Tropical Storm');
assert.equal(presentCategory(3, { style: 'long' }), 'Category 3');

assert.equal(presentWind(100), '100 kt');
assert.equal(presentWind(100, { unit: 'mph' }), '115 mph');
assert.equal(presentWind(100, { unit: 'kmh', decimals: 1 }), '185.2 km/h');
assert.equal(presentWind(null), '—');
assert.equal(convertWindKnots(100, 'mph'), 115.07799999999999);
assert.equal(ktToMph(100), roundMetric(convertWindKnots(100, 'mph')));

assert.equal(presentNumber(108.75, 1), '108.8');
assert.equal(presentNumber(null, 1), '—');
assert.equal(presentPressure(920), '920 mb');
assert.equal(presentPressure(null), '—');
assert.equal(presentFatalities(1), '1 fatality');
assert.equal(presentFatalities(12_000), '12k fatalities');
assert.equal(presentDamageMillions(1500), '$1.5B');
assert.equal(presentDamageMillions(null), 'N/A');

const qgis = buildQGISGeoJSON({
  landfalls: [{
    storm_id: 'AL012026',
    name: 'ALPHA',
    year: 2026,
    t: '2026-06-01T00:00:00Z',
    lat: 25,
    lon: -80,
    wind: 64,
    category: 1,
  }],
});
assert.equal(qgis.features[0].properties.category, publicationCategoryLabel(1));
assert.equal(qgis.features[0].properties.wind_speed_mph, ktToMph(64));

for (const relative of [
  '../src/settings.js',
  '../src/metrics.js',
  '../src/panel.js',
  '../src/stats.js',
  '../src/compare.js',
  '../src/export.js',
  '../src/report.js',
  '../src/qgis.js',
]) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /metric-presenters\.js/, `${relative} does not use shared metric presenters`);
}

console.log('metric presenters ok (UI, report, CSV, and QGIS parity)');
