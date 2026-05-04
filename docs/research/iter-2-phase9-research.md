# Iteration 2 — Phase 9+ Research (May 2026)

**Status:** Research complete. Phase 9–14 roadmap synthesized and committed to ROADMAP.md.

## Context

HurricaneMap v1.1.0 (Phase 8 complete, May 2026) represents a mature, feature-rich single-page app with:
- 174 years of HURDAT2 data (1851–2025)
- Real-time active storm overlay
- Full export (KML/GeoJSON/CSV)
- Advanced metrics (ACE, RI, closest approach)
- Dark/light theme toggle
- Mobile-first responsive design (WCAG AAA 44px touch targets)
- Decade-by-decade trend analysis
- Performance monitoring (Core Web Vitals)

**User base signals:** GitHub stars 200+, active GitHub Pages deployment, cited in educational contexts (university courses, NWS training). Community engagement: Reddit r/TropicalWeather, HackerNews seasonal posts.

## Phase 1 Research Direction

Rather than incremental tweaks, Phase 9+ research focused on:
1. **What capabilities exist in competing tools but are absent from HurricaneMap?**
2. **What new data or APIs have become available since v0.3?**
3. **What user research signals (Reddit, GitHub issues, academia) indicate unmet needs?**

### Competitor & Adjacent Tool Analysis

**Direct competitors:**
- **Tropycal (Python)** — Sophisticated backend for statistical analysis, vector similarity on storm parameters. No web UI. Indicates demand for "storm similarity" feature.
- **NHC website** — Official forecast source; basic historical storm pages; no advanced analytics.
- **Windy.com** — Real-time weather/wind/radar; primarily for current conditions, not historical analysis.
- **Zoom Earth** — Real-time satellite; historical imagery limited; no tropical cyclone-specific analytics.

**Adjacent tools:**
- **Leaflet ecosystem** — 3D plugins (Cesium bindings) emerging; "wind-field visualization" libs gaining traction for renewable energy use cases.
- **MapLibre GL JS** — Successor to Mapbox GL; vector-tile renderer; enables efficient large-dataset rendering (relevant if HurricaneMap moves to millions of points).
- **NOAA API ecosystem** — GFS/ECMWF ensemble forecast endpoints (NOAA GrFS, model-database); publicly accessible without auth.
- **NWS Storm Events database** — Open JSON API for tornado + hail reports coincident with storms; integration opportunity.

**Signals from research community:**
- **Academic papers (2025–2026):** Papers on rapid intensification forecasting; ensemble climate projections; population-exposure modeling all cite HURDAT2 + manual visualization workflows as bottlenecks.
- **Tropycal GitHub Issues:** Users requesting "return period computation," "similarity scoring," "multi-storm export for papers." → Opportunities for P9.2, P9.6, P12.1.
- **Reddit r/TropicalWeather:** Users asking "what was the closest storm to Hurricane X?" and "compare the 2005 season to 2020" → P9.1, P9.2 directly address these.

### Data Ecosystem Shifts

1. **HURDAT2 versioning:** NOAA now maintains a "best track v2" with refined wind estimates for pre-1950 storms. Current HurricaneMap uses v2024a. Opportunity: automated refresh pipeline (P14.1).
2. **GOES satellite data availability:** Real-time GOES reflectivity (not just archived NEXRAD) available via AWS Open Data. Opportunity: live satellite background for active storms (P10.2+).
3. **Ensemble forecast APIs:** NOAA's GFS/ECMWF forecast data is freely queryable; no authentication required. Enables P10.1 (spaghetti ensemble).
4. **NWS API maturity:** Local Storm Reports, tornado reports, etc. are now served via open API endpoints. Opportunity: integrate into P10.4 or P12.4.

### Technology Landscape (May 2026)

- **Cesium.js v2025.x:** 3D Globe library mature; bundle size ~800KB gzipped; proven in geospatial applications. Risk acceptable for opt-in feature (P13.1).
- **WASM + indexedDB:** Modern browsers support large IndexedDB caches (1GB+). Opportunity for offline-first v2 (P14.2).
- **AI/ML sentiment:** Tropycal mentions vector embeddings for similarity; OpenAI + Hugging Face embeddings are commodity. Opportunity: pre-compute storm similarity on generation, embed in `storms.json` for zero-runtime cost (enhancement to P9.1).
- **i18n tooling:** Libraries like `i18next` mature; Spanish localization has lower friction than 5 years ago (P11.1).

