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

// The four paths that reached the network through an injected transport and
// so spelled no fetch( for the guard to find. check-network-timeouts.mjs
// enforces that each defaults its seam to fetchWithTimeout; these assert that
// the call sites hand it a budget to enforce, because a seam defaulted to the
// helper and then called with no deadline argument is the same hole wearing a
// better name.
const { loadWindContext } = await import('../src/wind-context.js');
const { collectOfflineDiagnostics } = await import('../src/diagnostics.js');
const { cacheRadarPack, cacheSourceBundle } = await import('../src/storage-manager.js');

function budgetSpy(respond) {
  const budgets = [];
  const fetchImpl = async (url, init, timeoutMs) => {
    budgets.push({ url: String(url), timeoutMs });
    return respond(String(url), init);
  };
  return { budgets, fetchImpl };
}

const emptyGeoJson = { ok: true, status: 200, json: async () => ({ features: [] }) };

const windSpy = budgetSpy(() => emptyGeoJson);
await loadWindContext(25.8, -80.2, { fetchImpl: windSpy.fetchImpl });
assert.equal(windSpy.budgets.length, 5, 'the spatial search makes five NHC GIS requests');
assert(
  windSpy.budgets.every(call => Number.isFinite(call.timeoutMs) && call.timeoutMs > 0),
  `NHC GIS requests reached the network with no deadline: ${JSON.stringify(windSpy.budgets)}`,
);

const diagnosticsSpy = budgetSpy(() => ({ ok: true, status: 200, json: async () => ({}) }));
await collectOfflineDiagnostics({ fetchImpl: diagnosticsSpy.fetchImpl, navigatorRef: { onLine: true } });
assert.equal(diagnosticsSpy.budgets.length, 2, 'the support bundle reads metadata and coverage');
assert(
  diagnosticsSpy.budgets.every(call => Number.isFinite(call.timeoutMs) && call.timeoutMs > 0),
  `a stalled support-bundle read would hang the panel: ${JSON.stringify(diagnosticsSpy.budgets)}`,
);

