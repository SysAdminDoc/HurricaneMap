// The timeline ribbon's drag-to-filter selection.
//
// src/timeline.js turns a pointer position into a year range, and that
// arithmetic is the whole filter: get it wrong at either end and the atlas
// silently shows the wrong century. Nothing tested it directly, because the
// smoke suite drives the map rather than the axis.
//
// The DOM here is built by hand rather than parsed. The module sets innerHTML
// and then asks for elements by id, so querySelector hands back one stub per
// selector and keeps handing back the same one, which is all the module needs
// and all the test needs to drive it.
import assert from 'node:assert/strict';

class FakeNode {}

function makeElement(tag = 'div') {
  const listeners = new Map();
  const bySelector = new Map();
  const element = Object.assign(new FakeNode(), {
    tag,
    id: '',
    title: '',
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    classList: {
      names: new Set(),
      add(name) { this.names.add(name); },
      remove(name) { this.names.delete(name); },
      toggle(name, force) { if (force === undefined) { this.names.has(name) ? this.names.delete(name) : this.names.add(name); } else if (force) this.names.add(name); else this.names.delete(name); },
      contains(name) { return this.names.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { this.children.push(...nodes); },
    remove() {},
    contains: () => true,
    closest: () => null,
    // One stub per selector, remembered, so the module and the test are
    // looking at the same element.
    querySelector(selector) {
      if (!bySelector.has(selector)) bySelector.set(selector, makeElement(selector));
      return bySelector.get(selector);
    },
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
    setPointerCapture() {},
    releasePointerCapture() {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    focus() {},
    // Drive a handler the way a browser would.
    fire(type, event = {}) {
      const dispatched = {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        target: element,
        preventDefault() {},
        ...event,
      };
      for (const handler of listeners.get(type) || []) handler(dispatched);
    },
    handlerCount(type) { return (listeners.get(type) || []).length; },
  });
  return element;
}

globalThis.Element = FakeNode;
globalThis.document = {
  documentElement: { lang: 'en' },
  body: Object.assign(makeElement('body'), { contains: () => true }),
  createElement: tag => makeElement(tag),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

const { mountTimeline } = await import('../src/timeline.js');

function mount({ yearMin = 1851, yearMax = 2025 } = {}) {
  const changes = [];
  mountTimeline([], { yearMin, yearMax, onYearRangeChange: range => changes.push(range) });
  const host = document.body.children.at(-1);
  return { changes, host, axis: host.querySelector('#timeline-axis') };
}

// A drag across the whole axis selects the whole range. The axis is 100 px
// wide here, so a pixel is not quite two years and every assertion below is
// about which year a position rounds to.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: 0 });
  axis.fire('pointermove', { clientX: 100 });
  axis.fire('pointerup', { clientX: 100 });
  assert.deepEqual(
    changes.at(-1),
    { yearMin: 1900, yearMax: 2000 },
    'dragging the full width selects the full range',
  );
}

// Both ends, exactly. The left edge is the first year and the right edge is the
// last, with no off-by-one from the rounding in between.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: 0 });
  axis.fire('pointermove', { clientX: 50 });
  axis.fire('pointerup', { clientX: 50 });
  assert.deepEqual(changes.at(-1), { yearMin: 1900, yearMax: 1950 }, 'half the axis is half the range');

  axis.fire('pointerdown', { clientX: 25 });
  axis.fire('pointermove', { clientX: 75 });
  axis.fire('pointerup', { clientX: 75 });
  assert.deepEqual(changes.at(-1), { yearMin: 1925, yearMax: 1975 }, 'a middle drag maps to the middle years');
}

// Dragging right to left is the same selection. The handler sorts the ends, and
// without that a backwards drag asks the atlas for a range with min above max.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: 80 });
  axis.fire('pointermove', { clientX: 20 });
  axis.fire('pointerup', { clientX: 20 });
  assert.deepEqual(changes.at(-1), { yearMin: 1920, yearMax: 1980 }, 'a backwards drag still yields min then max');
}

// A pointer that never moved is a click on one year, not a drag of zero width.
// The 6 px threshold is what tells them apart.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: 40 });
  axis.fire('pointermove', { clientX: 43 });
  axis.fire('pointerup', { clientX: 43 });
  // The year is the one under the pointer when it was released, not where it
  // went down. At the real axis width that is a fraction of a year apart.
  assert.deepEqual(changes.at(-1), { yearMin: 1943, yearMax: 1943 }, 'a jitter under the threshold is a single year');

  axis.fire('pointerdown', { clientX: 40 });
  axis.fire('pointerup', { clientX: 40 });
  assert.deepEqual(changes.at(-1), { yearMin: 1940, yearMax: 1940 }, 'and a click with no move at all is too');
}

// A position lands on the nearest year, not the one before it. Over the real
// 1851 to 2025 span a pixel is 1.74 years, so a pointer one pixel in is at
// 1852.74: the year it belongs to is 1853. Truncating would report 1852 and
// every selection would sit a year early.
{
  const { changes, axis } = mount({ yearMin: 1851, yearMax: 2025 });
  axis.fire('pointerdown', { clientX: 1 });
  axis.fire('pointermove', { clientX: 99 });
  axis.fire('pointerup', { clientX: 99 });
  assert.deepEqual(
    changes.at(-1),
    { yearMin: 1853, yearMax: 2023 },
    'a position between two years takes the nearer one',
  );
}

// Positions outside the axis clamp to its ends rather than running off into
// years the dataset does not have.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: -400 });
  axis.fire('pointermove', { clientX: 900 });
  axis.fire('pointerup', { clientX: 900 });
  assert.deepEqual(changes.at(-1), { yearMin: 1900, yearMax: 2000 }, 'a drag past both edges clamps to the range');
}

// A secondary button, or a non-primary pointer, is not a selection. Without
// this the second finger of a pinch redraws the filter.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: 10, button: 2 });
  axis.fire('pointerup', { clientX: 90 });
  assert.equal(changes.length, 0, 'a right-click must not select anything');

  axis.fire('pointerdown', { clientX: 10, isPrimary: false });
  axis.fire('pointerup', { clientX: 90 });
  assert.equal(changes.length, 0, 'a non-primary pointer must not select anything');
}

// The selection the module draws has to agree with the range it reports, or
// the ribbon shows one span and the map filters by another.
{
  const { changes, axis } = mount({ yearMin: 1900, yearMax: 2000 });
  axis.fire('pointerdown', { clientX: 20 });
  axis.fire('pointermove', { clientX: 60 });
  axis.fire('pointerup', { clientX: 60 });
  const { yearMin, yearMax } = changes.at(-1);
  assert.deepEqual({ yearMin, yearMax }, { yearMin: 1920, yearMax: 1960 });
  assert.equal(
    axis.getAttribute('aria-valuetext'),
    '1920 to 1960',
    'the slider must announce the same span it reported',
  );
  const selection = axis.querySelector('.tl-selection');
  assert.equal(selection.style.left, '20%', 'the drawn selection starts where the range does');
  assert.equal(selection.style.width, '40%', 'and is as wide as the range is long');
}

console.log(
  'timeline selection ok (both ends map exactly, a backwards drag sorts itself, a jitter under the threshold '
  + 'is one year, out-of-bounds clamps, secondary pointers are ignored, and the drawn span matches the '
  + 'reported one)',
);
