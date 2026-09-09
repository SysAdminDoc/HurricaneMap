import assert from 'node:assert/strict';

import {
  clearSearchHighlights,
  highlightSearchMatches,
  highlightTerms,
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
// The first version of this guard gave up on case-insensitivity for the WHOLE
// string as soon as one character refused to fold cleanly, so a lowercase
// query stopped matching anything in a row that happened to contain U+0130.
// Folding one code unit at a time costs only that character.
assert.deepEqual(
  slices(dotted, 'katrina'),
  ['Katrina'],
  'one unfoldable character must not switch the whole scan to case-sensitive',
);
assert.deepEqual(slices('İstanbul KATRINA', 'katrina'), ['KATRINA']);

// ---------------------------------------------------------------- terms
//
// searchStorms matches the query against "name year state" as one string, but
// the row prints year, name and state in a different order and in separate
// text nodes. "katrina 2005" therefore matches the storm and appears nowhere
// in the row as a contiguous run, so the query is painted term by term.
assert.deepEqual(highlightTerms('katrina'), ['katrina']);
assert.deepEqual(highlightTerms('  katrina  2005 '), ['katrina', '2005']);
assert.deepEqual(highlightTerms('katrina katrina'), ['katrina'], 'a repeated word is one term');
assert.deepEqual(highlightTerms(''), []);
assert.deepEqual(highlightTerms('   '), []);
// A single letter would paint one character in every row and say nothing, but
// dropping every word must not leave a query with no terms at all.
assert.deepEqual(highlightTerms('katrina a'), ['katrina']);
assert.deepEqual(highlightTerms('a'), ['a']);
assert.deepEqual(highlightTerms('a b'), ['a b'], 'when every word is dropped the query itself is the term');

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

  // The regression this file exists to pin: a query spanning two of the three
  // fields searchStorms matches on. Before terms, this painted nothing.
  assert.equal(highlightSearchMatches(container, 'katrina 2005', scope), 2);
  const both = scope.CSS.highlights.get(SEARCH_HIGHLIGHT_NAME).ranges;
  assert.deepEqual(
    both.map(range => node.data.slice(range.start[1], range.end[1])).sort(),
    ['2005', 'Katrina'],
    'both fields that earned the match must be painted',
  );

  // Overlapping terms must not register the same offsets twice.
  assert.equal(highlightSearchMatches(container, 'katrina katrina', scope), 1);

  highlightSearchMatches(container, 'katrina', scope);
  clearSearchHighlights(scope);
  assert.equal(scope.CSS.highlights.has(SEARCH_HIGHLIGHT_NAME), false);
}

console.log('search highlight ok (offsets against the original string, non-overlapping, registry left alone without the API)');