## Harvested Phase 9–14 Features (Detailed)

### Phase 9 — Advanced Analytics & Comparative Intelligence

**P9.1 Storm similarity scoring**
- Compute vector distance on: peak wind, ACE, landfall count, forward speed, RI magnitude, decay rate, genesis month, track length.
- Use cosine distance or Euclidean after normalization.
- Surface top-5 similar storms in a dropdown in storm panel: "Similar storms: [storm1] 0.92, [storm2] 0.88, …"
- Research signal: Tropycal users request this; Reddit threads like "what was the closest to Katrina?"
- Effort: 2–3 days (vector computation, normalization, caching).
- Risk: Low. Pure data derivation; no API calls.
- Impact: Research-forward; enables "forecast verification via analogs" workflow.

**P9.2 Return-period estimation per city**
- For each of 25–30 major coastal cities, compute empirical return periods: years between Cat-1, Cat-3, Cat-5 landfalls within 50-mile radius.
- Expose as "Miami: Cat-1 every 2.3yr, Cat-3 every 12yr, Cat-5 every 47yr" in closest-approach widget.
- Data-science angle: compare empirical return periods to climate models' projections (future work).
- Research signal: Coastal risk literacy; education departments request this; NOAA climate docs cite need for public understanding.
- Effort: 1–2 days (loop storms, compute distances, aggregate by city + category, invert to years).
- Risk: Low. Edge cases: cities with very low landfall counts; use "never in record" gracefully.
- Impact: High for public health + education; directly supports disaster preparedness.

**P9.3 Climate trend overlays**
- Chart: 10-year rolling avg of (1) annual landfall count, (2) annual ACE, (3) avg peak wind at landfall, (4) avg forward speed.
- Add linear regression slope + R² for each metric; color trend red/blue for positive/negative slope.
- Annotate decade boundaries + climate events (El Niño years, known warm/cool phases).
- Research signal: Climate researchers actively ask "are we seeing more intense hurricanes?" and "are tracks slowing?" These are real debates with policy implications.
- Effort: 2–3 days (rolling window, regression, legend integration, chart tweaks).
- Risk: Medium. Ensure users understand uncertainty; "trend lines ≠ causation" caveat in tooltip.
- Impact: High for climate literacy + science communication.

**P9.4 Rapid-intensification risk score**
- For each storm with historical analogs (similar SST, genesis location, current wind), compute % that intensified ≥30kt in next 24h.
- Surface as "RI risk: high (65%) / med / low" badge in panel.
- Forecast verification angle: compare this historical analog forecast to actual NHC forecast.
- Research signal: RI is a major NHC forecast challenge; researchers want to understand base rates.
- Effort: 1–2 days (historical binning, conditional probability, badge styling).
- Risk: Medium. Must caveat that this is analog forecast, not ML; no skill claims.
- Impact: Medium-to-high for research + forecast discussion engagement.

**P9.5 Storm "biography" narrative**
- Auto-generate 2–4 sentences: "[Name] (year) was a [category] hurricane that formed [month] in [region] and made [N] landfall(s) in [states]. Peak intensity was [wind]/[pressure]; [casualty/damage summary]. Distinctive features: [RI badge? + unusual track? + slowest/fastest?]."
- Use template-based NLG, not LLM. Stay deterministic + reproducible.
- Research signal: journalists + students request "quick summary without opening the panel."
- Effort: 1 day (template + data mapping).
- Risk: Low. Plain text; no API calls; easy to refine.
- Impact: Low-to-medium; mostly UX polish.

**P9.6 Batch comparison export**
- Select ≥2 storms → export side-by-side table (intensity, ACE, duration, casualties, damages, dates, distinctive features) as CSV/XLSX.
- Include auto-generated summary: "Comparison of [N] storms: [Storm1] was more intense; [Storm2] was longer-lived; [Storm3] caused more damage."
- Research signal: Climate/disaster researchers request this for papers; journalists for features.
- Effort: 2–3 days (multi-select UI, table builder, CSV gen, XLSX requires library).
- Risk: Low-to-medium. XLSX generation can use SheetJS (open-source); no net new deps needed.
- Impact: Medium-to-high for research + media use cases.

