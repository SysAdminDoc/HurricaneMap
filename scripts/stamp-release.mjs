// Regenerates every derived release artifact in the one order that works.
//
// Changing a single file under data/ invalidates five other things, and doing
// it by hand goes wrong quietly: coverage reads the hand-maintained snapshots,
// the STAC catalog reads its provenance from the release manifest, the manifest
// hashes the catalog back, the distribution descriptor measures the tree, and
// src/export-provenance.js mirrors the manifest so exports need no fetch.
//
//   node scripts/stamp-release.mjs
//
// It takes no identity flags on purpose. data/metadata.json is the single owner
// of generated_at_utc and source_commit, and only preprocess_hurdat2.py writes
// it, so the only way to move the release identity is to re-run the
// preprocessor. An earlier version accepted --source-commit and appeared to
// honour it, but build-distribution.mjs re-derives the commit from metadata and
// overwrote it, so the flag silently did nothing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseGeneratedAt, releaseSourceCommit } from './release-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROVENANCE_PATH = 'src/export-provenance.js';

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

async function sha256Of(relative) {
  const bytes = await readFile(path.join(root, relative));
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Rewrite one `key: value` literal inside a named ARTIFACTS entry. */
function patchArtifactField(source, artifactPath, key, value) {
  const entry = new RegExp(`(['\`]${artifactPath.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}['\`]: Object\\.freeze\\(\\{[\\s\\S]*?\\n  \\}\\),)`);
  const match = source.match(entry);
  if (!match) throw new Error(`${PROVENANCE_PATH} has no ARTIFACTS entry for ${artifactPath}`);
  const field = new RegExp(`(\\n    ${key}: )[^,\\n]+,`);
  if (!field.test(match[1])) {
    throw new Error(`${PROVENANCE_PATH} entry for ${artifactPath} has no ${key} field`);
  }
  return source.replace(match[1], match[1].replace(field, `$1${value},`));
}

async function main() {
  const rejected = process.argv.slice(2).filter(argument => /^--(source-commit|generated-at)$/.test(argument));
  if (rejected.length) {
    throw new Error(
      `${rejected.join(' and ')} cannot be set here: data/metadata.json owns the release identity, `
      + 'and only scripts/preprocess_hurdat2.py writes it. Re-run the preprocessor to move the release.',
    );
  }
  const sourceCommit = await releaseSourceCommit(root);
  const generatedAt = await releaseGeneratedAt(root);
  const identity = ['--generated-at', generatedAt, '--source-commit', sourceCommit];

  // Coverage first: it reads data/enso.json and data/outlook.json, so a manifest
  // built before it hashes a coverage file that is about to change.
  run(process.execPath, ['scripts/build-coverage.mjs']);
  run(process.execPath, ['scripts/generate-release-manifest.mjs', ...identity]);
  run(process.execPath, ['scripts/generate-stac-catalog.mjs', '--write']);
  // Second pass so the manifest records the catalog it just caused to change.
  run(process.execPath, ['scripts/generate-release-manifest.mjs', ...identity]);
  run(process.execPath, ['scripts/build-distribution.mjs', '--write-source']);

  const manifest = JSON.parse(await readFile(path.join(root, 'data/release-manifest.json'), 'utf8'));
  const manifestDigest = (await sha256Of('data/release-manifest.json')).sha256;
  let source = await readFile(path.join(root, PROVENANCE_PATH), 'utf8');
  const before = source;

  source = source
    .replace(/(generated_at_utc: )'[^']*'/, `$1'${manifest.generated_at_utc}'`)
    .replace(/(source_commit: )'[^']*'/g, `$1'${manifest.source_commit}'`)
    .replace(/(manifest_sha256: )'[^']*'/, `$1'${manifestDigest}'`);

  const artifactsByPath = new Map(manifest.artifacts.map(artifact => [artifact.path, artifact]));
  const bound = [...source.matchAll(/^ {2}'(data\/[^']+)': Object\.freeze\(\{$/gm)].map(match => match[1]);
  for (const artifactPath of bound) {
    const artifact = artifactsByPath.get(artifactPath);
    if (!artifact) throw new Error(`the release manifest no longer describes ${artifactPath}`);
    source = patchArtifactField(source, artifactPath, 'bytes', String(artifact.bytes));
    source = patchArtifactField(source, artifactPath, 'sha256', `'${artifact.sha256}'`);
    source = patchArtifactField(source, artifactPath, 'source_date', `'${artifact.source_date}'`);
  }

  if (source !== before) await writeFile(path.join(root, PROVENANCE_PATH), source, 'utf8');
  console.log(
    `release stamped (${manifest.source_commit.slice(0, 12)} @ ${manifest.generated_at_utc}; `
    + `${manifest.artifacts.length} artifacts, ${bound.length} mirrored in ${PROVENANCE_PATH}`
    + `${source === before ? '; provenance already current' : ''})`,
  );
}

await main();
