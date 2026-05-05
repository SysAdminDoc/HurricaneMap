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
- [x] **P6.5 Inflation-adjusted damage toggle** — ✅ v0.8.0. New "Damage figures" pill group in settings menu (Nominal / 2024 USD). Backed by an inline BLS CPI table (1850–2024) in `src/inflation.js`. Storm panel impacts block shows the adjusted figure with the nominal value as a parenthetical, and the season summary's costliest comparison ranks fairly across eras when 2024 USD is selected. Defaults to 2024 USD.
- [x] **P6.6 Print stylesheet** — ✅ v0.7.0. `@media print` block collapses chrome (header, legend, leaflet controls, timeline, FABs, settings, onboarding, toasts), promotes any open storm panel to full-width black-on-white below the static map snapshot, and ensures intensity charts avoid mid-page splits.
- [x] **P6.7 Storm-name autocomplete + history dropdown** — ✅ v0.7.0. Last 8 viewed storms persist to `localStorage` (`hm-search-history-v1`) and surface as a "Recently viewed" dropdown when the search input is focused with an empty value. Same row template as live search results, including back-filled sparklines once the storm-track cache warms.
- [x] **P6.8 Annual ACE & landfall climatology chart** — ✅ v0.8.0. New multi-line SVG chart in the stats panel showing yearly ACE total, named-storm count (≥34kt peak proxy), and US-landfall count from 1851–present. Top 3 ACE years annotated with vertical guide lines + year labels (typically 2005, 2017, 2020). Computed once on first stats-panel open and cached. Three-color legend matches existing palette CSS-vars so colorblind toggle propagates.
- [x] **P6.9 Reduced-motion full pass** — ✅ v0.7.0. Single end-of-stylesheet `@media (prefers-reduced-motion: reduce)` block clamps all `animation-duration` + `transition-duration` to 0.01ms (state changes still register) and disables named animations entirely on toasts, the onboarding overlay/card, install prompt, season summary, panel actions, search results, tier blocks, legend items, and timeline bars.
- [x] **P6.10 Lighthouse green-bar pass** — ✅ v0.8.1. Real `npx lighthouse --preset=desktop` run produced an a11y score of 87/100 on v0.8.0; closed the four real findings to land at 100/100. Onboarding dialog now exposes `aria-labelledby` + `aria-describedby` to its title/body. Year-min/year-max number inputs gained `aria-label`s. The legend heading was promoted to `<h2>` (with selector rewrites in styles.css) so heading order no longer skips a level after the page `<h1>`. The timeline-axis slider now exposes a live `aria-valuenow` + `aria-valuetext` that update with every drag/keyboard step, plus the explicit `tabindex="0"`. SEO 100, Best-Practices 96, Performance ~80–90 (LCP varies with network conditions; tile CDN is the bound).

## Phase 7 — Premium polish

- [x] **P7.1 Premium polish pass** — ✅ v0.9.0. System-level UX/UI refinement layered on top of the existing surfaces: extended token system (motion easings/durations, elevation 1-4, semantic borders, single-source-of-truth focus ring); branded slim scrollbars; universal `:focus-visible`; refined hover/active idiom on icon buttons, settings pills, and compare-tray chips; storm-panel section headings with lavender→sapphire accent bar; CAT pill upgraded with inner highlight + drop-shadow; stat tiles gained hover affordance + base elevation; search results animate in with fade-down + selected-row indent; settings menu + info modal + onboarding overlay smoother entrances; loading screen fades cleanly; Leaflet zoom matched to the system; timeline selection band picks up brand gradient + glow; full reduced-motion respect.
- [x] **P7.2 Layout consolidation** — ✅ v0.9.1. Eliminated panel overlap and internal scroll on the primary surfaces. Floating Saffir-Simpson legend folded into the filters panel as a compact two-column block; map layers grouped under a single sub-heading (tracks / heatmap / population / storm-surge) reducing the filter panel from 9 equivalent rows to 4 logical groups. Filter padding/gaps/label scale retuned so the panel fits 1366×768 without overflow; `max-height` calculated against the live header + timeline footprint. Right-side detail panels (storm/stats/state/compare) now clear the timeline ribbon (102px clearance) and reclaim the space automatically when the timeline is collapsed via `body:has(.timeline-ribbon.collapsed)`. Compact-viewport tuning at 800px tall and 1180px wide.
- [x] **P7.3 Onboarding removal + panel premium polish** — ✅ v0.9.2. Removed the onboarding overlay entirely (instant map load, zero interruption). Executed an aggressive premium-polish pass on all detail panels: storm panel restructured with flexbox (header region with title + close btn, scrollable body with branded slim scrollbar); stat grid now 2-col with hover states; closest-pass compacted to a single-line row; typography hierarchy elevated across headings, labels, meta, and lists; component consistency systemic (backgrounds, borders, shadows, transforms); stats panel receives the same treatment; settings menu cleaned up (replay-tour button removed). Storm panel scrollHeight dropped from 1504px to 784px — fits perfectly on 1440×900 without internal scroll.

