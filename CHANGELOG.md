# Changelog

All notable changes to HurricaneMap.

## Unreleased

### Added
- Copy-ready APA and BibTeX release citations now appear on every analytical side panel and About surface, travel with research and storm exports, and are emitted by the starter notebook from the same HURDAT2 revision/hash contract; shared URLs now pin the full release-manifest SHA-256.
- Bundled data metadata now carries a lifecycle status for each source; the retired NOAA NCEI Billion-Dollar Disasters series is explicitly closed at 2024, validates against that end date, and renders closed-series copy separately from an unavailable feed.
- Hand-maintained seasonal outlook and ENSO snapshots now carry issue/validity windows, with a 45-day in-season freshness warning, hard expiry gate, and visible validity dates plus a current NOAA CPC link in the stats card.
- The primary document now denies form submissions in its meta CSP; the Cloudflare Worker and bundled self-hosting server add the response CSP with same-origin framing protection.
- Evacuation guidance now discloses Esri address transmission, offers a coordinate-only Florida path, probes the pinned Florida layer before querying it, labels outage/invalid-response fallback, and records official source links for North Carolina, South Carolina, Georgia, Texas, Virginia, Maryland, and Massachusetts.
- The no-build startup path now preloads every declared CSS layer, both local fonts, and the static boot module graph; the bundle audit enforces a two-wave first-paint request budget and high-priority main/data hints.
- The service worker now registers as a module with cache-bypass updates, derives its application shell from the `main.js` import graph, and serializes install/validation/repair handshakes with a Web Lock.
- Storm track playback can now be rendered and downloaded as a self-contained WebM with selectable frame rate and duration, storm dates, category legend, and NOAA attribution; unsupported browsers receive an explicit availability explanation.
- Storm panels now include a keyboard-openable, localized textual track timeline with hazard milestones ordered first, complete chronological observations on demand, and polite playback time announcements for screen readers.
- Online archived radar fallback now uses IEM's zoomable, cache-stable XYZ tiles with explicit 404/503 miss handling; bundled radar frames and offline packs remain full local PNGs.
- The colour-blind palette now remaps archived PNGs and online IEM radar tiles to a Cividis reflectivity ramp, with a matching dBZ legend and playback coverage.
- Storm panels now show on-demand OpenFEMA disaster-declaration context grouped by declaration, state, and designated area, with incident-date/title matching, official record links, memory caching, and explicit no-match or unavailable states.

### Fixed
- The checked-in AOML detailed continental-U.S. landfall table now provides a build-time ground-truth artifact and reports a 16/16 (100.0% precision, 100.0% recall) hurricane-strength match for 1983–1990; inferred tropical-storm candidates remain separately scoped, and HURDAT2 `C` closest-approach records cannot be promoted to inferred landfalls.
- The offline core now installs only runtime data; raw Atlantic/Eastern Pacific HURDAT2 text and the full release manifest are an integrity-checked, user-initiated source bundle capped at 13 MB, with storage diagnostics and distribution metadata reporting the optional payload separately.
- Offline launches now classify the shell/data tuple as intact, evicted, stale-but-valid, or invalid and offer an explicit repair action; each storm panel reports its cached radar-frame coverage.
- High-contrast defaults now follow `prefers-contrast: more` until a local choice is made, and Windows `forced-colors` receives system-colored map controls, legends, panels, and focus rings with browser axe coverage.
- The components stylesheet now follows the declared cascade without `!important`; desktop trend tables, mobile playback targets, reduced-motion settings, and light/dark operational surfaces retain their tested behavior through normal layer-specific rules.
- Closest-approach and city return-period queries now measure the great-circle track segments between HURDAT2 fixes, interpolate the location and intensity at the true closest point, and cover the Miami, Cape Hatteras, New York, and segment-only regression cases.
- The Cloudflare Worker now permits same-origin geolocation while continuing to deny microphone and camera access, and its policy test locks the complete security-header contract.
- Leaflet’s disputed upstream advisory is now represented as a permanent, cited security decision with `check:popup-sinks` as its compensating control; the Playwright smoke injects a poisoned advisory fixture and verifies it stays inert text.
- The linked self-hosting, Cloudflare, GOES, quality-plan, and licensing documents are now publishable GitHub files, with a build gate ensuring every relative README link resolves to a tracked target.
- All browser data and optional-feed requests now share finite, per-feed `AbortSignal.timeout()` budgets, including radar probes and the module worker, with a static guard against reintroducing bare `fetch()` calls.
- The i18n contract now verifies that each supported locale updates the document language metadata used by screen readers.
- The browser accessibility smoke now scans the main view, settings, and storm panel independently in English, Spanish, and Haitian Creole.
- The saved-view file picker now has an explicit localized label, keeping the expanded settings surface axe-clean.
- The application now exposes a focusable `<main>` landmark for skip-link navigation, and the accessibility smoke includes axe best-practice rules.
- The dynamic timeline now stays inside the main landmark and exposes its localized region name.

## v1.9.1 - Advisory replay expansion, radar reliability, and standards catalog (2026-08-02)

### Added
- Storms can now replay the forecasts NHC actually issued: for U.S.-landfalling Atlantic storms of 2020-2024, the storm panel steps through every archived advisory, drawing the issued forecast track, its cone, and the final best track together, with the verified track and intensity error at each lead and a link to that advisory's own forecast discussion. Forecast positions, intensities, and issue times are read verbatim from NHC's archived ATCF a-decks; preliminary operational data is labelled apart from the final HURDAT2 best track, storms outside the era say so instead of offering an empty control, and the dataset carries per-storm source URLs and SHA-256 provenance under a published JSON Schema.
- Advisory replay now covers U.S.-landfalling Atlantic storms from 2015-2024; 2015-2019 records use each year's NHC-published operational cone radii from annual verification reports, while 2020-2024 retains its exact five-year verification table.
- Published JSON Schema 2020-12 contracts now validate metadata, storms, landfalls, normalized impacts, saved views, and release manifests; every shipped data artifact carries a verified SHA-256, byte count, source URL/date, generated timestamp, and schema version, while full QGIS exports are checked against RFC 7946.
- Reproducible core and full static distribution profiles now share one source commit and publish machine-readable capability metadata; core retains the complete offline historical app at about 19 MB, while full includes the 1,700+ archived radar frames.
- Saved views can now be imported from versioned JSON with field-level preview errors, merge/replace choice, deterministic duplicate renaming, future-schema rejection, and atomic rollback after storage failures.
- Settings now exposes actionable offline diagnostics for service-worker control, cache versions and sizes, persistence/quota, and optional-feed freshness, with scoped retry/refresh controls and a privacy-allowlisted JSON support bundle.
- Offline releases now stage shell, data, database, and release-manifest identities as one hash-verified version tuple; profile packaging rewrites the manifest for the exact staged payload, diagnostics reports coherence, and users can repair required offline data without clearing optional tile/radar caches.
- Visual regression now compares a deterministic desktop/mobile matrix covering shell, storm, statistics, comparison, settings, advisory replay, track playback, and theme states, with external requests aborted, map rendering stubbed, live chrome masked, and an explicit baseline-refresh command.
- A local Chromium/Firefox/WebKit contract matrix now verifies boot, manifest, search, storm panels, versioned offline caches, and service-worker fallback through a simulated network outage; unavailable engine capabilities are reported explicitly.
- Research exports now carry a schema-versioned release-provenance block binding the app version, export time, release-manifest hash/source commit, relevant artifact hashes and source dates, and methodology across CSV, Markdown, QGIS GeoJSON, and SVG track output.
- Advisory replay links now preserve a versioned storm, zero-based replay ordinal, and cone-era state; reloads restore the same issued forecast and final-best-track comparison, while malformed or mismatched state falls back to the ordinary storm panel.
- PWA manifests now declare a stable relative identity/scope and localized `en`/`es`/`ht` names, screenshots, and shortcuts; core/full packaging and browser contracts verify every referenced asset.
- The starter analysis notebook now has an offline release gate that validates the 595-storm, 759-landfall, and 374 hurricane-strength data/provenance contract, executes twice in disposable directories, and detects non-deterministic CSV output.
- Shell and storm-panel orchestration now have explicit `shell-ui.js` and `panel-controls.js` owners; filter/hash state remains in `main.js`, storm composition remains in `panel.js`, and panel export wiring is isolated behind the rendered-panel boundary.
- A deterministic STAC 1.0.0 catalog now indexes the HURDAT2 collection and all 1,703 archived radar frames with spatial/temporal extents, source and license provenance, release availability, byte/hash metadata, and core/full distribution validation.

