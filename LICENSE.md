# Licensing & Attribution

## HurricaneMap Software

**License:** MIT
**Copyright:** 2026 SysAdminDoc

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Data Sources & Attribution

### HURDAT2 Best-Track Database

**Source:** National Hurricane Center (NHC), National Oceanic and Atmospheric Administration (NOAA)
**URL:** https://www.nhc.noaa.gov/data/hurdat/
**License:** Public Domain (U.S. Government Work)
**Citation:** Landsea, C. W., and J. L. Franklin, 2013: The Atlantic Hurricane Database Re-analysis Project: Documentation for the 1851–2012 Alterations and Addition to the HURDAT2 Database. National Hurricane Center, 73 pp.
**Data Coverage:** Atlantic basin (1851–2025), Eastern Pacific basin (1949–2025)
**Last Update:** February 2026 (covers 2025 season)

HurricaneMap plots every recorded U.S. hurricane and tropical-storm landfall from the HURDAT2 database. This is the authoritative best-track archive maintained by the National Hurricane Center and is used by NOAA for all official post-season analyses.

**Use & Attribution:** When using HurricaneMap data in publications, reports, or presentations, please acknowledge NOAA/NHC as the original data source:

> Historical hurricane landfall data sourced from NOAA's National Hurricane Center HURDAT2 database (https://www.nhc.noaa.gov/data/hurdat/).

### SLOSH Maximum-of-Maximums (MOM) Storm Surge Zones

**Source:** National Hurricane Center (NOAA)
**URL:** https://www.nhc.noaa.gov/surge/slosh.php
**License:** Public Domain (U.S. Government Work)
**Data:** Pre-rendered ArcGIS REST tiles (NHC SLOSH model outputs)
**Availability:** Optional overlay in HurricaneMap

The SLOSH (Sea, Lake, and Overland Surges from Hurricanes) model is NOAA's operational storm-surge forecast tool. The Maximum-of-Maximums maps represent the worst-case envelope of storm surge for each Saffir-Simpson category, computed from thousands of synthetic hurricane scenarios.

### NEXRAD Archived Radar

**Source:** Iowa Environmental Mesonet (IEM), University of Iowa
**URL:** https://mesonet.agron.iastate.edu/
**License:** Public Domain
**Data:** Level 2 / 3 composite radar reflectivity
**Availability:** Fallback data source for storms 1995–present when full-archive NEXRAD is unavailable

IEM mirrors and archives NEXRAD reflectivity mosaics from the NWS Radar Data Center. HurricaneMap's offline NEXRAD archive is precomputed from IEM's historical tiles.

### Population Density

**Source:** Socioeconomic Data and Applications Center (SEDAC), Columbia University
**URL:** https://sedac.ciesin.columbia.edu/
**Dataset:** Gridded Population of the World, v4 (GPWv4)
**License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
**Resolution:** 1 km grid cells (circa 2020)
**Availability:** Optional overlay in HurricaneMap

**Attribution:** When displaying the SEDAC population-density layer, the following acknowledgment is required:

> Population density data from the Gridded Population of the World v4 (GPWv4), Socioeconomic Data and Applications Center (SEDAC), Columbia University.

### Storm Impacts Data

- **Source:** Wikipedia (community-edited)
- **Entries Covered:** 244 storms (raw deaths/damage text plus normalized fatality and nominal-USD fields)
- **License:** Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)
- **Availability:** Displayed in the "Impacts" section of storm detail panels

HurricaneMap uses crowd-sourced impacts data from Wikipedia hurricane articles. This data is maintained by the Wikipedia community and may be incomplete or subject to revision. Normalized numeric impact fields are best-effort values derived from the raw infobox text; the original source strings remain preserved in `data/impacts.json`.

**Accuracy Note:** Wikipedia impacts figures vary in methodology (e.g., direct vs. total deaths, USD inflation year). Figures are presented as-is for reference; for rigorous analysis, consult peer-reviewed sources or original government reports (NOAA, National Weather Service, insurance agencies).

