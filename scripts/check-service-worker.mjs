import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(root, 'sw.js');
const source = await readFile(swPath, 'utf8');

const versionMatch = source.match(/const\s+SW_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!versionMatch) {
  console.error('sw.js does not define SW_VERSION.');
  process.exit(1);
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const expectedSwVersion = `hm-v${packageJson.version}`;
if (versionMatch[1] !== expectedSwVersion) {
  console.error(`sw.js SW_VERSION ${versionMatch[1]} does not match package.json ${expectedSwVersion}.`);
  process.exit(1);
}

if (!/addEventListener\(\s*['"]message['"]/.test(source) || !/SKIP_WAITING/.test(source)) {
  console.error('sw.js must listen for SKIP_WAITING messages so users control update activation.');
  process.exit(1);
}

const shellAssets = parseAssetArray('SHELL_ASSETS');
const offlineDataAssets = parseAssetArray('OFFLINE_DATA_ASSETS');

if (!shellAssets) {
  console.error('sw.js does not define SHELL_ASSETS.');
  process.exit(1);
}
if (!offlineDataAssets) {
  console.error('sw.js does not define OFFLINE_DATA_ASSETS.');
  process.exit(1);
}

const assets = [...shellAssets, ...offlineDataAssets];
const errors = [];
const seen = new Set();

const srcModules = (await readdir(path.join(root, 'src'), { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => `./src/${entry.name}`)
  .sort();
for (const modulePath of srcModules) {
  if (!shellAssets.includes(modulePath)) {
    errors.push(`SHELL_ASSETS is missing application module: ${modulePath}`);
  }
}

for (const required of [
  './data/landfalls.json',
  './data/storms.json.gz',
  './data/stats.json',
  './data/metadata.json',
  './data/us-states.geojson',
  './data/hurdat2-sources.json',
  './data/radar/manifest.json',
]) {
  if (!offlineDataAssets.includes(required)) {
    errors.push(`OFFLINE_DATA_ASSETS is missing required historical dataset: ${required}`);
  }
}

if (!/indexedDB\.open/.test(source) || !/CompressionStream/.test(source) || !/DecompressionStream/.test(source)) {
  errors.push('sw.js offline data path must use IndexedDB plus compression/decompression support.');
}
if (!/RADAR_CACHE_MAX_ENTRIES/.test(source) || !/trimCache\(RADAR_CACHE,\s*RADAR_CACHE_MAX_ENTRIES\)/.test(source)) {
  errors.push('sw.js must cap the on-demand radar cache.');
}
if (!/pruneOfflineData\(\)/.test(source) || !/idbDeleteExcept/.test(source)) {
  errors.push('sw.js activate path must prune removed offline-data records.');
}
if (!/const\s+DATA_DB_VERSION\s*=\s*1/.test(source) ||
    !/LEGACY_DATA_DBS\s*=\s*\[['"]hm-offline-data-v1['"]\]/.test(source) ||
    !/deleteLegacyDataDbs\(\)/.test(source)) {
  errors.push('sw.js must version IndexedDB and remove the superseded v1 database during activation.');
}

const radarBranch = source.indexOf('if (isRadarAsset(url))');
const shellBranch = source.indexOf('if (isShell(url))');
if (radarBranch < 0 || shellBranch < 0 || radarBranch > shellBranch) {
  errors.push('fetch handler must route radar PNGs before generic shell/image caching.');
}

for (const asset of assets) {
  if (seen.has(asset)) {
    errors.push(`Duplicate shell asset: ${asset}`);
    continue;
  }
  seen.add(asset);

  if (asset === './') continue;
  const normalized = path.normalize(asset.replace(/^\.\//, ''));
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(root)) {
    errors.push(`Shell asset escapes repository root: ${asset}`);
    continue;
  }
  try {
    await access(resolved);
  } catch {
    errors.push(`Shell asset is missing: ${asset}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`service worker ok (${versionMatch[1]}, ${shellAssets.length} shell assets, ${offlineDataAssets.length} offline data assets)`);

function parseAssetArray(name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) return null;
  return [...match[1].matchAll(/['"](\.\/[^'"]*)['"]/g)].map(assetMatch => assetMatch[1]);
}
