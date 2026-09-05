import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_ROOT_FILES = new Set([
  '.dockerignore',
  'Dockerfile',
  'THIRD_PARTY_NOTICES.txt',
  'example.png',
  'globe.html',
  'index.html',
  'manifest.webmanifest',
  'manifest.es.webmanifest',
  'manifest.ht.webmanifest',
  'serve.py',
  'sw.js',
]);
const STATIC_PREFIXES = ['branding/', 'data/', 'fonts/', 'schemas/', 'src/', 'vendor/'];
export const SOURCE_BUNDLE_FILES = new Set([
  'data/hurdat2-atlantic.txt',
  'data/hurdat2-nepac.txt',
  'data/release-manifest.json',
]);
export const SOURCE_BUNDLE_MAX_BYTES = 13 * 1024 * 1024;
const GENERATED_METADATA_FILES = new Set(['data/distribution.json', 'data/release-manifest.json']);
const EMPTY_RADAR_MANIFEST_BYTES = Buffer.byteLength('{}\n');
const SERVICE_WORKER_SOURCE = await readFile(path.join(root, 'sw.js'), 'utf8');
const APPLICATION_MODULES = git(['ls-files', '--', 'src'])
  .split(/\r?\n/)
  .filter(file => file.endsWith('.js'));
const MANDATORY_INSTALL_FILES = new Set([
  'sw.js',
  ...parseServiceWorkerAssets('SHELL_ASSETS'),
  ...APPLICATION_MODULES,
  ...parseServiceWorkerAssets('OFFLINE_DATA_ASSETS'),
].map(file => file.replace(/^\.\//, '')).filter(Boolean));

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

// A distribution repackages a published data release, so it inherits that
// release's identity instead of stamping whatever HEAD happens to be. Reading
// git here desynchronized the staged release manifest from the STAC catalog
// copied beside it — the catalog carries the commit baked in at its last
// `generate:stac --write`, so any later commit, docs included, broke staging.
// data/metadata.json is the authority the notebook contract already enforces.
export async function releaseSourceCommit() {
  const metadata = JSON.parse(await readFile(path.join(root, 'data/metadata.json'), 'utf8'));
  const commit = metadata?.generator?.source_commit;
  if (!/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error('data/metadata.json is missing a 40-character generator.source_commit');
  }
  return commit;
}

export function trackedStaticFiles(profile) {
  if (!['core', 'full'].includes(profile)) throw new Error(`Unknown distribution profile: ${profile}`);
  return git(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => STATIC_ROOT_FILES.has(file) || STATIC_PREFIXES.some(prefix => file.startsWith(prefix)))
    .filter(file => profile === 'full' || !file.startsWith('data/radar/') || file === 'data/radar/manifest.json')
    .sort();
}

export async function describeDistribution(profile) {
  const files = trackedStaticFiles(profile);
  const measured = (await Promise.all(files.map(async file => ({
    file,
    bytes: (await stat(path.join(root, file))).size,
  })))).map(item => profile === 'core' && item.file === 'data/radar/manifest.json'
    ? { ...item, bytes: EMPTY_RADAR_MANIFEST_BYTES }
    : item);
  const radarFiles = measured.filter(item => item.file.startsWith('data/radar/') && item.file.endsWith('.png'));
  const sourceBundleFiles = measured.filter(item => SOURCE_BUNDLE_FILES.has(item.file));
  const sourceBundleBytes = sourceBundleFiles.reduce((sum, item) => sum + item.bytes, 0);
  if (sourceBundleBytes > SOURCE_BUNDLE_MAX_BYTES) {
    throw new Error(`source bundle exceeds ${SOURCE_BUNDLE_MAX_BYTES} bytes (${sourceBundleBytes})`);
  }
  const mandatoryFiles = measured.filter(item => MANDATORY_INSTALL_FILES.has(item.file) && !SOURCE_BUNDLE_FILES.has(item.file));
  const mandatoryBytes = mandatoryFiles.reduce((sum, item) => sum + item.bytes, 0);
  const payloadFiles = measured.filter(item => !GENERATED_METADATA_FILES.has(item.file));
  return {
    profile,
    source_commit: await releaseSourceCommit(),
    files: measured.map(item => item.file),
    file_count: payloadFiles.length,
    bytes: payloadFiles.reduce((sum, item) => sum + item.bytes, 0),
    mandatory_bytes: mandatoryBytes,
    mandatory_file_count: mandatoryFiles.length,
    source_bundle_bytes: sourceBundleBytes,
    source_bundle_file_count: sourceBundleFiles.length,
    source_bundle_max_bytes: SOURCE_BUNDLE_MAX_BYTES,
    radar_file_count: radarFiles.length,
    radar_bytes: radarFiles.reduce((sum, item) => sum + item.bytes, 0),
  };
}

export function buildDistributionDescriptor(description, { sourceBundleBytes = description.source_bundle_bytes } = {}) {
  return {
    schema_version: 1,
    profile: description.profile,
    source_commit: description.source_commit,
    capabilities: {
      historical_offline: true,
      bundled_radar: description.profile === 'full',
      remote_radar: true,
      source_bundle: true,
    },
    payload: {
      file_count: description.file_count,
      bytes: description.bytes,
      mandatory_bytes: description.mandatory_bytes,
      mandatory_file_count: description.mandatory_file_count,
      source_bundle_bytes: sourceBundleBytes,
      source_bundle_file_count: description.source_bundle_file_count,
      source_bundle_max_bytes: description.source_bundle_max_bytes,
      radar_file_count: description.radar_file_count,
      radar_bytes: description.radar_bytes,
    },
  };
}

export async function writeSourceDescriptor() {
  const description = await describeDistribution('full');
  let descriptor = buildDistributionDescriptor(description);
  await writeDistributionDescriptor(path.join(root, 'data/distribution.json'), descriptor);
  for (let attempt = 0; attempt < 3; attempt++) {
    await synchronizeReleaseManifest(root, description.source_commit);
    const sourceBundleBytes = await measureSourceBundleBytes(root);
    if (sourceBundleBytes === descriptor.payload.source_bundle_bytes) break;
    descriptor = buildDistributionDescriptor(description, { sourceBundleBytes });
    await writeDistributionDescriptor(path.join(root, 'data/distribution.json'), descriptor);
    if (attempt === 2) throw new Error('source-bundle byte count did not stabilize');
  }
  await assertStagedDescriptor(root, descriptor);
  return descriptor;
}

export async function stageDistribution(profile, outputDirectory, { allowDirty = false } = {}) {
  const output = path.resolve(outputDirectory);
  const distRoot = path.join(root, 'dist');
  if (output !== distRoot && !output.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error(`Distribution output must stay inside ${distRoot}`);
  }
  if (!allowDirty && git(['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error('Refusing to package tracked modifications; commit them or use --allow-dirty for local inspection');
  }

  const description = await describeDistribution(profile);
  await rm(output, { recursive: true, force: true });
  await Promise.all(description.files.map(async file => {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file), destination);
  }));

  if (profile === 'core') {
    await writeFile(path.join(output, 'data/radar/manifest.json'), '{}\n', 'utf8');
  }
  let descriptor = buildDistributionDescriptor(description);
  await mkdir(path.join(output, 'data'), { recursive: true });
  await writeDistributionDescriptor(path.join(output, 'data/distribution.json'), descriptor);
  for (let attempt = 0; attempt < 3; attempt++) {
    await synchronizeReleaseManifest(output, description.source_commit);
    const sourceBundleBytes = await measureSourceBundleBytes(output);
    if (sourceBundleBytes === descriptor.payload.source_bundle_bytes) break;
    descriptor = buildDistributionDescriptor(description, { sourceBundleBytes });
    await writeDistributionDescriptor(path.join(output, 'data/distribution.json'), descriptor);
    if (attempt === 2) throw new Error('staged source-bundle byte count did not stabilize');
  }
  await assertStagedDescriptor(output, descriptor);
  return { ...description, output, descriptor };
}

async function writeDistributionDescriptor(file, descriptor) {
  await writeFile(file, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
}

async function measureSourceBundleBytes(directory) {
  const sizes = await Promise.all([...SOURCE_BUNDLE_FILES].map(async file => (await stat(path.join(directory, file))).size));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function assertStagedDescriptor(output, descriptor) {
  const descriptorPath = path.join(output, 'data/distribution.json');
  const descriptorBytes = await readFile(descriptorPath);
  const manifest = JSON.parse(await readFile(path.join(output, 'data/release-manifest.json'), 'utf8'));
  const artifact = manifest.artifacts?.find(candidate => candidate.path === 'data/distribution.json');
  if (!artifact || artifact.bytes !== descriptorBytes.length || artifact.sha256 !== createHash('sha256').update(descriptorBytes).digest('hex')) {
    throw new Error('staged release manifest does not describe data/distribution.json');
  }
  if (manifest.source_commit !== descriptor.source_commit) throw new Error('staged descriptor and release manifest source commits differ');
  const sourceBundleBytes = await measureSourceBundleBytes(output);
  if (descriptor.payload.source_bundle_bytes !== sourceBundleBytes) throw new Error('staged descriptor source-bundle bytes are stale');
}

async function synchronizeReleaseManifest(output, sourceCommitValue) {
  const manifestPath = path.join(output, 'data/release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataFiles = (await walk(path.join(output, 'data')))
    .map(file => path.relative(output, file).replaceAll('\\', '/'))
    .filter(file => file !== 'data/release-manifest.json')
    .sort();
  const artifactsByPath = new Map((manifest.artifacts || []).map(artifact => [artifact.path, artifact]));
  manifest.source_commit = sourceCommitValue;
  manifest.artifacts = await Promise.all(dataFiles.map(async file => {
    const artifact = artifactsByPath.get(file);
    if (!artifact) throw new Error(`release manifest has no metadata for staged file ${file}`);
    const bytes = await readFile(path.join(output, file));
    return {
      ...artifact,
      path: file,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function parseServiceWorkerAssets(name) {
  const match = SERVICE_WORKER_SOURCE.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) throw new Error(`sw.js does not define ${name}`);
  return [...match[1].matchAll(/['"](\.\/[^'"]*)['"]/g)].map(asset => asset[1]);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}

async function main() {
  if (process.argv.includes('--write-source')) {
    const descriptor = await writeSourceDescriptor();
    console.log(`source distribution descriptor written (${descriptor.profile} profile, ${descriptor.payload.file_count} payload files)`);
    return;
  }
  const profile = process.argv[2];
  const outputFlag = process.argv.indexOf('--out');
  const output = outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : path.join(root, 'dist', profile || '');
  const result = await stageDistribution(profile, output, {
    allowDirty: process.argv.includes('--allow-dirty'),
  });
  console.log(
    `${result.profile} distribution staged at ${result.output} `
    + `(${(result.bytes / 1024 / 1024).toFixed(1)} MB, ${result.radar_file_count} bundled radar frames, ${result.source_commit.slice(0, 12)})`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
