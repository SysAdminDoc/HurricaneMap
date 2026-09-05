import assert from 'node:assert/strict';

import {
  nhcWalletUrlFor,
  noaaTcrUrl,
  reconArchiveUrl,
  sliderSatelliteUrl,
  wikipediaUrl,
  youtubeUrl,
} from '../src/panel-impacts.js';

const katrina = {
  id: 'AL122005',
  name: 'KATRINA',
  year: 2005,
  basin: 'AL',
  peak_wind_kt: 150,
  track: [{ t: '2005-08-29T11:00:00Z' }],
  us_landfalls: [{ t: '2005-08-29T11:00:00Z', state: 'Louisiana' }],
};
const modern = { ...katrina, id: 'AL092022', name: 'IAN', year: 2022, us_landfalls: [{ t: '2022-09-28T19:05:00Z', state: 'Florida' }] };
const hawaii = { ...modern, id: 'CP012023', name: 'DORA', us_landfalls: [{ t: '2023-08-08T12:00:00Z', state: 'Hawaii' }] };
const unnamed = { id: 'AL051950', name: 'UNNAMED', year: 1950, basin: 'AL', peak_wind_kt: 60, track: [{ t: '1950-09-05T00:00:00Z' }], us_landfalls: [] };

// Every outbound link has to be a real absolute https URL. A builder that
// returns a relative fragment resolves against the app's own origin.
function assertHttpsUrl(value, label) {
  assert.ok(value, `${label} produced nothing`);
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', `${label} must be https`);
  assert.ok(url.hostname.includes('.'), `${label} must name a real host`);
}

// Storm names reach these builders straight from HURDAT2 and end up inside a
// query string, so they have to be encoded rather than concatenated.
{
  assertHttpsUrl(wikipediaUrl(katrina), 'wikipediaUrl');
  const query = storm => new URL(wikipediaUrl(storm)).searchParams.get('search');
  assert.equal(query(katrina), 'Hurricane Katrina (2005)', 'a hurricane must be searched as a hurricane');
  assert.equal(
    query({ ...katrina, peak_wind_kt: 45 }),
    'Tropical Storm Katrina (2005)',
    'a storm that never reached hurricane strength must not be called one',
  );
  assert.equal(query(unnamed), '1950 Atlantic hurricane season', 'an unnamed storm falls back to its season');
  // `new URL()` re-encodes spaces on parse, so a raw-string check is the only
  // one that can fail. An unescaped & or # would split the query instead.
  const awkward = wikipediaUrl({ ...katrina, name: 'A&B#C D' });
  assert.ok(!/[ #]/.test(awkward.split('?')[1]), 'the query string must arrive encoded');
  assert.equal(new URL(awkward).searchParams.get('search'), 'Hurricane A&B#C D (2005)');
}

{
  assertHttpsUrl(youtubeUrl(katrina), 'youtubeUrl');
  const search = storm => new URL(youtubeUrl(storm)).searchParams.get('search_query');
  assert.equal(search(katrina), 'hurricane Katrina 2005 landfall', 'a hurricane search must say hurricane');
  assert.equal(search({ ...katrina, peak_wind_kt: 45 }), 'tropical storm Katrina 2005 landfall');
  const awkwardYt = youtubeUrl({ ...katrina, name: 'A&B#C D' });
  assert.ok(!/[ #]/.test(awkwardYt.split('?')[1]), 'the search query must arrive encoded');
  assert.equal(new URL(awkwardYt).searchParams.get('search_query'), 'hurricane A&B#C D 2005 landfall');
}

// NOAA's report and wallet archives simply do not go back before 1995. A URL
// for an older storm is a 404 dressed up as a source link.
{
  assertHttpsUrl(noaaTcrUrl(modern), 'noaaTcrUrl');
  assert.match(noaaTcrUrl(modern), /season=2022&basin=atl/);
  assert.equal(noaaTcrUrl({ ...katrina, year: 1994 }), null, 'no report archive before 1995');
  assert.ok(noaaTcrUrl({ ...katrina, year: 1995 }), '1995 is the first year that has one');

  assertHttpsUrl(nhcWalletUrlFor(modern), 'nhcWalletUrlFor');
  assert.match(nhcWalletUrlFor(modern), /archive\/2022\/AL092022\.shtml/, 'the wallet is indexed by storm id');
  assert.equal(nhcWalletUrlFor({ ...katrina, year: 1994 }), null);
}

// The recon archive is Atlantic-only and thins out before 1989.
{
  assertHttpsUrl(reconArchiveUrl(katrina), 'reconArchiveUrl');
  assert.match(reconArchiveUrl(katrina), /archive=2005&storm=Katrina/);
  assert.equal(reconArchiveUrl({ ...katrina, basin: 'EP' }), null, 'the mirror carries no eastern Pacific storms');
  assert.equal(reconArchiveUrl({ ...katrina, year: 1988 }), null);
  assert.equal(reconArchiveUrl(unnamed), null, 'the archive is indexed by name');
  const awkwardRecon = reconArchiveUrl({ ...katrina, name: 'A&B#C D' });
  assert.ok(!/[ #]/.test(awkwardRecon.split('?')[1].split('storm=')[1]), 'the storm name must arrive encoded');
  const stormParam = new URL(awkwardRecon).searchParams.get('storm');
  assert.ok(stormParam.includes('&') && stormParam.includes('#'), 'the name must survive the round trip intact');
}

// SLIDER. GOES-19 replaced GOES-16 as GOES-East on 2025-04-07 and the old
// name now 404s, so the satellite a link names is a correctness question.
{
  const link = sliderSatelliteUrl(modern);
  assertHttpsUrl(link, 'sliderSatelliteUrl');
  const url = new URL(link);
  assert.equal(url.hostname, 'slider.cira.colostate.edu', 'only the canonical host');
  assert.equal(url.searchParams.get('sat'), 'goes-19', 'GOES-East is goes-19');
  assert.equal(url.searchParams.get('sec'), 'conus');
  assert.equal(
    Number(url.searchParams.get('start_unix')),
    Math.floor(Date.parse('2022-09-28T19:05:00Z') / 1000),
    'the link must open at the storm\'s first landfall, in Unix seconds',
  );

  const hawaiiUrl = new URL(sliderSatelliteUrl(hawaii));
  assert.equal(hawaiiUrl.searchParams.get('sat'), 'goes-18', 'Hawaii is covered by GOES-West');
  assert.equal(hawaiiUrl.searchParams.get('sec'), 'full_disk');

  assert.equal(sliderSatelliteUrl({ ...modern, year: 2017 }), null, 'SLIDER carries no imagery before 2018');
  assert.equal(
    sliderSatelliteUrl({ ...modern, us_landfalls: [], track: [] }),
    null,
    'a storm with no time to pin must not produce a link to an arbitrary moment',
  );
  // No landfall but a track: pin to the first track point rather than giving up.
  const openOcean = sliderSatelliteUrl({ ...modern, us_landfalls: [], track: [{ t: '2022-09-26T00:00:00Z' }] });
  assert.equal(
    Number(new URL(openOcean).searchParams.get('start_unix')),
    Math.floor(Date.parse('2022-09-26T00:00:00Z') / 1000),
  );
}

console.log('panel impacts ok (7 source links: encoding, archive floors, basin limits, GOES-East/West sectors)');
