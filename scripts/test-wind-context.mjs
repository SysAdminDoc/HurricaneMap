import assert from 'node:assert/strict';

import {
  buildArrivalUrl,
  buildWindProbabilityUrl,
  isFreshProduct,
  loadWindContext,
  parseNearestArrival,
  parseWindProbability,
  renderWindContext,
  cancelWindContext,
} from '../src/wind-context.js';

const now = Date.UTC(2026, 6, 25, 18);
const issuedAt = now - (60 * 60 * 1000);
const point = { lat: 25, lon: -75 };

assert.match(buildWindProbabilityUrl(30, point.lat, point.lon), /geometry=-75%2C25/);
assert.match(buildWindProbabilityUrl(30, point.lat, point.lon), /f=json/);
assert.match(buildArrivalUrl(18, point.lat, point.lon), /distance=75/);
assert.match(buildArrivalUrl(18, point.lat, point.lon), /f=geojson/);
assert.equal(isFreshProduct(issuedAt, now), true);
assert.equal(isFreshProduct(now - (10 * 60 * 60 * 1000), now), false);

const wind = parseWindProbability({
  features: [
    { attributes: { percentage: '5-10%', idp_filedate: issuedAt, idp_source: 'wsp34' } },
    { attributes: { percentage: '20-30%', idp_filedate: issuedAt, idp_source: 'wsp34' } },
    { attributes: { percentage: '90%', idp_filedate: now - (24 * 60 * 60 * 1000), idp_source: 'stale' } },
  ],
}, { layer: 30, knots: 34, mph: 39 }, now);
assert.equal(wind.label, '20-30%', 'highest overlapping current probability band should win');
assert.equal(wind.knots, 34);

const arrival = parseNearestArrival({
  features: [
    {
      properties: {
        arrival_time: 'Sat 8 PM',
        idp_filedate: issuedAt,
        idp_source: 'EP062026_arrival',
        idp_subset: 'ep062026',
      },
      geometry: { type: 'LineString', coordinates: [[-75.2, 24.9], [-74.8, 25.1]] },
    },
  ],
}, { layer: 18, kind: 'earliest' }, point.lat, point.lon, now);
assert.equal(arrival.label, 'Sat 8 PM');
assert(arrival.distanceKm < 1, `expected nearby contour, got ${arrival.distanceKm} km`);

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

const requested = [];
const fetchImpl = async url => {
  requested.push(url);
  const layer = Number(new URL(url).pathname.match(/\/(\d+)\/query$/)?.[1]);
  if (layer >= 30) {
    return response({
      features: [{ attributes: {
        percentage: layer === 30 ? '40-50%' : layer === 31 ? '20-30%' : '5-10%',
        idp_filedate: issuedAt,
        idp_source: `wsp-${layer}`,
      } }],
    });
  }
  return response({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        arrival_time: layer === 18 ? 'Sat 8 PM' : 'Sun 2 AM',
        idp_filedate: issuedAt,
        idp_source: `arrival-${layer}`,
        idp_subset: 'ep062026',
      },
      geometry: { type: 'LineString', coordinates: [[-75.2, 24.9], [-74.8, 25.1]] },
    }],
  });
};

const current = await loadWindContext(point.lat, point.lon, { fetchImpl, now });
assert.equal(requested.length, 5);
assert.equal(current.status, 'current');
assert.equal(current.probabilities.length, 3);
assert.equal(current.arrivals.length, 2);
assert.equal(current.issuedAt, issuedAt);

const currentHost = { innerHTML: '' };
renderWindContext(currentHost, current);
assert.match(currentHost.innerHTML, /34 kt \(39 mph\)/);
assert.match(currentHost.innerHTML, /40-50%/);
assert.match(currentHost.innerHTML, /Sat 8 PM/);
assert.match(currentHost.innerHTML, /nearest official 34 kt contour/);
assert.match(currentHost.innerHTML, /not a track, surge, or guaranteed impact forecast/);
assert.match(currentHost.innerHTML, /nhc\.noaa\.gov/);