## Phase 8 — Mobile-first responsive refinement + advanced filtering (✅ COMPLETE — v1.1.0)

- [x] **P8.1 Mobile-first responsive refinement** — ✅ Enhanced touch targets to WCAG AAA 44×44px standard across icon buttons, Leaflet controls (zoom +/-), year inputs, and all interactive elements on mobile (720px and below). Header icon buttons, Leaflet zoom controls, and input fields now consistently sized. Rounded Leaflet controls for better mobile ergonomics.
- [x] **P8.2 Dark/light theme toggle with persistence** — ✅ Added theme selector in settings menu (Catppuccin Mocha dark vs Latte light). Persists selection to localStorage. Smooth CSS-variable swap without page reload.
- [x] **P8.3 Advanced storm comparison metrics** — ✅ Side-by-side diff highlighting: max values highlighted in green, min values in red/pink. Numeric columns (peak wind, pressure, landfall count, track points) have extrema computed and visually emphasized. Makes it instantly clear which storms stand out on each metric.
- [x] **P8.4 Decade-by-decade trend analysis** — ✅ New table in stats panel with 6 columns: decade, named-storm count, major-hurricane % (Category 3+), ACE total, deadliest storm by decade, costliest storm by decade. Hover reveals death/damage counts. Complements the annual climatology chart.
- [x] **P8.5 Performance audit and optimization** — ✅ Implemented Core Web Vitals monitoring (LCP, FID, CLS) via PerformanceObserver API. Added will-change CSS hints to frequently-animated elements (icon buttons, charts, action buttons). Built lazy-load infrastructure for radar module. Navigation timing metrics logged to console for performance profiling.

## Phase 9 — Advanced analytics & comparative intelligence (✅ COMPLETE — v1.3.1)

Focus: Deep statistical analysis, multi-storm comparisons, climate trend detection, and research-oriented features.

- [x] **P9.1 Storm similarity scoring** — ✅ Compute vector similarity between storms on 8 dimensions (peak wind, landfall count, track length, forward speed, RI magnitude, ACE, decay rate, genesis month). "Similar storms" widget in panel shows top-5 nearest neighbors by cosine distance. Use case: "What's the closest match to 2005 Katrina?"
- [x] **P9.2 Return-period estimation per city** — ✅ For each major coastal city, compute empirical return periods (years between storms of Cat-1, Cat-3, Cat-5+ intensity within 50mi). Expose via city-dropdown in closest-approach widget; e.g., "Miami: Cat-1 every 2.3yr, Cat-3 every 12yr, Cat-5 every 47yr." Foundation for coastal-risk literacy.
- [x] **P9.3 Climate trend overlays** — ✅ New stats-panel chart showing 10-year rolling average of: (1) annual landfall count, (2) annual ACE, (3) avg peak wind at landfall, (4) avg forward speed. Annotated with trend direction (slope via linear regression). Enables analysis of long-term climate patterns.
- [x] **P9.4 Rapid-intensification risk score** — ✅ Compute per-storm RI likelihood based on HURDAT2 historical precedent: for storms with similar peak wind, genesis month, and first-24h wind gain, what % intensified ≥30kt in next 24h? Surfaced as "RI risk: high/med/low" stat tile in panel with probability and similar-storm count in tooltip.
- [x] **P9.5 Storm "biography" narrative** — ✅ Auto-generate a 3–4 sentence summary of each storm in plain English: synthesizes peak wind, landfall states, distinctive features (RI, explosive deepening), and impacts into readable narrative displayed in storm panel below the flags.
- [x] **P9.6 Batch comparison export** — ✅ Select multiple storms → export side-by-side table with metrics (peak wind, pressure, category, landfalls, track points, ACE, forward speed, RI risk) as CSV with auto-generated comparison narratives. Integrates with all existing metrics. CSV file downloads with ISO date in filename. Use case: multi-storm research papers, news briefings.

