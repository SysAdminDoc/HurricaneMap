// The intensity chart, and what it does with a hole in the record.
//
// src/chart.js draws wind and pressure against time for one storm. Older best
// tracks have no pressure at all for long stretches, and a missing reading is
// not a reading of zero: joining across the gap would draw a plunge to 880 mb
// that never happened. Nothing tested this directly, and the visual baselines
// only cover storms whose data happens to be complete.
//
// The module writes an SVG string into a container, so the container is the
// only DOM needed and the assertions read the markup it produced.
import assert from 'node:assert/strict';

globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#cba6f7' });
globalThis.document = {
  documentElement: { lang: 'en' },
  body: { classList: { contains: () => false } },
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild(c) { return c; } }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

const { renderIntensityChart } = await import('../src/chart.js');

// After writing its markup the chart wires a hover crosshair, so the container
// has to hand back the three elements it looks for. They are inert here: the
// crosshair is not what these assertions are about, but the render path does
// not finish without them.
function container() {
  const stub = () => ({
    style: {},
    hidden: false,
    textContent: '',
    innerHTML: '',
    setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 260 }),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const parts = new Map();
  return {
    innerHTML: '',
    querySelector(selector) {
      if (!parts.has(selector)) parts.set(selector, stub());
      return parts.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 260 }),
  };
}

const at = hours => new Date(Date.UTC(2005, 7, 25, 0) + hours * 3600_000).toISOString();

// Six fixes. The middle two have no pressure, which is the ordinary shape of a
// pre-1979 best track and of plenty of later ones.
const gappy = {
  id: 'AL122005',
  name: 'Test',
  year: 2005,
  track: [
    { t: at(0), lat: 25.0, lon: -80.0, wind: 45, pres: 1000, status: 'TS' },
    { t: at(6), lat: 25.5, lon: -80.8, wind: 60, pres: 990, status: 'TS' },
    { t: at(12), lat: 26.0, lon: -81.6, wind: 75, pres: null, status: 'HU' },
    { t: at(18), lat: 26.5, lon: -82.4, wind: 90, pres: undefined, status: 'HU' },
    { t: at(24), lat: 27.0, lon: -83.2, wind: 110, pres: 950, status: 'HU' },
    { t: at(30), lat: 27.5, lon: -84.0, wind: 125, pres: 940, status: 'HU' },
  ],
  us_landfalls: [{ t: at(24), lat: 27.0, lon: -83.2, wind: 110, cat: 3 }],
};

const polylines = svg => [...svg.matchAll(/<polyline[^>]*\bpoints="([^"]*)"/g)].map(m => m[1]);
const countPoints = points => points.trim().split(/\s+/).filter(Boolean).length;

// The pressure line breaks where the readings stop and picks up again after,
// rather than drawing a straight line through two fixes that were never
// measured.
{
  const host = container();
  renderIntensityChart(host, gappy);
  const svg = host.innerHTML;
  assert(svg.includes('<svg'), 'the chart should render an SVG');

  const lines = polylines(svg);
  assert(lines.length >= 3, `expected a wind line and two pressure segments, got ${lines.length}`);

  // Wind is complete, so it is one run of six points.
  const wind = lines.find(points => countPoints(points) === 6);
  assert(wind, `the wind line should be one unbroken run of six points, got ${lines.map(countPoints).join(', ')}`);

  // Pressure is two runs of two, not one run of four.
  const pressure = lines.filter(points => countPoints(points) === 2);
  assert.equal(
    pressure.length,
    2,
    `pressure should break into two segments around the gap, got runs of ${lines.map(countPoints).join(', ')}`,
  );
  assert(
    !lines.some(points => countPoints(points) === 4),
    'the two pressure runs must not be joined into one line across the missing readings',
  );
}

// A landfall gets its own marker, and it sits where the landfall happened
// rather than at the start of the track.
{
  const host = container();
  renderIntensityChart(host, gappy);
  const svg = host.innerHTML;

  const marks = [...svg.matchAll(/<line class="intensity-landfall-line"[^>]*x1="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.equal(marks.length, 1, `one landfall should draw one marker, got ${marks.length}`);
  assert(svg.includes('intensity-landfall-label'), 'the marker should carry its L label');

  // The landfall is at hour 24 of a 30-hour track, so its marker belongs four
  // fifths of the way across the plot, not at either edge.
  const wind = polylines(svg).find(points => countPoints(points) === 6);
  const xs = wind.trim().split(/\s+/).map(pair => Number(pair.split(',')[0]));
  const [left, right] = [xs[0], xs.at(-1)];
  const expected = left + (right - left) * (24 / 30);
  assert(
    Math.abs(marks[0] - expected) < 0.5,
    `the landfall marker should sit at ${expected.toFixed(1)}, the position of hour 24, but sits at ${marks[0]}`,
  );
}

// Two landfalls draw two markers. A storm that came ashore twice used to be as
// easy to get wrong as one that never did.
{
  const host = container();
  renderIntensityChart(host, {
    ...gappy,
    us_landfalls: [
      { t: at(6), lat: 25.5, lon: -80.8, wind: 60, cat: 1 },
      { t: at(24), lat: 27.0, lon: -83.2, wind: 110, cat: 3 },
    ],
  });
  const marks = [...host.innerHTML.matchAll(/<line class="intensity-landfall-line"/g)];
  assert.equal(marks.length, 2, `two landfalls should draw two markers, got ${marks.length}`);
}

// A storm with no pressure at all draws no pressure line, and still draws its
// wind. Half the nineteenth-century record looks like this.
{
  const host = container();
  renderIntensityChart(host, {
    ...gappy,
    track: gappy.track.map(fix => ({ ...fix, pres: null })),
    us_landfalls: [],
  });
  const lines = polylines(host.innerHTML);
  assert.equal(lines.length, 1, `only the wind line should be drawn, got ${lines.length}`);
  assert.equal(countPoints(lines[0]), 6, 'and it should still have every fix');
}

// An empty track clears the container instead of rendering an axis with
// nothing on it, and a missing container is not a crash.
{
  const host = container();
  host.innerHTML = 'stale';
  renderIntensityChart(host, { ...gappy, track: [] });
  assert.equal(host.innerHTML, '', 'an empty track should clear whatever was there');
  renderIntensityChart(null, gappy);
}

console.log(
  'intensity chart ok (pressure breaks at a gap instead of drawing through it, landfall markers land on '
  + 'their own hour, a pressureless storm still draws wind, and an empty track clears the chart)',
);
