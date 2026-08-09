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
import {
  buildComparisonCSVText,
  escapeCSV,
  formatComparisonValue,
  getComparisonRows,
} from '../src/compare-rows.js';

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

const comparisonStorm = {
  id: 'AL012026',
  name: 'ALPHA',
  year: 2026,
  peak_wind_kt: 100,
  min_pres_mb: 920,
  landfall_max_category: 2,
  us_landfall_count: 2,
  us_landfalls: [{ state: 'FL' }, { state: 'TX' }, { state: 'FL' }],
  track: [
    { t: '2026-08-01T00:00:00Z', lat: 20, lon: -60, wind: 40, pres: 1000 },
    { t: '2026-08-01T06:00:00Z', lat: 21, lon: -61, wind: 50, pres: 990 },
    { t: '2026-08-01T12:00:00Z', lat: 22, lon: -62, wind: 60, pres: 980 },
    { t: '2026-08-01T18:00:00Z', lat: 23, lon: -63, wind: 70, pres: 970 },
    { t: '2026-08-02T00:00:00Z', lat: 24, lon: -64, wind: 80, pres: 960 },
  ],
};
const comparisonPin = {
  id: comparisonStorm.id,
  name: comparisonStorm.name,
  year: comparisonStorm.year,
  storm: comparisonStorm,
};
const comparisonTranslate = key => key;
for (const [windUnit, locale] of [['kt', 'en-US'], ['mph', 'es-ES'], ['kmh', 'ht']]) {
  const rows = getComparisonRows({
    allStorms: [comparisonStorm],
    translate: comparisonTranslate,
    windUnit,
    locale,
  });
  const csv = buildComparisonCSVText({
    storms: [comparisonPin],
    allStorms: [comparisonStorm],
    translate: comparisonTranslate,
    windUnit,
    locale,
    generatedAt: '2026-08-08T00:00:00.000Z',
  });
  const csvLines = csv.split('\n');
  for (const row of rows) {
    const visible = formatComparisonValue(row, comparisonPin);
    assert(
      csvLines.includes(`${escapeCSV(row.label)},${escapeCSV(visible)}`),
      `${windUnit}/${locale} comparison parity drifted for ${row.id}`,
    );
  }
}

for (const relative of [
  '../src/settings.js',
  '../src/metrics.js',
  '../src/panel.js',
  '../src/stats.js',
  '../src/compare-rows.js',
  '../src/export.js',
  '../src/report.js',
  '../src/qgis.js',
]) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  assert.match(source, /metric-presenters\.js/, `${relative} does not use shared metric presenters`);
}

console.log('metric presenters ok (UI, report, CSV, and QGIS parity)');
