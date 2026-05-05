import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(root, 'sw.js');
const source = await readFile(swPath, 'utf8');

const versionMatch = source.match(/const\s+SW_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!versionMatch) {
  console.error('sw.js does not define SW_VERSION.');
  process.exit(1);
}

const shellMatch = source.match(/const\s+SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/);
if (!shellMatch) {
  console.error('sw.js does not define SHELL_ASSETS.');
  process.exit(1);
}

const assetMatches = [...shellMatch[1].matchAll(/['"](\.\/[^'"]*)['"]/g)];
const assets = assetMatches.map(match => match[1]);
const errors = [];
const seen = new Set();

for (const asset of assets) {
  if (seen.has(asset)) {
    errors.push(`Duplicate shell asset: ${asset}`);
    continue;
  }
  seen.add(asset);

  if (asset === './') continue;
  const normalized = path.normalize(asset.replace(/^\.\//, ''));
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(root)) {
    errors.push(`Shell asset escapes repository root: ${asset}`);
    continue;
  }
  try {
    await access(resolved);
  } catch {
    errors.push(`Shell asset is missing: ${asset}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`service worker ok (${versionMatch[1]}, ${assets.length} shell assets)`);
