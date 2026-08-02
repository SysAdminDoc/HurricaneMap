// Locale contract: every locale carries the full key set (no silent EN
// fallbacks for missing keys), values are non-empty, and numbered
// placeholders agree across locales.
import { STRINGS, interpolate, t } from '../src/i18n.js';
import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error(`i18n test failed: ${message}`);
    process.exit(1);
  }
}

const locales = Object.keys(STRINGS);
assert(locales.includes('en') && locales.includes('es') && locales.includes('ht'), 'expected en, es, ht locales');

const enKeys = Object.keys(STRINGS.en).sort();
for (const locale of locales) {
  const keys = Object.keys(STRINGS[locale]).sort();
  const missing = enKeys.filter(key => !keys.includes(key));
  const extra = keys.filter(key => !enKeys.includes(key));
  assert(!missing.length, `${locale} is missing keys: ${missing.slice(0, 10).join(', ')}`);
  assert(!extra.length, `${locale} has keys absent from en: ${extra.slice(0, 10).join(', ')}`);
  for (const [key, value] of Object.entries(STRINGS[locale])) {
    assert(typeof value === 'string' && value.trim().length > 0, `${locale}.${key} is empty`);
    // A locale may repeat a placeholder (es pluralizes noun+adjective with the
    // same {1}) or omit one (ht has no plural suffix), but must never reference
    // a placeholder the English source doesn't supply.
    const enPlaceholders = new Set([...STRINGS.en[key].matchAll(/\{\d\}/g)].map(match => match[0]));
    const unknown = [...new Set([...value.matchAll(/\{\d\}/g)].map(match => match[0]))].filter(ph => !enPlaceholders.has(ph));
    assert(!unknown.length, `${locale}.${key} references placeholders en does not supply: ${unknown.join(', ')}`);
  }
}

assert(t('month.1') === 'January', 'default locale should resolve English');
assert(t('status.landfalls', 42) === '42 landfalls', 'placeholder substitution failed');
assert(interpolate('{0} / {0}', 'repeat') === 'repeat / repeat', 'repeated placeholders should all resolve');
assert(interpolate('Value: {0}', '$&') === 'Value: $&', 'replacement-pattern characters should stay literal');
assert(t('nonexistent.key') === 'nonexistent.key', 'unknown keys should echo the key');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const staticKeys = [...html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria-label)?="([^"]+)"/g)]
  .map(match => match[1]);
for (const key of staticKeys) {
  assert(Object.hasOwn(STRINGS.en, key), `index.html references unknown key: ${key}`);
}

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
