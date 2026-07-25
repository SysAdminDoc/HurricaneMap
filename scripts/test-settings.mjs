import assert from 'node:assert/strict';

import { migrateSettingsRecord, normalizeSettings } from '../src/settings.js';

const settings = normalizeSettings({
  windUnit: 'mph',
  theme: '<script>',
  palette: 'colorblind',
  damageMode: 'invalid',
  nhcForecastCone: false,
  nhcOutlook: false,
  marineWarnings: true,
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
assert.equal(settings.goesRealtime, true);
assert.equal(settings.highContrast, true);
assert.equal(settings.reducedMotion, true);
assert.equal(settings.locale, 'es');
assert.equal(settings.onboarded, true);
assert.equal(Object.hasOwn(settings, 'unknownKey'), false);

assert.deepEqual(normalizeSettings(null), normalizeSettings({}));

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
