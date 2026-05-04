# Changelog

All notable changes to HurricaneMap.

## Unreleased

## v0.9.0 — Premium polish pass (2025)

System-level UX/UI refinement layered on top of the existing surfaces. No behavioral changes, no API changes — just a noticeable lift in how the product feels.

- **Token system extended.** New motion (`--hm-ease-standard`, `--hm-ease-emphasized`, `--hm-dur-fast/base/slow`), elevation (`--hm-elev-1..4`), border (`--hm-border-soft/default/strong`), and a single-source-of-truth focus ring (`--hm-focus-ring`).
- **Universal focus-visible.** All interactive elements now share one calm, properly-offset focus ring — no more drift between buttons, inputs, links, and `[tabindex]` surfaces.
- **Branded scrollbars.** Slim, lavender→sapphire gradient thumb that brightens on hover. Both Firefox (`scrollbar-width: thin`) and WebKit.
- **Selection color** matched to the brand palette without being loud.
- **Header lift.** Subtle elevation-3 shadow + inner top highlight; brand mark gets a soft glow on hover (scale + drop-shadow) for a premium first touchpoint.
- **Icon buttons normalized.** Consistent hover (translate-y -1px + lavender-tinted bg/border), consistent active (snap back, 60ms), consistent pressed/expanded states via `aria-pressed` / `aria-expanded`.
- **Storm panel section headings** now lead with a 3px lavender→sapphire accent bar, giving each section a clear, intentional anchor without adding visual noise.
- **CAT pill** picks up an inner top-highlight + soft drop-shadow so it reads as a real badge rather than a flat chip.
- **Stat tiles** gain a hover state (slight lavender wash + border lift) and a base elevation-1 shadow — communicates interactivity where it exists and seats them visually where it doesn't.
- **Search results** animate in with a 200ms fade-down; selected/hovered rows shift right 4px for clearer affordance.
- **Settings menu** uses the same fade-down + elevation-4 shadow; pill hover gets a 1px lift; `aria-checked` / `data-active` / `.active` all map to the same selected style.
- **Compare tray chips** lift on hover for consistency with the rest of the system.
- **Loading screen** now fades out cleanly instead of disappearing abruptly.
- **Leaflet zoom** picks up the same hover-lift idiom; attribution links use brand lavender.
- **Timeline ribbon** gets elevation-2 + an inner highlight; selection band picks up a sapphire→lavender gradient with a soft outer glow.
- **Onboarding overlay** + **info modal** both get smoother entrance animations (fade + subtle scale on the modal card).
- **Reduced motion** respected: all animations + transitions + hover transforms collapse to ~0ms when the user prefers reduced motion.
- **Service worker bumped** to `hm-v0.9.0` so the polish reaches every existing PWA install.

## v0.8.1 — Accessibility 100 / Lighthouse pass (2025)

Closes Phase 6 (10/10) by closing P6.10. Real `npx lighthouse --preset=desktop` run on v0.8.0 produced an Accessibility score of 87. v0.8.1 lands at **100**.

- **Onboarding dialog accessible name (P6.10).** `.onb-overlay` now sets `aria-labelledby` to the title `<h3>` and `aria-describedby` to the body `<p>`, satisfying `aria-dialog-name`.
- **Year-range inputs labeled (P6.10).** `#year-min` / `#year-max` get explicit `aria-label`s (the visible "Year range" label was for the group, not each input).
- **Heading order fixed (P6.10).** The map legend heading is now `<h2 class="legend-heading">` (was `<h3>`); CSS selectors rewritten from `.legend h3` to `.legend .legend-heading` in three places. Page heading order is now `h1 → h2 → h3` everywhere.
- **Timeline slider live state (P6.10).** `#timeline-axis` (role=slider) now ships with `aria-valuenow` + `aria-valuetext` initialised to the full range and updated on every drag/keyboard step inside `drawSelection()`. Also gains explicit `tabindex="0"`.
- **Service worker bumped** to `hm-v0.8.1` so the v0.8.1 a11y fixes propagate through the PWA cache.

## v0.8.0 — Inflation-adjusted damages, annual climatology chart (2025)

Two more Phase 6 items, both data-density wins for the comparative-history use case.