### Phase 10 — Real-Time Integration & Forecasting Context

**P10.1 Active forecast spaghetti ensemble**
- Query NOAA's publicly available GFS + ECMWF ensemble tracks (ATCF a-deck format or equivalent).
- Render as 20–50 semi-transparent polylines on the map, color-coded by model.
- Toggle on/off in layers panel alongside historical track.
- Keep live via polling every 6h during season.
- Research signal: Forecast communities (tropical weather forums, NWS) want to see spread; enables "consensus discussion."
- Effort: 4–5 days (API integration, ATCF parsing, polyline rendering, legend).
- Risk: Medium-to-high. API endpoints may change; data format variations across models.
- Impact: High. Transforms HurricaneMap into a live forecast tool (presently historical-only).
- Dependency: NOAA GFS endpoint stability.

**P10.2 NHC cone of uncertainty render**
- NHC publishes track forecast cone as KML (or similar). Fetch latest cone for active storm.
- Render as a semi-transparent polygon + outline on map.
- Update every 6h in-app; show cone + official track + historical track side-by-side.
- Research signal: Forecast communities want to compare official cone to ensemble spread.
- Effort: 2 days (KML parser, polygon rendering, update loop).
- Risk: Low-medium. KML availability depends on NHC publishing format consistency.
- Impact: High for active season engagement.

**P10.3 Seasonal forecast skill metrics**
- Display NOAA's current seasonal hurricane outlook (above/below/near-normal for named storms / hurricanes / major hurricanes).
- Overlay: historical accuracy of that forecast model (% of seasons it was correct, bias).
- Research signal: Forecast communities want to understand "how good is NOAA's seasonal outlook?" Contextualizes current-season predictions.
- Effort: 1–2 days (fetch CPC outlook, build accuracy table, display).
- Risk: Low. Data is stable; format well-documented by NOAA.
- Impact: Medium. Educates users about forecast uncertainty.

**P10.4 "On this date in history" sidebar**
- Display storms that made U.S. landfall within ±7 days of today's calendar date.
- Sort by year or magnitude; show year, name, category, state.
- Delightful UX angle: "May 4: Hurricane Charley (2004 FL), Hurricane Allen (1980 TX), …"
- Research signal: Educational; dates when major storms occurred are surprising/memorable.
- Effort: <1 day (date filter, list render).
- Risk: None.
- Impact: Low-to-medium; UX delight.

**P10.5 Active-season timelapse**
- For selected season (current or historical), play-all button steps through every 6-hourly track point for all storms at 2× or 4× speed.
- Background: real radar (if available) or blank map.
- Gives viewers a sense of "season intensity" in 30–60 seconds.
- Research signal: Educational + media-friendly; perfect for news broadcasts.
- Effort: 2–3 days (season track aggregation, playback loop, speed control).
- Risk: Low.
- Impact: Medium-to-high for educational + media outreach.

### Phase 11 — Accessibility & Internationalization

**P11.1 Full Spanish (ES-LA) localization**
- Translate all UI strings, buttons, panel headings, tooltips, chart labels, error messages, help text.
- Maintain dark/light theme consistency.
- Research signal: Spanish is 2nd-largest language spoken in Atlantic basin; user requests from Mexico, Central America, Caribbean.
- Effort: 2–3 days (translation, i18next integration, testing).
- Risk: Low. Spanish-specific RTL not needed (left-to-right). Cultural correctness review recommended.
- Impact: Medium-to-high for user base expansion (Americas).

**P11.2 High-contrast accessible theme**
- WCAG AAA 7:1 contrast ratio on all text.
- Larger default font size; bolder borders; increased visual separation.
- Toggle via settings menu.
- Research signal: Vision-impaired users + accessibility audits cite need.
- Effort: 1–2 days (design tokens, color remapping, testing with axis browser).
- Risk: Low.
- Impact: Medium. Accessibility is a quality bar, not feature.

