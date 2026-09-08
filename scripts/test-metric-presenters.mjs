import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { categoryLabel, ktToMph } from '../src/data.js';
import { publicationCategoryLabel } from '../src/export.js';
import {
  convertWindKnots,
  MISSING_METRIC,
  presentCategory,
  presentDamageMillions,
  presentFatalities,
  presentNumber,
  presentPressure,
  presentWind,
  roundMetric,
  WIND_FACTORS,
} from '../src/metric-presenters.js';
import { buildQGISGeoJSON } from '../src/qgis.js';
import {
  buildComparisonCSVText,
  escapeCSV,
  formatComparisonValue,
  getComparisonRows,
} from '../src/compare-rows.js';

// Literal expectations, not `labelA(x) === labelB(x)`. Comparing two functions
// proves they delegate to each other and nothing about what either returns, so
// both could drift together and stay green.
// [category, display label, publication label]. The publication style drops the
// "Cat " prefix because a CSV column is already titled Category, which is a
// real difference between the two and one that comparing the two functions to
// each other could never have shown.
const CATEGORY_LABELS = [
  [-1, 'TS', 'TS'],
  [0, 'TD', 'TD'],
  [1, 'Cat 1', '1'],
  [2, 'Cat 2', '2'],
  [3, 'Cat 3', '3'],
  [4, 'Cat 4', '4'],
  [5, 'Cat 5', '5'],
];
for (const [category, display, publication] of CATEGORY_LABELS) {
  assert.equal(presentCategory(category), display, `presentCategory(${category})`);
  assert.equal(categoryLabel(category), display, `categoryLabel(${category})`);
  assert.equal(publicationCategoryLabel(category), publication, `publicationCategoryLabel(${category})`);
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
// 100 kt is 115.078 mph, rounded to 115. Deriving the expected value by
// calling the converter would have made this pass for any conversion factor.
assert.equal(ktToMph(100), 115);
assert.equal(ktToMph(64), 74);

// The knot conversions live in one table. Three modules used to hold their own
// copy of 1.15078, and the CSV and QGIS headers still print the number as text,
// so both the arithmetic and the documentation are held to the same constant.
assert.equal(WIND_FACTORS.mph, 1.15078);
assert.equal(WIND_FACTORS.kmh, 1.852);
// Binary floating point puts 100 kt at 115.07799999999999 mph, so these carry a
// tolerance rather than the literal the arithmetic happens to produce.
const closeTo = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  `expected ${actual} to be within 1e-9 of ${expected}`,
);
closeTo(convertWindKnots(100, 'mph'), 115.078);
closeTo(convertWindKnots(100, 'kmh'), 185.2);
assert.equal(convertWindKnots(100, 'kt'), 100);
assert.equal(convertWindKnots(100, 'furlongs'), null);
assert.equal(convertWindKnots(Number.NaN, 'mph'), null);
assert.equal(presentWind(64, { unit: 'mph', decimals: null }), '74 mph');
assert.equal(presentWind(64, { unit: 'mph', suffix: false }), '74');
assert.equal(presentWind(null, { unit: 'mph' }), MISSING_METRIC);

assert.equal(roundMetric(115.078), 115);
assert.equal(roundMetric(115.078, 2), 115.08);
assert.equal(roundMetric(Number.NaN), null);

assert.equal(presentCategory(0, { style: 'long' }), 'Tropical Depression');
assert.equal(presentCategory(-1, { style: 'long' }), 'Tropical Storm');
assert.equal(presentCategory(3, { style: 'long' }), 'Category 3');
assert.equal(presentCategory(6), MISSING_METRIC);
assert.equal(presentCategory(null), MISSING_METRIC);

assert.equal(presentDamageMillions(0.5), '$500K');
assert.equal(presentDamageMillions(5), '$5M');
assert.equal(presentDamageMillions(50), '$50M');
assert.equal(presentDamageMillions(1500), '$1.5B');
assert.equal(presentDamageMillions(125000), '$125B');
assert.equal(presentDamageMillions(null), MISSING_METRIC);
assert.equal(presentWind(64, { unit: 'mph' }), '74 mph');

assert.equal(presentNumber(108.75, 1), '108.8');
assert.equal(presentNumber(null, 1), '—');
assert.equal(presentPressure(920), '920 mb');
assert.equal(presentPressure(null), '—');
assert.equal(presentFatalities(1), '1 fatality');
assert.equal(presentFatalities(12_000), '12k fatalities');
assert.equal(presentDamageMillions(1500), '$1.5B');
// Was 'N/A'. These two presenters were the last surface spelling an absent
// value differently from every other one, so their default is now the single
// MISSING_METRIC marker. A caller that wants its own token still passes one.
assert.equal(presentDamageMillions(null), MISSING_METRIC);
assert.equal(presentFatalities(null), MISSING_METRIC);
assert.equal(presentDamageMillions(null, { missing: 'nothing recorded' }), 'nothing recorded');

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

// The CSV and QGIS exports print the conversion factor in their own header text
// for anyone reading the file later. That text is a claim about the arithmetic,
// so it is held to the same constant: a corrected factor cannot be applied in
// the code and left wrong in the documentation beside it.
const MPH_FACTOR_IN_PROSE = /mph[^\n]{0,40}?(\d+\.\d+)/g;
for (const relative of ['../src/export.js', '../src/qgis.js']) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const quoted = [...source.matchAll(MPH_FACTOR_IN_PROSE)].map(match => match[1]);
  assert.ok(quoted.length, `${relative} no longer documents the knots-to-mph factor`);
  for (const factor of quoted) {
    assert.equal(
      factor,
      String(WIND_FACTORS.mph),
      `${relative} documents mph = knots x ${factor} while WIND_FACTORS.mph is ${WIND_FACTORS.mph}`,
    );
  }
}

console.log('metric presenters ok (UI, report, CSV, and QGIS parity)');
