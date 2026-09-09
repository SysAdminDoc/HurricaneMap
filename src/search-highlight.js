// Match highlighting for the search list, painted by the browser instead of
// wrapped in elements.
//
// The obvious implementation splits the matched substring into its own <mark>,
// and that changes the tree a screen reader walks: an option whose accessible
// name was "2005 Katrina" becomes three nodes, and the name is assembled from
// pieces that the user's own typing decides the boundaries of. The Custom
// Highlight API takes Ranges over the text that is already there and paints
// them, so the DOM after highlighting is byte-for-byte the DOM before it.
//
// It is progressive: an engine without it gets the same list unhighlighted,
// which is what the app rendered before this existed.

/** The registry key. Also the name ::highlight() is written against in CSS. */
export const SEARCH_HIGHLIGHT_NAME = 'hm-search-match';

export function supportsCustomHighlights(scope = globalThis) {
  return typeof scope.Highlight === 'function'
    && typeof scope.CSS?.highlights?.set === 'function';
}

/**
 * Every case-insensitive occurrence of `query` in `text`, as [start, end)
 * offsets. Non-overlapping and left to right, so "aa" in "aaaa" is two matches
 * rather than three, which is what a reader counts.
 *
 * Offsets rather than substrings because the caller needs them to build Ranges,
 * and because returning the matched text would make an off-by-one invisible.
 */
export function matchRanges(text, query) {
  const haystack = String(text ?? '');
  const needle = String(query ?? '').trim();
  if (!needle) return [];
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  // toLowerCase can change a string's length (the Turkish dotted capital I
  // becomes two code units), which would put every offset after it in the
  // wrong place. Fall back to a case-sensitive scan rather than paint the
  // wrong characters.
  const scanHaystack = lowerHaystack.length === haystack.length ? lowerHaystack : haystack;
  const scanNeedle = lowerNeedle.length === needle.length && scanHaystack === lowerHaystack
    ? lowerNeedle
    : needle;
  const found = [];
  let from = 0;
  for (;;) {
    const at = scanHaystack.indexOf(scanNeedle, from);
    if (at === -1) return found;
    found.push([at, at + scanNeedle.length]);
    from = at + scanNeedle.length;
  }
}

/**
 * Paint every occurrence of `query` inside the `.search-result-text` spans of
 * `container`. Returns the number of ranges registered, which is 0 both when
 * the engine has no Custom Highlight API and when nothing matched.
 *
 * The meta span is included on purpose: searchStorms matches against
 * "name year state", so a query that matched on the state should show why.
 */
export function highlightSearchMatches(container, query, scope = globalThis) {
  if (!supportsCustomHighlights(scope)) return 0;
  const registry = scope.CSS.highlights;
  registry.delete(SEARCH_HIGHLIGHT_NAME);
  const needle = String(query ?? '').trim();
  if (!container || !needle) return 0;
  const doc = container.ownerDocument;
  if (!doc) return 0;
  const ranges = [];
  for (const host of container.querySelectorAll('.search-result-text')) {
    const walker = doc.createTreeWalker(host, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const [start, end] of matchRanges(node.data, needle)) {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        ranges.push(range);
      }
    }
  }
  if (!ranges.length) return 0;
  registry.set(SEARCH_HIGHLIGHT_NAME, new scope.Highlight(...ranges));
  return ranges.length;
}

/** Take the highlight down. Ranges hold their nodes alive, so this is not
 *  optional housekeeping: the list is replaced on every keystroke. */
export function clearSearchHighlights(scope = globalThis) {
  if (!supportsCustomHighlights(scope)) return;
  scope.CSS.highlights.delete(SEARCH_HIGHLIGHT_NAME);
}
