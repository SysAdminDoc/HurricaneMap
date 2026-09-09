import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { extractKmlFromKmz, parseOutlookKml } from '../src/outlook.js';
import {
  DEFAULT_MARINE_HORIZON,
  fetchMarineFeed,
  looksLikeKml,
  marineFeedsFor,
  MARINE_HORIZONS,
  parseMarineWarningKml,
} from '../src/marine-warnings.js';
import { isMissingProxyRoute, nhcProxyUrl } from '../src/nhc-proxy.js';
import {
  SUMMARY_LAYERS,
  buildSummaryQueryUrl,
  fetchSummaryActiveStorms,
  fetchSummaryOutlookPoints,
  parseSummaryActiveStorms,
  parseSummaryOutlookPoints,
  summaryStormId,
} from '../src/nhc-summary.js';

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

const atlantic = marineFeedsFor()[0];
assert.equal(atlantic.proxy, '/nhc/marine/atlantic-00to24.kml');
assert.equal(atlantic.horizon, DEFAULT_MARINE_HORIZON);
assert.match(atlantic.direct, /^https:\/\/www\.nhc\.noaa\.gov\/gis\/marine\/warnings\//);

// The band has to reach both halves of the URL. NHC's KML names itself
// GMWW24Hr.kml in the 24-48 h file too, so the request is the only place the
// forecast period is ever stated, and a band that fails to reach it produces a
// layer that is wrong in exactly the way nobody can see.
for (const horizon of MARINE_HORIZONS) {
  const feeds = marineFeedsFor(horizon);
  assert.equal(feeds.length, 2, `${horizon} must cover both basins`);
  for (const feed of feeds) {
    assert.equal(feed.horizon, horizon);
    assert.ok(feed.proxy.endsWith(`-${horizon}.kml`), `${feed.proxy} does not carry its band`);
    assert.ok(feed.direct.includes(`GMWW_${horizon}_`), `${feed.direct} does not carry its band`);
  }
}
assert.notDeepEqual(
  marineFeedsFor('00to24').map(feed => feed.direct),
  marineFeedsFor('24to48').map(feed => feed.direct),
  'the two forecast bands must not resolve to the same NHC products',
);
// An unknown band is the 0-24 h one, never a URL NHC does not publish.
assert.deepEqual(marineFeedsFor('72to96'), marineFeedsFor(DEFAULT_MARINE_HORIZON));
assert.deepEqual(marineFeedsFor(undefined), marineFeedsFor(DEFAULT_MARINE_HORIZON));

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

// ---------------------------------------------------------------------------
// The CORS-open summary MapServer, which is what a deployment with no relay
// reads instead. Fixtures were captured live on 2026-09-07: layer 5 while
// Hurricane Lowell (CP4) and Tropical Storm Marie (EP3) were active, and the
// outlook layer while one Pacific disturbance was posted. Layer 0 is the group
// layer those outlook points hang under and answers /query with
// "Invalid or missing input parameters", so layer 2, its Seven-Day child, is
// the queryable one.
const forecastFixture = JSON.parse(
  await readFile(new URL('../tests/fixtures/nhc-summary-forecast-points.json', import.meta.url), 'utf8'),
);
const outlookFixture = JSON.parse(
  await readFile(new URL('../tests/fixtures/nhc-summary-outlook-points.json', import.meta.url), 'utf8'),
);

assert.match(
  buildSummaryQueryUrl(SUMMARY_LAYERS.forecastPoints),
  /^https:\/\/mapservices\.weather\.noaa\.gov\/tropical\/rest\/services\/tropical\/NHC_tropical_weather_summary\/MapServer\/5\/query\?/,
);
const queryParams = new URL(buildSummaryQueryUrl(SUMMARY_LAYERS.outlook)).searchParams;
assert.equal(queryParams.get('f'), 'geojson', 'the parsers read GeoJSON, not Esri JSON');
assert.equal(queryParams.get('outSR'), '4326', 'Leaflet needs WGS84 degrees');
assert.equal(queryParams.get('returnGeometry'), 'true', 'the position is the whole point of the query');

const summaryStorms = parseSummaryActiveStorms(forecastFixture);
assert.equal(summaryStorms.length, 2, 'six forecast rows describe two storms, not six');
const [lowell, marie] = summaryStorms;
assert.deepEqual(
  { id: lowell.id, binNumber: lowell.binNumber, name: lowell.name, classification: lowell.classification },
  { id: 'EP122026', binNumber: 'CP4', name: 'Lowell', classification: 'MH' },
  'Lowell crossed into the central Pacific, so its bin is CP4 while its ATCF id stays EP12',
);
assert.deepEqual(
  { id: marie.id, binNumber: marie.binNumber, name: marie.name, classification: marie.classification },
  { id: 'EP132026', binNumber: 'EP3', name: 'Marie', classification: 'TS' },
);

// The current fix is tau 0, not the last row in the payload. Lowell's 24-hour
// point sits at 22.4N; reading the wrong row would put the marker there.
assert.equal(lowell.lat, 18.000000000100044);
assert.equal(Math.round(lowell.lon * 10) / 10, -162.1);
assert.equal(lowell.intensity, 100, "the tau-0 row's 100 kt, not the 85 kt forecast for hour 24");
assert.equal(lowell.pressure, 955);
assert.equal(lowell.advNum, '46A', 'advisory numbers carry intermediate suffixes');
assert.equal(marie.intensity, 55);
assert.equal(marie.movementDir, 300);
assert.equal(marie.movementSpeed, 6);

// 9999 is NHC's "no value", and every forecast row past tau 0 carries it.
const forecastOnly = {
  type: 'FeatureCollection',
  features: forecastFixture.features.filter(feature => Number(feature.properties.tau) === 12),
};
const withoutCurrentFix = parseSummaryActiveStorms(forecastOnly);
assert.equal(withoutCurrentFix.length, 2, 'an advisory without a tau-0 row still has storms in it');
assert.equal(withoutCurrentFix[0].pressure, null, '9999 mb must not reach the storm card');
assert.equal(withoutCurrentFix[0].movementDir, null);
assert.equal(withoutCurrentFix[0].movementSpeed, null);

// The advisory the row was cut from is the only place the year appears;
// validtime carries a day and a clock and nothing else.
const advisoryYearOnly = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-70, 25] },
    properties: {
      ...forecastFixture.features[0].properties,
      idp_filedate: null,
      advdate: '500 PM AST Thu Sep 03 2025',
      basin: 'AL',
      stormnum: 9,
      binnumber: 'AT1',
    },
  }],
};
const pinnedNow = Date.UTC(2026, 0, 2);
assert.equal(
  parseSummaryActiveStorms(advisoryYearOnly, { now: pinnedNow })[0].id,
  'AL092025',
  'with no file date the advisory text supplies the year, including across a new year',
);
// The advisory names its year outright, so it is taken as written even when it
// is old. Rejecting it would replace a date the product states with a guess at
// today's, which is a worse answer than the one it corrects.
assert.equal(
  parseSummaryActiveStorms({
    type: 'FeatureCollection',
    features: [{
      ...advisoryYearOnly.features[0],
      properties: { ...advisoryYearOnly.features[0].properties, advdate: '500 PM AST Thu Sep 03 2011' },
    }],
  }, { now: pinnedNow })[0].id,
  'AL092011',
  'a year the advisory states is the year, not a guess to be overruled',
);

