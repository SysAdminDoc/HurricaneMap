// Internationalization (i18n) — English, Spanish (ES-LA), Haitian Creole
// Single source of truth for all user-facing strings.

import { escapeHtml as escapeHtmlValue, setUnnamedStormLabel } from './html-utils.js';
import en from './locales/en.js';

const LOCALE_EN = 'en';
const LOCALE_ES = 'es';
const LOCALE_HT = 'ht';
const SUPPORTED_LOCALES = new Set([LOCALE_EN, LOCALE_ES, LOCALE_HT]);

// English ships with the shell. It is both the default and the fallback for a
// key another catalog is missing, so it can never be fetched late. The other
// two are 120 KB between them that a reader of one language should not have to
// download to read another, and they arrive on demand.
//
// Both specifiers are string literals rather than anything computed: sw.js
// builds its precache by walking import specifiers out of the module graph, and
// a template literal would be invisible to it, which would leave the catalog
// missing offline in exactly the locale the reader chose.
const LOCALE_LOADERS = {
  [LOCALE_ES]: () => import('./locales/es.js'),
  [LOCALE_HT]: () => import('./locales/ht.js'),
};

export const STRINGS = { [LOCALE_EN]: en };

const pendingLocales = new Map();

/** Resolves once this locale's catalog is in STRINGS. English already is. */
export function loadLocale(locale) {
  if (!SUPPORTED_LOCALES.has(locale)) return Promise.resolve(STRINGS[LOCALE_EN]);
  if (STRINGS[locale]) return Promise.resolve(STRINGS[locale]);
  if (pendingLocales.has(locale)) return pendingLocales.get(locale);
  const pending = LOCALE_LOADERS[locale]()
    .then(module => {
      STRINGS[locale] = module.default;
      return STRINGS[locale];
    })
    .catch(error => {
      // A catalog that will not load must not take the page down. English is
      // complete, so the reader keeps a working atlas in the wrong language.
      console.warn(`Locale catalog unavailable: ${locale}`, error);
      return STRINGS[LOCALE_EN];
    })
    .finally(() => pendingLocales.delete(locale));
  pendingLocales.set(locale, pending);
  return pending;
}

let currentLocale = LOCALE_EN;

/**
 * Switch locale, and return a promise that settles once the catalog is in place
 * and `hm-locale:change` has been dispatched.
 *
 * When the catalog is already loaded, which is always true for English and true
 * for the others after the first switch, the change applies synchronously
 * before this returns, exactly as it did when all three shipped inline. Only
 * the first switch to Spanish or Creole has to wait, and only for the catalog.
 * Callers that read `t()` on the next line should await this; the app's own
 * surfaces re-render from the event instead.
 */
export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.has(locale)) return Promise.resolve(currentLocale);
  const apply = () => {
    currentLocale = locale;
    setUnnamedStormLabel(t('storm.unnamed'));
    document.documentElement.lang = locale;
    document.dispatchEvent(new CustomEvent('hm-locale:change', { detail: { locale } }));
    return currentLocale;
  };
  if (STRINGS[locale]) return Promise.resolve(apply());
  return loadLocale(locale).then(apply);
}

export function getLocale() {
  return currentLocale;
}

// ICU carries no data for `ht`, so `toLocaleString('ht', ...)` resolves to the
// runtime default, which is the browser locale this app deliberately does not
// use: a Creole reader on an English browser got "Aug 24, 2005" inside an
// otherwise Creole panel, and the accessibility baselines had it recorded as
// correct. French is Haiti's other official language and ICU does carry
// `fr-HT`, so dates resolve there. Anything unresolvable lands on English by
// name rather than on whatever the browser happens to be, because falling back
// to the reader's browser is the bug this exists to remove.
const DATE_LOCALES = { [LOCALE_HT]: 'fr-HT' };

export function getDateLocale(locale = currentLocale) {
  const mapped = DATE_LOCALES[locale] || locale;
  return Intl.DateTimeFormat.supportedLocalesOf([mapped])[0] || LOCALE_EN;
}

