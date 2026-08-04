import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { announceLocalAction, confirmLocalAction } from './confirm-action.js';

export const STORAGE_SCOPES = Object.freeze([
  { id: 'shell', prefix: 'hm-shell-', required: true },
  { id: 'data', prefix: 'hm-data-', required: true },
  { id: 'tiles', cacheName: 'hm-tiles-v1', required: false },
  { id: 'radar', cacheName: 'hm-radar-v1', required: false },
  { id: 'source', prefix: 'hm-source-', required: false },
]);
export const MAX_RADAR_PACK_FRAMES = 120;
export const MAX_SOURCE_BUNDLE_BYTES = 13 * 1024 * 1024;
export const SOURCE_BUNDLE_ASSETS = Object.freeze([
  './data/hurdat2-atlantic.txt',
  './data/hurdat2-nepac.txt',
  './data/release-manifest.json',
]);
export const SOURCE_BUNDLE_CACHE = 'hm-source-bundle-v1';
const SOURCE_BUNDLE_MARKER_PATH = './__hurricanemap-source-bundle.json';
const RADAR_PACKS_KEY = 'hm-radar-packs-v1';
const RELEASE_MARKER_PATH = './__hurricanemap-release.json';
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

async function responseBytes(response) {
  return response.clone().arrayBuffer();
}

async function sha256Hex(body) {
  if (!globalThis.crypto?.subtle) throw new Error('Browser checksum support is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', body);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function sourceBundleKey(asset) {
  return new URL(asset, globalThis.location?.href || 'https://hurricanemap.invalid/').pathname.replace(/^\//, '');
}

function parseSourceManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error('Source bundle release manifest is not valid JSON');
  }
  if (manifest?.schema_version !== 1 || manifest.algorithm !== 'SHA-256' || !/^[a-f0-9]{40}$/.test(manifest.source_commit || '')) {
    throw new Error('Source bundle release manifest contract is unsupported');
  }
  const artifacts = new Map((manifest.artifacts || []).map(artifact => [artifact.path, artifact]));
  for (const asset of SOURCE_BUNDLE_ASSETS) {
    const key = sourceBundleKey(asset);
    if (key === 'data/release-manifest.json') continue;
    const artifact = artifacts.get(key);
    if (!artifact || !Number.isInteger(artifact.bytes) || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) {
      throw new Error(`Source bundle release manifest is missing ${key}`);
    }
  }
  return { manifest, artifacts };
}

