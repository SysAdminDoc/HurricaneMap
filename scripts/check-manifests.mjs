import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifests = [
  ['manifest.webmanifest', 'en-US'],
  ['manifest.es.webmanifest', 'es'],
  ['manifest.ht.webmanifest', 'ht'],
];
const errors = [];
const parsed = [];

for (const [relativePath, expectedLocale] of manifests) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: could not parse manifest (${error.message})`);
    continue;
  }
  parsed.push({ relativePath, expectedLocale, manifest });
  if (manifest.id !== './') errors.push(`${relativePath}: id must remain the stable relative root`);
  if (manifest.scope !== './') errors.push(`${relativePath}: scope must remain the deployed root`);
  if (manifest.start_url !== './') errors.push(`${relativePath}: start_url must remain the deployed root`);
  if (manifest.lang !== expectedLocale) errors.push(`${relativePath}: lang ${manifest.lang} does not match ${expectedLocale}`);
  if (manifest.dir !== 'ltr') errors.push(`${relativePath}: dir must be ltr`);
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 4) errors.push(`${relativePath}: icons are incomplete`);
  if (!Array.isArray(manifest.screenshots) || manifest.screenshots.length < 2) errors.push(`${relativePath}: screenshots are incomplete`);
  if (!Array.isArray(manifest.shortcuts) || manifest.shortcuts.length < 2) errors.push(`${relativePath}: shortcuts are incomplete`);

  for (const icon of manifest.icons || []) await checkAsset(relativePath, icon.src, 'icon');
  for (const screenshot of manifest.screenshots || []) await checkAsset(relativePath, screenshot.src, 'screenshot');
  for (const shortcut of manifest.shortcuts || []) {
    if (!shortcut.name?.trim() || !shortcut.description?.trim()) {
      errors.push(`${relativePath}: shortcut labels/descriptions must be non-empty`);
    }
    await checkAsset(relativePath, shortcut.url, 'shortcut');
  }
}

if (parsed.length === manifests.length) {
  const [reference] = parsed;
  for (const entry of parsed.slice(1)) {
    if (entry.manifest.id !== reference.manifest.id) errors.push(`${entry.relativePath}: identity differs from the English manifest`);
    if (entry.manifest.scope !== reference.manifest.scope) errors.push(`${entry.relativePath}: scope differs from the English manifest`);
    if (JSON.stringify(entry.manifest.icons) !== JSON.stringify(reference.manifest.icons)) {
      errors.push(`${entry.relativePath}: icon contract differs from the English manifest`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`manifest contract: ${error}`);
  process.exit(1);
}

console.log(`manifest contract ok (${parsed.length} locale manifests, ${parsed[0].manifest.icons.length} icons, ${parsed[0].manifest.shortcuts.length} shortcuts)`);

async function checkAsset(manifestPath, value, kind) {
  if (typeof value !== 'string' || !value || /[\\]/.test(value)) {
    errors.push(`${manifestPath}: ${kind} URL is not a safe relative path`);
    return;
  }
  try {
    const resolved = new URL(value, `https://hurricanemap.invalid/${manifestPath}`);
    if (resolved.origin !== 'https://hurricanemap.invalid' || resolved.pathname.includes('/../')) {
      errors.push(`${manifestPath}: ${kind} URL escapes the deployment scope: ${value}`);
      return;
    }
    const relative = resolved.pathname.replace(/^\/+/, '') || 'index.html';
    await access(path.join(root, relative));
  } catch (error) {
    errors.push(`${manifestPath}: ${kind} URL does not resolve locally: ${value} (${error.message})`);
  }
}
