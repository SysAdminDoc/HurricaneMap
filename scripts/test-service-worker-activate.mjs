// The activate handler and the update prompt, run rather than read.
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
const WORKER_URL = 'https://example.test/sw.js';

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
 * Enough of the Web Locks API to queue. The real one is origin-wide and
 * exclusive, which is the whole point of the test that uses it: a second holder
 * waits, however long the first takes.
 */
function makeLocks() {
  const tail = new Map();
  return {
    request(name, _options, task) {
      const previous = tail.get(name) || Promise.resolve();
      const run = previous.then(() => task({ name }));
      tail.set(name, run.then(() => {}, () => {}));
      return run;
    },
  };
}

/**
 * Run sw.js with a stubbed service-worker global and return what it registered
 * plus the calls the handlers made.
 */
async function loadServiceWorker({ validatorThrows = false, cleanupThrows = false, locks = null } = {}) {
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
      async claim() { calls.claimed += 1; },
      async matchAll() { return []; },
    },
    location: new URL(WORKER_URL),
    navigator: locks ? { locks } : undefined,
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

  // A worker resolves a relative URL against its own location. Node's Request
  // refuses one outright, and that refusal used to abort the cleanup block on
  // its first line in every scenario, so pruneSourceBundle and
  // deleteLegacyDataDbs were never reached by this file at all while its
  // comments claimed they were covered.
  class WorkerRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, WORKER_URL).href : input, init);
    }
  }

  const context = vm.createContext({
    self,
    caches,
    location: self.location,
    clients: self.clients,
    registration: self.registration,
    fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    Response,
    Request: WorkerRequest,
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
  vm.runInContext(
    validatorThrows
      ? "validateReleaseBundle = async () => { throw new Error('release tuple mismatch'); };"
      : 'validateReleaseBundle = async () => undefined;',
    context,
    { filename: 'sw-stub.js' },
  );

  return { listeners, calls, cacheStore, context };
}

function activateHandler(loaded) {
  const handlers = loaded.listeners.get('activate') || [];
  assert.equal(handlers.length, 1, 'sw.js must register exactly one activate handler');
  return handlers[0];
}

async function runActivate(options = {}) {
  const loaded = await loadServiceWorker(options);
  let waited = null;
  activateHandler(loaded)({ waitUntil(promise) { waited = promise; } });
  assert(waited, 'the activate handler must pass its work to waitUntil');
  loaded.rejection = await waited.then(() => null, error => error);
  loaded.lastActivate = vm.runInContext('lastActivate', loaded.context);
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
  assert(
    failed.lastActivate?.failures?.some(message => message.includes('release tuple mismatch')),
    `the validation failure must be reported, got ${JSON.stringify(failed.lastActivate)}`,
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
  assert(
    failed.lastActivate?.failures?.some(message => message.includes('cache index unreadable')),
    `the cleanup failure must be reported, got ${JSON.stringify(failed.lastActivate)}`,
  );
}

// Both halves failing must report both. A single field assigned with ??= kept
// the first and dropped the rest, and the first is whichever happens to run
// earlier, which is not the same as the one worth knowing about.
{
  const failed = await runActivate({ validatorThrows: true, cleanupThrows: true });
  assert.equal(failed.calls.claimed, 1, 'two failures must still leave clients.claim() called');
  assert.equal(
    failed.lastActivate?.failures?.length,
    2,
    `both failures must be reported, got ${JSON.stringify(failed.lastActivate)}`,
  );
}

// And the clean path is clean, which is a stronger claim than "it did not
// throw": nothing at all may be recorded. Every scenario here used to abort
// the cleanup block on its first line, so this is what holds the stub honest.
{
  const clean = await runActivate();
  assert.equal(clean.calls.claimed, 1, 'a passing validator must claim clients');
  assert(clean.calls.deleted.length > 0, 'a passing validator must clean up superseded caches');
  // Length rather than a deep compare: this array was built inside the vm
  // realm, so it is not an instance of this realm's Array.
  assert.equal(
    clean.lastActivate?.failures?.length,
    0,
    `a clean activate must record no failure, got ${JSON.stringify(clean.lastActivate)}`,
  );
  assert(
    typeof clean.lastActivate?.at === 'string',
    'a clean activate must still record that it ran, because null means this worker instance never activated',
  );
}

// The claim must not queue behind the release lock. withReleaseLock takes an
// origin-wide exclusive lock, and install holds it across a full precache while
// repairOfflineData holds it across a re-download the reader can start from the
// diagnostics panel. With the claim inside that lock, a new worker activating
// during either one waits, and a finally does not help: nothing throws, the
// handler simply never gets there.
{
  const locks = makeLocks();
  const loaded = await loadServiceWorker({ locks });
  const lockName = vm.runInContext('RELEASE_LOCK_NAME', loaded.context);
  let releaseHolder;
  const holder = new Promise(resolve => { releaseHolder = resolve; });
  locks.request(lockName, { mode: 'exclusive' }, () => holder);

  let waited = null;
  activateHandler(loaded)({ waitUntil(promise) { waited = promise; } });
  // Let every microtask that is not waiting on the lock run.
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(
    loaded.calls.claimed,
    1,
    'a worker activating while somebody else holds the release lock must still claim its clients',
  );
  assert.equal(
    loaded.calls.deleted.length,
    0,
    'the housekeeping is what waits for the lock, so nothing should have been deleted yet',
  );

  releaseHolder();
  await waited;
  assert(loaded.calls.deleted.length > 0, 'once the lock is free the housekeeping must run');
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
  function harness({ startsControlled = true, visibility = 'visible', waiting = false } = {}) {
    const listeners = new Map();
    const windowListeners = new Map();
    const state = { reloads: 0, posted: [], created: [], clicks: new Map() };

    const deliver = message => {
      state.posted.push(message);
      // Answer the diagnostics probe rather than leaving its ten-second timer
      // running, which would hold the process open for every scenario here.
      if (message?.type !== 'CHECK_OFFLINE_INTEGRITY') return;
      for (const handler of listeners.get('message') || []) {
        handler({ data: { type: 'OFFLINE_INTEGRITY_RESULT', state: 'intact' } });
      }
    };
    const controller = { postMessage: deliver };
    // The worker that was waiting when this tab loaded. After another tab
    // accepts the update, this same object is the active controller.
    const waitingCandidate = waiting ? { postMessage: deliver, state: 'installed' } : null;

    const serviceWorker = {
      controller: startsControlled ? controller : null,
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      removeEventListener() {},
      async register() {
        return { waiting: waitingCandidate, active: null, scope: '/', addEventListener() {} };
      },
      async getRegistration() { return null; },
      ready: new Promise(() => {}),
    };

    function makeElement(tag) {
      const buttons = new Map();
      const element = {
        tag,
        id: '',
        className: '',
        hidden: true,
        innerHTML: '',
        classList: { add() {}, remove() {}, contains: () => false },
        parentElement: null,
        setAttribute() {},
        remove() {},
        appendChild(child) { if (child) child.parentElement = element; return child; },
        querySelectorAll: () => [],
        querySelector(selector) {
          if (!buttons.has(selector)) {
            buttons.set(selector, {
              addEventListener(type, handler) {
                if (type === 'click') state.clicks.set(selector, handler);
              },
            });
          }
          return buttons.get(selector);
        },
      };
      state.created.push(element);
      return element;
    }

    const documentRef = {
      visibilityState: visibility,
      documentElement: {},
      body: { appendChild(node) { if (node) node.parentElement = documentRef.body; return node; } },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: tag => makeElement(tag),
      addEventListener() {},
      dispatchEvent: () => true,
    };
    const windowRef = {
      addEventListener(type, handler) {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(handler);
      },
      requestAnimationFrame(fn) { fn(); },
    };
    globalThis.requestAnimationFrame ??= (fn) => fn();
    const locationRef = {
      protocol: 'https:',
      hostname: 'example.test',
      reload() { state.reloads += 1; },
    };
    return { listeners, windowListeners, state, serviceWorker, documentRef, windowRef, locationRef };
  }

  function init(h) {
    initServiceWorkerUpdates({
      windowRef: h.windowRef,
      navigatorRef: { serviceWorker: h.serviceWorker },
      documentRef: h.documentRef,
      locationRef: h.locationRef,
    });
  }

  // The page finishing loading is what registers the worker and, if one was
  // already waiting, what puts up the prompt and remembers which worker it is.
  async function fireLoad(h) {
    for (const handler of h.windowListeners.get('load') || []) handler();
    // Let the registration promise chain settle.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  function fireControllerChange(h) {
    const handlers = h.listeners.get('controllerchange') || [];
    assert.equal(handlers.length, 1, 'one controllerchange handler must be registered');
    handlers[0]();
  }

  function fire(h) {
    init(h);
    fireControllerChange(h);
  }

  // The prompt element is the one the update banner is built from: an id, and a
  // Reload button wired to a click handler.
  const promptElement = h => h.state.created.find(element => element.id === 'hm-update-prompt');

  // A tab that was already under a worker and did not click: it must not be
  // yanked out from under whoever is reading it, but it must be told. Asserting
  // only that it did not reload proves nothing, because the handler before this
  // change did not reload either.
  const visible = harness({ startsControlled: true, visibility: 'visible' });
  fire(visible);
  assert.equal(visible.state.reloads, 0, 'a visible tab must not reload itself when another tab takes the update');
  assert(promptElement(visible), 'the update prompt must have been built');
  assert.equal(
    promptElement(visible).hidden,
    false,
    'a visible tab must be shown the prompt when another tab takes the update, or it silently runs two versions of the app',
  );

  const reload = visible.state.clicks.get('.hm-update-reload');
  assert(typeof reload === 'function', 'the prompt must wire a Reload click handler');
  reload();
  assert.equal(
    visible.state.reloads,
    1,
    'clicking Reload in a tab that did not take the update must actually reload it',
  );

  // And the prompt has to do something in the case that actually happens. A
  // tab that loaded while a worker was already waiting remembers that worker,
  // and after another tab accepts, that same object is the active controller.
  // Reload then posted SKIP_WAITING to an already active worker, which does
  // nothing, and waited for a second controllerchange that had already
  // happened. The reader clicked Reload and the page sat there.
  const other = harness({ startsControlled: true, visibility: 'visible', waiting: true });
  init(other);
  await fireLoad(other);
  assert(
    promptElement(other) && promptElement(other).hidden === false,
    'a tab that loads with a worker already waiting must be shown the prompt',
  );
  fireControllerChange(other);
  const otherReload = other.state.clicks.get('.hm-update-reload');
  assert(typeof otherReload === 'function', 'the prompt must wire a Reload click handler');
  otherReload();
  assert.equal(
    other.state.reloads,
    1,
    'Reload must reload the tab even when it was holding a worker that has since become the controller',
  );
  assert.deepEqual(
    other.state.posted.filter(message => message?.type === 'SKIP_WAITING'),
    [],
    'nothing should be asked to skip waiting once it is already the controller',
  );

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

console.log(
  'service worker activate ok (clients claimed through a failing validator, a failing cleanup and a held '
  + 'release lock; every failure reported; the other tabs get a prompt whose Reload button works)',
);
