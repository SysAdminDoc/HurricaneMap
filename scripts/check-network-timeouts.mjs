import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const files = (await readdir(srcDir)).filter(file => file.endsWith('.js'));
const offenders = [];
const fetchModules = [];
const seamModules = [];
const rawDefaults = [];

// src/network.js defines the deadline. Its own transport seam is the thing
// every other module borrows, so it is the one place a raw fetch default is the
// point rather than a hole.
const DEADLINE_HELPER = 'network.js';

// Two shapes of injectable transport are in use, and only one of them is safe
// on its own:
//
//   fetchWithTimeout(url, init, ms, fetchImpl)  the deadline wraps the seam
//   fetchImpl(url, init)                        the seam IS the request
//
// The second spells no fetch( anywhere, so the bare-fetch scan below never saw
// it. Four paths reached the network with no deadline that way: the spatial
// search's five parallel NHC GIS queries, the two diagnostics bundle reads,
// and the two bulk downloads, where one stalled response left "Saving radar
// pack N/M" on screen for ever with the button disabled.
//
// Naming the seam is not enough to police it: a parameter called anything else
// hides just as well, and a first version of this gate was fooled by
// `transport = globalThis.fetch`, by `fetchImpl?.(`, and by a `fetchImpl =`
// written inside a comment. So the rule that carries the weight is about the
// default rather than the name: nothing in src/ may default a parameter to a
// raw fetch reference.
const DIRECT_CALL = /\bfetchImpl\s*(?:\?\.)?\(/;
const SAFE_SEAM = /\bfetchImpl\s*=\s*fetchWithTimeout\b/;
const RAW_FETCH_DEFAULT = /\b([A-Za-z_$][\w$]*)\s*=\s*((?:globalThis|self|window)\.fetch|fetch)\s*(?=[,)}\n])/g;

// A `fetchImpl =` inside a comment satisfied the "declares a default" branch
// while the real seam had none.
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

for (const file of files) {
  const raw = await readFile(path.join(srcDir, file), 'utf8');
  const text = withoutComments(raw);
  const bareFetch = text.match(/\bfetch\s*\(/g);
  if (bareFetch?.length) offenders.push(`src/${file}: ${bareFetch.length} bare fetch call(s)`);
  if (text.includes('fetchWithTimeout(')) fetchModules.push(file);
  if (file === DEADLINE_HELPER) continue;

  for (const match of text.matchAll(RAW_FETCH_DEFAULT)) {
    rawDefaults.push(`src/${file}`);
    offenders.push(
      `src/${file}: "${match[1]} = ${match[2]}" defaults a transport to a raw fetch, which carries no deadline. `
      + 'Default it to fetchWithTimeout, or drop the default and let fetchWithTimeout supply it.',
    );
  }

  if (!DIRECT_CALL.test(text)) continue;
  seamModules.push(file);
  if (!SAFE_SEAM.test(text)) {
    offenders.push(
      `src/${file}: calls fetchImpl() but never defaults it to fetchWithTimeout, `
      + 'so a caller decides whether the request has a deadline',
    );
  }
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
// A rule nothing can break is a rule nothing is checking. Prove the raw-default
// scan still recognises the shapes it exists to catch.
for (const probe of [
  'async function f({ transport = globalThis.fetch } = {}) { return transport(u); }',
  'async function f({ fetchImpl = fetch }) { return fetchImpl(u); }',
  'export async function f(u, { send = window.fetch, signal } = {}) { return send(u, { signal }); }',
]) {
  RAW_FETCH_DEFAULT.lastIndex = 0;
  if (!RAW_FETCH_DEFAULT.test(probe)) {
    console.error(`network timeout guard: the raw-default scan no longer matches "${probe}"`);
    process.exit(1);
  }
}
console.log(
  `network timeout guard ok (${fetchModules.length} modules use the shared deadline helper; `
  + `${seamModules.length} call an injected transport directly and default it to fetchWithTimeout; `
  + `no bare fetch calls and no raw-fetch transport defaults outside ${DEADLINE_HELPER})`,
);
