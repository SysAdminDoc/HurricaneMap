// The playback animator: what it draws between fixes, and what it lets go of.
//
// src/animation.js owns the requestAnimationFrame loop, the storm glyph, the
// wind circle and the radar overlay, and until now nothing tested any of it
// directly. The smoke suite drives playback through the panel, which exercises
// the happy path and cannot say what happens when a second storm supersedes the
// first mid-load, or whether stop() actually hands its layers back.
//
// A hand-built DOM in the style of test-goes-realtime.mjs, because the module
// reads window.L at import time and adds a settings listener in its
// constructor. Nothing here needs layout, only identity: which objects reached
// the map, and which were taken off it again.
import assert from 'node:assert/strict';

const makeElement = () => ({
  id: '',
  className: '',
  hidden: false,
  innerHTML: '',
  textContent: '',
  style: {},
  dataset: {},
  attributes: {},
  children: [],
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute(name, value) { this.attributes[name] = String(value); },
  getAttribute(name) { return this.attributes[name] ?? null; },
  removeAttribute(name) { delete this.attributes[name]; },
  appendChild(child) { this.children.push(child); return child; },
  append(...nodes) { this.children.push(...nodes); },
  insertAdjacentHTML() {},
  remove() {},
  closest: () => null,
  querySelector: () => makeElement(),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  focus() {},
});

