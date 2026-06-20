import assert from 'node:assert/strict';

import { normalizeSettings } from '../src/settings.js';

const settings = normalizeSettings({
  windUnit: 'mph',
  theme: '<script>',
  palette: 'colorblind',
  damageMode: 'invalid',
  nhcForecastCone: false,
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
assert.equal(settings.goesRealtime, true);
assert.equal(settings.highContrast, true);
assert.equal(settings.reducedMotion, true);
assert.equal(settings.locale, 'es');
assert.equal(settings.onboarded, true);
assert.equal(Object.hasOwn(settings, 'unknownKey'), false);

assert.deepEqual(normalizeSettings(null), normalizeSettings({}));

console.log('settings ok');
