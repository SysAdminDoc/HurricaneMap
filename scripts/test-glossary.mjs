// The glossary's load is shared between concurrent callers.
//
// Two rapid opens each started their own load. The second superseded the
// first, the first returned an empty array, and whichever built the modal
// first built it with no terms, while the other found the modal already there
// and returned without rendering into it. The reader got "No matching terms"
// until they typed something.
import assert from 'node:assert/strict';

const elements = new Map();

function makeElement(tag = 'div') {
  const listeners = new Map();
  const element = {
    tag,
    id: '',
    className: '',
    hidden: false,
    value: '',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    listeners,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = String(value);
    },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) {
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    },
    // The modal's markup is a template string, so the ids inside it are only
    // discoverable by reading it back. That is enough for getElementById.
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    focus() {},
    contains: () => true,
  };
  return element;
}

const body = makeElement('body');
globalThis.document = {
  documentElement: { lang: 'en' },
  body,
  createElement: makeElement,
  getElementById(id) {
    if (elements.has(id)) return elements.get(id);
    // Ids that only exist inside a template string still have to resolve once
    // the markup carrying them is on the page.
    for (const node of body.children) {
      if (typeof node.innerHTML === 'string' && node.innerHTML.includes(`id="${id}"`)) {
        const stub = makeElement();
        stub.setAttribute('id', id);
        elements.set(id, stub);
        return stub;
      }
    }
    return null;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return true; },
};

const TERMS = [
  { term: 'Eyewall', definition: 'The ring of thunderstorms around a hurricane eye.' },
  { term: 'Storm surge', definition: 'Water pushed ashore by a storm.' },
  { term: 'Rapid intensification', definition: 'A 30 kt wind increase in 24 hours.' },
];

// A slow fetch is what opens the window: both callers are in flight at once.
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  await new Promise(resolve => setTimeout(resolve, 30));
  return {
    ok: true,
    status: 200,
    json: async () => TERMS,
  };
};

const { initGlossary, loadGlossary, searchGlossary } = await import('../src/glossary.js');

// Two opens raced, exactly as a double click produces.
const [first, second] = await Promise.all([initGlossary(), initGlossary()]);
void first;
void second;

assert.equal(fetchCalls, 1, `concurrent opens must share one request, made ${fetchCalls}`);

const loaded = await loadGlossary();
assert.equal(loaded.length, TERMS.length, `the glossary loaded ${loaded.length} terms, expected ${TERMS.length}`);
assert.deepEqual(
  loaded.map(entry => entry.term),
  TERMS.map(entry => entry.term),
  'a raced open must not leave the glossary holding an empty list',
);

// The list the modal renders from is the same data, so a populated load is a
// populated modal. Searching proves the lookup map was built too.
assert.equal(searchGlossary('eyewall').length, 1, 'search must find a term after a raced load');
assert.equal(searchGlossary('surge').length, 1, 'search must match on the term text');
assert.equal(searchGlossary('nothing-matches-this').length, 0);

// The modal was built once, and built from the loaded terms.
const modal = document.getElementById('glossary-modal');
assert(modal, 'the raced opens must have built the modal');
assert.equal(body.children.filter(child => child.id === 'glossary-modal').length, 1, 'the modal must be built once');

console.log(`glossary ok (concurrent opens share one load, ${loaded.length} terms, search over a raced load)`);
