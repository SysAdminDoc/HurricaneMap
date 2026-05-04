# HurricaneMap

[![Live demo](https://img.shields.io/badge/live%20demo-sysadmindoc.github.io%2FHurricaneMap-cba6f7.svg)](https://sysadmindoc.github.io/HurricaneMap/)
[![Version](https://img.shields.io/badge/version-1.3.6-blue.svg)](https://github.com/SysAdminDoc/HurricaneMap/releases)
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
- **Track animation** — opt-in playback of a spinning hurricane glyph and translucent wind-field disk that travels the full path, both sized in real-time by Saffir-Simpson category at each track point. Playback controls live inside the storm side panel beneath the Play/Pause button, including radar sync, speed, restart, and scrubber controls.
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

## Premium UX/UI Polish (Latest)

The interface has undergone a premium-polish pass focused on clarity, trust, accessibility, and a more cohesive product feel:

**Interaction Refinements**
- **Theme system hardening** — Dark, Light, System, colorblind palette, and high-contrast modes now share semantic tokens for surfaces, controls, focus rings, disabled states, alerts, Leaflet controls, and panel overlays.
- **Panel lane stabilized** — Storm, statistics, comparison, state, and "on this date" panels now share one fixed responsive side lane with mobile collision handling, so panels no longer overlap controls or each other.
- **Keyboard-friendly search** — Search results now behave like a proper combobox/listbox with arrow-key navigation, Enter selection, Escape close, active-result highlighting, and clearer empty states.
- **Resilient loading feedback** — Required data-load failures now surface a calm, actionable error card with retry guidance instead of silently rendering a broken empty map.
- **Inline playback controls** — Track playback now drops down inside the storm side panel beneath the Play/Pause button, replacing the old viewport-wide playback bar that could overlap the map and panels.
- **Readable playback state** — The active Play/Pause button uses a high-contrast dark active surface with light text so playback state remains legible.
- **Reserved overlay shelf** — Compare and radar controls now live above the bottom timeline and outside the side-panel lane, reducing collisions between floating controls.
- **Compact season timelapse dock** — Single-year timelapse controls now appear as a small labeled dock instead of an oversized glass bar across the page.
- **Deterministic year picking** — Timeline clicks now select the exact clicked year, drags select ranges, and double-click resets the full 1851–2025 span without competing click/drag events.
- **State-filtered timeline** — Selecting a state now updates the year timeline to show *only* that state's landfalls, reducing visual noise and improving clarity.
- **Histogram color intensity** — Category and decade bars now feature colored fills (matching Saffir-Simpson category colors), with opacity scaled to storm count, making patterns immediately recognizable.

**Component Polish**
- **Unified panel surfaces** — Side panels, settings, comparison, empty states, stats sections, compact season summaries, closest-pass cards, and toast feedback now use a consistent surface, radius, spacing, and border language.
- **Input focus states** — All inputs, selects, and forms now provide visual feedback with box-shadow rings, color transitions, and smooth 120ms animations.
- **Button system refinement** — Across all button types: transform feedback (hover lift via `translateY`), elevated shadows, improved contrast, and consistent focus visibility.
- **Search results** — Fade-in animations, smoother hover feedback with padding animation.
- **State storm rows** — Hover effects with background transitions for better affordance.
- **Intensity chart** — Subtle border and shadow feedback on interaction.
- **Compare cards** — Hover effects with border lightening and shadow elevation.
- **Animation scrubber** — Thumb element scales on hover with improved box-shadow feedback.
- **Checkbox interactions** — Scale transform on hover (1.05) for better tactile feedback.

**Visual Hierarchy & Consistency**
- **Unified transition timing** — All animations use consistent 120ms `ease` or cubic-bezier easing for a cohesive feel.
- **Shadow elevation system** — 3-level shadow depth (2px/4px, 4px/12px, 6px/16px) creates clear visual hierarchy.
- **Color palette** — Catppuccin Mocha throughout with semantic color usage (category-specific storm coloring, state-specific histogram fills).
- **Spacing rhythm** — Consistent 8px grid system respected across all panels, cards, and sections.

**Accessibility Enhancements**
- **Focus ring visibility** — Subtle but clear `0 0 0 3px` lavender-tinted rings across all interactive elements.
- **Keyboard navigation** — Full support for Escape, Tab, and Enter workflows.
- **Screen-reader semantics** — Search, glossary, panels, loading, error, and empty states expose clearer roles, labels, and status messaging.
- **Color contrast** — Maintained throughout all states per WCAG standards.
- **Reduced motion** — Respected where supported.

## Phase 8: Mobile Optimization & Advanced Features (Latest)

**Mobile-First Responsive Design**
- **WCAG AAA touch targets** — All interactive elements now meet the 44×44px minimum standard on mobile (720px and below): header icon buttons, Leaflet zoom controls, year inputs, category toggles. Leaflet controls gain rounded corners for better ergonomics.
- **Improved mobile panel layout** — Panels and filters optimized for small screens with responsive cascading at 720px, 640px, and 430px breakpoints.

**Dark/Light Theme Toggle**
- **Catppuccin Mocha and Latte** — Switch between dark and light themes via the settings menu. Selection persists to localStorage. Smooth CSS-variable swap without page reload.
- **All elements theme-aware** — Category colors, backgrounds, text colors, and all UI elements adjust automatically.

**Advanced Storm Comparison**
- **Diff highlighting in comparison table** — Max values highlighted in green, min values in red/pink. Instantly see which pinned storms stand out on each metric (peak wind, pressure, landfall count, track points, ACE).

**Decade-by-Decade Trend Analysis**
- **New statistics table** — Six-column analysis by decade: named-storm count, major-hurricane %, ACE total, deadliest storm, and costliest storm. Hover reveals death/damage details. Complements the annual climatology chart.

**Performance Optimizations**
- **Core Web Vitals monitoring** — Automatic tracking of LCP (Largest Contentful Paint), FID (First Input Delay), and CLS (Cumulative Layout Shift) logged to the browser console.
- **CSS rendering optimizations** — `will-change` hints on frequently-animated elements (buttons, charts, action controls) reduce layout thrashing.
- **Lazy-load infrastructure** — Foundation for on-demand loading of non-critical modules (e.g., radar overlay) to reduce initial bundle impact.

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

## Data Export & Research

**Export filtered data as publication-ready CSV:**

HurricaneMap includes a one-click CSV export button (📄 icon in the header) that downloads your filtered dataset with:

- **Full documentation:** data dictionary, methodology notes, NOAA citation, attribution requirements
- **All landfall fields:** storm ID, name, year, month, day, hour, latitude, longitude, wind speed (kt/mph), pressure, Saffir-Simpson category, state
- **Timestamped filename:** `HurricaneMap-Export-YYYY-MM-DD.csv`
- **Proper CSV escaping:** handles commas, quotes, and newlines

Perfect for:
- Academic research papers (includes full HURDAT2 citation)
- Climate & seasonal analysis
- Geographic & statistical software (ArcGIS, R, Python, QGIS)
- Spreadsheet analysis (Excel, Google Sheets)

See [LICENSE.md](LICENSE.md#how-to-cite-hurriranemap) for citation formats.

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

## Data Sources, Licensing & Attribution

### Open Data License Clarity

**HurricaneMap is built on entirely open and public data.** All datasets carry clear, permissive licenses:

| Dataset | Source | License | Citation |
| --- | --- | --- | --- |
| **HURDAT2 Best-Track** | [NOAA National Hurricane Center](https://www.nhc.noaa.gov/data/) | Public Domain (U.S. Govt) | Landsea, C. W. & Franklin, 2013 |
| **NEXRAD Radar Archive** | [Iowa State IEM](https://mesonet.agron.iastate.edu/) | Public Domain | Acknowledgment required |
| **Population Density (GPWv4)** | [SEDAC, Columbia University](https://sedac.ciesin.columbia.edu/) | CC BY 4.0 | [See attribution](LICENSE.md#population-density) |
| **State Boundaries** | [U.S. Census Bureau TIGER](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) | Public Domain | Acknowledgment required |
| **Storm Impacts** | [Wikipedia](https://en.wikipedia.org/) | CC BY-SA 3.0 | [See details](LICENSE.md#storm-impacts-data) |
| **Map Tiles** | [OpenStreetMap](https://www.openstreetmap.org/) | ODbL | © OSM contributors |

### For Research & Publications

**When using HurricaneMap data in research, reports, or presentations,** please:

1. **Acknowledge NOAA/NHC** as the original data source for all hurricane/landfall data:
   > "Historical hurricane landfall data sourced from NOAA's National Hurricane Center HURDAT2 database (https://www.nhc.noaa.gov/data/)"

2. **See [LICENSE.md](LICENSE.md) for:**
   - Per-dataset attribution requirements (SEDAC, Wikipedia, OpenStreetMap, etc.)
   - Full citation formats (Chicago, APA, BibTeX)
   - Data accuracy & pre-satellite-era caveats
   - Landfall detection methodology

3. **Link to HurricaneMap GitHub:** https://github.com/SysAdminDoc/HurricaneMap

### Data Accuracy Notes

- **Pre-1944** (no aircraft) and **pre-1960s** (no satellite): lower completeness and accuracy
- **1971–1990**: documented gaps in continental U.S. landfall marking in HURDAT2
- **Historical uncertainty:** Pre-1900 tracks have ±100+ km uncertainty; modern (post-1960) ±10–20 km
- **More details:** [Data Accuracy & Disclaimers in LICENSE.md](LICENSE.md#data-accuracy--disclaimers)

---

## Data sources & credits (Detailed table)

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

## Automated HURDAT2 Refresh (GitHub Actions)

HurricaneMap includes an automated workflow that checks for NOAA HURDAT2 updates **monthly** (every 1st of the month at 00:00 UTC). When new data is detected:

1. **Automatic download** — Latest Atlantic and Eastern Pacific HURDAT2 files are fetched from NOAA
2. **Change detection** — Files are compared; if new storms or updates exist, preprocessing begins
3. **Preprocessing** — The data is validated and converted to the internal JSON format
4. **Pull Request** — A PR is created with the updated files, ready for review and merge
5. **No auto-merge** — The PR is left for manual review to allow testing before publication

**To trigger manually:** Go to [GitHub Actions → HURDAT2 Auto-Refresh](https://github.com/SysAdminDoc/HurricaneMap/actions/workflows/hurdat2-auto-refresh.yml) and click "Run workflow."

## Manual HURDAT2 Refresh

If you need to update HURDAT2 immediately (or if the automatic workflow hasn't run yet), you can refresh manually:

```bash
# Find the latest filenames at https://www.nhc.noaa.gov/data/hurdat/
# Example using 2026 season update:
curl -sSL -o data/hurdat2-atlantic.txt \
  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2026-02272026.txt"
curl -sSL -o data/hurdat2-nepac.txt \
  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2026-02272026.txt"

python scripts/preprocess_hurdat2.py
```

Then bump the version, update `CHANGELOG.md`, commit, and create a release.

## License & Attribution

**Software:** MIT — see [LICENSE](LICENSE)  
**Data Sources:** See [LICENSE.md](LICENSE.md) for detailed attribution

This project aggregates data from multiple sources:
- **HURDAT2 Best-Track Database** — NOAA National Hurricane Center (public domain)
- **SLOSH Storm Surge Zones** — NOAA NHC (public domain)
- **NEXRAD Archived Radar** — NOAA / Iowa Environmental Mesonet (public domain)
- **Population Density** — SEDAC GPWv4, Columbia University (CC BY 4.0)
- **Storm Impacts** — Wikipedia (CC BY-SA 3.0)

**When using HurricaneMap in research or publications:** Cite NOAA/NHC as the original data source. See [LICENSE.md](LICENSE.md) for full citation formats and per-dataset attribution requirements.
