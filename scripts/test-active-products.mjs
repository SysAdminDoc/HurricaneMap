import assert from 'node:assert/strict';

import { extractKmlFromKmz, parseOutlookKml } from '../src/outlook.js';
import { fetchMarineFeed, looksLikeKml, MARINE_FEEDS, parseMarineWarningKml } from '../src/marine-warnings.js';
import { isMissingProxyRoute, nhcProxyUrl } from '../src/nhc-proxy.js';

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

// Marine warnings must survive a deployment with no worker in front of it.
function recordingFetch(responder) {
  const requested = [];
  const fetchImpl = async url => {
    requested.push(String(url));
    return responder(String(url));
  };
  return { requested, fetchImpl };
}
const ok = body => ({ ok: true, status: 200, text: async () => body });
const notFound = () => ({ ok: false, status: 404, text: async () => '' });

const atlantic = MARINE_FEEDS[0];
assert.equal(atlantic.proxy, '/nhc/marine/atlantic.kml');
assert.match(atlantic.direct, /^https:\/\/www\.nhc\.noaa\.gov\/gis\/marine\/warnings\//);

const proxied = recordingFetch(() => ok(marineKml));
assert.equal((await fetchMarineFeed(atlantic, { fetchImpl: proxied.fetchImpl })).length, 1);
assert.deepEqual(proxied.requested, [atlantic.proxy], 'a working proxy must not reach out to NHC directly');

const fallback = recordingFetch(url => url === atlantic.proxy ? notFound() : ok(marineKml));
assert.equal((await fetchMarineFeed(atlantic, { fetchImpl: fallback.fetchImpl })).length, 1);
assert.deepEqual(fallback.requested, [atlantic.proxy, atlantic.direct], 'a 404 on the proxy must fall through to NHC');

const throwing = recordingFetch(url => {
  if (url === atlantic.proxy) throw new TypeError('Failed to fetch');
  return ok(marineKml);
});
assert.equal((await fetchMarineFeed(atlantic, { fetchImpl: throwing.fetchImpl })).length, 1, 'a network error on the proxy must fall through too');

// A 200 carrying something that is not KML must fall through, not be accepted
// as an empty ocean and cached for six hours.
assert.equal(looksLikeKml(marineKml), true);
assert.equal(looksLikeKml('<!doctype html><html><body>app shell</body></html>'), false);
assert.equal(looksLikeKml(''), false);
const shellFallback = recordingFetch(url => url === atlantic.proxy
  ? ok('<!doctype html><html><body>app shell</body></html>')
  : ok(marineKml));
assert.equal((await fetchMarineFeed(atlantic, { fetchImpl: shellFallback.fetchImpl })).length, 1);
assert.deepEqual(
  shellFallback.requested,
  [atlantic.proxy, atlantic.direct],
  'a 200 that is not KML must fall through to NHC',
);

const dead = recordingFetch(() => notFound());
await assert.rejects(
  fetchMarineFeed(atlantic, { fetchImpl: dead.fetchImpl }),
  error => error.responseStatus === 404,
  'both sources failing must surface the real status, not a generic error',
);
assert.deepEqual(dead.requested, [atlantic.proxy, atlantic.direct]);


// A 404 from /nhc/* is ambiguous: the relay passes NHC's status through, so it
// means "no worker here" or "the worker asked and NHC said no". Reading both as
// a missing route killed active-storm tracking for the rest of the page load on
// a real worker deployment the first time an upstream file moved. Every
// response the worker serves carries its tag.
const headers = entries => ({ get: name => entries[name] ?? null });
assert.equal(
  isMissingProxyRoute({ status: 404, headers: headers({}) }),
  true,
  'an untagged 404 means the relay route is not deployed',
);
assert.equal(
  isMissingProxyRoute({ status: 404, headers: headers({ 'X-HurricaneMap-CDN': 'MISS' }) }),
  false,
  'a 404 the relay itself served is an upstream miss, not a missing route',
);
assert.equal(
  isMissingProxyRoute({ status: 404, headers: headers({ 'X-HurricaneMap-CDN': 'HIT' }) }),
  false,
  'a cached relay 404 is still an upstream miss',
);
for (const status of [200, 429, 500, 503]) {
  assert.equal(
    isMissingProxyRoute({ status, headers: headers({}) }),
    false,
    `${status} is not a missing route`,
  );
}
assert.equal(isMissingProxyRoute(null), false, 'no response is not proof of a missing route');
assert.equal(isMissingProxyRoute({ status: 404 }), true, 'a 404 with no readable headers is treated as missing');

// Outside a browser there is no base to resolve against, so the canonical
// worker route is returned unchanged and the worker tests still read it.
assert.equal(nhcProxyUrl('/nhc/CurrentStorms.json'), '/nhc/CurrentStorms.json');

console.log('active NHC products ok');