### Fixed
- Managed side panels now return keyboard focus only after View Transitions settle, preventing intermittent focus loss to the document body.
- Cache clearing, saved-view deletion, and preparedness resets now require a localized, scope-specific confirmation; cancellation preserves state and returns focus, while completion is announced.
- The desktop Seasonal Outlook card now gives its current-season summary a full-width row, with browser geometry coverage preventing crushed, clipped, or overlapping forecast content.
- Active-storm Leaflet popups now use DOM nodes, HTTPS/NHC host allowlists, poisoned-data browser coverage, and a CI guard that rejects string or unverified-variable popup content.
- Device geolocation is now session-only by default, with pre-use privacy copy, explicit 24-hour persistence, legacy-coordinate purge, a clear control, and localized permission/timeout/unavailable recovery.
- Brand-title ink is now independent from dark accent-fill tokens, and computed browser checks enforce readable header text and controls across the complete theme, palette, and high-contrast matrix.
- Prep, evacuation, table, and nearby-storm regions now focus their heading on entry, return to a visible invoker on close, preserve focus through minimize/restore, and explicitly focus the map from the skip link.
- Advisory replay positions now use the replay record ordinal while retaining the NHC advisory number separately, keeping gapped advisory series readable and the range scrubber's ARIA value valid.
- Storm-owned retrospective cone, risk-trajectory, and advisory overlays now clear when another managed panel opens, including their floating legends.
- Advisory replay now frames its issued forecast, cone, and comparison track in view, re-fitting only when a later step leaves the current map bounds.
- Preparedness checklist and household controls now update in place, preserving keyboard focus while progress and supply totals change.
- Map overlay geometry and legends now share theme-invariant basemap color tokens, keeping forecast, best-track, cone, ensemble, and evacuation markers aligned in every UI theme.
- On-this-date loading, relative-day, state, unnamed-storm, and playback/climatology status copy now comes from the English, Spanish, and Haitian Creole catalogs, with live locale rerender coverage.
- On-this-date matching and relative labels now use UTC calendar arithmetic, eliminating daylight-saving shifts around the ±7-day window.
- Globe wind-cone toggles now use a layer-only protocol update, preserving the current timeline position and camera instead of reinitializing the scene.
- Advisory replay now identifies archived post-tropical forecasts that fall outside the numbered NHC advisory series, with localized provenance copy and browser coverage for both non-zero and complete archives.
- Pure fixture-backed contracts now cover fuzzy storm-name matching, annual climatology aggregation, and decade trend bucketing, including edit-distance pruning, ACE totals, major-storm shares, and impact rankings.
- Online radar fallback now probes the nearest available five-minute frame symmetrically within the documented ±60-minute window, with pure contract coverage for the probe ordering and bounds.

### Changed
- The optional 3D globe now runs in a least-privilege `sandbox="allow-scripts"` frame with its own document, so the application itself no longer grants `unsafe-eval`, `wasm-unsafe-eval`, or any third-party script host; the two documents exchange only a versioned `hm-globe-v1` envelope whose source, origin, message type, and payload shape are validated on both sides, and a build guard fails if that boundary regresses.
- Application styles now use an explicit tokens, reset, base, shell, components, utilities, themes, and accessibility cascade with duplicate-rule validation and offline caching for every layer.
- Toolchain reproducibility now declares Node.js 20+, pins the complete notebook/Pillow environment, audits lockfile and vendored-font licenses/hashes, and keeps the 759-landfall count synchronized across generated metadata and notebook documentation.
- Deterministic Playwright screenshot comparisons now guard the atlas shell and Statistics panel with checked-in Windows baselines, masked live/map content, and an explicit baseline-refresh command.
- Onboarding, saved views, the landfall table, nearby-storm counts, and Seasonal Outlook chrome now use complete English, Spanish, and Haitian Creole catalogs with locale-aware counts and browser journey coverage.
- Map, tide, active-storm, cone, and wind-contour calculations now share one antimeridian-safe spherical geodesy module; preprocessing validates the same distance and segment reference vectors.

## v1.7.0 - Trust, resilience, and official forecast context (2026-07-25)

### Added
- Historical storm panels now separate measured NHC forecast skill from illustrative cones: official 2021–2025 OFCL track/intensity mean errors, lead-time sample sizes, best-track comparison definitions, basin scope, and source files ship in a reproducible offline dataset.
- Spatial point searches now add current NHC 34/50/64 kt cumulative wind probabilities and nearby 34 kt arrival contours with issue time, official sources, explicit contour-distance/caveat copy, cancellation safety, and stale/offline link-only fallback.
- Settings now reports browser storage usage, persistence, and cache scopes; only optional tile/radar data is clearable, and radar timelines can save bounded per-storm offline packs with quota-safe rollback.
- Browser QA now produces desktop/mobile visual snapshots for every primary surface and asserts modal focus cycling/return, skip-link behavior, keyboard map alternatives, reduced motion, and mobile target sizes.
- English-only glossary definitions and generated storm narratives now carry machine-readable language metadata and a localized source-language disclosure in every interface locale and comparison export.
- Persisted settings, search history, preparedness state, shared URLs, generated metadata, and offline storage now share an explicit compatibility contract with legacy migration and future-version rejection tests.
- Named device-local views can now restore and share versioned filters, layer choices, display units, and comparison sets, with bounded JSON export and explicit exclusion of addresses and selected locations.
- Impact records now carry source title/URL, retained raw fields, parse timestamp, units, qualifiers, and explicit confidence reasoning; statistics reports all 244 covered and 351 missing catalog storms by year without treating missing as zero.

### Changed
- Refreshed esbuild and Playwright to tested current releases and documented the audit, license, runtime-pin, and compatibility policy for all direct build and mapping dependencies.
- Split search, filter-control, and responsive shell navigation out of the entry point, and unified metric/category/unit/missing-value presentation across panels, statistics, comparisons, reports, CSV, and QGIS exports.
- Refreshed the existing MediaWiki impact pipeline from 208 to 244 validated storm records and made repeated normalization byte-for-byte deterministic.

### Fixed
- Corrected the published Saffir-Simpson and major-hurricane thresholds and added a semantic contract test that keeps application logic, glossary copy, and the README category table aligned.
- Storm biographies now compose fatality and damage details through one grammar-safe presenter, including correct singular fatality wording.
- Optional live and on-demand feeds now share a localized diagnostics contract for loading, empty, stale, offline, rate-limited, and error states; failed layer refreshes retain last-good map data, and settings shows source, freshness, retry, and cache-origin details.
- Release validation now keeps package/service-worker/data versions, impact coverage counts, and the documented skip-link conformance claim aligned.
- Mobile active-storm status no longer blocks header actions, settings and detail controls meet 44px target sizing, and the compact playback dock preserves status context without consuming a third control row.
- Service-worker activation now removes superseded IndexedDB generations and regression coverage proves old caches and stale records are pruned without losing the current offline catalogue.

## v1.6.0 - Safety, education, and resilience (July 2026)

### Added
- Active-storm mode now shows the official NHC tropical outlook with the 2026 gray-X near-zero symbology, handles Potential Tropical Cyclones as first-class advisories, links to public advisories, forecast discussions, name pronunciations, and rip-current forecasts, and offers an opt-in 0–24 hour marine wind-warning layer.
- Historical storm panels now offer an educational forecast-cone retrospective using selectable official 2015, 2025, and 2026 error-radius tables, plus a clearly qualified interactive reconstruction of the 2026 experimental ellipse method.
- An opt-in Animated Risk Trajectories education mode shows 20 deterministic, era-scaled plausible center paths without a containment boundary and falls back to a static ensemble under reduced-motion preferences.
- A fully offline preparedness panel now provides a persistent localized supply checklist and household-scaled three-day go-kit/two-week stay-home water and food calculator, with Ready.gov and Red Cross guidance links.
- A Florida-first evacuation-zone lookup now checks addresses or selected map points against the state-published ArcGIS layer, links every result to official verification, and degrades to official Florida, Virginia, Maryland, and Massachusetts resources during service failures or for uncovered locations.
- A filter-aware gallery mode now draws the selected historical tracks as a deterministic 1800×1200 density poster, with lifetime-weighted strokes, intensity color ramps, theme-aware artwork, and NOAA/NHC HURDAT2 attribution baked into the PNG export.
- Header hints now use non-disruptive `popover="hint"` semantics and CSS anchor positioning where supported, while fixed-coordinate tooltips and the existing settings placement remain complete fallbacks for older browsers.

