# HurricaneMap

[![Live demo](https://img.shields.io/badge/live%20demo-sysadmindoc.github.io%2FHurricaneMap-cba6f7.svg)](https://sysadmindoc.github.io/HurricaneMap/)
[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/SysAdminDoc/HurricaneMap/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-web-lightgrey.svg)](#)
[![Data](https://img.shields.io/badge/data-NOAA%20HURDAT2-orange.svg)](https://www.nhc.noaa.gov/data/)

> **174 years of U.S. hurricane landfalls**, every dot drawn directly from NOAA's HURDAT2 best-track database (1851–2025).
>
> **Live demo:** https://sysadmindoc.github.io/HurricaneMap/

<img width="2402" height="1118" alt="2026-05-03 12_30_10-Greenshot" src="https://github.com/user-attachments/assets/846e6a97-5494-4165-a9ab-b59f5555f4be" />


## What this is

A static, interactive web map that plots **every recorded hurricane and tropical-storm landfall on U.S. soil**, drawn straight from the National Hurricane Center's HURDAT2 best-track database — the same source the NHC uses for its post-season analyses.

Click any dot and you get the storm's full track, its peak intensity, every U.S. landfall it made (chronological), and one-click jumps to the Wikipedia article, YouTube footage search, NOAA Tropical Cyclone Report, and the NHC storm wallet.

## Highlights

- **596 storms · 760 landfall events · 374 hurricane-strength landfalls** spanning 1851–2025.
- Both **Atlantic** and **Eastern North Pacific** HURDAT2 basins ingested (so storms like Iniki '92 on Kauai are included).
- **Inferred-landfall detection** for storms whose 6-hourly track grazes U.S. land between synoptic times — fixes Iniki and similar Pacific landfalls that don't carry an explicit `L` marker in HURDAT2.
- **Hotspot / cold-spot analysis**: ranks every coastal state, lists ones that have never recorded a hurricane-strength landfall (Delaware, Maryland, Virginia, New Hampshire, Pennsylvania, DC).
- **Multi-state tracking** for storms like Andrew (FL → FL → LA), Charley (FL → FL → SC → SC), Hugo (PR → PR → SC), Katrina (FL → LA → LA).
- Per-segment **intensity-coloured tracks** — you can see exactly where a storm intensified, peaked, and weakened.
- **Track animation** — opt-in playback of a spinning hurricane glyph and translucent wind-field disk that travels the full path, both sized in real-time by Saffir-Simpson category at each track point. **A 📡 checkbox in the control bar binds the actual NEXRAD reflectivity to the simulated UTC clock** — as the glyph traverses Florida and the Gulf, real radar paints onto the map at exactly the right moment. Watch Andrew '92 ramp from TS to Cat 5 to Cat 4 in 14 seconds with reflectivity locked to the same timeline.
- **📡 Archived NEXRAD radar — full-storm timeline, offline-capable** — every storm from August 1995 onward ships with **every in-coverage 6-hourly track frame** baked into the repo. Click 📡 next to any landfall and the loop animates the entire U.S. passage of that storm from genesis-in-coverage to dissipation, with the map auto-panning to follow the eye. Katrina '05 plays back 22 frames over five days; Helene '24 shows the eyewall crossing the Big Bend. **No internet required after `git clone`.** Frames not in the local archive transparently fall back to live IEM URLs.
- **📈 Intensity time-series chart** — inline SVG in every storm panel showing wind (kt) + pressure (mb) over the storm's life, with category-colored dots, dashed pressure line (inverted so deeper storms read higher), Cat 1-5 reference bands, vertical landfall markers, and a hover crosshair tooltip.
- **🌀 Compare mode** — pin up to 4 storms, see their tracks color-coded on the map, side-by-side stat tables, mini intensity charts. Andrew '92 vs Katrina '05 vs Michael '18 in one view.
- **🔥 Density heatmap** — toggle a Catppuccin-tinted heat layer weighted by Saffir-Simpson category to show landfall hotspots vs cold spots.
- **🗺️ State deep-dive** — click any state polygon (or pick from the filter), get a panel with that state's full landfall history: by-category histogram, by-decade trend, top-5 worst on record, every storm sortable.
- **🌊 SLOSH MOM storm surge zones** — overlay NHC's Cat 1-5 maximum-of-maximums inundation maps along the U.S. Gulf, East Coast, Caribbean. Powered by NOAA's pre-rendered ArcGIS tiles — picking a category snaps the worst-case envelope into view.
- **🌬️ Wind-field swaths** — for storms 2004+, a checkbox in the storm panel renders the actual HURDAT2 wind-radii analysis (34/50/64 kt asymmetric quadrants per track point) as overlapping polygons along the path.
- **🛰️ ✈️ 🍝 🌪️ Quicklinks** — every storm panel links out to GOES satellite imagery (RAMMB SLIDER, 2018+), NOAA Storm Events tornado search filtered to the storm's dates + states, Hurricane Hunters recon archive (Tropical Atlantic mirror), Wikipedia, YouTube footage search, NOAA Tropical Cyclone Reports, and the NHC storm wallet.
- **⚠️ Impacts data** — deaths and damage figures pulled from Wikipedia infoboxes (46 storms covered so far; rerun `scripts/scrape_impacts.py` to fill in more).
- **🚨 Active storm tracking** — when NHC reports active storms, a pulsing badge appears at the top with cone-of-uncertainty + advisory tracks rendered on the map plus quicklinks to spaghetti-model viewers (Tropical Tidbits, Track The Tropics).
- **👥 Population density** — toggle the SEDAC GPWv4 1km gridded-population overlay to see how many people live in each storm's path / surge zone.
- Search by name OR year. Filter by year range, Saffir-Simpson category, or state.

## Quick start

The map is **already published** on GitHub Pages — open https://sysadmindoc.github.io/HurricaneMap/ and you're done.

To run locally (e.g. after refreshing the HURDAT2 data):

```bash
# Clone
git clone https://github.com/SysAdminDoc/HurricaneMap.git
cd HurricaneMap

# Refresh the underlying HURDAT2 data when NOAA publishes a new revision.
# (Already pre-built JSON lives in data/ so you can skip this step entirely.)
python scripts/preprocess_hurdat2.py

# Serve locally — `fetch()` won't work over file:// in modern browsers.
python -m http.server 8765
# open http://127.0.0.1:8765/
```

## Project layout

```
HurricaneMap/
├── index.html              # entry — map shell
├── manifest.webmanifest    # PWA manifest
├── src/
│   ├── main.js             # app boot, filters, search, UI wiring
│   ├── data.js             # JSON loaders + index helpers
│   ├── map.js              # Leaflet map, markers, tracks
│   ├── panel.js            # storm details + Wikipedia/YouTube/NOAA links
│   ├── animation.js        # spinning hurricane glyph + wind-field disk along the track
│   ├── radar.js            # NEXRAD overlay — local manifest first, IEM fallback
│   ├── stats.js            # state hotspot / decade / category breakdowns
│   └── styles.css          # Catppuccin Mocha + glassmorphism
├── data/
│   ├── hurdat2-atlantic.txt    # raw NOAA Atlantic best-track (1851–2025)
│   ├── hurdat2-nepac.txt       # raw NOAA Eastern Pacific best-track (1949–2025)
│   ├── us-states.geojson       # US state polygons (point-in-polygon attribution)
│   ├── landfalls.json          # flat list, one entry per US landfall event
│   ├── storms.json             # full track + metadata for every US-landfalling storm
│   ├── stats.json              # pre-computed stats: by state, decade, category, cold spots
│   └── radar/                  # archived NEXRAD composites (~512 MB, 1700+ frames)
│       ├── manifest.json           # storm_id → {landfalls, frames}
│       ├── Katrina-2005/           # one folder per storm
│       │   ├── t_200508241800.png
│       │   ├── t_200508250000.png
│       │   └── ...
│       └── ...
├── scripts/
│   ├── preprocess_hurdat2.py   # HURDAT2 parser + landfall attribution + stats roll-up
│   └── scrape_radar.py         # IEM NEXRAD scraper — populates data/radar/
└── examplemap.png          # design reference
```

## How landfalls are detected

HURDAT2 marks a `L` record-identifier on track points where the cyclone center crosses a coastline. We use this **as the primary signal** for every landfall.

For storms without an `L` marker — most commonly EPac/CPac storms hitting Hawaii (the marker convention is "continental U.S. only") and a handful of 1971–1990 storms (a documented HURDAT2 marking gap) — we fall back to **inferred landfall detection**:

1. For each consecutive pair of 6-hourly track points, classify each as *inside-a-state* via point-in-polygon against the U.S. Census Bureau state boundaries.
2. Whenever the track transitions from offshore → onshore while at TS+ intensity, that's a landfall.
3. If both endpoints are offshore but the great-circle segment crosses land (which happens with small islands like Kauai), sample 10 mid-segment positions and place the inferred landfall at the first one inside a state polygon. Wind/pressure interpolated linearly.
4. EPac-basin inferred landfalls are restricted to coastal Pacific states (HI, CA, OR, WA, AK) — otherwise EPac storms tracking up through Mexico produce spurious "landfalls" in landlocked Arizona / New Mexico.

Inferred landfalls are flagged with an `inferred` tag in the storm panel so you can tell them apart from official `L`-marker landfalls.

## Saffir-Simpson at landfall

| Category | Sustained wind | Color |
| -------- | -------------- | ----- |
| TS / sub-hurricane | 34–63 kt | sapphire |
| Cat 1 | 64–82 kt | green |
| Cat 2 | 83–95 kt | yellow |
| Cat 3 (major) | 96–112 kt | peach |
| Cat 4 | 113–136 kt | pink |
| Cat 5 | 137+ kt | mauve |

A storm's **headline landfall category** is the highest category recorded at *any* of its U.S. landfalls — so a storm that peaks offshore and lands as a TS shows up as TS, not as its peak intensity.

## Known data quirks

- **1971–1990 has known gaps in HURDAT2's continental-U.S. landfall marking.** Some real landfalls are missing or under-categorized; the inferred-landfall pass picks up most of them but a few are absent because the 6-hour track doesn't cross a polygon.
- **Pre-1944** (no aircraft reconnaissance) and **pre-late-1960s** (no satellite) systematically under-sample storm count and bias intensities low — see Landsea & Franklin 2013.
- **Wind radii** (34/50/64 kt) only present from 2004 onward in HURDAT2; **radius of maximum wind** only from 2021. We store/parse these but don't surface them in the UI.
- **Hawaii 1959 Hurricane Dot, 1992 Iniki** etc. are inferred landfalls because HURDAT2's `L` marker convention doesn't apply outside continental U.S. The category is interpolated from the nearest 6-hour position.

## Data sources & credits

| What | Where |
| ---- | ----- |
| Atlantic best-track (HURDAT2) | https://www.nhc.noaa.gov/data/ |
| Eastern Pacific best-track (HURDAT2) | https://www.nhc.noaa.gov/data/ |
| Format spec | [Landsea, C. W. — *Atlantic hurricane database uncertainty*, MWR 2013](https://www.aoml.noaa.gov/hrd/Landsea/landsea-franklin-mwr2013.pdf) |
| Archived radar (NEXRAD composites) | [Iowa State IEM NEXRAD mosaic archive](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/) — fetched live (CORS-enabled), no preprocessing |
| State boundaries | [PublicaMundi MappingAPI](https://github.com/PublicaMundi/MappingAPI) (US Census Bureau TIGER) |
| Map tiles | [CartoDB Dark Matter](https://carto.com/) over OpenStreetMap |
| Map library | [Leaflet 1.9](https://leafletjs.com/) |

## Refreshing the radar archive

Radar PNGs in `data/radar/` come from the [Iowa State IEM NEXRAD archive](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/). They're committed to the repo so the tool works offline, but you can re-scrape them at any time:

```bash
# Default — every covered landfall + every in-coverage TS+ track point
# at HURDAT2's native 6-hourly cadence. ~330 MB on first run.
python scripts/scrape_radar.py

# Subset to hurricane-strength only (~195 MB)
python scripts/scrape_radar.py --hurricane-only

# Major hurricanes only (~68 MB)
python scripts/scrape_radar.py --major-only

# Just the landfall frames, no full track (~35 MB)
python scripts/scrape_radar.py --landfalls-only

# Densify to hourly cadence between HURDAT2 records (multi-GB — needs LFS)
python scripts/scrape_radar.py --cadence 60

# Resume / refill — existing files are skipped automatically
python scripts/scrape_radar.py
```

Scraper flags:

| Flag | Default | Effect |
| ---- | ------- | ------ |
| `--cadence MIN` | 360 (= 6h) | Densify track-point fetches to N-min interpolation between HURDAT2 records |
| `--hurricane-only` | off | Skip storms that landed at TS strength only |
| `--major-only` | off | Skip everything below Cat 3 at landfall |
| `--landfalls-only` | off | Skip the full-track expansion, fetch only landfall frames |
| `--start YYYY` / `--end YYYY` | none | Year-range filter |
| `--force` | off | Re-download even if file exists locally |
| `--concurrency N` | 8 | Parallel HTTP fetches |
| `--dry-run` | off | Print task count + estimated MB without downloading |

## Refreshing the HURDAT2 best-track when NOAA publishes a new season

NOAA typically releases the previous season's HURDAT2 update in February. To pull the latest:

```bash
# Update these URLs with the latest filenames from https://www.nhc.noaa.gov/data/
curl -sSL -o data/hurdat2-atlantic.txt \
  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt"
curl -sSL -o data/hurdat2-nepac.txt \
  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-02272026.txt"

python scripts/preprocess_hurdat2.py
```

Then bump the version, update `CHANGELOG.md`, and commit.

## License

MIT — see [LICENSE](LICENSE). HURDAT2 itself is U.S. Government work and is in the public domain.
