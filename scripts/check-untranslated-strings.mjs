// User-facing text has to come from the catalog, in all three locales.
//
// The app ships English, Spanish and Haitian Creole, and test:i18n proves the
// three catalogs have the same keys. It cannot see a string that never reaches
// a key: a label written straight into a template literal renders in English
// whatever the reader chose, which is how the whole state panel, the storm
// panel's section headings and the About provenance grid stayed English.
//
// Three passes, in three directions, because no one of them sees everything.
//
// 1. Source to reader. The text between tags in an HTML template literal, the
//    value of an attribute a screen reader or a tooltip reads out, a quoted
//    branch of a ternary, a run that fills a whole line with its boundaries on
//    the lines above and below, and a lone lowercase word between two real
//    tags. Anything interpolated is skipped, because t() calls arrive that way.
//    This pass is a heuristic and says so; every filter that keeps a code
//    fragment out also keeps some real label out.
// 2. Catalog to source, which is exact: a value that already has a key must
//    not also be spelled out in a module.
// 3. Literals that reach a text sink without ever sitting in markup, found by
//    parsing. `this.setStatus('Loading…')` is invisible to pass 1 because
//    there is no markup anywhere near it, and eleven of the radar panel's
//    status strings lived there.
//
// What is deliberately NOT reported: prose inside a region marked with a `lang`
// attribute. `src/panel.js` renders the generated storm biography in a
// `<div lang="en">`, which is WCAG 3.1.2 done properly rather than a missing
// translation, so `src/metrics.js` builds that sentence in English on purpose.
import { readdir, readFile } from 'node:fs/promises';
import { blankCommentsAndRegexes as stripComments, findControlBytes } from './js-source.mjs';
import { lineAt, parseModule, patternNames, walk } from './js-ast.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src');

// i18n.js is the catalog. Its values are the translations.
const SKIP_FILES = new Set(['i18n.js']);

// Strings that stay as they are, each with the reason. A proper noun is the
// same in every locale; an abbreviation a reader looks up is not helped by
// being translated.
const ALLOWED = new Map([
  ['Storm Events (NOAA)', "NOAA's dataset name"],
  ['Peak rainfall (WPC)', 'WPC product name, kept with its abbreviation'],
  ['American Red Cross', 'organisation name'],
  ['Iowa State IEM NEXRAD archive', 'archive name'],
  ['Wikipedia', 'the site is called that in every locale, and the link goes to the localized edition'],
  ['python -m http.server 8765', 'a command to type, shown in the boot-failure hint'],
  // The KML document the track export writes. Every downloadable artifact this
  // app produces states its provenance in English, the same as the CSV data
  // dictionary and the Markdown report, so that a file which outlives the
  // session that made it says where it came from in one fixed language.
  ['HurricaneMap export. Source: NOAA HURDAT2.', 'provenance line in the KML export'],
  ['Landfall:', 'placemark label in the KML export'],
  ['Wind:', 'placemark label in the KML export'],
  ['APA citation:', 'label in the KML and text exports'],
  ['BibTeX citation:', 'label in the KML and text exports'],
]);

export { blankCommentsAndRegexes as stripComments } from './js-source.mjs';

