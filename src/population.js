// Population density overlay (SEDAC GPW v4 — Gridded Population of the World)
// served as a pre-rendered Esri tile cache at 1 km resolution. Toggle layered
// just below the landfall dots so you can see how many people live where the
// storms hit.

import { getMap } from './map.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
} from './optional-feeds.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';
import { disposeMapLayer, registerMapLayer } from './layer-registry.js';

const TILE_URL = 'https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/GPW_PopulationDensity2015_1km/MapServer/tile/{z}/{y}/{x}';

let layer = null;
let requestId = null;

function ensureStatus() {
  const host = document.getElementById('population-feed-status');
  if (!host) return;
  mountOptionalFeedStatus(host, 'population', { onRetry: () => setPopulation(true) });
}

export function setPopulation(enabled) {
  if (!enabled) {
    // The registry removes the layer and reports the feed idle; the tile layer
    // object survives so a re-enable reuses its warm tile cache.
    disposeMapLayer('population');
    return;
  }
  const map = getMap();
  const handle = registerMapLayer('population', { map, feedId: 'population' });
  const request = beginOptionalFeed('population', { cacheOrigin: layer ? 'memory' : 'network' });
  requestId = request.requestId;
  ensureStatus();
  if (!layer) {
    layer = L.tileLayer(TILE_URL, {
      maxZoom: 11,
      opacity: 0.55,
      attribution: 'Population: <a href="https://sedac.ciesin.columbia.edu/data/collection/gpw-v4" target="_blank" rel="noopener">SEDAC GPWv4</a>',
    });
    layer.on('load', () => completeOptionalFeed('population', {
      itemCount: null,
      cacheOrigin: 'network',
      requestId,
    }));
    layer.on('tileerror', event => failOptionalFeed('population', {
      error: event?.error || new Error('Population tile failed'),
      cacheOrigin: 'network',
      requestId,
    }));
  }
  handle.attach(layer);
  if (layer._loaded) completeOptionalFeed('population', { cacheOrigin: 'memory', requestId });
}