### Remote Imagery & Quicklinks

The following external services are linked (not embedded) in HurricaneMap for reference:

- **GOES Satellite (RAMMB SLIDER):** https://rammb-slider.cira.colostate.edu/ — NOAA real-time satellite imagery
- **NOAA Tropical Cyclone Reports:** https://www.nhc.noaa.gov/data/tcr/ — Post-season official analyses
- **NHC Storm Wallets:** https://www.nhc.noaa.gov/archive/ — Historical advisory archives
- **Wikipedia:** https://en.wikipedia.org/ — Encyclopedia articles (CC BY-SA 3.0)
- **YouTube:** https://www.youtube.com/ — Storm footage (user-generated and news)
- **Tropical Tidbits:** https://www.tropicaltidbits.com/ — Spaghetti-model ensemble visualizations
- **Track The Tropics:** https://trackthetropics.com/ — Community-maintained tracking

---

## Basemap & Map Tiles

**Primary Basemap:** OpenStreetMap (via Leaflet)
**License:** Open Data Commons Open Database License (ODbL)
**Attribution:** © OpenStreetMap contributors
**URL:** https://www.openstreetmap.org/

**Maps Library:** Leaflet
**License:** BSD 2-Clause License
**URL:** https://leafletjs.com/

---

## Dependencies & Open Source

HurricaneMap's software dependencies are listed in `package.json` and resolved in `package-lock.json`. Direct build/test tooling includes MIT, Apache-2.0, and MPL-2.0 software; MPL-2.0 applies to `@axe-core/playwright` and `axe-core`. Vendored Inter and JetBrains Mono font subsets use the SIL Open Font License 1.1. Exact versions, sources, font hashes, and notices are recorded in `THIRD_PARTY_NOTICES.txt` and enforced by `npm run check:licenses`.

---

## Data Accuracy & Disclaimers

- **HURDAT2 Completeness:** HURDAT2 coverage is complete only from ~1900 onward. Pre-1851 storms exist but are sparse; pre-1900 data is incomplete.
- **Landfall Detection:** Landfalls are marked in HURDAT2 with an `L` flag when the center crossed the coastline. HurricaneMap also infers landfalls for storms whose 6-hourly track grazes U.S. land between synoptic observation times.
- **Pre-Satellite Era:** Observations before ~1945 (pre-aircraft) and before ~1960 (pre-satellite) are based on ship reports, coastal weather stations, and historical accounts; accuracy is lower.
- **Track Uncertainty:** Historical track positions, especially pre-1900, carry substantial uncertainty (±100+ km). Modern satellite-era tracks (post-1960) are generally accurate to ±10–20 km.
- **Wind Speeds:** Saffir-Simpson categories are computed from maximum sustained wind speeds. Category assignments may differ slightly depending on methodology (e.g., 1-minute vs. 10-minute average winds).

---

## How to Cite HurricaneMap

For academic papers and reports:

> SysAdminDoc (2026). HurricaneMap: Interactive Hurricane Landfall Database. GitHub repository. https://github.com/SysAdminDoc/HurricaneMap. Accessed [DATE]. Data sourced from NOAA's National Hurricane Center HURDAT2 database.

Or, in BibTeX:

```bibtex
@misc{HurricaneMap2026,
  author = {SysAdminDoc},
  title = {HurricaneMap: Interactive Hurricane Landfall Database},
  year = {2026},
  howpublished = {\url{https://github.com/SysAdminDoc/HurricaneMap}},
  note = {Accessed [DATE]}
}
```

---

## Questions & Corrections

- **Data errors (HURDAT2 track, impacts):** Report to NOAA NHC (https://www.nhc.noaa.gov/) or the original data source.
- **Software bugs / feature requests:** Open an issue on GitHub (https://github.com/SysAdminDoc/HurricaneMap/issues).
- **Attribution concerns:** Contact the repository maintainer.

---

**Last Updated:** 2026-07-29
