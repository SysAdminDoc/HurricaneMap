import assert from 'node:assert/strict';

import { migrateSettingsRecord, normalizeSettings, prefersMoreContrast } from '../src/settings.js';

const settings = normalizeSettings({
  windUnit: 'mph',
  theme: '<script>',
  palette: 'colorblind',
  damageMode: 'invalid',
  nhcForecastCone: false,
  nhcOutlook: false,
  marineWarnings: true,
  marineHorizon: 'next week',
  goesRealtime: true,
  highContrast: true,
  reducedMotion: true,
  locale: 'es',
  onboarded: true,
  unknownKey: 'ignored',
});

assert.equal(settings.windUnit, 'mph');
assert.equal(settings.theme, 'dark');
assert.equal(settings.palette, 'colorblind');
assert.equal(settings.damageMode, 'real');
assert.equal(settings.nhcForecastCone, false);
assert.equal(settings.nhcOutlook, false);
assert.equal(settings.marineWarnings, true);
// A band nobody publishes must fall back, not build an NHC URL that 404s.
assert.equal(settings.marineHorizon, '00to24');
assert.equal(normalizeSettings({ marineHorizon: '24to48' }).marineHorizon, '24to48');
assert.equal(settings.goesRealtime, true);
assert.equal(settings.highContrast, true);
assert.equal(settings.reducedMotion, true);
assert.equal(settings.locale, 'es');
assert.equal(settings.onboarded, true);
assert.equal(Object.hasOwn(settings, 'unknownKey'), false);

// Spelled out rather than normalizeSettings(null) === normalizeSettings({}),
// which only proved the two arguments agree and would have stayed green if
// every default changed at once.
const EXPECTED_DEFAULTS = {
  windUnit: 'kt',
  theme: 'dark',
  palette: 'default',
  damageMode: 'real',
  nhcForecastCone: true,
  nhcOutlook: true,
  marineWarnings: false,
  marineHorizon: '00to24',
  goesRealtime: false,
  locale: 'en',
  highContrast: false,
  reducedMotion: false,
  onboarded: false,
};
assert.deepEqual(normalizeSettings(null), EXPECTED_DEFAULTS);
assert.deepEqual(normalizeSettings({}), EXPECTED_DEFAULTS);

// highContrast above is false because this harness has no matchMedia, not
// because anything defaults it. It is seeded from the OS preference, so pinning
// it without saying so would have pinned Node rather than the product: flipping
// the seeding would not have failed a thing.
{
  const original = Object.hasOwn(globalThis, 'window') ? globalThis.window : undefined;
  try {
    globalThis.window = { matchMedia: query => ({ matches: query === '(prefers-contrast: more)' }) };
    assert.equal(prefersMoreContrast(), true);
    assert.equal(normalizeSettings(null).highContrast, true, 'an OS contrast preference must seed an unset highContrast');
    // A stored false still wins: the seed applies to an unset value only.
    assert.equal(normalizeSettings({ highContrast: false }).highContrast, false);
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(prefersMoreContrast(), false);
    assert.equal(normalizeSettings(null).highContrast, false);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
}

const legacy = migrateSettingsRecord({ windUnit: 'mph', locale: 'es', unknownKey: 'ignored' });
assert.equal(legacy.status, 'legacy');
assert.equal(legacy.shouldPersist, true);
assert.equal(legacy.value.windUnit, 'mph');
assert.equal(legacy.value.locale, 'es');
assert.equal(Object.hasOwn(legacy.value, 'unknownKey'), false);

const future = migrateSettingsRecord({ schema_version: 999, settings: { windUnit: 'mph' } });
assert.equal(future.status, 'unsupported');
assert.equal(future.shouldPersist, false);
assert.equal(future.value.windUnit, 'kt');

console.log('settings ok');