### Fixed
- Generated storm data now writes a deterministic `storms.json.gz`, validates compressed/uncompressed parity, ranks tropical storms above tropical depressions across panels/sorts/tide selection, and records genuine preprocessing provenance.
- Track overlays reliably return after toggling and repaint with theme/palette changes; intensity-chart strokes and inactive category controls remain readable in light and high-contrast themes.
- Delayed geolocation, SST probes, high-water-mark fetches, tropical alerts, peak-surge forecasts, and official cone requests can no longer resurrect layers after users turn them off; SST fallback probes also retry instead of freezing for the session.
- PWA statistics/comparison shortcuts now survive initial URL canonicalization and work during in-app hash navigation; the climate-trends chart loads storm data on its first opening instead of remaining empty.
- Storm biographies use basin-aware Pacific genesis wording and report the actual number of landfall events rather than the number of unique states.
- The Cloudflare edge wrapper marks upstream errors `no-store` and handles HEAD lookups with GET cache keys without attempting invalid bodyless cache writes.
- Service-worker validation now fails releases whose cache version differs from `package.json` or whose shell manifest omits any application module.
- Translation interpolation now replaces repeated placeholders literally, active-feed and map counters use locale-aware status strings, Spanish landfall terminology uses "toque de tierra," and tropical-depression/storm category labels match the data model.
- Combined high-contrast/colorblind controls choose readable category ink for every YlOrRd step, while light-theme warning toasts and rapid-intensification/pressure-fall flags use high-contrast semantic ink.
- Spanish and Haitian Creole now cover the static application shell, titles and accessible names, filters, legend, 3D globe, About/data notes, loading state, keyboard help, search empty states, and localized globe/runtime summaries without stripping trusted inline links or code.
- Shared URLs preserve an explicitly empty category selection; timelines, reports, CSV dictionaries, and QGIS names use metadata-defined coverage years; future-year damages remain nominal/current; multi-state tornado links encode once; climatology copy describes the landfall-storm subtotal; comparison dates are locale-safe; and TD exports remain TD.
- Seasonal-outlook and spatial-result HTML now escape every data field and reject unsafe source URLs; the Leaflet sink guard scans multiline templates and validates each interpolation independently.
- Paused track playback stops its animation-frame chain, radar follows scrubs after natural completion, chart SVG serialization supplies intrinsic dimensions, track SVG URLs revoke after navigation commits, empty 3D selections remain empty, and stale/closed 3D opens cannot create a viewer.
- Active storms now use only the real CurrentStorms position plus official NHC FeatureServer tracks/cones; unused polling APIs are gone; tide requests time out and retry with an exact ±48-hour residual window and retry UI; optional navigation performance entries fail soft.
- Offline storage now bounds radar frames and prunes retired data records; the container image avoids a duplicate ownership layer and includes its manifest screenshot; rainfall and Storm Events builders reject incomplete/stale inputs; foreign Tamaulipas landfalls are no longer attributed to Texas; and the shell uses the compact favicon asset.
- Shell styles now parse cleanly, use theme-safe tide/legend colors and consistent radii, avoid clipped header fades and dead focus rules, and keep filter/table/category rules deterministic; settings radio groups support roving arrow-key navigation, nested panels no longer create unnamed landmarks, and map/radar fallbacks match their live rendering invariants.
- Impact refreshes preserve each row's real parse timestamp and MediaWiki damage prefix/suffix fields, repair the known numeric-range mojibake, and normalize damage ranges to an explicit low/high interval instead of treating the low bound as exact.

## v1.5.0 - 2026 season readiness, new NOAA data layers, reliability (July 2026)

