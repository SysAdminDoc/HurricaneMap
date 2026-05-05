import assert from 'node:assert/strict';
import {
  ACTIVE_FEED_RATE_LIMIT_MS,
  ACTIVE_FEED_RETRY_MS,
  ACTIVE_STORM_POLL_MS,
  INACTIVE_STORM_POLL_MS,
  MAX_ACTIVE_FEED_BACKOFF_MS,
  activeAdvisoryKey,
  activeFeedStatusText,
  computeActivePollDelay,
  formatUtcClock,
} from '../src/active-polling.js';

assert.equal(
  computeActivePollDelay({ ok: true, stormCount: 2 }),
  ACTIVE_STORM_POLL_MS,
  'active storms should use hourly polling',
);

assert.equal(
  computeActivePollDelay({ ok: true, stormCount: 0 }),
  INACTIVE_STORM_POLL_MS,
  'quiet/off-season feed checks should back off to six hours',
);

assert.equal(
  computeActivePollDelay({ ok: false, status: 429, failureCount: 1 }),
  ACTIVE_FEED_RATE_LIMIT_MS,
  'rate-limited feeds should respect the longer retry window',
);

assert.equal(
  computeActivePollDelay({ ok: false, status: 503, failureCount: 1 }),
  ACTIVE_FEED_RETRY_MS,
  'first transient failure should retry after the short delay',
);

assert.equal(
  computeActivePollDelay({ ok: false, status: 503, failureCount: 2 }),
  ACTIVE_FEED_RETRY_MS * 2,
  'repeated transient failures should back off exponentially',
);

assert.equal(
  computeActivePollDelay({ ok: false, status: 503, failureCount: 12 }),
  MAX_ACTIVE_FEED_BACKOFF_MS,
  'transient failure backoff should be capped',
);

const stormA = { id: 'AL012026', forecastTrack: [{ lat: 20, lon: -60, advNum: '4' }] };
const stormB = { id: 'EP022026', forecastTrack: [{ lat: 14, lon: -110, advNum: '2' }] };
assert.equal(
  activeAdvisoryKey([stormA, stormB]),
  activeAdvisoryKey([stormB, stormA]),
  'advisory keys should be stable under feed order changes',
);
assert.notEqual(
  activeAdvisoryKey([stormA]),
  activeAdvisoryKey([{ ...stormA, forecastTrack: [{ lat: 20, lon: -60, advNum: '5' }] }]),
  'advisory keys should change when the advisory number changes',
);

assert.equal(formatUtcClock(new Date(Date.UTC(2026, 4, 5, 13, 7))), '13:07');
assert.match(
  activeFeedStatusText({
    state: 'ok',
    stormCount: 1,
    fetchedAt: Date.UTC(2026, 4, 5, 13, 0),
    nextPollAt: Date.UTC(2026, 4, 5, 14, 0),
  }),
  /hourly checks/,
  'active status should tell users the live feed is now checked hourly',
);
assert.match(
  activeFeedStatusText({
    state: 'rate-limit',
    nextPollAt: Date.UTC(2026, 4, 5, 15, 0),
  }),
  /rate-limited.*15:00 UTC/,
  'rate-limit status should include the next retry time',
);
assert.match(
  activeFeedStatusText({
    state: 'error',
    status: 503,
    nextPollAt: Date.UTC(2026, 4, 5, 13, 15),
  }),
  /delayed \(503\).*13:15 UTC/,
  'error status should include the response code and retry time',
);

console.log('active polling utilities ok');
