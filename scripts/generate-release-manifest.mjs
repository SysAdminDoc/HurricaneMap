import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'data');
const generatedAtFlag = process.argv.indexOf('--generated-at');
const generatedAt = generatedAtFlag >= 0 ? process.argv[generatedAtFlag + 1] : null;
if (!generatedAt || !/^\d{4}-\d{2}-\d{2}T/.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
  throw new Error('Pass a deterministic ISO timestamp with --generated-at');
}
const sourceCommitFlag = process.argv.indexOf('--source-commit');
const sourceCommit = sourceCommitFlag >= 0
  ? process.argv[sourceCommitFlag + 1]
  : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error('Pass a 40-character git revision with --source-commit or run inside a git checkout');
}

const metadata = JSON.parse(await readFile(path.join(dataRoot, 'metadata.json'), 'utf8'));
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
    source_date: sourceDate(relative, metadata),
    generated_at_utc: generatedAt,
    schema_version: schemaVersion(relative, bytes),
  });
}
const manifest = {
  schema_version: 1,
  generated_at_utc: generatedAt,
  source_commit: sourceCommit,
  algorithm: 'SHA-256',
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
  if (relative === 'data/hurdat2-sources.json') return 'https://www.nhc.noaa.gov/data/hurdat/';
  if (relative.startsWith('data/stac/')) return 'https://github.com/SysAdminDoc/HurricaneMap';
  if (relative.startsWith('data/radar/')) return 'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/';
  if (relative === 'data/us-states.geojson') return 'https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html';
  if (relative === 'data/impacts.json') return 'https://en.wikipedia.org/';
  if (relative === 'data/billions.json') return 'https://www.ncei.noaa.gov/access/billions/';
  if (relative.startsWith('data/surge-obs/')) return 'https://api.tidesandcurrents.noaa.gov/api/prod/';
  if (relative === 'data/storm-events.json') return 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
  if (relative === 'data/rainfall.json') return 'https://www.wpc.ncep.noaa.gov/tropical/rain/tcrainfall.html';
  if (relative === 'data/enso.json') return 'https://psl.noaa.gov/gcos_wgsp/Timeseries/Nino34/';
  if (relative === 'data/outlook.json') return 'https://www.cpc.ncep.noaa.gov/products/outlooks/hurricane.shtml';
  if (relative === 'data/distribution.json') return 'https://github.com/SysAdminDoc/HurricaneMap';
  if (relative === 'data/advisories.json') return 'https://ftp.nhc.noaa.gov/atcf/archive/';
  return 'https://www.nhc.noaa.gov/data/hurdat/';
}

function sourceDate(relative, buildMetadata) {
  const radarStamp = relative.match(/t_(\d{4})(\d{2})(\d{2})\d{4}\.png$/);
  if (radarStamp) return `${radarStamp[1]}-${radarStamp[2]}-${radarStamp[3]}`;
  const lockedSource = sourceLock.sources?.find(source => source.local_path === relative);
  if (lockedSource) return lockedSource.source_date;
  if (relative === 'data/hurdat2-sources.json') return sourceLock.sources.map(source => source.source_date).sort().at(-1);
  if (relative.startsWith('data/stac/')) return generatedAt.slice(0, 10);
  if (relative.includes('hurdat2-atlantic')) return buildMetadata.sources.find(source => source.basin === 'AL').source_date;
  if (relative.includes('hurdat2-nepac')) return buildMetadata.sources.find(source => source.basin === 'EP').source_date;
  if (['data/landfalls.json', 'data/storms.json', 'data/storms.json.gz', 'data/stats.json', 'data/metadata.json'].includes(relative)) {
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
  if (relative.startsWith('data/stac/')) return 'STAC-1.0.0';
  if (relative === 'data/metadata.json') return 1;
  if (relative === 'data/landfalls.json') return 1;
  if (relative === 'data/storms.json' || relative === 'data/storms.json.gz') return 1;
  if (relative === 'data/impacts.json') return 1;
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
