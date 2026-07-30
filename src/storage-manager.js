import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { announceLocalAction, confirmLocalAction } from './confirm-action.js';

export const STORAGE_SCOPES = Object.freeze([
  { id: 'shell', prefix: 'hm-shell-', required: true },
  { id: 'data', cacheName: 'hm-data-v2', required: true },
  { id: 'tiles', cacheName: 'hm-tiles-v1', required: false },
  { id: 'radar', cacheName: 'hm-radar-v1', required: false },
]);
export const MAX_RADAR_PACK_FRAMES = 120;
const RADAR_PACKS_KEY = 'hm-radar-packs-v1';
const QUOTA_HEADROOM = 0.95;

export function formatStorageBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

export function summarizeStorageEstimate(estimate = {}) {
  const usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
  const quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
  const percent = usage != null && quota > 0 ? Math.round((usage / quota) * 100) : null;
  return { usage, quota, percent };
}

export function isQuotaExceededError(error) {
  return error?.name === 'QuotaExceededError' ||
    error?.code === 22 ||
    /quota/i.test(String(error?.message || ''));
}

async function readStorageEstimate(storageApi) {
  try {
    return summarizeStorageEstimate(await storageApi?.estimate?.() || {});
  } catch {
    return summarizeStorageEstimate();
  }
}

async function inspectCache(cachesApi, cacheName) {
  if (!cachesApi || !cacheName) return { entries: 0, sizeBytes: 0 };
  try {
    const cache = await cachesApi.open(cacheName);
    const requests = await cache.keys();
    let sizeBytes = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (!response) continue;
      const declared = Number(response.headers?.get?.('content-length'));
      sizeBytes += Number.isFinite(declared) && declared >= 0
        ? declared
        : await response.clone().blob().then(blob => blob.size).catch(() => 0);
    }
    return { entries: requests.length, sizeBytes };
  } catch {
    return { entries: 0, sizeBytes: null };
  }
}

export function selectBoundedRadarFrames(frames, limit = MAX_RADAR_PACK_FRAMES) {
  const unique = [...new Map(
    (Array.isArray(frames) ? frames : [])
      .filter(frame => typeof frame?.url === 'string' && /(?:^|\/)data\/radar\/.+\.png(?:\?|$)/.test(frame.url))
      .map(frame => [frame.url, frame]),
  ).values()];
  if (unique.length <= limit) return unique;
  if (limit <= 1) return unique.slice(0, Math.max(0, limit));
  return Array.from({ length: limit }, (_, index) => (
    unique[Math.round((index * (unique.length - 1)) / (limit - 1))]
  ));
}

function readPackIndex(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(RADAR_PACKS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePackIndex(index, storage = globalThis.localStorage) {
  try {
    storage?.setItem(RADAR_PACKS_KEY, JSON.stringify(index));
  } catch {
    // Cache contents remain usable even when localStorage is unavailable.
  }
}

function emitStorageChange() {
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('hm-storage:change'));
  }
}

export async function inspectStorage({
  storageApi = globalThis.navigator?.storage,
  cachesApi = globalThis.caches,
  packStorage = globalThis.localStorage,
} = {}) {
  const estimate = await readStorageEstimate(storageApi);
  let persisted = false;
  try {
    persisted = await storageApi?.persisted?.() || false;
  } catch { /* Persistence is advisory; the estimate remains useful. */ }
  const cacheNames = cachesApi ? await cachesApi.keys().catch(() => []) : [];
  const scopes = [];
  for (const definition of STORAGE_SCOPES) {
    const cacheName = definition.prefix
      ? cacheNames.find(name => name.startsWith(definition.prefix)) || null
      : definition.cacheName;
    let cacheSnapshot = { entries: 0, sizeBytes: 0 };
    if (cacheName && cacheNames.includes(cacheName)) {
      cacheSnapshot = await inspectCache(cachesApi, cacheName);
    }
    scopes.push({ ...definition, cacheName, ...cacheSnapshot });
  }
  return {
    ...estimate,
    persisted,
    scopes,
    packs: readPackIndex(packStorage),
  };
}

export async function clearOptionalStorageScope(scopeId, {
  cachesApi = globalThis.caches,
  packStorage = globalThis.localStorage,
  notify = true,
} = {}) {
  const scope = STORAGE_SCOPES.find(candidate => candidate.id === scopeId);
  if (!scope) throw new Error(`Unknown storage scope: ${scopeId}`);
  if (scope.required) throw new Error(`Required storage scope cannot be cleared: ${scopeId}`);
  if (!cachesApi) return false;
  const removed = await cachesApi.delete(scope.cacheName);
  if (scopeId === 'radar') writePackIndex({}, packStorage);
  if (notify) emitStorageChange();
  return removed;
}

