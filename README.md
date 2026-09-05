# HurricaneMap

[![Live demo](https://img.shields.io/badge/live%20demo-sysadmindoc.github.io%2FHurricaneMap-cba6f7.svg)](https://sysadmindoc.github.io/HurricaneMap/)
[![Version](https://img.shields.io/badge/version-1.9.3-blue.svg)](https://github.com/SysAdminDoc/HurricaneMap/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-web-lightgrey.svg)](#)
[![Data](https://img.shields.io/badge/data-NOAA%20HURDAT2-orange.svg)](https://www.nhc.noaa.gov/data/)

> **174 years of U.S. hurricane landfalls**, every dot drawn directly from NOAA's HURDAT2 best-track database (1851–2025).
>
> **Live demo:** https://sysadmindoc.github.io/HurricaneMap/

<img width="1440" height="960" alt="HurricaneMap operational atlas with labeled navigation, dataset context, and historical timeline" src="example.png" />
<br>
<img width="1440" height="960" alt="HurricaneMap storm detail workspace with structured metrics and a map-preserving lane" src="examplemap.png" />


## What this is

A static, interactive web map that plots **every recorded hurricane and tropical-storm landfall on U.S. soil**, drawn straight from the National Hurricane Center's HURDAT2 best-track database — the same source the NHC uses for its post-season analyses.

Click any dot and you get the storm's full track, its peak intensity, every U.S. landfall it made (chronological), and one-click jumps to the Wikipedia article, YouTube footage search, NOAA Tropical Cyclone Report, and the NHC storm wallet.

## Quality plan

The active quality improvement tracker lives in [`docs/QUALITY_IMPROVEMENT_PLAN.md`](docs/QUALITY_IMPROVEMENT_PLAN.md). It covers regression automation, data contracts, URL state, data provenance, service-worker update UX, accessibility coverage, visual snapshots, and maintainability work.

The app uses an offline-first service worker. Runtime historical lookup data is preinstalled into compressed IndexedDB with CacheStorage fallback, while large local radar PNGs and the raw HURDAT2/release-manifest source bundle are cached only after an explicit user action. Each launch verifies the shell/data release tuple and labels it intact, evicted, stale-but-valid, or invalid; diagnostics offers one-click repair, and storm panels report how many radar frames are cached. Settings reports browser usage/quota, protects the core shell/data scopes, and exposes a 13 MB cap for the optional source bundle alongside independent tile/radar cleanup; an opened radar timeline can save an explicit, bounded per-storm offline pack. When shell or offline-data assets change, bump `SW_VERSION` in `sw.js`; installed users will then see an in-app reload prompt instead of silently staying on stale UI.

Persisted browser state has an explicit compatibility contract: settings, search history, and preparedness data use schema-versioned envelopes; legacy unversioned records migrate in place, while unknown future versions remain untouched and load safe defaults. Shared URL hashes emit `v=1` plus the full release-manifest SHA-256 as `rel=...`, continue to accept legacy unversioned links, and ignore unsupported future versions. Advisory replay adds a bounded `replay=1.STORM_ID.ORDINAL.CONE_ERA` sub-state, so a copied link reopens the same issued forecast beside the final HURDAT2 track without storing user location or local state. Generated data must match the schema in `src/schema-contract.js`, and service-worker activation removes superseded caches and IndexedDB generations only after the replacement shell and offline data install.

The settings menu can save up to 20 named views on the current device. A view restores filters, map-layer choices, display units, and up to four comparison storms; it can be deleted or exported as versioned JSON. Saved views never include evacuation addresses, selected points, or other location coordinates.

The primary document denies form submissions with its CSP. The Cloudflare Worker and the bundled self-hosting server also emit the response CSP, including `frame-ancestors 'self'`; deployments using another CDN or static server must preserve that response header because `frame-ancestors` cannot be enforced from a meta tag.

Local verification:

```bash
npm install
npm test
```

Fast non-browser verification:

```bash
npm run build
```

That runs all 84 release gates through `scripts/run-gates.mjs` and reports every one of them, so a single red gate can't hide the state of the rest. Each gate prints a pass or fail line with its duration, failures are repeated in full at the end, and the run exits non-zero if any failed. The runner also refuses to start if a `check:`, `validate:`, or `test:` script exists that neither the gate list nor the browser-lane exclusion list claims. A gate nothing runs is not a gate.

## Highlights

- **595 storms · 759 landfall events · 374 hurricane-strength landfalls** spanning 1851–2025.
- Both **Atlantic** and **Eastern North Pacific** HURDAT2 basins ingested (so storms like Iniki '92 on Kauai are included).
- **Inferred-landfall detection** for storms whose 6-hourly track grazes U.S. land between synoptic times — fixes Iniki and similar Pacific landfalls that don't carry an explicit `L` marker in HURDAT2.
- **Hotspot / cold-spot analysis**: ranks every coastal state, lists ones that have never recorded a hurricane-strength landfall (Delaware, Maryland, Virginia, New Hampshire, Pennsylvania, DC).
- **Multi-state tracking** for storms like Andrew (FL → FL → LA), Charley (FL → FL → SC → SC), Hugo (PR → PR → SC), Katrina (FL → LA → LA).
- Per-segment **intensity-coloured tracks** — you can see exactly where a storm intensified, peaked, and weakened.
- **Track animation** — opt-in playback of a spinning hurricane glyph and translucent wind-field disk that travels the full path, both sized in real-time by Saffir-Simpson category at each track point. Starting playback collapses the storm panel to a restore tab and promotes radar sync, speed, restart, close, and scrubber controls into a compact map dock.
- **📡 Archived NEXRAD radar — full-storm timeline, offline-capable** — every storm from August 1995 onward ships with **every in-coverage 6-hourly track frame** baked into the repo. Click 📡 next to any landfall and the loop animates the entire U.S. passage of that storm from genesis-in-coverage to dissipation, with the map auto-panning to follow the eye. Katrina '05 plays back 22 frames over five days; Helene '24 shows the eyewall crossing the Big Bend. **No internet required after `git clone`.** Frames not in the local archive transparently fall back to live IEM URLs.
- **Live GOES satellite background** — when active storms exist, an opt-in setting overlays current NOAA/NESDIS/STAR GOES GeoColor sectors behind the official advisory track/cone. Atlantic, Eastern Pacific, and Central Pacific active storms automatically choose the closest live sector; see [`docs/GOES_REALTIME.md`](docs/GOES_REALTIME.md).
- **📈 Intensity time-series chart** — inline SVG in every storm panel showing wind (kt) + pressure (mb) over the storm's life, with category-colored dots, dashed pressure line (inverted so deeper storms read higher), Cat 1-5 reference bands, vertical landfall markers, and a hover crosshair tooltip.
- **🌀 Compare mode** — pin up to 4 storms, see their tracks color-coded on the map, side-by-side stat tables, mini intensity charts. Andrew '92 vs Katrina '05 vs Michael '18 in one view.
- **🔥 Density heatmap** — toggle a Catppuccin-tinted heat layer weighted by Saffir-Simpson category to show landfall hotspots vs cold spots.
- **🗺️ State deep-dive** — click any state polygon (or pick from the filter), get a panel with that state's full landfall history: by-category histogram, by-decade trend, top-5 worst on record, every storm sortable.
- **🌊 SLOSH MOM storm surge zones** — overlay NHC's Cat 1-5 maximum-of-maximums inundation maps along the U.S. Gulf and East Coast, plus the dedicated Hawaii (Cat 1-4) and Puerto Rico/USVI regional grids. Powered by NOAA's pre-rendered ArcGIS tiles — picking a category snaps the worst-case envelope into view.
- **🌬️ Wind-field swaths** — for storms 2004+, a checkbox in the storm panel renders the actual HURDAT2 wind-radii analysis (34/50/64 kt asymmetric quadrants per track point) as overlapping polygons along the path.
- **🛰️ ✈️ 🍝 🌪️ Quicklinks** — every storm panel links out to GOES satellite imagery (RAMMB SLIDER, 2018+), NOAA Storm Events tornado search filtered to the storm's dates + states, Hurricane Hunters recon archive (Tropical Atlantic mirror), Wikipedia, YouTube footage search, NOAA Tropical Cyclone Reports, and the NHC storm wallet.
- **⚠️ Impacts data** — raw Wikipedia infobox deaths/damage text plus normalized numeric fields, source title/URL, parse time, units, qualifiers, and confidence reasoning (244 storms covered so far; missing means unavailable, not zero; rerun `scripts/scrape_impacts.py` to fill in more).
- **📏 Observed high-water marks** — 25 modern storms (Katrina, Harvey, Sandy, Ian, Helene…) carry a toggleable layer of surveyed USGS peak-water elevations (10,700+ marks, elevation-colored, coastal vs riverine) — the ground truth to compare against the modeled SLOSH surge zones. Preprocessed from the USGS Short-Term Network (`scripts/build_hwm.py`), works offline.
- **🌊 Tide-gauge water levels ("what the water did")** — for 1990+ storms, load NOAA CO-OPS observed hourly water levels vs the predicted astronomical tide at the 2-3 gauges nearest the strongest landfall, with the peak surge residual called out (Katrina: Grand Isle +3.8 ft, S.W. Pass +4.9 ft at the Aug 29 landfall hour). Fetched live on demand — never automatically.
- **💰 Billion-dollar disasters** — 65 landfalling storms joined to NOAA NCEI's U.S. Billion-Dollar Weather and Climate Disasters record (1980–2024, CPI-adjusted to 2024 USD, official death tolls). The NCEI product was retired in May 2025, so the dataset is frozen and ships with the repo (`scripts/build_billions.py`).
- **📊 Seasonal outlook freshness** — the bundled NOAA/CSU outlook and NOAA CPC ENSO snapshot carry explicit issue and validity dates; `npm run validate:data` warns when an in-season outlook exceeds 45 days and fails a release after either snapshot's `valid_until` date. The stats card shows each issue/validity date and links to the current NOAA CPC product.
- **🚨 Active storm tracking** — when NHC reports active storms, a pulsing badge appears with the official cone/track, Potential Tropical Cyclone support, advisory/discussion/name-pronunciation/rip-current links, an optional GOES backdrop, hourly feed checks, and retry/backoff status.
- **📍 Point-specific NHC wind guidance** — right-click/long-press the map or use device location to see current official 34/50/64 kt cumulative probability bands and the nearest 34 kt earliest-reasonable/most-likely arrival contours. Device coordinates stay in the tab session by default; an explicit option can remember only latitude/longitude for up to 24 hours, with a clear control. Issue time, contour distance, source links, and an explicit impact-forecast caveat are always shown; stale or offline products fall back to links without displaying old values.
- **❎ NHC tropical outlook + marine warnings** — official formation disturbances render with the NHC's 2026 gray-X treatment for near-0% systems; an opt-in layer adds the 0–24 hour offshore wind-warning zones.
- **📐 Measured forecast-skill retrospective** — each historical storm shows its basin's official NHC 2021–2025 OFCL track and intensity errors by lead time, sample sizes, definitions, and source files. A separate control retains the clearly labeled illustrative 2015/2025/2026 cone-radius reconstruction.
- **〰️ Animated risk trajectories** — an opt-in education mode replaces the cone boundary with 20 deterministic plausible center paths, scaled to the selected error era and automatically rendered without motion when reduced motion is preferred.
- **🎒 Offline preparedness planner** — a device-local EN/ES/Kreyòl checklist and household calculator sizes water and food for a three-day evacuation kit or two-week stay-at-home kit, with progress available after a fully offline reload.
- **📍 Official evacuation-zone lookup** — enter a Florida address or choose a map point to query the state-published evacuation-zone layer, with a clear Esri address-transmission disclosure, a coordinate-only path, labelled outage fallback, and official sources for Florida, North Carolina, South Carolina, Georgia, Texas, Virginia, Maryland, and Massachusetts.
- **🖼️ Filtered track gallery** — render the current historical filter set as a stylized 1800×1200 all-tracks density poster, then export a PNG with NOAA/NHC HURDAT2 attribution embedded in the artwork.
- **Progressive anchored controls** — header hints use `popover="hint"` and CSS anchor positioning in current browsers without closing the settings flyout, with equivalent fixed-position behavior retained for older engines.
- **⚠️ 2026 cone standard: coastal + inland watches/warnings** — matching the NHC's 2026 operational cone graphic, active storms overlay tropical-storm/hurricane watch and warning zones (including inland zones, CONUS/HI/PR/USVI) from `api.weather.gov`, with the official pink/blue diagonal hatch where a Hurricane Watch overlaps a Tropical Storm Warning, and an on-map legend.
- **👥 Population density** — toggle the SEDAC GPWv4 1km gridded-population overlay to see how many people live in each storm's path / surge zone.
- Search by name OR year. Filter by year range, Saffir-Simpson category, or state.

## What's new in v1.9.3 - Metric parity and maintainability (2026-08-08)

- **Metric parity:** comparison cards, side-by-side rows, and CSV exports now share one typed metric contract with unit-aware formatting for derived ACE, translation, and rapid-intensification values, backed by field-level parity checks across locales and wind units.
- **Archive coverage:** `data/coverage.json` records each bundled dataset's source/revision, basin and year range, measured records/storms/frames/advisories/marks, lifecycle/value status, end date, and core/full distribution. The About dialog and offline diagnostics render the same facts, and exports plus STAC summaries carry the key coverage counts.
- **Playwright acceptance:** offline tests route a service-worker-owned IEM tile through the browser context, and ARIA snapshots cover storm details, settings, and advisory replay in English, Spanish, and Haitian Creole.
- **Visual and release checks:** the 16 Windows/Chromium visual baselines are lossless WebP, while platform-aware runners skip them clearly on Linux/macOS and release metadata stays synchronized across the app shell and data bundle.

Earlier release history is maintained in the [CHANGELOG](CHANGELOG.md).

## Quick start

The map is **already published** on GitHub Pages — open https://sysadmindoc.github.io/HurricaneMap/ and you're done.

To run locally (e.g. after refreshing the HURDAT2 data):

```bash
# Clone
git clone https://github.com/SysAdminDoc/HurricaneMap.git
cd HurricaneMap
npm install

# Check NOAA for newer HURDAT2 source files.
# Use --apply before preprocessing when a new revision is detected.
node scripts/refresh-hurdat2.mjs --dry-run

# Rebuild derived JSON after raw HURDAT2 data changes. --apply also updates
# data/hurdat2-sources.json with the exact upstream filenames and SHA-256 values.
# (Already pre-built JSON lives in data/ so you can skip this step entirely.)
python scripts/preprocess_hurdat2.py --generated-at 2026-08-02T00:00:00Z

# Serve locally with the app's CSP and cache headers — `fetch()` won't work
# over file:// in modern browsers. Plain `python -m http.server` is not an
# equivalent deployment server.
python serve.py --port 8765
# open http://127.0.0.1:8765/
```

Use `node scripts/refresh-hurdat2.mjs --dry-run` to check NOAA's HURDAT2 directory locally. When source files change, rerun with `--apply`, rebuild derived JSON with an explicit timestamp such as `python scripts/preprocess_hurdat2.py --generated-at 2026-08-02T00:00:00Z`, then validate with `npm test`.

### Distribution profiles

Run `npm run dist:core` for the complete historical catalogue and offline application without bundled radar PNGs. Its deployable payload is about 23 MB because the three-file source bundle remains available for an explicit download, while the mandatory service-worker install is about 3 MB; `data/distribution.json` reports the exact payload and mandatory byte totals, the 13 MB source-pack cap, and radar counts. Run `npm run dist:full` for the approximately 526 MB deployment with all 1,700+ archived radar frames. Both commands require a clean tracked tree, stage deployable content under `dist/core` or `dist/full`, and write the same schema-versioned `data/distribution.json` contract, validated by `schemas/distribution-v1.schema.json`, with the profile-specific source commit and capability flags. Payload totals intentionally exclude the descriptor and release manifest themselves; those generated metadata files are still covered by `data/release-manifest.json`. The tracked source tree carries the full-profile descriptor; refresh it with `node scripts/build-distribution.mjs --write-source`, which also synchronizes its release-manifest hashes. The core build retains live IEM radar fallback when online and ships an empty local radar manifest so it never claims unavailable offline frames.

The PWA manifests use the stable relative identity and scope `./`, so installs remain tied to the deployed app root on GitHub Pages, a subpath, or self-hosting. `manifest.webmanifest`, `manifest.es.webmanifest`, and `manifest.ht.webmanifest` localize installed names, screenshots, and shortcuts for the three supported interface locales; the app switches the manifest link when the locale changes. `npm run check:manifests` and the distribution/browser checks verify that every icon, screenshot, and shortcut target resolves in both profiles.

Either staged directory can be served directly or used as the Docker build context with the included `Dockerfile`, for example `docker build -t hurricanemap-core dist/core`.

Optional edge deployment: [`docs/CLOUDFLARE_CDN.md`](docs/CLOUDFLARE_CDN.md) documents the Cloudflare Worker CDN wrapper, cache policy, image optimization hints, and curl checks for before/after latency validation.

Self-hosting: [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) documents the Docker image, port mapping, healthcheck, and offline/intranet deployment notes.

Live satellite backdrop: [`docs/GOES_REALTIME.md`](docs/GOES_REALTIME.md) documents the opt-in NOAA/NESDIS/STAR GOES sector overlay, source URLs, refresh cadence, and static-app tradeoffs.

### Dependency security policy

Runtime mapping code is deliberately pinned: Leaflet 1.9.4 is vendored locally for offline use, while Cesium 1.144 is loaded only for the optional globe with exact script and stylesheet integrity hashes. The disputed Leaflet advisory record (with its `check:popup-sinks` compensating control) and Cesium release/SRI decision are recorded in [`security/dependency-security-policy.json`](security/dependency-security-policy.json). Updating either requires checking its upstream license/release, changing the complete pinned asset pair, updating that decision record, and passing the desktop/mobile map and globe smokes.

Cesium also runs under least privilege. Because its bundled Knockout needs `unsafe-eval`, the globe is confined to a separate `globe.html` document embedded as `sandbox="allow-scripts"` — an opaque origin with no access to the application's DOM, storage, cookies, or service worker. The two documents exchange only a versioned `hm-globe-v1` message envelope, with both sides validating source, origin, message type, and payload shape. The application document itself runs `script-src 'self'` and grants no third-party script host at all; `npm run test:globe-protocol` fails the build if that boundary regresses.

Build and test dependencies use maintained npm release lines: esbuild 0.28.2 (MIT), Playwright and Playwright Test 1.62.1 (Apache-2.0), and axe-core Playwright 4.12.1 (MPL-2.0). `npm run check:security` runs the live `npm audit --json --audit-level=high` gate and falls back to the lockfile-bound, time-bounded snapshot in `security/npm-audit-snapshot.json` when the advisory service is unavailable; `npm run check:security:offline` exercises the deterministic snapshot path directly. Both commands also verify the reviewed Leaflet/Cesium versions, hashes, SRI values, licenses, and decision expiry. Before merging an update, run `npm outdated`, `npm run check:security`, and `npm test`; the latter includes a lockfile/vendor security and license audit, bundle budget, browser accessibility/layout checks including locale-aware ARIA snapshots, the deterministic desktop/mobile visual matrix for shell, storm, statistics, comparison, settings, advisory replay, playback, light, dark, and high-contrast states, the local Chromium/Firefox/WebKit contract matrix, offline service-worker check, and Cesium globe smoke. `npm run test:browser-matrix` reports each engine's shell/manifest/search/panel and offline-cache result separately, explicitly naming unsupported capabilities. The visual fixture aborts external requests, stubs the map renderer, masks live chrome, and uses a 0.1% maximum pixel-diff ratio. Checked-in lossless WebP baselines are intentionally Windows/Chromium-specific; `npm run test:visual` and `npm run test:visual:update` run on Windows and emit a clear successful skip on Linux/macOS to avoid false cross-platform pixel failures. `package.json` requires Node.js 22 or newer. Playwright 1.62+ only needs Node 20, but that line reached end of life on 2026-04-30, so the floor tracks a supported release instead. Vendored library and font notices, versions, sources, and font hashes are recorded in [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt).

## Data Export & Research

**Export filtered data as publication-ready CSV:**

HurricaneMap includes a one-click CSV export button (📄 icon in the header) that downloads your filtered dataset with:

- **Full documentation:** data dictionary, methodology notes, NOAA citation, attribution requirements
- **All landfall fields:** storm ID, name, year, month, day, hour, latitude, longitude, wind speed (kt/mph), pressure, Saffir-Simpson category, state
- **Timestamped filename:** `HurricaneMap-Export-YYYY-MM-DD.csv`
- **Proper CSV escaping:** handles commas, quotes, and newlines

Perfect for:
- Academic research papers (includes full HURDAT2 citation)
- Climate & seasonal analysis
- Geographic & statistical software (ArcGIS, R, Python, QGIS)
- Spreadsheet analysis (Excel, Google Sheets)

See [LICENSE.md](LICENSE.md#how-to-cite-hurricanemap) for citation formats.

Every analytical panel and the About surface includes a collapsed **Cite this release** control with copy-ready APA and BibTeX text. Both formats carry the HURDAT2 revision date, Atlantic and Eastern Pacific source SHA-256 values, HurricaneMap version, access date, and a release-pinned URL. The storm-panel Share view link carries the same `rel` pin alongside its filters, opened storm, comparison set, and advisory replay state.

Versioned JSON Schema 2020-12 contracts for build metadata, archive coverage, storms, landfalls, normalized impacts, saved-view exports, STAC documents, and the release checksum manifest are published under `schemas/`. `data/coverage.json` is generated by `npm run generate:coverage` from the canonical source artifacts, while `data/release-manifest.json` records every shipped data artifact’s byte count, SHA-256, source URL/date, generated timestamp, and schema version; it travels with the raw HURDAT2 files in the optional source bundle and is fetched transiently by the service worker only to verify the runtime subset. `npm run validate:schemas`, `npm run test:coverage`, and `npm run check:release-manifest` enforce these contracts; after an intentional data refresh, regenerate coverage and checksums with an explicit reproducible timestamp, for example:

```bash
npm run generate:coverage
node scripts/generate-release-manifest.mjs --generated-at 2026-08-08T00:00:00Z --source-commit "$(git rev-parse HEAD)"
```

QGIS GeoJSON export is checked against RFC 7946’s WGS 84 longitude/latitude order, geometry structure, coordinate bounds, and prohibition on alternate `crs` declarations.

The static [`data/stac/catalog.json`](data/stac/catalog.json) exposes HURDAT2 tracks/landfalls and archived NEXRAD frames as a standards-based [STAC 1.1.0](https://github.com/radiantearth/stac-spec) catalog. Its HURDAT2 and radar collection summaries repeat the canonical archive year, basin, count, and value-status facts from `data/coverage.json`. The application entry point advertises it with an `application/json` alternate link in `index.html`, and the same relative entry point is included in both the core and full releases. Collection and item links are relative, so the catalog works from a checked-out repository, a core release, or a full release without a server. Each asset records its source URL/date, public-domain license, release availability, byte count, and SHA-256; radar PNG assets are marked `full` while their spatially indexed metadata remains in `core`. Run `npm run check:stac` to validate navigation, geometry, manifest coverage, and asset checksums; regenerate coverage with `npm run generate:coverage`, then regenerate the deterministic files with `npm run generate:stac` before regenerating the release manifest.

Every research export (publication CSV, statistical Markdown report, QGIS GeoJSON, SVG track, and storm CSV/GeoJSON/KML exports) carries a schema-versioned provenance block or citation metadata. It records the app version, export time, data-release timestamp, release-manifest SHA-256, source commit, the relevant artifact byte counts/hashes/source URLs/dates, the compact archive-coverage catalog and dataset status/count facts, and the export methodology, with copy-ready APA and BibTeX text. It contains no saved views, preparedness state, addresses, or local filesystem paths. Run `npm run check:export-provenance` to verify the embedded release identity and coverage summary against the checked-in manifest/data, `npm run test:export-provenance` for provenance, and `npm run test:citation` for citation parity.

### Notebook analysis

The starter notebook uses Python 3.11+ with a pinned pandas, NumPy, Matplotlib, Pillow, and Jupyter Notebook environment. From the repository root, install everything with one command:

```bash
python -m pip install -r requirements-notebooks.txt
```

Then run `python -m notebook notebooks/analysis-starter.ipynb`. The setup cell emits the same APA and BibTeX release citation as the browser and exports. The release gate can execute the same notebook twice without network access, using disposable output directories, and verify the 595-storm, 759-landfall, 374-hurricane-strength, and release-provenance contract:

```bash
npm run test:notebook
```

Pillow is included because the repository's radar-transparency, placeholder-branding, and radar preprocessing tools import `PIL`; keeping it in the same pinned environment avoids a separate undocumented setup path. If notebook execution packages are absent, the command reports them separately from a data-contract failure.

## Project layout

```
HurricaneMap/
├── index.html              # entry — map shell
├── manifest.webmanifest    # English PWA manifest (stable id/scope)
├── manifest.es.webmanifest # Spanish PWA labels/shortcuts
├── manifest.ht.webmanifest # Haitian Creole PWA labels/shortcuts
├── src/
│   ├── main.js             # app boot, canonical filters/hash, data/map orchestration
│   ├── filter-controller.js # filter-control DOM wiring and state-option population
│   ├── shell-ui.js         # injected top-level control and export wiring
│   ├── about-ui.js         # provenance and archive-coverage About rendering
│   ├── compare-rows.js     # typed comparison metrics shared by panel and CSV
│   ├── data.js             # JSON loaders + index helpers
│   ├── citation.js         # release citation and data-pin authority
│   ├── citation-ui.js      # shared APA/BibTeX panel controls
│   ├── map.js              # Leaflet map, markers, tracks
│   ├── panel.js            # storm data composition + Wikipedia/YouTube/NOAA links
│   ├── panel-controls.js   # rendered storm controls, replay, and panel exports
│   ├── animation.js        # spinning hurricane glyph + wind-field disk along the track
│   ├── radar.js            # NEXRAD overlay — local manifest first, IEM fallback
│   ├── stats.js            # state hotspot / decade / category breakdowns
│   ├── styles.css          # explicit cascade-layer entry point
│   └── styles-*.css        # tokens, base, shell, components, themes, accessibility
├── data/
│   ├── hurdat2-atlantic.txt    # optional source bundle: raw NOAA Atlantic best-track
│   ├── hurdat2-nepac.txt       # optional source bundle: raw NOAA Eastern Pacific best-track
│   ├── us-states.geojson       # US state polygons (point-in-polygon attribution)
│   ├── landfalls.json          # flat list, one entry per US landfall event
│   ├── storms.json             # full track + metadata for every US-landfalling storm
│   ├── stats.json              # pre-computed stats: by state, decade, category, cold spots
│   ├── metadata.json           # generated source provenance, coverage, and output metadata
│   ├── coverage.json           # per-dataset archive ranges, counts, statuses, and distribution
│   ├── distribution.json       # canonical profile, payload, capability, and radar contract
│   ├── stac/                    # static STAC catalog, collections, and per-frame items
│   └── radar/                  # archived NEXRAD composites (~512 MB, 1700+ frames)
│       ├── manifest.json           # storm_id → {landfalls, frames}
│       ├── Katrina-2005/           # one folder per storm
│       │   ├── t_200508241800.png
│       │   ├── t_200508250000.png
│       │   └── ...
│       └── ...
├── schemas/                # published JSON Schema 2020-12 data contracts
├── scripts/
│   ├── refresh-hurdat2.mjs   # NOAA HURDAT2 detector/downloader for local refreshes
│   ├── preprocess_hurdat2.py   # HURDAT2 parser + landfall attribution + stats roll-up
│   ├── build_aoml_landfalls.py # AOML HTML ground-truth parser + landfall validation
│   ├── test_aoml_landfalls.py  # Offline parser, metric, and C-marker contract tests
│   ├── scrape_impacts.py       # Wikipedia impact scraper + normalized fatality/damage fields
│   └── scrape_radar.py         # IEM NEXRAD scraper — populates data/radar/
└── examplemap.png          # design reference
```

### Module ownership

`main.js` is the only owner of canonical filters, shared-hash state, visible-landfall state, and map redraw orchestration. `filter-controller.js` owns filter-control DOM wiring and state-option population; `shell-ui.js` owns top-level DOM actions through injected loaders and callbacks; neither calculates metrics. `about-ui.js` owns provenance and archive-coverage rendering, while `compare-rows.js` owns the typed comparison metric contract consumed by both the panel and CSV serializer. `panel.js` owns storm markup/data composition, while `panel-controls.js` owns listeners for controls created by that markup, including replay, playback, and panel exports. `citation.js` owns the release citation and permalink identity; `citation-ui.js` mounts its shared controls. `export.js`, `report.js`, `qgis.js`, and `svg-export.js` remain the format-specific serialization owners. New work should extend the existing owner or add a focused boundary rather than duplicating filter state or metric calculations.

## How landfalls are detected

HURDAT2 marks a `L` record-identifier on track points where the cyclone center crosses a coastline. We use this **as the primary signal** for every landfall.

For storms without an `L` marker — most commonly EPac/CPac storms hitting Hawaii (the marker convention is "continental U.S. only") and a handful of 1971–1990 storms (a documented HURDAT2 marking gap) — we fall back to **inferred landfall detection**:

1. For each consecutive pair of 6-hourly track points, classify each as *inside-a-state* via point-in-polygon against the U.S. Census Bureau state boundaries.
2. Whenever the track transitions from offshore → onshore while at TS+ intensity, that's a landfall.
3. If both endpoints are offshore but the great-circle segment crosses land (which happens with small islands like Kauai), sample 10 mid-segment positions and place the inferred landfall at the first one inside a state polygon. Wind/pressure interpolated linearly.
4. EPac-basin inferred landfalls are restricted to coastal Pacific states (HI, CA, OR, WA, AK) — otherwise EPac storms tracking up through Mexico produce spurious "landfalls" in landlocked Arizona / New Mexico.
5. HURDAT2 `C` records mean closest approach without a subsequent landfall; the record and its adjacent track segments are excluded from inferred promotion.

Inferred landfalls are flagged with an `inferred` tag in the storm panel so you can tell them apart from official `L`-marker landfalls.

The build also ingests the [AOML detailed continental U.S. landfall table](https://www.aoml.noaa.gov/hrd/hurdat/UShurrs_detailed.html) as an independent ground-truth artifact. For the comparable 1983–1990 continental, hurricane-strength scope, the current release matches 16 of 16 reference rows (100.0% precision and 100.0% recall). The same report identifies three inferred tropical-storm candidates in that window separately because the AOML reference rows are hurricane-only.

## Saffir-Simpson at landfall

| Category | Sustained wind | Color |
| -------- | -------------- | ----- |
| TS / sub-hurricane | 34–63 kt | sapphire |
| Cat 1 | 64–82 kt | green |
| Cat 2 | 83–95 kt | yellow |
| Cat 3 (major) | 96–112 kt | peach |
| Cat 4 | 113–136 kt | pink |
| Cat 5 | 137+ kt | mauve |

A storm's **headline landfall category** is the highest category recorded at *any* of its U.S. landfalls — so a storm that peaks offshore and lands as a TS shows up as TS, not as its peak intensity.

## Known data quirks

- **1971–1990 has known gaps in HURDAT2's continental-U.S. landfall marking.** Some real landfalls are missing or under-categorized; the inferred-landfall pass picks up most of them but a few are absent because the 6-hour track doesn't cross a polygon.
- **Pre-1944** (no aircraft reconnaissance) and **pre-late-1960s** (no satellite) systematically under-sample storm count and bias intensities low — see Landsea & Franklin 2013.
- **Wind radii** (34/50/64 kt) only present from 2004 onward in HURDAT2; modern storms use them for 2D swaths, 3D wind cones, and the screening exposure metric. **Radius of maximum wind** only begins in 2021 and remains too sparse for historical comparison.
- **Hawaii 1959 Hurricane Dot, 1992 Iniki** etc. are inferred landfalls because HURDAT2's `L` marker convention doesn't apply outside continental U.S. The category is interpolated from the nearest 6-hour position.

## Data Sources, Licensing & Attribution

### Data build provenance

Every preprocessing run writes `data/metadata.json` alongside the generated landfall, storm, and stats files. It records the exact HURDAT2 source filenames, URLs, revision dates, SHA-256 values, source storm-year ranges, output hashes, generator/runtime, source commit, coverage counts, and lifecycle status for every bundled dataset. A status entry is `active`, `closed`, or `deprecated`, and closed/deprecated entries carry an end date plus a retirement citation. `npm run generate:coverage` turns that source metadata plus each bundled archive manifest into the canonical per-dataset coverage view, including measured availability and final/inferred/operational/stale/closed/unavailable value status. The About dialog and offline diagnostics surface these facts alongside the measured AOML check so users can confirm exactly which data bundle they are viewing. `data/hurdat2-sources.json` is the checked-in source lock and remains in the mandatory runtime; the two raw best-track files are available from Settings as a bounded, user-initiated source bundle.

The NOAA NCEI Billion-Dollar Weather and Climate Disasters product is a closed series: NOAA retired it on 2025-05-08 with no updates beyond calendar year 2024. For a 2025-or-later storm, the impacts panel therefore says **“No data — series ended 2024”** and links to the retirement notice; if the bundled file itself cannot load, it says the data is unavailable instead. `npm run validate:data` rejects any future NCEI row beyond the recorded end date.

Hand-maintained seasonal snapshots are time-bounded rather than silently treated as current. `data/outlook.json` records issue/validity windows for each NOAA and CSU entry plus the latest snapshot window; `data/enso.json` stores the same contract in `_meta`. Refresh both files when NOAA CPC or CSU publishes a new product, then run `npm run validate:data` before release. The validator accepts a snapshot through its inclusive `valid_until` date and emits an in-season warning after 45 days without treating that warning as a data value.

### Open Data License Clarity

**HurricaneMap is built on entirely open and public data.** All datasets carry clear, permissive licenses:

| Dataset | Source | License | Citation |
| --- | --- | --- | --- |
| **HURDAT2 Best-Track** | [NOAA National Hurricane Center](https://www.nhc.noaa.gov/data/) | Public Domain (U.S. Govt) | Landsea, C. W. & Franklin, 2013 |
| **Detailed U.S. Landfalls** | [AOML Hurricane Research Division](https://www.aoml.noaa.gov/hrd/hurdat/UShurrs_detailed.html) | Public Domain (U.S. Govt) | AOML detailed impact/landfall table |
| **NEXRAD Radar Archive** | [Iowa State IEM](https://mesonet.agron.iastate.edu/) | Public Domain | Acknowledgment required |
| **Population Density (GPWv4)** | [SEDAC, Columbia University](https://sedac.ciesin.columbia.edu/) | CC BY 4.0 | [See attribution](LICENSE.md#population-density) |
| **State Boundaries** | [U.S. Census Bureau TIGER](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) | Public Domain | Acknowledgment required |
| **Storm Impacts** | [Wikipedia](https://en.wikipedia.org/) | CC BY-SA 3.0 | [See details](LICENSE.md#storm-impacts-data) |
| **Map Tiles** | [OpenStreetMap](https://www.openstreetmap.org/) | ODbL | © OSM contributors |

### For Research & Publications

**When using HurricaneMap data in research, reports, or presentations,** please:

1. **Acknowledge NOAA/NHC** as the original data source for all hurricane/landfall data:
   > "Historical hurricane landfall data sourced from NOAA's National Hurricane Center HURDAT2 database (https://www.nhc.noaa.gov/data/)"

2. **See [LICENSE.md](LICENSE.md) for:**
   - Per-dataset attribution requirements (SEDAC, Wikipedia, OpenStreetMap, etc.)
   - Full citation formats (Chicago, APA, BibTeX)
   - Data accuracy & pre-satellite-era caveats
   - Landfall detection methodology

3. **Link to HurricaneMap GitHub:** https://github.com/SysAdminDoc/HurricaneMap

### Data Accuracy Notes

- **Pre-1944** (no aircraft) and **pre-1960s** (no satellite): lower completeness and accuracy
- **1971–1990**: documented gaps in continental U.S. landfall marking in HURDAT2
- **Historical uncertainty:** Pre-1900 tracks have ±100+ km uncertainty; modern (post-1960) ±10–20 km
- **More details:** [Data Accuracy & Disclaimers in LICENSE.md](LICENSE.md#data-accuracy--disclaimers)

---

## Data sources & credits (Detailed table)

| What | Where |
| ---- | ----- |
| Atlantic best-track (HURDAT2) | https://www.nhc.noaa.gov/data/ |
| Eastern Pacific best-track (HURDAT2) | https://www.nhc.noaa.gov/data/ |
| Official forecast skill (2021–2025 OFCL vs post-season best track) | [NHC verification database](https://www.nhc.noaa.gov/verification/verify7.shtml) — regenerate `data/forecast-skill.json` with `node scripts/build-forecast-skill.mjs` |
| Archived NHC advisories (2015–2024 U.S.-landfalling Atlantic storms) | [NHC ATCF a-deck archive](https://ftp.nhc.noaa.gov/atcf/archive/) and the [NHC product archive](https://www.nhc.noaa.gov/archive/) — regenerate `data/advisories.json` with `node scripts/build-advisories.mjs` |
| Format spec | [Landsea, C. W. — *Atlantic hurricane database uncertainty*, MWR 2013](https://www.aoml.noaa.gov/hrd/Landsea/landsea-franklin-mwr2013.pdf) |
| Archived radar (NEXRAD composites) | [Iowa State IEM NEXRAD mosaic archive](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/) — fetched live (CORS-enabled), no preprocessing |
| State boundaries | [PublicaMundi MappingAPI](https://github.com/PublicaMundi/MappingAPI) (US Census Bureau TIGER) |
| Map tiles | [CartoDB Dark Matter](https://carto.com/) over OpenStreetMap |
| Map library | [Leaflet 1.9](https://leafletjs.com/) |

## Refreshing the radar archive

Radar PNGs in `data/radar/` come from the [Iowa State IEM NEXRAD archive](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/). They're committed to the repo so the tool works offline, but you can re-scrape them at any time.

> **Size budget:** GitHub Pages hard-caps published sites at **1 GB** and the tracked tree is already ~520 MB (radar ~500 MB). `npm run build` fails above a 900 MB guard (`scripts/check-pages-size.mjs`) — if you densify the radar archive past that, serve the frames from the Cloudflare worker CDN ([docs/CLOUDFLARE_CDN.md](docs/CLOUDFLARE_CDN.md)) instead of committing them.

```bash
# Default — every covered landfall + every in-coverage TS+ track point
# at HURDAT2's native 6-hourly cadence. ~330 MB on first run.
python scripts/scrape_radar.py

# Subset to hurricane-strength only (~195 MB)
python scripts/scrape_radar.py --hurricane-only

# Major hurricanes only (~68 MB)
python scripts/scrape_radar.py --major-only

# Just the landfall frames, no full track (~35 MB)
python scripts/scrape_radar.py --landfalls-only

# Densify to hourly cadence between HURDAT2 records (multi-GB — needs LFS)
python scripts/scrape_radar.py --cadence 60

# Resume / refill — existing files are skipped automatically
python scripts/scrape_radar.py
```

Scraper flags:

| Flag | Default | Effect |
| ---- | ------- | ------ |
| `--cadence MIN` | 360 (= 6h) | Densify track-point fetches to N-min interpolation between HURDAT2 records |
| `--hurricane-only` | off | Skip storms that landed at TS strength only |
| `--major-only` | off | Skip everything below Cat 3 at landfall |
| `--landfalls-only` | off | Skip the full-track expansion, fetch only landfall frames |
| `--start YYYY` / `--end YYYY` | none | Year-range filter |
| `--force` | off | Re-download even if file exists locally |
| `--concurrency N` | 8 | Parallel HTTP fetches |
| `--dry-run` | off | Print task count + estimated MB without downloading |

## Manual HURDAT2 Refresh

Check for NOAA HURDAT2 updates locally, then apply and rebuild when a newer source file is available:

```bash
# Check current NOAA filenames and whether local files differ.
node scripts/refresh-hurdat2.mjs --dry-run

# Apply detected updates when changes are available.
node scripts/refresh-hurdat2.mjs --apply

# Find the latest filenames at https://www.nhc.noaa.gov/data/hurdat/
# Manual fallback example using a 2026 season update:
curl -sSL -o data/hurdat2-atlantic.txt \
  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2026-02272026.txt"
curl -sSL -o data/hurdat2-nepac.txt \
  "https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2026-02272026.txt"

python scripts/preprocess_hurdat2.py --generated-at 2026-08-02T00:00:00Z
```

The preprocessor refreshes `data/landfalls.json`, `data/storms.json`, `data/stats.json`, and `data/metadata.json`. Impact rows can be refreshed with `python scripts/scrape_impacts.py`; use `python scripts/scrape_impacts.py --normalize-existing` after source-format fixes that should be applied to the existing `data/impacts.json` without a network scrape. Then run `npm test`, bump the version, update `CHANGELOG.md`, commit, and create a release.

## License & Attribution

- **Software:** MIT — see [LICENSE](LICENSE)
- **Data Sources:** See [LICENSE.md](LICENSE.md) for detailed attribution
- **Vendored code and fonts:** See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)

This project aggregates data from multiple sources:
- **HURDAT2 Best-Track Database** — NOAA National Hurricane Center (public domain)
- **SLOSH Storm Surge Zones** — NOAA NHC (public domain)
- **NEXRAD Archived Radar** — NOAA / Iowa Environmental Mesonet (public domain)
- **Population Density** — SEDAC GPWv4, Columbia University (CC BY 4.0)
- **Storm Impacts** — Wikipedia (CC BY-SA 3.0)

**When using HurricaneMap in research or publications:** Cite NOAA/NHC as the original data source. See [LICENSE.md](LICENSE.md) for full citation formats and per-dataset attribution requirements.
