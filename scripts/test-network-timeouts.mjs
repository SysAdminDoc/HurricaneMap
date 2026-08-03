import assert from 'node:assert/strict';

import { fetchWithTimeout } from '../src/network.js';

const neverResolves = (_input, init) => new Promise((_resolve, reject) => {
  const keepAlive = setTimeout(() => reject(new Error('test response unexpectedly resolved')), 1000);
  init.signal.addEventListener('abort', () => {
    clearTimeout(keepAlive);
    reject(init.signal.reason);
  }, { once: true });
});

const startedAt = Date.now();
await assert.rejects(
  fetchWithTimeout('https://example.test/never', {}, 25, neverResolves),
  error => error?.name === 'TimeoutError' || error?.name === 'AbortError',
  'a never-resolving request must be aborted by the shared budget',
);
assert(Date.now() - startedAt < 1000, 'the timeout helper must fail promptly');

const caller = new AbortController();
const callerRequest = fetchWithTimeout('https://example.test/cancel', { signal: caller.signal }, 5000, neverResolves);
caller.abort();
await assert.rejects(callerRequest, error => error?.name === 'AbortError' || error?.name === 'TimeoutError');

console.log('network timeout helper ok (deadline and caller cancellation)');
