import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_ROOT_FILES = new Set([
  '.dockerignore',
  'Dockerfile',
  'THIRD_PARTY_NOTICES.txt',
  'index.html',
  'manifest.webmanifest',
  'sw.js',
]);
const STATIC_PREFIXES = ['branding/', 'data/', 'fonts/', 'src/', 'vendor/'];

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
  return {
    profile,
    source_commit: sourceCommit(),
    files: measured.map(item => item.file),
    file_count: measured.length,
    bytes: measured.reduce((sum, item) => sum + item.bytes, 0),
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
    },
    payload: {
      file_count: description.file_count,
      bytes: description.bytes,
      radar_file_count: description.radar_file_count,
      radar_bytes: description.radar_bytes,
    },
  };
  await mkdir(path.join(output, 'data'), { recursive: true });
  await writeFile(path.join(output, 'data/distribution.json'), `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  return { ...description, output, descriptor };
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
