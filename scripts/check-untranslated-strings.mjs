// User-facing text has to come from the catalog, in all three locales.
//
// The app ships English, Spanish and Haitian Creole, and test:i18n proves the
// three catalogs have the same keys. It cannot see a string that never reaches
// a key: a label written straight into a template literal renders in English
// whatever the reader chose, which is how the whole state panel, the storm
// panel's section headings and the About provenance grid stayed English.
//
// This reads what a person sees: the text between tags in an HTML template
// literal, and the value of an attribute a screen reader or a tooltip reads
// out. Anything interpolated is skipped, because t() calls arrive that way.
import { readdir, readFile } from 'node:fs/promises';
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
]);

export function stripComments(text) {
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
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        output += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      output += '  ';
      index += 2;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

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
const ATTRIBUTE = /\b(title|aria-label|placeholder|alt)="([^"`$<>]*)"/g;
// A label chosen by a ternary never touches a tag boundary, so nothing
// positional can see it. The storm panel picked between 'High', 'Medium' and
// 'Low' this way for its rapid-intensification risk.
const TERNARY_LABEL = /[?:]\s*'([^'\n]{3,80})'/g;

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
  if (!/\s/.test(trimmed)) return CAPITALISED.test(trimmed);
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
  const code = stripComments(text);
  const found = [];
  const rendered = markupLines(code);
  const lines = code.split(/\r?\n/);
  lines.forEach((line, index) => {
    const patterns = [
      [TEXT_NODE, 'text', 1],
      [ATTRIBUTE, 'attribute', 2],
      [TERNARY_LABEL, 'label', 1],
    ];
    if (rendered.has(index + 1)) patterns.push([LINE_START, 'text', 1], [LINE_END, 'text', 1]);
    for (const [pattern, kind, group] of patterns) {
      // Only lines that render markup. An error message or a log line is not
      // read by anyone choosing a locale, and `}` opening a run means a line of
      // plain code otherwise looks like a text node.
      if (kind !== 'attribute' && !line.includes('<') && !rendered.has(index + 1)) continue;
      // A ternary label only counts inside something being rendered.
      if (kind === 'label' && !line.includes('${')) continue;
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const value = match[group].trim();
        if (!pattern.global && !looksLikeProse(value)) break;
        // A quoted branch of a ternary in a rendered position is unambiguous, so
        // one lowercase word counts there: the climate summary picked between
        // 'increasing', 'decreasing' and 'stable' that way.
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
          : looksLikeProse(value);
        if (!isProse) continue;
        if (ALLOWED.has(value)) continue;
        found.push({ file, line: index + 1, kind, value });
        if (!pattern.global) break;
        // The boundary this run ended on can open the next one.
        pattern.lastIndex = Math.max(pattern.lastIndex - 2, match.index + 1);
      }
    }
  });
  return found;
}

async function main() {
  const files = (await readdir(sourceDir)).filter(name => name.endsWith('.js') && !SKIP_FILES.has(name)).sort();
  const found = [];
  for (const file of files) {
    found.push(...findUntranslated(file, await readFile(path.join(sourceDir, file), 'utf8')));
  }

  // An allowlist entry that no longer matches anything is a rule about code
  // that has gone, and it would quietly excuse a future string of the same name.
  // One catalog per locale under src/locales/ since 2026-09-08. English is the
  // one this gate anchors on, because it is the source language and the
  // fallback for every key.
  const catalog = await readFile(path.join(sourceDir, 'locales', 'en.js'), 'utf8');
  const sources = await Promise.all(files.map(file => readFile(path.join(sourceDir, file), 'utf8')));
  const stale = [...ALLOWED.keys()].filter(value => !sources.some(source => source.includes(value)));

  if (found.length || stale.length) {
    for (const entry of found) {
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

  console.log(`untranslated ok (${files.length} modules scanned, ${ALLOWED.size} proper nouns allowed)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