// What a reader sees. A run of text is bounded by a tag on one side and a tag
// or an interpolation on the other, because an interpolation is a boundary
// rather than a wall: reading only `>...<` missed `${label} at landfall`,
// `${t('stats.trends')} - 10-year rolling averages`, `Avg forward speed <span>`
// (a trailing space was enough to hide it) and `NEXRAD radar - ${state}
// landfall`, all of which rendered in English whatever the reader chose.
// `=>`, `->` and `!>` are not tags, and an arrow function on a line that also
// holds a `<` comparison otherwise reads as a text node.
const OPEN = String.raw`(?:(?<![=\-!])>|\})`;
const CLOSE = String.raw`(?:<|\$\{)`;
const RUN = String.raw`([^<>{}\`$]*?)`;
const TEXT_NODE = new RegExp(`${OPEN}${RUN}${CLOSE}`, 'g');
// Inside a multi-line template the boundary is often on the line before or the
// line after, so a line that is already known to be rendering markup also
// counts from its own start and to its own end. `NEXRAD radar - ${state}` opens
// on the previous line's `</span>` and was invisible without this.
const LINE_START = new RegExp(`^${RUN}${CLOSE}`);
const LINE_END = new RegExp(`${OPEN}([^<>{}\`$]*)$`);
// A run can also fill a whole line, with its boundaries on the lines above and
// below it. `Loading NOAA Storm Events summary...` sits alone between a `<div>`
// on the previous line and a `</div>` on the next, so neither edge pattern nor
// TEXT_NODE could see it: all three need a boundary on the line itself.
// A JS operator rules the line out: `? lf.name` and `: t(...)` are branches of
// a ternary that happen to carry no boundary, and they read as prose to
// looksLikeProse because "name" is an ordinary lowercase word. Commas stay
// allowed, since real sentences use them.
const LINE_WHOLE = new RegExp(`^([^<>{}\`$?:()=;]+)$`);
const ATTRIBUTE = /\b(title|aria-label|placeholder|alt)="([^"`$<>]*)"/g;
// A label chosen by a ternary never touches a tag boundary, so nothing
// positional can see it. The storm panel picked between 'High', 'Medium' and
// 'Low' this way for its rapid-intensification risk.
const TERNARY_LABEL = /[?:]\s*'([^'\n]{3,80})'/g;
// looksLikeProse asks a lone token to be a capitalised word, because `}` opens
// a run and most single tokens arriving that way are code. Between two real
// angle brackets there is no such doubt: `>resolving…<` is text a reader sees,
// whatever its case. Four letters minimum keeps `kt`, `mph` and `mb` out.
const LONE_WORD_NODE = /(?<![=\-!])>\s*([a-z][a-z'-]{3,})[.…!?]*\s*</g;

// `<!-- US landfalls -->` labels the path below it for whoever reads the source.
// Nobody sees it, and reporting it sends someone to translate a comment.
export function stripHtmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '));
}

const WORD = /[A-Za-z][A-Za-z'-]*/g;
const CAPITALISED = /^[A-Z][a-z]{2,}$/;
// Markup, a URL, a class list or a format string is not prose. Anything with
// one of these in it is machinery that happens to sit between two tags.
// A quote next to a bracket is a call, not a sentence: `t('stats.trend')` sits
// between the `>` of one comparison and the `<` of the next.
const NOT_PROSE = /[/\\=;{}#@|~^*_[\]]|\(["']|["']\)|\.(?:js|css|json|png|svg|txt)\b/;

// `}` opens a run as well as `>`, because an interpolation ends the text before
// it. That also means a `}` closing a block can open a run of plain code, so
// two shapes are ruled out: a property access, and a single token that is not
// simply a capitalised word.
const IDENTIFIER = /^\(?[A-Za-z_$][\w$]*\.[\w$(]/;

export function looksLikeProse(value) {
  const trimmed = value.trim();
  if (!trimmed || NOT_PROSE.test(trimmed) || IDENTIFIER.test(trimmed)) return false;
  const words = trimmed.match(WORD) || [];
  // One capitalised word is a label: the About provenance grid labels its cells
  // "Coverage", "Records" and "Generated", one word each. Any other lone token
  // is an id, a hex digest or a variable.
  // Trailing punctuation does not stop a label being a label. `Coverage:` in
  // the statistics summary read as code because the colon failed CAPITALISED,
  // and it rendered in English inside an otherwise Spanish panel.
  const bare = trimmed.replace(/[.:;,!?…]+$/, "");
  if (!/\s/.test(trimmed)) return CAPITALISED.test(bare);
  if (words.length === 1) return CAPITALISED.test(words[0]);
  // Otherwise two words, at least one of them an ordinary lowercase word, which
  // is what separates "Avg forward speed" and "at landfall" from "ACE" sitting
  // beside a number, or a units run like "kt" and "mph".
  return words.length >= 2 && words.some(word => /^[a-z]{3,}$/.test(word));
}

// Which lines are inside a template literal that renders markup. A single line
// of a multi-line innerHTML often carries no angle bracket of its own -- the
// radar panel's title line is `NEXRAD radar - ${state} landfall` -- so judging
// each line on its own text alone skipped them. Backticks are paired in order,
// which over-includes when one literal nests inside another's interpolation;
// that direction is safe, since every candidate still has to read as prose.
export function markupLines(code) {
  const inside = new Set();
  const ticks = [];
  let quote = null;
  let line = 1;
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (character === '\n') { line += 1; continue; }
    if (character === '\\') { index += 1; continue; }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '`') ticks.push({ index, line });
  }
  for (let pair = 0; pair + 1 < ticks.length; pair += 2) {
    const open = ticks[pair];
    const close = ticks[pair + 1];
    if (!code.slice(open.index, close.index).includes('<')) continue;
    for (let mark = open.line; mark <= close.line; mark += 1) inside.add(mark);
  }
  return inside;
}

