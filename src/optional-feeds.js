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
  fema: { labelKey: 'feeds.fema', source: 'FEMA Disaster Declarations Summaries' },
  'wind-context': { labelKey: 'feeds.windContext', source: 'NOAA NHC tropical weather summary GIS' },
  seasonal: { labelKey: 'feeds.seasonal', source: 'NOAA CPC bundled outlook snapshot' },
  population: { labelKey: 'feeds.population', source: 'SEDAC GPWv4 population-density tiles' },
  glossary: { labelKey: 'feeds.glossary', source: 'HurricaneMap bundled glossary' },
  sst: { labelKey: 'feeds.sst', source: 'PacIOOS CoralTemp sea-surface temperature' },
  hwm: { labelKey: 'feeds.hwm', source: 'USGS high-water marks' },
  'storm-events': { labelKey: 'feeds.stormEvents', source: 'NOAA NCEI Storm Events' },
  exposure: { labelKey: 'feeds.exposure', source: 'Bundled state population densities' },
  evac: { labelKey: 'feeds.evac', source: 'Florida ArcGIS evacuation zones' },
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
  'idle', 'loading', 'success', 'empty', 'stale', 'offline', 'rate-limited', 'malformed', 'timeout', 'error',
  // Not a failure: the deployment has no route to this source at all, so there
  // is nothing to retry and nothing to poll for.
  'unsupported',
]);
const VALID_ORIGINS = new Set(['none', 'network', 'memory', 'bundled', 'service-worker']);
const retryHandlers = new Map();
let requestSequence = 0;
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
      responseStatus: 0,
      requestId: 0,
    }),
  ]),
);

function requireFeed(id) {
  if (!OPTIONAL_FEED_DEFINITIONS[id]) throw new Error(`Unknown optional feed: ${id}`);
  return states.get(id);
}

