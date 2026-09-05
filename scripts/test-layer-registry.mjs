import assert from 'node:assert/strict';

import {
  disposeMapLayer,
  isMapLayerActive,
  registerMapLayer,
} from '../src/layer-registry.js';
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

console.log('layer registry ok (attach, dispose, feed idle, real abort, late-response refusal, supersede)');
