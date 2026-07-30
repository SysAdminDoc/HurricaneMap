import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { getOptionalFeedStates } from './optional-feeds.js';
import { formatStorageBytes, inspectStorage } from './storage-manager.js';
import {
  getServiceWorkerDiagnostics,
  retryServiceWorkerRegistration,
} from './sw-updates.js';

export const SUPPORT_BUNDLE_SCHEMA_VERSION = 1;

export function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/\/(?:Users|home)\/[^\s]+/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function ageMs(timestamp, now) {
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

export function buildSanitizedSupportBundle({
  appVersion = 'unknown',
  dataSchemaVersion = null,
  generatedAt = new Date().toISOString(),
  online = true,
  serviceWorker = {},
  storage = {},
  feeds = [],
  now = Date.now(),
} = {}) {
  const scopes = (Array.isArray(storage.scopes) ? storage.scopes : []).map(scope => ({
    id: String(scope.id || ''),
    required: Boolean(scope.required),
    cache_name: scope.cacheName ? String(scope.cacheName) : null,
    entries: Number.isFinite(scope.entries) ? scope.entries : 0,
    size_bytes: Number.isFinite(scope.sizeBytes) ? scope.sizeBytes : null,
  }));
  const optionalFeeds = (Array.isArray(feeds) ? feeds : []).map(feed => ({
    id: String(feed.id || ''),
    state: String(feed.state || 'idle'),
    cache_origin: String(feed.cacheOrigin || 'none'),
    item_count: Number.isFinite(feed.itemCount) ? feed.itemCount : null,
    last_success_age_ms: ageMs(feed.lastSuccessAt, now),
    next_retry_in_ms: Number.isFinite(feed.nextRetryAt) ? Math.max(0, feed.nextRetryAt - now) : null,
  }));
  const lastError = serviceWorker.lastError
    ? {
        source: 'service-worker',
        name: sanitizeDiagnosticText(serviceWorker.lastError.name),
        message: sanitizeDiagnosticText(serviceWorker.lastError.message),
      }
    : null;
  return {
    schema_version: SUPPORT_BUNDLE_SCHEMA_VERSION,
    generated_at: generatedAt,
    app: {
      version: String(appVersion),
      data_schema_version: Number.isFinite(dataSchemaVersion) ? dataSchemaVersion : null,
      online: Boolean(online),
    },
    service_worker: {
      supported: Boolean(serviceWorker.supported),
      registration: String(serviceWorker.registration || 'not-checked'),
      controller: String(serviceWorker.controller || 'uncontrolled'),
      scope: serviceWorker.scope ? sanitizeDiagnosticText(serviceWorker.scope) : null,
      script_url: serviceWorker.scriptUrl ? '[service-worker-script]' : null,
    },
    storage: {
      persisted: Boolean(storage.persisted),
      usage_bytes: Number.isFinite(storage.usage) ? storage.usage : null,
      quota_bytes: Number.isFinite(storage.quota) ? storage.quota : null,
      radar_pack_count: storage.packs && typeof storage.packs === 'object'
        ? Object.keys(storage.packs).length
        : 0,
      scopes,
    },
    optional_feeds: optionalFeeds,
    errors: lastError ? [lastError] : [],
  };
}

async function readMetadata(fetchImpl) {
  try {
    const response = await fetchImpl('data/metadata.json', { cache: 'no-cache' });
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
}

export async function collectOfflineDiagnostics({
  fetchImpl = globalThis.fetch,
  navigatorRef = globalThis.navigator,
} = {}) {
  const [metadata, storage] = await Promise.all([
    readMetadata(fetchImpl),
    inspectStorage(),
  ]);
  return buildSanitizedSupportBundle({
    appVersion: metadata.generator?.app_version || 'unknown',
    dataSchemaVersion: metadata.schema_version,
    online: navigatorRef?.onLine !== false,
    serviceWorker: getServiceWorkerDiagnostics(),
    storage,
    feeds: getOptionalFeedStates(),
  });
}

export function formatDiagnosticAge(milliseconds) {
  if (!Number.isFinite(milliseconds)) return t('diagnostics.never');
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return t('diagnostics.minutesAgo', minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('diagnostics.hoursAgo', hours);
  return t('diagnostics.daysAgo', Math.round(hours / 24));
}

function downloadBundle(bundle, documentRef = document) {
  const body = JSON.stringify(bundle, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = `HurricaneMap-support-${new Date().toISOString().slice(0, 10)}.json`;
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function renderOfflineDiagnostics(host) {
  if (!host) return;
  const generation = Number(host.dataset.renderGeneration || 0) + 1;
  host.dataset.renderGeneration = String(generation);
  delete host.dataset.ready;
  host.innerHTML = `<p class="settings-help">${escapeHtml(t('diagnostics.loading'))}</p>`;
  const bundle = await collectOfflineDiagnostics();
  if (host.dataset.renderGeneration !== String(generation)) return;
  host.dataset.ready = 'true';
  host.innerHTML = `
    <div class="diagnostics-summary">
      <span><strong>${escapeHtml(t('diagnostics.registration'))}</strong>${escapeHtml(t(`diagnostics.registration.${bundle.service_worker.registration}`))}</span>
      <span><strong>${escapeHtml(t('diagnostics.controller'))}</strong>${escapeHtml(t(`diagnostics.controller.${bundle.service_worker.controller}`))}</span>
      <span><strong>${escapeHtml(t('diagnostics.storage'))}</strong>${escapeHtml(formatStorageBytes(bundle.storage.usage_bytes))} / ${escapeHtml(formatStorageBytes(bundle.storage.quota_bytes))}</span>
    </div>
    <div class="diagnostics-caches" role="list">
      ${bundle.storage.scopes.map(scope => `<span role="listitem"><strong>${escapeHtml(t(`storage.scope.${scope.id}`))}</strong><small>${escapeHtml(scope.cache_name || t('diagnostics.notInstalled'))} · ${scope.entries} · ${escapeHtml(formatStorageBytes(scope.size_bytes))}</small></span>`).join('')}
    </div>
    <div class="diagnostics-feeds">
      <strong>${escapeHtml(t('diagnostics.feedAge'))}</strong>
      <span>${bundle.optional_feeds.map(feed => `${escapeHtml(feed.id)}: ${escapeHtml(formatDiagnosticAge(feed.last_success_age_ms))}`).join(' · ')}</span>
    </div>
    ${bundle.errors.length ? `<p class="diagnostics-error" role="status">${escapeHtml(bundle.errors[0].name)}: ${escapeHtml(bundle.errors[0].message)}</p>` : ''}
    <div class="diagnostics-actions">
      <button class="settings-action" type="button" data-diagnostics-retry>${escapeHtml(t('diagnostics.retry'))}</button>
      <button class="settings-action" type="button" data-diagnostics-refresh>${escapeHtml(t('diagnostics.refresh'))}</button>
      <button class="settings-action" type="button" data-diagnostics-export>${escapeHtml(t('diagnostics.export'))}</button>
    </div>
    <p class="settings-help">${escapeHtml(t('diagnostics.privacy'))}</p>`;
  host.dataset.bundle = JSON.stringify(bundle);
}

export function initOfflineDiagnostics(host = document.getElementById('offline-diagnostics')) {
  if (!host) return;
  const refresh = () => renderOfflineDiagnostics(host);
  host.addEventListener('click', async event => {
    if (event.target.closest('[data-diagnostics-retry]')) {
      await retryServiceWorkerRegistration();
      await refresh();
    } else if (event.target.closest('[data-diagnostics-refresh]')) {
      await refresh();
    } else if (event.target.closest('[data-diagnostics-export]')) {
      downloadBundle(await collectOfflineDiagnostics());
    }
  });
  document.addEventListener('hm-service-worker:change', refresh);
  document.addEventListener('hm-storage:change', refresh);
  document.addEventListener('hm-optional-feed:change', refresh);
  document.addEventListener('hm-locale:change', refresh);
  refresh();
}
