import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';

export const OPTIONAL_FEED_DEFINITIONS = Object.freeze({
  active: { labelKey: 'feeds.active', source: 'NOAA NHC CurrentStorms' },
  forecast: { labelKey: 'feeds.forecast', source: 'NOAA NHC official forecast GIS' },
  outlook: { labelKey: 'feeds.outlook', source: 'NOAA NHC Tropical Weather Outlook' },
  marine: { labelKey: 'feeds.marine', source: 'NOAA NHC Marine Wind Warnings' },
  alerts: { labelKey: 'feeds.alerts', source: 'NOAA/NWS active alerts' },
  surge: { labelKey: 'feeds.surge', source: 'NOAA NHC Peak Storm Surge' },
  goes: { labelKey: 'feeds.goes', source: 'NOAA/NESDIS/STAR GOES' },
  tides: { labelKey: 'feeds.tides', source: 'NOAA CO-OPS' },
  radar: { labelKey: 'feeds.radar', source: 'Iowa State IEM NEXRAD archive' },
  'wind-context': { labelKey: 'feeds.windContext', source: 'NOAA NHC tropical weather summary GIS' },
  seasonal: { labelKey: 'feeds.seasonal', source: 'NOAA CPC bundled outlook snapshot' },
});

export function getBundledDatasetStatus(metadata, datasetId) {
  if (!Array.isArray(metadata?.datasets)) return null;
  return metadata.datasets.find(dataset => dataset?.id === datasetId) || null;
}

export function getBundledDatasetState(status, available) {
  if (!available) return 'unavailable';
  if (status?.status === 'closed') return 'closed';
  if (status?.status === 'deprecated') return 'deprecated';
  return 'available';
}

const VALID_STATES = new Set([
  'idle', 'loading', 'success', 'empty', 'stale', 'offline', 'rate-limited', 'error',
]);
const VALID_ORIGINS = new Set(['none', 'network', 'memory', 'bundled', 'service-worker']);
const states = new Map(
  Object.entries(OPTIONAL_FEED_DEFINITIONS).map(([id, definition]) => [
    id,
    Object.freeze({
      id,
      source: definition.source,
      state: 'idle',
      detail: null,
      lastSuccessAt: null,
      nextRetryAt: null,
      cacheOrigin: 'none',
      itemCount: null,
    }),
  ]),
);

function requireFeed(id) {
  if (!OPTIONAL_FEED_DEFINITIONS[id]) throw new Error(`Unknown optional feed: ${id}`);
  return states.get(id);
}

function publish(id, patch) {
  const previous = requireFeed(id);
  const next = Object.freeze({
    ...previous,
    ...patch,
    id,
    source: patch.source || previous.source,
    state: VALID_STATES.has(patch.state) ? patch.state : 'error',
    cacheOrigin: VALID_ORIGINS.has(patch.cacheOrigin) ? patch.cacheOrigin : previous.cacheOrigin,
  });
  states.set(id, next);
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('hm-optional-feed:change', { detail: next }));
  }
  return next;
}

export function beginOptionalFeed(id, {
  source,
  cacheOrigin = 'network',
  nextRetryAt = null,
} = {}) {
  return publish(id, {
    state: 'loading',
    detail: null,
    source,
    cacheOrigin,
    nextRetryAt,
  });
}

export function completeOptionalFeed(id, {
  empty = false,
  source,
  cacheOrigin = 'network',
  itemCount = null,
  completedAt = Date.now(),
  nextRetryAt = null,
} = {}) {
  return publish(id, {
    state: empty ? 'empty' : 'success',
    detail: null,
    source,
    cacheOrigin,
    itemCount: Number.isFinite(itemCount) ? itemCount : null,
    lastSuccessAt: completedAt,
    nextRetryAt,
  });
}

export function classifyOptionalFeedFailure({
  responseStatus = 0,
  error = null,
  online = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
} = {}) {
  if (!online) return 'offline';
  if (responseStatus === 429) return 'rate-limited';
  if (error?.name === 'AbortError') return 'error';
  return 'error';
}

