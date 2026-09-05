// Tide-gauge helpers: station picking, datagetter URL contract, residual math,
// and the lifetime of a load whose storm panel is replaced under it.
//
// i18n and the optional-feed UI both read the document, so the shim goes up
// before src/tides.js is imported.
globalThis.document = {
  documentElement: { lang: 'en' },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};

const { buildDataUrl, fetchWithRetry, nearestStations, peakResidual, renderTidesBlock } = await import('../src/tides.js');
const { getOptionalFeedState } = await import('../src/optional-feeds.js');
import { haversineKm } from '../src/geodesy.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`tides test failed: ${message}`);
    process.exit(1);
  }
}

// Haversine sanity: New Orleans -> Gulfport is ~110 km.
const nolaGulfport = haversineKm(29.95, -90.07, 30.37, -89.09);
assert(nolaGulfport > 90 && nolaGulfport < 130, `NOLA-Gulfport distance off: ${nolaGulfport}`);

const stations = [
  { id: '1', name: 'Near', state: 'LA', lat: 29.9, lon: -90.1 },
  { id: '2', name: 'Mid', state: 'MS', lat: 30.4, lon: -89.1 },
  { id: '3', name: 'Far', state: 'FL', lat: 27.8, lon: -82.6 },
];
const picked = nearestStations(stations, 29.95, -90.07, { max: 3, maxKm: 150 });
assert(picked.length === 2 && picked[0].id === '1' && picked[1].id === '2', `nearestStations picked ${picked.map(s => s.id).join(',')}`);
assert(Number.isFinite(picked[0].km) && picked[0].km < picked[1].km, 'distances must sort ascending');

const url = buildDataUrl('8761724', 'hourly_height', '2005-08-29T11:10:00Z');
const params = new URL(url).searchParams;
assert(url.startsWith('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?'), `bad base: ${url}`);
assert(params.get('begin_date') === '20050827' && params.get('end_date') === '20050831', `±48h window wrong: ${params.get('begin_date')}..${params.get('end_date')}`);
assert(params.get('datum') === 'MLLW' && params.get('time_zone') === 'gmt' && params.get('format') === 'json', 'datum/tz/format contract');
assert(!params.get('interval'), 'hourly_height must not send interval');
assert(new URL(buildDataUrl('8761724', 'predictions', '2005-08-29T11:10:00Z')).searchParams.get('interval') === 'h', 'predictions must be hourly');

const observed = [
  { time: 1000, ft: 2.0 },
  { time: 2000, ft: 6.5 },
  { time: 3000, ft: 3.0 },
];
const predicted = [
  { time: 1000, ft: 1.8 },
  { time: 2000, ft: 1.5 },
  { time: 3000, ft: 2.0 },
];
const peak = peakResidual(observed, predicted);
assert(peak && peak.time === 2000 && Math.abs(peak.residual - 5.0) < 1e-9, `peak residual wrong: ${JSON.stringify(peak)}`);
assert(peakResidual([], predicted) === null, 'no observations -> null');
assert(peakResidual(observed, [{ time: 9999, ft: 1 }]) === null, 'no matching hours -> null');

const centeredPeak = peakResidual(
  [{ time: 0, ft: 3 }, { time: 60 * 3600_000, ft: 20 }],
  [{ time: 0, ft: 1 }, { time: 60 * 3600_000, ft: 1 }],
  { centerTime: 0, windowHours: 48 },
);
assert(centeredPeak?.time === 0 && centeredPeak.residual === 2, 'peak residual must ignore data outside the exact window');

let attempts = 0;
const retried = await fetchWithRetry('https://example.test/tides', {
  timeoutMs: 5,
  fetchImpl: (_url, { signal }) => {
    attempts += 1;
    if (attempts === 1) {
      return new Promise((resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('test request unexpectedly resolved')), 1000);
        signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(new Error('aborted'));
        }, { once: true });
      });
    }
    return Promise.resolve({ ok: true, status: 200 });
  },
});
assert(retried?.ok && attempts === 2, 'timed-out tide requests should retry once');

