import { gzipSync } from 'node:zlib';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.tmp-bundle');
const INITIAL_GZIP_BUDGET = 100 * 1024;
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
console.log(`bundle audit ok (initial ${formatBytes(initialGzip)} gzip across ${initialFiles.size} file${initialFiles.size === 1 ? '' : 's'}; ${lazyChunks.length} lazy chunks${largestLazy ? `; largest: ${largestLazy}` : ''}; first-paint waterfall depth ${firstPaintWaterfallDepth}/${FIRST_PAINT_WATERFALL_DEPTH_BUDGET})`);

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
