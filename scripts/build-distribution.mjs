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

export function sourceCommit() {
  return git(['rev-parse', 'HEAD']);
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
  const measured = await Promise.all(files.map(async file => ({
    file,
    bytes: (await stat(path.join(root, file))).size,
  })));
  const radarFiles = measured.filter(item => item.file.startsWith('data/radar/') && item.file.endsWith('.png'));
  const sourceBundleFiles = measured.filter(item => SOURCE_BUNDLE_FILES.has(item.file));
  const sourceBundleBytes = sourceBundleFiles.reduce((sum, item) => sum + item.bytes, 0);
  if (sourceBundleBytes > SOURCE_BUNDLE_MAX_BYTES) {
    throw new Error(`source bundle exceeds ${SOURCE_BUNDLE_MAX_BYTES} bytes (${sourceBundleBytes})`);
  }
  const mandatoryFiles = measured.filter(item => MANDATORY_INSTALL_FILES.has(item.file) && !SOURCE_BUNDLE_FILES.has(item.file));
  const mandatoryBytes = mandatoryFiles.reduce((sum, item) => sum + item.bytes, 0);
  return {
    profile,
    source_commit: sourceCommit(),
    files: measured.map(item => item.file),
    file_count: measured.length,
    bytes: measured.reduce((sum, item) => sum + item.bytes, 0),
    mandatory_bytes: mandatoryBytes,
    mandatory_file_count: mandatoryFiles.length,
    source_bundle_bytes: sourceBundleBytes,
    source_bundle_file_count: sourceBundleFiles.length,
    source_bundle_max_bytes: SOURCE_BUNDLE_MAX_BYTES,
    radar_file_count: radarFiles.length,
    radar_bytes: radarFiles.reduce((sum, item) => sum + item.bytes, 0),
  };
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
  const descriptor = {
    schema_version: 1,
    profile,
    source_commit: description.source_commit,
    capabilities: {
      historical_offline: true,
      bundled_radar: profile === 'full',
      remote_radar: true,
      source_bundle: true,
    },
    payload: {
      file_count: description.file_count,
      bytes: description.bytes,
      mandatory_bytes: description.mandatory_bytes,
      mandatory_file_count: description.mandatory_file_count,
      source_bundle_bytes: description.source_bundle_bytes,
      source_bundle_file_count: description.source_bundle_file_count,
      source_bundle_max_bytes: description.source_bundle_max_bytes,
      radar_file_count: description.radar_file_count,
      radar_bytes: description.radar_bytes,
    },
  };
  await mkdir(path.join(output, 'data'), { recursive: true });
  await writeFile(path.join(output, 'data/distribution.json'), `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  await synchronizeReleaseManifest(output, description.source_commit);
  return { ...description, output, descriptor };
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
