import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { commitExists, releaseSourceCommit } from './release-identity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'data');

// The two snapshots nobody's preprocessor writes: they are edited in place when
// NOAA publishes a new product, and each carries that product's own date.
const HAND_MAINTAINED = [
  { path: 'data/enso.json', pick: record => record?._meta?.issued },
  { path: 'data/outlook.json', pick: record => record?.issued },
];

const generatedAtFlag = process.argv.indexOf('--generated-at');
const generatedAt = generatedAtFlag >= 0 ? process.argv[generatedAtFlag + 1] : null;
if (!generatedAt || !/^\d{4}-\d{2}-\d{2}T/.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
  throw new Error('Pass a deterministic ISO timestamp with --generated-at');
}
// Default to the release data/metadata.json already names, so regenerating the
// manifest and then staging a distribution cannot disagree about the commit.
// Pass --source-commit explicitly to move the release identity forward.
const sourceCommitFlag = process.argv.indexOf('--source-commit');
const sourceCommit = sourceCommitFlag >= 0
  ? process.argv[sourceCommitFlag + 1]
  : await releaseSourceCommit(root);
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error('Pass a 40-character git revision with --source-commit');
}
if (!commitExists(sourceCommit, root)) {
  throw new Error(`${sourceCommit} is not a commit in this checkout`);
}

const metadata = JSON.parse(await readFile(path.join(dataRoot, 'metadata.json'), 'utf8'));
const aoml = JSON.parse(await readFile(path.join(dataRoot, 'aoml-landfalls.json'), 'utf8'));
const sourceLock = JSON.parse(await readFile(path.join(dataRoot, 'hurdat2-sources.json'), 'utf8'));
const files = (await walk(dataRoot))
  .map(file => path.relative(root, file).replaceAll('\\', '/'))
  .filter(file => file !== 'data/release-manifest.json')
  .sort();