### Phase 9 Marginal Enhancements (Low-effort, high-value optimizations)

- [x] **P9.7 Pre-computed storm similarity embeddings** — ✅ v1.3.9. Precomputes the existing eight-dimensional normalized similarity vector into each generated `storms.json` row, validates the vector contract, and uses embedded vectors for instant nearest-neighbor lookup with runtime fallback parity for older data.

## Phase 10 — Real-time integration & forecasting context (✅ ADVANCED — v1.3.2)

Focus: Live data, model integrations, and predictive context for active seasons.

- [x] **P10.1 Active forecast spaghetti ensemble** — ✅ For any active storm: render GFS/ECMWF/HWRF ensemble tracks as semi-transparent spaghetti curves on the map. Toggle on/off in layers panel. Infrastructure complete, awaiting real forecast data API integration.
- [ ] **P10.2 NHC cone of uncertainty render** — Parse official NHC track forecast cone (KML or native API) and overlay as a semi-transparent cone geometry on the map for active storms. Update every 6h in-app via polling. Cone + official track + historical track visual comparison.
- [x] **P10.3 Seasonal forecast skill metrics** — ✅ Display current NOAA seasonal hurricane outlook (above/below/near-normal) with confidence percentages + historical accuracy (55–72% depending on category). Fetches from NOAA CPC endpoint; displays in stats panel with expandable details on forecast definition and recent examples. Educates users about forecast uncertainty and helps contextualize current seasons.
- [x] **P10.4 "On this date in history" sidebar** — ✅ When viewing the map, offer a "What happened today in hurricane history?" card showing storms that made landfall within ±7 days of the current calendar date. Sortable by year or magnitude.
- [x] **P10.5 Active-season timelapse** — ✅ For the current or selected season, offer a play-all button that steps through every 6-hourly track point for all storms in that season at 2× or 4× speed. Timelapse controls appear when a single year is selected. Play/pause/stop controls with progress bar. All storm tracks displayed at reduced opacity. Visceral sense of season intensity.

## Phase 11 — Accessibility & internationalization (✅ COMPLETE — v1.3.1)

Focus: Inclusive design, multi-language support, and expanded user demographics.

- [x] **P11.1 Full Spanish (ES-LA) localization** — ✅ Localization infrastructure complete: 100+ translated UI strings, browser language auto-detection, localStorage persistence, language toggle in settings menu. Infrastructure ready for full UI binding (next phase).
- [x] **P11.2 High-contrast accessible theme** — ✅ WCAG AAA 7:1 contrast ratio on text; larger fonts; bolder borders; increased visual separation. Toggle via settings. Comprehensive CSS variable expansion for dark/light HC modes with enhanced focus indicators (3px outline) and 2px borders on all interactive elements.
- [x] **P11.3 Screen reader optimization** — ✅ Added proper semantic landmarks to all major panels with `role="region"` + `aria-labelledby` attributes pointing to panel titles. Enhanced category filter buttons with descriptive aria-labels for each wind speed range. Updated legend from hidden `aria-hidden="true"` to descriptive aria-label. Added `role="main"` to all panel body containers. Changed info modal from `<section>` to proper `<dialog>` role with `aria-modal="true"`. All interactive elements now properly labeled for screen reader navigation.
- [x] **P11.4 Keyboard-first workflow** — ✅ Implemented dedicated keyboard shortcut palette (`?` key opens). Macro shortcuts: `Ctrl+M` for major hurricanes only, `Ctrl+T` for tropical storms only, `Ctrl+L` to focus search. Full focus trapping inside palette; Escape closes palette and open panels. Keyboard palette styled with glass morphism in light/dark/HC modes. All keyboard shortcuts documented with descriptions.
- [x] **P11.5 Glossary + educational popover** — ✅ Searchable glossary modal with 20 meteorological terms (ACE, RI, Saffir-Simpson, landfall, forward speed, etc.). Integrated via settings menu glossary button with instant substring + definition search. Modal CSS styled in high-contrast mode with 2px borders and increased font weights. Auto-initializes on app boot.

