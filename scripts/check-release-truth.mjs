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

// README named Cesium 1.144 for a release that pinned 1.145. The policy file is
// the one the gates verify the SRI hashes against, so it is the authority.
{
  const policy = JSON.parse(await readFile(path.join(root, 'security/dependency-security-policy.json'), 'utf8'));
  const cesium = policy.vendors?.find(vendor => vendor.id === 'cesium')?.version;
  if (!cesium) {
    errors.push('dependency-security-policy.json declares no Cesium version to compare the README against');
  } else {
    // Every mention has to be the pin, not just one of them: a README naming
    // both the right version and a stale one passed the old substring test.
    // "CesiumJS", a "v" prefix and a line break between the name and the number
    // all named a version the first pattern here walked straight past, and
    // "1.145.0" against a pin of "1.145" failed a README that was right.
    const named = [...readme.matchAll(/Cesium(?:JS)?\s+v?(\d+(?:\.\d+){1,2})/gi)].map(match => match[1]);
    const sameVersion = (a, b) => {
      const parts = value => value.split('.').map(Number).concat([0, 0]).slice(0, 3);
      return parts(a).every((part, index) => part === parts(b)[index]);
    };
    if (!named.length) {
      errors.push(`README names no Cesium version; the reviewed pin is ${cesium}`);
    }
    for (const mention of new Set(named)) {
      if (!sameVersion(mention, cesium)) {
        errors.push(`README names Cesium ${mention} but the reviewed pin is ${cesium}`);
      }
    }
  }
}

// README pointed readers at LICENSE.md for three citation formats. The app
// emits two, and LICENSE.md carries those two.
// Any spelling, not one phrasing: "citation formats (Chicago, ...)",
// "Chicago-style", "in APA, BibTeX and Chicago form" all made the same claim.
if (/\bchicago\b/i.test(readme)) {
  errors.push('README mentions a Chicago citation format that neither LICENSE.md nor src/citation.js provides');
}
if (license && (!license.includes('In APA form:') || !license.includes('```bibtex'))) {
  errors.push('LICENSE.md must show the APA and BibTeX citations the app emits, each named');
}

// The download section points at release assets by name and by tag, and a
// version bump leaves every one of them pointing at the previous release. The
// README is where people arrive, so a stale link there hands them the old build.
{
  // An actual asset URL has to be there. Counting bare filenames meant a
  // Download section made entirely of a `tar -xzf hurricanemap-1.9.3-core.tar.gz`
  // fence, with no link at all, satisfied the check.
  const assetUrls = [...readme.matchAll(/releases\/download\/v(\d+\.\d+\.\d+)\//g)].map(match => match[1]);
  if (!assetUrls.length) {
    errors.push('README links no release asset, which is the only place the offline builds are published');
  }
  // Filenames and release-page links go stale the same way an asset URL does,
  // so every version the README writes down has to be this one.
  const mentioned = new Set([
    ...assetUrls,
    ...[...readme.matchAll(/hurricanemap-(\d+\.\d+\.\d+)-(?:core|full)\b/g)].map(match => match[1]),
    ...[...readme.matchAll(/releases\/tag\/v(\d+\.\d+\.\d+)\b/g)].map(match => match[1]),
  ]);
  for (const mentionedVersion of mentioned) {
    if (mentionedVersion !== version) {
      errors.push(`README points at v${mentionedVersion} but this is v${version}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`release truth: ${error}`);
  process.exit(1);
}

console.log(`release truth ok (v${version}, ${landfallCount} landfalls, ${impactCount} impact rows, skip link documented)`);
