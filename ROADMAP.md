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

## Phase 5 — Tier 2 metrics + share (✅ shipped in v0.6.0)

- [x] **P5.1 Pressure-fall rate metric** — ✅ v0.5.0. Detects ≥20 mb / 24h drop; surfaced as "📉 Explosive deepening" pill alongside the RI badge. Katrina shows both wind (+50 kt) and pressure (−46 mb) deepening flags.
- [x] **P5.2 Translation speed (forward speed)** — ✅ v0.5.0. New stat tile shows time-weighted mean km/h with mph in subtitle; tooltip includes peak speed and total stalled-hours (<10 km/h flood-disaster threshold).
- [x] **P5.3 Days-at-intensity histogram** — ✅ v0.6.0. Stacked horizontal bar in panel shows hours at TD/TS/Cat-1..5 with percentage labels and total tracked days.
- [x] **P5.4 First-run onboarding** — ✅ v0.6.0. 4-step coachmark tour with spotlight cutout; localStorage flag prevents re-firing; "Replay welcome tour" available in settings.
- [x] **P5.5 Color-blind palette toggle** — ✅ v0.6.0. ColorBrewer YlOrRd 7-class sequential palette; CSS-var-driven so map dots, chart bands, panel pills, days-at-intensity bar, and timeline ribbon all swap atomically.
- [x] **P5.6 Unit toggle (kt / mph / km·h)** — ✅ v0.6.0. Settings menu pill group; persisted to localStorage; propagates to peak-wind stat and closest-pass readout.
- [x] **P5.7 PWA install** — ✅ v0.6.0. `manifest.webmanifest` + `sw.js` with stale-while-revalidate for HURDAT2 JSON, cache-first for CartoDB/OSM tiles, shell precache on install.
- [x] **P5.8 Timeline ribbon** — ✅ v0.6.0. 174-year density bar across the bottom of the viewport; bar height = landfalls that year, color = strongest category that year; click sets year filter, drag selects a year range; collapsible.
- [x] **P5.9 PNG / SVG export of intensity chart** — ✅ v0.6.0. PNG rasterizes the live SVG to canvas at 2× scale with embedded font + Catppuccin background; SVG exports a standalone XML with inline styles.
- [x] **P5.10 Share button** — ✅ v0.5.0. "🔗 Share view" copies permalink to clipboard with toast confirmation; reusable toast component now available app-wide.

## Phase 6 — Discoverability, accessibility, season analytics (in progress)

Iteration-7 research replenishment. Phase 5 closed the metrics/share/PWA gaps; Phase 6 turns inward — improving how the data is *navigated* (sparklines, season cards, fuzzy search), making the app accessible to keyboard-only and screen-reader users, and shoring up the new v0.6.0 surfaces with proper ARIA + focus management.

- [x] **P6.1 Storm intensity sparkline in search results** — ✅ v0.6.1. Each search result row now carries a 64×18 inline SVG wind-over-time sparkline color-coded by Saffir tier. Lets users distinguish a long-lived Cat-5 from a brief TS at a glance, without opening the panel.
- [x] **P6.2 Accessibility pass on v0.6.0 surfaces** — ✅ v0.6.1. Settings menu gets ARIA `role=menu` + roving-tabindex, ESC dismiss, focus-trap when open. Onboarding tour traps focus inside the card, restores focus on close. Timeline ribbon is keyboard-navigable (←/→ steps the focused year, Shift+←/→ adjusts range, Enter applies, ESC clears). Days-at-intensity bar exposes `aria-label` per segment.
- [x] **P6.3 Season summary card** — ✅ v0.7.0. When the year filter narrows to a 1–3 year window, a "Season summary" card surfaces beside the legend showing total named storms, total ACE, landfall count by Saffir tier, strongest landfall, deadliest, and costliest. Aggregates compute synchronously for counts/categories and async-resolve ACE + impact superlatives once the storm-track cache warms.
- [x] **P6.4 Fuzzy / typo-tolerant search** — ✅ v0.7.0. Levenshtein ≤2 fallback layer activates when the substring search returns fewer than 5 hits and the query is 4+ characters. Ranks by edit-distance asc + year-recency desc and surfaces under a "Did you mean…" divider so it never shadows the literal results. Caps at 5 fuzzy suggestions.
- [ ] **P6.5 Inflation-adjusted damage toggle** — leverages existing `data/impacts.json` damage figures; toggle in settings menu adjusts USD via BLS CPI table (annual, baked into a small JSON). Defaults to 2024 USD.
- [x] **P6.6 Print stylesheet** — ✅ v0.7.0. `@media print` block collapses chrome (header, legend, leaflet controls, timeline, FABs, settings, onboarding, toasts), promotes any open storm panel to full-width black-on-white below the static map snapshot, and ensures intensity charts avoid mid-page splits.
- [x] **P6.7 Storm-name autocomplete + history dropdown** — ✅ v0.7.0. Last 8 viewed storms persist to `localStorage` (`hm-search-history-v1`) and surface as a "Recently viewed" dropdown when the search input is focused with an empty value. Same row template as live search results, including back-filled sparklines once the storm-track cache warms.
- [ ] **P6.8 Annual ACE & landfall climatology chart** — under stats panel, a multi-line chart showing yearly ACE total + named-storm count + US-landfall count, 1851–2025. Highlights AMO phase shifts, 2005-vs-2020 super-seasons.
- [x] **P6.9 Reduced-motion full pass** — ✅ v0.7.0. Single end-of-stylesheet `@media (prefers-reduced-motion: reduce)` block clamps all `animation-duration` + `transition-duration` to 0.01ms (state changes still register) and disables named animations entirely on toasts, the onboarding overlay/card, install prompt, season summary, panel actions, search results, tier blocks, legend items, and timeline bars.
- [ ] **P6.10 Lighthouse green-bar pass** — verify PWA install criteria, fix any LCP/CLS regressions from v0.6.0, set a perf budget in CI (manual `lighthouse-cli` run scripted in `scripts/lighthouse.sh`).

---

See `docs/research/` for full-source iteration history and tier scoring.
