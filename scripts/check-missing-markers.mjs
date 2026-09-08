// One marker for a value that was never recorded.
//
// The same absent value used to render four ways at once: an em dash in the
// storm stat grid, "N/A" in the impact rows and the Markdown report,
// "Unavailable" in About, and a plain "0" from a formatter in storm-events that
// coerced null with Number(). A reader could not tell "not recorded" from "not
// loaded" from a real zero, which are three different statements about the
// world.
//
// MISSING_METRIC in src/metric-presenters.js is the only place the glyph is
// written. A surface that means "this failed to load" says so in words through
// t('metric.notLoaded'), which is localized; the dash is not, deliberately,
// because reports and exports have to read the same whoever generated them.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src');

// Where each marker is allowed to be spelled out, and why.
const OWNERS = new Map([
  ['metric-presenters.js', 'declares MISSING_METRIC, the one marker'],
  ['i18n.js', 'holds the localized "not loaded" wording for all three locales'],
]);

// Comment text is prose about the rule, not a marker being rendered.
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

const MARKERS = [
  { name: 'the em dash marker', pattern: /(['"`])\s*—\s*\1/g, instead: 'import MISSING_METRIC from ./metric-presenters.js' },
  { name: '"N/A"', pattern: /(['"`])N\/A\1/g, instead: 'MISSING_METRIC, or t(\'metric.notLoaded\') when the value failed to load' },
  // Case-sensitive on purpose. Lowercase 'unavailable' is an internal state
  // token in the optional-feed and wind-context state machines, compared
  // against and never rendered; the capitalised word is the one a reader sees.
  { name: '"Unavailable"', pattern: /(['"`])Unavailable\1/g, instead: "t('metric.notLoaded')" },
];

export function findMarkerOffenders(file, text) {
  const code = stripComments(text);
  const offenders = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const marker of MARKERS) {
      marker.pattern.lastIndex = 0;
      if (marker.pattern.test(line)) {
        offenders.push({ file, line: index + 1, marker: marker.name, instead: marker.instead, text: line.trim().slice(0, 90) });
      }
    }
  });
  return offenders;
}

async function main() {
  const files = (await readdir(sourceDir)).filter(name => name.endsWith('.js')).sort();
  if (!files.length) {
    console.error('missing markers: no modules found in src/');
    process.exit(1);
  }

  const offenders = [];
  let scanned = 0;
  for (const file of files) {
    if (OWNERS.has(file)) continue;
    scanned += 1;
    offenders.push(...findMarkerOffenders(file, await readFile(path.join(sourceDir, file), 'utf8')));
  }

  // The owners have to still hold what everything else defers to, or this gate
  // would pass a codebase that had simply deleted the marker.
  const presenters = await readFile(path.join(sourceDir, 'metric-presenters.js'), 'utf8');
  if (!/export const MISSING_METRIC = '—';/.test(presenters)) {
    offenders.push({ file: 'metric-presenters.js', line: 0, marker: 'MISSING_METRIC', instead: 'declare it here; every other module reads it from this file' });
  }
  const catalog = await readFile(path.join(sourceDir, 'i18n.js'), 'utf8');
  const localized = [...catalog.matchAll(/'metric\.notLoaded':/g)].length;
  if (localized !== 3) {
    offenders.push({ file: 'i18n.js', line: 0, marker: "metric.notLoaded", instead: `declare it in all three locales; found ${localized}` });
  }

  if (offenders.length) {
    for (const offender of offenders) {
      console.error(`missing markers: ${offender.file}:${offender.line} writes ${offender.marker} directly; use ${offender.instead}${offender.text ? ` (${offender.text})` : ''}`);
    }
    process.exit(1);
  }

  console.log(`missing markers ok (${scanned} modules scanned, one marker in metric-presenters.js, "not loaded" localized in 3 locales)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
