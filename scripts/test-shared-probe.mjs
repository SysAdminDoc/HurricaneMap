import assert from 'node:assert/strict';

import { createSharedProbe } from '../src/shared-probe.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// The probe defers the run by one microtask so it can install itself first,
// so let the loop turn before inspecting what the run received.
const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

function abortableRun(record) {
  return signal => {
    const gate = deferred();
    record.push({ signal, gate });
    signal.addEventListener('abort', () => {
      gate.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    }, { once: true });
    return gate.promise;
  };
}

// Concurrent callers share one run.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const first = probe();
  const second = probe();
  await tick();
  assert.equal(runs.length, 1, 'concurrent callers must share one run');
  runs[0].gate.resolve('2026-09-04T12:00:00Z');
  assert.deepEqual(await Promise.all([first, second]), ['2026-09-04T12:00:00Z', '2026-09-04T12:00:00Z']);
}

// THE BUG: one caller leaving must not poison the next caller.
//
// Enable the layer, disable it, enable it again while the probe is still in
// flight. The old code bound the request to the first caller's signal, so the
// second enable inherited an aborted fetch and silently took the fallback.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const closing = new AbortController();
  const firstEnable = probe(closing.signal);
  const rejected = firstEnable.catch(error => error);
  const reopened = probe();
  await tick();
  assert.equal(runs.length, 1, 'the second enable must join the probe already running');
  closing.abort();
  assert.equal((await rejected).name, 'AbortError', 'the caller that left must see an abort');
  assert.equal(
    runs[0].signal.aborted,
    false,
    'the request itself must survive: another caller is still waiting for its answer',
  );
  runs[0].gate.resolve('2026-09-05T12:00:00Z');
  assert.equal(await reopened, '2026-09-05T12:00:00Z', 'the second enable must get the real answer, not a fallback');
}

// The last caller to leave does cancel the request, so closing the only open
// layer still stops the work rather than letting it run to completion.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const closing = new AbortController();
  const only = probe(closing.signal).catch(error => error);
  await tick();
  closing.abort();
  assert.equal((await only).name, 'AbortError');
  assert.equal(runs[0].signal.aborted, true, 'with nobody waiting, the request must be aborted');
}

// Two callers, both leave: the request is cancelled once, on the second exit.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const a = new AbortController();
  const b = new AbortController();
  const first = probe(a.signal).catch(error => error);
  const second = probe(b.signal).catch(error => error);
  await tick();
  a.abort();
  await first;
  assert.equal(runs[0].signal.aborted, false, 'one of two callers leaving must not cancel the request');
  b.abort();
  await second;
  assert.equal(runs[0].signal.aborted, true, 'the last caller leaving must cancel it');
}

// A caller with no signal waits for the answer and never cancels.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const settled = probe();
  await tick();
  runs[0].gate.resolve('ok');
  assert.equal(await settled, 'ok');
  assert.equal(runs[0].signal.aborted, false, 'a completed run must not be aborted afterwards');
}

// THE SECOND BUG, and the reason the first fix was not enough: an aborted run
// does not settle until its request actually rejects, which is at least a task
// later. Leaving it installed for that window meant the next caller joined the
// dead run and took its fallback, exactly as before. A real fetch rejects
// asynchronously, so this run does too.
{
  const runs = [];
  const probe = createSharedProbe(signal => {
    const gate = deferred();
    runs.push({ signal, gate });
    // One task later, not synchronously: this is what a real abort looks like.
    signal.addEventListener('abort', () => setTimeout(() => gate.resolve('STALE FALLBACK'), 0), { once: true });
    return gate.promise;
  });
  const closing = new AbortController();
  const first = probe(closing.signal).catch(error => error);
  await tick();
  closing.abort();
  assert.equal((await first).name, 'AbortError');
  // The aborted run has not settled yet: its gate resolves on a later task.
  const reopened = probe();
  await tick();
  assert.equal(runs.length, 2, 'a caller arriving before the cancelled run settles must start a fresh one');
  assert.equal(runs[1].signal.aborted, false);
  // And when the cancelled run finally does settle, its teardown must not
  // uninstall the run that replaced it: a third caller has to join run 2, not
  // start a redundant run 3 alongside it.
  runs[0].gate.resolve('STALE FALLBACK');
  await tick();
  const third = probe();
  await tick();
  assert.equal(runs.length, 2, 'the stale run\'s teardown must not uninstall its replacement');
  runs[1].gate.resolve('the real answer');
  assert.equal(await reopened, 'the real answer', 'it must not inherit the cancelled run\'s fallback');
  assert.equal(await third, 'the real answer', 'the third caller must share the live run');
}

// Calling probe() from inside the run joins it rather than starting a second.
// The previous implementation installed the entry after invoking the run, so a
// re-entrant call saw nothing in flight and clobbered the controller.
{
  const signals = [];
  let inner = null;
  const probe = createSharedProbe(async signal => {
    signals.push(signal);
    if (signals.length === 1) inner = probe();
    return 'once';
  });
  assert.equal(await probe(), 'once');
  assert.equal(await inner, 'once', 'the re-entrant caller must get the same answer');
  assert.equal(signals.length, 1, 'a re-entrant call must join the run, not start another');
}

// A caller arriving after the previous run settled starts a fresh one, and the
// finished run's teardown must not cancel it.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const firstCall = probe();
  await tick();
  runs[0].gate.resolve('first');
  assert.equal(await firstCall, 'first');
  const secondCall = probe();
  await tick();
  assert.equal(runs.length, 2, 'a probe after the previous one settled must run again');
  assert.equal(runs[1].signal.aborted, false, 'the new run must not inherit the old run\'s cancellation');
  runs[1].gate.resolve('second');
  assert.equal(await secondCall, 'second');
}

// A caller whose signal is already aborted gets an abort, not a shared answer.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs), { abortMessage: 'the layer was closed' });
  const closed = AbortSignal.abort();
  const error = await probe(closed).catch(e => e);
  assert.equal(error.name, 'AbortError');
  assert.equal(error.message, 'the layer was closed', 'the caller-supplied message must be used');
}

// A failing run propagates its error and does not stick around as in-flight.
{
  const runs = [];
  const probe = createSharedProbe(abortableRun(runs));
  const failing = probe().catch(error => error.message);
  await tick();
  runs[0].gate.reject(new Error('ERDDAP is down'));
  assert.equal(await failing, 'ERDDAP is down');
  const retry = probe();
  await tick();
  assert.equal(runs.length, 2, 'a failed run must not be cached as in-flight');
  runs[1].gate.resolve('recovered');
  assert.equal(await retry, 'recovered');
}

// A run that throws synchronously is still a rejected promise, not a crash.
{
  const probe = createSharedProbe(() => { throw new Error('bad wiring'); });
  await assert.rejects(probe(), /bad wiring/);
}

console.log('shared probe ok (coalesced, survives one caller leaving, cancelled by the last, restartable)');