// A hung frame used to leave "Saving radar pack N/M" on screen for ever, so the
// budget has to arrive per frame rather than once for the whole pack.
const radarSpy = budgetSpy(() => ({
  ok: true,
  status: 200,
  headers: { get: () => '2048' },
  clone() { return this; },
  blob: async () => ({ size: 2048 }),
}));
const radarCache = new Map();
await cacheRadarPack('AL122005', [
  { url: 'data/radar/Katrina-2005/t_200508291110.png', ts: '200508291110' },
  { url: 'data/radar/Katrina-2005/t_200508291445.png', ts: '200508291445' },
], {
  fetchImpl: radarSpy.fetchImpl,
  cachesApi: { open: async () => ({ match: async url => radarCache.get(url), put: async (url, value) => radarCache.set(url, value), delete: async url => radarCache.delete(url) }) },
  storageApi: null,
  packStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
assert.equal(radarSpy.budgets.length, 2, 'each frame is fetched on its own');
assert(
  radarSpy.budgets.every(call => Number.isFinite(call.timeoutMs) && call.timeoutMs > 0),
  `radar pack frames reached the network with no deadline: ${JSON.stringify(radarSpy.budgets)}`,
);

const bundleSpy = budgetSpy(() => ({ ok: false, status: 503 }));
await assert.rejects(
  cacheSourceBundle({
    fetchImpl: bundleSpy.fetchImpl,
    cachesApi: { open: async () => ({ match: async () => undefined, put: async () => {}, delete: async () => true }) },
    storageApi: null,
  }),
  /503/,
  'a failing source-bundle asset must surface its status',
);
assert(
  bundleSpy.budgets.length > 0 &&
    bundleSpy.budgets.every(call => Number.isFinite(call.timeoutMs) && call.timeoutMs > 0),
  `source bundle assets reached the network with no deadline: ${JSON.stringify(bundleSpy.budgets)}`,
);

// The shapes an adversarial review used to walk past the guard. Each is a real
// way to reach the network with no deadline while spelling something the older
// rules did not recognise, and each has to stay caught.
const { findTransportOffenders, stripComments } = await import('./check-network-timeouts.mjs');

const bypasses = {
  'assignment rather than a default': 'const send = globalThis.fetch;\nexport const go = u => send(u);',
  'bracket access': 'export const go = (u, { t = globalThis["fetch"] } = {}) => t(u);',
  'destructured rename': 'const { fetch: send } = globalThis;\nexport const go = u => send(u);',
  'default split across two lines': 'export const go = (u, { t = globalThis\n  .fetch } = {}) => t(u);',
  'an or-fallback': 'export const go = (u, d = {}) => (d.impl || globalThis.fetch)(u);',
  'a bare call': 'export const go = u => fetch(u);',
  'a renamed transport parameter': 'export const go = (u, { transport = fetch } = {}) => transport(u);',
};
for (const [label, source] of Object.entries(bypasses)) {
  const offenders = findTransportOffenders('src/probe.js', source);
  assert(offenders.length > 0, `the guard no longer catches ${label}: ${source}`);
}

// A `//` inside a string is not a comment. Stripping naively ate the rest of
// the line, and with it a bare fetch( call on a protocol-relative URL check.
assert(
  findTransportOffenders('src/probe.js', 'export const go = u => u.startsWith("//") ? fetch(u) : null;').length > 0,
  'a protocol-relative URL check must not hide the fetch call beside it',
);
// A `/*` inside a string is not a comment open, either.
assert(
  findTransportOffenders('src/probe.js', 'export const A = "/*";\nexport const go = u => fetch(u);\nexport const B = "*/";').length > 0,
  'a string containing a block-comment open must not hide the code after it',
);

// And the shapes that are correct have to stay quiet, or the guard gets turned
// off rather than obeyed.
const compliant = [
  'import { fetchWithTimeout } from "./network.js";\nexport const go = (u, { fetchImpl = fetchWithTimeout } = {}) => fetchImpl(u, {}, 1000);',
  'import { fetchWithTimeout } from "./network.js";\nexport const go = (u, { fetchImpl } = {}) => fetchWithTimeout(u, {}, 1000, fetchImpl);',
  '// This comment mentions fetch, which is prose.\nexport const label = "Failed to fetch";',
];
for (const source of compliant) {
  assert.deepEqual(findTransportOffenders('src/probe.js', source), [], `a correct module was reported: ${source}`);
}

// The shape the older regex rule was documented as unable to see, planted
// here as a file rather than described: one seam defaulted to the deadline
// helper and a second beside it with no default. Per-file reasoning let the
// first excuse the second, and telling that binding apart from a pass-through
// needs the tree.
const twoSeams = [
  'import { fetchWithTimeout } from "./network.js";',
  'export const safe = (u, { fetchImpl = fetchWithTimeout } = {}) => fetchImpl(u, {}, 1000);',
  'export const leaky = (u, { fetchImpl } = {}) => fetchImpl(u, {}, 1000);',
].join('\n');
const twoSeamOffenders = findTransportOffenders('src/probe.js', twoSeams);
assert.equal(
  twoSeamOffenders.length,
  1,
  `one defaulted seam must not excuse an undefaulted one beside it: ${JSON.stringify(twoSeamOffenders)}`,
);
assert(
  twoSeamOffenders[0].includes('no default'),
  `the undefaulted seam must be named as such: ${twoSeamOffenders[0]}`,
);

// A seam defaulted to something other than the deadline helper.
assert(
  findTransportOffenders(
    'src/probe.js',
    'const plain = (u, i) => i(u);\nexport const go = (u, { fetchImpl = plain } = {}) => fetchImpl(u);',
  ).some(offender => offender.includes('plain')),
  'a seam defaulted to a wrapper of its own must name that wrapper',
);

// An exported function is the only place a positional seam can be decided by
// somebody outside this directory.
assert(
  findTransportOffenders('src/probe.js', 'export function go(u, fetchImpl) { return fetchImpl(u); }').length > 0,
  'an exported positional seam with no default must be caught',
);

// And the direction that matters just as much: the pass-through in an object
// literal, which is what src/nhc-summary.js writes, is not a binding and must
// stay quiet. A bracket-depth walk reported exactly this as a violation, which
// is how the rule ended up too weak to see the case above.
const passThrough = [
  'import { fetchWithTimeout } from "./network.js";',
  'async function layer(name, { fetchImpl = fetchWithTimeout, signal } = {}) {',
  '  return fetchImpl(name, { signal }, 1000);',
  '}',
  'export async function go({ fetchImpl = fetchWithTimeout, signal } = {}) {',
  '  return layer("points", { fetchImpl, signal });',
  '}',
].join('\n');
assert.deepEqual(
  findTransportOffenders('src/probe.js', passThrough),
  [],
  'a seam passed on in an object literal is not a binding and must not be reported',
);

// A module-private helper taking the seam positionally is an ordinary argument
// whose callers are a few lines up and are themselves held to the rule.
assert.deepEqual(
  findTransportOffenders(
    'src/probe.js',
    [
      'import { fetchWithTimeout } from "./network.js";',
      'async function read(fetchImpl) { return fetchImpl("data.json", {}, 1000); }',
      'export async function go({ fetchImpl = fetchWithTimeout } = {}) { return read(fetchImpl); }',
    ].join('\n'),
  ),
  [],
  'a private positional helper must not be asked for a default its only callers already supplied',
);

// A file that cannot be parsed has to fail rather than be waved through, or a
// syntax error becomes a way past every rule below it.
assert(
  findTransportOffenders('src/probe.js', 'export const go = (').some(offender => offender.includes('does not parse')),
  'an unparseable module must be reported, not skipped',
);

assert.equal(stripComments('const a = "//not a comment"; // gone').trim(), 'const a = "";');
assert.equal(stripComments('const a = "keep"; // gone', { keepStrings: true }).trim(), 'const a = "keep";');

console.log('network timeout helper ok (deadline, caller cancellation, a budget on all four injected-transport paths, nine bypasses that stay closed, and the parsed seam rule caught in both directions)');
