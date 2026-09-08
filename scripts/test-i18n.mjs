// Locale contract: every locale carries the full key set (no silent EN
// fallbacks for missing keys), values are non-empty, and numbered
// placeholders agree across locales.
import { getLocale, loadLocale, setLocale, STRINGS, interpolate, t, tHtml } from '../src/i18n.js';
import { readFile } from 'node:fs/promises';
import { prepareSavedViewsImport } from '../src/saved-views.js';
import { formatDiagnosticAge } from '../src/diagnostics.js';
import { SAVED_VIEWS_SCHEMA_VERSION } from '../src/schema-contract.js';
import en from '../src/locales/en.js';
import es from '../src/locales/es.js';
import ht from '../src/locales/ht.js';
import { readdirSync, readFileSync } from 'node:fs';

globalThis.document = {
  documentElement: { lang: 'en' },
  dispatchEvent() {},
};

function assert(condition, message) {
  if (!condition) {
    console.error(`i18n test failed: ${message}`);
    process.exit(1);
  }
}

// The catalogs live in their own modules so a reader downloads one instead of
// three, and only English is imported eagerly by src/i18n.js. The key-set
// contract below is about the catalogs themselves, so read them directly.
const catalogs = { en, es, ht };
const locales = Object.keys(catalogs);
assert(locales.includes('en') && locales.includes('es') && locales.includes('ht'), 'expected en, es, ht locales');

// The lazy half of that arrangement is its own contract: English has to be
// there before anything is awaited, because it is the fallback for every key,
// and asking for the other two has to actually produce them.
assert(STRINGS.en === en, 'src/i18n.js must import the English catalog eagerly');
assert(!STRINGS.es && !STRINGS.ht, 'Spanish and Creole must not be loaded until asked for');
for (const locale of ['es', 'ht']) {
  const loaded = await loadLocale(locale);
  assert(loaded === catalogs[locale], `loadLocale('${locale}') did not resolve its catalog`);
  assert(STRINGS[locale] === catalogs[locale], `loadLocale('${locale}') did not publish into STRINGS`);
}

const enKeys = Object.keys(catalogs.en).sort();
for (const locale of locales) {
  const keys = Object.keys(catalogs[locale]).sort();
  const missing = enKeys.filter(key => !keys.includes(key));
  const extra = keys.filter(key => !enKeys.includes(key));
  assert(!missing.length, `${locale} is missing keys: ${missing.slice(0, 10).join(', ')}`);
  assert(!extra.length, `${locale} has keys absent from en: ${extra.slice(0, 10).join(', ')}`);
  for (const [key, value] of Object.entries(catalogs[locale])) {
    assert(typeof value === 'string' && value.trim().length > 0, `${locale}.${key} is empty`);
    // A locale may repeat a placeholder (es pluralizes noun+adjective with the
    // same {1}), but must never reference one the English source does not
    // supply, and must never drop one either. Dropping was allowed until
    // 2026-09-08 on the grounds that a locale might not need a grammatical
    // suffix, but a placeholder does not carry a suffix, it carries the value:
    // deleting {0} from 'Total registrado: {0}' loses the number itself,
    // and nothing went red. No key in any locale drops one, so this needs no
    // exceptions; add one here with its reason if a real case turns up.
    const enPlaceholders = new Set([...catalogs.en[key].matchAll(/\{\d\}/g)].map(match => match[0]));
    const localePlaceholders = new Set([...value.matchAll(/\{\d\}/g)].map(match => match[0]));
    const unknown = [...localePlaceholders].filter(ph => !enPlaceholders.has(ph));
    assert(!unknown.length, `${locale}.${key} references placeholders en does not supply: ${unknown.join(', ')}`);
    const dropped = [...enPlaceholders].filter(ph => !localePlaceholders.has(ph));
    assert(!dropped.length, `${locale}.${key} drops placeholders the English string supplies, so the value never reaches the reader: ${dropped.join(', ')}`);
  }
}

assert(t('category.1') === 'Category 1', 'default locale should resolve English');
assert(t('status.landfalls', 42) === '42 landfalls', 'placeholder substitution failed');
assert(interpolate('{0} / {0}', 'repeat') === 'repeat / repeat', 'repeated placeholders should all resolve');
assert(interpolate('Value: {0}', '$&') === 'Value: $&', 'replacement-pattern characters should stay literal');
assert(t('nonexistent.key') === 'nonexistent.key', 'unknown keys should echo the key');