// A rename upstream would leave every storm nameless at an unknown position.
// Failing loudly is the only way that reaches anyone.
for (const field of ['stormname', 'advisnum', 'basin', 'binnumber']) {
  const renamed = {
    type: 'FeatureCollection',
    features: forecastFixture.features.map(feature => {
      const properties = { ...feature.properties };
      properties[`${field}_v2`] = properties[field];
      delete properties[field];
      return { ...feature, properties };
    }),
  };
  assert.throws(
    () => parseSummaryActiveStorms(renamed),
    error => error.missingFields?.includes(field) && new RegExp(field).test(error.message),
    `renaming ${field} upstream must fail the gate, not render blanks`,
  );
}

// The contract has to hold for every row, not only the first one read. A rename
// that reaches part of a payload, or a leading feature with no properties at
// all, used to pass the whole thing and let the rest render as nameless storms
// at unknown positions.
const renamedSecondRow = {
  type: 'FeatureCollection',
  features: forecastFixture.features.map((feature, index) => {
    if (index === 0) return feature;
    const properties = { ...feature.properties };
    properties.stormName = properties.stormname;
    delete properties.stormname;
    return { ...feature, properties };
  }),
};
assert.throws(
  () => parseSummaryActiveStorms(renamedSecondRow),
  error => error.missingFields?.includes('stormname'),
  'a rename that reaches only some rows must fail the gate too',
);
assert.throws(
  () => parseSummaryActiveStorms({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-70, 25] } },
      ...forecastFixture.features.map(feature => {
        const properties = { ...feature.properties };
        delete properties.binnumber;
        return { ...feature, properties };
      }),
    ],
  }),
  error => error.missingFields?.includes('binnumber'),
  'a first feature with no properties must not disable the check for the rest',
);

