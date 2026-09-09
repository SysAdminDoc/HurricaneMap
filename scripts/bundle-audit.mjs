import { gzipSync } from 'node:zlib';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.tmp-bundle');
const INITIAL_GZIP_BUDGET = 100 * 1024;
// The awaited four come to 21.9 KB gzip. A budget with ten kilobytes of slack
// let enso.json, billions.json, rainfall.json or tide-stations.json move into
// the awaited set and still pass, which is the whole class of change this is
// meant to catch, so the slack is about one kilobyte.
const BOOT_DATA_GZIP_BUDGET = 23 * 1024;
const FIRST_PAINT_WATERFALL_DEPTH_BUDGET = 2;

const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const mainSource = await readFile(path.join(root, 'src/main.js'), 'utf8');
const linkTags = [...indexHtml.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
}
function normalizeAssetPath(value) {
  return value.replace(/^\.\//, '');
}

// The globe panel is hidden at load, but a hidden iframe still fetches its src
// unless it is lazy. Measured rather than asserted away: what a cold load no
// longer pays for is a number worth printing beside the bundle sizes, and it is
// the whole point of the attribute.
const iframeTags = [...indexHtml.matchAll(/<iframe\b[^>]*>/gi)].map(match => match[0]);
const eagerIframes = iframeTags.filter(tag => attribute(tag, 'loading').toLowerCase() !== 'lazy');
if (eagerIframes.length) {
  console.error(`Iframes fetch their src on a cold load: ${eagerIframes.map(tag => attribute(tag, 'id') || attribute(tag, 'src')).join(', ')}`);
  console.error('Add loading="lazy" so a panel nobody opens costs nothing.');
  process.exit(1);
}
const lazyFrameBytes = await lazyIframePayload(iframeTags);

const modulePreloadTags = linkTags.filter(tag => attribute(tag, 'rel').toLowerCase() === 'modulepreload');
const modulePreloadHrefs = new Set(modulePreloadTags.map(tag => normalizeAssetPath(attribute(tag, 'href'))));
const bootImportPaths = [...mainSource.matchAll(/\bfrom\s+['"](\.\/[^'"]+\.js)['"]/g)]
  .map(match => `src/${match[1].slice(2)}`);
const bootModules = [...new Set(['src/main.js', ...bootImportPaths])];
const missingBootPreloads = bootModules.filter(modulePath => !modulePreloadHrefs.has(modulePath));
if (missingBootPreloads.length) {
  console.error(`Boot-critical modules are not modulepreloaded: ${missingBootPreloads.join(', ')}`);
  process.exit(1);
}
for (const highPriorityModule of ['src/main.js', 'src/data.js']) {
  const tag = modulePreloadTags.find(candidate => normalizeAssetPath(attribute(candidate, 'href')) === highPriorityModule);
  if (attribute(tag || '', 'fetchpriority').toLowerCase() !== 'high') {
    console.error(`${highPriorityModule} modulepreload must use fetchpriority=high`);
    process.exit(1);
  }
}

const styleLayerPreloads = linkTags.filter(tag => attribute(tag, 'rel').toLowerCase() === 'preload' && attribute(tag, 'as').toLowerCase() === 'style');
const expectedStyleLayers = ['tokens', 'reset', 'base', 'shell', 'components', 'utilities', 'themes', 'accessibility']
  .map(layer => `src/styles-${layer}.css`);
const allStyleLayersPreloaded = expectedStyleLayers.every(href => styleLayerPreloads.some(tag => attribute(tag, 'href') === href));
const fontsPreloaded = ['fonts/inter-latin.woff2', 'fonts/jetbrains-mono-latin.woff2']
  .every(href => linkTags.some(tag => attribute(tag, 'rel').toLowerCase() === 'preload' && attribute(tag, 'as').toLowerCase() === 'font' && attribute(tag, 'href') === href));
const cssRequestDepth = allStyleLayersPreloaded ? 1 : 2;
const moduleRequestDepth = missingBootPreloads.length ? 2 : 1;
const firstDataRequestDepth = moduleRequestDepth + 1;
const fontRequestDepth = fontsPreloaded ? 1 : 2;
const firstPaintWaterfallDepth = Math.max(cssRequestDepth, firstDataRequestDepth, fontRequestDepth);
if (firstPaintWaterfallDepth > FIRST_PAINT_WATERFALL_DEPTH_BUDGET) {
  console.error(`First-paint request waterfall depth ${firstPaintWaterfallDepth} exceeds budget ${FIRST_PAINT_WATERFALL_DEPTH_BUDGET}.`);
  process.exit(1);
}

// What the first paint waits for in data, not just in code. The lists are read
// out of src/data.js rather than written down here, so a dataset moved between
// the awaited set and the deferred one changes this measurement immediately
// instead of leaving a stale table behind.
const dataSource = await readFile(path.join(root, 'src/data.js'), 'utf8');
function datasetsIn(source, pattern, description) {
  const block = source.match(pattern);
  if (!block) {
    console.error(`Bundle audit could not find ${description} in src/data.js.`);
    process.exit(1);
  }
  const files = [...block[1].matchAll(/'(data\/[^']+\.json)'/g)].map(match => match[1]);
  if (!files.length) {
    console.error(`Bundle audit found no datasets in ${description}.`);
    process.exit(1);
  }
  return files;
}
const bootDatasets = datasetsIn(
  dataSource,
  /export async function loadInitial\(\)[\s\S]*?await Promise\.all\(\[([\s\S]*?)\]\);/,
  "loadInitial's awaited dataset list",
);
const deferredDatasets = datasetsIn(
  dataSource,
  /export function ensureOptionalData\(\)[\s\S]*?Promise\.all\(\[([\s\S]*?)\]\)/,
  "ensureOptionalData's dataset list",
);
const bothWays = bootDatasets.filter(file => deferredDatasets.includes(file));
if (bothWays.length) {
  console.error(`Datasets are both awaited at boot and deferred: ${bothWays.join(', ')}`);
  process.exit(1);
}
const bootDataSizes = await Promise.all(bootDatasets.map(async (file) => ({
  file,
  gzip: gzipSync(await readFile(path.join(root, file))).byteLength,
})));
const bootDataGzip = bootDataSizes.reduce((sum, entry) => sum + entry.gzip, 0);
const deferredDataGzip = (await Promise.all(deferredDatasets.map(async (file) => (
  gzipSync(await readFile(path.join(root, file))).byteLength
)))).reduce((sum, bytes) => sum + bytes, 0);
if (bootDataGzip > BOOT_DATA_GZIP_BUDGET) {
  console.error(`First-paint data is ${formatBytes(bootDataGzip)} gzip, over the ${formatBytes(BOOT_DATA_GZIP_BUDGET)} target.`);
  for (const entry of bootDataSizes) console.error(`- ${entry.file}: ${formatBytes(entry.gzip)} gzip`);
  process.exit(1);
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  minify: true,
  treeShaking: true,
  target: ['es2022'],
  metafile: true,
  write: true,
  logLevel: 'silent',
});