// t() splices its arguments in as they are, because most of its callers assign
// the result to textContent, where escaping would show a literal &amp; for any
// name containing an ampersand. tHtml() is the variant for a string about to be
// inserted as HTML, and the popup-sink gate treats only that one as safe.
assert(t('status.landfalls', '<b>x</b>') === '<b>x</b> landfalls', 't() must not escape, so text callers are unaffected');
assert(tHtml('status.landfalls', '<b>x</b>') === '&lt;b&gt;x&lt;/b&gt; landfalls', 'tHtml() must escape a string argument');
assert(tHtml('status.landfalls', 42) === '42 landfalls', 'tHtml() must leave a number alone');
assert(tHtml('status.landfalls', 'Smith & Jones') === 'Smith &amp; Jones landfalls', 'tHtml() must escape an ampersand');
for (const locale of ['en', 'es', 'ht']) {
  await setLocale(locale);
  assert(getLocale() === locale, `setLocale did not select ${locale}`);
  assert(document.documentElement.lang === locale, `document language did not update to ${locale}`);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const staticKeys = [...html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria-label)?="([^"]+)"/g)]
  .map(match => match[1]);
for (const key of staticKeys) {
  assert(Object.hasOwn(catalogs.en, key), `index.html references unknown key: ${key}`);
}

// Keep the catalog from accumulating copy that no UI surface can render. A
// dynamic template or concatenated key is treated as a reference to its
// complete namespace, while static calls are checked as exact keys.
const referencedKeys = new Set(staticKeys);
const dynamicPrefixes = [];
const sourceFiles = readdirSync(new URL('../src/', import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'i18n.js')
  .map(entry => readFileSync(new URL(`../src/${entry.name}`, import.meta.url), 'utf8'))
  .concat(html)
  .map(source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/gm, '$1'));
for (const source of sourceFiles) {
  for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) referencedKeys.add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) dynamicPrefixes.push(match[1]);
  for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\+/g)) dynamicPrefixes.push(match[1]);
}
for (const key of enKeys) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactKey = new RegExp(`(?:^|[^\\w.-])${escapedKey}(?=$|[^\\w.-])`);
  if (sourceFiles.some(source => exactKey.test(source))) referencedKeys.add(key);
  if (dynamicPrefixes.some(prefix => key.startsWith(prefix))) referencedKeys.add(key);
}
const orphanKeys = enKeys.filter(key => !referencedKeys.has(key));
assert(!orphanKeys.length, `English catalog contains orphan keys: ${orphanKeys.join(', ')}`);

const glossary = JSON.parse(readFileSync(new URL('../data/glossary.json', import.meta.url), 'utf8'));
assert(glossary.length > 0 && glossary.every(entry => entry.language === 'en'), 'glossary rows must declare their English source language');
const disclosureSurfaces = [
  readFileSync(new URL('../src/glossary.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/panel.js', import.meta.url), 'utf8'),
];
assert(disclosureSurfaces.every(source => source.includes("t('content.englishSource')")), 'English-only educational surfaces must render the localized source-language disclosure');
for (const locale of locales) {
  const disclosure = STRINGS[locale]['content.englishSource'];
  assert(typeof disclosure === 'string' && /English|inglés|anglè/i.test(disclosure), `${locale} source-language disclosure must identify English`);
}

// Dynamic workflow markup must interpolate catalog strings instead of adding
// new English text or accessibility labels directly inside HTML templates.
const localizedWorkflowFiles = [
  '../src/onboarding.js',
  '../src/saved-views-ui.js',
  '../src/table-view.js',
  '../src/spatial-search.js',
  '../src/seasonal-outlook.js',
];
for (const relativePath of localizedWorkflowFiles) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const literalText = [...source.matchAll(/>[ \t]*(\p{L}[^\r\n<>{}$]*)[ \t]*</gu)]
    .map(match => match[1].trim())
    .filter(Boolean);
  const literalAttributes = [...source.matchAll(/\b(?:aria-label|placeholder|title)="(\p{L}[^"$]*)"/gu)]
    .map(match => match[1].trim())
    .filter(Boolean);
  const literalAssignments = [...source.matchAll(/\.(?:textContent|innerText|title)\s*=\s*['"](\p{L}[^'"]*)['"]/gu)]
    .map(match => match[1].trim())
    .filter(Boolean);
  const literals = [...literalText, ...literalAttributes, ...literalAssignments]
    .filter(value => !/^(?:NOAA CPC|Ready\.gov|American Red Cross)$/i.test(value));
  assert(!literals.length, `${relativePath} contains untranslated visible literals: ${literals.slice(0, 8).join(' | ')}`);
  assert(source.includes("from './i18n.js'"), `${relativePath} must source visible workflow copy from i18n.js`);
}

const localizedSurfaceContracts = [
  {
    path: '../src/on-this-date.js',
    keys: [
      // The three offset keys are gone: Intl.RelativeTimeFormat spells the
      // unit and the plural, and 'auto' supplies "today" without a string.
      'onthisdate.loading', 'onthisdate.atState', 'onthisdate.unnamedYear',
      'onthisdate.showDetails', 'state.unknown',
    ],
    forbidden: ['Finding historical landfalls near today...', '${lf.year} unnamed', '</strong> at ', 'Show full storm details'],
  },
  {
    path: '../src/climatology.js',
    keys: ['climatology.loading'],
    forbidden: ['Computing 174-year climatology…'],
  },
  {
    path: '../src/panel.js',
    keys: ['state.unknown'],
    forbidden: [],
  },
  {
    path: '../src/panel-controls.js',
    keys: ['panel.resumeTrack', 'panel.loadingPlayback'],
    forbidden: ['Resume track animation', 'Loading playback...'],
  },
];
for (const contract of localizedSurfaceContracts) {
  const source = readFileSync(new URL(contract.path, import.meta.url), 'utf8');
  for (const key of contract.keys) {
    assert(source.includes(`t('${key}'`), `${contract.path} must render ${key} through t()`);
  }
  for (const literal of contract.forbidden) {
    assert(!source.includes(literal), `${contract.path} still contains untranslated visible copy: ${literal}`);
  }
}

