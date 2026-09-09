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
 * Lowercase a string without ever changing its length.
 *
 * `String.prototype.toLowerCase` is not length-preserving: U+0130, the Turkish
 * dotted capital I, becomes two code units. Folding the whole string and then
 * scanning it would shift every offset after such a character and paint the
 * wrong text. Folding one code unit at a time and keeping any that refuses to
 * fold cleanly costs the case-insensitivity of that one character rather than
 * of the entire string, which is what an all-or-nothing guard here used to do.
 */
function foldCase(text) {
  let folded = '';
  for (let index = 0; index < text.length; index += 1) {
    const lower = text[index].toLowerCase();
    folded += lower.length === 1 ? lower : text[index];
  }
  return folded;
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
  const scanHaystack = foldCase(haystack);
  const scanNeedle = foldCase(needle);
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
 * The terms to paint for a query.
 *
 * searchStorms matches the raw query against "name year state" joined into one
 * string, but a result row renders those three fields in a different order and
 * in separate text nodes. So "katrina 2005" matches the storm and appears
 * nowhere in the row as a contiguous run: scanning for the whole query painted
 * nothing at all for any query that spanned two fields.
 *
 * A one-character word is dropped, because it would paint a letter in every
 * row and tell the reader nothing. If that leaves no terms the whole query is
 * the term, which is what a short single-word query needs.
 */
export function highlightTerms(query) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return [];
  const words = [...new Set(trimmed.split(/\s+/).filter(word => word.length > 1))];
  return words.length ? words : [trimmed];
}

/**
 * Paint every term of `query` inside the `.search-result-text` spans of
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
  const terms = highlightTerms(query);
  if (!container || !terms.length) return 0;
  const doc = container.ownerDocument;
  if (!doc) return 0;
  const ranges = [];
  for (const host of container.querySelectorAll('.search-result-text')) {
    const walker = doc.createTreeWalker(host, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Two terms can land on the same characters ("kat katrina"), and one
      // Range per pair of offsets is enough to paint them.
      const claimed = new Set();
      for (const term of terms) {
        for (const [start, end] of matchRanges(node.data, term)) {
          const key = `${start}:${end}`;
          if (claimed.has(key)) continue;
          claimed.add(key);
          const range = doc.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          ranges.push(range);
        }
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