function publish(id, patch, { allowRequestChange = false } = {}) {
  const previous = requireFeed(id);
  if (!allowRequestChange && Number.isInteger(patch.requestId) && patch.requestId !== previous.requestId) return previous;
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

export function getOptionalFeedDefinition(id) {
  const definition = OPTIONAL_FEED_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown optional feed: ${id}`);
  return { id, ...definition };
}

export function registerOptionalFeedRetry(id, handler) {
  requireFeed(id);
  if (typeof handler !== 'function') throw new TypeError(`Retry handler for ${id} must be a function`);
  retryHandlers.set(id, handler);
  return () => {
    if (retryHandlers.get(id) === handler) retryHandlers.delete(id);
  };
}

export async function retryOptionalFeed(id) {
  requireFeed(id);
  const handler = retryHandlers.get(id);
  if (!handler) return { ok: false, error: 'retry-unavailable' };
  try {
    return { ok: true, value: await handler() };
  } catch (error) {
    return { ok: false, error };
  }
}

export function isOptionalFeedRequestCurrent(id, requestId) {
  return requireFeed(id).requestId === requestId;
}

function nextRequestId() {
  requestSequence += 1;
  return requestSequence;
}

export function beginOptionalFeed(id, {
  source,
  cacheOrigin = 'network',
  nextRetryAt = null,
} = {}) {
  return publish(id, {
    state: 'loading',
    detail: null,
    responseStatus: 0,
    requestId: nextRequestId(),
    source,
    cacheOrigin,
    nextRetryAt,
  }, { allowRequestChange: true });
}

export function completeOptionalFeed(id, {
  empty = false,
  source,
  cacheOrigin = 'network',
  itemCount = null,
  completedAt = Date.now(),
  nextRetryAt = null,
  requestId,
} = {}) {
  return publish(id, {
    state: empty ? 'empty' : 'success',
    detail: null,
    responseStatus: 0,
    source,
    cacheOrigin,
    itemCount: Number.isFinite(itemCount) ? itemCount : null,
    lastSuccessAt: completedAt,
    nextRetryAt,
    ...(Number.isInteger(requestId) ? { requestId } : {}),
  });
}

export function classifyOptionalFeedFailure({
  responseStatus = 0,
  error = null,
  online = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
} = {}) {
  if (!online) return 'offline';
  if (responseStatus === 429) return 'rate-limited';
  if (error?.name === 'AbortError' || error?.name === 'CanceledError') return 'cancelled';
  if (error?.name === 'TimeoutError' || /timeout|timed out|deadline/i.test(String(error?.message || ''))) return 'timeout';
  if (error instanceof SyntaxError || /malformed|invalid json|unexpected token|parse/i.test(String(error?.message || ''))) return 'malformed';
  return 'error';
}

export function failOptionalFeed(id, {
  responseStatus = 0,
  error = null,
  online,
  source,
  cacheOrigin,
  nextRetryAt = null,
  requestId,
} = {}) {
  const previous = requireFeed(id);
  const failure = classifyOptionalFeedFailure({ responseStatus, error, online });
  if (Number.isInteger(requestId) && requestId !== previous.requestId) return previous;
  const hasLastGood = Number.isFinite(previous.lastSuccessAt);
  if (failure === 'cancelled') {
    return publish(id, {
      state: hasLastGood ? 'stale' : 'idle',
      detail: null,
      nextRetryAt: null,
      requestId: nextRequestId(),
    }, { allowRequestChange: true });
  }
  return publish(id, {
    state: hasLastGood ? 'stale' : failure,
    detail: hasLastGood ? failure : null,
    source,
    cacheOrigin: cacheOrigin || previous.cacheOrigin,
    responseStatus: Number.isInteger(responseStatus) ? responseStatus : 0,
    nextRetryAt,
    ...(Number.isInteger(requestId) ? { requestId } : {}),
  });
}

// A feed whose source this deployment cannot reach. Distinct from 'error',
// which invites a retry, and from 'idle', which reads as "not requested yet".
export function unsupportedOptionalFeed(id) {
  requireFeed(id);
  return publish(id, {
    state: 'unsupported',
    detail: null,
    responseStatus: 0,
    nextRetryAt: null,
    itemCount: null,
    requestId: nextRequestId(),
    cacheOrigin: 'none',
  }, { allowRequestChange: true });
}

export function idleOptionalFeed(id) {
  const previous = requireFeed(id);
  return publish(id, {
    state: 'idle',
    detail: null,
    responseStatus: 0,
    nextRetryAt: null,
    requestId: nextRequestId(),
    cacheOrigin: previous.lastSuccessAt ? previous.cacheOrigin : 'none',
  }, { allowRequestChange: true });
}

export function cancelOptionalFeed(id, { requestId } = {}) {
  const previous = requireFeed(id);
  if (Number.isInteger(requestId) && requestId !== previous.requestId) return previous;
  return publish(id, {
    state: Number.isFinite(previous.lastSuccessAt) ? 'stale' : 'idle',
    detail: null,
    nextRetryAt: null,
    requestId: nextRequestId(),
  }, { allowRequestChange: true });
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
  if (status === 'aborted' || status === 'cancelled') return cancelOptionalFeed(id, options);
  if (status === 'stale') return requireFeed(id);
  return failOptionalFeed(id, {
    ...options,
    error: result?.error,
    responseStatus: result?.responseStatus || 0,
    cacheOrigin: result?.cacheOrigin || options.cacheOrigin,
    requestId: result?.requestId ?? options.requestId,
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
    const stateText = t(`feeds.state.${feed.state}`);
    const detailText = feed.detail ? ` · ${t(`feeds.state.${feed.detail}`)}` : '';
    const itemText = Number.isFinite(feed.itemCount) ? ` · ${t('feeds.items', feed.itemCount)}` : '';
    const statusText = `${stateText}${detailText}${itemText}`;
    return `
      <div class="feed-diagnostic" role="listitem" data-feed="${escapeHtml(feed.id)}" data-state="${escapeHtml(feed.state)}">
        <div class="feed-diagnostic-head">
          <strong>${escapeHtml(t(definition.labelKey))}</strong>
          <span class="feed-state">${escapeHtml(statusText)}</span>
        </div>
        <div class="feed-diagnostic-meta">
          <span>${escapeHtml(feed.source)}</span>
          <span>${escapeHtml(t('feeds.lastSuccess'))}: ${escapeHtml(formatTime(feed.lastSuccessAt))}</span>
          <span>${escapeHtml(t('feeds.nextRetry'))}: ${escapeHtml(formatTime(feed.nextRetryAt))}</span>
          <span>${escapeHtml(t('feeds.cache'))}: ${escapeHtml(t(`feeds.cache.${feed.cacheOrigin}`))}</span>
        </div>
        <div class="feed-diagnostic-actions">
          ${feed.state === 'unsupported' ? '' : `<button class="text-btn feed-retry" type="button" data-feed-retry="${escapeHtml(feed.id)}" ${feed.state === 'loading' ? 'disabled' : ''}>${escapeHtml(t('feeds.retry'))}</button>`}
        </div>
      </div>`;
  }).join('');
}

export function initOptionalFeedDiagnostics(host = document.getElementById('optional-feed-diagnostics')) {
  if (!host) return;
  const render = () => renderOptionalFeedDiagnostics(host);
  render();
  host.addEventListener('click', async event => {
    const button = event.target.closest('[data-feed-retry]');
    if (!button) return;
    button.disabled = true;
    await retryOptionalFeed(button.dataset.feedRetry);
    render();
  });
  document.addEventListener('hm-optional-feed:change', render);
  document.addEventListener('hm-locale:change', render);
}