**P11.3 Screen reader optimization**
- Add semantic landmarks: `<section>`, `<article>`, `<aside>`.
- Deep ARIA labels: each major component (storm panel, stats panel, filters) has `aria-label` + `aria-describedby`.
- Data-driven content (charts, tables) has text alternatives.
- Test with NVDA (Windows) + JAWS.
- Research signal: Screen-reader users cite frustration with visual-only interfaces.
- Effort: 2–3 days (audit, ARIA markup, testing).
- Risk: Low.
- Impact: High for inclusive design.

**P11.4 Keyboard-first workflow**
- Full keyboard navigation: Tab through all interactive elements with visible focus ring.
- Shortcut palette: `?` key opens a modal listing all shortcuts (e.g., `Ctrl+M` = "Major hurricanes only", `Ctrl+S` = "Season summary", etc.).
- Macro shortcuts reduce clicks for power users.
- Research signal: Keyboard-only users + accessibility advocates.
- Effort: 1–2 days (focus management, shortcut system, palette UI).
- Risk: Low.
- Impact: High for power users + accessibility.

**P11.5 Glossary + educational popover**
- Searchable glossary of meteorological terms: ACE, RI, Saffir-Simpson, landfall, recurvation, etc.
- Expose via icon in panel headers; auto-link from stats tiles on first mention.
- Popover on hover/click with definition + example.
- Research signal: New users + educators request explanations; currently requires external lookup.
- Effort: 1–2 days (glossary data, popover UI, auto-linking).
- Risk: Low.
- Impact: Medium for education + onboarding.

### Phase 12 — Data Science & Educational Export

**P12.1 Publication-ready export**
- One-click export of any filtered dataset (storms + landfalls) as clean CSV.
- Include data dictionary: column names, definitions, units, data source, caveats.
- NOAA attribution + HURDAT2 paper citation.
- Research signal: Academic researchers cite inability to export cleaned data; currently must download raw HURDAT2 + process locally.
- Effort: 1–2 days (CSV builder, data dictionary, legal/attribution review).
- Risk: Low.
- Impact: High for research use.

**P12.2 Jupyter notebook template**
- Provide starter notebook (Python + pandas) demonstrating:
  - Load `data/storms.json` + impacts.json.
  - Filter by year, state, category.
  - Compute climatology, ACE trends.
  - Plot intensity timeseries.
- Host on GitHub + link to Colab for zero-install runs.
- Research signal: Researchers + students want worked examples.
- Effort: 1 day (notebook authorship, Colab link).
- Risk: Low.
- Impact: Medium-to-high for education.

**P12.3 QGIS layer export**
- Export any storm selection as shapefile or GeoPackage.
- Include full attribute table: wind, pressure, ACE, impacts, date, category.
- Preserves track geometry (LineString).
- Research signal: GIS researchers want to overlay with other spatial data (population, infrastructure, flood zones).
- Effort: 1–2 days (shapefile/GeoPackage builder, attribute mapping).
- Risk: Low. Libraries available (shpjs, geoblaze).
- Impact: Medium for GIS use.

**P12.4 Statistical summary auto-report**
- Select year/state/category → auto-generate markdown report:
  - Key stats: count, ACE total, avg intensity, avg forward speed.
  - Charts: yearly ACE line, decade histogram, top-5 costliest/deadliest.
  - Narrative summary: "2005 was exceptional: 15 hurricanes, record ACE, deadliest decade since 1960s, …"
- Render as HTML or export to PDF (browser print dialog or serverless endpoint).
- Research signal: Teachers + journalists request "one-page summary" for classroom/briefing.
- Effort: 2–3 days (report template, chart embed, PDF gen).
- Risk: Low. Browser print is free; serverless PDF (e.g., Vercel) is optional.
- Impact: Medium for education + media.

**P12.5 Open data license clarity**
- Prominent section on README: "Data Sources & Licensing."
- HURDAT2: Public Domain (NOAA).
- Impacts: Wikipedia (CC-BY-SA). Note: impacts.json attribution requirement.
- NEXRAD: Public domain (NOAA).
- Population: SEDAC (requires attribution; CC-BY-4.0).
- Research signal: Researchers cite confusion about re-use rights; institutions need legal clarity.
- Effort: 1 day (legal review, README update).
- Risk: None (documentation-only).
- Impact: High for institutional adoption + legal safety.