export function findUntranslated(file, text) {
  const code = stripHtmlComments(stripComments(text));
  const found = [];
  const rendered = markupLines(code);
  const lines = code.split(/\r?\n/);
  lines.forEach((line, index) => {
    const patterns = [
      [TEXT_NODE, 'text', 1],
      [ATTRIBUTE, 'attribute', 2],
      [TERNARY_LABEL, 'label', 1],
    ];
    if (rendered.has(index + 1)) {
      patterns.push([LINE_START, 'text', 1], [LINE_END, 'text', 1], [LINE_WHOLE, 'text', 1]);
    }
    patterns.push([LONE_WORD_NODE, 'word', 1]);
    for (const [pattern, kind, group] of patterns) {
      // Only lines that render markup. An error message or a log line is not
      // read by anyone choosing a locale, and `}` opening a run means a line of
      // plain code otherwise looks like a text node.
      if (kind !== 'attribute' && !line.includes('<') && !rendered.has(index + 1)) continue;
      // A lone word only counts between two real tags, which is what its own
      // pattern already requires, so it needs no line-level gate beyond that.
      // A ternary label only counts inside something being rendered.
      if (kind === 'label' && !line.includes('${')) continue;
      // A non-global regex does not advance lastIndex, so `exec` in a loop
      // returns the same match forever. That is only survivable while every
      // path out of the body breaks; adding an allowlist check that continued
      // instead hung the whole gate on the first allowlisted string it met.
      // The two line-edge patterns match once by construction, so they are read
      // once, outside the loop.
      const candidates = [];
      if (pattern.global) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          candidates.push(match);
          // The boundary this run ended on can open the next one.
          pattern.lastIndex = Math.max(pattern.lastIndex - 2, match.index + 1);
        }
      } else {
        const match = pattern.exec(line);
        if (match) candidates.push(match);
      }

      for (const match of candidates) {
        const value = match[group].trim();
        // A quoted branch of a ternary in a rendered position is unambiguous
        // enough that one lowercase word counts, so long as it is part of a
        // phrase: the climate summary picked between 'increasing', 'decreasing'
        // and 'stable' that way. A bare lowercase word is markup, since the
        // same shape chooses 'checked', 'disabled', 'selected' and 'ascending'.
        const isProse = kind === 'label'
          ? (/\s/.test(value) || CAPITALISED.test(value))
            && /[A-Za-z]{3,}/.test(value)
            && !NOT_PROSE.test(value)
            && !IDENTIFIER.test(value)
          : kind === 'word'
            ? !NOT_PROSE.test(value) && !IDENTIFIER.test(value)
            : looksLikeProse(value);
        if (!isProse) continue;
        if (ALLOWED.has(value)) continue;
        found.push({ file, line: index + 1, kind, value });
      }
    }
  });
  return found;
}

