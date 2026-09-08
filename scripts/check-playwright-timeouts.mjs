// `page.waitForFunction(pageFunction, arg, options)` takes the argument second
// and the options third.
//
// Written with two arguments, `waitForFunction(fn, {timeout: 1500})` hands the
// options object to the browser as the page function's argument and leaves the
// timeout at Playwright's thirty-second default. Most of the time that only
// makes a failure slower to report. For a bounded probe it is worse than that:
// an assertion meaning "this must not happen within a second and a half" quietly
// becomes "within thirty", and on 2026-09-08 one of them ran twenty-two seconds
// after the window it was measuring had closed, reporting nothing wrong whether
// or not the code under it was broken.
//
// This reads the call's own argument list rather than a line, because these
// calls routinely span five or six lines.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTORIES = ['scripts', 'tests'];
const OPTION_KEYS = /\b(timeout|polling)\s*:/;

// The arguments of one call, split on top-level commas. Strings, template
// literals, comments and nested brackets are all skipped, so a comma inside an
// object, an arrow function body or a message string does not split anything.
export function callArguments(source, openIndex) {
  const args = [];
  let depth = 0;
  let current = '';
  let quote = null;
  let index = openIndex + 1;
  for (; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === '\\') { current += source[index + 1] ?? ''; index += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2) + 1;
      continue;
    }
    if ('([{'.includes(character)) { depth += 1; current += character; continue; }
    if (')]}'.includes(character)) {
      if (character === ')' && depth === 0) return { args: [...args, current], end: index };
      depth -= 1;
      current += character;
      continue;
    }
    if (character === ',' && depth === 0) { args.push(current); current = ''; continue; }
    current += character;
  }
  return { args: [...args, current], end: index };
}

// Comments are blanked rather than removed, so every offset still points at the
// same character. Without this the gate reported on the example in its own
// header comment, which is a call nobody makes.
export function blankComments(source) {
  let out = '';
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      out += character;
      if (character === '\\') { out += source[index + 1] ?? ''; index += 1; continue; }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; out += character; continue; }
    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') { out += ' '; index += 1; }
      out += '\n';
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);
      const stop = close === -1 ? source.length : close + 2;
      for (; index < stop; index += 1) out += source[index] === '\n' ? '\n' : ' ';
      index -= 1;
      continue;
    }
    out += character;
  }
  return out;
}

export function findMisplacedOptions(file, rawSource) {
  const source = blankComments(rawSource);
  const found = [];
  const call = /\bwaitForFunction\s*\(/g;
  let match;
  while ((match = call.exec(source)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const { args } = callArguments(source, openIndex);
    if (args.length < 2) continue;
    const second = args[1].trim();
    // An options object in the argument position. A genuine argument that
    // happens to be an object is fine unless it carries an option key, which is
    // what makes it unambiguous.
    if (!second.startsWith('{') || !OPTION_KEYS.test(second)) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    found.push({ file, line, second: second.replace(/\s+/g, ' ').slice(0, 60) });
  }
  return found;
}

async function main() {
  const found = [];
  let scanned = 0;
  for (const directory of DIRECTORIES) {
    const entries = await readdir(path.join(root, directory));
    for (const name of entries.filter(entry => entry.endsWith('.mjs')).sort()) {
      const relative = `${directory}/${name}`;
      const source = await readFile(path.join(root, relative), 'utf8');
      if (!source.includes('waitForFunction')) continue;
      scanned += 1;
      found.push(...findMisplacedOptions(relative, source));
    }
  }

  if (found.length) {
    for (const entry of found) {
      console.error(
        `playwright timeouts: ${entry.file}:${entry.line} passes ${entry.second} where the page function's argument goes, `
        + 'so the timeout is ignored; pass null as the second argument',
      );
    }
    process.exit(1);
  }

  console.log(`playwright timeouts ok (${scanned} browser suites scanned)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