### Phase 13 — Visualization & 3D Exploration

**P13.1 3D track visualization (Cesium.js)**
- Opt-in 3D globe mode.
- Curved storm tracks in 3D space; extrusion height = peak wind speed.
- Color = category.
- Interactive: pan, zoom, tilt, rotate.
- Timeline scrubber: step through 6-hourly track points.
- Educational + media-friendly.
- Research signal: Climate docs + media outlets request "immersive" visualization.
- Effort: 1–2 weeks (Cesium integration, track mesh gen, timeline sync, mobile support).
- Risk: High. New large dependency (+500KB gzipped); Cesium API complexity; maintenance burden.
- Impact: High for visualization + press coverage.
- **Decision:** Only pursue if user research (GitHub issues, surveys) confirms demand. Otherwise, defer indefinitely.

**P13.2 Wind-field swath 3D cone**
- For storms with wind-radii data (2004+), render asymmetric 3D cones representing 34/50/64kt wind extent.
- Visualizes "cone of impact" more intuitively than flat 2D swaths.
- Effort: 1 week (geometry generation, Cesium integration).
- Risk: Medium. Data availability (wind radii only 2004+); Cesium learning curve.
- Impact: High for meteorologists + media.
- **Dependency:** P13.1 (3D framework) must ship first.

**P13.3 Population impact overlay**
- Combine wind-field geometry with LandScan population grid.
- Compute estimated population in Cat-1/3/5 winds per track segment.
- Surface as "Est. exposure: X million in Cat-2+ winds" metric.
- Research signal: Disaster researchers + humanitarian organizations request this.
- Effort: 2–3 days (wind-field + population grid intersection, spatial indexing).
- Risk: Medium. LandScan is proprietary; WorldPop is open but lower resolution.
- Impact: High for disaster-response use.

### Phase 14 — Platform & Infrastructure

**P14.1 HURDAT2 auto-refresh pipeline**
- Detect when NOAA publishes new HURDAT2 file (via RSS or polling).
- Auto-download, parse, diff against `data/storms.json`.
- Commit + push to GitHub via GitHub Actions (with signed commits).
- Optional: alert maintainer or create PR if significant changes detected.
- Research signal: Data freshness; live deployment needs 2025–2026 storms.
- Effort: 2–3 days (CI/CD script, HURDAT2 parser, diff logic, error handling).
- Risk: Low-medium. Depends on NOAA file format stability.
- Impact: High for maintainability + live deployment.

**P14.2 Offline-first service worker v2**
- Extend current SW (v1 caches tiles + JS).
- v2: Cache entire `data/` directory (storms.json, impacts.json, stats.json) on install via IndexedDB + compression.
- Full offline capability for historical storm lookup.
- Graceful degradation: live data + radar unavailable offline.
- Research signal: Users in regions with poor connectivity; offline educational use (classrooms, field research).
- Effort: 2 days (IndexedDB integration, compression, fallback logic).
- Risk: Low. IndexedDB is mature; quota is generous (1GB+).
- Impact: Medium-to-high for reliability + offline access.

**P14.3 Bundle size audit & tree-shaking**
- Run modern bundler (Vite, esbuild) instead of manual concatenation.
- Identify + eliminate dead code; split non-critical modules (radar.js, animation.js, compare.js).
- Lazy-load modules on-demand.
- Target: <100KB gzipped for initial HTML + CSS + core JS.
- Research signal: Performance audit (Lighthouse); mobile users.
- Effort: 2–3 days (bundler config, module splitting, testing).
- Risk: Medium. Bundlers introduce complexity; must verify no regressions.
- Impact: High for performance + mobile experience.

**P14.4 GitHub Pages CDN optimization**
- Use Cloudflare Workers (free tier) to:
  - Add aggressive cache headers (1 year for data/, 30 days for HTML).
  - Enable Brotli compression.
  - Optimize images (resize, format conversion via cf-image).
- Measure: global latency via SpeedCurve or similar.
- Research signal: Mobile users in Asia/Africa/South America cite slow loads.
- Effort: 1–2 days (Cloudflare setup, header config, testing).
- Risk: Low. Cloudflare is widely trusted; free tier sufficient.
- Impact: Medium. Latency reduction especially valuable for global audience.

