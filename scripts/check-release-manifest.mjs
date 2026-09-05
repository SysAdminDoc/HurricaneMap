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
// The manifest separates two dates that used to be conflated: source_commit is
// the preprocessor identity, and hand_maintained.refreshed_utc is the newest
// publication date among the snapshots that are edited in place. It is the date
// of the product, not of the commit, and with two snapshots at different dates
// it describes only the newer one, which is why each snapshot records its own.
// A snapshot ships under a source_commit that predates it by design, so these
// dates are what say whether it is current.
const handMaintained = manifest.hand_maintained;
if (!handMaintained || !Array.isArray(handMaintained.snapshots) || !handMaintained.snapshots.length) {
  throw new Error('release manifest must record hand_maintained.snapshots');
}
const HAND_MAINTAINED_ISSUED = {
  'data/enso.json': record => record?._meta?.issued,
  'data/outlook.json': record => record?.issued,
};
for (const snapshot of handMaintained.snapshots) {
  const pick = HAND_MAINTAINED_ISSUED[snapshot.path];
  if (!pick) throw new Error(`release manifest records an unknown hand-maintained snapshot: ${snapshot.path}`);
  const bytes = await readFile(path.join(root, snapshot.path));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (snapshot.sha256 !== digest) {
    throw new Error(`${snapshot.path} has changed since the manifest recorded its refresh; regenerate the manifest`);
  }
  const issued = pick(JSON.parse(bytes.toString('utf8')));
  if (snapshot.issued !== issued) {
    throw new Error(`${snapshot.path} says it was issued ${issued}, the manifest says ${snapshot.issued}`);
  }
}
for (const path_ of Object.keys(HAND_MAINTAINED_ISSUED)) {
  if (!handMaintained.snapshots.some(snapshot => snapshot.path === path_)) {
    throw new Error(`release manifest omits the hand-maintained snapshot ${path_}`);
  }
}
const latestRefresh = handMaintained.snapshots.map(snapshot => snapshot.issued).sort().at(-1);
if (handMaintained.refreshed_utc !== latestRefresh) {
  throw new Error(
    `release manifest hand_maintained.refreshed_utc is ${handMaintained.refreshed_utc}, `
    + `but the newest snapshot was issued ${latestRefresh}`,
  );
}

// The generator refuses to write a changed snapshot under an unchanged issue
// date, but that guard reads the previous manifest, so deleting the manifest
// first skipped it and the edit shipped under the old date with every gate
// green. Git holds the previous state whether or not the manifest does, so the
// invariant belongs here, in a gate, and is checked against the commit.
function committedFile(relative) {
  try {
    return execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

let snapshotHistory = 'snapshot history check skipped: this tree has no git history';
if (gitAvailable()) {
  const notes = [];
  for (const snapshot of handMaintained.snapshots) {
    const previousBytes = committedFile(snapshot.path);
    if (!previousBytes) continue;
    const previousDigest = createHash('sha256').update(previousBytes).digest('hex');
    if (previousDigest === snapshot.sha256) continue;
    const previousIssued = HAND_MAINTAINED_ISSUED[snapshot.path](JSON.parse(previousBytes.toString('utf8')));
    if (previousIssued === snapshot.issued) {
      throw new Error(
        `${snapshot.path} has changed since the last commit but still says it was issued ${snapshot.issued}. `
        + 'A refreshed snapshot carries the publication date of the product it holds.',
      );
    }
    // Forward only. A refresh that lands an older product than the one it
    // replaces is a mistake, and it drags refreshed_utc backward with it.
    if (previousIssued && snapshot.issued < previousIssued) {
      throw new Error(
        `${snapshot.path} moved back from ${previousIssued} to ${snapshot.issued}. `
        + 'A refresh publishes a newer product, not an older one.',
      );
    }
    notes.push(`${snapshot.path} ${previousIssued} to ${snapshot.issued}`);
  }
  snapshotHistory = notes.length ? `refreshed: ${notes.join(', ')}` : 'snapshots unchanged since the last commit';
}

const PREPROCESSOR_OUTPUTS = [
  'data/landfalls.json',
  'data/stats.json',
  'data/storms.json',
  'data/storms.json.gz',
];
// A published distribution ships without .git, and a shallow clone may not hold
// the release commit at all. Neither is drift, so say so rather than accusing
// the data. The byte and SHA-256 checks above still ran either way.
function gitAvailable() {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' });
    return execFileSync('git', ['cat-file', '-e', `${manifest.source_commit}^{commit}`], { cwd: root, stdio: 'ignore' }) || true;
  } catch {
    return false;
  }
}

let derivedNote = 'derived-file check skipped: this tree has no git history for the release commit';
if (gitAvailable()) {
  const drifted = [];
  for (const relative of PREPROCESSOR_OUTPUTS) {
    const artifact = manifest.artifacts.find(candidate => candidate.path === relative);
    if (!artifact) throw new Error(`release manifest no longer describes ${relative}`);
    let committed;
    try {
      committed = execFileSync('git', ['cat-file', '-p', `${manifest.source_commit}:${relative}`], {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      throw new Error(`${manifest.source_commit.slice(0, 12)} does not contain ${relative}; the release identity and the data disagree`);
    }
    if (artifact.sha256 !== createHash('sha256').update(committed).digest('hex')) drifted.push(relative);
  }
  if (drifted.length) {
    throw new Error(
      `${drifted.join(', ')} no longer match ${manifest.source_commit.slice(0, 12)}; `
      + 'rerun preprocess_hurdat2.py rather than editing derived data by hand',
    );
  }
  derivedNote = `${PREPROCESSOR_OUTPUTS.length} derived files match ${manifest.source_commit.slice(0, 12)}`;
}

console.log(`release manifest ok (${manifest.artifacts.length} artifacts, byte counts and SHA-256 verified; ${derivedNote}; ${snapshotHistory})`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}