export async function cacheRadarPack(stormId, frames, {
  cachesApi = globalThis.caches,
  fetchImpl = globalThis.fetch,
  storageApi = globalThis.navigator?.storage,
  packStorage = globalThis.localStorage,
  onProgress = () => {},
} = {}) {
  if (!stormId || !cachesApi || typeof fetchImpl !== 'function') {
    throw new Error('Radar offline storage is unavailable');
  }
  const selected = selectBoundedRadarFrames(frames);
  if (!selected.length) return { stormId, saved: 0, total: 0, bytes: 0 };

  const cache = await cachesApi.open('hm-radar-v1');
  const storageEstimate = await readStorageEstimate(storageApi);
  const added = [];
  let saved = 0;
  let bytes = 0;
  try {
    for (const [index, frame] of selected.entries()) {
      const existing = await cache.match(frame.url);
      if (!existing) {
        const response = await fetchImpl(frame.url, { cache: 'no-cache' });
        if (!response?.ok) throw new Error(`Radar frame returned ${response?.status || 0}`);
        const contentLength = Number(response.headers?.get?.('content-length'));
        const frameBytes = Number.isFinite(contentLength) && contentLength >= 0
          ? contentLength
          : (await response.clone().blob()).size;
        if (
          storageEstimate.usage != null &&
          storageEstimate.quota != null &&
          storageEstimate.usage + bytes + frameBytes > storageEstimate.quota * QUOTA_HEADROOM
        ) {
          const quotaError = new Error('Radar pack would exceed storage quota');
          quotaError.name = 'QuotaExceededError';
          throw quotaError;
        }
        await cache.put(frame.url, response.clone());
        added.push(frame.url);
        bytes += frameBytes;
      }
      saved += 1;
      onProgress({ saved, total: selected.length, index });
    }
  } catch (error) {
    await Promise.all(added.map(url => cache.delete(url).catch(() => false)));
    if (isQuotaExceededError(error)) {
      const quotaError = new Error('Not enough browser storage for this radar pack');
      quotaError.name = 'QuotaExceededError';
      throw quotaError;
    }
    throw error;
  }

  const index = readPackIndex(packStorage);
  index[stormId] = {
    savedAt: new Date().toISOString(),
    frameCount: selected.length,
    urls: selected.map(frame => frame.url),
  };
  writePackIndex(index, packStorage);
  emitStorageChange();
  return { stormId, saved, total: selected.length, bytes };
}

function scopeLabel(scope) {
  return t(`storage.scope.${scope.id}`);
}

export async function renderStorageManager(host) {
  if (!host) return;
  host.innerHTML = `<p class="settings-help">${escapeHtml(t('storage.loading'))}</p>`;
  const snapshot = await inspectStorage();
  const usage = snapshot.usage == null
    ? t('storage.unavailable')
    : `${formatStorageBytes(snapshot.usage)} / ${formatStorageBytes(snapshot.quota)}${snapshot.percent == null ? '' : ` (${snapshot.percent}%)`}`;
  const packCount = Object.keys(snapshot.packs).length;
  host.innerHTML = `
    <div class="storage-summary">
      <strong>${escapeHtml(usage)}</strong>
      <span>${escapeHtml(snapshot.persisted ? t('storage.persisted') : t('storage.bestEffort'))}</span>
    </div>
    <div class="storage-scopes" role="list">
      ${snapshot.scopes.map(scope => `
        <div class="storage-scope" role="listitem">
          <span><strong>${escapeHtml(scopeLabel(scope))}</strong><small>${escapeHtml(t(scope.required ? 'storage.required' : 'storage.optional'))} · ${scope.entries} ${escapeHtml(t('storage.entries'))} · ${escapeHtml(formatStorageBytes(scope.sizeBytes))}</small></span>
          ${scope.required ? '' : `<button class="settings-action storage-clear" type="button" data-clear-storage="${escapeHtml(scope.id)}">${escapeHtml(t('storage.clear'))}</button>`}
        </div>`).join('')}
    </div>
    <p class="storage-action-status" role="status" aria-live="polite"></p>
    <p class="settings-help">${escapeHtml(t('storage.packs', packCount))}</p>`;
}

export function initStorageManager(host = document.getElementById('storage-manager')) {
  if (!host) return;
  const refresh = () => renderStorageManager(host);
  host.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-clear-storage]');
    if (!button) return;
    const scopeId = button.dataset.clearStorage;
    const scope = STORAGE_SCOPES.find(candidate => candidate.id === scopeId);
    const label = scope ? scopeLabel(scope) : scopeId;
    const confirmed = await confirmLocalAction({
      title: t('storage.confirmTitle', label),
      message: t('storage.confirmBody', label),
      confirmLabel: t('storage.confirmAction', label),
      invoker: button,
    });
    if (!confirmed) return;
    button.disabled = true;
    const removed = await clearOptionalStorageScope(scopeId, { notify: false }).then(() => true).catch(() => false);
    await refresh();
    const message = t(removed ? 'storage.clearComplete' : 'storage.clearFailed', label);
    const status = host.querySelector('.storage-action-status');
    if (status) status.textContent = message;
    announceLocalAction(message);
    host.querySelector(`[data-clear-storage="${scopeId}"]`)?.focus({ preventScroll: true });
  });
  document.addEventListener('hm-storage:change', refresh);
  refresh();
}
