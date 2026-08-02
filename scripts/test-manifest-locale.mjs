import assert from 'node:assert/strict';

import { initManifestLocale, manifestPathForLocale, syncManifestLocale } from '../src/manifest-locale.js';

assert.equal(manifestPathForLocale('en'), 'manifest.webmanifest');
assert.equal(manifestPathForLocale('es'), 'manifest.es.webmanifest');
assert.equal(manifestPathForLocale('ht'), 'manifest.ht.webmanifest');
assert.equal(manifestPathForLocale('fr'), 'manifest.webmanifest');

let href = '';
let listener = null;
const documentRef = {
  querySelector: selector => selector === 'link[rel="manifest"]'
    ? { setAttribute: (name, value) => { if (name === 'href') href = value; } }
    : null,
  addEventListener: (type, callback) => { if (type === 'hm-locale:change') listener = callback; },
};

assert.equal(syncManifestLocale('es', documentRef), 'manifest.es.webmanifest');
assert.equal(href, 'manifest.es.webmanifest');
assert.equal(initManifestLocale('ht', documentRef), 'manifest.ht.webmanifest');
assert.equal(href, 'manifest.ht.webmanifest');
listener({ detail: { locale: 'en' } });
assert.equal(href, 'manifest.webmanifest');

console.log('manifest locale routing ok (en, es, ht, and safe fallback)');