- **Inflation-adjusted damage toggle (P6.5).** New "Damage figures" pill group in the settings menu — Nominal vs 2024 USD. Backed by an inline BLS CPI table (1850–2024) in `src/inflation.js`. Storm panel impacts block now shows the adjusted figure with the nominal value as a small parenthetical hint. Season summary's "costliest" superlative ranks fairly across eras when 2024 USD is selected (so the 1900 Galveston hurricane finally wins on real-dollar damage instead of getting buried under modern nominal totals). Defaults to 2024 USD; persists to localStorage and re-renders any open storm panel + season card on change.
- **Annual climatology chart (P6.8).** New multi-line SVG chart added to the stats panel showing yearly ACE (Accumulated Cyclone Energy), named-storm count (≥34kt peak), and US-landfall count from 1851 to present. Top 3 ACE seasons annotated with vertical guide lines and year labels (2005, 2017, 2020 typically). Multi-color legend matches the existing palette CSS-vars so the colorblind toggle propagates. Computed once on first stats-panel open and cached for the session — reading the full storms-min cache is the heavy step (~3000 storms, sub-second).
- **Internals.** Two new modules: `src/inflation.js` (CPI table + `inflateUSD()` + `formatMillionsUSD()`) and `src/climatology.js` (per-year aggregation + SVG chart renderer). Both added to SW SHELL_ASSETS. Service worker bumped to `hm-v0.8.0`. New `damageMode` setting added to `DEFAULTS` with `hm-settings:change` event propagation.

## v0.7.0 — Season summary, fuzzy search, print stylesheet, history dropdown, reduced-motion (2025)

Phase 6 advance — the search box gets smarter, the year filter gets richer, the app prints cleanly, and motion-sensitive users get an honest reduced-motion path.

- **Season summary card (P6.3).** Narrow the year filter to a 1–3 year window and a glassmorphic summary card surfaces beside the legend. Shows total named storms, total US landfalls, total ACE (Accumulated Cyclone Energy), landfall count broken out by Saffir-Simpson tier (TS / C1–C5), strongest landfall, deadliest, and costliest storm. The synchronous half (counts + tiers + strongest) renders instantly; ACE and impact superlatives async-resolve once the storm-track cache warms. Auto-hides outside the 1–3 year window; closable with the × button.
- **Fuzzy / typo-tolerant search (P6.4).** Type "Catrina" and you'll get Katrina under a "Did you mean…" divider. Levenshtein ≤2 fallback layer activates when the literal substring search returns fewer than 5 hits and the query is 4+ characters. Ranks suggestions by edit-distance ascending, year-recency descending. Caps at 5 fuzzy results so it never shadows literal matches.
- **Storm-name history dropdown (P6.7).** Focus the empty search box and your last 8 viewed storms surface as a "Recently viewed" dropdown. Same row template as live results — sparklines included, back-filled once the track cache warms. Persists across reloads via `localStorage` (`hm-search-history-v1`).
- **Print stylesheet (P6.6).** `@media print` rules collapse all chrome (header, legend, leaflet controls, timeline ribbon, FABs, settings menu, onboarding overlay, toasts, season card itself). The map prints as the last-rendered tile snapshot at 60vh; if a storm panel is open it gets promoted below the map at full-width with black-on-white styling and chart `page-break-inside: avoid`. Tile attribution stays visible per OSM/CartoDB licensing.
- **Reduced-motion full pass (P6.9).** Single `@media (prefers-reduced-motion: reduce)` block at end of styles.css clamps every `animation-duration` and `transition-duration` to 0.01ms (state changes still register) and disables named animations entirely on toasts, onboarding cards, the install prompt, season summary, panel action buttons, search-result rows, tier blocks, legend items, and timeline bars. Brings every v0.6.x surface into compliance — previously only toast and onboarding honored the preference.
- **Internals.** Three new modules: `src/season.js` (summary card lifecycle + aggregation), `src/fuzzy.js` (Levenshtein), `src/search-history.js` (localStorage-backed view history). All wired through the existing `applyFilters` + search-input handler in `main.js`. Service worker bumped to `hm-v0.7.0`; new modules added to `SHELL_ASSETS` for offline parity.

## v0.6.1 — Search sparklines + accessibility pass (2025)

A small but focused polish ship on top of v0.6.0. Phase 6 opens with two items.

- **Storm intensity sparklines in search results (P6.1).** Every search result row now carries a 64×18 inline SVG sparkline of the storm's wind-over-time profile, color-coded by peak Saffir-Simpson tier. Long-lived Cat-5s (Allen 1980, Patricia 2015) read instantly as a tall, sustained mound; brief tropical storms read as a short bump. Storm tracks are warmed on search-input focus so the sparks paint as you type. Honors the colorblind palette via the same CSS-var pipeline as the rest of the app.
- **Accessibility pass on v0.6.0 surfaces (P6.2).** Settings menu now closes on `ESC` and returns focus to the cog button. Search-result list items get `role="option"` for assistive tech. New focus-visible rings on the settings pills, replay-tour button, cog, and days-at-intensity bar segments. Shimmer placeholder for sparklines respects `prefers-reduced-motion`.

### Under the hood

- New `src/sparkline.js` module — pure-SVG, ~50 lines, no deps.
- `src/data.js#searchStorms` results retain `storm_id` so the sparkline back-fill can look up tracks via the warmed `stormsById` map.
- Search-result render path is now two-pass: text rows render synchronously (instant), sparklines back-fill from the resolved `ensureStormsLoaded()` promise. The shimmer placeholder fills the gap when the cache is cold.