// The other direction, and the exact one.
//
// The scan above is a heuristic: it has to guess which runs of text a reader
// sees, and every filter that keeps a code fragment out also keeps some real
// label out. Twenty of the eighty-two labels moved into the catalog on
// 2026-09-08 were invisible to it, including the one the audit had named:
// "U.S. landfalls (chronological)" was read as a property access, because
// `U.S.` has the shape of one.
//
// A string that is already in the catalog needs no guessing. If its English
// value turns up as a literal in a module, somebody has written the label back
// into the markup, and that is exactly the regression the heuristic was meant
// to catch and could not.
// Is this occurrence the entire text node or the entire quoted value, rather
// than a word inside something longer? Anything else is a coincidence for a
// short string: `class="compare-row"` contains "compare", and a sentence
// contains its own words.
function fillsItsSlot(source, at, length, isUiSink) {
  let before = at - 1;
  while (before >= 0 && /\s/.test(source[before])) before -= 1;
  let after = at + length;
  while (after < source.length && /\s/.test(source[after])) after += 1;
  const opening = source[before];
  const closing = source[after];
  if (opening === '>' && closing === '<') return true;
  // A quoted short string only counts where the line is assigning text to the
  // screen. `feed.state === 'stale'`, `' active'` in a class list and the
  // `'unavailable'` half of a t() key are all whole quoted values, and all
  // three are code.
  return isUiSink && Boolean(opening) && opening === closing && /['"`]/.test(opening);
}

export const covered = new Set();
export const skipped = new Set();

export function findCatalogEchoes(file, rawSource, catalogValues) {
  const source = stripHtmlComments(rawSource);
  const found = [];
  const rendered = markupLines(source);
  const lines = source.split(/\r?\n/);
  // Where a reader meets a string: inside markup, or assigned to one of the
  // properties that put text on screen. A lookup table that maps an English
  // constant from an upstream API to a key is not any of those, and neither is
  // a filename or a citation, which is why matching a catalog value anywhere in
  // the file reported seventy things and meant none of them.
  // Leaflet puts text on screen through its own calls, and a tooltip is as
  // visible as a heading: `bindTooltip('Genesis')` slipped past a list that
  // knew only about DOM properties, which is how the map's own labels stayed
  // outside a check written to find exactly that.
  const UI_SINK = /\.(?:title|textContent|innerText|innerHTML|placeholder|ariaLabel)\s*=|setAttribute\(\s*['"](?:title|aria-label|placeholder|alt)['"]|\b(?:bindTooltip|bindPopup|setTooltipContent|setPopupContent|announceToLiveRegion)\s*\(/;
  for (const [key, value] of catalogValues) {
    // Placeholders split a value into fragments; the longest carries the most
    // sentence. A long fragment is unmistakable wherever it turns up, so a
    // substring match is enough. A short one is not: "Compare", "Timeline" and
    // "Settings" are ordinary English words and ordinary identifiers, and
    // skipping them left 311 of 1052 catalog values, 30% of the catalog and
    // most of the button labels, outside the only check here that does not
    // guess. They are tested too, but only where the whole text node or the
    // whole attribute is the string, which a class name or a longer sentence
    // containing the word can never be.
    const fragment = value.split(/\{\d+\}/).map(part => part.trim()).sort((a, b) => b.length - a.length)[0] || '';
    if (fragment.length < 3) { skipped.add(key); continue; }
    covered.add(key);
    const wholeValueOnly = fragment.length < 12 || !/\s/.test(fragment);
    if (ALLOWED.has(fragment)) continue;
    let from = 0;
    while (true) {
      const at = source.indexOf(fragment, from);
      if (at === -1) break;
      from = at + fragment.length;
      const line = source.slice(0, at).split(/\r?\n/).length;
      const text = lines[line - 1] || '';
      if (!rendered.has(line) && !text.includes('<') && !UI_SINK.test(text)) continue;
      if (wholeValueOnly && !fillsItsSlot(source, at, fragment.length, UI_SINK.test(text))) continue;
      found.push({
        file,
        line,
        kind: 'echo',
        value: `${fragment} (already in the catalog as ${key})`,
      });
      break;
    }
  }
  return found;
}

// The third direction: a literal that reaches a text sink without ever sitting
// in markup.
//
// The scan above reads runs of text between tags, so it cannot see
// `this.setStatus('Loading…')`. Six of the radar panel's status strings lived
// there. Naming `setStatus` would be a gate that can be renamed around, so this
// finds the sinks by what they do: a function in this file that writes one of
// its own parameters to `.textContent` or `.innerHTML` IS a text sink, whatever
// it is called, and a prose literal handed to one is a string a reader sees.
//
// Single-file on purpose. A cross-module call graph would catch more and would
// also have to be right about re-exports and aliasing; every sink found so far
// is defined beside its callers.
const TEXT_PROPERTIES = new Set(['textContent', 'innerHTML', 'innerText']);

function writesToTextSink(node) {
  return node?.type === 'MemberExpression'
    && !node.computed
    && TEXT_PROPERTIES.has(node.property?.name);
}

/** Names in this module whose body writes a parameter straight to a text sink. */
export function textSinkNames(tree) {
  const sinks = new Set();
  walk(tree, node => {
    const isFunction = node.type === 'FunctionDeclaration'
      || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression'
      || node.type === 'MethodDefinition'
      || node.type === 'Property';
    if (!isFunction) return;
    const fn = node.type === 'MethodDefinition' || node.type === 'Property' ? node.value : node;
    if (!fn || !Array.isArray(fn.params)) return;
    const parameters = new Set();
    for (const parameter of fn.params) patternNames(parameter, []).forEach(name => parameters.add(name));
    if (!parameters.size) return;
    let writes = false;
    walk(fn.body, inner => {
      if (inner.type !== 'AssignmentExpression') return;
      if (!writesToTextSink(inner.left)) return;
      if (inner.right?.type === 'Identifier' && parameters.has(inner.right.name)) writes = true;
    });
    if (!writes) return;
    const name = node.type === 'FunctionDeclaration' ? node.id?.name
      : node.type === 'MethodDefinition' || node.type === 'Property' ? node.key?.name
        : null;
    if (name) sinks.add(name);
  });
  return sinks;
}

/** Every static string a node contributes, so a template's literal halves count. */
function staticStrings(node) {
  if (!node) return [];
  if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : [];
  if (node.type === 'TemplateLiteral') return node.quasis.map(quasi => quasi.value.cooked || '');
  return [];
}

export function findTextSinkLiterals(file, source) {
  let tree;
  try {
    tree = parseModule(source);
  } catch {
    // A file this gate cannot parse is reported by check:syntax, not here.
    return [];
  }
  const sinks = textSinkNames(tree);
  const found = [];
  const report = (node, value) => {
    const text = String(value).trim();
    // A static half of a markup template is markup, and the text-node scan
    // above already reads those. Reporting them here restated every heading in
    // the app as an untranslated string.
    if (text.includes("<") || text.includes(">")) return;
    if (!text || !looksLikeProse(text) || ALLOWED.has(text)) return;
    found.push({ file, line: lineAt(source, node.start), kind: 'sink', value: text });
  };
  walk(tree, node => {
    if (node.type === 'AssignmentExpression' && writesToTextSink(node.left)) {
      for (const value of staticStrings(node.right)) report(node, value);
      return;
    }
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    const name = callee?.type === 'Identifier' ? callee.name
      : callee?.type === 'MemberExpression' && !callee.computed ? callee.property?.name
        : null;
    if (!name || !sinks.has(name)) return;
    for (const argument of node.arguments) {
      for (const value of staticStrings(argument)) report(node, value);
    }
  });
  return found;
}

async function main() {
  const files = (await readdir(sourceDir)).filter(name => name.endsWith('.js') && !SKIP_FILES.has(name)).sort();
  // Read the catalog first: the echo check needs its English values, and the
  // anchor check below needs the file anyway.
  const catalog = await readFile(path.join(sourceDir, 'locales', 'en.js'), 'utf8');
  const catalogValues = [...catalog.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',$/gm)]
    .map(match => [match[1], match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')]);
  if (catalogValues.length < 500) {
    console.error(`untranslated: only ${catalogValues.length} catalog values were readable; the echo check would prove nothing`);
    process.exit(1);
  }
  const found = [];
  const seen = new Set();
  for (const file of files) {
    const source = await readFile(path.join(sourceDir, file), 'utf8');
    found.push(...findUntranslated(file, source));
    for (const stray of findControlBytes(source)) {
      found.push({
        file,
        line: stray.line,
        kind: 'control',
        value: `a ${stray.code} control character at column ${stray.column}, which is invisible here and matches nothing in a regex`,
      });
    }
    found.push(...findCatalogEchoes(file, stripComments(source), catalogValues));
    found.push(...findTextSinkLiterals(file, source));
  }

  // An allowlist entry that no longer matches anything is a rule about code
  // that has gone, and it would quietly excuse a future string of the same name.
  // One catalog per locale under src/locales/ since 2026-09-08. English is the
  // one this gate anchors on, because it is the source language and the
  // fallback for every key.
  const sources = await Promise.all(files.map(file => readFile(path.join(sourceDir, file), 'utf8')));
  const stale = [...ALLOWED.keys()].filter(value => !sources.some(source => source.includes(value)));

  const unique = found.filter((entry) => {
    const key = `${entry.file}:${entry.line}:${entry.kind}:${entry.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length || stale.length) {
    for (const entry of unique) {
      if (entry.kind === 'control') {
        console.error(`untranslated: ${entry.file}:${entry.line} contains ${entry.value}; delete the character`);
        continue;
      }
      if (entry.kind === 'sink') {
        console.error(`untranslated: ${entry.file}:${entry.line} hands "${entry.value}" to something that writes it into the page; move it into src/i18n.js and call t()`);
        continue;
      }
      console.error(`untranslated: ${entry.file}:${entry.line} renders "${entry.value}" as a literal; move it into src/i18n.js and call t()`);
    }
    for (const value of stale) {
      console.error(`untranslated: the allowlist still excuses "${value}", which no module renders any more; remove the entry`);
    }
    process.exit(1);
  }

  // The catalog has to actually be there, or an empty src/ would pass. This
  // anchor is a key that exists; the first one written here was not, so the
  // gate reported the catalog missing on a perfectly good tree.
  if (!/'header\.title':/.test(catalog)) {
    console.error('untranslated: src/locales/en.js does not look like the catalog any more');
    process.exit(1);
  }

  // How many of them it actually looked at, not just how many exist. The
  // filters that keep code fragments out were silently exempting 30% of the
  // catalog, and a line reading "1052 catalog values" gave no way to notice.
  console.log(
    `untranslated ok (${files.length} modules scanned, ${covered.size} of ${catalogValues.length} catalog values `
    + `held to their keys, ${skipped.size} too short to test, ${ALLOWED.size} proper nouns allowed)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
