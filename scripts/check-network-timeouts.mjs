import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseModule, walk } from './js-ast.mjs';

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
//
// This one reads the tree rather than the text. A regex cannot tell a parameter
// that BINDS a seam from a property that PASSES one on, and the two are spelled
// identically: `(layer, { fetchImpl, signal })` is a hole when it is a parameter
// list and correct when it is an argument, which is what src/nhc-summary.js
// writes. Counting brackets instead of parsing reported that legitimate
// pass-through as a violation, so the rule was narrowed to per-file rather than
// per-declaration and a module with one defaulted seam and a second undefaulted
// seam beside it went unnoticed.
const SEAM = 'fetchImpl';
const SEAM_DEFAULT = 'fetchWithTimeout';
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
// Where a seam is bound, which is only ever inside a parameter pattern. The
// caller's key is what carries the convention, so `{ fetchImpl: transport }`
// counts and binds the local name `transport`.
function bindingsInParams(params) {
  const bindings = [];
  const scan = (pattern, fallback, viaSeamKey, destructured) => {
    if (!pattern || typeof pattern !== 'object') return;
    if (pattern.type === 'AssignmentPattern') {
      scan(pattern.left, pattern.right, viaSeamKey, destructured);
      return;
    }
    if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          scan(property.argument, null, false, true);
          continue;
        }
        const key = property.computed ? null : (property.key?.name ?? property.key?.value);
        scan(property.value, null, key === SEAM, true);
      }
      return;
    }
    if (pattern.type === 'ArrayPattern') {
      for (const element of pattern.elements) scan(element, null, false, true);
      return;
    }
    if (pattern.type === 'RestElement') {
      scan(pattern.argument, null, viaSeamKey, destructured);
      return;
    }
    if (pattern.type === 'Identifier' && (viaSeamKey || pattern.name === SEAM)) {
      bindings.push({ name: pattern.name, fallback, destructured });
    }
  };
  for (const param of params) scan(param, null, false, false);
  return bindings;
}

// Which functions this module hands out. A positional seam matters only here:
// inside the module, `readMetadata(fetchImpl)` is an ordinary argument whose
// only callers are a few lines up and are held to this same rule, so requiring
// a default on it would be asking for a value that is already decided. Across
// the module boundary there is nobody to hold, and the caller picks.
function exportedFunctions(tree) {
  const exported = new Set();
  for (const node of tree.body) {
    if (node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportDefaultDeclaration') continue;
    const declaration = node.declaration;
    if (!declaration) continue;
    if (FUNCTION_TYPES.has(declaration.type)) {
      exported.add(declaration);
      continue;
    }
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.init && FUNCTION_TYPES.has(declarator.init.type)) exported.add(declarator.init);
      }
    }
  }
  return exported;
}

/**
 * Every transport seam a module binds as a parameter: what it is called, what
 * it defaults to, and whether the function that bound it goes on to call it.
 * A seam that is bound and never called is handed to something else, and that
 * something else is held to this same rule wherever it lives.
 */
export function seamBindings(text) {
  const tree = parseModule(text);
  const exported = exportedFunctions(tree);
  const found = [];
  walk(tree, node => {
    if (!FUNCTION_TYPES.has(node.type)) return;
    const bindings = bindingsInParams(node.params);
    if (!bindings.length) return;
    const called = new Set();
    walk(node.body, inner => {
      if (inner.type !== 'CallExpression') return;
      const callee = inner.callee?.type === 'ChainExpression' ? inner.callee.expression : inner.callee;
      if (callee?.type === 'Identifier') called.add(callee.name);
    });
    for (const binding of bindings) {
      let defaultName = null;
      if (binding.fallback) {
        defaultName = binding.fallback.type === 'Identifier' ? binding.fallback.name : 'an expression';
      }
      found.push({
        name: binding.name,
        called: called.has(binding.name),
        defaultName,
        destructured: binding.destructured,
        exported: exported.has(node),
      });
    }
  });
  return found;
}

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

  // A function that calls its seam has to default that seam to the deadline
  // helper. Per binding, not per file and not per module: one safe seam used to
  // excuse every other seam beside it.
  let bindings;
  try {
    bindings = seamBindings(text);
  } catch (error) {
    offenders.push(
      `${file}: does not parse (${String(error?.message || error).slice(0, 120)}), `
      + 'so the injected-transport rule could not be checked',
    );
    return offenders;
  }
  for (const binding of bindings) {
    if (!binding.called) continue;
    if (binding.defaultName === SEAM_DEFAULT) continue;
    if (!binding.destructured && !binding.exported) continue;
    offenders.push(binding.defaultName
      ? `${file}: calls ${binding.name}() with the default "${binding.defaultName}", which carries no deadline (use ${SEAM_DEFAULT})`
      : `${file}: binds ${binding.name} as a parameter with no default and calls it, so a caller decides whether it has a deadline`);
  }
  return offenders;
}

// The mention rule above still carries most of the weight, and it is worth
// saying why the two exist together. The seam rule is precise about a shape
// this repository actually writes; the mention rule is blunt about anything it
// has not thought of. Nothing outside src/network.js can obtain a raw fetch, so
// even a seam the tree walk fails to recognise can only ever be handed a
// transport that already carries a deadline.

async function main() {
  const files = (await readdir(srcDir)).filter(file => file.endsWith('.js'));
  const offenders = [];
  const fetchModules = [];
  const seamModules = [];

  for (const file of files) {
    const text = await readFile(path.join(srcDir, file), 'utf8');
    const code = stripComments(text);
    if (code.includes('fetchWithTimeout(')) fetchModules.push(file);
    let seams = [];
    try {
      seams = seamBindings(text);
    } catch {
      // A file that does not parse is reported as an offender below.
    }
    if (seams.some(binding => binding.called)) seamModules.push(file);
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
    + `${seamModules.length} call an injected transport, each binding defaulted to fetchWithTimeout in the parsed tree; `
    + `nothing outside ${DEADLINE_HELPER} so much as names the raw fetch)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