## v0.6.0 — PWA, palette, units, timeline, days-at-intensity, chart export, onboarding (2025)

Closes Phase 5 of the research roadmap. Seven new features land together as a single coherent release: the app is now installable, color-blind-accessible, unit-aware, time-aware (174-year ribbon at the bottom of every view), and shareable (export the intensity chart as PNG/SVG for social media).

- **Days-at-intensity bar (P5.3).** New panel section after closest-pass: stacked horizontal bar showing hours spent at TD / TS / Cat-1 / Cat-2 / Cat-3 / Cat-4 / Cat-5 with day labels and percentage tooltip. Total tracked days printed below. For Katrina you can read at a glance that it spent 1.0 day at Cat-3 and roughly 12 hours at Cat-5 before the Mississippi landfall.
- **First-run onboarding (P5.4).** 4-step coachmark tour with a spotlight cutout (header → filters → stats button → info button). Skip / Back / Next / ESC keyboard. `localStorage.hm-settings-v1.onboarded` flag prevents re-firing. "Replay welcome tour" button in the new settings menu.
- **Color-blind palette (P5.5).** ColorBrewer YlOrRd 7-class sequential palette for Saffir-Simpson categories — designed to remain perceptually-ordered for protanopia, deuteranopia, and tritanopia. CSS-var-driven so map dots, the intensity chart bands, panel pills, days-at-intensity bar, and timeline ribbon swap atomically. Toggle via settings cog.
- **Wind-unit toggle (P5.6).** Settings menu pill group (kt / mph / km·h). Persisted to `localStorage`. Propagates to peak-wind stat (with secondary unit in parens) and closest-pass approach speed. Default remains knots — the operational meteorology unit.
- **PWA install (P5.7).** `manifest.webmanifest` + new `sw.js` service worker. Stale-while-revalidate for HURDAT2 JSON (works offline once visited), cache-first for CartoDB / OpenStreetMap tiles, shell precache (HTML + every `src/*.js` + styles) on install. Versioned cache name (`hm-v0.6.0`) — old caches are dropped on activate.
- **174-year timeline ribbon (P5.8).** Persistent horizontal ribbon at the bottom of the viewport (collapsible). One vertical bar per year, height encoded by landfall count, color encoded by strongest category that year. Click → set year filter to that year; drag across multiple years → set range. Highlights currently-active year-range filter visually so the entire historical sweep is always one glance away.
- **Chart PNG / SVG export (P5.9).** Two new buttons under every storm's intensity-over-time chart. PNG path serializes the live SVG, rasterizes it to canvas at 2× scale with embedded font and Catppuccin background, and saves via `Blob` → object URL. SVG path inlines styles into a standalone XML for vector-perfect Twitter/Mastodon shares.
- **Settings menu.** New cog button in the header opens a compact glass dropdown with palette / wind-unit / replay-tour controls. Click-outside dismissal. All preferences emit a `hm-settings:change` event so any module (markers, panel, chart, timeline) can react.

### Under the hood

- New modules: `src/settings.js` (typed prefs store + `formatWind` + `applyPaletteToBody`), `src/onboarding.js`, `src/timeline.js`, `src/chart-export.js`, `sw.js`.
- `src/data.js#categoryColor` now delegates to `getPaletteColor()` so every renderer (Leaflet circles, chart.js bands, panel badges) honors the active palette without re-render branching.
- `src/metrics.js#daysAtIntensity(track)` computes hour buckets per Saffir tier, honoring observation cadence (3-h vs 6-h) so partial last-segments don't double-count.
- Service worker registration is gated to `https:` and `localhost` — `file://` and other origins skip silently to avoid console noise during local development.
- Zero new dependencies. Still pure-static GitHub Pages, ES modules, no build step.

## v0.5.0 — Pressure-fall, forward speed, share button (2025)

Three more Tier-2 metrics from the research roadmap, plus a long-overdue share button to leverage the v0.4.0 permalinks.

