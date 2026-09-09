import assert from 'node:assert/strict';

import {
  clearSearchHighlights,
  highlightSearchMatches,
  matchRanges,
  SEARCH_HIGHLIGHT_NAME,
  supportsCustomHighlights,
} from '../src/search-highlight.js';

// ---------------------------------------------------------------- offsets
//
// Expected values come from the input, not from what the function returned:
// each pair is checked by slicing the haystack with it, so an off-by-one shows
// as the wrong characters rather than as two numbers that agree with each
// other.
function slices(text, query) {
  return matchRanges(text, query).map(([start, end]) => text.slice(start, end));
}

assert.deepEqual(matchRanges('2005 Katrina', 'katrina'), [[5, 12]]);
assert.deepEqual(slices('2005 Katrina', 'katrina'), ['Katrina']);
assert.deepEqual(slices('2005 Katrina', 'KATRINA'), ['Katrina'], 'the query is matched case-insensitively');
assert.deepEqual(slices('2005 Katrina', '2005'), ['2005'], 'a year is as matchable as a name');
assert.deepEqual(slices('Katrina LA', 'la'), ['LA'], 'searchStorms matches on state too');

// Non-overlapping, left to right: a reader counts two "aa" in "aaaa", not three.
assert.deepEqual(matchRanges('aaaa', 'aa'), [[0, 2], [2, 4]]);
assert.deepEqual(slices('Anna Banana', 'an'), ['An', 'an', 'an']);

assert.deepEqual(matchRanges('Katrina', ''), [], 'an empty query highlights nothing');
assert.deepEqual(matchRanges('Katrina', '   '), [], 'and neither does whitespace');
assert.deepEqual(matchRanges('Katrina', 'zzz'), []);
assert.deepEqual(matchRanges(null, 'a'), []);
assert.deepEqual(matchRanges('Katrina', null), []);
// The controller passes the raw input value, which carries the reader's spaces.
assert.deepEqual(slices('2005 Katrina', '  katrina '), ['Katrina']);

// toLowerCase is not length-preserving for every input. U+0130 lowercases to
// two code units, so lowercasing before scanning would put every offset after
// it one place to the left and paint the wrong characters.
const dotted = 'AİB Katrina';
assert.equal(dotted.toLowerCase().length, dotted.length + 1, 'this fixture must actually grow when lowercased');
assert.deepEqual(slices(dotted, 'Katrina'), ['Katrina'], 'an offset must index the original string');

// ---------------------------------------------------------------- detection
assert.equal(supportsCustomHighlights({}), false);
assert.equal(supportsCustomHighlights({ Highlight: class {} }), false, 'the constructor alone is not the API');
assert.equal(
  supportsCustomHighlights({ Highlight: class {}, CSS: { highlights: {} } }),
  false,
  'a registry that cannot be written to is not the API either',
);
assert.equal(
  supportsCustomHighlights({ Highlight: class {}, CSS: { highlights: new Map() } }),
  true,
);

// ---------------------------------------------------------------- registry
//
// A fake scope rather than a DOM: the point of these two is that an engine
// without the API is left alone, and that one with it gets exactly one entry
// under the name the stylesheet writes ::highlight() against.
function fakeScope() {
  const highlights = new Map();
  return { Highlight: class Highlight { constructor(...ranges) { this.ranges = ranges; } }, CSS: { highlights } };
}

{
  const scope = { CSS: { highlights: new Map([[SEARCH_HIGHLIGHT_NAME, 'left alone']]) } };
  assert.equal(highlightSearchMatches({}, 'katrina', scope), 0);
  clearSearchHighlights(scope);
  assert.equal(
    scope.CSS.highlights.get(SEARCH_HIGHLIGHT_NAME),
    'left alone',
    'an engine with no Highlight constructor must not have its registry touched',
  );
}

{
  // One text node inside one .search-result-text host, stubbed to the three
  // methods the function uses.
  const node = { data: '2005 Katrina' };
  const doc = {
    createTreeWalker() {
      let served = false;
      return { nextNode: () => (served ? null : (served = true, node)) };
    },
    createRange() {
      return { setStart(n, o) { this.start = [n, o]; }, setEnd(n, o) { this.end = [n, o]; } };
    },
  };
  const container = { ownerDocument: doc, querySelectorAll: () => [{}] };
  const scope = fakeScope();

  assert.equal(highlightSearchMatches(container, 'katrina', scope), 1);
  const entry = scope.CSS.highlights.get(SEARCH_HIGHLIGHT_NAME);
  assert.ok(entry, 'the highlight must be registered under the name the CSS uses');
  assert.deepEqual(entry.ranges[0].start, [node, 5]);
  assert.deepEqual(entry.ranges[0].end, [node, 12]);

  // A query that matches nothing must take the previous highlight down rather
  // than leave the last keystroke's ranges painted over a rebuilt list.
  assert.equal(highlightSearchMatches(container, 'zzz', scope), 0);
  assert.equal(scope.CSS.highlights.has(SEARCH_HIGHLIGHT_NAME), false);

  highlightSearchMatches(container, 'katrina', scope);
  clearSearchHighlights(scope);
  assert.equal(scope.CSS.highlights.has(SEARCH_HIGHLIGHT_NAME), false);
}

console.log('search highlight ok (offsets against the original string, non-overlapping, registry left alone without the API)');
