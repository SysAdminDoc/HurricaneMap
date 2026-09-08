// The activate handler, run rather than read.
//
// check-service-worker.mjs greps sw.js for the contracts it can see in the
// text. It cannot see ordering, and ordering was the bug: validateReleaseBundle
// was the first await in activate, so a throw abandoned the cache cleanup, the
// navigation preload, the pruning and clients.claim() alike. A worker activates
// whether or not its waitUntil settles, so a validation failure produced an
// activated worker that controlled no page and left every superseded cache in
// place, and the pages stayed on the old worker until somebody reloaded by
// hand.
//
// sw.js is a classic worker script with no imports, so it runs here inside a
// function that supplies the globals a service worker gets. That is the only
// way to drive the handler without a browser, and driving it is the point: a
// source check would have passed the whole time.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { initServiceWorkerUpdates } from '../src/sw-updates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'sw.js'), 'utf8');

function makeCache() {
  const entries = new Map();
  return {
    entries,
    async match(key) { return entries.get(String(key)) || undefined; },
    async put(key, value) { entries.set(String(key), value); },
    async delete(key) { return entries.delete(String(key)); },
    async keys() { return [...entries.keys()]; },
    async addAll() {},
  };
}

/**
 * Run sw.js with a stubbed service-worker global and return what it registered
 * plus the calls the handlers made.
 */
async function loadServiceWorker({ validatorThrows = false, cleanupThrows = false } = {}) {
  const listeners = new Map();
  const calls = { claimed: 0, deleted: [], preloadEnabled: 0 };
  const cacheStore = new Map([
    ['hm-shell-hm-v0.0.1-stale', makeCache()],
    ['hm-data-hm-v0.0.1-stale', makeCache()],
  ]);

  const self = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    skipWaiting() {},
    registration: {
      navigationPreload: { async enable() { calls.preloadEnabled += 1; } },
    },
    clients: {
      claim() { calls.claimed += 1; },
      async matchAll() { return []; },
    },
    location: new URL('https://example.test/sw.js'),
  };

  const caches = {
    async keys() {
      if (cleanupThrows) throw new Error('cache index unreadable');
      return [...cacheStore.keys()];
    },
    async open(name) {
      if (!cacheStore.has(name)) cacheStore.set(name, makeCache());
      return cacheStore.get(name);
    },
    async delete(name) { calls.deleted.push(name); return cacheStore.delete(name); },
    async match() { return undefined; },
  };

  const context = vm.createContext({
    self,
    caches,
    location: self.location,
    clients: self.clients,
    registration: self.registration,
    fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    Response,
    Request,
    Headers,
    URL,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    indexedDB: undefined,
    CompressionStream: undefined,
    DecompressionStream: undefined,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    Date,
    Promise,
  });
  context.globalThis = context;
  context.self.global = context;

  vm.runInContext(source, context, { filename: 'sw.js' });

  // Replace the validator after the script has defined it. A worker script has
  // no export surface, so the seam is the context's own binding.
  if (validatorThrows) {
    vm.runInContext(
      "validateReleaseBundle = async () => { throw new Error('release tuple mismatch'); };",
      context,
      { filename: 'sw-stub.js' },
    );
  } else {
    vm.runInContext('validateReleaseBundle = async () => undefined;', context, { filename: 'sw-stub.js' });
  }

  return { listeners, calls, cacheStore, context };
}

async function runActivate({ validatorThrows = false, cleanupThrows = false } = {}) {
  const loaded = await loadServiceWorker({ validatorThrows, cleanupThrows });
  const handlers = loaded.listeners.get('activate') || [];
  assert.equal(handlers.length, 1, 'sw.js must register exactly one activate handler');
  let waited = null;
  handlers[0]({ waitUntil(promise) { waited = promise; } });
  assert(waited, 'the activate handler must pass its work to waitUntil');
  loaded.rejection = await waited.then(() => null, error => error);
  return loaded;
}

// A validator that throws must not cost the worker its clients.
{
  const failed = await runActivate({ validatorThrows: true });
  assert.equal(
    failed.calls.claimed,
    1,
    'a throwing validator must still leave clients.claim() called, or the new worker controls no page and the tabs stay on the old one',
  );
  assert(
    failed.calls.deleted.length > 0,
    `a throwing validator must still leave the superseded caches cleaned up, deleted: ${JSON.stringify(failed.calls.deleted)}`,
  );
  assert.equal(
    failed.calls.preloadEnabled,
    1,
    'a throwing validator must still leave navigation preload enabled',
  );
}

