// SLOSH MOM storm surge inundation layer.
//
// Source: NOAA NHC's SLOSH "Maximum of Maximums" hazard maps, served as
// pre-rendered ArcGIS tiles (no heavy GeoTIFF download required). Each
// category-specific layer represents the near-worst-case inundation depth
// envelope at high tide for hurricanes of that Saffir-Simpson category,
// hypothetically tracking through every grid cell at every direction +
// forward speed.
//
// Coverage is composited from three services per category (verified against
// the NHC ArcGIS org 2026-07-09 — no v4 tile services exist yet; v3 is the
// current tile product):
//   Storm_Surge_HazardMaps_Category{1..5}_v3   — CONUS Gulf/East Coast
//   data4_Hawaii_SLOSH_MOMs_cat{1..4}          — main Hawaiian Islands
//   data5_PR_USVI_SLOSH_MOMs_cat{1..5}         — Puerto Rico + USVI
// Regional layers carry bounds so Leaflet never requests tiles outside each
// sparse cache's extent (those requests 404).

import { getMap } from './map.js';

const TILE_BASE = 'https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services';

const REGIONS = [
  {
    service: cat => `Storm_Surge_HazardMaps_Category${cat}_v3`,
    maxCat: 5,
    bounds: null, // primary CONUS product — let Leaflet request freely
  },
  {
    service: cat => `data4_Hawaii_SLOSH_MOMs_cat${cat}`,
    maxCat: 4, // no cat-5 service published for Hawaii
    bounds: [[18.91, -159.88], [22.28, -154.79]],
  },
  {
    service: cat => `data5_PR_USVI_SLOSH_MOMs_cat${cat}`,
    maxCat: 5,
    bounds: [[17.62, -67.33], [18.57, -64.51]],
  },
];

const groups = {};   // category number -> L.layerGroup
let activeCategory = null;

/** Toggle the SLOSH MOM tile layers for the requested category (1..5).
 *  Pass null/0 to clear. */
export function setSurgeCategory(cat) {
  const map = getMap();
  // Tear down whatever is currently up.
  if (activeCategory && groups[activeCategory]) {
    map.removeLayer(groups[activeCategory]);
  }
  activeCategory = null;
  if (!cat || cat < 1 || cat > 5) return;
  if (!groups[cat]) {
    const group = L.layerGroup();
    for (const region of REGIONS) {
      if (cat > region.maxCat) continue;
      const options = {
        maxZoom: 12,
        opacity: 0.78,
        attribution: 'Surge: <a href="https://www.nhc.noaa.gov/nationalsurge/" target="_blank" rel="noopener">NOAA NHC SLOSH MOM v3</a>',
        pane: 'overlayPane',
      };
      if (region.bounds) options.bounds = region.bounds;
      group.addLayer(L.tileLayer(`${TILE_BASE}/${region.service(cat)}/MapServer/tile/{z}/{y}/{x}`, options));
    }
    groups[cat] = group;
  }
  groups[cat].addTo(map);
  activeCategory = cat;
}

export function getActiveCategory() { return activeCategory; }
