# Iter 1 — State of Repo (Phase 0 recon)

**Run date:** 2026-05-03
**Prior version:** v0.3.1
**Repo size:** ~24 src JS modules, 81KB CSS, ~9MB static data, single-page Leaflet app.
**Stack:** Vanilla JS ES modules, Leaflet (with leaflet.heat plugin loaded inline), Inter + JetBrains Mono via Google Fonts. No build step. Static `python -m http.server` for dev.

## Existing capabilities (audited from code)

### Data spine
- HURDAT2 Atlantic + NEPAC preprocessed to `data/storms.json` (2.2MB), `data/landfalls.json` (130KB), `data/stats.json`, `data/impacts.json`.
- US states GeoJSON, NEXRAD radar archive (`data/radar/`), SLOSH MOM surge tiles (referenced at runtime).
- Active-storm polling via NHC `CurrentStorms.json` through corsproxy.

### Map & visualization
- Leaflet basemap with CartoDB Dark Matter primary + filtered OSM fallback.
- Saffir-Simpson colored markers per landfall.
- Track polylines + heatmap toggle.
- Wind-radii swath (HURDAT2 wind radii, 2004+).
- NEXRAD radar overlay + animated playback, in-lockstep with simulated UTC.
- SLOSH "Maximum of Maximums" surge raster overlay (per-category).
- Population density layer.

### Storm panel
- Inline SVG intensity chart (wind kt left axis, pressure mb right axis inverted, dashed landfall verticals, hover crosshair tooltip).
- Landfall list with NEXRAD per-landfall quick buttons.
- Action row: Wikipedia / YouTube / NOAA TCR / NHC archive / GOES SLIDER / NCEI Storm Events tornado search / NHC recon archive.
- Compare tray (pin up to N storms, side-by-side intensity overlay).

### State deep-dive
- Click US state polygon → state landfall history panel (by-category histogram, by-decade trend, deadliest/costliest list).

### UX (post v0.3.0+v0.3.1 polish pass)
- Inter + JetBrains Mono with `cv11`/`ss03`/`tnum` features.
- Universal `:focus-visible` rings, `prefers-reduced-motion` support.
- Custom themed checkbox/select/search inputs.
- Glass surfaces, gradient headlines, dual-ring spinner.
- Storm panel uses full viewport height; zoom controls bottom-right; left panels flush to edge.

## ROADMAP status entering this run

ROADMAP.md (Phase 1-3) is **100% checked** — every item shipped. There is no current actionable roadmap.

## Not yet present (gaps surfaced by audit)

1. **Per-storm derived intensity metrics**: ACE (Accumulated Cyclone Energy), rapid-intensification (RI) flag.
2. **Closest-approach tool**: "did a hurricane pass within N mi of [city]?" — not currently answerable.
3. **Permalink / URL state**: filter combinations, opened storm, opened state are NOT shareable. Reload loses everything.
4. **Storm export**: no way to export a track as KML/GeoJSON/CSV for use in QGIS / Google Earth / spreadsheets.
5. **Pressure on chart**: ✅ already present (verified).
6. **Search by name/year**: ✅ already present (verified — `searchStorms` in `data.js`).
7. **ROADMAP.md is stale**: every Phase 1-3 item is checked. Needs Phase 4 replenish from research.

## Charter alignment

Per repo `CLAUDE.md`-style framing: HurricaneMap is a public-facing, single-page hurricane explorer focused on US landfalls, 1851→present, with both retrospective + live-storm capability. New features should:
- Stay client-side (no backend).
- Stay free of new dependencies where reasonable.
- Be educational + research-friendly (export/share/compare friendly).
- Respect dark-mode default + the established Catppuccin Mocha tonal palette.

ACE / RI / closest-approach / permalinks / export all align cleanly with the charter — no scope expansion needed.