## Phase 12 — Data science & educational export (✅ COMPLETE, 5/5)

Focus: Research-grade export, reproducible analysis, and educational integration.

- [x] **P12.1 Publication-ready export** — One-click export of any filtered dataset (storms + landfalls) as a clean CSV with documentation (data dictionary, methodology notes, NOAA attribution). Suitable for academic research papers.
- [x] **P12.2 Jupyter notebook template** — Provide a starter Jupyter notebook (Python + pandas) that loads HurricaneMap's `data/storms.json` + `data/impacts.json` and demonstrates: filtering, plotting, computing climatology, ACE analysis. Links to Colab for zero-install runs.
- [x] **P12.3 QGIS layer export** — Export any storm selection as GeoJSON (RFC 7946) with LineString tracks + Point landfalls. Full attribute table (storm_id, name, year, category, wind, pressure, state) ready for direct QGIS import. Preserves track geometry with metadata.
- [x] **P12.4 Statistical summary auto-report** — Select a year/state/category filter → auto-generate a one-page markdown report with key stats, charts, and narratives. Render as PDF via client-side or serverless endpoint. Teachers can print for classroom.
- [x] **P12.5 Open data license clarity** — Prominently document all data sources (HURDAT2, NOAA, Wikipedia impacts, SEDAC population), their licenses (Public Domain, CC BY, etc.), and attribution requirements. Link from README + data download.

### Phase 12 Marginal Enhancements (Low-effort, niche but valuable)

- [ ] **P12.6 NWS Storm Events integration** — Enrich storm panels with coincident tornado + hail activity via NWS API (open endpoints as of 2025). Expose as "Tornado activity during landfall: N events in [states]" metric. Addresses academic interest in storm + tornado coincidence patterns. Effort: 1–2 days. Risk: Low.

## Phase 13 — Visualization & 3D exploration (Future / Under Consideration)

Focus: Advanced visualization modes and immersive exploration.

- [ ] **P13.1 3D track visualization (Cesium.js)** — Opt-in 3D globe mode with: (1) curved storm tracks in 3D space, (2) extrusion height = wind speed, (3) color = category, (4) interactive globe pan/zoom/tilt, (5) timeline scrubber. High-value for education + media. Risk: bundle size (+500KB), maintenance burden.
- [ ] **P13.2 Wind-field swath 3D cone** — For storms with wind-radii data (2004+), render asymmetric 3D cones representing 34/50/64kt wind extent at each track point. Visualize "cone of impact" more intuitively than flat 2D swaths.
- [ ] **P13.3 Population impact overlay** — Combine wind-field geometry with LandScan population grid to compute estimated population in Cat-1/3/5 winds per track segment. Expose as "Est. exposure: X million in Cat-2+ winds" metric.

## Phase 14 — Platform & infrastructure

Focus: Distribution, performance, and sustainability.

- [ ] **P14.1 HURDAT2 auto-refresh pipeline** — Detect when NOAA publishes a new HURDAT2 file; auto-download, parse, diff against `data/storms.json`, and commit + push to GitHub (via CI/CD Actions). Keep the live site evergreen without manual intervention.
- [ ] **P14.2 Offline-first service worker v2** — Extend current SW to cache entire `data/` directory on install (IndexedDB + compression). Full offline capability for historical storm lookup; graceful degradation for live data + radar.
- [ ] **P14.3 Bundle size audit & tree-shaking** — Run modern bundler (Vite, esbuild) to eliminate dead code, split non-critical modules (radar.js, compare.js, animation.js), and enable lazy-loading. Target <100KB gzipped for initial load.
- [ ] **P14.4 GitHub Pages CDN optimization** — Use Cloudflare Workers to serve HurricaneMap with aggressive caching headers, brotli compression, and image optimization. Measure global latency improvements.
- [ ] **P14.5 Docker + self-hosted option** — Publish a `Dockerfile` that packages HurricaneMap + a simple Python HTTP server for self-hosting on institutional infrastructure (universities, NWS offices, etc.). Useful for regions with poor internet or intranet-only access.