- **Explosive-deepening flag (P5.1).** Detects ≥20 mb pressure drop in any 24-hour window — the operational shorthand for "explosive deepening". Surfaces as an orange/red "📉 Explosive deepening (−XX mb / 24h)" pill alongside the rapid-intensification badge. For Katrina the panel now shows BOTH flags (+50 kt wind / −46 mb pressure), capturing the wind-speed AND pressure-fall sides of the same Aug-28 deepening event. Wilma 2005 (−95 mb / 24h) and Patricia 2015 (−100 mb / 24h) are visible on the chart and in the badge.
- **Average forward speed (P5.2).** New stat tile computing time-weighted mean translation speed in km/h (and mph). Hover tooltip shows peak forward speed and total stalled-hours (<10 km/h, the conventional flood-disaster threshold for Harvey 2017 / Dorian 2019). Skips track gaps >12 h to avoid spurious teleport-segment speeds.
- **Share button (P5.10).** "🔗 Share view" button copies the current permalink (filters + opened storm + opened state, encoded in `location.hash`) to the clipboard with a toast confirmation. Falls back to a hidden `<textarea>` + `execCommand('copy')` on non-secure contexts so it works on plain HTTP previews.
- **Toast component.** New unobtrusive bottom-center toast pattern (220 ms spring-in, 2.2 s dwell, 240 ms fade-out, `role=status`/`role=alert`, full `prefers-reduced-motion` honor) — reusable for future copy/save/restore confirmations.

## v0.4.0 — Storm metrics + permalinks (2025)

Five Tier-1 features from the research-driven roadmap, all client-side, no new dependencies.

- **Accumulated Cyclone Energy (ACE).** New stat tile in the storm panel computing Σ(v² / 10⁴) over 6-hourly synoptic obs ≥ 34 kt — the standard NHC measure of total wind-energy output across a storm's life. Shows alongside peak wind and min pressure with a definition tooltip (Atlantic season ≈ 100, single major hurricane ≈ 10–30; Katrina = 20.0).
- **Rapid intensification flag.** Detects ≥30 kt wind gain in any 24-hour window per the NHC definition. Surfaces as a pink "⚡ Rapid intensification (+XX kt / 24h)" pill at the top of the storm panel and as a red-tinted overlay segment on the intensity chart with an inline "⚡ RI +XX kt" label so the explosive-deepening window is visible at a glance.
- **Closest pass to coastal city.** New panel row with a dropdown of 25 hand-curated U.S. coastal cities (Boston → Brownsville on the Atlantic/Gulf, plus Honolulu and San Juan). Computes a haversine-shortest-distance to the nearest track point and shows distance (mi + km), wind at that point, and timestamp. Auto-defaults to a city in the storm's first U.S. landfall state, so opening Katrina lands on Miami / opening Andrew lands on Miami / opening Iniki lands on Honolulu.
- **URL permalinks.** Filters, opened storm, and opened state now serialize to `location.hash` and restore on cold load. Format: `#y=2000-2025&c=3,4,5&s=Florida&storm=AL122005`. Shareable links reproduce the exact view another user clicked.
- **Track export.** New "Export track" row offers one-click CSV (spreadsheet-friendly, full HURDAT2 columns), GeoJSON FeatureCollection (LineString + Point features for QGIS / Mapbox / Leaflet), and KML (Google Earth / ArcGIS, with track styled in sapphire and donut-icon landfall pins). All client-side via `Blob` + synthetic `<a download>` — no server round-trip.
- **Research artifacts.** New `docs/research/iter-1-*.md` capture the five-phase roadmap research protocol — repo recon, 92-item harvest, six-dimension tiered scoring with rejection reasoning, and a seven-dimension self-audit. Future iterations replenish from this baseline.

### Interactive surfaces polish — v0.3.1

- **Storm panel internals.** Section headings (`Landfalls`, `Track`, `Intensity over time`, etc.) now read as proper SECTION LABELS — uppercase, 0.09em tracked, with a 3px lavender→sapphire gradient bar on the left. Bottom hairline divider clearly separates each section.
- **Landfall list.** Each entry is now a self-contained card with a left-edge lavender accent rail, soft hover lift (2px translate), and a tonal hover background. Date/time renders in JetBrains Mono with tabular numerals; place reads in semibold sans.
- **Animation control bar.** Buttons unified to 32×32 with 8px radius, subtle hover lift, and lavender focus rings. Scrubber rebuilt with a sapphire→lavender gradient track and a 16px lavender thumb that scales on hover. HUD section gets dividers on either side; title/meta text is properly truncated. Radar toggle uses `:has(input:checked)` for a glowing on-state. Close button picks up a red-tinted destructive hover.
- **Radar control panel.** Sapphire-themed throughout — title chip, pulsing pip, time readout in mono. Buttons share the unified 28×28 sizing with proper focus rings.
- **Compare cards.** Cards now have hover state (border + background lift), swatch dots glow with their categorical color, table headers are uppercase tracked labels, empty state is generous and centered, hint banner reads as a tinted callout instead of plain text.
- **Play-storm-animation button.** On the storm panel, this is now a full-width gradient lavender CTA with an inset highlight, hover lift, and proper focus ring — clearly the primary action.
- **Mobile breakpoints.** 720px and 480px rules tighten the new surfaces (anim bar wraps cleanly, HUD goes full-width, padding shrinks proportionally). All new transforms suppressed under `prefers-reduced-motion`.

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
