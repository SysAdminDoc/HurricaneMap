import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCitation } from '../src/citation.js';
import { buildPublicationCSV } from '../src/export.js';
import { buildExports } from '../src/metrics.js';
import { buildQGISGeoJSON } from '../src/qgis.js';
import { generateStatisticalReport } from '../src/report.js';
import { buildTrackSVG } from '../src/svg-export.js';
import {
  createDefaultFilters,
  decodeHashState,
  encodeHashState,
  viewOptionsFromDecoded,
} from '../src/url-state.js';

const accessDate = '2026-08-03';
const citation = buildCitation({ accessDate });
assert.equal(citation.schema_version, 1);
assert.match(citation.apa, /version 1\.9\.2/);
assert.match(citation.apa, /HURDAT2 revision 2026-02-27/);
assert.match(citation.apa, /Atlantic SHA-256: 1b9b0c7beed5/);
assert.match(citation.apa, /Eastern Pacific SHA-256: db65f8bc538/);
assert.match(citation.apa, /Retrieved 2026-08-03/);
assert.match(citation.bibtex, /@software\{hurricanemap_2026/);
assert.match(citation.bibtex, /accessed 2026-08-03/);
assert.match(citation.url, /#v=1&rel=[a-f0-9]{64}$/);

const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
const pinnedHash = encodeHashState(filters, {
  dataRevision: citation.release.release_pin,
  yearMinDefault: 1851,
  yearMaxDefault: 2025,
});
assert.equal(pinnedHash, `#v=1&rel=${citation.release.release_pin}`);
assert.equal(viewOptionsFromDecoded(decodeHashState(pinnedHash)).dataRevision, citation.release.release_pin);

const landfalls = [{
  storm_id: 'AL122005', name: 'KATRINA', year: 2005, t: '2005-08-29T11:10:00Z',
  lat: 29.3, lon: -89.6, wind: 110, pres: 920, category: 3, state: 'Louisiana',
}];
const storms = [{
  id: 'AL122005', name: 'KATRINA', year: 2005, peak_wind_kt: 150,
  landfall_max_category: 3, landfall_max_wind_kt: 110,
  track: [
    { t: '2005-08-23T18:00:00Z', lat: 23.1, lon: -75.1, wind: 30, pres: 1008 },
    { t: '2005-08-28T18:00:00Z', lat: 26.3, lon: -88.6, wind: 150, pres: 902 },
    { t: '2005-08-29T11:10:00Z', lat: 29.3, lon: -89.6, wind: 110, pres: 920 },
  ],
}];
const fixtureFilters = { yearMin: 2005, yearMax: 2005, categories: new Set(['3']), state: 'Louisiana' };

const publication = buildPublicationCSV(fixtureFilters, { landfalls, generatedAt: `${accessDate}T12:34:56.000Z` });
assert.match(publication.csv, /# APA citation: SysAdminDoc\./);
assert.match(publication.csv, /# @software\{hurricanemap_2026/);

const report = generateStatisticalReport(fixtureFilters, {
  landfalls,
  generatedAt: `${accessDate}T12:34:56.000Z`,
  coverageYearRange: [1851, 2025],
  getImpacts: () => ({ deaths_total: 1, damage_millions_usd: 1 }),
});
assert.match(report.markdown, /## Copy-Paste Release Citation/);
assert.match(report.markdown, /@software\{hurricanemap_2026/);

const qgis = buildQGISGeoJSON({ landfalls, storms, filters: fixtureFilters, exportedAt: `${accessDate}T12:34:56.000Z` });
assert.match(qgis.metadata.citation.apa, /HURDAT2 revision 2026-02-27/);

const svg = buildTrackSVG(storms[0], { exportedAt: `${accessDate}T12:34:56.000Z` });
assert.match(svg, /hurricanemap-citation/);
assert.match(svg, /@software\{hurricanemap_2026/);

const stormExports = buildExports(storms[0]);
for (const [kind, result] of Object.entries(stormExports)) {
  assert.match(result.body, /APA citation|"citation"/, `${kind} export is missing its citation`);
  assert.match(result.body, /hurricanemap_20/, `${kind} export is missing BibTeX`);
}

const notebook = readFileSync(new URL('../notebooks/analysis-starter.ipynb', import.meta.url), 'utf8');
assert.match(notebook, /def build_citations\(/);
assert.match(notebook, /APA_CITATION/);
assert.match(notebook, /BIBTEX_CITATION/);

console.log('citation contracts ok (APA, BibTeX, exports, notebook, and pinned URLs)');
