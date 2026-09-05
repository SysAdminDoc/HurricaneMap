// One owner for a map overlay's lifetime: the Leaflet layer, the request that
// fills it, and the optional-feed state that describes it.
//
// Twenty modules used to manage those three things separately, each with its
// own null checks and its own generation counter, and the fix history is full
// of what that costs: overlays surviving a panel close, playback and globe work
// continuing after the user moved on, a stale response repainting a layer the
// user had already switched away from. Only four modules ever constructed an
// AbortController, so "cancelled" almost always meant "the result was ignored
// once it finally arrived" rather than "the request stopped".
//
// Registering under an id supersedes whatever held that id before, so the
// common case, a user toggling a layer twice, cancels the first attempt instead
// of racing it.
import { idleOptionalFeed, OPTIONAL_FEED_DEFINITIONS } from './optional-feeds.js';

const entries = new Map();

function detach(entry) {
  if (!entry.layer) return;
  try {
    entry.map.removeLayer(entry.layer);
  } catch (error) {
    // Keep tearing the rest down, but say so. Leaflet throws here when a layer
    // belongs to a different map, and the symptom of swallowing that is an
    // overlay stuck on screen: the exact bug this registry exists to prevent.
    console.warn(`layer-registry: could not remove the "${entry.id}" layer`, error);
  }
}

/**
 * Claim `id` for a map overlay.
 *
 * @param {string} id            registry key; re-registering supersedes.
 * @param {object} options
 * @param {object} options.map   Leaflet map (or anything with removeLayer).
 * @param {string} options.feedId optional-feed id reported idle on disposal.
 *                                Opt in by naming one; most overlays are not
 *                                feeds, and defaulting to the layer id made
 *                                disposal throw on every id that was not.
 * @returns {{id: string, signal: AbortSignal, disposed: boolean,
 *            attach: (layer: any) => any, dispose: () => void}}
 */
export function registerMapLayer(id, { map = null, feedId = null } = {}) {
  if (!id) throw new TypeError('a map layer registration needs an id');
  // Without a map there is nothing to remove the layer from, so disposal would
  // report success and leave the overlay on screen. Fail at the call site.
  if (!map || typeof map.removeLayer !== 'function') {
    throw new TypeError(`registering the "${id}" layer needs a map that can remove it`);
  }
  // A bad feed id would otherwise surface as a throw inside teardown, aborting
  // whatever cleanup came after it in the caller's handler.
  if (feedId && !OPTIONAL_FEED_DEFINITIONS[feedId]) {
    throw new TypeError(`the "${id}" layer names an unknown optional feed: ${feedId}`);
  }
  disposeMapLayer(id);
  const controller = new AbortController();
  const entry = { id, map, feedId, controller, layer: null, disposed: false };
  entries.set(id, entry);
  return {
    id,
    get signal() { return controller.signal; },
    get disposed() { return entry.disposed; },
    attach(layer) {
      // A response that lands after disposal must not put a layer back on the
      // map. Returning null lets the caller bail without another guard.
      if (entry.disposed) return null;
      entry.layer = layer;
      if (layer && typeof layer.addTo === 'function') layer.addTo(map);
      return layer;
    },
    dispose() { disposeMapLayer(id); },
  };
}

/** Remove the layer, abort its request, and report the feed idle. */
export function disposeMapLayer(id) {
  const entry = entries.get(id);
  if (!entry) return false;
  entries.delete(id);
  entry.disposed = true;
  detach(entry);
  entry.controller.abort();
  if (entry.feedId) idleOptionalFeed(entry.feedId);
  return true;
}

export function isMapLayerActive(id) {
  return entries.has(id);
}