const outputs = result.metafile.outputs;
const entry = Object.entries(outputs).find(([, meta]) => meta.entryPoint?.endsWith('src/main.js'));
if (!entry) {
  console.error('Bundle audit could not find the main.js entry output.');
  process.exit(1);
}

const initialFiles = collectStaticImports(entry[0], outputs);
const fileSizes = await Promise.all([...initialFiles].map(async (file) => {
  const source = await readFile(path.join(root, file));
  return {
    file,
    raw: source.byteLength,
    gzip: gzipSync(source).byteLength,
  };
}));

const initialGzip = fileSizes.reduce((sum, file) => sum + file.gzip, 0);
const lazyChunks = Object.entries(outputs)
  .filter(([file, meta]) => file.endsWith('.js') && !initialFiles.has(file) && !meta.entryPoint)
  .map(([file, meta]) => ({ file, raw: meta.bytes }))
  .sort((a, b) => b.raw - a.raw);

if (initialGzip > INITIAL_GZIP_BUDGET) {
  console.error(`Initial JS bundle is ${formatBytes(initialGzip)} gzip, over the ${formatBytes(INITIAL_GZIP_BUDGET)} target.`);
  console.error('Initial files:');
  for (const file of fileSizes) console.error(`- ${file.file}: ${formatBytes(file.gzip)} gzip`);
  process.exit(1);
}

const largestLazy = lazyChunks.slice(0, 5)
  .map(chunk => `${path.basename(chunk.file)} ${formatBytes(chunk.raw)} raw`)
  .join(', ');
console.log(`bundle audit ok (initial ${formatBytes(initialGzip)} gzip across ${initialFiles.size} file${initialFiles.size === 1 ? '' : 's'}; ${lazyChunks.length} lazy chunks${largestLazy ? `; largest: ${largestLazy}` : ''}; first-paint waterfall depth ${firstPaintWaterfallDepth}/${FIRST_PAINT_WATERFALL_DEPTH_BUDGET}; boot data ${formatBytes(bootDataGzip)}/${formatBytes(BOOT_DATA_GZIP_BUDGET)} gzip across ${bootDatasets.length}, ${formatBytes(deferredDataGzip)} deferred across ${deferredDatasets.length}; ${formatBytes(lazyFrameBytes.bytes)} across ${lazyFrameBytes.files} files deferred by lazy iframes)`);

// The document a lazy iframe points at, plus the stylesheets and scripts that
// document loads itself. Cesium is not counted: globe-host.js already defers it
// behind loadCesium(), so it was never part of a cold load.
async function lazyIframePayload(tags) {
  let total = 0;
  const counted = new Set();
  const add = async relative => {
    const clean = normalizeAssetPath(relative.split('?')[0].split('#')[0]);
    if (!clean || /^https?:/i.test(clean) || counted.has(clean)) return null;
    counted.add(clean);
    try {
      const body = await readFile(path.join(root, clean), 'utf8');
      total += Buffer.byteLength(body, 'utf8');
      return body;
    } catch {
      return null;
    }
  };
  for (const tag of tags) {
    const src = attribute(tag, 'src');
    if (!src) continue;
    const document = await add(src);
    if (!document) continue;
    for (const link of document.matchAll(/<link\b[^>]*>/gi)) {
      if (attribute(link[0], 'rel').toLowerCase() === 'stylesheet') await add(attribute(link[0], 'href'));
    }
    for (const script of document.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      await add(script[1]);
    }
  }
  return { bytes: total, files: counted.size };
}

function collectStaticImports(entryFile, outputs, seen = new Set()) {
  if (seen.has(entryFile)) return seen;
  seen.add(entryFile);
  const meta = outputs[entryFile];
  if (!meta?.imports) return seen;
  for (const item of meta.imports) {
    if (item.kind !== 'import-statement') continue;
    if (!outputs[item.path]) continue;
    collectStaticImports(item.path, outputs, seen);
  }
  return seen;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
