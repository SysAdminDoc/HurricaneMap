import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

// source_commit names the preprocessor run that produced the derived data, so
// those files must still be byte-identical to that commit. Hand-maintained
// snapshots (enso, outlook) are refreshed between preprocessor runs by design
// and are deliberately not checked here: their currency is validate:data's job.
//
// data/metadata.json is excluded because it cannot satisfy this: it records the
// identity stamped from HEAD at generation time, so at the commit it names it
// still holds the previous commit's id and version. The four files below carry
// no self-reference, so drift in them means derived data was edited by hand.
const PREPROCESSOR_OUTPUTS = [
  'data/landfalls.json',
  'data/stats.json',
  'data/storms.json',
  'data/storms.json.gz',
];
const drifted = [];
for (const relative of PREPROCESSOR_OUTPUTS) {
  let committed;
  try {
    committed = execFileSync('git', ['cat-file', '-p', `${manifest.source_commit}:${relative}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error(`release manifest names ${manifest.source_commit}, which has no ${relative}`);
  }
  const digest = createHash('sha256').update(committed).digest('hex');
  const artifact = manifest.artifacts.find(candidate => candidate.path === relative);
  if (artifact.sha256 !== digest) drifted.push(relative);
}
if (drifted.length) {
  throw new Error(
    `${drifted.join(', ')} no longer match ${manifest.source_commit.slice(0, 12)}; `
    + 'rerun preprocess_hurdat2.py and stamp the new commit rather than editing derived data by hand',
  );
}

console.log(
  `release manifest ok (${manifest.artifacts.length} artifacts, byte counts and SHA-256 verified; `
  + `${PREPROCESSOR_OUTPUTS.length} derived files match ${manifest.source_commit.slice(0, 12)})`,
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}
