# HurricaneMap Roadmap — Phased Feature Build

Status legend: `[ ]` not started · `[~]` in progress · `[x]` shipped

## Phase 1 — In-app analytics (no new data sources, no new deps beyond what's in `index.html`)

- [x] **P1.1 Intensity time-series chart** — SVG line chart in the storm panel showing wind (kt) and pressure (mb) across the full HURDAT2 track, with vertical markers for each U.S. landfall and a hover tooltip.
- [x] **P1.2 Storm comparison mode** — pin up to 4 storms into a compare tray; overlays their tracks color-coded by storm and shows a side-by-side intensity chart + stat grid in a dedicated panel.
- [x] **P1.3 Landfall density heatmap** — toggleable layer that swaps the colored Saffir-Simpson dots for a [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) heatmap weighted by category, showing where strikes concentrate vs avoid.
- [x] **P1.4 State deep-dive** — clicking a state polygon (or selecting via the filter) opens a panel with that state's full landfall history: by-category histogram, by-decade trend, deadliest/costliest, every storm sortable.

## Phase 2 — New external data integrations

- [x] **P2.1 Storm surge SLOSH MOMs** — pull NHC's [SLOSH Maximum-of-Maximums](https://www.nhc.noaa.gov/nationalsurge/) GIS rasters (Cat 1 through Cat 5) for the U.S. Gulf + East coasts; commit as compressed PNGs with a layer toggle that overlays the inundation band matching the selected storm's landfall category.
- [x] **P2.2 HRD H*Wind swaths** — scrape the [NOAA HRD H*Wind archive](https://www.aoml.noaa.gov/hrd/data_sub/wind.html) for storms 1994–2013, convert each to a transparent PNG raster, and add a "Wind field" button to the storm panel that overlays the actual analyzed wind field.
- [ ] **P2.3 GOES satellite imagery** — for each storm 2000+, pull GOES IR/visible composites at HURDAT2 6-hourly synoptic times (NCEI archive), bake into `data/satellite/` mirroring the radar layout, and add a "🛰️ Satellite" toggle alongside the radar checkbox.
- [ ] **P2.4 Casualty + damage data** — scrape NHC Tropical Cyclone Reports (where available) and Wikipedia infoboxes for deaths/damage, store in `data/impacts.json`, surface in the storm panel as an "Impacts" subsection.

## Phase 3 — Live data + niche overlays

- [ ] **P3.1 Active storm tracking** — pull [NHC `CurrentStorms.json`](https://www.nhc.noaa.gov/CurrentStorms.json) at runtime; if any storms are active, render their cones of uncertainty + advisory tracks in a distinctive style.
- [ ] **P3.2 Spaghetti models** — fetch model tracks (GFS, ECMWF, HMON, HWRF, ensemble means) for active storms via NOMADS or a-deck data; overlay as thin polylines.
- [ ] **P3.3 Tornado activity** — for storms 1995+, pull tornado reports from NOAA Storm Events Database (or Tropycal-equivalent) within the storm's lifetime + state of impact; plot as small markers on the map and list in the storm panel.
- [ ] **P3.4 Population exposure** — overlay U.S. Census block-level population density as a heat layer; for each storm, compute "X million in Cat-N wind zone" using H*Wind swath × population.
- [ ] **P3.5 Aircraft recon** — NHC `/recon/` archive provides flight tracks + dropsonde data; render flight paths on the storm's map view.

## UI organization principles

- Keep the **map** as the primary surface; everything else is a glass panel that slides in.
- The right-side panel becomes **tabbed** — Details · Intensity · Hazards · Radar · Impacts — instead of one long scroll.
- A small **Layers control** floats bottom-left for global toggles (heatmap, surge, satellite, population).
- **Compare tray** is a floating bottom-center bar that appears once a storm is pinned.
- **State deep-dive** opens via clicking a state on the map OR via the existing state filter.
- Active-storm chrome (Phase 3) only appears when NHC currently has storms — otherwise zero pixels of UI dedicated to it.

## Definition of Done per item

For each item in this roadmap:
1. Feature actually works end-to-end (smoke test in browser, verify expected output).
2. UI integrates with the existing dark Catppuccin Mocha + glassmorphism theme.
3. No regressions in the existing radar / animation / panel features.
4. README + this ROADMAP + CHANGELOG entries updated.
5. Auto-commit + push, with one-line status here.
