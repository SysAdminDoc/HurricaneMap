// One in-flight probe shared by every caller that wants its answer.
//
// The obvious version binds the request to whichever caller happened to start
// it. That is wrong the moment a caller can go away: aborting the first caller
// kills the request, the next caller joins the same already-dead promise, and
// it silently takes whatever fallback the probe returns on failure. The SST
// overlay hit exactly that, drawing a three-day-old field and reporting its
// feed idle underneath a layer that was on the map.
//
// So the request gets its own controller, each caller can stop waiting on its
// own signal, and the request is only cancelled once nobody is waiting.

function abortError(message) {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

function rejectWhenAborted(signal, stop, message) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(abortError(message));
    else signal.addEventListener('abort', () => reject(abortError(message)), { once: true, signal: stop });
  });
}

/**
 * Wrap `run(signal)` so concurrent callers share one execution.
 *
 * @param {(signal: AbortSignal) => Promise<any>} run
 * @param {{ abortMessage?: string }} [options]
 * @returns {(signal?: AbortSignal|null) => Promise<any>} rejects with an
 *          AbortError for a caller whose own signal aborts first.
 */
export function createSharedProbe(run, { abortMessage = 'the shared probe was cancelled' } = {}) {
  let inFlight = null;
  let controller = null;
  let waiting = 0;

  return async function probe(signal = null) {
    if (!inFlight) {
      controller = new AbortController();
      const own = controller;
      // A new run can only start once inFlight is null, and these are cleared
      // together, so there is no window where a later run could be clobbered.
      inFlight = (async () => run(own.signal))().finally(() => {
        controller = null;
        inFlight = null;
      });
    }
    const current = inFlight;
    const owner = controller;
    waiting += 1;
    const stop = new AbortController();
    try {
      if (!signal) return await current;
      return await Promise.race([current, rejectWhenAborted(signal, stop.signal, abortMessage)]);
    } finally {
      stop.abort();
      waiting -= 1;
      // The last caller to leave cancels the request. While anyone is still
      // waiting, one caller walking away must not take the answer with it.
      if (waiting <= 0 && controller === owner) owner?.abort();
    }
  };
}
