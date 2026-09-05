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
  let current = null;
  let waiting = 0;

  const retire = entry => { if (current === entry) current = null; };

  return async function probe(signal = null) {
    if (!current) {
      const controller = new AbortController();
      const entry = { controller, promise: null };
      // `run` is deferred by one microtask so `current` is installed, and its
      // promise assigned, before it can be called. A run that calls back into
      // probe() then joins this entry rather than starting a second one and
      // leaving the two disagreeing about which controller is live.
      entry.promise = Promise.resolve()
        .then(() => run(controller.signal))
        .finally(() => retire(entry));
      current = entry;
    }
    const entry = current;
    waiting += 1;
    const stop = new AbortController();
    try {
      if (!signal) return await entry.promise;
      return await Promise.race([entry.promise, rejectWhenAborted(signal, stop.signal, abortMessage)]);
    } finally {
      stop.abort();
      waiting -= 1;
      // The last caller to leave cancels the request. While anyone is still
      // waiting, one caller walking away must not take the answer with it.
      //
      // Retiring at the moment of cancellation matters as much as the abort:
      // an aborted run does not settle until its request actually rejects, and
      // leaving it installed for those few tasks means the next caller joins a
      // dead probe and silently takes whatever fallback it resolves with.
      if (waiting <= 0 && current === entry) {
        retire(entry);
        entry.controller.abort();
      }
    }
  };
}
