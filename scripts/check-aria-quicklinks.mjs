// The storm panel's quicklink row is checked against the ARIA snapshots that
// pin it, without a browser.
//
// `npm run build` does not run `test:aria` (it sits in NON_GATE_SCRIPTS), so
// renaming a quicklink landed green on main while `npm test` stayed red: the
// three storm-panel snapshots kept expecting a link label and URL that the app
// had stopped rendering. This gate reads the labels out of src/panel.js, walks
// the same run of links out of each locale snapshot, and fails when the two
// disagree.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// i18n.js resolves the initial locale from the document element.
globalThis.document = { documentElement: { lang: 'en' }, dispatchEvent() {} };
const { STRINGS } = await import('../src/i18n.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'es', 'ht'];
const SNAPSHOT_DIR = 'tests/aria-regression.spec.mjs-snapshots';

function fail(message) {
  console.error(`aria quicklinks: ${message}`);
  process.exit(1);
}

// A label is either a plain string in the template or a single t() call. Both
// are resolved per locale so the check reads the same text the snapshot holds.
function resolveLabel(raw, locale) {
  const translated = raw.match(/^\$\{t\('([^']+)'\)\}$/);
  if (translated) {
    const value = STRINGS[locale]?.[translated[1]];
    if (!value) fail(`quicklink label uses t('${translated[1]}'), which ${locale} does not define`);
    return value;
  }
  if (raw.includes('${')) fail(`quicklink label is not a literal or a bare t() call: ${raw}`);
  return raw;
}

const panelSource = await readFile(path.join(root, 'src/panel.js'), 'utf8');
// The row lives in panel.js, but its hrefs are assembled by helpers spread
// across panel-impacts.js, impact-utils.js and links.js. Reading the whole
// module directory keeps the corpus from going stale as helpers move.
const srcDir = path.join(root, 'src');
const linkSource = (await Promise.all(
  (await readdir(srcDir)).filter(name => name.endsWith('.js')).map(name => readFile(path.join(srcDir, name), 'utf8')),
)).join('\n');
const actionRow = panelSource.match(/<div class="action-row">([\s\S]*?)<\/div>/);
if (!actionRow) fail('src/panel.js no longer contains an action-row block');
const quicklinks = [...actionRow[1].matchAll(/<a class="action-btn[^"]*" href="([^"]*)"[^>]*>([^<]+)<\/a>/g)]
  .map(match => ({ href: match[1], label: match[2].trim() }));
if (quicklinks.length < 2) fail(`expected several quicklinks in src/panel.js, found ${quicklinks.length}`);
const rawLabels = quicklinks.map(link => link.label);

const exportLabelKey = 'panel.exportTrack';
let checked = 0;
let checkedUrls = 0;

for (const locale of LOCALES) {
  const expected = rawLabels.map(raw => resolveLabel(raw, locale));
  const snapshotPath = path.join(root, SNAPSHOT_DIR, `${locale}-storm-panel.aria.yml`);
  const lines = (await readFile(snapshotPath, 'utf8')).split('\n');

  // The quicklink row sits immediately above the export row in the DOM, and
  // the snapshot preserves that order. Anchoring on the export label finds the
  // run without needing a marker the accessibility tree does not carry.
  const exportText = STRINGS[locale]?.[exportLabelKey];
  if (!exportText) fail(`${locale} does not define ${exportLabelKey}`);
  const exportIndex = lines.findIndex(line => line.includes(`- text: "${exportText}:"`));
  if (exportIndex < 0) fail(`${locale}-storm-panel.aria.yml has no "${exportText}:" export row to anchor on`);

  // Indentation matters: the FEMA section above the row nests its own links
  // deeper, and without pinning the depth the walk runs straight into them.
  const found = [];
  let rowIndent = null;
  let pendingUrl = null;
  for (let i = exportIndex - 1; i >= 0; i--) {
    const line = lines[i];
    const link = line.match(/^(\s*)- link "(.+)":$/);
    if (link && (rowIndent === null || link[1] === rowIndent)) {
      rowIndent = link[1];
      found.unshift({ label: link[2], url: pendingUrl });
      pendingUrl = null;
      continue;
    }
    const url = line.match(/^\s*- \/url: (.+)$/);
    if (url) {
      pendingUrl = url[1].trim();
      continue;
    }
    break;
  }
  if (!found.length) fail(`${locale}-storm-panel.aria.yml records no quicklinks above its export row`);

  // Not every quicklink renders for every storm, so the snapshot holds a
  // subset. It must still be an ordered subset of what src/panel.js emits.
  let cursor = 0;
  for (const { label } of found) {
    const at = expected.indexOf(label, cursor);
    if (at < 0) {
      fail(`${locale}-storm-panel.aria.yml expects the quicklink "${label}", which src/panel.js does not render in that order. src/panel.js emits: ${expected.join(', ')}`);
    }
    cursor = at + 1;
  }

  // Labels alone are half the contract. The rot this gate exists to catch was
  // a label rename and a URL swap in the same commit, and a URL-only change
  // would still leave test:aria red and this gate green. Every host and path
  // a snapshot pins has to still appear in the source that builds the link.
  for (const { label, url } of found) {
    if (!url) fail(`${locale}-storm-panel.aria.yml records the quicklink "${label}" with no URL`);
    const { host, pathname } = new URL(url);
    if (!linkSource.includes(host)) {
      fail(`${locale}-storm-panel.aria.yml pins "${label}" at ${host}, a host the panel no longer builds links for`);
    }
    // Fixed paths are a contract; per-storm paths are assembled at render time
    // and only their host is checkable here.
    const fixedPath = pathname.length > 1 && !/\d/.test(pathname);
    if (fixedPath && !linkSource.includes(pathname)) {
      fail(`${locale}-storm-panel.aria.yml pins "${label}" at ${pathname}, a path the panel no longer contains`);
    }
    checkedUrls++;
  }
  checked += found.length;
}

console.log(`aria quicklinks ok (${rawLabels.length} quicklinks in src/panel.js, ${checked} labels and ${checkedUrls} URLs pinned across ${LOCALES.length} storm-panel snapshots)`);
