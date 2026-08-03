# Live GOES Satellite Background

HurricaneMap can show an opt-in live satellite backdrop when NHC reports active storms.

## Source

The browser overlay uses NOAA/NESDIS/STAR current GOES sector JPEGs:

- GOES-East Tropical Atlantic: `GOES19/ABI/SECTOR/taw/GEOCOLOR/900x540.jpg`
- GOES-East Eastern East Pacific: `GOES19/ABI/SECTOR/eep/GEOCOLOR/900x540.jpg`
- GOES-West Tropical Pacific: `GOES18/ABI/SECTOR/tpw/GEOCOLOR/900x540.jpg`

NOAA STAR describes the GeoColor product as true-color daytime imagery and multispectral IR at night. The sector page states that images update every 10 minutes, so HurricaneMap cache-busts on the same cadence instead of forcing a network request on every render.

## Behavior

- The layer is disabled by default and lives in Display settings under Guidance.
- It renders only while active storms exist and the setting is on.
- Atlantic/AT basin storms select Tropical Atlantic. Eastern Pacific storms select Eastern East Pacific. Central Pacific storms select Tropical Pacific.
- If basin metadata is unavailable, the latest storm coordinate chooses the most likely sector.
- The satellite pane is placed above the basemap and below NHC tracks, cones, markers, population, surge, and radar layers.

## Static-app tradeoff

Raw GOES ABI files in public cloud storage are science rasters, not browser-ready map tiles. They require projection, product composition, and usually server-side raster processing before Leaflet can display them accurately. For the static GitHub Pages app, the NOAA STAR current sector JPEGs are the practical real-time path: current, official, low-bandwidth, and source-attributed.

Sector bounds are approximate wide-sector placement bounds. The overlay is intended as situational satellite context behind official NHC advisory geometry, not as a pixel-accurate georeferenced science product.
