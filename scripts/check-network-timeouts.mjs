import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

// src/network.js defines the deadline. Its own transport seam is the thing
// every other module borrows, so it is the one place a raw fetch reference is
// the point rather than a hole.
const DEADLINE_HELPER = 'network.js';

// Two shapes of injectable transport are in use, and only one of them is safe
// on its own:
//
//   fetchWithTimeout(url, init, ms, fetchImpl)  the deadline wraps the seam
//   fetchImpl(url, init)                        the seam IS the request
//
// The second spells no fetch( anywhere, so a scan for bare calls never saw it.
// Four paths reached the network with no deadline that way: the spatial
// search's five parallel NHC GIS queries, the two diagnostics bundle reads, and
// the two bulk downloads, where one stalled response left "Saving radar pack
// N/M" on screen for ever with the button disabled.
//
// Policing the seam by name does not work. A version of this gate that keyed on
// `fetchImpl` was walked past seven ways: a parameter called something else,
// globalThis["fetch"], a destructured rename, a default split across two lines,
// an assignment rather than a default, an `||` fallback, and one safe seam in a
// file excusing every other seam beside it.
//
// So the load-bearing rule is not about the seam at all: outside the deadline
// helper, the identifier `fetch` may not be MENTIONED. Not called, not bound,
// not destructured, not reached through a bracket. Longer names are untouched,
// because the word boundary makes fetchWithTimeout, fetchImpl and fetchJson
// invisible to it. Nothing in src/ can then get hold of a raw fetch to keep or
// to hand on, and that is what closes the injected-transport hole for good: a
// seam can only ever receive something some module in this directory obtained.
const BARE_FETCH_CALL = /\bfetch\s*\(/g;
const FETCH_MENTION = /\bfetch\b/g;
// Read with strings intact, because this is the one place the identifier lives
// inside one.
const BRACKET_FETCH = /(?:globalThis|self|window|this)\s*\[\s*['"`]fetch['"`]\s*\]/;
// The repository's own convention for an injected transport. A narrower second
// check, and the one that catches a seam defaulted to a wrapper of its own.
const SEAM_CALL = /\bfetchImpl\s*(?:\?\.)?\(/;
const SEAM_DEFAULT = /\bfetchImpl\s*=\s*([A-Za-z_$][\w$.]*)/g;

// Comments always go, because a comment naming fetch is prose. A `//` or a `/*`
// inside a string is not a comment, though: stripping naively deleted real code
// once, when a protocol-relative URL check ate the bare fetch( on its own line,
// and a string holding `/*` ate everything to the next `*/`. Strings are
// therefore skipped whole. Whether their contents survive depends on what is
// being looked for: the mention scan blanks them, or "Failed to fetch" in an
// error message would read as a reference, and the bracket scan keeps them.
export function stripComments(text, { keepStrings = false } = {}) {
  let out = '';
  let index = 0;
  const source = String(text || '');
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === quote) { index += 1; break; }
        index += 1;
      }
      out += keepStrings ? source.slice(start, index) : `${quote}${quote}`;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

export function findTransportOffenders(file, text) {
  const offenders = [];
  const code = stripComments(text);
  const withStrings = stripComments(text, { keepStrings: true });

  const calls = code.match(BARE_FETCH_CALL) || [];
  if (calls.length) offenders.push(`${file}: ${calls.length} bare fetch call(s)`);
  const mentions = (code.match(FETCH_MENTION) || []).length - calls.length;
  if (mentions > 0) {
    offenders.push(
      `${file}: names the raw fetch ${mentions} time(s) without calling it, which is how a transport `
      + 'with no deadline gets bound, passed or destructured. Use fetchWithTimeout.',
    );
  }
  if (BRACKET_FETCH.test(withStrings)) {
    offenders.push(`${file}: reaches the raw fetch through a bracket, which carries no deadline`);
  }

  // A module that calls fetchImpl() directly has to default every declaration
  // of it to the deadline helper. Per declaration, not per file: one safe seam
  // used to excuse every other seam beside it.
  if (SEAM_CALL.test(code)) {
    SEAM_DEFAULT.lastIndex = 0;
    const declarations = [...code.matchAll(SEAM_DEFAULT)].map(match => match[1]);
    if (!declarations.length) {
      offenders.push(`${file}: calls fetchImpl() but declares no default, so a caller decides whether it has a deadline`);
    }
    for (const value of declarations) {
      if (value === 'fetchWithTimeout') continue;
      offenders.push(`${file}: calls fetchImpl() with the default "${value}", which carries no deadline (use fetchWithTimeout)`);
    }
  }
  return offenders;
}

// What this check does NOT cover, stated rather than left for the next reader
// to discover: a module with one seam defaulted to fetchWithTimeout and a
// second `{ fetchImpl }` beside it with no default passes. Telling that binding
// apart from a pass-through in an object literal, which is the shape
// src/nhc-summary.js legitimately uses, needs a parser rather than a regex, and
// a walk over bracket depth reported the pass-through as a violation.
//
// The residual risk is bounded by the mention rule above, which is why the
// mention rule is the one that carries the weight: nothing in src/ can obtain a
// raw fetch, so an undefaulted seam can only ever be handed a transport that
// already carries a deadline. ROADMAP.md tracks the parser-based version.

async function main() {
  const files = (await readdir(srcDir)).filter(file => file.endsWith('.js'));
  const offenders = [];
  const fetchModules = [];
  const seamModules = [];

  for (const file of files) {
    const text = await readFile(path.join(srcDir, file), 'utf8');
    const code = stripComments(text);
    if (code.includes('fetchWithTimeout(')) fetchModules.push(file);
    if (SEAM_CALL.test(code)) seamModules.push(file);
    if (file === DEADLINE_HELPER) continue;
    offenders.push(...findTransportOffenders(`src/${file}`, text));
  }

  if (offenders.length) {
    for (const offender of offenders) console.error(`network timeout guard: ${offender}`);
    process.exit(1);
  }
  if (!fetchModules.length) {
    console.error('network timeout guard: no module uses the shared fetch helper');
    process.exit(1);
  }
  if (!seamModules.length) {
    console.error('network timeout guard: the injectable-transport rule matched nothing, so it is not being enforced');
    process.exit(1);
  }
  console.log(
    `network timeout guard ok (${fetchModules.length} modules use the shared deadline helper; `
    + `${seamModules.length} call an injected transport, each defaulted to fetchWithTimeout; `
    + `nothing outside ${DEADLINE_HELPER} so much as names the raw fetch)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
