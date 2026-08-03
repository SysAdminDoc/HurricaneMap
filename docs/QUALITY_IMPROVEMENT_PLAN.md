# HurricaneMap Quality Improvement Plan

Status legend: `[ ]` not started, `[~]` in progress, `[x]` shipped.

This plan tracks the quality, reliability, accessibility, and maintainability improvements identified after the v1.3.9 hardening pass. It is intentionally separate from feature roadmap phases: these items protect the product while future features continue.

## Program Board

| ID | Workstream | Target outcome | Status | First build delivered | Next milestone |
| --- | --- | --- | --- | --- | --- |
| Q1 | Automated regression coverage | Repeatable boot/search/panel/stats/export/hash/settings coverage for every release. | [~] | `npm test`, `scripts/smoke-playwright.mjs`, and viewport/theme panel-layout matrix. | Add onboarding, focus-order, and visual snapshot coverage. |
| Q2 | Centralized app state and hash parsing | Filter state, URL state, and validation live outside `main.js` with focused tests. | [~] | `src/url-state.js` owns hash encode/decode/restore logic; `src/filter-state.js` owns filter reset, year clamp, category, and active-state rules. | Extract remaining DOM event wiring around filters into a controller module. |
| Q3 | Data contract validation | Data shape drift fails fast before UI metrics silently break. | [~] | `scripts/validate-data.mjs` validates storms, landfalls, stats, metadata, normalized impacts, glossary, and cross-file counts. | Add tighter optional-feed validation after Q12. |
| Q4 | Normalized impact data | Death/damage rankings and labels use numeric canonical fields plus raw source strings. | [x] | `scripts/scrape_impacts.py` emits raw strings, parsed fatality/damage fields, schema version, and provenance; shared UI helpers consume the typed fields. | Re-scrape periodically as Wikipedia coverage changes. |
| Q5 | Data-derived season bounds | Year controls and defaults come from generated metadata instead of hard-coded UI constants. | [x] | Filter defaults and year-control bounds now prefer `metadata.coverage.year_range` and fall back to `stats.year_range`. | Keep `stats.year_range` as a compatibility fallback for older bundles. |
| Q6 | Local release verification | Build, test, smoke, and data-refresh checks run locally before release. | [x] | `npm test`, `npm run build`, and `node scripts/refresh-hurdat2.mjs --dry-run` cover release checks without remote workflows. | Keep branch protection and release uploads managed from the local machine. |
| Q7 | Service-worker update UX | Users get a calm "Update available" prompt when a new shell is installed. | [x] | `src/sw-updates.js` detects waiting service workers, shows a persistent reload prompt, and smoke coverage verifies the prompt UI. | Keep release notes clear about when `SW_VERSION` should be bumped. |
| Q8 | Accessibility coverage | Focus, modal, chart, contrast, reduced-motion, and screen-reader states are testable. | [~] | Smoke test covers Escape routing across settings and panels. | Add automated focus-order and reduced-motion checks. |
| Q9 | UI module decomposition | Large UI modules are split by state, render, event binding, and export responsibilities. | [ ] | Plan documented. | Split `main.js` filter/search/hash responsibilities first. |
| Q10 | Chart/export parity | Visible metrics and downloaded metrics use the same adapters and formatting. | [~] | Compare CSV contract covered by smoke test. | Add shared metric presenters for panel, charts, and CSV exports. |
| Q11 | Data-build provenance | UI and README show source dates, generator version, and data attribution clearly. | [x] | `data/metadata.json` is generated during preprocessing, validated, loaded by the app, surfaced in About, and documented in README; impact rows now carry scraper provenance. | Add a release checklist entry for source refresh cadence. |
| Q12 | Secondary-data error/offline states | Optional feeds fail calmly with retry/help copy and clear degraded-mode messaging. | [ ] | Plan documented. | Audit active storms, glossary, seasonal outlook, radar, and population layers. |
| Q13 | Visual regression snapshots | Desktop/mobile/high-contrast screenshots catch layout drift. | [~] | Playwright smoke now asserts side-panel bounds at 430px, 640px, 720px, 860px, and 1120px across dark, light, and high-contrast themes. | Add screenshot baselines for map, panels, settings, compare, stats, and mobile. |
| Q14 | Maintainability docs | Contributors have clear commands, data contracts, release steps, and known risk areas. | [~] | README quality commands and this plan. | Add architecture notes for module ownership and release/cache bump procedure. |

## Implementation Phases

### Phase A - Quality Foundation

Status: `[x]`

- [x] Add npm scripts for syntax, service-worker asset, data, and browser smoke checks.
- [x] Add Playwright smoke coverage for boot, invalid hash cleanup, storm panel, settings Escape behavior, season ACE, stats ACE, and compare CSV.
- [x] Add data validation for generated JSON contracts and cross-file totals.
- [x] Keep verification local with npm build/test/smoke scripts.
- [x] Document the full improvement board.
- [x] Add data-refresh validation after HURDAT2 preprocessing.

### Phase B - State and Data Contracts

Status: `[~]`

- [x] Extract URL hash decode/encode/validation from `src/main.js`.
- [x] Add focused tests for default hash omission, malformed percent encoding, invalid categories, invalid states, and open storm/state restoration.
- [x] Extract filter reset, category macro, category toggle, year clamp, and active-state rules from `src/main.js`.
- [x] Add focused tests for filter reset, year clamp, category macros/toggles, and active filter detection.
- [x] Generate canonical `data/metadata.json` with source dates, year bounds, generator version, and source file names.
- [x] Derive UI year defaults from generated `stats.year_range`.
- [x] Normalize impacts into raw and parsed fields during scraping.

### Phase C - UX Resilience and Accessibility

Status: `[~]`

- [x] Add update-available prompt for service-worker shell updates.
- [ ] Add consistent offline/degraded states for active storms, seasonal outlook, radar, population, glossary, and optional datasets.
- [ ] Add keyboard/focus regression checks for dialogs, panels, search, timeline, compare, and high-contrast mode.
- [ ] Add reduced-motion regression coverage for key animated surfaces.

### Phase D - Modularization and Metric Parity

Status: `[ ]`

- [ ] Split `main.js` into filter state, URL state, search controller, and shell wiring modules.
- [ ] Split comparison export formatting from comparison panel rendering.
- [ ] Introduce shared metric presenter functions used by storm panel, stats, charts, and CSV exports.
- [ ] Add tests that compare visible metric text against exported CSV values where practical.

### Phase E - Visual Regression and Documentation

Status: `[~]`

- [x] Add side-panel viewport/theme layout assertions for 430px, 640px, 720px, 860px, and 1120px.
- [ ] Add Playwright screenshot baselines for desktop, mobile, stats, compare, settings, high contrast, and storm panel.
- [ ] Document module ownership and data contracts.
- [ ] Document release process, service-worker cache bump rules, and verification checklist.
- [x] Add provenance details to About and README after metadata generation lands.

## Current Verification Commands

Run these before merging or releasing:

```powershell
npm install
npm test
```

For a faster non-browser pass:

```powershell
npm run build
```

## Open Risk Register

- The app is still a static multi-module browser app with heavy orchestration inside `src/main.js`.
- Wikipedia impact rows now have normalized numeric fields, but the source is community-edited and still incomplete for many storms.
- Browser smoke checks cover the highest-risk flows, but they are not yet visual regression tests.
- Service-worker updates now prompt for reload, but release discipline still depends on bumping `SW_VERSION` when shell assets change.
