// Tide-gauge helpers: station picking, datagetter URL contract, residual math.
import { buildDataUrl, fetchWithRetry, nearestStations, peakResidual } from '../src/tides.js';
import { haversineKm } from '../src/geodesy.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`tides test failed: ${message}`);
    process.exit(1);
  }
}

// Haversine sanity: New Orleans -> Gulfport is ~110 km.
const nolaGulfport = haversineKm(29.95, -90.07, 30.37, -89.09);
assert(nolaGulfport > 90 && nolaGulfport < 130, `NOLA-Gulfport distance off: ${nolaGulfport}`);

const stations = [
  { id: '1', name: 'Near', state: 'LA', lat: 29.9, lon: -90.1 },
  { id: '2', name: 'Mid', state: 'MS', lat: 30.4, lon: -89.1 },
  { id: '3', name: 'Far', state: 'FL', lat: 27.8, lon: -82.6 },
];
const picked = nearestStations(stations, 29.95, -90.07, { max: 3, maxKm: 150 });
assert(picked.length === 2 && picked[0].id === '1' && picked[1].id === '2', `nearestStations picked ${picked.map(s => s.id).join(',')}`);
assert(Number.isFinite(picked[0].km) && picked[0].km < picked[1].km, 'distances must sort ascending');

const url = buildDataUrl('8761724', 'hourly_height', '2005-08-29T11:10:00Z');
const params = new URL(url).searchParams;
assert(url.startsWith('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'), `bad base: ${url}`);
assert(params.get('begin_date') === '20050827' && params.get('end_date') === '20050831', `±48h window wrong: ${params.get('begin_date')}..${params.get('end_date')}`);
assert(params.get('datum') === 'MLLW' && params.get('time_zone') === 'gmt' && params.get('format') === 'json', 'datum/tz/format contract');
assert(!params.get('interval'), 'hourly_height must not send interval');
assert(new URL(buildDataUrl('8761724', 'predictions', '2005-08-29T11:10:00Z')).searchParams.get('interval') === 'h', 'predictions must be hourly');

const observed = [
  { time: 1000, ft: 2.0 },
  { time: 2000, ft: 6.5 },
  { time: 3000, ft: 3.0 },
];
const predicted = [
  { time: 1000, ft: 1.8 },
  { time: 2000, ft: 1.5 },
  { time: 3000, ft: 2.0 },
];
const peak = peakResidual(observed, predicted);
assert(peak && peak.time === 2000 && Math.abs(peak.residual - 5.0) < 1e-9, `peak residual wrong: ${JSON.stringify(peak)}`);
assert(peakResidual([], predicted) === null, 'no observations -> null');
assert(peakResidual(observed, [{ time: 9999, ft: 1 }]) === null, 'no matching hours -> null');

const centeredPeak = peakResidual(
  [{ time: 0, ft: 3 }, { time: 60 * 3600_000, ft: 20 }],
  [{ time: 0, ft: 1 }, { time: 60 * 3600_000, ft: 1 }],
  { centerTime: 0, windowHours: 48 },
);
assert(centeredPeak?.time === 0 && centeredPeak.residual === 2, 'peak residual must ignore data outside the exact window');

let attempts = 0;
const retried = await fetchWithRetry('https://example.test/tides', {
  timeoutMs: 5,
  fetchImpl: (_url, { signal }) => {
    attempts += 1;
    if (attempts === 1) {
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    return Promise.resolve({ ok: true, status: 200 });
  },
});
assert(retried?.ok && attempts === 2, 'timed-out tide requests should retry once');

console.log('tides ok (station picking, datagetter contract, residual math)');