const artifacts = [];
for (const relative of files) {
  const fullPath = path.join(root, relative);
  const bytes = await readFile(fullPath);
  artifacts.push({
    path: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source_url: sourceUrl(relative),
    source_date: sourceDate(relative, metadata, aoml),
    generated_at_utc: generatedAt,
    schema_version: schemaVersion(relative, bytes),
  });
}
// source_commit is the preprocessor identity: the commit whose run produced the
// derived data. The hand-maintained snapshots are refreshed in place between
// those runs, so they ship under an identity that predates them, and until now
// only prose said that was intended. This block states when they were last
// refreshed, so the two dates can be told apart by a reader and by a gate.
const byPath = new Map(artifacts.map(artifact => [artifact.path, artifact]));
const snapshots = HAND_MAINTAINED.map(({ path: relative, pick }) => ({
  path: relative,
  issued: handMaintainedIssued(relative, pick),
  sha256: byPath.get(relative).sha256,
}));
const previous = await readPreviousManifest();
for (const snapshot of snapshots) {
  const before = previous?.hand_maintained?.snapshots?.find(entry => entry.path === snapshot.path);
  if (!before || before.sha256 === snapshot.sha256) continue;
  if (before.issued === snapshot.issued) {
    throw new Error(
      `${snapshot.path} has changed but still says it was issued ${snapshot.issued}. `
      + 'A refreshed snapshot carries the publication date of the product it holds; '
      + 'update its issued date, or revert the edit.',
    );
  }
}
const manifest = {
  schema_version: 1,
  generated_at_utc: generatedAt,
  source_commit: sourceCommit,
  algorithm: 'SHA-256',
  hand_maintained: {
    refreshed_utc: snapshots.map(snapshot => snapshot.issued).sort().at(-1),
    snapshots,
  },
  artifacts,
};
await writeFile(
  path.join(dataRoot, 'release-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
console.log(`release manifest generated (${artifacts.length} artifacts, SHA-256)`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return nested.flat();
}

function sourceUrl(relative) {
  const lockedSource = sourceLock.sources?.find(source => source.local_path === relative);
  if (lockedSource) return lockedSource.source_url;
  if (relative === 'data/aoml-landfalls.json' || relative === 'data/aoml-us-landfalls.html') return 'https://www.aoml.noaa.gov/hrd/hurdat/UShurrs_detailed.html';
  if (relative === 'data/hurdat2-sources.json') return 'https://www.nhc.noaa.gov/data/hurdat/';
  if (relative.startsWith('data/stac/')) return 'https://github.com/SysAdminDoc/HurricaneMap';
  if (relative.startsWith('data/radar/')) return 'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/';
  if (relative === 'data/us-states.geojson') return 'https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html';
  if (relative === 'data/impacts.json') return 'https://en.wikipedia.org/';
  if (relative === 'data/billions.json') return 'https://www.ncei.noaa.gov/access/billions/';
  if (relative.startsWith('data/surge-obs/')) return 'https://api.tidesandcurrents.noaa.gov/api/prod/';
  if (relative === 'data/storm-events.json') return 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
  if (relative === 'data/rainfall.json') return 'https://www.wpc.ncep.noaa.gov/tropical/rain/tcrainfall.html';
  if (relative === 'data/enso.json') return 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php';
  if (relative === 'data/outlook.json') return 'https://www.cpc.ncep.noaa.gov/products/outlooks/hurricane.shtml';
  if (relative === 'data/distribution.json') return 'https://github.com/SysAdminDoc/HurricaneMap';
  if (relative === 'data/advisories.json') return 'https://ftp.nhc.noaa.gov/atcf/archive/';
  if (relative === 'data/coverage.json') return 'https://github.com/SysAdminDoc/HurricaneMap';
  return 'https://www.nhc.noaa.gov/data/hurdat/';
}

async function readPreviousManifest() {
  try {
    return JSON.parse(await readFile(path.join(dataRoot, 'release-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function handMaintainedIssued(relative, pick) {
  const issued = pick(JSON.parse(readFileSync(path.join(root, relative), 'utf8')));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issued || '')) {
    throw new Error(`${relative} needs an ISO issued date to record as its source date`);
  }
  return issued;
}

function sourceDate(relative, buildMetadata, aomlData) {
  const radarStamp = relative.match(/t_(\d{4})(\d{2})(\d{2})\d{4}\.png$/);
  if (radarStamp) return `${radarStamp[1]}-${radarStamp[2]}-${radarStamp[3]}`;
  const lockedSource = sourceLock.sources?.find(source => source.local_path === relative);
  if (lockedSource) return lockedSource.source_date;
  if (relative === 'data/aoml-landfalls.json' || relative === 'data/aoml-us-landfalls.html') return aomlData.source.source_date;
  if (relative === 'data/hurdat2-sources.json') return sourceLock.sources.map(source => source.source_date).sort().at(-1);
  if (relative.startsWith('data/stac/')) return generatedAt.slice(0, 10);
  // Hand-maintained snapshots carry their own publication date. Falling through
  // to the git log below dated them by their last commit, which lands before
  // the product they hold once the file is refreshed in place.
  if (relative === 'data/enso.json') return handMaintainedIssued(relative, record => record?._meta?.issued);
  if (relative === 'data/outlook.json') return handMaintainedIssued(relative, record => record?.issued);
  if (relative.includes('hurdat2-atlantic')) return buildMetadata.sources.find(source => source.basin === 'AL').source_date;
  if (relative.includes('hurdat2-nepac')) return buildMetadata.sources.find(source => source.basin === 'EP').source_date;
  if (['data/landfalls.json', 'data/storms.json', 'data/storms.json.gz', 'data/stats.json', 'data/metadata.json', 'data/coverage.json'].includes(relative)) {
    return buildMetadata.generated_at_utc.slice(0, 10);
  }
  try {
    return execFileSync('git', ['log', '-1', '--format=%cI', '--', relative], {
      cwd: root,
      encoding: 'utf8',
    }).trim().slice(0, 10) || generatedAt.slice(0, 10);
  } catch {
    return generatedAt.slice(0, 10);
  }
}

function schemaVersion(relative, bytes) {
  if (relative.startsWith('data/stac/')) return 'STAC-1.1.0';
  if (relative === 'data/metadata.json') return 1;
  if (relative === 'data/coverage.json') return 1;
  if (relative === 'data/landfalls.json') return 1;
  if (relative === 'data/storms.json' || relative === 'data/storms.json.gz') return 1;
  if (relative === 'data/impacts.json') return 1;
  if (relative === 'data/aoml-landfalls.json') return 1;
  if (relative === 'data/aoml-us-landfalls.html') return 'AOML-HTML-current';
  if (relative.endsWith('.txt')) return 'HURDAT2-current';
  if (relative.endsWith('.png')) return 'IEM-NEXRAD-mosaic';
  if (relative.endsWith('.gz')) return 1;
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    return parsed?.schema_version ?? parsed?.schema ?? 1;
  } catch {
    return 1;
  }
}