// binnumber is a display slot, not an identity. Lowell was EP12 in bin CP4
// after crossing into the central Pacific, so keying on the bin let two storms
// collapse into one and let one storm split into two.
const sharedBin = {
  type: 'FeatureCollection',
  features: forecastFixture.features.map(feature => ({
    ...feature,
    properties: { ...feature.properties, binnumber: 'CP4' },
  })),
};
assert.deepEqual(
  parseSummaryActiveStorms(sharedBin).map(storm => storm.id),
  ['EP122026', 'EP132026'],
  'two storms sharing a bin must stay two storms',
);
const splitBin = {
  type: 'FeatureCollection',
  features: forecastFixture.features
    .filter(feature => feature.properties.binnumber === 'CP4')
    .map((feature, index) => ({
      ...feature,
      properties: { ...feature.properties, binnumber: index ? 'EP4' : 'CP4' },
    })),
};
assert.deepEqual(
  parseSummaryActiveStorms(splitBin).map(storm => storm.id),
  ['EP122026'],
  'one storm whose bin changes mid-advisory must stay one storm',
);

// An unreadable tau on the row already held used to let a five-day forecast
// point replace the current fix, because NaN <= anything is false.
const unreadableTau = {
  type: 'FeatureCollection',
  features: forecastFixture.features
    .filter(feature => feature.properties.binnumber === 'CP4')
    .map(feature => ({ ...feature, properties: { ...feature.properties, tau: 'n/a' } })),
};
const [heldRow] = parseSummaryActiveStorms(unreadableTau);
assert.equal(heldRow.lat, 18.000000000100044, 'a bad tau must not promote a later forecast point to the current fix');
assert.equal(heldRow.intensity, 100);

// 9999 is the sentinel in lat and lon as well, and a marker at 9999N is worse
// than no marker at all.
assert.deepEqual(
  parseSummaryActiveStorms({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [9999, 9999] },
      properties: { ...forecastFixture.features[0].properties, lat: 9999, lon: 9999 },
    }],
  }),
  [],
  'a storm at the sentinel position must be dropped, not drawn',
);

// idp_filedate is epoch milliseconds. Read as seconds it lands in 1970 and the
// id stops matching the cone service, with nothing to show for it.
assert.equal(
  summaryStormId(
    { basin: 'EP', stormnum: 12, idp_filedate: 1788801759, advdate: '800 AM HST Mon Sep 07 2026' },
    Date.UTC(2026, 8, 7),
  ),
  'EP122026',
  'a file date read as seconds lands in 1970; the advisory text must win instead',
);
assert.equal(summaryStormId({ basin: 'AL', stormnum: 100, advdate: 'Sep 07 2026' }, Date.UTC(2026, 8, 7)), '', 'ATCF numbers are two digits');
assert.equal(summaryStormId({ basin: 'AL', stormnum: 0, advdate: 'Sep 07 2026' }, Date.UTC(2026, 8, 7)), '');

