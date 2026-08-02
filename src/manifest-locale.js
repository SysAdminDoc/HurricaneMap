const MANIFEST_BY_LOCALE = Object.freeze({
  en: 'manifest.webmanifest',
  es: 'manifest.es.webmanifest',
  ht: 'manifest.ht.webmanifest',
});

export function manifestPathForLocale(locale) {
  return MANIFEST_BY_LOCALE[locale] || MANIFEST_BY_LOCALE.en;
}

export function syncManifestLocale(locale, documentRef = globalThis.document) {
  const link = documentRef?.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const path = manifestPathForLocale(locale);
  link.setAttribute('href', path);
  return path;
}

export function initManifestLocale(locale, documentRef = globalThis.document) {
  const path = syncManifestLocale(locale, documentRef);
  documentRef?.addEventListener('hm-locale:change', event => {
    syncManifestLocale(event.detail?.locale, documentRef);
  });
  return path;
}
