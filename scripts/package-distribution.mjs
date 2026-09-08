// Turns a staged distribution profile into a downloadable archive.
//
// build-distribution.mjs stages a directory and stops there, which is why five
// minor versions shipped with the core and full profiles documented and never
// distributed. This stages the profile, archives it, and writes the SHA-256 a
// reader needs to check what they downloaded.
//
// The archive is reproducible for the things tar is told to fix: entries sorted
// by name, and every timestamp and owner pinned. Two runs from the same commit
// on the same machine produce the same hash, which is the only reason
// publishing a hash beside the file is worth anything. (GNU tar 1.35 already
// writes a zero gzip mtime field, so nothing here has to ask it to; that was
// checked rather than assumed, and an inert GZIP=-n was dropped after.)
//
// Two things it does NOT fix, said plainly because an earlier version of this
// comment claimed otherwise. Permission bits come from the staging filesystem;
// there is no --mode here, and nothing in this repository is tracked
// executable, so it has not mattered yet. And --gzip delegates to whatever
// zlib the local tar was built against, so a different tar build can compress
// the same bytes differently.
//
// --verify builds it twice and compares, which catches the archive picking up
// the build clock. It cannot catch entry order, because readdir returns the
// same order twice on one machine: dropping --sort=name changes the hash but
// two verified runs still agree. That one is a cross-machine property, and
// GNU tar is required below for the same reason.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { stageDistribution } from './build-distribution.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// GNU tar. bsdtar, which is what ships in Windows itself, has no --sort and
// writes entries in readdir order, so the archive would differ between machines
// for the same input and the published hash would be a lie.
// `probe` is injected so the refusal can be tested. Without it the only path a
// test could reach on a machine where `tar` IS GNU tar was the "command not
// found" one, and deleting the GNU check outright left the suite green.
export function resolveGnuTar(candidates = ['tar', 'bsdtar'], probe = command => execFileSync(command, ['--version'], { encoding: 'utf8' })) {
  for (const candidate of candidates) {
    try {
      const version = String(probe(candidate)).split('\n')[0];
      if (/GNU tar/i.test(version)) return { command: candidate, version: version.trim() };
    } catch {
      // Not on PATH, or not a tar at all. Try the next one.
    }
  }
  return null;
}

export function archiveName(version, profile) {
  return `hurricanemap-${version}-${profile}.tar.gz`;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function packageProfile(profile, { outputDirectory, version, allowDirty = false, tar } = {}) {
  const staged = await stageDistribution(profile, path.join(outputDirectory, profile), { allowDirty });
  const archive = path.join(outputDirectory, archiveName(version, profile));
  await rm(archive, { force: true });

  // --sort=name for a stable entry order, a fixed mtime and owner so the
  // metadata carries no build clock, and gzip -n so the gzip header does not
  // either. The transform renames the top directory to the archive's own name,
  // so unpacking produces one clearly labelled folder rather than "core".
  const directory = `hurricanemap-${version}-${profile}`;
  // --force-local, because GNU tar reads the colon in C:\repos\... as a remote
  // host and tries to connect to a machine called C.
  execFileSync(tar.command, [
    '--create',
    '--gzip',
    '--force-local',
    '--sort=name',
    '--mtime=UTC 2020-01-01',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=gnu',
    `--transform=s,^${profile},${directory},`,
    '--file', archive,
    '--directory', outputDirectory,
    profile,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  const { size } = await stat(archive);
  return {
    profile,
    archive,
    name: path.basename(archive),
    bytes: size,
    sha256: await sha256(archive),
    staged_bytes: staged.bytes,
    radar_file_count: staged.radar_file_count,
    source_commit: staged.source_commit,
  };
}

async function main() {
  const profiles = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
  const verify = process.argv.includes('--verify');
  const allowDirty = process.argv.includes('--allow-dirty');
  const chosen = profiles.length ? profiles : ['core', 'full'];
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const outputDirectory = path.join(root, 'dist');

  const tar = resolveGnuTar();
  if (!tar) {
    console.error('package distribution: GNU tar is not on PATH. Windows\' own bsdtar cannot sort entries, so the archive would not be reproducible.');
    process.exit(1);
  }

  const results = [];
  for (const profile of chosen) {
    const result = await packageProfile(profile, { outputDirectory, version, allowDirty, tar });
    if (verify) {
      const again = await packageProfile(profile, {
        outputDirectory: path.join(outputDirectory, 'verify'), version, allowDirty, tar,
      });
      if (again.sha256 !== result.sha256) {
        console.error(`package distribution: ${profile} is not reproducible (${result.sha256} then ${again.sha256})`);
        process.exit(1);
      }
      await rm(path.join(outputDirectory, 'verify'), { recursive: true, force: true });
    }
    results.push(result);
    console.log(
      `${profile}: ${result.name} (${(result.bytes / 1024 / 1024).toFixed(1)} MB from ${(result.staged_bytes / 1024 / 1024).toFixed(1)} MB staged`
      + `${verify ? ', reproducible' : ''})\n  sha256 ${result.sha256}`,
    );
  }

  // The format `sha256sum -c` reads, so a reader can verify a download with the
  // tool they already have rather than by eye.
  const sums = `${results.map(result => `${result.sha256}  ${result.name}`).join('\n')}\n`;
  await writeFile(path.join(outputDirectory, 'SHA256SUMS.txt'), sums, 'utf8');
  console.log(`wrote dist/SHA256SUMS.txt (${results.length} archive${results.length === 1 ? '' : 's'}, ${tar.version})`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
