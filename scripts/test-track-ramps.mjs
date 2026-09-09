import assert from 'node:assert/strict';

// setLocale writes the document language and dispatches a change event, so it
// needs the two hooks it touches. Same stub scripts/test-i18n.mjs uses.
globalThis.document = { documentElement: { lang: 'en' }, dispatchEvent() {} };

const { setLocale } = await import('../src/i18n.js');
import {
  DEFAULT_TRACK_COLOR_MODE,
  MONTH_RAMP,
  NO_DATA_COLOR,
  PRESSURE_BINS,
  PRESSURE_RAMP,
  rampStops,
  SEASON_MONTHS,
  TRACK_COLOR_MODES,
  trackLegendRows,
  trackLegendTitle,
  trackPointColor,
  WIND_BINS,
  WIND_RAMP,
} from '../src/track-ramps.js';

// ---------------------------------------------------------------- shape
assert.deepEqual([...TRACK_COLOR_MODES], ['category', 'wind', 'pressure', 'month']);
assert.ok(TRACK_COLOR_MODES.includes(DEFAULT_TRACK_COLOR_MODE));
assert.equal(WIND_RAMP.length, WIND_BINS.length, 'one wind colour per bin');
assert.equal(PRESSURE_RAMP.length, PRESSURE_BINS.length, 'one pressure colour per bin');
assert.equal(MONTH_RAMP.length, SEASON_MONTHS.length, 'one colour per season month');

// The generator and the written-out arrays have to agree; check-track-ramps.mjs
// enforces this too, but a failure here says which array moved.
assert.deepEqual([...WIND_RAMP], rampStops(WIND_RAMP.length));
assert.deepEqual([...MONTH_RAMP], rampStops(MONTH_RAMP.length));
assert.equal(rampStops(1).length, 1, 'a one-stop ramp must not divide by zero');

// ---------------------------------------------------------------- category
// 'category' is the encoding the ramp does not own: the palette lives in
// settings.js and follows the colourblind toggle, so this must decline rather
// than answer with a ramp colour.
assert.equal(trackPointColor('category', { wind: 100, pres: 950, t: '2005-08-29T00:00:00Z' }), null);
assert.equal(trackPointColor('nonsense', { wind: 100 }), null);

// ---------------------------------------------------------------- wind
// Expected colours come from the bin edges, not from what the function
// returned: each probe is placed one knot either side of an edge, so an
// off-by-one lands in a different array slot and shows as a different hex.
for (const [index, upper] of WIND_BINS.entries()) {
  if (!Number.isFinite(upper)) continue;
  assert.equal(
    trackPointColor('wind', { wind: upper - 1 }),
    WIND_RAMP[index],
    `${upper - 1} kt belongs in bin ${index}`,
  );
  assert.equal(
    trackPointColor('wind', { wind: upper }),
    WIND_RAMP[index + 1],
    `${upper} kt belongs in bin ${index + 1}`,
  );
}
assert.equal(trackPointColor('wind', { wind: 0 }), WIND_RAMP[0]);
assert.equal(trackPointColor('wind', { wind: 500 }), WIND_RAMP[WIND_RAMP.length - 1]);
assert.equal(trackPointColor('wind', { wind: null }), NO_DATA_COLOR);
assert.equal(trackPointColor('wind', {}), NO_DATA_COLOR);
assert.equal(trackPointColor('wind', { wind: NaN }), NO_DATA_COLOR);

// ---------------------------------------------------------------- pressure
// Pressure runs the other way, so the ramp gets darker as the number falls.
assert.equal(trackPointColor('pressure', { pres: 1013 }), PRESSURE_RAMP[0]);
assert.equal(trackPointColor('pressure', { pres: PRESSURE_BINS[0] }), PRESSURE_RAMP[0]);
assert.equal(trackPointColor('pressure', { pres: PRESSURE_BINS[0] - 1 }), PRESSURE_RAMP[1]);
assert.equal(trackPointColor('pressure', { pres: 902 }), PRESSURE_RAMP[PRESSURE_RAMP.length - 1]);
// Most tracks before the 1980s carry no pressure at all, so this is the common
// case rather than an edge one.
assert.equal(trackPointColor('pressure', { pres: null }), NO_DATA_COLOR);
// Number('') is 0, which is finite, and 0 mb would otherwise read as the
// strongest storm ever recorded rather than as a blank.
assert.equal(trackPointColor('pressure', { pres: 0 }), NO_DATA_COLOR);
assert.equal(trackPointColor('pressure', { pres: -5 }), NO_DATA_COLOR);