// Housekeeping that throws must not cost the worker its clients either. This
// is the half a guard around the validator alone would still have missed:
// caches.keys(), the pruning and the legacy-database deletion are all awaits
// between the validator and the claim, and any one of them reaching for
// storage that is blocked or corrupt used to end the handler.
{
  const failed = await runActivate({ cleanupThrows: true });
  assert.equal(
    failed.calls.claimed,
    1,
    'cleanup that throws must still leave clients.claim() called',
  );
}

// And the clean path is unchanged.
{
  const clean = await runActivate({ validatorThrows: false });
  assert.equal(clean.calls.claimed, 1, 'a passing validator must claim clients');
  assert(clean.calls.deleted.length > 0, 'a passing validator must clean up superseded caches');
}

// The other tabs. Accepting an update in one tab swaps the controller for every
// tab on the origin, but only the tab that clicked used to hear about it. The
// rest keep their old module graph while any later lazy import() resolves
// against the new version, so a tab can run two versions of the app at once
// with nothing on screen to say so.
//
// initServiceWorkerUpdates takes every global it touches as a parameter, so
// this drives the real handler rather than a copy of its logic.
{
  function harness({ startsControlled = true, visibility = 'visible' } = {}) {
    const listeners = new Map();
    const state = { reloads: 0, appended: [] };
    const serviceWorker = {
      controller: startsControlled ? { postMessage() {} } : null,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      async register() { return null; },
      async getRegistration() { return null; },
      ready: new Promise(() => {}),
    };
    const element = {
      hidden: true,
      classList: { add() {}, remove() {}, contains: () => false },
      parentElement: null,
      querySelector: () => ({ addEventListener() {} }),
      querySelectorAll: () => [],
      appendChild() {},
      setAttribute() {},
      remove() {},
      insertAdjacentHTML() {},
    };
    const documentRef = {
      visibilityState: visibility,
      documentElement: {},
      body: { appendChild(node) { state.appended.push(node); }, ...element },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ ...element }),
      addEventListener() {},
      dispatchEvent: () => true,
    };
    const windowRef = { addEventListener() {}, requestAnimationFrame(fn) { fn(); } };
    globalThis.requestAnimationFrame ??= (fn) => fn();
    const locationRef = {
      protocol: 'https:',
      hostname: 'example.test',
      reload() { state.reloads += 1; },
    };
    return { listeners, state, serviceWorker, documentRef, windowRef, locationRef };
  }

  function fire(h) {
    initServiceWorkerUpdates({
      windowRef: h.windowRef,
      navigatorRef: { serviceWorker: h.serviceWorker },
      documentRef: h.documentRef,
      locationRef: h.locationRef,
    });
    const handlers = h.listeners.get('controllerchange') || [];
    assert.equal(handlers.length, 1, 'one controllerchange handler must be registered');
    handlers[0]();
  }

  // A tab that was already under a worker and did not click: it must not be
  // yanked out from under whoever is reading it, but it must be told.
  const visible = harness({ startsControlled: true, visibility: 'visible' });
  fire(visible);
  assert.equal(visible.state.reloads, 0, 'a visible tab must not reload itself when another tab takes the update');

  // Nobody is looking at this one, so reloading costs nothing and removes the
  // mixed-version window entirely.
  const hidden = harness({ startsControlled: true, visibility: 'hidden' });
  fire(hidden);
  assert.equal(hidden.state.reloads, 1, 'a hidden tab should reload rather than queue a prompt nobody will see');

  // The first controller a page ever acquires fires the same event. Reloading
  // there would restart a page that has only just finished loading. Hidden on
  // purpose: with a visible tab the guard and its absence look identical, so
  // the check would pass whether or not the guard existed.
  const fresh = harness({ startsControlled: false, visibility: 'hidden' });
  fire(fresh);
  assert.equal(fresh.state.reloads, 0, 'a page acquiring its first controller must not reload itself');
}

console.log('service worker activate ok (claims clients through a failing validator and a failing cleanup; other tabs are told when one takes the update)');
