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

// A phrase between tags, or a single capitalised word that is the whole text
// node. The lone word matters: the About provenance grid labels its cells
// "Coverage", "Records" and "Generated", one word each, and a phrase-only rule
// walked straight past all three. Nothing but rendered text sits between a
// closing and an opening angle bracket, so a lone word there is a label.
const TEXT_NODE = />([A-Z][a-z]+(?:[ ](?:[A-Za-z()][A-Za-z().,'-]*))*)</g;
const ATTRIBUTE = /\b(title|aria-label|placeholder|alt)="([A-Z][a-z]+(?:[ ](?:[A-Za-z()][A-Za-z().,'-]*))+)"/g;

export function findUntranslated(file, text) {
  const code = stripComments(text);
  const found = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [pattern, kind] of [[TEXT_NODE, 'text'], [ATTRIBUTE, 'attribute']]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const value = (kind === 'attribute' ? match[2] : match[1]).trim();
        if (ALLOWED.has(value)) continue;
        found.push({ file, line: index + 1, kind, value });
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
  const catalog = await readFile(path.join(sourceDir, 'i18n.js'), 'utf8');
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

  // The catalog has to actually be there, or an empty src/ would pass.
  if (!/'app\.title':/.test(catalog)) {
    console.error('untranslated: src/i18n.js does not look like the catalog any more');
    process.exit(1);
  }

  console.log(`untranslated ok (${files.length} modules scanned, ${ALLOWED.size} proper nouns allowed)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