### Fixed (production breakage)
- **3D globe was dead**: the v1.4.x CSP hardening blocked Cesium three ways (stylesheet host, WASM eval, and its bundled Knockout's top-level string-eval). CSP now grants exactly what Cesium needs; Cesium bumped 1.140→1.143 with SRI pinned on both the script and stylesheet, and the globe smoke is chained into `npm test` so this class of regression fails the suite.
- **SST overlay was triple-broken**: the pinned dataset dead-ended 2023-12-31 (blank tiles), the WMS request sent a CRS ERDDAP rejects, and the layer stacked *behind* the opaque basemap. Now renders live NOAA Coral Reef Watch CoralTemp (latest-day probe, correct CRS, correct stacking).
- **Active-storm badge intercepted header clicks** whenever visible — moved below the header row.
- Rapid panel transitions leaked "Transition was skipped" through `ViewTransition.ready`; all three transition promises are now caught.
- Smoke suites could not launch (Playwright/browser-cache mismatch) — Playwright bumped to 1.61.1.

### Added (2026 season)
- **2026 NHC cone parity**: coastal + inland tropical-storm/hurricane watch/warning zones from api.weather.gov render beside the official cone, including the new pink/blue hatch where a Hurricane Watch overlaps a Tropical Storm Warning, with an on-map legend (EN/ES/HT).
- **NHC Peak Storm Surge forecast layer** for active storms (GeoJSON, height-ramp styling).
- **2026 season outlook card**: NOAA (55% below-normal, 8-14/3-6/1-3) + CSU July update (9/4/1) with El Niño context in the stats panel.

### Added (data layers)
- **Billion-dollar disasters**: 65 storms joined to NOAA NCEI's frozen 1980-2024 record — CPI-adjusted cost + official deaths in the storm panel.
- **Tide-gauge water levels**: on-demand NOAA CO-OPS observed-vs-predicted charts at the gauges nearest the strongest landfall, peak surge residual called out (Katrina: Grand Isle +3.8 ft).
- **USGS high-water marks**: 10,741 surveyed peak-water elevations across 25 modern storms as a toggleable layer beside the SLOSH surge zones.
- **SLOSH surge coverage for Hawaii and Puerto Rico/USVI** via NHC's regional tile services.
- **Geolocated closest approaches**: "Use my location" ranks every historical pass by distance + compass bearing; active-storm tooltips show live distance/bearing to your point.

### Improved
- Unhandled runtime errors now surface as rate-limited toasts instead of dying silently in the console.
- Full i18n: dynamic strings (toasts, loading/error states, update prompt) localized; Haitian Creole reaches 100% key parity; locale contract test in the build chain.
- axe-core WCAG 2.2 AA assertions in smoke (two real violations found and fixed at the root).
- Live permalink navigation: pasting a hash into an open tab applies it without a reload.
- Leaflet tooltip sinks escape data-bundle strings (CVE-2025-69993 class) with a build-time tripwire.
- Build guards: published-size check against GitHub Pages' 1 GB cap; data validation covers wind-null sentinels, decade/state bucket sums, and category-vs-wind consistency.
- Richer PWA install UI: narrow-form-factor screenshot added to the manifest.
- `scrape_radar.py --force` works; storm-events/rainfall builders skip malformed rows instead of aborting.

## v1.4.6 - Desktop panel fit (July 2026)

- Lowered the desktop analytical panel lane and tightened the shelf gutter from 12px to 6px so the right panel uses the available space above the season/timeline shelf.
- Added smoke coverage that asserts side panels leave a compact 4-8px gutter above the bottom shelf instead of floating too high.

## v1.4.5 - Desktop shelf alignment (July 2026)

- Moved the season summary into the desktop bottom shelf, positioned to the left of the timeline with matching height, baseline, radius, and surface treatment.
- Reserved bottom-shelf space for desktop side panels so storm, state, stats, comparison, table, and spatial panels stop above the season/timeline row instead of competing with it.
- Kept service-worker update toasts out of the side-panel lane when panels are open.
- Added a body-level season-summary visibility state so shelf layout only shifts when the card is actually rendered.
- Fixed smoke coverage to inspect the real `.timeline-ribbon` element and assert shelf alignment, panel spacing, and no-overlap behavior across desktop themes.

## v1.4.4 - Desktop panel refinement (July 2026)

- Rebalanced desktop side panels into a wider bounded inspector lane so storm, state, stats, comparison, table, and spatial panels have enough room without swallowing the map.
- Reworked storm, state, and statistics panel internals into two-column desktop grids that avoid clipped legacy dashboard columns and keep section spacing consistent.
- Hid the season summary while an analytical panel is open, reducing competing floating windows on desktop.
- Made state storm rows keyboard-accessible with button semantics, focus states, and Enter/Space activation.
- Extended smoke coverage to assert desktop panel width, no clipped panel internals, hidden competing shelves, state-row accessibility, and stats/state/storm panel fit across themes.

## v1.4.3 - Premium layout and settings polish (July 2026)

- Compressed mobile playback chrome so the map remains the primary surface: the header collapses to a compact identity strip, the storm panel stays as a small edge restore tab, and playback controls render as a bounded command dock.
- Reworked settings into a clearer preference surface with helper copy, stronger grouping, localized strings, right-anchored desktop placement, and scroll-safe mobile drawer constraints.
- Normalized repeated control geometry away from fully rounded pills into the app's 4/6/8/10/12px radius scale across chips, badges, toggles, swatches, segmented controls, toasts, and playback controls.
- Made search no-results render as an inline empty state so high-contrast and narrow layouts present clear recovery guidance instead of a hidden dropdown.
- Tightened loading, missing-record, boot-error, and update-prompt copy so degraded states explain what is happening and how to recover.
- Extended smoke coverage to assert settings layout, mobile playback header compression, compact playback docks, and oversized-radius regressions across dark, light, and high-contrast themes.

## v1.4.2 - Playback map-first layout (July 2026)

- Collapsed the storm details panel automatically when track playback starts so the animated track and map remain visible.
- Moved animation controls out of the storm panel into a compact fixed map dock with responsive desktop/mobile wrapping.
- Hid competing bottom overlays during playback, including the timeline, season summary, compare tray, and standalone radar controls.
- Added smoke coverage for the playback layout across dark, light, and high-contrast themes in desktop and mobile viewports.

## v1.4.1 - Map-first overlay polish (July 2026)

- Changed filters to start collapsed and behave as a bounded, scrollable map drawer instead of a default overlapping window.
- Made filters and analytical side panels mutually exclusive so opening one closes/collapses the other.
- Restored desktop panels to a narrow map-preserving lane, compacted the timeline while filters are open, and moved Leaflet controls away from active panels.
- Tightened mobile header/filter geometry so the map remains visible below the drawer.
- Updated Playwright smoke scripts to support a system Chrome executable fallback and refreshed stale version/offline-data assertions.

## v1.4.0 — Deep audit: data-path repairs, panel minimize, theme correctness (July 2026)

**Full engineering + product audit pass: ~40 verified fixes across correctness, async races, theming, accessibility, offline, and CDN policy, plus a panel minimize-to-tab system.**

### Fixed — data paths & offline (P1/P2)
- The storms web worker fetched `data/` relative to `/src/` and 404'd on every load — the off-main-thread parse of the 2.2 MB storms.json never worked; now resolves against the worker URL.
- The service worker matched every same-origin `.json`, so the live NHC feed (`/nhc/CurrentStorms.json`) was served stale-first from IndexedDB, defeating no-cache polling and the entire backoff machinery. `isData` is now scoped to `/data/` and includes `.json.gz`, so the precached compressed storms bundle is actually servable offline (it previously had no fetch handler at all — offline users got no tracks or storm panels).
- Active-storm tracking was permanently dead on GitHub Pages: the `/nhc/` proxy 404s there and non-ok responses never triggered the corsproxy fallback. Fallback now fires on non-ok primaries, and each attempt gets its own timeout so a hung primary can't consume the fallback's abort budget.
- Publication CSV, statistical report, and QGIS GeoJSON all read `lf.month/day/hour` — fields that don't exist on landfall records. The CSV shipped empty date columns, the report's By-Month chart was all-zero with "undefined" dates, and GeoJSON points had no time attribute. All derive from the ISO timestamp now; the metrics CSV also had its header row fused onto the last comment line.
- "On this date" rendered every storm as "unnamed" (wrong field name).

### Fixed — async races
- Storm panel: rapid marker clicks could render storm A over storm B's track (sequence guard), and the wind-field swath outlived its checkbox across storm switches.
- Track layer: toggling tracks off (or re-filtering) during the first storms.json load repainted cleared polylines (generation token in clearTracks/showTrack).
- Radar overlay: the IEM 404-walkback could resurrect the overlay after close or show the wrong landfall's frame (session token); a second loop click during the online probe started an unstoppable duplicate interval (pending flag).
- Track animation: Play crashed on single-point tracks (four 1860s storms); stopping mid-await no longer rebuilds orphaned controls; scrubbing after playback ends lands in an explicit pause.
- Season summary: overlapping refreshes wrote stale ACE into the newer card and stacked duplicate "Similar seasons" blocks.
- Compare: removing the last pin from inside the panel left a dead card; GOES status badge no longer resurrects after toggle-off; 3D globe listeners wire once instead of stacking per open.

### Added — panel management (declutter)
- Every side panel now has a minimize button that collapses it to a slim restore tab at the map edge — the map, timeline, and zoom lanes reclaim the full viewport.
- Table view and spatial search results now go through the exclusive side-panel lane (they previously stacked on top of open panels and desynced layout offsets); spatial results joined the shared lane geometry.
- The bottom timeline scopes to the state filter and restores when it clears or the state panel closes (previously it stayed rescoped to one state forever).
- Escape reliably closes panels again (the blocking-surface check matched the settings popover permanently since the popover migration).
- The closed settings popover no longer renders invisibly over the filter panel, intercepting clicks and appearing in the screen-reader tree; "Replay welcome tour" no longer bricks the settings menu until reload.

### Fixed — theming & accessibility
- The colorblind palette finally reaches the CSS layer: legend dots, category buttons, pills, and timeline bars now switch with the markers (they previously contradicted the map for the users who enabled the mode). Marker colors resolve from the live CSS tokens, so map and legend can never diverge across dark/light/high-contrast.
- The "Annual climatology" chart was invisible in every theme (all its SVG classes were unstyled).
- High-contrast dark: accent-gradient controls had 1.4:1 ink; dim text sat at ~1.9:1. Light theme: white-on-sapphire accent endpoint at 2.8:1, cat-4/5 pill ink below 4.5:1, focus glow at ~1.3:1, and high-contrast light inherited a white focus glow on a white page. All repaired to WCAG minimums.
- Restored the rapid-intensification ⚡ and explosive-deepening 📉 badges (computed every render but dropped from the template in a layout rewrite).
- The SST overlay is labeled as the September 2024 snapshot it is (toggle, tooltip, attribution) instead of implying live data; the browser theme-color meta follows the active theme; removed the browser-reserved (dead) Ctrl+T/Ctrl+L shortcuts and their palette listings.
- Basemap fallback filter added — a CARTO outage no longer floods the dark UI with full-brightness OSM tiles.

### Fixed — correctness & hygiene
- Year clamping inverted the range (empty map) when both endpoints fell outside bounds on the same side; "Retired names only" now round-trips through share links (`r=1`); PWA launcher shortcuts (#stats/#compare) actually open their panels.
- City return periods no longer double-count multi-landfall storms; climate-trend rolling windows span 10 calendar years (zero-filled seasons) instead of 10 data points.
- Browser-language detection (es/ht) works for first-time visitors; partial Haitian Creole falls back to English instead of raw i18n keys.
- Marker hover/select styles restore their exact creation values (major-hurricane borders no longer thin permanently after first hover); table sort handles null pressure cells consistently; timeline pointer-cancel restores the pre-gesture selection.
- SLIDER satellite quicklink uses GOES-18 for Hawaii landfalls (GOES-16 can't see Hawaii).
- Service worker: background revalidations tied to `waitUntil`; tile cache capped at 600 entries. Cloudflare CDN: `storms.json.gz` gets the data TTL, and un-fingerprinted branding images are no longer pinned immutable for a year.
- Repo: pinned LF line endings via `.gitattributes` (mixed endings were producing 14k-line diff noise), untracked `server.log`, removed dead CSS/HTML (orphaned legend aside, unused keyframes, never-matching selectors) and dead exports.

## v1.3.10 — Premium responsive command polish (June 2026)

**Product-quality refinement for panel layout, mobile command layout, settings hierarchy, and local release hygiene.**

### Improved
- Consolidated stale side-panel positioning CSS so the deterministic fixed side-panel lane owns geometry while earlier blocks only carry visual treatment.
- Added Playwright smoke coverage for side-panel bounds at 430px, 640px, 720px, 860px, and 1120px across dark, light, and high-contrast themes.
- Synced HURDAT2 refresh docs and helper copy around local-only refresh, build, and test flows.
- Reworked the narrow-screen command bar into a compact two-row shell with a horizontally scrollable action rail, preserving 44px touch targets without clipping header actions.
- Moved mobile map controls and panels below the command surface so zoom controls, panels, filters, and the timeline no longer collide at phone widths.
- Added visible settings hierarchy with Reading, Appearance, and Guidance groups, clearer local-save copy, and more legible mobile settings layout.
- Refined first-run tour copy and retargeted the filter step to the Filters button on mobile, avoiding a spotlight on the collapsed offscreen filter panel.
- Added a mobile More actions popover with text labels for export, report, QGIS, data, glossary, and settings commands.
- Reflowed desktop Filters, Statistics, Storm Details, and State Details panels so common laptop viewports show their lower controls without panel scrolling.
- Embedded precomputed eight-dimensional storm similarity vectors in generated storm data and switched Similar Storms to use them with runtime fallback parity.
- Added official NHC active-storm cone rendering from the Esri/NHC GeoJSON forecast layers, including observed-track and forecast-track context plus a settings toggle.
- Added NOAA/NCEI Storm Events tornado and hail aggregates to storm panels, matched to affected states around U.S. landfall windows.
- Added an opt-in Cesium-powered 3D storm globe with elevated wind-scaled tracks, category coloring, focus/reset controls, and a timeline scrubber for visible selections.
- Added 3D wind-radii cone fans for focused modern storms, rendering 34/50/64 kt asymmetric HURDAT2 quadrants as translucent Cesium cone surfaces.
- Added a storm-panel estimated population exposure metric for modern landfalling storms, combining HURDAT2 wind-radii geometry near landfall with the bundled state-density index and clear screening-estimate methodology copy.
- Hardened the HURDAT2 refresh helper with a tested NOAA directory detector/downloader, safe unchanged-data handling, and regenerated-data validation.
- Added service-worker v2 offline data storage: historical JSON/GeoJSON/TXT datasets are preinstalled into compressed IndexedDB with CacheStorage fallback, while radar PNGs remain cache-first on demand to avoid oversized installs.
- Added an esbuild bundle audit with a 100 KB gzipped initial-JS budget and moved non-critical panels, overlays, export/report flows, keyboard help, glossary, and 3D globe code behind dynamic imports.
- Added a Cloudflare Worker CDN wrapper with route-aware cache headers, edge/browser TTL policy, image optimization hints, deployment docs, and a worker policy test.
- Added Docker self-hosting support with a non-root Python HTTP server image, healthcheck, `.dockerignore`, self-hosting docs, and static packaging tests.
- Added an opt-in live GOES satellite background for active storms using current NOAA/NESDIS/STAR GeoColor sector images, with Atlantic, Eastern Pacific, and Central Pacific sector selection, a source-linked status badge, and utility coverage.
- Added adaptive active-storm polling: hourly checks while storms are active, quiet six-hour checks when the feed is empty, exponential retry/backoff for transient failures, explicit 429 handling, and visible badge status with next retry timing.
- Hardened storage, exports, and offline routing by sanitizing persisted search/settings data, routing radar frames through the radar cache before generic shell image handling, exporting full QGIS storm tracks, ranking reports from parsed impact data, and revoking export object URLs.
- Bumped the service worker shell cache to `hm-v1.3.10` so installed users receive the responsive polish, side-panel layout consolidation, similarity-vector data path, active-storm cone layer, Storm Events panel metric, 3D globe shell module, 3D wind-cone renderer, exposure estimator, offline data store, lazy-loading entrypoint, live GOES overlay, active-feed scheduler, and export/storage hardening.

## v1.3.9 — Metrics and interaction hardening (May 2026)

**Production hardening pass for derived metrics, comparison exports, URL restoration, and global keyboard behavior.**

### Fixed
- Restored ACE values in season summaries, climatology charts, and decade trends by reading the structured metric payload consistently.
- Fixed comparison CSV export fields for ACE, translation speed, rapid intensification, and RI risk so exports match the live analytics contracts.
- Validated permalink category and state filters during hash restoration, preventing malformed URLs from creating impossible empty filter states.
- Routed Escape handling through the active surface first so settings, glossary, and info dialogs close predictably without also resetting filters or panels.
- Normalized storm-name formatting across panels, map previews, search history, comparison views, animation labels, and state summaries.
- Rebuilt decade impact rankings from parsed impact data instead of stale field names so deadliest and costliest decade lists remain meaningful.
- Bumped the service worker shell cache to `hm-v1.3.9` so live users receive the hardening fixes.

## v1.3.8 — Premium command and onboarding polish (May 2026)

**Focused product-quality pass for the command bar, first-run guidance, responsive filters, and accessibility semantics.**

### Improved
- Re-enabled the existing first-run tour after the map stabilizes, with focus trapping, focus restoration, and a refined card treatment.
- Converted the settings popover from menu semantics to a labeled dialog with proper radio groups for units, theme, palette, language, and damage mode.
- Added polite status announcements for loading and visible-landfall counts so assistive technology receives meaningful state changes.
- Added hover/focus command tooltips on desktop while suppressing them when a popover is already open.
- Tightened mobile command-bar touch targets to 44px and added a horizontal rail treatment for narrow screens.
- Compacted the filter legend into a two-column desktop layout so it stays visible above the timeline.
- Hardened high-contrast category chip text color and stabilized search-result active/hover states without layout shift.
- Bumped the service worker shell cache to `hm-v1.3.8` so live users receive the command and onboarding polish.

## v1.3.7 — Overlay cleanup and marker previews (May 2026)

**Focused cleanup for stuck map previews and remaining overlapping playback/season overlays.**

### Fixed
- Made landfall marker tooltips exclusive so only one marker preview can be open at a time, with cleanup on pointer exit, map movement, clicks, drags, and zooms.
- Removed the standalone `timelapse-controls` dock from the page; storm playback remains handled by the sidebar playback controls.
- Repositioned the compact `season-summary` into the open map shelf above the timeline and away from the filter/year range panel.
- Slightly widened and tightened the left year-range filter row so the Reset button stays inside the panel.
- Moved the Leaflet zoom control from the bottom overlay stack to a side-panel-aware top-right map lane.
- Bumped the service worker shell cache to `hm-v1.3.7` so live users receive the overlay cleanup.

## v1.3.6 — Theme system hardening (May 2026)

**Full theme audit pass for dark, light, system, colorblind, and high-contrast modes.**

### Improved
- Added a System theme setting that follows the operating system color scheme while preserving existing Dark and Light choices.
- Added effective-theme metadata on the document root so the UI can distinguish the stored preference from the active rendered theme.
- Centralized semantic theme tokens for app background, foreground, muted text, surfaces, controls, borders, focus rings, status states, disabled states, and Leaflet controls.
- Added a final theme-hardening CSS layer for panels, settings, filters, forms, buttons, popovers, search results, toasts, empty/error/loading states, comparison/radar/timelapse controls, and map controls.
- Bumped the service worker shell cache to `hm-v1.3.6` so live users receive the theme-system fixes.

## v1.3.5 — Timelapse dock and playback contrast (May 2026)

**Focused polish fix for unreadable playback state and the oversized season timelapse bar.**

### Fixed
- Replaced the unstyled full-width season timelapse glass bar with a compact dock that stays above the timeline and outside the side-panel lane.
- Improved season timelapse labels, controls, progress pill, and speed selector so the dock clearly communicates what it controls.
- Fixed the active Play/Pause track-animation button contrast so "Pause track animation" stays readable on the dark UI.
- Bumped the service worker shell cache to `hm-v1.3.5` so live users receive the timelapse and playback contrast fixes.

## v1.3.4 — Overlay shelf stabilization (May 2026)

**Continued panel-overlap cleanup for global map controls.**

### Fixed
- Moved compare tray and radar controls onto a reserved overlay shelf above the bottom timeline instead of letting them float through the year chart.
- Added timeline-collapsed body state so the overlay shelf can reclaim space when the timeline is minimized.
- Kept compare and radar controls outside the side-panel lane on desktop and suppressed them behind active panels on narrow screens.
- Bumped the service worker shell cache to `hm-v1.3.4` so live users receive the overlay shelf layout fix.

## v1.3.3 — Inline playback controls (May 2026)

**Focused playback UX fix for panel overlap and clearer play/pause state.**

### Fixed
- Moved track playback controls out of the viewport-wide floating bar and into the storm side panel directly beneath the Play/Pause button.
- Updated the storm-panel Play button so it becomes a Pause button while playback is running and Resume when paused or replayable.
- Kept playback scrubber, speed, radar sync, restart, metadata, and close controls within the side-panel width so they no longer overlap filters, map content, or the storm panel.
- Bumped the service worker shell cache to `hm-v1.3.3` so live users receive the inline playback fix.

## v1.3.2 — Panel and timeline stabilization (May 2026)

**Focused follow-up pass for panel collisions, timeline precision, and non-intrusive year summaries.**

### Fixed
- Replaced competing timeline bar-click and axis-drag handlers with one pointer interaction model so clicking a year selects that exact year and dragging still creates year ranges.
- Added keyboard handling to the timeline slider for adjacent-year selection, start/end jumps, and full-range reset.
- Centralized side-panel open/close state so storm, statistics, comparison, state, and "on this date" panels share one managed lane and keep button states in sync.
- Updated Escape-key panel dismissal to use the shared panel manager instead of hiding every `*-panel` element directly.

### Improved
- Added a final responsive layout-stabilization layer that constrains managed panels to one fixed right-side lane above the timeline.
- Made the season summary compact, low-priority, and dismissible per selected range so selecting a year no longer creates a large screen-taking card.
- Shifted or suppressed competing surfaces on smaller screens when a side panel is open to avoid stacked controls and panel overlap.
- Bumped the service worker shell cache to `hm-v1.3.2` so live users receive the corrected panel and timeline assets.

## v1.3.1 — Premium UX refinement pass (May 2026)

**Focused premium-polish pass across panels, search, loading states, accessibility, and visual consistency.**

### Improved
- Added a final cohesive refinement layer for panels, filters, settings, empty states, stats sections, search results, season summary cards, closest-pass cards, days-at-intensity bars, segmented controls, and toasts.
- Improved search into a keyboard-friendly combobox/listbox pattern with active-result highlighting, Arrow Up/Down navigation, Enter selection, Escape close, and clearer no-result copy.
- Reworked boot failure feedback into a calm error card with retry action and local-server guidance.
- Improved settings and header microcopy so icon-only actions communicate their purpose more clearly.
- Added stronger empty/loading/error states for statistics, state details, storm similarity, glossary search, and "on this date" history.
- Improved timeline selection stability by anchoring the selection overlay inside the timeline axis.

### Fixed
- Registered the "On this date" panel with the shared panel manager so it no longer overlaps storm, state, statistics, or comparison panels.
- Restored side-panel scrolling after late global glass-surface styling could override panel overflow behavior.
- Fixed "On this date" day-offset labels to compare calendar anniversaries instead of real year-to-current-year date distances.
- Replaced a global toast timer with per-toast removal so rapid consecutive success/warning messages do not leave stale notifications behind.
- Made required core datasets fail explicitly instead of silently rendering an empty map when `landfalls.json` or `stats.json` cannot load.
- Bumped the service worker shell cache to `hm-v1.3.1` so live users receive the refreshed UI assets.

## v1.3.0 — Phase 9-11: Advanced analytics, real-time forecasts, localization (May 2026)

**Major research features, forecast ensemble infrastructure, and Spanish localization foundation.**

### Phase 9.1: Storm Similarity Scoring
- Implemented 8-dimensional vector-similarity matching for storms
- Normalized feature space: peak wind (kt), landfall count, track length (km), forward speed (km/h), RI magnitude (kt), ACE, decay rate, genesis month
- Cosine-distance metric yields [0, 1] similarity score where 1 = identical
- "Similar storms" widget in storm panel shows top-5 nearest neighbors with similarity % (0-100)
- Each row displays: storm name/year, peak category pill, landfall count, similarity score
- Historical basis for coastal risk modeling and storm research

### Phase 9.3: Climate Trend Overlays
- New stats-panel chart: 10-year centered rolling averages for three metrics
- Aggregated annually: named-storm count, US-landfall count, mean ACE, mean peak wind at landfall, mean forward speed
- Linear regression slope analysis: detects trend direction (↑ increasing, ↓ decreasing, → stable)
- Complements existing climatology chart (raw annual values) with smoothed signal detection
- Useful for climate change analysis and long-term hurricane pattern shifts

### Phase 10.1: Forecast Ensemble Render Infrastructure
- Created ensemble.js: forecast track rendering system for GFS, ECMWF, HWRF, HMON models
- Semi-transparent polyline rendering with model-specific colors (GFS blue, ECMWF green, HWRF yellow)
- Track caching to avoid re-fetching identical storm ensembles
- API infrastructure for future integration with NOAA GFS, IEM, or TROPYCAL endpoints
- Settings toggle: "Forecast ensemble spaghetti (when active)" with localStorage persistence
- Respects active.js lifecycle: renders only when storms are active and toggle is enabled
- Currently stub (awaiting real forecast API); ready for production data connection

### Phase 11.1: Spanish (ES-LA) Localization Infrastructure
- Created i18n.js: comprehensive string management system
- 100+ translated strings covering: header, navigation, settings, filters, panels, buttons, categories, months
- Support for: locale detection (navigator.language), localStorage persistence (hm-locale-v1), placeholder substitution
- Language toggle in settings menu (English / Español) with instant application
- Browser language auto-detection on first load
- Ready for UI binding in upcoming phase (translations exist, rendering logic next iteration)

### Enhanced
- **Settings menu**: Added ensemble toggle checkbox, language toggle buttons (EN/ES)
- **Active storm tracking**: Integrated with ensemble rendering system; respects settings changes via custom event
- **CSS styling**: Model-specific ensemble classes (ensemble-gfs, ensemble-ecmwf, ensemble-hwrf) with drop-shadow filters

### Infrastructure
- **New modules**: ensemble.js (forecast rendering), i18n.js (localization)
- **Updated modules**: active.js (ensemble integration), metrics.js (similarity + climate trends), panel.js (similarity UI), stats.js (climate trends), settings.js (new settings), main.js (settings wiring)
- **Routing**: Locale changes trigger page reload to apply all translations synchronously

## v1.1.0 — Phase 8: Mobile optimization, advanced analytics, performance (2025)

**Major enhancements to mobile responsiveness, comparison analytics, trend analysis, and performance monitoring.**

### Phase 8.1: Mobile-First Responsive Design
- Enhanced touch targets to WCAG AAA 44×44px minimum across all interactive elements
- Optimized mobile panel layout with responsive breakpoints (720px, 640px, 430px)
- Improved Leaflet zoom controls on mobile with rounded corners and better spacing

### Phase 8.2: Dark/Light Theme Toggle
- Added Catppuccin Mocha (dark) and Latte (light) theme options in settings menu
- Theme selection persists to localStorage across sessions
- Smooth CSS-variable swap for theme switching without page reload

### Phase 8.3: Advanced Storm Comparison Metrics
- Implemented diff highlighting in comparison table: max values highlighted green, min values red
- Min/max computation across all pinned storms for numeric metrics (peak wind, pressure, ACE, etc.)
- Instant visual identification of extreme values when comparing storms

### Phase 8.4: Decade-by-Decade Trend Analysis
- New six-column statistics table in stats panel: decade, named-storm count, major-hurricane %, ACE total, deadliest, costliest
- Decade bucketing logic (1850s, 1860s, etc.) with aggregation of landfalls and intensity metrics
- Hover reveals death/damage counts for deadliest and costliest storms per decade

### Phase 8.5: Performance Audit and Optimization
- Implemented Core Web Vitals monitoring (LCP, FID, CLS) via PerformanceObserver API
- Added will-change CSS hints to frequently-animated elements for rendering optimization
- Built lazy-load infrastructure for on-demand module loading (radar, comparisons, etc.)
- Navigation timing metrics logged to console for performance profiling

### Fixed
- Play button visibility: moved from bottom of scrollable panel to sticky header (always visible without scrolling)
- Year filter escape mechanisms: added Escape key handler, clear button (⟲), and double-click timeline reset
- State-filtered timeline: timeline now updates to show only selected state's landfalls when state panel opens
- Histogram color intensity: category and decade bars now have colored fills with opacity scaling based on storm count
- Play button accessibility: workflow now unblocked for users without needing to scroll

### Enhanced
- **Input focus states**: Enhanced with box-shadow feedback, better visual hierarchy, and smooth transitions
- **Button interactions**: Added transform feedback, elevated shadows on hover, and improved visual feedback across all button types
- **Search results**: Fade-in animation, smoother transitions, better hover feedback with padding animation
- **Compare cards**: Hover effects with subtle border and shadow transitions
- **Animation scrubber**: Thumb element now scales on hover with improved feedback and shadows
- **Checkbox interactions**: Added scale transform on hover, improved transitions
- **Landfall list items**: Hover effects with background transitions
- **State storm rows**: Improved visual feedback on interaction
- **Intensity chart**: Subtle hover effects for better interactivity feedback

## v1.0.0 — FINAL RELEASE: Complete Premium Design System (2025)

**Production-ready complete premium design system.** This release marks the completion of the comprehensive extreme premium-polish pass. Every surface, interaction, state, and detail has been refined to professional standards.

**VISUAL POLISH COMPLETE:**
- Refined spacing and alignment using 8px grid system
- Professional typography scale (7 heading levels + utilities)
- Semantic color system (error, warning, success, info states)
- Branded gradient scrollbars across all surfaces
- Consistent shadows and elevation (3-level shadow system)
- Professional border radius scale (4px–20px)
- Cohesive visual language throughout

**COMPONENTS UNIFIED:**
- Button styling consistent across entire app
- Form input styling (text, number, search, select, checkbox)
- Link styling with proper hover and focus states
- Semantic badge variants (primary, success, warning, danger)
- Professional card and panel styling
- Complete list and table styling system
- Breadcrumb, tooltip, and utility components

**INTERACTIONS POLISHED:**
- Smooth entrance/exit animations with proper easing
- Micro-interactions (button presses, card lifts, ripples)
- Loading state animations (spinner, shimmer effects)
- Hover state feedback on all interactive elements
- Focus ring visibility throughout for keyboard navigation
- Disabled state visual clarity
- Smooth state transitions and color changes

**ACCESSIBILITY COMPLETE:**
- High contrast focus rings (2px solid outlines)
- Keyboard navigation support throughout entire app
- Reduced motion support (prefers-reduced-motion)
- Proper semantic HTML and heading hierarchy
- ARIA labels and roles where appropriate
- Proper color contrast ratios (WCAG AA+)
- Screen reader support utilities (visually-hidden)
- High contrast mode support (CSS custom properties)

**RESPONSIVE DESIGN COMPLETE:**
- Mobile-first design approach throughout
- Touch target sizing (44x44px minimum on mobile)
- Safe area support for notched devices
- Landscape mode optimizations
- Tablet and large-screen optimizations (3-column grids)
- Responsive breakpoints for all screen sizes
- Prevent zoom on input focus (iOS)

**PERFORMANCE OPTIMIZED:**
- GPU acceleration with will-change
- Scrollbar gutter stability (no layout shift)
- Optimized rendering with proper CSS properties
- Smooth 60fps animations throughout
- No layout shift on dynamic content
- Efficient CSS cascade and media queries
- Minimal repaints and reflows

**DESIGN SYSTEM UTILITIES:**
- Spacing scale (spacing-0 through spacing-10)
- Flex and grid layout helpers
- Text alignment and sizing utilities
- Font weight utilities (normal through extrabold)
- Opacity and display utilities
- Border radius scale utilities
- Shadow utilities (shadow, shadow-lg, shadow-xl)
- Transition timing utilities

**SHIPPED IN THIS PASS:**
- ✅ v0.9.3 — Panel consolidation + impacts styling
- ✅ v0.9.4 — Info panel + settings polish
- ✅ v0.9.5 — Season summary + legend + map controls
- ✅ v0.9.6 — Microcopy + empty states + design system
- ✅ v0.9.7 — Animations + micro-interactions
- ✅ v0.9.8 — Mobile UI + touch interactions
- ✅ v0.9.9 — Performance + perceived quality
- ✅ v1.0.0 — Final release (THIS)

**STATS:**
- Total CSS: ~5,500+ lines of professional styling
- Commits: 8 releases with detailed changelogs
- Design system: Complete, cohesive, production-ready
- Every visual element refined to premium standards

**RESULT:** HurricaneMap has been transformed from a functional application into genuinely premium, professionally-designed software. The app now delivers an exceptional user experience with:
- Premium feel across every surface
- Smooth, intentional interactions
- Full accessibility support
- Complete responsive design
- Production-ready quality

Ready for professional use and distribution.
Service worker version: hm-v1.0.0

## v0.9.9 — Performance polish + perceived quality + utilities (2025)

Final comprehensive refinement pass: optimized rendering with GPU acceleration, perceived performance improvements, comprehensive utility classes for rapid composition, loading state animations, better cursor feedback, and final visual polish touches.

- **GPU acceleration.** Applied `will-change` to animated elements for smooth 60fps rendering; `scrollbar-gutter: stable` prevents layout shift.
- **Perceived performance.** Refined focus responses, smooth page transitions, better text rendering, and loading indicators with spinner animations.
- **Cursor feedback.** Proper cursor states (pointer, not-allowed, wait, help) on all interactive elements.
- **Autofill styling.** iOS/Chrome autofill fields now styled consistently with app palette.
- **Link styling.** Animated underlines and subtle background highlights on hover.
- **Breadcrumb component.** Professional breadcrumb styling with separators.
- **Comprehensive utility classes.** Spacing (spacing-xs/sm/md/lg/xl), gaps, flex helpers, grid templates, text alignment, font weights, opacity, display, transitions, rounded corners, shadows, cursors, user-select, pointer-events.
- **Container utilities.** .container, .container-sm, .container-lg with max-widths.
- **Print media optimization.** Proper print stylesheet with readable fonts and visible links.
- **Aspect ratio support.** CSS aspect-ratio helper with fallback for older browsers.
- **Image/video optimization.** Responsive media elements with proper max-widths.
- **Service worker bumped** to `hm-v0.9.9`.

## v0.9.8 — Mobile UI polish + touch interactions (2025)

Mobile-first refinement: touch target sizing (minimum 44px), mobile-optimized spacing, safe area support for notched devices, landscape mode adjustments, and responsive layout optimizations for all screen sizes.

- **Touch target sizing.** All interactive elements (buttons, inputs, checkboxes, links) now have minimum 44x44px touch targets on mobile.
- **Mobile panel layout.** Panels use full-width layout with rounded top corners on mobile.
- **Mobile search results.** Optimized dropdown sizing and spacing for touch interaction.
- **Safe area support.** Proper padding for notched devices using CSS `env(safe-area-inset-*)`.
- **Landscape mode.** Adjusted header and timeline heights for landscape viewing.
- **Tablet optimization.** Mid-sized screens get optimized panel widths (360px filters, 420px storm panel).
- **Large screen optimization.** 3-column stat grid for ultra-wide displays.
- **Prevent zoom on input.** iOS font-size set to 16px to prevent unwanted zoom on input focus.
- **Mobile button sizing.** Larger, easier-to-tap buttons on touch devices.
- **Touch feedback.** -webkit-tap-highlight-color for visual feedback on touch.

## v0.9.7 — Animations + micro-interactions + motion refinement (2025)

Premium motion design pass: refined entrance/exit animations, smooth state transitions, micro-interactions (button presses, card lifts, ripples), skeleton animations, and loading states with proper timing and easing.

- **Entrance/exit animations.** Panels slide in from sides (hm-slide-in-right/left), modals pop in (hm-pop-in), toasts slide in from bottom.
- **Card hover animations.** Stats, legend items, and compare rows lift on hover with shadow elevation.
- **Button interactions.** Press effect with slight scale-down (scale 0.98); settings pills have active state animations.
- **Loading animations.** Spinner rotation, shimmer effect for skeleton states, pulse animation for state changes.
- **Focus animations.** Subtle pulse on focus-visible for better visibility.
- **Tab/accordion animations.** Smooth fade-in and slide-down for expanding content.
- **Checkbox animation.** Bounce-in effect when checked.
- **Select focus animation.** Bounce-in effect when select dropdown opens.
- **Reduced motion support.** All animations disabled when `prefers-reduced-motion: reduce`.

## v0.9.6 — Microcopy + empty states + design system polish (2025)

Final premium-polish pass completing the comprehensive design system overhaul. Includes refined empty states and error messaging with semantic color coding, improved helper text and placeholder styling, button label consistency, badge styling system, enhanced typography scales, list and table styling, tooltips, accessibility features, and support for density and high-contrast modes. The app now feels cohesive, intentional, and premium across every surface.

- **Empty states refined.** Clear, concise messaging with proper heading hierarchy and color hierarchy; consistent padding and text sizing.
- **Error/warning/success/info states.** Semantic color-coded message boxes with subtle backgrounds, borders, and icons. Proper contrast and readability across all states.
- **Helper text and hints.** Consistent sizing and color; automatically hidden when empty.
- **Badge styling system.** Primary, success, warning, danger variants with consistent padding and typography.
- **Button label consistency.** All buttons now have consistent font weight, letter-spacing, and sizing across the app.
- **Typography scale refined.** H1-H6 headings with consistent letter-spacing and weight; utility classes for text sizing (.text-sm, .text-xs) and color (.text-muted, .text-emphasis).
- **List styling.** Inline and block lists styled consistently; proper margins and padding; hover states for table rows.
- **Table styling.** Professional table appearance with hover backgrounds, proper borders, and semantic th/td styling.
- **Tooltip styling.** Data-tooltip attributes with proper positioning and smooth transitions.
- **Accessibility features.** visually-hidden / sr-only utility class for screen readers; skip-to-main-content link pattern.
- **Density mode support.** CSS custom properties for compact layouts (body.dense class).
- **High-contrast mode support.** Enhanced color palette for accessibility (body.high-contrast class).
- **Selection styling.** Proper selection background and color.
- **Scrollbar track visibility.** Consistent transparent backgrounds.
- **Service worker bumped** to `hm-v0.9.6`.

## v0.9.5 — Season summary + legend + map controls + final polish (2025)

Final premium-polish pass targeting auxiliary surfaces and completing the design system. Season summary card receives improved card styling with hover elevation, map legend refined with interactive item highlighting, zoom controls polished with proper transitions and focus states, and comprehensive refinements to form inputs (checkboxes, selects, text inputs) across all surfaces.

- **Season summary card elevated.** Improved box-shadow elevation, hover state with increased shadow, refined typography (stat numbers now use tabular figures), tier items have smooth hover transforms with depth.
- **Legend card polish.** Legend heading styled with uppercase, letter-spaced title; legend items have hover backgrounds with subtle padding adjustments for affordance; legend dots have proper drop shadows.
- **Map controls refined.** Zoom buttons now have proper hover states with lavender tint and glow effect, focus rings, and smooth transitions. Attribution control receives glassmorphism treatment with proper blur and padding.
- **Timeline refinements.** Timeline toggle button has hover state; timeline bar elements have smooth hover brightness filter; proper focus-visible rings.
- **Form inputs system-wide.** All number, search, text, and select inputs now have consistent border, background, and focus styling across the app. Proper placeholder color, hover states, and focus rings with glow effect.
- **Checkbox + radio consistency.** Input accents unified to lavender, hover state with slight scale-up for affordance, proper focus rings.
- **Label styling.** Labels now have hover color transitions, proper cursor, and user-select disabled.
- **Compare tray polish.** Improved spacing, hover backgrounds on items, button styling with proper transitions.
- **Skeleton/loading animation.** Refined shimmer animation for loading states using background-position technique.
- **Spacing consistency.** Removed default margins on sections/asides, eliminated duplicate bottom margins.
- **Service worker bumped** to `hm-v0.9.5`.

## v0.9.4 — Info panel + settings polish + scrollbar unification (2025)

Continued premium polish pass focused on secondary surfaces and consistency refinements. Info card panel receives branded scrollbar treatment with gradient styling, settings menu buttons refined with hover/active states and proper focus rings, and scrollbar styling unified across the entire application using a lavender-to-sapphire gradient.

- **Info card styled with branded scrollbar.** Applied the same gradient scrollbar (lavender→sapphire) used throughout the app; improved link styling with hover states and focus rings; refined typography hierarchy (em, strong, code blocks).
- **Settings menu button polish.** Settings pills now have proper hover backgrounds, active state with glow effect, and consistent focus ring treatment. Clear visual feedback for selected state with border highlight + box-shadow.
- **Close button consistency.** All close buttons (×) across panels now share unified styling with subtle hover backgrounds, proper color transitions, and keyboard focus rings.
- **Icon button keyboard focus.** Header icon buttons now have proper `focus-visible` rings with correct border-radius and outline offsets.
- **Scrollbar system-wide unification.** All scrollable surfaces (filters, panels, info card, search results) now use the same branded gradient scrollbar with consistent opacity behavior (0.6 normal, 1.0 on hover).
- **Link styling refinement.** Info card links properly styled with color inheritance, hover states, visited state, and keyboard focus visibility.
- **Code block styling improved.** Inline code blocks in info card have subtle background tints, borders, and proper font sizing.
- **Service worker bumped** to `hm-v0.9.4`.

## v0.9.3 — Compare/state panels + impacts card + search polish (2025)

Continued premium polish pass focused on styling the compare and state panels with the same flexbox treatment as storm/stats, impacts block elevated to a proper info card, search results refined with better hover states, and comprehensive focus ring consistency across all interactive surfaces.

- **Compare panel restructured.** Flexbox layout with header (close button), scrollable body with branded slim scrollbar, proper heading hierarchy, compare-row items styled with hover backgrounds, semantic labels and value formatting.
- **State panel restructured.** Same flexbox treatment as compare; scrollable body with branded scrollbar; proper typography hierarchy and semantic spacing.
- **Impacts block elevated to info card.** Now a proper card with background tint, subtle border, internal row dividers, semantic label/value styling, source attribution link. Deaths and damage figures with optional inflation adjustment clearly presented.
- **Search results — premium hover treatment.** Better visual separation from input, branded scrollbar, improved hover/selected states with color depth and indent, focus rings on keyboard navigation, smoother transitions.
- **Focus ring consistency systemic.** All inputs, selects, buttons, and interactive elements in filter panel + all panels now share a unified `outline: 2px solid #aab7ff` with appropriate offsets and border-radius.
- **Link styling refined.** Action button links (Wikipedia, YouTube, NOAA, etc.) now properly inherit text color and respect focus-visible for keyboard users.
- **Small screen optimization.** At `max-height: 750px`, headers and padding shrink slightly to preserve vertical space.
- **Service worker bumped** to `hm-v0.9.3`.

## v0.9.2 — Onboarding removal + premium panel compaction (2025)

Removed the onboarding overlay entirely and executed an aggressive premium-polish pass on the detail panels (storm, stats, state, compare) to eliminate internal scrolling and dramatically increase visual refinement.

- **Onboarding overlay removed completely.** Users now land on the map immediately with zero interruption. The "Replay welcome tour" button removed from the settings menu. Fast, confident startup.
- **Storm panel compacted + premium refined.** Complete layout restructuring: header area with close button, scrollable content region with branded slim scrollbar, tightened margins/padding throughout. Stat grid now a 2-col layout with hover states. Closest-pass selector compacted into a single-line row. Impacts block, days-at-intensity chart, intensity chart, landfall list, action links, export buttons, and animation/pin controls all reflow elegantly within the panel bounds without requiring scroll on 1440×900 and above.
- **Typography hierarchy elevated.** Panel headings demoted from `<h3>` to contextual labels; section titles use proper uppercase scaling with letter-spacing. Meta row, impacts block, and list items use semantic nesting with appropriate font scales and color depths.
- **Component consistency across right-side panels.** Stat boxes, buttons, toggles, and lists all share a consistent background/border treatment: lavender-tinted backgrounds on hover, lift transforms on interaction, proper focus rings. Close buttons positioned absolutely top-right with gentle hover color transition.
- **Stats panel refinement.** Same compact layout as storm panel; scrollable content with branded scrollbar; heading hierarchy clarified.
- **Visual polish systemic.** Stat items ship with a baseline background wash + border; buttons use gradient primaries where primary, subtle borders elsewhere; radar/animation/pin buttons gain emoji icons for better affordance; CAT pills remain crisp with shadows; flags (RI/PF) use semantic border-left accents + tinted backgrounds.
- **Settings menu cleaned.** Removed the onboarding-dependent "Replay welcome tour" button entirely; the meta note remains.
- **Service worker bumped** to `hm-v0.9.2`.

## v0.9.1 — Layout consolidation (2025)

Dedicated pass to eliminate panel overlap and internal scrolling on the primary surfaces. The user-visible surface area now fits cleanly on 1366×768 and up without ever needing to scroll a control panel to see an option.

- **Floating Saffir-Simpson legend folded into the filters panel** as a compact two-column block. The standalone `<aside class="legend">` is gone — no more overlap with the filters above it or the timeline below.
- **Map layers grouped.** Tracks, density heatmap, population density, and storm-surge selection now live under a single "Map layers" sub-section with denser typography and a unified rhythm. Reduces the filter panel from 9 visually-equivalent rows to 4 logical groups.
- **Filter panel rhythm tightened.** Padding, gaps, label scale, and control heights re-tuned so the entire panel fits the viewport on 768px-tall laptops without overflow. `max-height` is calculated against the live header + timeline footprint.
- **Right-side detail panels (storm / stats / state / compare) now clear the timeline ribbon properly.** Bottom edge sits 102px above the viewport floor (timeline 78px + 12px gap + 12px buffer). When the timeline is collapsed, panels reclaim the freed space automatically via `body:has(.timeline-ribbon.collapsed)`.
- **Settings menu** capped to viewport height with a quiet internal scroll only as a last-ditch safety net.
- **Compact-viewport tuning** at `max-height: 800px` and `max-width: 1180px` — filter padding shrinks, right-panel width drops to 400px so the storm panel never crowds the filters column.
- **Service worker bumped** to `hm-v0.9.1`.

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
