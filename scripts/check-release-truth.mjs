import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_CONTRACT, DATA_SCHEMA_VERSION } from '../src/schema-contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const readOptional = async relative => {
  try {
    return await read(relative);
  } catch {
    return null;
  }
};

const [
  packageText,
  metadataText,
  sourceLockText,
  impactsText,
  readme,
  serviceWorker,
  indexHtml,
  vpat,
  license,
  claude,
  preprocessor,
  landfallsText,
  notebooksReadme,
] = await Promise.all([
  read('package.json'),
  read('data/metadata.json'),
  read('data/hurdat2-sources.json'),
  read('data/impacts.json'),
  read('README.md'),
  read('sw.js'),
  read('index.html'),
  read('docs/VPAT.html'),
  readOptional('LICENSE.md'),
  readOptional('CLAUDE.md'),
  read('scripts/preprocess_hurdat2.py'),
  read('data/landfalls.json'),
  read('notebooks/README.md'),
]);

const packageJson = JSON.parse(packageText);
const metadata = JSON.parse(metadataText);
const sourceLock = JSON.parse(sourceLockText);
const impacts = JSON.parse(impactsText);
const landfalls = JSON.parse(landfallsText);
const version = packageJson.version;
const impactCount = Object.keys(impacts).filter(key => key !== '_meta').length;
const landfallCount = landfalls.length;
const errors = [];

if (metadata.generator?.app_version !== version) {
  errors.push(`metadata generator version ${metadata.generator?.app_version} does not match package ${version}`);
}
if (metadata.schema_version !== DATA_SCHEMA_VERSION) {
  errors.push(`metadata schema ${metadata.schema_version} does not match supported schema ${DATA_SCHEMA_VERSION}`);
}
if (!/^[a-f0-9]{40}$/.test(metadata.generator?.source_commit || '')) {
  errors.push('metadata generator must record a 40-character git source revision');
}
if (metadata.generator?.source_manifest !== 'data/hurdat2-sources.json' || sourceLock.schema_version !== 1) {
  errors.push('metadata and source lock must identify the version 1 HURDAT2 source manifest');
}
if (!Array.isArray(sourceLock.sources) || sourceLock.sources.length !== 2) {
  errors.push('HURDAT2 source lock must contain both basin revisions');
}
for (const cacheName of [CACHE_CONTRACT.data, CACHE_CONTRACT.tiles, CACHE_CONTRACT.radar, CACHE_CONTRACT.offlineDb]) {
  if (!serviceWorker.includes(`'${cacheName}'`)) {
    errors.push(`service worker does not implement compatibility cache ${cacheName}`);
  }
}
if (!preprocessor.includes(`METADATA_SCHEMA_VERSION = ${DATA_SCHEMA_VERSION}`)) {
  errors.push(`HURDAT2 preprocessor does not emit metadata schema ${DATA_SCHEMA_VERSION}`);
}
if (!preprocessor.includes('normalize_generated_at') || preprocessor.includes('datetime.now(')) {
  errors.push('HURDAT2 preprocessor must use an explicit generation timestamp instead of the wall clock');
}
if (!serviceWorker.includes(`const DATA_DB_VERSION = ${CACHE_CONTRACT.offlineDbVersion}`)) {
  errors.push(`service worker IndexedDB version does not match ${CACHE_CONTRACT.offlineDbVersion}`);
}
for (const legacyDb of CACHE_CONTRACT.legacyOfflineDbs) {
  if (!serviceWorker.includes(`'${legacyDb}'`)) {
    errors.push(`service worker does not retire legacy IndexedDB ${legacyDb}`);
  }
}
if (metadata.coverage?.impact_row_count !== impactCount) {
  errors.push(`metadata impact_row_count ${metadata.coverage?.impact_row_count} does not match ${impactCount} impact rows`);
}
if (metadata.coverage?.landfall_event_count !== landfallCount) {
  errors.push(`metadata landfall_event_count ${metadata.coverage?.landfall_event_count} does not match ${landfallCount} records`);
}
if (!serviceWorker.includes(`const SW_VERSION = 'hm-v${version}'`)) {
  errors.push(`service worker does not declare hm-v${version}`);
}
if (!readme.includes(`version-${version}-blue.svg`)) {
  errors.push(`README version badge does not declare ${version}`);
}
if (!readme.includes(`What's new in v${version}`)) {
  errors.push(`README does not contain a What's new section for v${version}`);
}
if (!readme.includes(`(${impactCount} storms covered so far;`)) {
  errors.push(`README impact coverage does not declare ${impactCount} storms`);
}
if (!readme.includes(`${landfallCount} landfall events`)) {
  errors.push(`README landfall coverage does not declare ${landfallCount} events`);
}
if (!notebooksReadme.includes(`${landfallCount} landfall events`)) {
  errors.push(`notebooks/README.md landfall coverage does not declare ${landfallCount} events`);
}
if (!/<a\s+href="#main"\s+class="skip-to-content"/i.test(indexHtml) || !/<main\s+id="main"\s+tabindex="-1"/i.test(indexHtml)) {
  errors.push('index.html does not expose the skip-to-main link and landmark');
}
if (!/<td>2\.4\.1 Bypass Blocks<\/td><td>A<\/td><td class="supports">Supports<\/td>/i.test(vpat)) {
  errors.push('VPAT does not mark WCAG 2.4.1 Bypass Blocks as supported');
}
if (/skip-to-content link (?:is )?not (?:yet )?implemented/i.test(vpat)) {
  errors.push('VPAT still claims the skip-to-content link is absent');
}
if (license && !license.includes(`**Entries Covered:** ${impactCount} storms`)) {
  errors.push(`LICENSE.md impact coverage does not declare ${impactCount} storms`);
}
if (claude && /ALL FIXES DEFERRED|all version strings synced at 1\.5\.0/.test(claude)) {
  errors.push('CLAUDE.md still describes the completed v1.5.0 audit as deferred');
}

if (errors.length) {
  for (const error of errors) console.error(`release truth: ${error}`);
  process.exit(1);
}

console.log(`release truth ok (v${version}, ${landfallCount} landfalls, ${impactCount} impact rows, skip link documented)`);
