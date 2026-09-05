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
  OPTIONAL_FEED_DEFINITIONS,
  registerOptionalFeedRetry,
  reportOptionalFeedResult,
  retryOptionalFeed,
} from '../src/optional-feeds.js';
import { t } from '../src/i18n.js';

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

// Every module that reaches the network has to be a declared feed, or a user
// who turns that layer on and gets nothing has no state to read and no retry
// to press, and diagnostics cannot see it at all.
const definitions = Object.keys(OPTIONAL_FEED_DEFINITIONS);
assert.equal(definitions.length, 19, `expected 19 declared feeds, found ${definitions.length}`);
for (const id of ['sst', 'hwm', 'storm-events', 'exposure', 'evac']) {
  assert.ok(definitions.includes(id), `${id} reaches the network and must be a declared feed`);
}
for (const [id, definition] of Object.entries(OPTIONAL_FEED_DEFINITIONS)) {
  assert.match(definition.labelKey, /^feeds\./, `${id} needs a feeds.* label key`);
  assert.ok(definition.source && definition.source.length > 3, `${id} must name its upstream source`);
  assert.notEqual(t(definition.labelKey), definition.labelKey, `${id} label ${definition.labelKey} is missing from the catalog`);
}

// Each declared feed must walk the whole state machine, not just succeed.
// A feed that already holds last-good data reports `stale` and carries the
// classification in `detail`, which is the state the user is shown either way.
function expectFeedState(id, want) {
  const snapshot = getOptionalFeedState(id);
  const shown = snapshot.state === 'stale' ? snapshot.detail : snapshot.state;
  assert.equal(shown, want, `${id} must report ${want}, got ${snapshot.state}/${snapshot.detail}`);
}
for (const id of definitions) {
  const request = beginOptionalFeed(id, { cacheOrigin: 'network' });
  assert.equal(getOptionalFeedState(id).state, 'loading', `${id} must report loading`);
  failOptionalFeed(id, { error: new Error('no network'), online: false, requestId: request.requestId });
  expectFeedState(id, 'offline');

  const rateLimited = beginOptionalFeed(id, { cacheOrigin: 'network' });
  failOptionalFeed(id, { error: new Error('429'), responseStatus: 429, requestId: rateLimited.requestId });
  expectFeedState(id, 'rate-limited');

  const errored = beginOptionalFeed(id, { cacheOrigin: 'network' });
  failOptionalFeed(id, { error: new Error('boom'), responseStatus: 500, requestId: errored.requestId });
  expectFeedState(id, 'error');

  const emptied = beginOptionalFeed(id, { cacheOrigin: 'network' });
  completeOptionalFeed(id, { empty: true, itemCount: 0, requestId: emptied.requestId });
  assert.equal(getOptionalFeedState(id).state, 'empty', `${id} must report empty`);

  const filled = beginOptionalFeed(id, { cacheOrigin: 'network' });
  completeOptionalFeed(id, { itemCount: 5, requestId: filled.requestId });
  assert.equal(getOptionalFeedState(id).state, 'success', `${id} must report success`);

  // With last-good on record, a later failure must preserve it rather than
  // blanking the layer the user is looking at.
  const afterSuccess = beginOptionalFeed(id, { cacheOrigin: 'network' });
  failOptionalFeed(id, { error: new Error('boom'), responseStatus: 500, requestId: afterSuccess.requestId });
  assert.equal(getOptionalFeedState(id).state, 'stale', `${id} must keep last-good data after a later failure`);
  assert.equal(getOptionalFeedState(id).detail, 'error', `${id} must still say why it went stale`);
}

console.log(`optional feed state contract ok (${definitions.length} feeds; success, 404, 429, timeout, malformed, offline, stale-last-good, retry, cancellation)`);
