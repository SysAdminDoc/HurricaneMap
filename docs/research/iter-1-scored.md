# Iter 1 — Scored & Tiered (Phase 3)

Each item scored on Fit (charter) / Impact / Effort / Risk / Dependencies / Novelty (1-5, higher = better except Effort/Risk/Dependencies where lower = better).

## NOW (P0/P1 — ship this iteration)

### N1. ACE per storm + per season (h1 metric)
- Fit 5 / Impact 5 / Effort 1 / Risk 1 / Dep 1 / Novelty 4
- Pure derivation from existing `track[].wind`. ACE = Σ(v² / 10⁴) for v ≥ 34kt at 6h obs.
- Surface in storm-panel stat-grid + tooltip explaining the metric.

### N2. Rapid-intensification flag + chart segment highlight
- Fit 5 / Impact 5 / Effort 1 / Risk 1 / Dep 1 / Novelty 4
- Detection: scan track for any window with ≥30kt wind gain over 24h.
- Surface as a badge on the storm panel ("⚡ Rapid intensification") + red-tinted chart polyline segment for the RI window.

### N3. Closest approach to a U.S. coastal city
- Fit 5 / Impact 5 / Effort 2 / Risk 1 / Dep 1 / Novelty 5
- Hardcoded ~25-city list (Miami, Tampa, Houston, NOLA, Charleston, NYC, Boston, Norfolk, Galveston, Pensacola, Mobile, Wilmington-NC, Savannah, Jacksonville, Corpus Christi, Key West, Cape Hatteras, Brownsville, Daytona Beach, Hilo, Honolulu, San Diego, Cabo San Lucas).
- Compute great-circle distance from each track point; report nearest with wind at that point.
- Surface in storm panel under stat-grid as a "Closest pass to [city ▾]" line, with city dropdown.

### N4. Permalink / URL state
- Fit 5 / Impact 5 / Effort 2 / Risk 2 / Dep 1 / Novelty 3
- Encode `?storm=<id>` + filter state (`year`, `cat`, `state`, `tracks`, `heat`) in `location.hash` (avoids server round-trip + caching headaches).
- Restore on load. Update on filter change + storm open + state-deep-dive open.

### N5. Export track as KML / GeoJSON / CSV
- Fit 5 / Impact 4 / Effort 2 / Risk 1 / Dep 1 / Novelty 4
- New export menu in storm panel ("Export ▾" → KML / GeoJSON / CSV).
- Generate Blob client-side; `URL.createObjectURL` + `<a download>` synthetic click.
- Include track + landfall points + storm metadata.

## NEXT (P1 — next iteration)

- N6. Pressure-fall rate metric (mb / 24h) — overlay on chart.
- N7. Translation speed at landfall (kt/mph).
- N8. Days at hurricane / major intensity.
- N9. Onboarding tour (first-visit, dismissible, localStorage-flag).
- N10. Color-blind safe palette toggle.
- N11. Metric ↔ imperial unit toggle.
- N12. PWA / service worker / installable + offline.
- N13. Storm timeline ribbon at bottom.
- N14. PNG screenshot export of map view.
- N15. SVG export of intensity chart.

## LATER

- L1. NOAA Billion-Dollar Disasters integration.
- L2. USGS storm-tide gauge observations.
- L3. WPC rainfall contours.
- L4. Population × wind-field exposure metric ("X million in Cat-1 winds").
- L5. NHC cone of uncertainty for active storms (real-time KMZ parse).
- L6. Spaghetti / ensemble model tracks (ATCF a-deck).
- L7. Season-replay timelapse.
- L8. Decadal landfall heatmap with year slider.
- L9. Climate trendline overlays (10-yr rolling).
- L10. Track translation tool ("storm X over location Y").
- L11. PDF storm report export.
- L12. ENSO state badge per season.
- L13. SST anomaly at genesis.
- L14. Glossary popover for technical terms.
- L15. IndexedDB cache for storms.json.

## UNDER CONSIDERATION

- U1. 3D track visualization (Cesium dependency, non-trivial scope).
- U2. Embed / iframe mode (charter expansion: requires headless URL params).
- U3. i18n / RTL (charter expansion: currently English-only).
- U4. Wind-howl ambience (charter mismatch: serious-tone product).

## REJECTED (with reasoning)

- R1. **Web Share API only** — clipboard fallback is mandatory for desktop browsers; can't ship as Share-API-only. (Resolved: include both.)
- R2. **Audio description toggle** — out of charter scope; visual product.
- R3. **Saharan Air Layer overlay** — interesting but requires GOES-derived SAL imagery that has no clean public API; defer indefinitely.
- R4. **MJO phase indicator** — relies on ENSEMBLE NOAA CPC index; rejected on data-pipeline complexity vs. payoff.
- R5. **Vector tiles for state polygons** — current GeoJSON is 89KB, fast enough; vector tiling adds toolchain for no perceptible win.
- R6. **Code-split per panel** — no measured perf problem; premature optimization for a static site at this size.
- R7. **Backend / API endpoint** — violates "stay client-side" charter constraint.
- R8. **Animated favicon** — distracting in tab bar; users dislike.

## Six-dimension category coverage check

| Category | Coverage in scored list |
|---|---|
| Security | No new attack surface (client-side, no auth, no PII). N/A this iter. |
| A11y | Color-blind palette (NEXT), focus rings (already shipped). |
| i18n | Under consideration. Defer. |
| Observability | No backend → no observability. |
| Testing | No test suite present; not adding (per charter, this is a delivery product). |
| Docs | README + CHANGELOG sync covered in Definition of Done. |
| Distribution | PWA/installable in NEXT. |
| Plugin/API | Not in scope; static product. |
| Mobile | Bottom-sheet pattern in NEXT (#13 timeline + N6.x mobile sweeps). |
| Offline | PWA in NEXT (#12). |
| Multi-user | N/A. |
| Migration | Storm data schema versioning in LATER. |
| Upgrade | Already done — versioned releases. |

## Implementation order this iteration

1. New file `src/metrics.js` — `computeACE`, `findRapidIntensification`, `closestApproach`, `formatNumber`, city list.
2. `src/panel.js` — extend stat-grid with ACE + RI badge + closest-pass selector + Export menu.
3. `src/chart.js` — add RI window red-tinted polyline segment.
4. `src/main.js` — URL hash encode/decode + restore + write hooks.
5. `index.html` — meta-row Export menu markup, Closest-pass selector markup.
6. `src/styles.css` — RI badge, ACE chip, closest-pass selector styling, export menu styling.
7. CHANGELOG entry, README badge bump, ROADMAP refresh.
