# HurricaneMap Quality Improvement Plan

Status legend: `[ ]` not started, `[~]` in progress, `[x]` shipped.

This plan tracks the quality, reliability, accessibility, and maintainability improvements identified after the v1.3.9 hardening pass. It is intentionally separate from feature roadmap phases: these items protect the product while future features continue.

## Program Board

| ID | Workstream | Target outcome | Status | First build delivered | Next milestone |
| --- | --- | --- | --- | --- | --- |
| Q1 | Automated regression coverage | Repeatable boot/search/panel/stats/export/hash/settings coverage for every release. | [~] | `npm test`, `scripts/smoke-playwright.mjs`, and CI workflow. | Add mobile, high-contrast, onboarding, and visual snapshot coverage. |
| Q2 | Centralized app state and hash parsing | Filter state, URL state, and validation live outside `main.js` with focused tests. | [~] | `src/url-state.js` now owns hash encode/decode/restore logic, with focused Node tests. | Extract the remaining filter-state mutation and reset logic from `main.js`. |
| Q3 | Data contract validation | Data shape drift fails fast before UI metrics silently break. | [~] | `scripts/validate-data.mjs` validates storms, landfalls, stats, impacts, glossary, and cross-file counts. | Move generated metadata and impact parsing into canonical typed artifacts. |
| Q4 | Normalized impact data | Death/damage rankings and labels use numeric canonical fields plus raw source strings. | [ ] | Current validation guards source shape. | Update `scripts/scrape_impacts.py` to emit parsed numeric fields and provenance. |
| Q5 | Data-derived season bounds | Year controls and defaults come from generated metadata instead of hard-coded UI constants. | [~] | Filter defaults and year-control bounds now derive from `stats.year_range` at boot. | Move source dates and year bounds into a dedicated `data/metadata.json`. |
| Q6 | CI | Pull requests and pushes run the same checks used locally. | [x] | `.github/workflows/quality.yml` runs `npm test`; HURDAT2 refresh runs `npm run validate:data` after preprocessing. | Add branch protection once repository settings allow it. |
| Q7 | Service-worker update UX | Users get a calm "Update available" prompt when a new shell is installed. | [ ] | `scripts/check-service-worker.mjs` validates shell assets and cache version presence. | Add client-side update notification and reload action. |
| Q8 | Accessibility coverage | Focus, modal, chart, contrast, reduced-motion, and screen-reader states are testable. | [~] | Smoke test covers Escape routing across settings and panels. | Add automated focus-order and reduced-motion checks. |
| Q9 | UI module decomposition | Large UI modules are split by state, render, event binding, and export responsibilities. | [ ] | Plan documented. | Split `main.js` filter/search/hash responsibilities first. |
| Q10 | Chart/export parity | Visible metrics and downloaded metrics use the same adapters and formatting. | [~] | Compare CSV contract covered by smoke test. | Add shared metric presenters for panel, charts, and CSV exports. |
| Q11 | Data-build provenance | UI and README show source dates, generator version, and data attribution clearly. | [ ] | Plan documented. | Add `data/metadata.json` during preprocessing and surface it in About. |
| Q12 | Secondary-data error/offline states | Optional feeds fail calmly with retry/help copy and clear degraded-mode messaging. | [ ] | Plan documented. | Audit active storms, glossary, seasonal outlook, radar, and population layers. |
| Q13 | Visual regression snapshots | Desktop/mobile/high-contrast screenshots catch layout drift. | [ ] | Playwright smoke infrastructure is available. | Add screenshot baselines for map, panels, settings, compare, stats, and mobile. |
| Q14 | Maintainability docs | Contributors have clear commands, data contracts, release steps, and known risk areas. | [~] | README quality commands and this plan. | Add architecture notes for module ownership and release/cache bump procedure. |

## Implementation Phases

### Phase A - Quality Foundation

Status: `[x]`

- [x] Add npm scripts for syntax, service-worker asset, data, and browser smoke checks.
- [x] Add Playwright smoke coverage for boot, invalid hash cleanup, storm panel, settings Escape behavior, season ACE, stats ACE, and compare CSV.
- [x] Add data validation for generated JSON contracts and cross-file totals.
- [x] Add GitHub Actions quality workflow.
- [x] Document the full improvement board.
- [x] Add data-refresh workflow validation after HURDAT2 preprocessing.

### Phase B - State and Data Contracts

Status: `[~]`

- [x] Extract URL hash decode/encode/validation from `src/main.js`.
- [x] Add focused tests for default hash omission, malformed percent encoding, invalid categories, invalid states, and open storm/state restoration.
- [ ] Generate canonical `data/metadata.json` with source dates, year bounds, generator version, and source file names.
- [x] Derive UI year defaults from generated `stats.year_range`.
- [ ] Normalize impacts into raw and parsed fields during scraping.

### Phase C - UX Resilience and Accessibility

Status: `[ ]`

- [ ] Add update-available prompt for service-worker shell updates.
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

Status: `[ ]`

- [ ] Add Playwright screenshot baselines for desktop, mobile, stats, compare, settings, high contrast, and storm panel.
- [ ] Document module ownership and data contracts.
- [ ] Document release process, service-worker cache bump rules, and verification checklist.
- [ ] Add provenance details to About and README after metadata generation lands.

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
- Generated data has useful source strings but limited canonical metadata and normalized numeric impact fields.
- Browser smoke checks cover the highest-risk flows, but they are not yet visual regression tests.
- Service-worker updates are cache-safe through version bumps, but users do not yet get an in-app update prompt.