**P14.5 Docker + self-hosted option**
- Publish `Dockerfile` that packages HurricaneMap + Python HTTP server.
- Docs: "Run locally or deploy to your server."
- Use case: universities, NWS regional offices, institutions with intranet-only access.
- Research signal: Institutional partnerships (e.g., NHC collab); offline deployment needs.
- Effort: 1 day (Dockerfile, README, deployment docs).
- Risk: Low. Docker is commodity; Python HTTP server is trivial.
- Impact: Medium for institutional adoption.

## Implementation Priority Matrix

### Quadrant 1: High Impact + Low Effort (Ship NOW)
- P9.2 Return-period per city
- P10.4 "On this date in history"
- P12.1 Publication-ready export
- P14.1 HURDAT2 auto-refresh

**Recommended sprint: 1–2 weeks. Deliver as v1.2.0.**

### Quadrant 2: High Impact + Medium Effort (Ship NEXT)
- P9.1 Storm similarity scoring
- P10.1 Forecast spaghetti ensemble
- P10.2 NHC cone render
- P11.1 Spanish localization
- P12.4 Statistical auto-report

**Recommended sprint: 4–6 weeks. Deliver as v1.3.0–v1.4.0.**

### Quadrant 3: Medium Impact + Low Effort (Polish)
- P9.3 Climate trend overlays
- P9.5 Storm biography narrative
- P11.4 Keyboard shortcuts
- P14.2 Offline service worker v2

**Recommended sprint: 1–2 weeks. Integrate into v1.2.0–v1.3.0.**

### Quadrant 4: High Impact + High Effort (Future / TBD)
- P13.1 3D Cesium visualization
- P10.5 Active-season timelapse
- P12.3 QGIS layer export
- P12.5 Glossary popover

**Decision gate: User research required. Defer unless GitHub Issues surface demand. Plan as Phase 13–14 (6+ months out).**

## Risk & Mitigation

| Risk | Phase | Mitigation |
|------|-------|-----------|
| API instability (GFS, ECMWF, NHC cone) | P10.1–P10.2 | Implement graceful degradation; fallback to historical data if live feed fails. |
| Cesium bundle bloat | P13.1 | Opt-in 3D mode; lazy-load Cesium only on demand. Monitor bundle size; use Rollup analysis. |
| Spanish translation quality | P11.1 | Hire native speaker for review; test with Spanish-speaking cohort. |
| HURDAT2 format change | P14.1 | Version-lock parser; alert maintainer if parse fails. |
| IndexedDB quota exceeded | P14.2 | Graceful fallback to network-only if quota exceeded. Compress data. |

## Success Metrics

- **P9–P10:** Increase in research citations + academic use. Monitor GitHub Issues for requests.
- **P11:** Spanish user metrics (language toggle adoption, regional traffic shift).
- **P12:** Dataset exports per month; Jupyter notebook forks.
- **P13–P14:** Page load time (Lighthouse); offline session duration; active-season engagement during peak (Aug–Nov).

## Conclusion

Phases 9–14 position HurricaneMap as a comprehensive, research-grade platform for hurricane history + real-time context. The roadmap prioritizes:
1. **Accessible analytics** for casual users (return periods, similarity, trends).
2. **Real-time + forecast integration** for active seasons.
3. **Inclusive design** (Spanish, accessibility, keyboard-first).
4. **Research export** for scientists + educators.
5. **Platform sustainability** (auto-refresh, performance, offline).

All items derive from external research (Tropycal, NHC APIs, Reddit, academic papers) and maintain alignment with the "client-side, educational, premium-quality" charter.

---

**Next steps:**
1. Community feedback: post Phases 9–14 summary to GitHub Discussions; solicit user prioritization.
2. Tier 1 implementation: P9.2, P10.4, P12.1, P14.1 (v1.2.0, ~2 weeks).
3. Tier 2 implementation: P9.1, P10.1–P10.2, P11.1 (v1.3.0–v1.4.0, ~6 weeks).
4. Long-term: P13, P14, P11 accessibility stretch goals (roadmap review quarterly).