// Number('') and Number(null) are both 0, which is finite. A blank storm
// number gave every such row the key "AL:0" and collapsed two live storms into
// one, with an empty id and no second marker on the map.
const blankStormNumbers = {
  type: 'FeatureCollection',
  features: ['AT1', 'AT2'].map((bin, index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-70 - index, 25 + index] },
    properties: {
      ...forecastFixture.features[0].properties,
      basin: 'AL', stormnum: '', binnumber: bin, stormname: index ? 'Tropical Storm Bill' : 'Hurricane Ana',
    },
  })),
};
assert.deepEqual(
  parseSummaryActiveStorms(blankStormNumbers).map(storm => storm.binNumber).sort(),
  ['AT1', 'AT2'],
  'a blank storm number must fall back to the bin rather than merging two storms',
);
assert.equal(
  parseSummaryActiveStorms({
    type: 'FeatureCollection',
    features: blankStormNumbers.features.map(feature => ({
      ...feature,
      properties: { ...feature.properties, stormnum: null },
    })),
  }).length,
  2,
  'a null storm number must not merge two storms either',
);

// Same arithmetic, the other field: a null or empty tau read as tau zero, the
// current fix, so a five-day forecast point took the storm's position.
for (const emptyTau of [null, '', '   ']) {
  const [storm] = parseSummaryActiveStorms({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-170, 30] },
        properties: { ...forecastFixture.features[0].properties, tau: emptyTau, maxwind: 35 },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-162, 18] },
        properties: { ...forecastFixture.features[0].properties, tau: 0, maxwind: 110 },
      },
    ],
  });
  assert.deepEqual(
    { lat: storm.lat, intensity: storm.intensity },
    { lat: 18, intensity: 110 },
    `a tau of ${JSON.stringify(emptyTau)} must not outrank the current fix`,
  );
}

// RFC 7946 permits "properties": null. Such a row carries no storm, and used to
// abort the whole layer over a field name it never had.
const nullProperties = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-70, 25] }, properties: null },
    ...forecastFixture.features,
  ],
};
assert.equal(
  parseSummaryActiveStorms(nullProperties).length,
  2,
  'a row with no properties must be skipped, not turned into an error for every other storm',
);

// The category is decorated in the wild, and exact matching turned an 80%
// disturbance into the low-risk marker.
const decoratedRisk = parseSummaryOutlookPoints({
  type: 'FeatureCollection',
  features: [
    ['High (>60%)', '80 percent'],
    ['Medium (40-60%)', '50 percent'],
    ['', '80 percent'],
    ['', '45 percent'],
    ['', '20 percent'],
    ['', 'Near 0%'],
  ].map(([risk7day, prob7day], index) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-40 - index, 12] },
    properties: { objectid: index + 1, basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', risk7day, prob7day },
  })),
});
assert.deepEqual(
  decoratedRisk.map(point => point.risk),
  ['high', 'medium', 'high', 'medium', 'low', 'near-zero'],
  'a decorated category, and a bare percentage with no category, must both set the right symbol',
);

// NHC numbers the disturbances it issues, not the ones this parser can place,
// so a dropped row still consumes its ordinal.
const withSentinel = parseSummaryOutlookPoints({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [9999, 9999] }, properties: { objectid: 1, basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', prob7day: '20%', risk7day: 'Low' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-50, 14] }, properties: { objectid: 2, basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', prob7day: '20%', risk7day: 'Low' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-45, 15] }, properties: { objectid: 3, basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', prob7day: '20%', risk7day: 'Low' } },
  ],
});
assert.deepEqual(
  withSentinel.map(point => point.disturbance),
  ['2', '3'],
  'a disturbance this parser cannot place must not renumber the ones it can',
);

// Out of season the layer is empty. That is an answer, not a broken contract.
assert.deepEqual(parseSummaryActiveStorms({ type: 'FeatureCollection', features: [] }), []);
assert.deepEqual(parseSummaryOutlookPoints({ type: 'FeatureCollection', features: [] }), []);

