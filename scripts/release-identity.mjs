// The one owner of "which release is this".
//
// Two scripts used to stamp source_commit from different authorities:
// generate-release-manifest.mjs defaulted to `git rev-parse HEAD` while
// build-distribution.mjs read data/metadata.json, so the value a bundle
// carried depended on which script ran last. data/metadata.json is the
// authority, because scripts/test-starter-notebook.py already requires the
// release manifest's generated_at_utc and source_commit to match it.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readReleaseMetadata(root) {
  return JSON.parse(await readFile(path.join(root, 'data/metadata.json'), 'utf8'));
}

/** True when the object name resolves to a commit in this checkout. */
export function commitExists(commit, root = defaultRoot) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function releaseSourceCommit(root = defaultRoot, { requireResolvable = true } = {}) {
  const commit = (await readReleaseMetadata(root))?.generator?.source_commit;
  if (!/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error('data/metadata.json is missing a 40-character generator.source_commit');
  }
  if (requireResolvable && !commitExists(commit, root)) {
    throw new Error(`data/metadata.json names ${commit}, which is not a commit in this checkout`);
  }
  return commit;
}

export async function releaseGeneratedAt(root = defaultRoot) {
  const generatedAt = (await readReleaseMetadata(root))?.generated_at_utc;
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('data/metadata.json is missing a valid generated_at_utc');
  }
  return generatedAt;
}
