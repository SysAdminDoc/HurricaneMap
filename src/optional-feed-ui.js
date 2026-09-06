import { escapeHtml } from './html-utils.js';
import { getLocale, t } from './i18n.js';
import {
  getOptionalFeedDefinition,
  getOptionalFeedState,
  registerOptionalFeedRetry,
  retryOptionalFeed,
} from './optional-feeds.js';

// Keyed by feed, not by host element. Several callers rebuild their host with
// innerHTML immediately before mounting, so a registry keyed by element never
// found the previous mount: every re-render added another pair of document
// listeners, each still rendering into a node that had already been discarded.
// Opening a series of storms, retrying radar or running several spatial
// searches accumulated them for the life of the tab.
const mounts = new Map();

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return t('feeds.never');
  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function stateText(feed) {
  const base = t(`feeds.state.${feed.state}`);
  return feed.detail ? `${base} · ${t(`feeds.state.${feed.detail}`)}` : base;
}

export function renderOptionalFeedStatus(host, feedId, { now = Date.now() } = {}) {
  if (!host) return '';
  const feed = getOptionalFeedState(feedId);
  const definition = getOptionalFeedDefinition(feedId);
  const showRetry = feed.state !== 'loading' && feed.state !== 'idle' && feed.state !== 'unsupported';
  const itemText = Number.isFinite(feed.itemCount) ? t('feeds.items', feed.itemCount) : t('feeds.itemsUnknown');
  const lastGood = Number.isFinite(feed.lastSuccessAt)
    ? t('feeds.lastGoodAt', formatTimestamp(feed.lastSuccessAt))
    : t('feeds.lastGoodNever');
  const retryAt = Number.isFinite(feed.nextRetryAt)
    ? t('feeds.retryAt', formatTimestamp(feed.nextRetryAt))
    : '';
  const response = feed.responseStatus ? ` · ${t('feeds.httpStatus', feed.responseStatus)}` : '';
  host.dataset.feed = feedId;
  host.dataset.state = feed.state;
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.innerHTML = `
    <div class="optional-feed-status-head">
      <strong>${escapeHtml(t(definition.labelKey))}</strong>
      <span class="optional-feed-state">${escapeHtml(stateText(feed))}</span>
    </div>
    <div class="optional-feed-status-meta">
      <span>${escapeHtml(definition.source)}</span>
      <span>${escapeHtml(itemText)}</span>
      <span>${escapeHtml(lastGood)}${escapeHtml(retryAt)}${escapeHtml(response)}</span>
    </div>
    ${feed.state === 'stale' ? `<p class="optional-feed-last-good">${escapeHtml(t('feeds.showingLastGood'))}</p>` : ''}
    ${showRetry ? `<button class="text-btn optional-feed-retry" type="button" data-optional-feed-retry="${escapeHtml(feedId)}">${escapeHtml(t('feeds.retry'))}</button>` : ''}`;
  // An unsupported feed is reported in the diagnostics panel, not as a card
  // over the map: there is no action a reader could take about it.
  host.hidden = feed.state === 'idle' || feed.state === 'unsupported';
  return host.innerHTML;
}

export function mountOptionalFeedStatus(host, feedId, { onRetry = null, now = Date.now } = {}) {
  if (!host) return () => {};
  mounts.get(feedId)?.();
  const unregister = onRetry ? registerOptionalFeedRetry(feedId, onRetry) : null;
  const render = () => renderOptionalFeedStatus(host, feedId, { now: now() });
  const onChange = event => {
    if (event.detail?.id === feedId) render();
  };
  const onLocale = () => render();
  const onClick = async event => {
    const button = event.target.closest('[data-optional-feed-retry]');
    if (!button) return;
    button.disabled = true;
    await retryOptionalFeed(feedId);
    render();
  };
  document.addEventListener('hm-optional-feed:change', onChange);
  document.addEventListener('hm-locale:change', onLocale);
  host.addEventListener('click', onClick);
  const cleanup = () => {
    document.removeEventListener('hm-optional-feed:change', onChange);
    document.removeEventListener('hm-locale:change', onLocale);
    host.removeEventListener('click', onClick);
    unregister?.();
    // Only clear the slot if it is still ours: a later mount for the same feed
    // has already replaced it, and its cleanup must not be dropped.
    if (mounts.get(feedId) === cleanup) mounts.delete(feedId);
  };
  mounts.set(feedId, cleanup);
  render();
  return cleanup;
}