// Keys built at runtime from a value, which no static check sees. A missing one
// does not throw: t() falls back to English and then to the key itself, so the
// reader is shown "savedViews.importStatus.invalid-mode" as though it were a
// sentence. That is exactly what shipped.
//
// The statuses are collected by driving the module rather than by reading it.
// A regex over `status: '...'` also picks up `legacy` and `current`, which are
// set on the success path and never reach the renderer, because
// saved-views-ui.js only prints the status when there are errors to explain.
{
  const cases = [
    ['not json at all', { mode: 'merge' }],
    [JSON.stringify({ schema_version: 999, views: [] }), { mode: 'merge' }],
    [JSON.stringify({ schema_version: 0, views: [] }), { mode: 'merge' }],
    [JSON.stringify({ schema_version: SAVED_VIEWS_SCHEMA_VERSION, views: [{ name: '' }] }), { mode: 'merge' }],
    [JSON.stringify({ schema_version: SAVED_VIEWS_SCHEMA_VERSION, views: [] }), { mode: 'sideways' }],
  ];
  const rendered = new Set();
  for (const [input, options] of cases) {
    const preview = prepareSavedViewsImport(input, { ...options, existing: [] });
    // saved-views-ui.js renders the status only on the error branch.
    if ((preview.errors || []).length) rendered.add(preview.status);
  }
  assert(
    rendered.size >= 4,
    `expected several error statuses to be reachable, got ${[...rendered].join(', ') || 'none'}`,
  );
  for (const status of rendered) {
    assert(
      Object.hasOwn(en, `savedViews.importStatus.${status}`),
      `prepareSavedViewsImport returns status "${status}" on a path that renders it, and no catalog has savedViews.importStatus.${status}, so the reader would be shown the key`,
    );
  }

  // The same shape in the About dialog, keyed off whatever the coverage data
  // carries rather than off a list written here.
  const coverage = JSON.parse(await readFile(new URL('../data/coverage.json', import.meta.url), 'utf8'));
  const seen = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'value_status' || key === 'lifecycle_status') && typeof value === 'string') seen.add(value);
      walk(value);
    }
  };
  walk(coverage);
  assert(seen.size > 0, 'no value_status found in data/coverage.json, so this check would prove nothing');
  for (const status of seen) {
    assert(
      Object.hasOwn(en, `about.archiveCoverageStatus.${status}`),
      `data/coverage.json carries value_status "${status}" and no catalog has about.archiveCoverageStatus.${status}`,
    );
  }
}

// Relative times come from Intl.RelativeTimeFormat, so the unit and its plural
// are the language's own rather than something a catalog string spelled. The
// keys that used to spell them are gone, and nothing may bring them back: a
// per-locale plural is how English ended up able to say "1 days ago".
{
  const DAY = 86_400_000;
  const cases = [
    ['en', DAY, /^1 day ago$/],
    ['en', 2 * DAY, /^2 days ago$/],
    ['en', 45 * 60_000, /^45 min/],
    ['es', DAY, /^hace 1 d$/],
    ['es', 2 * DAY, /^hace 2 d$/],
    // ICU has no Haitian Creole, so this resolves through fr-HT the way dates
    // do. French puts U+00A0 between the number and the unit, not a plain
    // space, which is why these two patterns say \s and the others do not.
    ['ht', DAY, /^il y a 1\sj$/],
    ['ht', 2 * DAY, /^il y a 2\sj$/],
  ];
  for (const [locale, age, expected] of cases) {
    await loadLocale(locale);
    await setLocale(locale);
    const rendered = formatDiagnosticAge(age);
    assert(
      expected.test(rendered),
      `${locale}: an age of ${age} ms rendered "${rendered}", wanted ${expected}`,
    );
  }

  for (const key of [
    'diagnostics.minutesAgo', 'diagnostics.hoursAgo', 'diagnostics.daysAgo',
    'onthisdate.offsetToday', 'onthisdate.offsetIn', 'onthisdate.offsetAgo',
  ]) {
    assert(
      !Object.hasOwn(en, key),
      `${key} is back in the catalog; a per-locale string for a time unit is what this replaced`,
    );
  }
  await loadLocale('en');
  await setLocale('en');
}

console.log(`i18n ok (${locales.length} locales, ${enKeys.length} keys each)`);
