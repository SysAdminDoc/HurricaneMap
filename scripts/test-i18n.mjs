// Locale contract: every locale carries the full key set (no silent EN
// fallbacks for missing keys), values are non-empty, and numbered
// placeholders agree across locales.
import { getLocale, loadLocale, setLocale, STRINGS, interpolate, t, tHtml } from '../src/i18n.js';
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
    // deleting {0} from 'Total registrado: {0} días' loses the number itself,
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
      'onthisdate.loading', 'onthisdate.offsetToday', 'onthisdate.offsetIn',
      'onthisdate.offsetAgo', 'onthisdate.atState', 'onthisdate.unnamedYear',
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

console.log(`i18n ok (${locales.length} locales, ${enKeys.length} keys each)`);
