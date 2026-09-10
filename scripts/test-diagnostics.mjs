import assert from 'node:assert/strict';

import {
  buildSanitizedSupportBundle,
  sanitizeDiagnosticText,
} from '../src/diagnostics.js';
import { activeCacheNames } from '../src/storage-manager.js';
import {
  getServiceWorkerDiagnostics,
  requestOfflineIntegrityCheck,
  retryServiceWorkerRegistration,
  WORKER_TYPES,
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
const failedServiceWorkerDiagnostics = getServiceWorkerDiagnostics();

const blockedNavigator = { serviceWorker: { controller: null } };
assert.equal(await retryServiceWorkerRegistration({
  navigatorRef: blockedNavigator,
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
}), null);
assert.equal(getServiceWorkerDiagnostics().registration, 'unsupported');

// Firefox 146 and earlier reject a module service worker outright, and Firefox
// ESR 140 is still supported. sw.js has no imports and no import.meta, so the
// same file registers as a classic worker instead of the atlas having no
// offline at all.
const registrationAttempts = [];
const moduleRefusingNavigator = {
  serviceWorker: {
    controller: null,
    register: async (path, options) => {
      registrationAttempts.push(options?.type);
      if (options?.type === 'module') throw new TypeError('Type error');
      return { scope: 'https://example.test/', active: { scriptURL: 'https://example.test/sw.js' } };
    },
  },
};
const classicRegistration = await retryServiceWorkerRegistration({
  navigatorRef: moduleRefusingNavigator,
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
});
assert.ok(classicRegistration, 'a browser that refuses a module worker must still get a worker');
assert.deepEqual(registrationAttempts, WORKER_TYPES, 'module is tried first and classic is the fallback, in that order');
assert.equal(getServiceWorkerDiagnostics().registration, 'registered');
assert.equal(
  getServiceWorkerDiagnostics().workerType,
  'classic',
  'the diagnostics panel has to say which worker type is actually running',
);

// Where the module type is accepted nothing else is attempted.
const moduleAttempts = [];
await retryServiceWorkerRegistration({
  navigatorRef: {
    serviceWorker: {
      controller: null,
      register: async (path, options) => {
        moduleAttempts.push(options?.type);
        return { scope: 'https://example.test/' };
      },
    },
  },
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
});
assert.deepEqual(moduleAttempts, ['module'], 'a working module registration must not also register a classic one');
assert.equal(getServiceWorkerDiagnostics().workerType, 'module');

// Both refused is still an error, and it must not claim a type is running.
const bothRefused = [];
assert.equal(await retryServiceWorkerRegistration({
  navigatorRef: {
    serviceWorker: {
      controller: null,
      register: async (path, options) => {
        bothRefused.push(options?.type);
        throw new Error('no worker for you');
      },
    },
  },
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
}), null);
assert.deepEqual(bothRefused, WORKER_TYPES);
assert.equal(getServiceWorkerDiagnostics().registration, 'error');
assert.equal(getServiceWorkerDiagnostics().workerType, null);
assert.match(getServiceWorkerDiagnostics().lastError.message, /no worker for you/, 'the reported error is the last one, not the first');

const emptyRegistrationNavigator = {
  serviceWorker: {
    controller: null,
    register: async () => undefined,
  },
};
assert.equal(await retryServiceWorkerRegistration({
  navigatorRef: emptyRegistrationNavigator,
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
}), undefined);
assert.equal(getServiceWorkerDiagnostics().registration, 'registered');
assert.equal(getServiceWorkerDiagnostics().scope, null);

const bundle = buildSanitizedSupportBundle({
  appVersion: '1.9.3',
  dataSchemaVersion: 1,
  online: false,
  serviceWorker: failedServiceWorkerDiagnostics,
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
      { id: 'shell', required: true, cacheName: 'hm-shell-hm-v1.9.3', entries: 90, sizeBytes: 120000 },
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
  coverage: {
    schema_version: 1,
    generated_at_utc: '2026-08-03T00:00:00Z',
    source_commit: 'a'.repeat(40),
    catalog: {
      basins: ['AL', 'EP'],
      year_range: [1851, 2025],
      storm_count: 587,
      landfall_event_count: 750,
      hurricane_landfall_count: 370,
    },
    datasets: [{
      id: 'radar-archive',
      label: 'Radar archive',
      value_status: 'final',
      lifecycle_status: 'active',
      basins: ['AL'],
      year_range: [1995, 2025],
      distribution: ['core', 'full'],
      availability: { runnable: true, storms: 138, frames: 1697 },
    }],
  },
});
const serialized = JSON.stringify(bundle);
// 2 since the storage figures were renamed to say they are approximate. A
// literal here rather than the imported constant on purpose: importing it
// would make this assertion agree with any future bump automatically, and the
// point of a schema version is that changing it is a decision somebody makes.
assert.equal(bundle.schema_version, 2);
assert.equal(bundle.app.version, '1.9.3');
assert.equal(bundle.storage.radar_pack_count, 1);
assert.equal(bundle.coverage.available, true);
assert.equal(bundle.coverage.catalog.storm_count, 587);
assert.equal(bundle.coverage.datasets[0].availability.frames, 1697);
assert.equal(bundle.storage.scopes[0].cache_name, 'hm-shell-hm-v1.9.3');
assert.deepEqual(bundle.offline_integrity, {
  state: 'unverified',
  error: null,
  checked_at_utc: null,
});
assert.equal(bundle.errors.length, 1);
assert.match(bundle.errors[0].message, /\[path\]/);
assert.doesNotMatch(serialized, /Alice|Private Street|private-name|private\.png|latitude|longitude|address|saved.?view|preparedness/i);
assert.equal(sanitizeDiagnosticText('https://example.test/private'), '[url]');

let successfulRegistrationOptions = null;
const successfulNavigator = {
  serviceWorker: {
    controller: { state: 'activated' },
    register: async (_path, options) => {
      successfulRegistrationOptions = options;
      return {
      scope: 'https://example.test/',
      active: { scriptURL: 'https://example.test/sw.js' },
      };
    },
  },
};
await retryServiceWorkerRegistration({
  navigatorRef: successfulNavigator,
  documentRef: null,
  locationRef: { protocol: 'https:', hostname: 'example.test' },
});
assert.equal(getServiceWorkerDiagnostics().registration, 'registered');
assert.equal(getServiceWorkerDiagnostics().controller, 'controlled');
assert.deepEqual(successfulRegistrationOptions, {
  type: 'module',
  updateViaCache: 'none',
}, 'service worker registration must use module scripts and bypass stale HTTP cache');

const integrityListeners = new Set();
const integrityNavigator = {
  serviceWorker: {
    controller: {
      postMessage(message) {
        if (message.type !== 'CHECK_OFFLINE_INTEGRITY') return;
        queueMicrotask(() => integrityListeners.forEach(listener => listener({
          data: {
            type: 'OFFLINE_INTEGRITY_RESULT',
            state: 'stale-but-valid',
            error: 'old release tuple',
            checked_at_utc: '2026-08-03T00:00:00.000Z',
            sw_version: 'hm-v1.9.3',
            shell_cache: 'hm-shell-hm-v1.9.3',
            data_cache: 'hm-data-hm-v1.9.3',
          },
        })));
      },
    },
    addEventListener(type, listener) {
      if (type === 'message') integrityListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') integrityListeners.delete(listener);
    },
  },
};
const integrityResult = await requestOfflineIntegrityCheck({ navigatorRef: integrityNavigator, documentRef: null });
// The worker names the caches it is serving from. A client that instead picks
// the highest version present reports on the leftovers of an install that
// failed and never activated, while the old worker keeps serving correctly.
assert.deepEqual(integrityResult, {
  state: 'stale-but-valid',
  error: 'old release tuple',
  checkedAt: '2026-08-03T00:00:00.000Z',
  swVersion: 'hm-v1.9.3',
  shellCache: 'hm-shell-hm-v1.9.3',
  dataCache: 'hm-data-hm-v1.9.3',
  // This worker reported no last_activate, and null is the honest answer: it
  // means the instance answering has not run activate, which a worker
  // terminated for idleness and respawned to handle this very message has not.
  // It is not the same as an activate that found nothing wrong.
  lastActivate: null,
});
const publishedNames = getServiceWorkerDiagnostics();
assert.equal(publishedNames.activeShellCache, 'hm-shell-hm-v1.9.3');
assert.equal(publishedNames.activeDataCache, 'hm-data-hm-v1.9.3');
assert.equal(publishedNames.activeSwVersion, 'hm-v1.9.3');
assert.deepEqual(
  activeCacheNames(publishedNames),
  { shell: 'hm-shell-hm-v1.9.3', data: 'hm-data-hm-v1.9.3' },
);

// A later probe that times out must not erase what a working one reported: the
// caches did not change because the worker stopped answering.
const silentNavigator = {
  serviceWorker: {
    controller: { postMessage() {} },
    addEventListener() {},
    removeEventListener() {},
  },
};
const timedOut = await requestOfflineIntegrityCheck({
  navigatorRef: silentNavigator,
  documentRef: null,
  timeoutMs: 10,
});
assert.equal(timedOut.state, 'unverified');
assert.equal(
  getServiceWorkerDiagnostics().activeShellCache,
  'hm-shell-hm-v1.9.3',
  'a timed-out probe must leave the last known cache names in place',
);

console.log('offline diagnostics ok (registration retry, cache/version bundle, privacy redaction, active cache names)');