// An Esri error body arrives with HTTP 200, so the status alone proves nothing.
assert.throws(
  () => parseSummaryOutlookPoints({ error: { code: 400, message: 'Invalid or missing input parameters.' } }),
  /Invalid or missing input parameters/,
);

const outlookPoints = parseSummaryOutlookPoints(outlookFixture);
assert.equal(outlookPoints.length, 1);
assert.deepEqual(outlookPoints[0], {
  basin: 'pacific',
  disturbance: '1',
  lat: 13.161075667108491,
  lon: -107.06410410362139,
  risk: 'medium',
  twoDay: '10%',
  sevenDay: '60%',
  discussion: '',
}, 'the seven-day category drives the marker, and the KMZ-only discussion is blank');

// NHC numbers its disturbances in objectid order, and so does the marker.
const outlookRisks = parseSummaryOutlookPoints({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-40, 12] }, properties: { objectid: 3, basin: 'Atlantic', prob2day: 'Near 0%', risk2day: 'Near 0%', prob7day: 'Near 0%', risk7day: 'Near 0%' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-60, 15] }, properties: { objectid: 1, basin: 'Atlantic', prob2day: '80%', risk2day: 'High', prob7day: '90%', risk7day: 'High' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-50, 14] }, properties: { objectid: 2, basin: 'Atlantic', prob2day: '20%', risk2day: 'Low', prob7day: '30%', risk7day: 'Low' } },
  ],
});
assert.deepEqual(outlookRisks.map(point => point.risk), ['high', 'low', 'near-zero']);
assert.deepEqual(outlookRisks.map(point => point.disturbance), ['1', '2', '3']);
const twoBasins = parseSummaryOutlookPoints({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-60, 15] }, properties: { objectid: 1, basin: 'Atlantic', prob2day: '80%', risk2day: 'High', prob7day: '90%', risk7day: 'High' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-120, 12] }, properties: { objectid: 2, basin: 'Pacific', prob2day: '10%', risk2day: 'Low', prob7day: '30%', risk7day: 'Low' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-50, 14] }, properties: { objectid: 3, basin: 'Atlantic', prob2day: '20%', risk2day: 'Low', prob7day: '30%', risk7day: 'Low' } },
  ],
});
// NHC issues one outlook per basin and numbers the disturbances within it, so
// a marker reading "Disturbance 3" would not match any product it publishes.
assert.deepEqual(
  twoBasins.map(point => `${point.basin}:${point.disturbance}`),
  ['atlantic:1', 'pacific:1', 'atlantic:2'],
);

// The category is a category. Folding the percentage into it let any prob7day
// text containing "high" set the symbol, and lost the near-zero X when the
// category was blank.
const blankCategory = parseSummaryOutlookPoints({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-40, 12] }, properties: { objectid: 1, basin: 'Atlantic', prob2day: 'Near 0%', risk2day: 'Near 0%', risk7day: '', prob7day: 'Near 0%' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-41, 12] }, properties: { objectid: 2, basin: 'Atlantic', prob2day: '10%', risk2day: 'Low', risk7day: 'Low', prob7day: 'high confidence 20%' } },
  ],
});
assert.deepEqual(blankCategory.map(point => point.risk), ['near-zero', 'low']);
assert.deepEqual(outlookRisks.map(point => point.lon), [-60, -50, -40], 'the ordinal must follow objectid, not payload order');

// A deployment with no relay makes exactly one request per feed, to the
// service NHC lets a browser read.
const summaryCalls = [];
const summaryFetch = async (url, init) => {
  summaryCalls.push({ url: String(url), signal: init?.signal ?? null });
  return { ok: true, status: 200, json: async () => forecastFixture };
};
assert.equal((await fetchSummaryActiveStorms({ fetchImpl: summaryFetch })).length, 2);
assert.equal(summaryCalls.length, 1, 'the forecast points arrive in a single query');
assert.match(summaryCalls[0].url, /\/MapServer\/5\/query\?/);

await assert.rejects(
  fetchSummaryOutlookPoints({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }),
  error => error.responseStatus === 503,
  'a failing service must surface its status so the feed can back off and retry',
);

console.log('active NHC products ok');
