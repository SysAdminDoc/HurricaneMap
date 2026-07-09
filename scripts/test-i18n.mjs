// Locale contract: every locale carries the full key set (no silent EN
// fallbacks for missing keys), values are non-empty, and numbered
// placeholders agree across locales.
import { STRINGS, t } from '../src/i18n.js';

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
assert(t('status.visibleCount', 42) === '42 visible', 'placeholder substitution failed');
assert(t('nonexistent.key') === 'nonexistent.key', 'unknown keys should echo the key');

console.log(`i18n ok (${locales.length} locales, ${enKeys.length} keys each)`);