// A pressureless point and a 920 mb point must not be painted the same, which
// is what putting missing data in the nearest bin would have done.
assert.notEqual(trackPointColor('pressure', { pres: null }), trackPointColor('pressure', { pres: 910 }));

// ---------------------------------------------------------------- month
for (const [index, month] of SEASON_MONTHS.entries()) {
  const iso = `2005-${String(month).padStart(2, '0')}-15T00:00:00Z`;
  assert.equal(trackPointColor('month', { t: iso }), MONTH_RAMP[index], `month ${month}`);
}
assert.equal(trackPointColor('month', { t: '2005-05-31T00:00:00Z' }), NO_DATA_COLOR, 'May is out of season');
assert.equal(trackPointColor('month', { t: '2005-12-01T00:00:00Z' }), NO_DATA_COLOR, 'December is out of season');
assert.equal(trackPointColor('month', { t: null }), NO_DATA_COLOR);
assert.equal(trackPointColor('month', {}), NO_DATA_COLOR);

// ---------------------------------------------------------------- legend
assert.deepEqual(trackLegendRows('category'), [], 'the Saffir-Simpson legend already covers category');
assert.equal(trackLegendTitle('category'), '');

for (const mode of ['wind', 'pressure', 'month']) {
  const rows = trackLegendRows(mode);
  const ramp = mode === 'month' ? MONTH_RAMP : WIND_RAMP;
  assert.equal(rows.length, ramp.length + 1, `${mode} legend needs a row per bin plus the no-data row`);
  assert.deepEqual(rows.slice(0, ramp.length).map(row => row.color), [...ramp]);
  assert.equal(rows[rows.length - 1].color, NO_DATA_COLOR);
  assert.ok(trackLegendTitle(mode).length > 0, `${mode} legend must say what it is showing`);
  for (const row of rows) {
    assert.ok(row.label && row.label.trim().length > 0, `${mode} legend row has no label`);
    // A missing catalog entry comes back as the key itself, which would put
    // "trackColor.windRange" on screen and still be a non-empty string.
    assert.ok(!row.label.startsWith('trackColor.'), `${mode} legend row fell back to a raw key: ${row.label}`);
  }
  // Every row distinct, or two readings share a line in the legend.
  assert.equal(new Set(rows.map(row => row.label)).size, rows.length, `${mode} legend repeats a label`);
}

// The labels have to carry the numbers the bins actually use, or the legend
// describes a different encoding from the one the map drew.
const windLabels = trackLegendRows('wind').map(row => row.label).join(' ');
for (const edge of WIND_BINS.filter(Number.isFinite)) {
  assert.ok(windLabels.includes(String(edge)) || windLabels.includes(String(edge - 1)), `wind legend never mentions ${edge}`);
}
const pressureLabels = trackLegendRows('pressure').map(row => row.label).join(' ');
for (const edge of PRESSURE_BINS.filter(Number.isFinite)) {
  assert.ok(pressureLabels.includes(String(edge)) || pressureLabels.includes(String(edge - 1)), `pressure legend never mentions ${edge}`);
}

// ---------------------------------------------------------------- locales
// Month names come from Intl through the app's own date locale. Spanish is the
// check that this is not silently the browser's locale, which put an English
// date inside a Spanish panel once already.
{
  const english = trackLegendRows('month').map(row => row.label);
  await setLocale('es');
  const spanish = trackLegendRows('month').map(row => row.label);
  assert.notDeepEqual(spanish, english, 'the month legend did not follow the locale');
  assert.ok(/junio/i.test(spanish[0]), `Spanish June expected, got ${spanish[0]}`);
  assert.ok(/^sin |^fuera /i.test(spanish[spanish.length - 1]), `Spanish no-data row expected, got ${spanish[spanish.length - 1]}`);
  await setLocale('en');
  assert.deepEqual(trackLegendRows('month').map(row => row.label), english, 'switching back must restore English');
}

console.log(
  `track ramps ok (${WIND_RAMP.length} wind bins, ${PRESSURE_RAMP.length} pressure bins, `
  + `${MONTH_RAMP.length} season months, bin edges probed either side, missing data kept out of the ramps)`,
);
