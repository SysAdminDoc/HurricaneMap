import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'data');
const manifest = JSON.parse(await readFile(path.join(dataRoot, 'release-manifest.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(manifest.source_commit || '')) {
  throw new Error('release manifest must record a 40-character git source_commit');
}
const files = (await walk(dataRoot))
  .map(file => path.relative(root, file).replaceAll('\\', '/'))
  .filter(file => file !== 'data/release-manifest.json')
  .sort();
const listed = manifest.artifacts?.map(artifact => artifact.path) || [];
if (JSON.stringify(files) !== JSON.stringify(listed)) {
  throw new Error('release manifest file list is stale; regenerate it with an explicit --generated-at timestamp');
}

for (const artifact of manifest.artifacts) {
  const bytes = await readFile(path.join(root, artifact.path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (artifact.bytes !== bytes.length) throw new Error(`${artifact.path} byte count is stale`);
  if (artifact.sha256 !== digest) throw new Error(`${artifact.path} SHA-256 is stale`);
  if (!/^https:\/\//.test(artifact.source_url)) throw new Error(`${artifact.path} has no HTTPS source URL`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.source_date)) throw new Error(`${artifact.path} has no absolute source date`);
  if (artifact.schema_version == null || artifact.schema_version === '') throw new Error(`${artifact.path} has no schema version`);
}

console.log(`release manifest ok (${manifest.artifacts.length} artifacts, byte counts and SHA-256 verified)`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}
