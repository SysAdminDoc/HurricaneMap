// Side-by-side comparison of two pinned storms, on one map.
//
// Not two maps. Every library that syncs a pair of Leaflet maps is either
// unmaintained or has a live desync bug, and the failure they share is that two
// views can drift apart. One map with two clipped panes makes drift
// structurally impossible: both halves are the same view because they are the
// same map, and "linked zoom" is not a feature that can break.
//
// The divider and the crossfade are both a plain <input type="range">. That is
// not a shortcut, it is the accessible answer: none of the comparison controls
// in Mapbox, MapLibre, ol-ext or NASA Worldview is focusable, has a role, or
// responds to an arrow key, and a range input has all three for free, plus
// Home, End, PageUp and PageDown.
//
// The clip is a polygon in pixels rather than an inset in percentages. A
// Leaflet pane is an absolutely positioned box with no width or height, so a
// percentage resolves against nothing; pixel coordinates resolve against the
// pane's origin, which is the layer-point origin, and Leaflet will convert a
// container point into one of those exactly. That conversion is why the clip
// cannot drift from the map: it is derived from the map's own transform on
// every move rather than tracked alongside it.

const PANE_NAMES = Object.freeze(['hm-compare-a', 'hm-compare-b']);
const FAR = 100000;

let boundMap = null;
let mode = 'off';
let position = 50;
let stacked = false;
let mobileQuery = null;

/**
 * The pane a pinned storm's track belongs in, by its POSITION among the pins.
 *
 * Not by its colour slot. Slots are never re-packed when a pin is removed, so
 * pinning three storms and unpinning the first left the remaining two holding
 * slots 1 and 2: one pane empty, one storm drawn unclipped over both halves of
 * the split. Position is what "the first two pinned storms" means.
 */
export function comparePaneName(index) {
  return PANE_NAMES[index] || null;
}

export function ensureComparePanes(map) {
  for (const [index, name] of PANE_NAMES.entries()) {
    if (map.getPane(name)) continue;
    const pane = map.createPane(name);
    // Above the tile pane and below the marker pane, in the same order the
    // pins were made, so the second storm draws over the first when neither is
    // clipped away.
    pane.style.zIndex = String(430 + index);
    pane.classList.add('hm-compare-pane');
  }
  if (boundMap === map) return;
  boundMap = map;
  map.on('move zoom zoomend viewreset resize', applyClip);
  // Guarded the way settings.js and shell-navigation.js guard the same query:
  // ensureComparePanes runs from drawTrack, so an engine without either API
  // would throw on pinning a storm rather than on opening the panel.
  if (!mobileQuery && typeof window.matchMedia === 'function') {
    mobileQuery = window.matchMedia('(max-width: 720px)');
    const onChange = event => {
      stacked = event.matches;
      applyClip();
      // The panel's own hint names the orientation, so it has to be told:
      // crossing the breakpoint with a split active left it saying "between"
      // over a map that was splitting top and bottom.
      document.dispatchEvent(new CustomEvent('hm-compare-panes:orientation', {
        detail: { stacked },
      }));
    };
    if (typeof mobileQuery.addEventListener === 'function') mobileQuery.addEventListener('change', onChange);
    else if (typeof mobileQuery.addListener === 'function') mobileQuery.addListener(onChange);
  }
  stacked = Boolean(mobileQuery?.matches);
}

/**
 * @param next 'off' hands both panes back to the map unclipped and fully
 * opaque, which is what the reader gets when they have not asked for a
 * comparison; 'swipe' clips them either side of the divider; 'fade' shows both
 * at the same pixel, which is the only mode that answers "where did these two
 * differ" rather than "what did each do".
 */
export function setComparePaneMode(next) {
  mode = ['off', 'swipe', 'fade'].includes(next) ? next : 'off';
  applyClip();
  return mode;
}

export function getComparePaneMode() {
  return mode;
}

/** 0 to 100. The divider position in swipe mode, the mix in crossfade. */
export function setComparePanePosition(next) {
  const value = Number(next);
  position = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
  applyClip();
  return position;
}

export function getComparePanePosition() {
  return position;
}

/** Whether the split runs top-to-bottom rather than left-to-right. */
export function isComparePaneStacked() {
  return stacked;
}

function applyClip() {
  if (!boundMap) return;
  const panes = PANE_NAMES.map(name => boundMap.getPane(name)).filter(Boolean);
  if (panes.length < PANE_NAMES.length) return;
  const [first, second] = panes;

  if (mode === 'off') {
    for (const pane of panes) {
      pane.style.clipPath = '';
      pane.style.opacity = '';
    }
    return;
  }

  if (mode === 'fade') {
    for (const pane of panes) pane.style.clipPath = '';
    // The first storm fades out as the second fades in, so the two always sum
    // to one and the map underneath never shows through more than it would
    // with either alone.
    first.style.opacity = String((100 - position) / 100);
    second.style.opacity = String(position / 100);
    return;
  }

  for (const pane of panes) pane.style.opacity = '';
  const size = boundMap.getSize();
  // Container point first, then into the layer-point space the panes live in.
  // Doing it the other way round is what makes a clip drift on a zoom.
  const containerPoint = stacked
    ? [0, Math.round((size.y * position) / 100)]
    : [Math.round((size.x * position) / 100), 0];
  const layerPoint = boundMap.containerPointToLayerPoint(containerPoint);
  const cut = stacked ? layerPoint.y : layerPoint.x;
  first.style.clipPath = stacked ? clipAbove(cut) : clipLeftOf(cut);
  second.style.clipPath = stacked ? clipBelow(cut) : clipRightOf(cut);
}

function clipLeftOf(x) {
  return `polygon(${-FAR}px ${-FAR}px, ${x}px ${-FAR}px, ${x}px ${FAR}px, ${-FAR}px ${FAR}px)`;
}

function clipRightOf(x) {
  return `polygon(${x}px ${-FAR}px, ${FAR}px ${-FAR}px, ${FAR}px ${FAR}px, ${x}px ${FAR}px)`;
}

function clipAbove(y) {
  return `polygon(${-FAR}px ${-FAR}px, ${FAR}px ${-FAR}px, ${FAR}px ${y}px, ${-FAR}px ${y}px)`;
}

function clipBelow(y) {
  return `polygon(${-FAR}px ${y}px, ${FAR}px ${y}px, ${FAR}px ${FAR}px, ${-FAR}px ${FAR}px)`;
}

/**
 * The same instant in two different storms.
 *
 * Two storms of different lengths, decades apart, have no wall-clock instant in
 * common, so the axis is a fraction of each storm's own LIFE. Not of its point
 * count: HURDAT2 intercalates non-synoptic fixes at landfall and at peak
 * intensity, so a track with extra points near its landfall has more of its
 * indices there than of its hours, and index 50 percent sat up to 22 percent
 * away from the temporal midpoint. Andrew 1992 was eighteen hours out.
 *
 * Falls back to the index when the timestamps cannot answer, which is a track
 * with one point or with unparseable times.
 */
export function trackPointAtFraction(track, fraction) {
  const points = (track || []).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (!points.length) return null;
  const clamped = Math.min(1, Math.max(0, Number(fraction) || 0));
  const times = points.map(point => Date.parse(point.t));
  const usable = times.every(Number.isFinite) && times[times.length - 1] > times[0];
  if (!usable) return points[Math.round(clamped * (points.length - 1))];
  const target = times[0] + clamped * (times[times.length - 1] - times[0]);
  let best = 0;
  for (let index = 1; index < times.length; index += 1) {
    if (Math.abs(times[index] - target) < Math.abs(times[best] - target)) best = index;
  }
  return points[best];
}
