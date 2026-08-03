import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const files = (await readdir(srcDir)).filter(file => file.endsWith('.js'));
const offenders = [];
const fetchModules = [];

for (const file of files) {
  const text = await readFile(path.join(srcDir, file), 'utf8');
  const bareFetch = text.match(/\bfetch\s*\(/g);
  if (bareFetch?.length) offenders.push(`src/${file}: ${bareFetch.length} bare fetch call(s)`);
  if (text.includes('fetchWithTimeout(')) fetchModules.push(file);
}

if (offenders.length) {
  for (const offender of offenders) console.error(`network timeout guard: ${offender}`);
  process.exit(1);
}
if (!fetchModules.length) {
  console.error('network timeout guard: no module uses the shared fetch helper');
  process.exit(1);
}
console.log(`network timeout guard ok (${fetchModules.length} modules use the shared deadline helper; no bare fetch calls)`);
