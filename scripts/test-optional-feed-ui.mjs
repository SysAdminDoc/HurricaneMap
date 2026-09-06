// The optional-feed status host: one mount per feed, and the previous mount
// released when a caller rebuilds its host.
//
// Radar, the FEMA context block, the tides block and the spatial-search wind
// context all replace their host's innerHTML immediately before mounting, so a
// cleanup registry keyed by element never matched the element it was supposed
// to release. Every re-render added another pair of document listeners, each
// still rendering into a node that had already been thrown away, and they
// accumulated for the life of the tab.
import assert from 'node:assert/strict';

const documentListeners = new Map();
globalThis.document = {
  documentElement: { lang: 'en' },
  addEventListener(type, handler) {
    if (!documentListeners.has(type)) documentListeners.set(type, new Set());
    documentListeners.get(type).add(handler);
  },
  removeEventListener(type, handler) {
    documentListeners.get(type)?.delete(handler);
  },
  dispatchEvent() { return true; },
};

const { mountOptionalFeedStatus } = await import('../src/optional-feed-ui.js');
const { beginOptionalFeed, failOptionalFeed, getOptionalFeedState } = await import('../src/optional-feeds.js');

function fakeHost() {
  const listeners = new Map();
  return {
    dataset: {},
    attributes: {},
    hidden: false,
    innerHTML: '',
    listeners,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    querySelector() { return null; },
  };
}

const countFor = type => documentListeners.get(type)?.size || 0;
const listenerPairs = () => ({
  feed: countFor('hm-optional-feed:change'),
  locale: countFor('hm-locale:change'),
});

assert.deepEqual(listenerPairs(), { feed: 0, locale: 0 }, 'nothing should be listening before the first mount');

// Ten renders of the same feed on ten fresh hosts: what opening ten storms in
// a row does to the tides block.
let lastHost = null;
for (let render = 0; render < 10; render++) {
  lastHost = fakeHost();
  mountOptionalFeedStatus(lastHost, 'tides', { onRetry: () => {} });
}
assert.deepEqual(
  listenerPairs(),
  { feed: 1, locale: 1 },
  'ten renders of one feed must leave one listener pair, not ten',
);

// A second feed keeps its own pair: the registry is per feed, not global.
const radarHost = fakeHost();
const releaseRadar = mountOptionalFeedStatus(radarHost, 'radar', { onRetry: () => {} });
assert.deepEqual(listenerPairs(), { feed: 2, locale: 2 }, 'a second feed must mount its own listeners');

// Releasing one feed leaves the other mounted.
releaseRadar();
assert.deepEqual(listenerPairs(), { feed: 1, locale: 1 }, 'releasing one feed must not release the others');

// A stale cleanup, held by a caller that has since been re-rendered, must not
// tear down the mount that replaced it.
const staleRelease = mountOptionalFeedStatus(fakeHost(), 'tides', { onRetry: () => {} });
const currentHost = fakeHost();
mountOptionalFeedStatus(currentHost, 'tides', { onRetry: () => {} });
staleRelease();
assert.deepEqual(listenerPairs(), { feed: 1, locale: 1 }, 'a stale cleanup must not unmount the current listener');
currentHost.innerHTML = '';
beginOptionalFeed('tides');
failOptionalFeed('tides', { responseStatus: 503 });
for (const handler of documentListeners.get('hm-optional-feed:change')) {
  handler({ detail: { id: 'tides' } });
}
assert.match(
  currentHost.innerHTML,
  /optional-feed-status-head/,
  'the surviving listener must render into the current host, not a discarded one',
);
assert.equal(getOptionalFeedState('tides').state, 'error');

console.log('optional feed status host ok (one listener pair per feed across re-renders, independent feeds, stale cleanup ignored)');