const staleFetch = async url => {
  const layer = Number(new URL(url).pathname.match(/\/(\d+)\/query$/)?.[1]);
  const properties = {
    idp_filedate: now - (24 * 60 * 60 * 1000),
    percentage: '80-90%',
    arrival_time: 'Stale time',
  };
  return response(layer >= 30
    ? { features: [{ attributes: properties }] }
    : { features: [{ properties, geometry: { type: 'LineString', coordinates: [[-75, 25], [-74, 25]] } }] });
};
const stale = await loadWindContext(point.lat, point.lon, { fetchImpl: staleFetch, now });
assert.equal(stale.status, 'link-only');
const staleHost = { innerHTML: '' };
renderWindContext(staleHost, stale);
assert.doesNotMatch(staleHost.innerHTML, /80-90%|Stale time/, 'stale values must never render');
assert.match(staleHost.innerHTML, /Older values are not shown/);
assert.match(staleHost.innerHTML, /NHC product guide/);

const failed = await loadWindContext(point.lat, point.lon, {
  fetchImpl: async () => { throw new TypeError('offline'); },
  now,
});
assert.equal(failed.status, 'link-only');
const failedHost = { innerHTML: '' };
renderWindContext(failedHost, failed);
assert.match(failedHost.innerHTML, /NHC product guide/);
assert.doesNotMatch(failedHost.innerHTML, /40-50%/);

// A retry runs with no caller signal, because the one the first request came
// with may already be aborted. Nothing could cancel it, so five NHC GIS queries
// per click outlived the panel that asked for them. A new load now aborts the
// one it supersedes.
const pending = [];
const hangingFetch = (_url, init) => new Promise((_resolve, reject) => {
  pending.push(init.signal);
  init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')), { once: true });
});
const abandoned = loadWindContext(point.lat, point.lon, { fetchImpl: hangingFetch, now });
assert.equal(pending.length, 5, 'the first load must be in flight before the second starts');
assert(pending.every(signal => !signal.aborted), 'the first load must not abort itself');

const superseding = loadWindContext(point.lat, point.lon, { fetchImpl: async () => response({ features: [] }), now });
assert(
  pending.slice(0, 5).every(signal => signal.aborted),
  'a second load must abort the requests the first one left in flight',
);
assert.equal((await superseding).status, 'link-only', 'the superseding load still reports its own result');
assert.equal((await abandoned).status, 'aborted', 'the superseded load reports itself aborted, not failed');

// A caller that cancels still cancels: the load's own controller follows the
// signal it was handed rather than replacing it.
const callerControl = new AbortController();
const callerCancelled = loadWindContext(point.lat, point.lon, {
  fetchImpl: hangingFetch,
  now,
  signal: callerControl.signal,
});
const callerSignals = pending.slice(-5);
assert.equal(callerSignals.length, 5);
callerControl.abort();
assert(callerSignals.every(signal => signal.aborted), 'a caller abort must reach the requests in flight');
assert.equal((await callerCancelled).status, 'aborted');

// Closing the panel has to stop a retry too. A retry runs with no caller
// signal, because the one the first request came with may already be aborted,
// so nothing outside this module could reach it: five NHC GIS requests kept
// running against a host that had just been hidden.
const retryPending = [];
const retryFetch = (_url, init) => new Promise((_resolve, reject) => {
  retryPending.push(init.signal);
  init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')), { once: true });
});
const retry = loadWindContext(point.lat, point.lon, { fetchImpl: retryFetch, now });
assert.equal(retryPending.length, 5, 'the retry must be in flight before it is cancelled');
assert(retryPending.every(signal => !signal.aborted));
assert.equal(cancelWindContext(), true, 'cancelWindContext reports that it stopped something');
// Immediately, before the load settles and clears the slot itself: a cancel
// that aborts without releasing the controller would report a second stop for
// a request it had already stopped.
assert.equal(cancelWindContext(), false, 'a cancelled load must release the slot rather than be cancelled twice');
assert(retryPending.every(signal => signal.aborted), 'closing the panel must abort a retry that carries no caller signal');
assert.equal((await retry).status, 'aborted');
assert.equal(cancelWindContext(), false, 'with nothing in flight there is nothing to cancel');

console.log('NHC wind context ok (34/50/64 kt, nearest contours, freshness, link-only fallback, supersede, caller and panel cancellation)');
