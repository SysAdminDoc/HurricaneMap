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
const sourceBundleAssets = parseAssetArray('SOURCE_BUNDLE_ASSETS');

if (!shellAssets) {
  console.error('sw.js does not define SHELL_ASSETS.');
  process.exit(1);
}
if (!offlineDataAssets) {
  console.error('sw.js does not define OFFLINE_DATA_ASSETS.');
  process.exit(1);
}
if (!sourceBundleAssets) {
  console.error('sw.js does not define SOURCE_BUNDLE_ASSETS.');
  process.exit(1);
}

const assets = [
  ['shell', shellAssets],
  ['offline data', offlineDataAssets],
  ['source bundle', sourceBundleAssets],
];
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
for (const sourceAsset of [
  './data/hurdat2-atlantic.txt',
  './data/hurdat2-nepac.txt',
  './data/release-manifest.json',
]) {
  if (!sourceBundleAssets.includes(sourceAsset)) {
    errors.push(`SOURCE_BUNDLE_ASSETS is missing optional source asset: ${sourceAsset}`);
  }
  if (offlineDataAssets.includes(sourceAsset)) {
    errors.push(`${sourceAsset} must not be precached as mandatory offline data`);
  }
}

if (!/indexedDB\.open/.test(source) || !/CompressionStream/.test(source) || !/DecompressionStream/.test(source)) {
  errors.push('sw.js offline data path must use IndexedDB plus compression/decompression support.');
}
if (!/const\s+DATA_CACHE_PREFIX\s*=\s*['"]hm-data-['"]/.test(source) ||
    !/const\s+DATA_CACHE\s*=\s*`\$\{DATA_CACHE_PREFIX\}\$\{SW_VERSION\}`/.test(source) ||
    !/const\s+RELEASE_MARKER_PATH/.test(source) ||
    !/validateReleaseBundle\(\)/.test(source) ||
    !/Required release manifest failed/.test(source) ||
    !/const\s+SOURCE_BUNDLE_CACHE\s*=\s*['"]hm-source-bundle-v1['"]/.test(source) ||
    !/SOURCE_BUNDLE_MARKER_PATH/.test(source) ||
    !/sourceBundleWhileRevalidate/.test(source)) {
  errors.push('sw.js must stage a versioned data cache and validate its release tuple before activation.');
}
if (!/RADAR_CACHE_MAX_ENTRIES/.test(source) || !/trimCache\(RADAR_CACHE,\s*RADAR_CACHE_MAX_ENTRIES\)/.test(source)) {
  errors.push('sw.js must cap the on-demand radar cache.');
}
if (!/pruneOfflineData\(\)/.test(source) || !/idbDeleteExcept/.test(source)) {
  errors.push('sw.js activate path must prune removed offline-data records.');
}
if (!/const\s+DATA_DB_VERSION\s*=\s*1/.test(source) ||
    !/LEGACY_DATA_DBS\s*=\s*\[['"]hm-offline-data-v1['"],\s*['"]hm-offline-data-v2['"]\]/.test(source) ||
    !/deleteLegacyDataDbs\(\)/.test(source)) {
  errors.push('sw.js must version IndexedDB and remove superseded database generations during activation.');
}

const radarBranch = source.indexOf('if (isRadarAsset(url))');
const shellBranch = source.indexOf('if (isShell(url))');
if (radarBranch < 0 || shellBranch < 0 || radarBranch > shellBranch) {
  errors.push('fetch handler must route radar PNGs before generic shell/image caching.');
}

for (const [label, collection] of assets) {
  for (const asset of collection) {
    if (seen.has(asset)) {
      errors.push(`Duplicate ${label} asset: ${asset}`);
      continue;
    }
    seen.add(asset);

    if (asset === './') continue;
    const normalized = path.normalize(asset.replace(/^\.\//, ''));
    const resolved = path.resolve(root, normalized);
    if (!resolved.startsWith(root)) {
      errors.push(`${label} asset escapes repository root: ${asset}`);
      continue;
    }
    try {
      await access(resolved);
    } catch {
      errors.push(`${label} asset is missing: ${asset}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`service worker ok (${versionMatch[1]}, ${shellAssets.length} shell assets, ${offlineDataAssets.length} offline data assets, ${sourceBundleAssets.length} source assets)`);

function parseAssetArray(name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) return null;
  return [...match[1].matchAll(/['"](\.\/[^'"]*)['"]/g)].map(assetMatch => assetMatch[1]);
}
