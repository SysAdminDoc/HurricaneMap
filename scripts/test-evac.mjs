import assert from 'node:assert/strict';

import {
  EVACUATION_SOURCES,
  buildFloridaGeocodeUrl,
  buildFloridaLayerMetadataUrl,
  buildFloridaZoneQueryUrl,
  classifyFloridaLayerAvailability,
  chooseFloridaCandidate,
  parseFloridaLayerMetadata,
  parseFloridaZoneResponse,
  probeFloridaZoneLayer,
} from '../src/evac.js';

const zoneUrl = new URL(buildFloridaZoneQueryUrl(25.7617, -80.1918));
assert.equal(zoneUrl.origin, 'https://services.arcgis.com');
assert.equal(zoneUrl.searchParams.get('geometry'), '-80.1918,25.7617');
assert.equal(zoneUrl.searchParams.get('geometryType'), 'esriGeometryPoint');
assert.equal(zoneUrl.searchParams.get('returnGeometry'), 'false');
assert(zoneUrl.searchParams.get('outFields').includes('EZone'));

const metadataUrl = new URL(buildFloridaLayerMetadataUrl());
assert.equal(metadataUrl.origin, 'https://services.arcgis.com');
assert(metadataUrl.pathname.endsWith('/FeatureServer/46'));
assert.equal(metadataUrl.searchParams.get('f'), 'json');

const layerMetadata = parseFloridaLayerMetadata({
  type: 'Feature Layer',
  name: 'Florida evacuation zones',
  geometryType: 'esriGeometryPolygon',
  fields: [{ name: 'EZone' }, { name: 'County_Nam' }],
});
assert.deepEqual(layerMetadata, {
  name: 'Florida evacuation zones', geometryType: 'esriGeometryPolygon', fieldCount: 2,
});
assert.equal(parseFloridaLayerMetadata({ type: 'Feature Layer', fields: [] }), null);
assert.deepEqual(classifyFloridaLayerAvailability({ error: { message: 'down' } }), { available: false, reason: 'service-error' });
assert.deepEqual(classifyFloridaLayerAvailability({ type: 'Feature Layer' }), { available: false, reason: 'invalid-response' });
assert.deepEqual(classifyFloridaLayerAvailability({
  type: 'Feature Layer', name: 'Florida evacuation zones', geometryType: 'esriGeometryPolygon', fields: [{ name: 'EZone' }],
}), { available: true, reason: 'available' });

for (const code of ['NC', 'SC', 'GA', 'TX']) {
  const source = EVACUATION_SOURCES[code];
  assert(source, `${code} source is missing`);
  assert.equal(source.directLayer, false);
  assert.match(source.officialUrl, /^https:\/\//);
  assert(source.authority.length > 0);
}
assert.equal(EVACUATION_SOURCES.FL.directLayer, true);

const parsed = parseFloridaZoneResponse({ features: [{ attributes: {
  EZone: ' b ', County_Nam: 'MIAMI-DADE', STATUS: ' ', Edit_Date: '7/17/2013', EM_Web: 'https://example.gov/emergency',
} }] });
assert.deepEqual(parsed, {
  zone: 'B', county: 'MIAMI-DADE', status: '', editDate: '7/17/2013', emergencyManagementUrl: 'https://example.gov/emergency',
});
assert.equal(parseFloridaZoneResponse({ features: [] }), null);
assert.equal(parseFloridaZoneResponse({ error: { message: 'down' } }), null);

const geocodeUrl = new URL(buildFloridaGeocodeUrl('1100 Washington Ave, Miami Beach, FL'));
assert.equal(geocodeUrl.origin, 'https://geocode.arcgis.com');
assert.equal(geocodeUrl.searchParams.get('countryCode'), 'USA');
assert.equal(geocodeUrl.searchParams.get('maxLocations'), '5');
assert(geocodeUrl.searchParams.get('searchExtent').startsWith('-87.75,24.35'));

const candidate = chooseFloridaCandidate({ candidates: [{
  address: '1100 Washington Ave, Miami Beach, Florida',
  location: { x: -80.1332, y: 25.7823 },
  attributes: { Region: 'FL' },
}] });
assert.deepEqual(candidate, {
  lat: 25.7823, lon: -80.1332, address: '1100 Washington Ave, Miami Beach, Florida',
});
assert.equal(chooseFloridaCandidate({ candidates: [{
  address: 'Savannah, Georgia', location: { x: -81.09, y: 32.08 }, attributes: { Region: 'GA' },
}] }), null);
assert.throws(() => buildFloridaGeocodeUrl('   '), /address/i);
assert.throws(() => buildFloridaZoneQueryUrl('oops', -80), /latitude/i);

const validLayerPayload = {
  type: 'Feature Layer', name: 'Florida evacuation zones', geometryType: 'esriGeometryPolygon', fields: [{ name: 'EZone' }],
};
let probeCalls = 0;
const firstProbe = await probeFloridaZoneLayer({ force: true, fetcher: async () => { probeCalls += 1; return validLayerPayload; } });
assert.deepEqual(firstProbe, { available: true, reason: 'available' });
const cachedProbe = await probeFloridaZoneLayer({ fetcher: async () => { probeCalls += 1; return { error: { message: 'should not be called' } }; } });
assert.deepEqual(cachedProbe, firstProbe);
assert.equal(probeCalls, 1);
assert.deepEqual(await probeFloridaZoneLayer({ force: true, fetcher: async () => ({ error: { message: 'down' } }) }), { available: false, reason: 'service-error' });
assert.deepEqual(await probeFloridaZoneLayer({ force: true, fetcher: async () => ({ type: 'Feature Layer' }) }), { available: false, reason: 'invalid-response' });
assert.deepEqual(await probeFloridaZoneLayer({ force: true, fetcher: async () => { throw new Error('offline'); } }), { available: false, reason: 'unreachable' });

console.log('Evacuation-zone lookup utilities, source registry, and layer probe ok');