export async function cacheSourceBundle({
  cachesApi = globalThis.caches,
  fetchImpl = globalThis.fetch,
  storageApi = globalThis.navigator?.storage,
  onProgress = () => {},
} = {}) {
  if (!cachesApi || typeof fetchImpl !== 'function') {
    throw new Error('Source bundle storage is unavailable');
  }
  const cache = await cachesApi.open(SOURCE_BUNDLE_CACHE);
  const previous = new Map();
  for (const asset of [...SOURCE_BUNDLE_ASSETS, SOURCE_BUNDLE_MARKER_PATH]) {
    previous.set(asset, await cache.match(asset));
  }

  const staged = [];
  let totalBytes = 0;
  try {
    let manifestRecord = null;
    for (const [index, asset] of SOURCE_BUNDLE_ASSETS.entries()) {
      const response = await fetchImpl(asset, {
        cache: 'no-cache',
        headers: { 'x-hurricanemap-source-bundle': 'refresh' },
      });
      if (!response?.ok) throw new Error(`Source bundle asset returned ${response?.status || 0}: ${asset}`);
      const body = await responseBytes(response);
      totalBytes += body.byteLength;
      if (totalBytes > MAX_SOURCE_BUNDLE_BYTES) {
        throw new Error(`Source bundle exceeds ${formatStorageBytes(MAX_SOURCE_BUNDLE_BYTES)}`);
      }
      if (asset.endsWith('release-manifest.json')) {
        manifestRecord = parseSourceManifest(new TextDecoder().decode(body));
      }
      staged.push({ asset, response, body, index });
      onProgress({ saved: index + 1, total: SOURCE_BUNDLE_ASSETS.length, index, bytes: totalBytes });
    }

    const manifestEntry = staged.find(entry => entry.asset.endsWith('release-manifest.json'));
    const parsedManifest = manifestRecord || parseSourceManifest(new TextDecoder().decode(manifestEntry.body));
    const artifactRecords = [];
    for (const entry of staged) {
      const artifact = parsedManifest.artifacts.get(sourceBundleKey(entry.asset));
      const digest = await sha256Hex(entry.body);
      if (artifact && (entry.body.byteLength !== artifact.bytes || digest !== artifact.sha256)) {
        throw new Error(`Source bundle checksum mismatch: ${sourceBundleKey(entry.asset)}`);
      }
      artifactRecords.push({ path: sourceBundleKey(entry.asset), bytes: entry.body.byteLength, sha256: digest });
    }

    const previousBytes = await Promise.all([...SOURCE_BUNDLE_ASSETS].map(async asset => {
      const response = previous.get(asset);
      return response ? (await responseBytes(response)).byteLength : 0;
    })).then(values => values.reduce((sum, value) => sum + value, 0));
    const estimate = await readStorageEstimate(storageApi);
    if (
      estimate.usage != null &&
      estimate.quota != null &&
      estimate.usage - previousBytes + totalBytes > estimate.quota * QUOTA_HEADROOM
    ) {
      const quotaError = new Error('Source bundle would exceed storage quota');
      quotaError.name = 'QuotaExceededError';
      throw quotaError;
    }

    for (const entry of staged) await cache.put(entry.asset, entry.response.clone());
    const marker = {
      schema_version: 1,
      cache_name: SOURCE_BUNDLE_CACHE,
      assets: artifactRecords,
      bytes: totalBytes,
      max_bytes: MAX_SOURCE_BUNDLE_BYTES,
      source_commit: parsedManifest.manifest.source_commit,
      manifest_sha256: await sha256Hex(staged.find(entry => entry.asset.endsWith('release-manifest.json')).body),
      manifest_generated_at_utc: parsedManifest.manifest.generated_at_utc,
      saved_at_utc: new Date().toISOString(),
    };
    await cache.put(SOURCE_BUNDLE_MARKER_PATH, new Response(JSON.stringify(marker), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (error) {
    await Promise.all([...previous.entries()].map(async ([asset, response]) => {
      if (response) await cache.put(asset, response.clone()).catch(() => {});
      else await cache.delete(asset).catch(() => false);
    }));
    if (isQuotaExceededError(error)) {
      const quotaError = new Error('Not enough browser storage for this source bundle');
      quotaError.name = 'QuotaExceededError';
      throw quotaError;
    }
    throw error;
  }
  emitStorageChange();
  return {
    saved: SOURCE_BUNDLE_ASSETS.length,
    total: SOURCE_BUNDLE_ASSETS.length,
    bytes: totalBytes,
  };
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

export async function inspectRadarFrameCache(frames, {
  cachesApi = globalThis.caches,
  cacheName = 'hm-radar-v1',
} = {}) {
  const urls = [...new Set(
    (Array.isArray(frames) ? frames : [])
      .map(frame => typeof frame === 'string' ? frame : frame?.url)
      .filter(url => typeof url === 'string' && /(?:^|\/)data\/radar\/.+\.png(?:\?|$)/.test(url)),
  )];
  const base = { state: 'unavailable', cached: 0, total: urls.length, urls };
  if (!urls.length || !cachesApi) return base;
  const cacheNames = await cachesApi.keys().catch(() => []);
  if (!cacheNames.includes(cacheName)) return { ...base, state: 'empty' };
  try {
    const cache = await cachesApi.open(cacheName);
    const cached = await Promise.all(urls.map(url => cache.match(url).then(Boolean).catch(() => false)));
    const cachedCount = cached.filter(Boolean).length;
    return {
      ...base,
      state: cachedCount === 0 ? 'empty' : cachedCount === urls.length ? 'complete' : 'partial',
      cached: cachedCount,
    };
  } catch {
    return base;
  }
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

function selectCacheName(cacheNames, definition) {
  const candidates = cacheNames.filter(name => definition.prefix
    ? name.startsWith(definition.prefix)
    : name === definition.cacheName);
  if (!candidates.length) return null;
  if (definition.id === 'data') {
    const versioned = candidates.filter(name => name.startsWith('hm-data-hm-'));
    return [...(versioned.length ? versioned : candidates)].sort().at(-1) || null;
  }
  return [...candidates].sort().at(-1) || null;
}

export async function inspectReleaseTuple({
  cachesApi = globalThis.caches,
  dataCacheName = null,
  shellCacheName = null,
} = {}) {
  const base = {
    state: 'unverified',
    swVersion: null,
    shellCache: shellCacheName,
    dataCache: dataCacheName,
    dataDb: null,
    sourceCommit: null,
    manifestSha256: null,
    manifestGeneratedAt: null,
  };
  if (!cachesApi || !dataCacheName || !shellCacheName) return base;
  try {
    const cache = await cachesApi.open(dataCacheName);
    const response = await cache.match(RELEASE_MARKER_PATH);
    if (!response) return base;
    const marker = await response.json();
    const coherent = marker?.shell_cache === shellCacheName && marker?.data_cache === dataCacheName;
    return {
      ...base,
      state: coherent ? 'coherent' : 'incoherent',
      swVersion: typeof marker?.sw_version === 'string' ? marker.sw_version : null,
      dataDb: typeof marker?.data_db === 'string' ? marker.data_db : null,
      sourceCommit: typeof marker?.source_commit === 'string' ? marker.source_commit : null,
      manifestSha256: typeof marker?.manifest_sha256 === 'string' ? marker.manifest_sha256 : null,
      manifestGeneratedAt: typeof marker?.manifest_generated_at_utc === 'string' ? marker.manifest_generated_at_utc : null,
    };
  } catch {
    return base;
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
    const cacheName = selectCacheName(cacheNames, definition);
    let cacheSnapshot = { entries: 0, sizeBytes: 0 };
    if (cacheName && cacheNames.includes(cacheName)) {
      cacheSnapshot = await inspectCache(cachesApi, cacheName);
    }
    scopes.push({ ...definition, cacheName, ...cacheSnapshot });
  }
  const release = await inspectReleaseTuple({
    cachesApi,
    dataCacheName: scopes.find(scope => scope.id === 'data')?.cacheName,
    shellCacheName: scopes.find(scope => scope.id === 'shell')?.cacheName,
  });
  return {
    ...estimate,
    persisted,
    scopes,
    release,
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
  const cacheNames = await cachesApi.keys().catch(() => []);
  const cacheName = scope.cacheName || selectCacheName(cacheNames, scope);
  if (!cacheName) return false;
  const removed = await cachesApi.delete(cacheName);
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
          ${scope.required ? '' : `<span class="storage-scope-actions">
            ${scope.id === 'source' ? `<button class="settings-action storage-source-save" type="button" data-cache-source-bundle>${escapeHtml(t(scope.entries ? 'storage.sourceRefresh' : 'storage.sourceSave'))}</button>` : ''}
            <button class="settings-action storage-clear" type="button" data-clear-storage="${escapeHtml(scope.id)}">${escapeHtml(t('storage.clear'))}</button>
          </span>`}
        </div>`).join('')}
    </div>
    <p class="storage-action-status" role="status" aria-live="polite"></p>
    <p class="settings-help">${escapeHtml(t('storage.packs', packCount))}</p>`;
}

export function initStorageManager(host = document.getElementById('storage-manager')) {
  if (!host) return;
  const refresh = () => renderStorageManager(host);
  host.addEventListener('click', async event => {
    const sourceButton = event.target.closest?.('[data-cache-source-bundle]');
    if (sourceButton) {
      sourceButton.disabled = true;
      const label = scopeLabel({ id: 'source' });
      const result = await cacheSourceBundle().catch(error => ({ error }));
      await refresh();
      const status = host.querySelector('.storage-action-status');
      const message = result.error
        ? t('storage.sourceFailed', label)
        : t('storage.sourceComplete', formatStorageBytes(result.bytes));
      if (status) status.textContent = message;
      announceLocalAction(message);
      host.querySelector('[data-cache-source-bundle]')?.focus({ preventScroll: true });
      return;
    }
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
