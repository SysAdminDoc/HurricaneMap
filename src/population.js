// Population density overlay (SEDAC GPW v4 — Gridded Population of the World)
// served as a pre-rendered Esri tile cache at 1 km resolution. Toggle layered
// just below the landfall dots so you can see how many people live where the
// storms hit.

import { getMap } from './map.js';

const TILE_URL = 'https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/GPW_PopulationDensity2015_1km/MapServer/tile/{z}/{y}/{x}';

let layer = null;

export function setPopulation(enabled) {
  const map = getMap();
  if (!enabled) {
    if (layer) {
      map.removeLayer(layer);
      layer = null;
    }
    return;
  }
  if (!layer) {
    layer = L.tileLayer(TILE_URL, {
      maxZoom: 11,
      opacity: 0.55,
      attribution: 'Population: <a href="https://sedac.ciesin.columbia.edu/data/collection/gpw-v4" target="_blank" rel="noopener">SEDAC GPWv4</a>',
    });
  }
  layer.addTo(map);
}
