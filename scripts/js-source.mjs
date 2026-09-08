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

// The token before a `/`, with trailing whitespace already trimmed off by the
// caller. There is deliberately no `^` alternative here: anchoring to a fixed
// window made `^\s*$` match any all-whitespace window, and a blanked block
// comment produces exactly that, so `total /* a long comment */ / count` read
// its division as the start of a pattern and blanked the rest of the line.
const BEFORE_REGEX = /(?:[({[,;:!&|?+\-*%~^=<>]|\breturn|\btypeof|\bcase|\bin|\bof|\bnew|\bdelete|\bvoid|=>)$/;

// Is a `/` at this point the start of a pattern or a division? Scan back over
// whitespace first, because the whitespace may be a comment this pass already
// blanked, and only then look at the token. Nothing but whitespace behind it
// means the start of the file, where a `/` can only begin a pattern.
function startsARegex(output) {
  let end = output.length;
  while (end > 0 && /\s/.test(output[end - 1])) end -= 1;
  if (end === 0) return true;
  const tail = output.slice(Math.max(0, end - 24), end);
  // `n++ / total` is a division, but `+` is in the operator set, so the tail
  // has to be checked for the increment forms before the single characters.
  if (/(?:\+\+|--)$/.test(tail)) return false;
  return BEFORE_REGEX.test(tail);
}

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
      // A backslash-newline continuation inside a string is two characters, and
      // replacing both with spaces deleted the newline, shifting every line
      // number after it by one. Both consumers report line numbers.
      if (character === '\\') {
        const escaped = text[index + 1] ?? '';
        output += escaped === '\n' || escaped === '\r' ? ` ${escaped}` : '  ';
        index += 2;
        continue;
      }
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
    // Only the tail: the longest thing BEFORE_REGEX looks for is a keyword, and
    // testing an end-anchored pattern against the whole accumulated output made
    // this quadratic. On a 250 KB suite it stopped finishing at all.
    if (character === '/' && startsARegex(output)) {
      // Keep the delimiters so the shape of the line survives. A `/` inside a
      // character class does not close the pattern.
      output += '/';
      index += 1;
      let inClass = false;
      while (index < text.length && text[index] !== '\n') {
        const inner = text[index];
        if (inner === '\\') {
          const escaped = text[index + 1] ?? '';
          output += escaped === '\n' || escaped === '\r' ? ` ${escaped}` : '  ';
          index += 2;
          continue;
        }
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

// A control character in source is invisible in every editor and in most diffs,
// and inside a regex literal it matches nothing, so the assertion around it can
// never fail. Two got in the same way: a `\b` typed into a shell heredoc
// reached Python as an escape, and Python wrote chr(8). One had disabled a
// smoke assertion about unreported storm intensity; the other silently removed
// Leaflet's tooltip calls from the list of places a reader meets text. Tab,
// newline and carriage return are ordinary; nothing else is.
// Regression fixtures, run on import the way the colour matrices in
// check-track-contrast.mjs are. Every one of these was wrong at some point, and
// each failure is silent: the blanked text still looks like source, so the gate
// downstream reports a finding in the wrong place or misses one entirely.
{
  const cases = [
    // A division whose left side ends in whitespace, because the whitespace is
    // a comment this pass just blanked. Anchoring the token test to a fixed
    // window let `^\s*$` match, and the rest of the line disappeared.
    ['const r = total /* twenty-four-plus characters of prose here */ / count;', '/ count;'],
    // `+` is an operator, but `++` is not one a pattern can follow.
    ['let n = 0; const r = n++ / total;', '/ total;'],
    ['let n = 0; const r = n-- / total;', '/ total;'],
    // Still a pattern where a pattern is legal.
    ['const x = /* note */ /ab+c/.test(y);', '/    /.test(y);'],
    ['let a; a += /ab+c/.source;', '/    /.source;'],
  ];
  for (const [input, ending] of cases) {
    const output = blankCommentsAndRegexes(input);
    if (output.length !== input.length) {
      throw new Error(`js-source regression: blanking changed the length of ${JSON.stringify(input)}`);
    }
    if (!output.endsWith(ending)) {
      throw new Error(`js-source regression: ${JSON.stringify(input)} blanked to ${JSON.stringify(output)}, wanted it to end ${JSON.stringify(ending)}`);
    }
  }
  // A backslash-newline continuation is two characters; replacing both with
  // spaces deleted the newline and shifted every line number after it.
  const continuation = "const s = 'abc\\\ndef';\nconst after = 1;\n";
  const blanked = blankCommentsAndRegexes(continuation);
  if (blanked.split('\n').length !== continuation.split('\n').length) {
    throw new Error('js-source regression: a line continuation inside a string lost its newline');
  }
}

export function findControlBytes(text) {
  const found = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g)) {
      found.push({
        line: index + 1,
        column: match.index + 1,
        code: `U+${match[0].codePointAt(0).toString(16).padStart(4, '0').toUpperCase()}`,
      });
    }
  });
  return found;
}
