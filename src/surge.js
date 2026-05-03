// SLOSH MOM storm surge inundation layer.
//
// Source: NOAA NHC's SLOSH "Maximum of Maximums" hazard maps, served as
// pre-rendered ArcGIS tiles (no heavy GeoTIFF download required). Each
// category-specific layer represents the near-worst-case inundation depth
// envelope at high tide for hurricanes of that Saffir-Simpson category,
// hypothetically tracking through every grid cell at every direction +
// forward speed.
//
// Tile pattern:
//   https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/
//     Storm_Surge_HazardMaps_Category{1..5}_v3/MapServer/tile/{z}/{y}/{x}

import { getMap } from './map.js';

const TILE_BASE = 'https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services';

const layers = {};   // category number -> L.tileLayer
let activeCategory = null;

/** Toggle the SLOSH MOM tile layer for the requested category (1..5).
 *  Pass null/0 to clear. */
export function setSurgeCategory(cat) {
  const map = getMap();
  // Tear down whatever is currently up.
  if (activeCategory && layers[activeCategory]) {
    map.removeLayer(layers[activeCategory]);
  }
  activeCategory = null;
  if (!cat || cat < 1 || cat > 5) return;
  if (!layers[cat]) {
    const url = `${TILE_BASE}/Storm_Surge_HazardMaps_Category${cat}_v3/MapServer/tile/{z}/{y}/{x}`;
    layers[cat] = L.tileLayer(url, {
      maxZoom: 12,
      opacity: 0.78,
      attribution: 'Surge: <a href="https://www.nhc.noaa.gov/nationalsurge/" target="_blank" rel="noopener">NOAA NHC SLOSH MOM v3</a>',
      pane: 'overlayPane',
    });
  }
  layers[cat].addTo(map);
  activeCategory = cat;
}

export function getActiveCategory() { return activeCategory; }
