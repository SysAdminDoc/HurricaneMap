import assert from 'node:assert/strict';

import { buildPublicationCSV } from '../src/export.js';
import { buildExportProvenance } from '../src/export-provenance.js';
import { generateStatisticalReport } from '../src/report.js';
import { buildQGISGeoJSON } from '../src/qgis.js';
import { buildTrackSVG } from '../src/svg-export.js';

const exportedAt = '2026-08-02T12:34:56.000Z';
const filters = {
  yearMin: 2005,
  yearMax: 2005,
  categories: new Set(['3']),
  state: 'Louisiana',
};
const landfalls = [{
  storm_id: 'AL122005',
  name: 'KATRINA',
  year: 2005,
  t: '2005-08-29T11:10:00Z',
  lat: 29.3,
  lon: -89.6,
  wind: 110,
  pres: 920,
  category: 3,
  state: 'Louisiana',
}];
const storms = [{
  id: 'AL122005',
  name: 'KATRINA',
  year: 2005,
  peak_wind_kt: 150,
  landfall_max_category: 3,
  landfall_max_wind_kt: 110,
  track: [
    { t: '2005-08-23T18:00:00Z', lat: 23.1, lon: -75.1, wind: 30, pres: 1008 },
    { t: '2005-08-28T18:00:00Z', lat: 26.3, lon: -88.6, wind: 150, pres: 902 },
    { t: '2005-08-29T11:10:00Z', lat: 29.3, lon: -89.6, wind: 110, pres: 920 },
  ],
}];

function assertProvenance(provenance, label) {
  assert.equal(provenance.schema_version, 1, `${label}: provenance schema version`);
  assert.equal(provenance.app_version, '1.9.2', `${label}: app version`);
  assert.equal(provenance.exported_at_utc, exportedAt, `${label}: export timestamp`);
  assert(provenance.data_release.source_commit.length === 40, `${label}: source commit`);
  assert(provenance.data_release.manifest_sha256.length === 64, `${label}: manifest hash`);
  assert(provenance.data_release.artifacts.length >= 5, `${label}: bound artifacts`);
  assert.equal(provenance.data_release.coverage.catalog.storm_count, 595, `${label}: coverage storm count`);
  assert.equal(provenance.data_release.coverage.datasets.find(dataset => dataset.id === 'radar-archive').availability.frames, 1703, `${label}: radar coverage`);
  assert.equal(provenance.data_release.coverage.datasets.find(dataset => dataset.id === 'ncei-billions').availability.runnable, false, `${label}: closed coverage`);
  assert(provenance.methodology.length >= 2, `${label}: methodology`);
  const serialized = JSON.stringify(provenance);
  assert.doesNotMatch(serialized, /[A-Za-z]:\\|\/Users\/|saved.?views|preparedness|selected.?point|address/i, `${label}: private state leaked`);
}

const csv = buildPublicationCSV(filters, { landfalls, generatedAt: exportedAt });
const csvLine = csv.csv.split('\n').find(line => line.startsWith('# Provenance'));
assert(csvLine, 'CSV is missing its provenance comment');
assertProvenance(JSON.parse(csvLine.replace(/^# Provenance \(JSON, schema v1\): /, '')), 'CSV');

const report = generateStatisticalReport(filters, {
  landfalls,
  coverageYearRange: [1851, 2025],
  generatedAt: exportedAt,
  getImpacts: () => ({ deaths_total: 10, damage_millions_usd: 100 }),
});
const reportJson = report.markdown.match(/## Release Provenance\n\n```json\n([\s\S]*?)\n```/);
assert(reportJson, 'report is missing its provenance JSON block');
assertProvenance(JSON.parse(reportJson[1]), 'report');

const geojson = buildQGISGeoJSON({ landfalls, storms, filters, exportedAt });
assertProvenance(geojson.metadata.provenance, 'QGIS');

const svg = buildTrackSVG(storms[0], { exportedAt });
const svgJson = svg.match(/<metadata id="hurricanemap-provenance"><!\[CDATA\[([\s\S]*?)\]\]><\/metadata>/);
assert(svgJson, 'SVG is missing its provenance metadata');
assertProvenance(JSON.parse(svgJson[1]), 'SVG');

const defaults = buildExportProvenance({ methodology: ['fixture'] });
assert(defaults.data_release.artifacts.every(artifact => /^data\//.test(artifact.path)));

console.log('export provenance contracts ok (CSV, Markdown, QGIS GeoJSON, and SVG)');
