import assert from 'node:assert/strict';

import {
  buildFloridaGeocodeUrl,
  buildFloridaZoneQueryUrl,
  chooseFloridaCandidate,
  parseFloridaZoneResponse,
} from '../src/evac.js';

const zoneUrl = new URL(buildFloridaZoneQueryUrl(25.7617, -80.1918));
assert.equal(zoneUrl.origin, 'https://services.arcgis.com');
assert.equal(zoneUrl.searchParams.get('geometry'), '-80.1918,25.7617');
assert.equal(zoneUrl.searchParams.get('geometryType'), 'esriGeometryPoint');
assert.equal(zoneUrl.searchParams.get('returnGeometry'), 'false');
assert(zoneUrl.searchParams.get('outFields').includes('EZone'));

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

console.log('Florida evacuation-zone lookup utilities ok');
