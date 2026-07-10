// Peak Storm Surge layer logic: query URL shape, label parsing, and the
// height-ramp styling contract.
import { buildPeakSurgeQueryUrl, parseSurgeFeet, surgeStyle } from '../src/peak-surge.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`peak-surge test failed: ${message}`);
    process.exit(1);
  }
}

const url = buildPeakSurgeQueryUrl();
assert(url.startsWith('https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_PeakStormSurge/MapServer/2/query?'), `bad base: ${url}`);
assert(url.includes('f=geojson'), 'query must request GeoJSON');
assert(url.includes('outSR=4326'), 'query must request WGS84');

assert(parseSurgeFeet('Peak Surge 3-6 ft') === 3, 'range lower bound');
assert(parseSurgeFeet('Greater than 9 feet') === 9, 'greater-than form');
assert(parseSurgeFeet('Less than 1 ft') === 1, 'less-than form');
assert(parseSurgeFeet('') === null && parseSurgeFeet(null) === null, 'unparseable -> null');

assert(surgeStyle(9.5).fillColor === '#f38ba8', '9+ ft ramp');
assert(surgeStyle(6).fillColor === '#fab387', '6-9 ft ramp');
assert(surgeStyle(3).fillColor === '#f9e2af', '3-6 ft ramp');
assert(surgeStyle(1).fillColor === '#74c7ec', '<3 ft ramp');
assert(surgeStyle(null).fillColor === '#89b4fa', 'unknown label fallback');
assert(surgeStyle(3).fillOpacity > 0 && surgeStyle(3).fillOpacity < 0.5, 'fill stays translucent');

console.log('peak-surge ok (query url, label parsing, height ramp)');
