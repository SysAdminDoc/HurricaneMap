# Changelog

All notable changes to HurricaneMap.

## Unreleased

### Premium polish pass — v0.3.0

- **Type system.** Adopted Inter (400/500/600/700/800) and JetBrains Mono with `cv11`/`ss03`/`tnum` font features so every numeric stat and timestamp renders in true tabular figures. Headings tightened to -0.015 to -0.02em tracking; body sits at a comfortable 14/1.55.
- **Header refinement.** Replaced the inline `…` subtitle with a structured `count · count` layout using a tonal bullet separator. Brand mark now has a soft inset highlight + subtle drop shadow.
- **Filter rhythm.** Each filter row now has a thin tonal divider so the panel reads as discrete sections. Visible-count rendered as a pill chip with tabular numerals. Reset row pinned with a stronger top border.
- **Custom inputs.** Native browser checkbox / select / search styling replaced with themed equivalents: rounded checkbox with animated check, custom chevron on every `<select>`, built-in magnifier glyph in the search input, all with consistent focus-visible rings.
- **Universal focus-visible.** Every button, link, input, and toggle now has a clear `--ring-strong` keyboard ring (sapphire/lavender) — accessibility upgrade with no visual cost on mouse use.
- **Category buttons.** Off-state is calmer (subdued slate); on-state keeps the categorical color but adds a per-category soft drop-shadow glow so the active set reads at a glance without screaming.
- **Glass surfaces.** Tightened border to `rgba(218, 229, 255, 0.08)` and added a 1px inset top-highlight so panels gain dimension without heavier shadows.
- **Storm / state panel headlines.** H2s now use a subtle 100→90 luminance gradient for a premium typographic edge.
- **Cat pill + stat tiles.** Pills bolder with a small shadow; stat tiles now layered with a soft 4% top-gradient.
- **Loading state.** Spinner upgraded to a dual-ring composition with sapphire/lavender accents counter-rotating; copy reworded to "Charting 174 years of Atlantic and Pacific landfalls…" — more on-brand and calmer.
- **Info modal.** Card padding bumped to 28/30, headings restructured with proper hierarchy, `<code>` rendered in a lavender-tinted pill, links + meta footer cleaned up. Backdrop now uses `blur(8px)` for proper modal depth.
- **Leaflet chrome.** Attribution gets a translucent dark glass + 6px blur; zoom buttons match with `rgba(11,16,28,0.85)` glass + lavender hover.
- **Reduced-motion support.** Full `@media (prefers-reduced-motion: reduce)` block disables animations, transitions, and the spinning hurricane glyph for users who request it.
- **Selection + scrollbar.** Unified text-selection color to lavender, scrollbar thumb to subtle white with hover lift across every scrollable surface.

### Visual audit & resilience pass — v0.2.0

- Hardened the dark basemap loader with a 6-error / 8-second rolling-window threshold so a single transient tile failure no longer collapses the whole map to the OSM fallback.
- When the OSM fallback does engage, a CSS filter (`invert + hue-rotate + brightness/saturate/contrast`) re-skins it as a dark basemap so the design stays cohesive even without CartoCDN.
- Boosted landfall marker contrast (deeper outline, higher fill opacity) and added a `landfall-major` glow class for Cat 3+ storms.
- Brightened state-boundary overlay (color, opacity, weight) and strengthened the hover state so cross-state context reads at a glance.
- Replaced the fragile `height: 980px; margin-top: -90px` storm-panel hack with `max-height: calc(100vh - 130px)` so the panel scales to any viewport without overflowing.
- Pinned `#map` to `position: fixed; inset: 0; width: 100vw; height: 100vh` and matched `body` background to `--base` so the map fills the viewport with no contrasting gap on any breakpoint.
- Polished Leaflet zoom controls, added a subtle radial vignette, drop-shadow glows on markers and tracks, and consistent webkit scrollbar styling across all glass panels.
- Recomputed the filters panel max-height and hid the legend on short viewports so the legend never crowds the filters at any size.

### Interface polish pass

- Refined the map chrome with a sharper glass theme, compact header branding, clearer filter/toggle controls, stronger panel hierarchy, and responsive mobile layout fixes.
- Synced category/panel selected states for assistive tech and made Reset filters clear tracks, heatmap, storm-surge, and population overlays.
- Added real sort controls to the state deep-dive storm list for newest, strongest, and most-hit storm views.
- Added a header filter toggle so the filter sheet can collapse into a map-first view, defaulting to collapsed on mobile.
- Moved track-animation player controls closer to the bottom edge so they block less of the map while playback is running.
- Tuned the storm detail panel height/top offset and clamped animation-player bottom offset so controls stay lower without disappearing on short viewports.
- Removed the negative animation-player margin and pinned playback controls to a visible bottom inset.
- Added an OpenStreetMap basemap fallback for blocked CartoDB tiles and fixed playback controls to the viewport bottom.

### 13-feature analytics roadmap (Phases 1-3) shipped

**Phase 1 — In-app analytics, no new data sources:**
- **P1.1 Intensity time-series chart** — inline SVG in storm panel: wind + pressure curves with landfall markers, category bands, hover crosshair.
- **P1.2 Storm comparison mode** — pin up to 4 storms (header `</>` button + per-storm "📌 Pin" button); compare panel renders side-by-side cards + stat table + per-storm mini-charts; tracks drawn on map color-coded.
- **P1.3 Density heatmap** — Leaflet.heat overlay weighted by Saffir-Simpson category, showing landfall hotspots vs cold spots.
- **P1.4 State deep-dive** — clickable state polygons (subtle outline, hover-brighten) plus filter integration; per-state panel with by-category histogram, by-decade trend, top-5 worst, and a full sortable storm list.

