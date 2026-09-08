// Blanking comments and regex literals out of JavaScript source, keeping every
// offset and line number where it was.
//
// Two gates read source text and both need this. Neither handled regex literals
// at first, and both were bitten by it:
//
//   /[",\r\n]/   the quote opens a phantom string, and everything after it in
//                the file is read as string content. Deleting one such regex
//                from metrics.js on 2026-09-08 flipped the parity for the rest
//                of the file and turned forty lines of ordinary code into
//                reported "untranslated labels".
//   /a\/\//      the // is read as a line comment, blanking the rest of the line
//                and hiding the call on it.
//   /[/*]/       the /* is read as a block comment with no terminator, blanking
//                everything to the end of the file.
//
// Telling a regex from a division needs the previous token: a `/` after a value
// divides, a `/` after an operator, a comma, an opening bracket or a keyword
// begins a pattern. That is the whole rule and it is enough for this codebase.

const BEFORE_REGEX = /(?:^|[({[,;:!&|?+\-*%~^=<>]|\breturn|\btypeof|\bcase|\bin|\bof|\bnew|\bdelete|\bvoid|=>)\s*$/;

/**
 * Replace the contents of comments and regex literals with spaces, preserving
 * newlines so that line numbers and character offsets are unchanged.
 *
 * @param {string} text JavaScript source
 * @returns {string} the same length of text with comments and patterns blanked
 */
export function blankCommentsAndRegexes(text) {
  let output = '';
  let index = 0;
  let inString = null;
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (inString) {
      if (character === '\\') { output += '  '; index += 2; continue; }
      if (character === inString) inString = null;
      output += character;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      inString = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') { output += ' '; index += 1; }
      continue;
    }
    if (character === '/' && next === '*') {
      const close = text.indexOf('*/', index + 2);
      // An unterminated block comment runs to the end of the file. Reading the
      // -1 from indexOf as an offset made one caller loop forever and exhaust
      // the heap, so the end of the text is the terminator when there is none.
      const stop = close === -1 ? text.length : close + 2;
      for (; index < stop; index += 1) output += text[index] === '\n' ? '\n' : ' ';
      continue;
    }
    // Only the tail: the longest thing BEFORE_REGEX looks for is a keyword plus
    // whitespace, and testing an end-anchored pattern against the whole
    // accumulated output made this quadratic. On a 250 KB suite it stopped
    // finishing at all.
    if (character === '/' && BEFORE_REGEX.test(output.slice(-24))) {
      // Keep the delimiters so the shape of the line survives. A `/` inside a
      // character class does not close the pattern.
      output += '/';
      index += 1;
      let inClass = false;
      while (index < text.length && text[index] !== '\n') {
        const inner = text[index];
        if (inner === '\\') { output += '  '; index += 2; continue; }
        if (inner === '[') inClass = true;
        else if (inner === ']') inClass = false;
        else if (inner === '/' && !inClass) break;
        output += ' ';
        index += 1;
      }
      if (text[index] === '/') { output += '/'; index += 1; }
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}