globalThis.document = {
  documentElement: { lang: 'en', style: { setProperty() {} } },
  body: Object.assign(makeElement(), { contains: () => true }),
  createElement: makeElement,
  createElementNS: makeElement,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

// Every layer records whether the map still holds it, which is the whole
// question stop() has to answer.
const onMap = new Set();
function fakeLayer(kind) {
  const layer = {
    kind,
    addTo(map) { map.added.push(layer); onMap.add(layer); return layer; },
    setLatLng() { return layer; },
    setRadius() { return layer; },
    setStyle() { return layer; },
    setIcon() { return layer; },
    setUrl() { return layer; },
    setOpacity() { return layer; },
    bringToFront() { return layer; },
    on() { return layer; },
  };
  return layer;
}

globalThis.window = {
  L: {
    marker: () => fakeLayer('marker'),
    circle: () => fakeLayer('circle'),
    divIcon: options => ({ options }),
    imageOverlay: () => fakeLayer('overlay'),
  },
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
// The palette resolves category colours through the stylesheet, which is not
// what is under test here; a constant keeps the render path reachable.
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#cba6f7' });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.performance ??= { now: () => 0 };

const { TrackAnimator } = await import('../src/animation.js');

function fakeMap() {
  return {
    added: [],
    removed: [],
    removeLayer(layer) { this.removed.push(layer); onMap.delete(layer); },
    addLayer(layer) { this.added.push(layer); onMap.add(layer); return layer; },
    getBounds: () => ({ contains: () => true }),
    getZoom: () => 5,
    hasLayer: layer => onMap.has(layer),
  };
}

const track = [
  { t: '2005-08-25T00:00:00Z', lat: 25, lon: -80, wind: 45, pres: 1000, status: 'TS' },
  { t: '2005-08-26T00:00:00Z', lat: 26, lon: -82, wind: 75, pres: 980, status: 'HU' },
  { t: '2005-08-27T00:00:00Z', lat: 27, lon: -84, wind: 100, pres: 950, status: 'HU' },
];
const storm = id => ({ id, name: 'Test', year: 2005, basin: 'AL', track });

// Densifying puts three interpolated frames between each pair of fixes and
// keeps the last one exactly as it was given. A frame that drifted off the
// segment would put the glyph somewhere the storm never went.
{
  const animator = new TrackAnimator(fakeMap());
  const dense = animator.densify(track);
  assert.equal(dense.length, (track.length - 1) * 4 + 1, 'four samples per segment plus the final fix');
  assert.deepEqual(dense[0], { ...dense[0], lat: 25, lon: -80 }, 'the first frame is the first fix');
  assert.equal(dense.at(-1), track.at(-1), 'the last frame is the last fix, untouched');

  // A quarter of the way along the first segment.
  assert.equal(dense[1].lat, 25.25, 'latitude interpolates linearly');
  assert.equal(dense[1].lon, -80.5, 'longitude interpolates linearly');
  assert.equal(dense[1].wind, 52.5, 'wind interpolates linearly');
  assert.equal(dense[1].status, 'TS', 'status holds the earlier fix through the first half of a segment');
  assert.equal(dense[3].status, 'HU', 'and takes the later one past halfway');

  // Every frame has to sit inside the segment it belongs to, or the glyph
  // leaves the track.
  for (const frame of dense) {
    assert(frame.lat >= 25 && frame.lat <= 27, `frame latitude ${frame.lat} left the track`);
    assert(frame.lon >= -84 && frame.lon <= -80, `frame longitude ${frame.lon} left the track`);
  }
}

// sampleAt walks the densified track. A single-fix storm has no segment to
// interpolate, and a handful of 1860s storms are exactly that.
{
  const animator = new TrackAnimator(fakeMap());
  animator.densifiedTrack = animator.densify(track);
  assert.equal(animator.sampleAt(0).lat, 25, 'the start of playback is the first fix');
  assert.equal(animator.sampleAt(1).lat, 27, 'the end of playback is the last fix');

  const single = [{ t: '1867-06-21T00:00:00Z', lat: 20, lon: -70, wind: 40, pres: 1005, status: 'TS' }];
  animator.densifiedTrack = single;
  assert.equal(animator.sampleAt(0.5), single[0], 'a one-fix storm returns its lone fix rather than indexing past the end');
  assert.equal(animator.sampleAt(1), single[0], 'at any point in the timeline');
}

// stop() hands back everything it put on the map and forgets the storm. A
// marker left behind is a hurricane glyph sitting on the map with no playback
// running and no way to remove it.
{
  const map = fakeMap();
  const animator = new TrackAnimator(map);
  await animator.play(storm('AL122005'));

  assert(animator.marker, 'playback should have put a marker on the map');
  assert(animator.windCircle, 'playback should have put a wind circle on the map');
  const painted = [animator.marker, animator.windCircle];
  for (const layer of painted) assert(map.hasLayer(layer), `${layer.kind} should be on the map during playback`);

  const states = [];
  animator.stateCallback = state => states.push(state);
  animator.rafId = 7;
  animator.stop();

  for (const layer of painted) {
    assert(!map.hasLayer(layer), `${layer.kind} must be taken off the map when playback stops`);
  }
  assert.equal(animator.marker, null, 'the marker reference must be released');
  assert.equal(animator.windCircle, null, 'the wind circle reference must be released');
  assert.equal(animator.rafId, null, 'the animation frame must be cancelled and forgotten');
  assert.equal(animator.storm, null, 'the storm must be released');
  assert.equal(animator.densifiedTrack, null, 'the densified track must be released');
  assert.equal(animator.isActive(), false, 'a stopped animator is not active');
  assert.deepEqual(
    states,
    [{ active: false, playing: false, paused: false, ended: false, stormId: null }],
    'stopping must tell the panel that playback ended',
  );

  // Silent teardown is what play() does to itself before starting, so it must
  // not announce a stop the reader never asked for.
  const quiet = [];
  animator.stateCallback = state => quiet.push(state);
  animator.stop({ silent: true });
  assert.deepEqual(quiet, [], 'a silent stop must not emit a state change');
}

// A second storm started while the first is still loading its radar must win.
// play() awaits getStormRadarFrames, and the continuation after that await used
// to rebuild the controls and overwrite the radar frames for whichever storm
// had since taken over.
{
  const map = fakeMap();
  const animator = new TrackAnimator(map);

  // The state callback belongs to whichever play() ran last, so a stale
  // continuation announcing itself shows up as a second call nobody asked for.
  // That is the observable the guard protects: without it, the abandoned run
  // rebuilds the controls and re-announces playback using the storm that
  // replaced it.
  const announced = [];
  const first = animator.play(storm('AL011900'));
  const second = animator.play(storm('AL122005'), { onStateChange: state => announced.push(state) });
  await Promise.all([first, second]);

  assert.equal(
    announced.length,
    1,
    `playback should be announced once, by the storm that is playing; got ${JSON.stringify(announced)}`,
  );
  assert.equal(announced[0].stormId, 'AL122005', 'and it should name that storm');

  assert.equal(animator.storm?.id, 'AL122005', 'the storm that started last is the one playing');
  assert.equal(animator.isActiveFor('AL122005'), true, 'and the animator reports it');
  assert.equal(animator.isActiveFor('AL011900'), false, 'the superseded storm is not active');

  // The superseded run must not have left its own layers on the map. Exactly
  // one marker and one circle survive: the ones belonging to the storm playing.
  const liveMarkers = map.added.filter(layer => layer.kind === 'marker' && map.hasLayer(layer));
  const liveCircles = map.added.filter(layer => layer.kind === 'circle' && map.hasLayer(layer));
  assert.equal(liveMarkers.length, 1, `one marker should be on the map, found ${liveMarkers.length}`);
  assert.equal(liveCircles.length, 1, `one wind circle should be on the map, found ${liveCircles.length}`);
  assert.equal(liveMarkers[0], animator.marker, 'and it belongs to the storm that is playing');

  animator.stop();
}

console.log(
  'track animator ok (densified frames stay on the track, a one-fix storm samples without indexing past its '
  + 'end, stop() hands back every layer and announces once, and a superseded storm stops painting)',
);
