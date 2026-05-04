# HurricaneMap Roadmap — Phased Feature Build

Status legend: `[ ]` not started · `[~]` in progress · `[x]` shipped

## Phase 1 — In-app analytics — ✅ SHIPPED

- [x] **P1.1 Intensity time-series chart** — wind + pressure across full HURDAT2 track, landfall markers, hover tooltip.
- [x] **P1.2 Storm comparison mode** — pin up to 4 storms; overlay tracks + side-by-side stat grid.
- [x] **P1.3 Landfall density heatmap** — Leaflet.heat layer weighted by category.
- [x] **P1.4 State deep-dive** — per-state history, by-category histogram, by-decade trend.

## Phase 2 — External data integrations — ✅ SHIPPED

- [x] **P2.1 Storm surge SLOSH MOMs** — NHC SLOSH Maximum-of-Maximums Cat 1–5 inundation overlay.
- [x] **P2.2 HRD H*Wind swaths** — analyzed wind field rasters 1994–2013.
- [x] **P2.3 GOES satellite imagery** — SLIDER linkout at HURDAT2 synoptic times.
- [x] **P2.4 Casualty + damage data** — NHC TCR + Wikipedia scrape into `data/impacts.json`.

## Phase 3 — Live data + niche overlays — ✅ SHIPPED

- [x] **P3.1 Active-storm overlay** — NHC current advisory polling, animated track when present.
- [x] **P3.2 Population exposure** — SEDAC GPW v4 1km density toggle.
- [x] **P3.3 NEXRAD radar archive** — Iowa Mesonet timelapse for 1995+ landfalls.
- [x] **P3.4 Track animation** — play-storm-track button with speed control + scrubber.

## Phase 4 — Storm metrics + permalinks — ✅ SHIPPED in v0.4.0

- [x] **P4.1 ACE (Accumulated Cyclone Energy)** — Σ(v²/10⁴) over 6-hourly obs ≥ 34 kt; surfaced as a stat tile alongside peak wind / min pressure with NHC-definition tooltip.
- [x] **P4.2 Rapid-intensification flag** — detect ≥30 kt wind gain in any 24-hour window per NHC definition; pink badge in panel + red overlay segment on the intensity chart with "⚡ RI +XX kt" label.
- [x] **P4.3 Closest pass to coastal city** — 25 hand-curated U.S. coastal cities (Atlantic + Gulf + Hawaii + Puerto Rico); haversine to nearest track point; auto-defaults to a city in the storm's first landfall state.
- [x] **P4.4 URL permalinks** — encode filters + opened storm + opened state to `location.hash`; restore on cold load. Format: `#y=2000-2025&c=3,4,5&s=Florida&storm=AL122005`.
- [x] **P4.5 Track export (CSV / GeoJSON / KML)** — one-click client-side export; CSV for spreadsheets, GeoJSON for QGIS/Mapbox, KML for Google Earth with donut landfall icons.

## Phase 5 — Tier 2 metrics + share (partially shipped in v0.5.0)

- [x] **P5.1 Pressure-fall rate metric** — ✅ v0.5.0. Detects ≥20 mb / 24h drop; surfaced as "📉 Explosive deepening" pill alongside the RI badge. Katrina shows both wind (+50 kt) and pressure (−46 mb) deepening flags.
- [x] **P5.2 Translation speed (forward speed)** — ✅ v0.5.0. New stat tile shows time-weighted mean km/h with mph in subtitle; tooltip includes peak speed and total stalled-hours (<10 km/h flood-disaster threshold).
- [ ] **P5.3 Days-at-intensity histogram** — hours spent at TS / Cat-1 / Cat-2 / Cat-3 / Cat-4 / Cat-5; stacked bar in the panel.
- [ ] **P5.4 First-run onboarding** — 4-step coachmark tour highlighting filters, search, compare-tray, permalink button.
- [ ] **P5.5 Color-blind palette toggle** — alternate Saffir-Simpson palette using ColorBrewer YlOrRd; persisted in `localStorage`.
- [ ] **P5.6 Unit toggle (kt / mph / km·h)** — single setting, propagates through panel + chart axis labels.
- [ ] **P5.7 PWA install** — `manifest.json` + service worker for offline tile + data caching of last-viewed storms.
- [ ] **P5.8 Timeline ribbon** — 174-year horizontal ribbon at the bottom showing storm density per year, click to jump filter.
- [ ] **P5.9 PNG / SVG export of intensity chart** — `<canvas>` rasterize for social-media share.
- [x] **P5.10 Share button** — ✅ v0.5.0. "🔗 Share view" copies permalink to clipboard with toast confirmation; reusable toast component now available app-wide.

---

See `docs/research/` for full-source iteration history and tier scoring.