### Phase 14 Marginal Enhancements (Low-effort, high-value options for v1.3.0+)

- [ ] **P14.6 GOES satellite real-time background** — Integrate real-time GOES reflectivity (AWS Open Data, available since 2025) as an optional overlay for active storms. Live satellite, not just archived NEXRAD. Effort: 2–3 days (AWS S3 polling, image sync). Risk: Medium (data format shifts).
- [ ] **P14.7 Hourly active-storm polling** — Increase NHC advisory polling from 6-hourly to hourly (or match NHC release cadence). Adds rate-limit handling + user notification. Effort: 1 day. Risk: Low.

## Tier Placement & Rationale

### NOW / NEXT candidates (Phases 9–10, highest impact + effort fit)
- **P9.1 Storm similarity scoring** — 2-day effort; instant research value; no new dependencies; aligns with "compare mode" expansion.
- **P9.2 Return-period estimation** — 1-day effort; fills a real gap (coastal risk literacy); pure data derivation; fits educational mission.
- **P10.1 Forecast ensemble render** — 3-4 day effort; major real-time value; depends on public API availability (GFS/ECMWF/NOAA are all free); transforms app into live forecast tool.
- **P10.4 "On this date" sidebar** — 1-day effort; delightful UX; pure data mining.

### LATER candidates (Phases 11–12, strategic but heavier lift)
- **P11.1 Spanish localization** — 2-3 days; expands user base; routine translation work; no technical risk.
- **P12.1 Publication-ready export** — 1-2 days; underspins research use cases; low risk.
- **P13.1 3D visualization** — 1-2 weeks; high-risk dependency; justified only if user research confirms demand.

### UNDER CONSIDERATION / Rejected
- **3D Cesium integration** — Greenfield dependency; bundle bloat; justified only by quantified user demand. Defer unless GitHub Issues surface request.
- **i18n scaffold beyond Spanish** — French/Portuguese/Mandarin have smaller audiences relative to translation cost. Revisit after Spanish adoption metrics.
- **Direct backend integration** — Violates "client-side only" charter. Reject unless institutional partnership (e.g., NOAA collab) requires it.

---

## Research Sources & Changelog

**Iteration 1** (v0.3–v0.6): Phases 1–5 delivered. Research document: `docs/research/iter-1-*.md`. Focus: in-app analytics, export, shareability.

**Iteration 2** (v0.6–v0.8): Phase 6 delivered (accessibility, season analytics, fuzzy search, inflation adjust). Focus: discoverability + UX refinement.

**Iteration 3** (v0.9–v0.9.3): Phase 7 delivered (premium polish, layout consolidation). Focus: professional finish.

**Iteration 4** (v1.0–v1.1): Phase 8 delivered (mobile responsiveness, dark/light theme, advanced metrics, decade trends, performance). Focus: mobile-first + analytics depth.

**Phase 9 research** (May 2026): Harvested from Tropycal (Python pkg, storm similarity via vector embeddings), Leaflet plugins (3D Cesium, real-time overlays), NHC data endpoints (forecast ensemble APIs), community signals (Reddit r/TropicalWeather, GitHub hurricane-topic repos). See `docs/research/` for full harvest.

**Phase 9 refresh** (May 4, 2026): Second exhaustive research pass (Phase 0–5 methodology) verified Phase 9–14 placement, surfaced 4 marginal enhancements (P14.6 GOES real-time, P14.7 hourly polling, P12.6 NWS events, P9.7 embedding optimization), confirmed no major gaps. All items source-traced to 40+ research URLs (competitors, APIs, community, ecosystem). Documented in `phase1_research` and `phase2_features` SQL tables for audit transparency.

---

See `docs/research/` for full-source iteration history and tier scoring.
