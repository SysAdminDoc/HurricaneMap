import { gzipSync } from 'node:zlib';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.tmp-bundle');
const INITIAL_GZIP_BUDGET = 100 * 1024;

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
console.log(`bundle audit ok (initial ${formatBytes(initialGzip)} gzip across ${initialFiles.size} file${initialFiles.size === 1 ? '' : 's'}; ${lazyChunks.length} lazy chunks${largestLazy ? `; largest: ${largestLazy}` : ''})`);

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
