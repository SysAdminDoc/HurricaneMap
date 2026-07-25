import assert from 'node:assert/strict';

import {
  beginOptionalFeed,
  classifyOptionalFeedFailure,
  completeOptionalFeed,
  failOptionalFeed,
  getOptionalFeedState,
  idleOptionalFeed,
  reportOptionalFeedResult,
} from '../src/optional-feeds.js';

assert.equal(classifyOptionalFeedFailure({ responseStatus: 404 }), 'error');
assert.equal(classifyOptionalFeedFailure({ responseStatus: 429 }), 'rate-limited');
assert.equal(classifyOptionalFeedFailure({ error: Object.assign(new Error('timeout'), { name: 'AbortError' }) }), 'error');
assert.equal(classifyOptionalFeedFailure({ error: new SyntaxError('malformed JSON') }), 'error');
assert.equal(classifyOptionalFeedFailure({ online: false }), 'offline');

beginOptionalFeed('active', { nextRetryAt: 2000 });
assert.equal(getOptionalFeedState('active').state, 'loading');
completeOptionalFeed('active', {
  itemCount: 2,
  completedAt: 1000,
  nextRetryAt: 5000,
  cacheOrigin: 'network',
});
assert.deepEqual(
  {
    state: getOptionalFeedState('active').state,
    itemCount: getOptionalFeedState('active').itemCount,
    lastSuccessAt: getOptionalFeedState('active').lastSuccessAt,
  },
  { state: 'success', itemCount: 2, lastSuccessAt: 1000 },
);

failOptionalFeed('active', { responseStatus: 429, nextRetryAt: 8000 });
assert.equal(getOptionalFeedState('active').state, 'stale');
assert.equal(getOptionalFeedState('active').detail, 'rate-limited');
assert.equal(getOptionalFeedState('active').lastSuccessAt, 1000, 'failed refresh must preserve last-good metadata');

idleOptionalFeed('outlook');
reportOptionalFeedResult('outlook', { status: 'empty', pointCount: 0 }, { completedAt: 3000 });
assert.equal(getOptionalFeedState('outlook').state, 'empty');
assert.equal(getOptionalFeedState('outlook').lastSuccessAt, 3000);

reportOptionalFeedResult('marine', { status: 'error', responseStatus: 404 });
assert.equal(getOptionalFeedState('marine').state, 'error');

console.log('optional feed state contract ok (200, 404, 429, timeout, malformed, offline, stale-last-good)');
