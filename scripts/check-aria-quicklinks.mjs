// The storm panel's quicklink row is checked against the ARIA snapshots that
// pin it, without a browser.
//
// `npm run build` does not run `test:aria` (it sits in NON_GATE_SCRIPTS), so
// renaming a quicklink landed green on main while `npm test` stayed red: the
// three storm-panel snapshots kept expecting a link label and URL that the app
// had stopped rendering. This gate reads the labels out of src/panel.js, walks
// the same run of links out of each locale snapshot, and fails when the two
// disagree.
import { readFile } from 'node:fs/promises';
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
const actionRow = panelSource.match(/<div class="action-row">([\s\S]*?)<\/div>/);
if (!actionRow) fail('src/panel.js no longer contains an action-row block');
const rawLabels = [...actionRow[1].matchAll(/<a class="action-btn[^"]*"[^>]*>([^<]+)<\/a>/g)].map(match => match[1].trim());
if (rawLabels.length < 2) fail(`expected several quicklinks in src/panel.js, found ${rawLabels.length}`);

const exportLabelKey = 'panel.exportTrack';
let checked = 0;

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
  for (let i = exportIndex - 1; i >= 0; i--) {
    const line = lines[i];
    const link = line.match(/^(\s*)- link "(.+)":$/);
    if (link && (rowIndent === null || link[1] === rowIndent)) {
      rowIndent = link[1];
      found.unshift(link[2]);
      continue;
    }
    if (rowIndent !== null && /^\s*- \/url:/.test(line) && line.length > rowIndent.length) continue;
    if (rowIndent === null && /^\s*- \/url:/.test(line)) continue;
    break;
  }
  if (!found.length) fail(`${locale}-storm-panel.aria.yml records no quicklinks above its export row`);

  // Not every quicklink renders for every storm, so the snapshot holds a
  // subset. It must still be an ordered subset of what src/panel.js emits.
  let cursor = 0;
  for (const label of found) {
    const at = expected.indexOf(label, cursor);
    if (at < 0) {
      fail(`${locale}-storm-panel.aria.yml expects the quicklink "${label}", which src/panel.js does not render in that order. src/panel.js emits: ${expected.join(', ')}`);
    }
    cursor = at + 1;
  }
  checked += found.length;
}

console.log(`aria quicklinks ok (${rawLabels.length} quicklinks in src/panel.js, ${checked} pinned across ${LOCALES.length} storm-panel snapshots)`);
