import assert from 'node:assert/strict';
import {
  buildGoesLatestImageUrl,
  clearGoesLayers,
  goesCacheStamp,
  goesSourcePageUrl,
  inferStormBasin,
  latestStormPoint,
  selectGoesSectorForStorm,
  renderGoesRealtimeContext,
  selectGoesSectors,
} from '../src/goes-realtime.js';

assert.equal(inferStormBasin({ id: 'AL012026' }), 'AL', 'Atlantic storm id should infer AL basin');
assert.equal(inferStormBasin({ binNumber: 'AT1' }), 'AL', 'NHC AT alias should infer Atlantic basin');
assert.equal(inferStormBasin({ id: 'EP052026' }), 'EP', 'Eastern Pacific storm id should infer EP basin');
assert.equal(inferStormBasin({ id: 'CP012026' }), 'CP', 'Central Pacific storm id should infer CP basin');

assert.equal(selectGoesSectorForStorm({ id: 'AL012026' }), 'taw', 'Atlantic active storms use Tropical Atlantic sector');
assert.equal(selectGoesSectorForStorm({ id: 'EP052026' }), 'eep', 'Eastern Pacific active storms use Eastern East Pacific sector');
assert.equal(selectGoesSectorForStorm({ id: 'CP012026' }), 'tpw', 'Central Pacific active storms use Tropical Pacific sector');

assert.equal(
  selectGoesSectorForStorm({ name: 'Test', track: [{ lat: '18.5N', lon: '145.2W' }] }),
  'tpw',
  'unknown-basin storms west of 132W fall back to GOES-West Tropical Pacific',
);
assert.equal(
  selectGoesSectorForStorm({ name: 'Test', track: [{ lat: 20, lon: -105 }] }),
  'eep',
  'unknown-basin storms in the eastern Pacific fall back to Eastern East Pacific',
);
assert.equal(
  selectGoesSectorForStorm({ name: 'Test', track: [{ lat: 24, lon: -58 }] }),
  'taw',
  'unknown-basin storms in the Atlantic fall back to Tropical Atlantic',
);

assert.deepEqual(
  selectGoesSectors([{ id: 'AL012026' }, { id: 'AL022026' }, { id: 'EP012026' }]),
  ['taw', 'eep'],
  'sector selection should deduplicate in active-storm order',
);

assert.deepEqual(
  latestStormPoint({ track: [{ lat: 18, lon: -60 }, { latitude: '20.5N', longitude: '56.5W' }] }),
  { lat: 20.5, lon: -56.5 },
  'latest point should parse numeric and N/W string coordinates',
);

assert.equal(
  buildGoesLatestImageUrl('taw', { cacheBust: false }),
  'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/taw/GEOCOLOR/900x540.jpg',
  'Tropical Atlantic image URL should use the small current NOAA STAR JPEG',
);
assert.equal(
  buildGoesLatestImageUrl('tpw', { size: 'thumbnail', cacheBust: false }),
  'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/tpw/GEOCOLOR/thumbnail.jpg',
  'Tropical Pacific image URL should use GOES-West when requested',
);
assert.match(
  buildGoesLatestImageUrl('eep', { cacheBust: 1710000123456 }),
  /\/GOES19\/ABI\/SECTOR\/eep\/GEOCOLOR\/900x540\.jpg\?t=1710000000000$/,
  'cache stamp should align to the 10-minute STAR refresh cadence',
);
assert.equal(goesCacheStamp('2026-05-05T13:30Z'), '2026-05-05T1330Z', 'string cache stamps should be URL safe');
assert.equal(
  goesSourcePageUrl('taw'),
  'https://www.goes.noaa.gov/sector.php?sat=G19&sector=taw',
  'source page should point to the official NOAA sector page',
);

// A render whose images are still loading when the next render starts used to
// leave its overlays on the layer group for ever: its own load/error handlers
// return early on the generation check, and the next render only removes the
// overlays it had already committed. Toggling the layer twice, or a poll
// landing during a settings change, stacked translucent JPEGs on the map.
// The status badge is appended to document.body; the module builds it lazily,
// so a minimal stand-in keeps the render path reachable without a DOM library.
const makeElement = () => ({
  id: '',
  className: '',
  hidden: false,
  innerHTML: '',
  style: {},
  dataset: {},
  attributes: {},
  classList: { add() {}, remove() {}, contains: () => false },
  setAttribute(name, value) { this.attributes[name] = String(value); },
  getAttribute(name) { return this.attributes[name] ?? null; },
  appendChild(child) { return child; },
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.document = {
  documentElement: { lang: 'en' },
  body: Object.assign(makeElement(), { contains: () => true }),
  createElement: makeElement,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

const layerGroupContents = new Set();
const fakeLayerGroup = {
  addTo() { return fakeLayerGroup; },
  addLayer(layer) { layerGroupContents.add(layer); },
  removeLayer(layer) { layerGroupContents.delete(layer); },
  clearLayers() { layerGroupContents.clear(); },
};
const createdOverlays = [];
globalThis.window = {
  L: {
    layerGroup: () => fakeLayerGroup,
    imageOverlay(url) {
      const handlers = new Map();
      const overlay = {
        url,
        once(event, handler) { handlers.set(event, handler); return overlay; },
        fire(event) { handlers.get(event)?.(); },
        addTo(group) { group.addLayer(overlay); return overlay; },
      };
      createdOverlays.push(overlay);
      return overlay;
    },
  },
};
const fakePane = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false } });
const fakeMap = {
  createPane: fakePane,
  getPane: fakePane,
  hasLayer: () => true,
  addLayer(layer) { return layer; },
  removeLayer() {},
};

const storms = [{ id: 'AL012026' }];
// First render: its image never loads, so nothing settles.
await renderGoesRealtimeContext(storms, { map: fakeMap, enabled: true });
const firstGeneration = [...layerGroupContents];
assert.equal(firstGeneration.length, 1, 'the first render should put its overlay on the layer group');

// Second render arrives while the first is still loading.
await renderGoesRealtimeContext(storms, { map: fakeMap, enabled: true });
const secondGeneration = [...layerGroupContents];
assert.equal(
  secondGeneration.length,
  1,
  `a superseded render must not leave its overlay behind: ${secondGeneration.length} overlays on the layer group`,
);
assert.notEqual(secondGeneration[0], firstGeneration[0], 'the surviving overlay must be the newest generation');

// The superseded overlay's image finally arrives. It must not resurrect itself.
firstGeneration[0].fire('load');
assert.equal(layerGroupContents.size, 1, 'a late load from a superseded render must not add anything back');
assert.equal([...layerGroupContents][0], secondGeneration[0]);

// A committed generation is still replaced normally.
secondGeneration[0].fire('load');
await renderGoesRealtimeContext(storms, { map: fakeMap, enabled: true });
const thirdGeneration = [...layerGroupContents];
assert.equal(thirdGeneration.length, 2, 'a committed overlay stays until the replacement loads');
thirdGeneration[1].fire('load');
assert.equal(layerGroupContents.size, 1, 'once the replacement loads, the committed overlay is removed');

clearGoesLayers();
assert.equal(layerGroupContents.size, 0, 'clearGoesLayers empties the group');

console.log('goes realtime utilities ok');
