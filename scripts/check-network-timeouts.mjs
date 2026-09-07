import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const files = (await readdir(srcDir)).filter(file => file.endsWith('.js'));
const offenders = [];
const fetchModules = [];
const seamModules = [];

// src/network.js defines the deadline. Its own transport seam is the thing
// every other module borrows, so it is the one place a bare fetch default is
// the point rather than a hole.
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
const DIRECT_CALL = /\bfetchImpl\s*\(/;
const DEFAULTED_SEAM = /\bfetchImpl\s*=\s*([^,)\n]+)/g;

for (const file of files) {
  const text = await readFile(path.join(srcDir, file), 'utf8');
  const bareFetch = text.match(/\bfetch\s*\(/g);
  if (bareFetch?.length) offenders.push(`src/${file}: ${bareFetch.length} bare fetch call(s)`);
  if (text.includes('fetchWithTimeout(')) fetchModules.push(file);
  if (file === DEADLINE_HELPER || !DIRECT_CALL.test(text)) continue;

  seamModules.push(file);
  const defaults = [...text.matchAll(DEFAULTED_SEAM)].map(match => match[1].trim());
  if (!defaults.length) {
    offenders.push(`src/${file}: calls fetchImpl() but declares no default, so a caller decides whether it has a deadline`);
    continue;
  }
  for (const value of defaults) {
    if (value === 'fetchWithTimeout') continue;
    offenders.push(`src/${file}: calls fetchImpl() with the default "${value}", which carries no deadline (use fetchWithTimeout)`);
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
console.log(
  `network timeout guard ok (${fetchModules.length} modules use the shared deadline helper; ` +
  `${seamModules.length} call an injected transport directly and default it to fetchWithTimeout; no bare fetch calls)`,
);
