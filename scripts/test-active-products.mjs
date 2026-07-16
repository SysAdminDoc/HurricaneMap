import assert from 'node:assert/strict';

import { extractKmlFromKmz, parseOutlookKml } from '../src/outlook.js';
import { parseMarineWarningKml } from '../src/marine-warnings.js';

const outlookKml = `<?xml version="1.0"?><kml><Document>
  <Placemark><styleUrl>#zerox</styleUrl><ExtendedData>
    <Data name="Disturbance"><value>1</value></Data>
    <Data name="2day_percentage"><value>Near 0%</value></Data>
    <Data name="2day_category"><value>NearZero</value></Data>
    <Data name="7day_percentage"><value>Near 0%</value></Data>
    <Data name="7day_category"><value>NearZero</value></Data>
    <Data name="Discussion"><value><![CDATA[No formation expected.]]></value></Data>
  </ExtendedData><Point><coordinates>-112.5,14.25,0</coordinates></Point></Placemark>
  <Placemark><styleUrl>#medx</styleUrl><ExtendedData>
    <Data name="Disturbance"><value>2</value></Data>
    <Data name="7day_category"><value>Medium</value></Data>
  </ExtendedData><Point><coordinates>-63,12,0</coordinates></Point></Placemark>
</Document></kml>`;

const outlook = parseOutlookKml(outlookKml, 'pac');
assert.equal(outlook.length, 2);
assert.deepEqual(outlook[0], {
  basin: 'pac', disturbance: '1', lat: 14.25, lon: -112.5, risk: 'near-zero',
  twoDay: 'Near 0%', sevenDay: 'Near 0%', discussion: 'No formation expected.',
});
assert.equal(outlook[1].risk, 'medium');

const marineKml = `<?xml version="1.0"?><kml><Document>
  <Placemark><name>No risk</name><styleUrl>#none</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>-80,20 -79,20 -79,21 -80,20</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Hurricane force possible</name><styleUrl>#high</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>-75,25 -74,25 -74,26 -75,25</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
const marine = parseMarineWarningKml(marineKml);
assert.equal(marine.length, 1, 'the no-risk background polygon must not obscure the map');
assert.equal(marine[0].properties.risk, 'high');
assert.deepEqual(marine[0].geometry.coordinates[0][0], [-75, 25]);

function storedKmz(filename, contents) {
  const name = Buffer.from(filename);
  const data = Buffer.from(contents);
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

assert.equal(await extractKmlFromKmz(storedKmz('doc.kml', outlookKml)), outlookKml);

console.log('active NHC products ok');
