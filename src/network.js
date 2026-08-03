// Shared network boundary for browser data and optional-feed requests.
// Every request gets a finite budget, while a caller-provided signal can still
// cancel work earlier when a panel or overlay is closed.

export const REQUEST_TIMEOUT_MS = Object.freeze({
  default: 12_000,
  active: 12_000,
  alerts: 12_000,
  data: 10_000,
  advisory: 10_000,
  cone: 12_000,
  evacuation: 12_000,
  radar: 8_000,
  tides: 12_000,
});

function combinedSignal(callerSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!callerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([callerSignal, timeoutSignal]);
  const controller = new AbortController();
  const abort = event => controller.abort(event?.target?.reason);
  if (callerSignal.aborted) abort({ target: callerSignal });
  else callerSignal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

/**
 * Fetch with a hard deadline and optional caller cancellation.
 * The injectable fetch implementation keeps retry/unit tests deterministic.
 */
export function fetchWithTimeout(
  input,
  init = {},
  timeoutMs = REQUEST_TIMEOUT_MS.default,
  fetchImpl = globalThis.fetch,
) {
  const budget = Math.max(1, Math.trunc(Number(timeoutMs) || REQUEST_TIMEOUT_MS.default));
  const signal = combinedSignal(init.signal, budget);
  return fetchImpl(input, { ...init, signal });
}