**Phase 2 — External data integrations:**
- **P2.1 SLOSH MOM storm surge** — `Storm surge (SLOSH MOM)` selector overlays NOAA's Cat 1-5 inundation envelope tiles for U.S. Gulf + East Coast + Caribbean.
- **P2.2 Wind-field swaths** — HURDAT2 best-track wind radii (34/50/64 kt × 4 quadrants) rendered as overlapping asymmetric polygons. Checkbox in storm panel for storms 2004+.
- **P2.3 GOES satellite quicklink** — storm panel "🛰️ GOES satellite" button opens RAMMB SLIDER pre-configured to the landfall UTC moment + correct sector + GeoColor product.
- **P2.4 Casualty + damage data** — Wikipedia infobox scraper (`scripts/scrape_impacts.py`) populates `data/impacts.json`; storm panel renders "Impacts" block with deaths + damage when available (46 storms in initial run).

**Phase 3 — Live data + niche overlays:**
- **P3.1 Active storm tracking** — `src/active.js` polls NHC's CurrentStorms.json every 10 min via corsproxy.io; pulsing top-center badge appears when storms are active; best-track polylines, dashed forecast tracks, current-position markers, and cone-of-uncertainty polygons rendered on the map.
- **P3.2 Spaghetti models** — model quicklinks (Tropical Tidbits + Track The Tropics) embedded in the active-storm badge.
- **P3.3 Tornado activity** — storm panel "🌪️ Tornadoes (NOAA)" button opens NOAA Storm Events Database pre-filtered to the storm's dates + affected states (FIPS-mapped).
- **P3.4 Population density** — `Population density (SEDAC GPW 1km)` checkbox overlays NASA SEDAC's gridded-population tiles at 55% opacity, layered above the basemap and below the dots.
- **P3.5 Aircraft recon archive** — Atlantic-basin storms 1989+ get a "✈️ Recon archive" button linking to Tropical Atlantic's Hurricane Hunters mirror.

UI organization principles followed throughout: map stays primary; new features either become panel sections / quicklink buttons (storm-specific) or filter-sidebar toggles (global); active-storm chrome shows zero pixels off-season.



- **Radar locked into the track animation.** When you click "Play track animation" on a storm that has offline radar (1995+), a `📡 radar (N)` checkbox appears in the control bar. With it on, the L.imageOverlay swaps to the most recent NEXRAD frame at-or-before the simulated UTC clock on every animation tick — so as the spinning glyph crosses the coast, the actual reflectivity paints onto the map at exactly the right moment. Falls back to a "📡 —" disabled chip for storms without offline radar (pre-1995, out-of-coverage, etc.). `radar.js` now exports `getStormRadarFrames(stormId)` so the animator can read the manifest without owning the loader.
- **Track animation** (opt-in via "Play track animation" button on every storm): spinning hurricane glyph + translucent wind-field disk traveling the full HURDAT2 track. Glyph and wind-field both resize live with current Saffir-Simpson category. Bottom-center control bar with play/pause/restart, a scrubber, speed selector (0.5×/1×/2×/4×), live HUD (timestamp + status + wind), and close.
- **📡 Archived NEXRAD radar — full-storm timeline, baked into the repo.** Every storm from August 1995 onward ships with every in-coverage 6-hourly track frame as a local PNG (~512 MB across 1700+ frames in 139 storm folders). Click 📡 next to any landfall and the loop animates the storm's complete U.S. passage from genesis-in-coverage to dissipation, with the map auto-panning to follow the eye. Katrina '05 plays back 22 frames over five days. Frames not in the local archive transparently fall back to live IEM URLs. Tool now works fully offline after `git clone`.
- New scraper: `scripts/scrape_radar.py` with `--cadence`, `--hurricane-only`, `--major-only`, `--landfalls-only`, `--start`, `--end`, `--force`, `--concurrency`, `--dry-run` flags. See README "Refreshing the radar archive".
- Storage layout: `data/radar/<Name>-<Year>/t_<UTC>.png` + `data/radar/manifest.json`.
- Replaced placeholder logo with proper hurricane-spiral branding.

## v0.1.0 — 2026-05-03

Initial release.

- HURDAT2 preprocessor (`scripts/preprocess_hurdat2.py`) parses both Atlantic and Eastern Pacific best-track files, attributes landfalls to U.S. states via point-in-polygon against U.S. Census state boundaries, and emits three JSON datasets:
  - `landfalls.json` — flat list of every U.S. landfall event (596 storms, 760 events).
  - `storms.json` — full track + metadata for every U.S.-landfalling storm.
  - `stats.json` — by-state, by-decade, by-category, and cold-spot roll-ups.
- Inferred-landfall detection: catches Iniki '92 on Kauai and other Hawaii/Pacific landfalls that don't carry an `L` marker in HURDAT2. Uses mid-segment interpolation when the 6-hour track crosses a small island between synoptic times.
- Pacific-basin geographic guard: EPac inferred landfalls restricted to coastal Pacific states (HI/CA/OR/WA/AK) to prevent false positives in landlocked Arizona / New Mexico from EPac storms tracking up through Mexico.
- Interactive Leaflet map with dark Catppuccin Mocha theme, glassmorphism panels, color-graded storm tracks by per-segment intensity.
- Per-storm details panel with Wikipedia, YouTube, NOAA Tropical Cyclone Report, and NHC archive quicklinks.
- Statistics panel: state hotspot rankings, decade trends, category breakdown, cold-spot list (coastal states with no recorded hurricane-strength landfall).
- Filters: year range (1851–2025), Saffir-Simpson category toggles, state filter, name/year search.
- PWA manifest + viewport/theme-color meta tags.