// A storm switch mid-request used to leave the feed stuck on 'loading'. Both
// early returns bailed out without settling it, and renderOptionalFeedStatus
// hides the retry button while a feed is loading, so the next storm's tides
// block offered no way out at all.

// Enough of an element for renderTidesBlock and mountOptionalFeedStatus: the
// two of them set innerHTML, look up three children, and wire one click.
function fakeElement(tag = 'div') {
  const element = {
    tag,
    isConnected: true,
    hidden: false,
    dataset: {},
    attributes: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    listeners: new Map(),
    children: [],
    set innerHTML(markup) {
      this._html = markup;
      // Re-created markup means re-created children, which is exactly what
      // strands a listener bound to the previous generation.
      this.children = [];
      const add = (parent, selector) => {
        const node = fakeElement();
        parent.children.push({ selector, node });
        return node;
      };
      const block = markup.includes('tides-block') ? add(this, '.tides-block') : null;
      if (markup.includes('tides-feed-status')) add(this, '#tides-feed-status');
      // The load button always lives inside the block, so replacing the
      // block's markup replaces the button, as it does in the real panel.
      if (markup.includes('tide-load-btn')) add(block || this, '.tide-load-btn');
    },
    get innerHTML() { return this._html || ''; },
    querySelector(selector) {
      const direct = this.children.find(child => child.selector === selector);
      if (direct) return direct.node;
      for (const child of this.children) {
        const nested = child.node.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener() {},
    dispatchEvent() {},
  };
  return element;
}

const KATRINA = {
  year: 2005,
  us_landfalls: [{ t: '2005-08-29T11:10:00Z', lat: 29.27, lon: -89.6, category: 3 }],
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const feedState = () => getOptionalFeedState('tides').state;

async function clickLoad(host) {
  const button = host.querySelector('.tide-load-btn');
  assert(button, 'the tides block must offer a load button');
  const handlers = button.listeners.get('click') || [];
  assert(handlers.length === 1, `expected one click handler, found ${handlers.length}`);
  void handlers[0]({ target: button });
  await settle();
}

let started = 0;
let aborted = 0;
// A request that never answers, so the load is still in flight when the panel
// is replaced. Cancellation is the only thing that can end it.
globalThis.fetch = (url, init) => {
  // The station index is a local file and always answers; only the CO-OPS
  // datagetter calls are left hanging.
  if (String(url).includes('tide-stations.json')) {
    return Promise.resolve({ ok: true, status: 200, json: async () => stations });
  }
  started++;
  return new Promise((resolve, reject) => {
    if (init?.signal?.aborted) {
      aborted++;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    init?.signal?.addEventListener('abort', () => {
      aborted++;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
};

const hostA = fakeElement();
await renderTidesBlock(hostA, KATRINA);
await clickLoad(hostA);
assert(feedState() === 'loading', `the feed should be loading once the request starts: ${feedState()}`);
assert(started > 0, 'the load must have reached the network');

// The panel re-renders for another storm: the old host is detached and a new
// block is mounted while the first load is still in flight.
hostA.isConnected = false;
const hostB = fakeElement();
await renderTidesBlock(hostB, KATRINA);
await settle();
assert(feedState() === 'idle', `a superseded load must leave the feed idle, not ${feedState()}`);
assert(aborted > 0, 'a superseded load must abort its requests instead of finishing into a detached node');

// The new host's own load still works, and is settled the same way when it in
// turn is replaced.
const beforeSecond = started;
await clickLoad(hostB);
assert(feedState() === 'loading', `the new host's own load should start: ${feedState()}`);
assert(started > beforeSecond, 'the second load must issue its own requests');
hostB.isConnected = false;
await renderTidesBlock(fakeElement(), KATRINA);
await settle();
assert(feedState() === 'idle', `the second superseded load must settle too: ${feedState()}`);

console.log('tides ok (station picking, datagetter contract, residual math, superseded loads settle idle)');
