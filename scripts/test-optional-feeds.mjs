import assert from 'node:assert/strict';

import {
  beginOptionalFeed,
  cancelOptionalFeed,
  classifyOptionalFeedFailure,
  completeOptionalFeed,
  failOptionalFeed,
  getOptionalFeedState,
  idleOptionalFeed,
  isOptionalFeedRequestCurrent,
  registerOptionalFeedRetry,
  reportOptionalFeedResult,
  retryOptionalFeed,
} from '../src/optional-feeds.js';

assert.equal(classifyOptionalFeedFailure({ responseStatus: 404 }), 'error');
assert.equal(classifyOptionalFeedFailure({ responseStatus: 429 }), 'rate-limited');
assert.equal(classifyOptionalFeedFailure({ error: Object.assign(new Error('timeout'), { name: 'AbortError' }) }), 'cancelled');
assert.equal(classifyOptionalFeedFailure({ error: new Error('request timed out') }), 'timeout');
assert.equal(classifyOptionalFeedFailure({ error: new SyntaxError('malformed JSON') }), 'malformed');
assert.equal(classifyOptionalFeedFailure({ online: false }), 'offline');

const activeRequest = beginOptionalFeed('active', { nextRetryAt: 2000 });
assert.equal(getOptionalFeedState('active').state, 'loading');
assert.equal(isOptionalFeedRequestCurrent('active', activeRequest.requestId), true);
completeOptionalFeed('active', {
  itemCount: 2,
  completedAt: 1000,
  nextRetryAt: 5000,
  cacheOrigin: 'network',
  requestId: activeRequest.requestId,
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
assert.equal(getOptionalFeedState('active').responseStatus, 429);

idleOptionalFeed('outlook');
reportOptionalFeedResult('outlook', { status: 'empty', pointCount: 0 }, { completedAt: 3000 });
assert.equal(getOptionalFeedState('outlook').state, 'empty');
assert.equal(getOptionalFeedState('outlook').lastSuccessAt, 3000);

reportOptionalFeedResult('marine', { status: 'error', responseStatus: 404 });
assert.equal(getOptionalFeedState('marine').state, 'error');

const firstForecastRequest = beginOptionalFeed('forecast');
const secondForecastRequest = beginOptionalFeed('forecast');
completeOptionalFeed('forecast', { requestId: firstForecastRequest.requestId, completedAt: 4000, itemCount: 1 });
assert.equal(getOptionalFeedState('forecast').state, 'loading', 'superseded request must not publish');
assert.equal(isOptionalFeedRequestCurrent('forecast', secondForecastRequest.requestId), true);
completeOptionalFeed('forecast', { requestId: secondForecastRequest.requestId, completedAt: 5000, itemCount: 1 });
assert.equal(getOptionalFeedState('forecast').state, 'success');

const cancelledRequest = beginOptionalFeed('radar');
cancelOptionalFeed('radar', { requestId: cancelledRequest.requestId });
assert.equal(getOptionalFeedState('radar').state, 'idle');
assert.equal(isOptionalFeedRequestCurrent('radar', cancelledRequest.requestId), false);

const retryEvents = [];
const unregisterRetry = registerOptionalFeedRetry('glossary', async () => {
  retryEvents.push('retried');
  return { status: 'success', itemCount: 3 };
});
assert.deepEqual(await retryOptionalFeed('glossary'), { ok: true, value: { status: 'success', itemCount: 3 } });
assert.deepEqual(retryEvents, ['retried']);
unregisterRetry();
assert.deepEqual(await retryOptionalFeed('glossary'), { ok: false, error: 'retry-unavailable' });

console.log('optional feed state contract ok (success, 404, 429, timeout, malformed, offline, stale-last-good, retry, cancellation)');
