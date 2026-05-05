import assert from 'node:assert/strict';
import {
  buildGoesLatestImageUrl,
  goesCacheStamp,
  goesSourcePageUrl,
  inferStormBasin,
  latestStormPoint,
  selectGoesSectorForStorm,
  selectGoesSectors,
} from '../src/goes-realtime.js';

assert.equal(inferStormBasin({ id: 'AL012026' }), 'AL', 'Atlantic storm id should infer AL basin');
assert.equal(inferStormBasin({ binNumber: 'AT1' }), 'AL', 'NHC AT alias should infer Atlantic basin');
assert.equal(inferStormBasin({ id: 'EP052026' }), 'EP', 'Eastern Pacific storm id should infer EP basin');
assert.equal(inferStormBasin({ id: 'CP012026' }), 'CP', 'Central Pacific storm id should infer CP basin');

assert.equal(selectGoesSectorForStorm({ id: 'AL012026' }), 'taw', 'Atlantic active storms use Tropical Atlantic sector');
assert.equal(selectGoesSectorForStorm({ id: 'EP052026' }), 'eep', 'Eastern Pacific active storms use Eastern East Pacific sector');
assert.equal(selectGoesSectorForStorm({ id: 'CP012026' }), 'tpw', 'Central Pacific active storms use Tropical Pacific sector');

assert.equal(
  selectGoesSectorForStorm({ name: 'Test', track: [{ lat: '18.5N', lon: '145.2W' }] }),
  'tpw',
  'unknown-basin storms west of 132W fall back to GOES-West Tropical Pacific',
);
assert.equal(
  selectGoesSectorForStorm({ name: 'Test', track: [{ lat: 20, lon: -105 }] }),
  'eep',
  'unknown-basin storms in the eastern Pacific fall back to Eastern East Pacific',
);
assert.equal(
  selectGoesSectorForStorm({ name: 'Test', track: [{ lat: 24, lon: -58 }] }),
  'taw',
  'unknown-basin storms in the Atlantic fall back to Tropical Atlantic',
);

assert.deepEqual(
  selectGoesSectors([{ id: 'AL012026' }, { id: 'AL022026' }, { id: 'EP012026' }]),
  ['taw', 'eep'],
  'sector selection should deduplicate in active-storm order',
);

assert.deepEqual(
  latestStormPoint({ track: [{ lat: 18, lon: -60 }, { latitude: '20.5N', longitude: '56.5W' }] }),
  { lat: 20.5, lon: -56.5 },
  'latest point should parse numeric and N/W string coordinates',
);

assert.equal(
  buildGoesLatestImageUrl('taw', { cacheBust: false }),
  'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/taw/GEOCOLOR/900x540.jpg',
  'Tropical Atlantic image URL should use the small current NOAA STAR JPEG',
);
assert.equal(
  buildGoesLatestImageUrl('tpw', { size: 'thumbnail', cacheBust: false }),
  'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/tpw/GEOCOLOR/thumbnail.jpg',
  'Tropical Pacific image URL should use GOES-West when requested',
);
assert.match(
  buildGoesLatestImageUrl('eep', { cacheBust: 1710000123456 }),
  /\/GOES19\/ABI\/SECTOR\/eep\/GEOCOLOR\/900x540\.jpg\?t=1710000000000$/,
  'cache stamp should align to the 10-minute STAR refresh cadence',
);
assert.equal(goesCacheStamp('2026-05-05T13:30Z'), '2026-05-05T1330Z', 'string cache stamps should be URL safe');
assert.equal(
  goesSourcePageUrl('taw'),
  'https://www.goes.noaa.gov/sector.php?sat=G19&sector=taw',
  'source page should point to the official NOAA sector page',
);

console.log('goes realtime utilities ok');
