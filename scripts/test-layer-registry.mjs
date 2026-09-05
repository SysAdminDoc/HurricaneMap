import assert from 'node:assert/strict';

import {
  disposeMapLayer,
  isMapLayerActive,
  registerMapLayer,
} from '../src/layer-registry.js';
import { fetchWithTimeout } from '../src/network.js';
import { beginOptionalFeed, getOptionalFeedState } from '../src/optional-feeds.js';

function fakeMap() {
  const added = [];
  const removed = [];
  const map = {
    added,
    removed,
    removeLayer(layer) { removed.push(layer); },
  };
  return map;
}
function fakeLayer(name) {
  const layer = { name, addTo(map) { map.added.push(layer); return layer; } };
  return layer;
}

// Attaching puts the layer on the map; disposal takes it off again.
const map = fakeMap();
const handle = registerMapLayer('population', { map });
const layer = handle.attach(fakeLayer('tiles'));
assert.deepEqual(map.added, [layer], 'attach must add the layer to the map');
assert.equal(isMapLayerActive('population'), true);
handle.dispose();
assert.deepEqual(map.removed, [layer], 'dispose must remove the layer from the map');
assert.equal(isMapLayerActive('population'), false);
assert.equal(handle.disposed, true);

// Disposal reports the feed idle, so a layer cannot be torn down while its
// status still claims to be loading.
beginOptionalFeed('population');
assert.equal(getOptionalFeedState('population').state, 'loading');
const feedHandle = registerMapLayer('population', { map: fakeMap(), feedId: 'population' });
feedHandle.dispose();
assert.equal(getOptionalFeedState('population').state, 'idle', 'disposal must report the feed idle');

// The point of the registry: a request issued before teardown is ABORTED, not
// merely ignored once it finally arrives. This is what the per-module
// generation counters could not do.
const aborting = registerMapLayer('marine', { map: fakeMap() });
let settled = null;
const inFlight = new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve('served stale data'), 60_000);
  aborting.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  }, { once: true });
}).then(value => { settled = { value }; }, error => { settled = { error }; });
assert.equal(aborting.signal.aborted, false, 'a live registration must not start aborted');
aborting.dispose();
await inFlight;
assert.equal(aborting.signal.aborted, true);
assert.equal(settled.error?.name, 'AbortError', 'the in-flight request must reject, not resolve later');
assert.equal(settled.value, undefined);

// A response that lands after disposal must not put a layer back on the map.
const lateMap = fakeMap();
const late = registerMapLayer('sst', { map: lateMap });
late.dispose();
assert.equal(late.attach(fakeLayer('late tiles')), null, 'attach after disposal must refuse');
assert.deepEqual(lateMap.added, [], 'a late response must not re-add a layer');

// Re-registering the same id supersedes the previous holder, which is what a
// user toggling a layer twice does.
const toggleMap = fakeMap();
const first = registerMapLayer('radar', { map: toggleMap });
const firstLayer = first.attach(fakeLayer('first'));
const second = registerMapLayer('radar', { map: toggleMap });
assert.equal(first.signal.aborted, true, 're-registering must abort the superseded request');
assert.deepEqual(toggleMap.removed, [firstLayer], 're-registering must remove the superseded layer');
assert.equal(second.signal.aborted, false);
assert.equal(isMapLayerActive('radar'), true, 'the superseding registration keeps the id');
second.dispose();
assert.equal(isMapLayerActive('radar'), false);
assert.equal(disposeMapLayer('nothing-registered'), false, 'disposing an unknown id must be a no-op');

// A superseded handle must not tear down the registration that replaced it.
// hwm.js disposes its handle on every path that draws nothing, and an await
// slipped in ahead of that would otherwise take out the next storm's marks.
const staleMap = fakeMap();
const superseded = registerMapLayer('hwm-marks', { map: staleMap });
const successor = registerMapLayer('hwm-marks', { map: staleMap });
const successorLayer = successor.attach(fakeLayer('successor marks'));
assert.equal(superseded.dispose(), false, 'a superseded handle must not dispose the live registration');
assert.equal(successor.disposed, false, 'the live handle must survive a stale dispose');
assert.equal(isMapLayerActive('hwm-marks'), true);
assert.ok(!staleMap.removed.includes(successorLayer), 'the successor layer must stay on the map');
assert.equal(successor.dispose(), true, 'the holder can still dispose it');
assert.equal(isMapLayerActive('hwm-marks'), false);

// Registering without a map used to be accepted: attach recorded the layer,
// disposal removed nothing, and the caller was told it worked. An overlay left
// on screen is the failure this registry exists to prevent, so it fails here
// instead, at the call site that has the bug.
assert.throws(() => registerMapLayer('no-map', {}), /needs a map that can remove it/);
assert.throws(() => registerMapLayer('no-map', { map: {} }), /needs a map that can remove it/);
assert.equal(isMapLayerActive('no-map'), false, 'a rejected registration must not claim the id');

// A feed id has to be a real feed. Defaulting it to the layer id made disposal
// throw `Unknown optional feed` for every overlay that is not one, inside a
// teardown handler, aborting the cleanup that came after it.
assert.throws(
  () => registerMapLayer('hwm-marks', { map: fakeMap(), feedId: 'hwm-marks' }),
  /unknown optional feed: hwm-marks/,
);
const notAFeed = registerMapLayer('hwm-marks', { map: fakeMap() });
assert.doesNotThrow(() => notAFeed.dispose(), 'an overlay with no feed must tear down silently');

// Removal can fail for real: Leaflet throws when a layer belongs to another
// map. Teardown still has to finish, and the failure still has to be visible.
const hostileMap = { removeLayer() { throw new Error('layer is not on this map'); } };
const warnings = [];
const realWarn = console.warn;
console.warn = (...args) => warnings.push(args[0]);
try {
  const hostile = registerMapLayer('hostile', { map: hostileMap });
  hostile.attach({ addTo() {} });
  hostile.dispose();
  assert.equal(hostile.signal.aborted, true, 'a failed removal must not stop the abort');
  assert.equal(isMapLayerActive('hostile'), false, 'a failed removal must still release the id');
} finally {
  console.warn = realWarn;
}
assert.equal(warnings.length, 1, 'a failed removal must be reported, not swallowed');
assert.match(warnings[0], /could not remove the "hostile" layer/);

// End to end through the real network boundary: a request issued before a panel
// close rejects, rather than being ignored once it arrives.
const closing = registerMapLayer('sst', { map: fakeMap(), feedId: 'sst' });
let fetchSignal = null;
const pending = fetchWithTimeout('https://example.invalid/sst.json', { signal: closing.signal }, 12_000,
  (input, init) => new Promise((resolve, reject) => {
    fetchSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
      name: 'AbortError',
      cause: init.signal.reason,
    })), { once: true });
  }));
assert.equal(fetchSignal.aborted, false, 'the request must start live');
closing.dispose();
await assert.rejects(pending, /aborted/, 'closing the panel must abort the request it issued');
assert.equal(getOptionalFeedState('sst').state, 'idle', 'and leave the feed idle rather than loading');

console.log(
  'layer registry ok (attach, dispose, feed idle, real abort through fetchWithTimeout, '
  + 'late-response refusal, supersede, map and feed-id guards, visible removal failure)',
);
