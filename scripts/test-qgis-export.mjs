import assert from 'node:assert/strict';

import { buildQGISGeoJSON } from '../src/qgis.js';

// Fixture mirrors the production landfall shape: calendar fields are derived
// from the ISO timestamp `t` (records carry no month/day/hour fields).
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

const geojson = buildQGISGeoJSON({
  landfalls,
  storms,
  filters: { yearMin: 2005, yearMax: 2005, categories: new Set(['3']), state: 'Louisiana' },
  exportedAt: '2026-05-05T00:00:00.000Z',
});

assert.equal(geojson.type, 'FeatureCollection');
assert.equal(Object.hasOwn(geojson, 'crs'), false);
assert.equal(geojson.metadata.filters.years, '2005-2005');
assert.equal(geojson.metadata.filters.categories, '3');
assert.equal(geojson.metadata.provenance.schema_version, 1);
assert.equal(geojson.metadata.provenance.exported_at_utc, '2026-05-05T00:00:00.000Z');
assert(geojson.metadata.provenance.data_release.artifacts.some(artifact => artifact.path === 'data/storms.json'));

const track = geojson.features.find(feature => feature.properties.feature_type === 'track');
assert.equal(track.geometry.type, 'LineString');
assert.equal(track.geometry.coordinates.length, 3);
assert.deepEqual(track.geometry.coordinates[0], [-75.1, 23.1]);
assert.equal(track.properties.track_points, 3);
assert.equal(track.properties.pressure_min_mb, 902);

const point = geojson.features.find(feature => feature.properties.feature_type === 'landfall');
assert.equal(point.geometry.type, 'Point');
assert.equal(point.properties.pressure_mb, 920);
assert.equal(point.properties.category, '3');
assert.equal(point.properties.time_utc, '2005-08-29T11:10:00Z');
assert.equal(point.properties.month, 8);
assert.equal(point.properties.day, 29);
assert.equal(point.properties.hour, 11);

const tdGeojson = buildQGISGeoJSON({
  landfalls: [{ ...landfalls[0], storm_id: 'AL012026', category: 0, wind: 30 }],
  filters: { yearMin: 1851, yearMax: 2026, categories: new Set(['ts', '1', '2', '3', '4', '5']), state: '' },
  coverageYearRange: [1851, 2026],
});
assert.equal(tdGeojson.features[0].properties.category, 'TD');
assert.equal(tdGeojson.name, 'HurricaneMap-Export');

console.log('qgis export ok');
