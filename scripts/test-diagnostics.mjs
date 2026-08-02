import assert from 'node:assert/strict';

import {
  buildSanitizedSupportBundle,
  sanitizeDiagnosticText,
} from '../src/diagnostics.js';
import {
  getServiceWorkerDiagnostics,
  retryServiceWorkerRegistration,
} from '../src/sw-updates.js';

const failedNavigator = {
  onLine: false,
  serviceWorker: {
    controller: null,
    register: async () => {
      throw new Error('Registration failed at C:\\Users\\Alice\\private\\sw.js https://example.test/?lat=25');
    },
  },
};
await retryServiceWorkerRegistration({
  navigatorRef: failedNavigator,
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
});
assert.equal(getServiceWorkerDiagnostics().registration, 'error');

const bundle = buildSanitizedSupportBundle({
  appVersion: '1.9.0',
  dataSchemaVersion: 1,
  online: false,
  serviceWorker: getServiceWorkerDiagnostics(),
  storage: {
    usage: 1024,
    quota: 4096,
    persisted: true,
    packs: {
      'AL012026-private-name': {
        urls: ['data/radar/private.png'],
        address: '123 Private Street',
      },
    },
    scopes: [
      { id: 'shell', required: true, cacheName: 'hm-shell-hm-v1.9.0', entries: 90, sizeBytes: 120000 },
      { id: 'radar', required: false, cacheName: 'hm-radar-v1', entries: 3, sizeBytes: 5000 },
    ],
  },
  feeds: [{
    id: 'active',
    state: 'error',
    detail: 'Lookup failed near 123 Private Street',
    cacheOrigin: 'none',
    lastSuccessAt: Date.now() - 60_000,
    nextRetryAt: Date.now() + 60_000,
    latitude: 25,
    address: '123 Private Street',
  }],
});
const serialized = JSON.stringify(bundle);
assert.equal(bundle.schema_version, 1);
assert.equal(bundle.app.version, '1.9.0');
assert.equal(bundle.storage.radar_pack_count, 1);
assert.equal(bundle.storage.scopes[0].cache_name, 'hm-shell-hm-v1.9.0');
assert.equal(bundle.errors.length, 1);
assert.match(bundle.errors[0].message, /\[path\]/);
assert.doesNotMatch(serialized, /Alice|Private Street|private-name|private\.png|latitude|longitude|address|saved.?view|preparedness/i);
assert.equal(sanitizeDiagnosticText('https://example.test/private'), '[url]');

const successfulNavigator = {
  serviceWorker: {
    controller: { state: 'activated' },
    register: async () => ({
      scope: 'https://example.test/',
      active: { scriptURL: 'https://example.test/sw.js' },
    }),
  },
};
await retryServiceWorkerRegistration({
  navigatorRef: successfulNavigator,
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
});
assert.equal(getServiceWorkerDiagnostics().registration, 'registered');
assert.equal(getServiceWorkerDiagnostics().controller, 'controlled');

console.log('offline diagnostics ok (registration retry, cache/version bundle, privacy redaction)');
