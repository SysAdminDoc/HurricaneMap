# Iter 1: Harvest (Phase 2)

> Quantity-first list of candidate features sourced from prior turn's tiered survey and repo gap analysis. Filtered + scored in `iter-1-scored.md`. Sources are the 9-class extension of the dimensions: direct OSS competitors (Tropycal, IBTrACS visualizers, NHC tools), commercial (Zoom Earth, Windy, MyRadar, Stormpulse-era), adjacent OSS (Leaflet plugins, MapLibre, Cesium), awesome-lists (awesome-meteorology, awesome-leaflet, awesome-gis), community signal (r/hurricane, r/TropicalWeather, HN tropical-cyclone discussions, NWS Twitter), standards (HURDAT2, ATCF, IBTrACS spec, OGC tile standards), academic (NHC TCRs, AOML/HRD publications, climate trend papers), dependency changelogs (Leaflet, leaflet.heat, leaflet-velocity), security advisories (none acutely relevant for this static site).

## Raw harvested items (unscored)

### Derived metrics from existing HURDAT2 data
1. ACE (Accumulated Cyclone Energy) per storm.
2. ACE per season aggregate.
3. ACE basin total (Atlantic vs NEPAC).
4. Rapid intensification flag (≥30kt / 24h).
5. Rapid intensification chart segment highlighting.
6. Pressure-fall rate metric (mb / 24h).
7. Pressure-wind departure (Knaff-Zehr deviation).
8. Translation speed at landfall.
9. Storm radius (eye location → outer wind radii).
10. Storm symmetry (4-quadrant wind radii imbalance).
11. Track sinuosity (length traveled / great-circle from genesis to landfall).
12. Recurvature classification (straight vs recurving).
13. Genesis-point clustering (kernel density).
14. Track endpoint type (dissipated / extratropical / merged / crossed basin).
15. Days at hurricane intensity.
16. Days at major (Cat 3+) intensity.

### City-centric / spatial queries
17. Closest approach to selected city (great-circle distance of nearest track point).
18. Closest approach with wind threshold ("storms within 100mi at TS-force or stronger").
19. Top-N nearest hurricanes ranked by distance × wind.
20. Per-city return-period estimates (Cat-1, Cat-3, Cat-5).
21. "On this day in history", storms passing nearest in current calendar week.
22. Threat heatmap from city POV (radial bands).

### Shareability / state
23. URL permalink for storm + filters.
24. URL permalink for state deep-dive.
25. URL permalink for compare-tray contents.
26. Share button (Web Share API + clipboard fallback).
27. Open-graph preview cards per shared link.
28. Embed mode (iframe-friendly minimal chrome).
29. Print-friendly stylesheet.
30. PDF report export per storm.

### Export
31. Track as KML.
32. Track as GeoJSON.
33. Track as CSV.
34. Track as GPX.
35. Compare tray as multi-feature GeoJSON.
36. State landfall history as CSV.
37. Filtered landfall set as CSV.
38. PNG screenshot of map view.
39. SVG export of intensity chart.

### New external datasets
40. NOAA Billion-Dollar Disasters CSV (CPI-adjusted damage).
41. Direct + indirect fatalities from NHC TCR scrape.
42. USGS storm-tide sensor network observations.
43. WPC storm-total QPE rainfall contours.
44. LandScan / WorldPop population × wind-field swath.
45. NHC cone of uncertainty (active storms).
46. Spaghetti / ensemble model tracks (TVCN/TVCE/GFS/ECMWF/HMON/HWRF).
47. ATCF a-deck full model output.
48. NWS Local Storm Reports during landfall.
49. Aircraft recon dropsonde profiles (already partially: link to archive).
50. Satellite imagery in-app (currently linkout to SLIDER).

### Storytelling / climate
51. Season-replay timelapse (entire season at once).
52. Decadal landfall heatmap with year slider.
53. Climate trendline overlays (10-yr rolling avg).
54. Track translation tool ("Galveston 1900 over modern Houston").
55. ENSO state badge per season (El Niño / La Niña / neutral).
56. SST anomaly at genesis location.
57. Saharan Air Layer overlay (active).
58. MJO phase indicator per genesis date.

### UX / quality
59. Onboarding tour (first-visit walkthrough).
60. PWA / service worker / installable.
61. Offline mode with cached storm data.
62. Color-blind safe palette toggle.
63. Metric ↔ imperial unit toggle.
64. Mobile bottom-sheet pattern instead of side-panel on phones.
65. Keyboard shortcut palette (`?` to view).
66. Storm timeline ribbon at the bottom.
67. Accessible high-contrast theme.
68. RTL language support.
69. i18n scaffold (en, es-LA, fr).

### Performance / arch
70. Lazy-load `storms.json` chunks per decade.
71. Move filtering to a Web Worker.
72. IndexedDB cache for storms.json (skip network on revisit).
73. Vector tiles for state polygons.
74. Code-split per panel (map / panel / animation / radar).

### Comparison / debate features
75. Storm vs storm side-by-side overlay (already partially: compare tray).
76. Storm-vs-season aggregate ("Was 2005 worse than 2017?").
77. Decade-vs-decade comparison.
78. Pre-satellite-era caveat tooltip on storms <1965.

### Developer / API
79. Public data endpoint (json over GitHub Pages, already implicit).
80. Versioned schema for storms.json.
81. README documentation of data fields.
82. Contribution guide for new external datasets.

### Branding / polish
83. Animated favicon during loading.
84. SVG hurricane logo refinement.
85. Splash on first paint.
86. Print stylesheet (above also).
87. Better empty state on no-results filters.

### Audio / accessibility delight
88. Subtle wind-howl ambience toggle (off by default).
89. Audio description toggle for visually impaired.

### Educational
90. Glossary popover (TS / TD / Cat / SSHWS / RI / TCR).
91. "How to read this chart" tooltip on first hover.
92. Beaufort scale reference panel.

## Total raw count

92 items.