// "3 days ago" and "in 4 days" were assembled from catalog strings that spelled
// the unit themselves, so each locale carried its own plural handling and none
// of them had the language's real plural rules: English rendered "1 days ago".
// Intl.RelativeTimeFormat has had them since 2020.
//
// `numeric: 'auto'` is what turns 0 into "today" and -1 into "yesterday", so a
// caller that wants those words asks for it, and a caller that wants a count
// every time asks for 'always'.
// ICU carries no data for Haitian Creole, so the fr-HT mapping that keeps dates
// working answers in French, and a Creole reader was shown "il y a 3 j" where
// the catalog had said "sa gen 3 jou". Taking the words from the language is
// right everywhere ICU knows the language. Where it does not, they have to come
// from somewhere, and for this one the rule is trivial: Kreyol marks no
// agreement on number, so a single pattern per unit is correct for every count.
// That is the rule ICU would encode if it carried the locale, not a per-locale
// guess at plurals of the kind the catalog keys were.
const HT_RELATIVE_UNITS = { minute: 'min', hour: 'èdtan', day: 'jou' };

function formatCreoleRelativeTime(value, unit, numeric) {
  const word = HT_RELATIVE_UNITS[unit];
  if (!word) return null;
  const count = Math.abs(value);
  if (numeric === 'auto' && count === 0) return unit === 'day' ? 'jodi a' : null;
  // <= rather than <, because -0 < 0 is false and formatDiagnosticAge hands
  // this -0 for anything under half a minute: a freshly checked feed read
  // "nan 0 min", which is "in 0 minutes", where English says "0 min. ago".
  return value <= 0 ? `sa gen ${count} ${word}` : `nan ${count} ${word}`;
}

export function formatRelativeTime(value, unit, { numeric = 'always' } = {}) {
  // A shared export reached from more than one panel, so a value that cannot be
  // formatted says nothing rather than throwing the panel away with it.
  if (!Number.isFinite(value)) return '';
  if (currentLocale === LOCALE_HT) {
    const creole = formatCreoleRelativeTime(value, unit, numeric);
    if (creole) return creole;
  }
  return new Intl.RelativeTimeFormat(getDateLocale(), { numeric, style: 'short' })
    .format(value, unit);
}

export function t(key, ...args) {
  const strings = STRINGS[currentLocale] || STRINGS[LOCALE_EN];
  // Partial locales (ht) fall back to English before exposing the raw key.
  let str = strings[key] || STRINGS[LOCALE_EN][key] || key;

  return interpolate(str, ...args);
}

/**
 * `t()` for a string that is about to be inserted as HTML.
 *
 * `t()` itself cannot escape its arguments. Most of its callers assign the
 * result to `textContent`, where escaping would put a literal `&amp;` on screen
 * for any storm or state whose name contains an ampersand, so the decision has
 * to be made at the call site rather than inside `interpolate`. This is that
 * call site. The catalog string is left alone, because the keys ending in
 * `Html` carry deliberate markup; only the interpolated values are escaped,
 * which is where a value from data or from a user could arrive.
 */
export function tHtml(key, ...args) {
  return t(key, ...args.map(arg => (typeof arg === 'string' ? escapeHtmlValue(arg) : arg)));
}

export function interpolate(template, ...args) {
  let result = String(template);
  for (let i = 0; i < args.length; i++) {
    // split/join replaces every occurrence without treating `$&` and friends
    // in user-supplied values as replacement patterns.
    result = result.split(`{${i}}`).join(String(args[i]));
  }
  return result;
}

/**
 * Detect the locale from the browser language. Returns the detected locale
 * synchronously, as it always has, so boot can branch on it; the catalog it
 * needs is still arriving, which is what `initLocaleReady` is for.
 */
export function initLocale() {
  // Explicit picks persist via the settings store (main.js applies them after
  // this call); here we only auto-detect from the browser language.
  const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  if (browserLang.startsWith('ht') || browserLang === 'fr-ht') return detectLocale(LOCALE_HT);
  if (browserLang.startsWith('es')) return detectLocale(LOCALE_ES);
  return currentLocale;
}

let localeReady = Promise.resolve(LOCALE_EN);

function detectLocale(locale) {
  localeReady = setLocale(locale);
  return locale;
}

/**
 * Resolves once the catalog for whatever `initLocale` or `setLocale` last chose
 * has been applied. Boot awaits this before the first translation pass, so a
 * Spanish or Creole reader never sees the English shell paint first.
 */
export function initLocaleReady() {
  return localeReady;
}

export function translateStaticElements() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.textContent = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    const key = el.dataset.i18nHtml;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.innerHTML = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.title = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.placeholder = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    const key = el.dataset.i18nAriaLabel;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.setAttribute('aria-label', translated);
  }
}