export function failOptionalFeed(id, {
  responseStatus = 0,
  error = null,
  online,
  source,
  cacheOrigin,
  nextRetryAt = null,
} = {}) {
  const previous = requireFeed(id);
  const failure = classifyOptionalFeedFailure({ responseStatus, error, online });
  const hasLastGood = Number.isFinite(previous.lastSuccessAt);
  return publish(id, {
    state: hasLastGood ? 'stale' : failure,
    detail: hasLastGood ? failure : null,
    source,
    cacheOrigin,
    nextRetryAt,
  });
}

export function idleOptionalFeed(id) {
  const previous = requireFeed(id);
  return publish(id, {
    state: 'idle',
    detail: null,
    nextRetryAt: null,
    cacheOrigin: previous.lastSuccessAt ? previous.cacheOrigin : 'none',
  });
}

export function reportOptionalFeedResult(id, result, options = {}) {
  const status = result?.status;
  if (status === 'idle' || status === 'unavailable') return idleOptionalFeed(id);
  if (status === 'rendered' || status === 'success') {
    return completeOptionalFeed(id, {
      ...options,
      cacheOrigin: result.cacheOrigin || options.cacheOrigin,
      itemCount: result.itemCount ?? result.zoneCount ?? result.pointCount ??
        result.polygonCount ?? result.featureCount ?? result.imageCount ?? result.coneCount ?? null,
    });
  }
  if (status === 'empty') {
    return completeOptionalFeed(id, {
      ...options,
      empty: true,
      itemCount: 0,
      cacheOrigin: result.cacheOrigin || options.cacheOrigin,
    });
  }
  if (status === 'stale') return requireFeed(id);
  return failOptionalFeed(id, {
    ...options,
    error: result?.error,
    responseStatus: result?.responseStatus || 0,
    cacheOrigin: result?.cacheOrigin || options.cacheOrigin,
  });
}

export function getOptionalFeedState(id) {
  return { ...requireFeed(id) };
}

export function getOptionalFeedStates() {
  return [...states.values()].map(state => ({ ...state }));
}

function formatTime(value) {
  if (!Number.isFinite(value)) return t('feeds.never');
  return new Date(value).toLocaleString();
}

function stateLabel(feed) {
  const base = t(`feeds.state.${feed.state}`);
  return feed.detail ? `${base} · ${t(`feeds.state.${feed.detail}`)}` : base;
}

export function renderOptionalFeedDiagnostics(host) {
  if (!host) return;
  host.innerHTML = getOptionalFeedStates().map(feed => {
    const definition = OPTIONAL_FEED_DEFINITIONS[feed.id];
    return `
      <div class="feed-diagnostic" role="listitem" data-feed="${escapeHtml(feed.id)}" data-state="${escapeHtml(feed.state)}">
        <div class="feed-diagnostic-head">
          <strong>${escapeHtml(t(definition.labelKey))}</strong>
          <span class="feed-state">${escapeHtml(stateLabel(feed))}</span>
        </div>
        <div class="feed-diagnostic-meta">
          <span>${escapeHtml(feed.source)}</span>
          <span>${escapeHtml(t('feeds.lastSuccess'))}: ${escapeHtml(formatTime(feed.lastSuccessAt))}</span>
          <span>${escapeHtml(t('feeds.nextRetry'))}: ${escapeHtml(formatTime(feed.nextRetryAt))}</span>
          <span>${escapeHtml(t('feeds.cache'))}: ${escapeHtml(t(`feeds.cache.${feed.cacheOrigin}`))}</span>
        </div>
      </div>`;
  }).join('');
}

export function initOptionalFeedDiagnostics(host = document.getElementById('optional-feed-diagnostics')) {
  if (!host) return;
  const render = () => renderOptionalFeedDiagnostics(host);
  render();
  document.addEventListener('hm-optional-feed:change', render);
  document.addEventListener('hm-locale:change', render);
}
