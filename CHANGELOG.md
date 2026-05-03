# Changelog

All notable changes to HurricaneMap.

## Unreleased

- **Track animation** (opt-in via "Play track animation" button on every storm): spinning hurricane glyph + translucent wind-field disk traveling the full HURDAT2 track. Glyph and wind-field both resize live with current Saffir-Simpson category. Bottom-center control bar with play/pause/restart, a scrubber, speed selector (0.5×/1×/2×/4×), live HUD (timestamp + status + wind), and close.
- **📡 Archived NEXRAD radar overlay at landfall.** For every U.S. landfall from August 1995 onward, a 📡 button appears next to the timestamp in the storm panel. Click it to overlay the actual NEXRAD reflectivity composite at that moment, fetched live from the [Iowa State IEM NEXRAD archive](https://mesonet.agron.iastate.edu/). Stepper buttons (±5 min) and a ±30-minute loop animator let you watch the eye approach and cross the coast.
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
