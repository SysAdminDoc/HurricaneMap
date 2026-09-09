import { escapeHtml } from './html-utils.js';
import { getDateLocale, t } from './i18n.js';
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
  return new Intl.DateTimeFormat(getDateLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function stateText(feed) {
  const base = t(`feeds.state.${feed.state}`);
  return feed.detail ? `${base} · ${t(`feeds.state.${feed.detail}`)}` : base;
}

function renderOptionalFeedStatus(host, feedId, { now = Date.now(), busyTarget = null } = {}) {
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
  markRegionBusy(host, busyTarget?.() || null);
  return host.innerHTML;
}

/**
 * Tell assistive technology when the thing a feed fills is being replaced.
 *
 * Without this a screen reader is handed a panel that still reads as its old
 * contents while a fetch is in flight, with nothing to say it is being
 * replaced. Recomputed from every feed status host inside the panel rather than
 * from this one, because a panel can carry several: clearing the flag when one
 * settles would announce it as ready while another was still loading. Any state
 * that is not `loading` clears it, so a failure cannot leave a panel busy
 * forever, which is worse than never marking it.
 *
 * Deliberately a managed side panel and not any region. The filter drawer is a
 * region too, and it holds the storm search and every filter control alongside
 * one feed: marking the whole of it busy while a tile layer loads would tell a
 * reader that the search box is being replaced, which is not true. Feeds whose
 * status card floats over the map are not inside the thing they describe at
 * all, so their caller names that thing and the card speaks only for itself.
 * The same rule binds a named target: name the element the feed fills, not a
 * container it happens to sit in.
 *
 * Scoped to status hosts, not to anything carrying the two attributes: the
 * diagnostics list renders a row per feed with the same pair, and counting
 * those would make one region busy for every feed in the app.
 */
function markRegionBusy(host, namedTarget) {
  const target = namedTarget || host.parentElement?.closest('.side-panel[role="region"]');
  if (!target) return;
  // A named target is the element the card describes rather than one it lives
  // in, so the card says which: without this they are two unrelated things on
  // the page as far as the accessibility tree is concerned.
  if (namedTarget && target.id && host.getAttribute('aria-controls') !== target.id) {
    host.setAttribute('aria-controls', target.id);
  }
  const busy = namedTarget
    ? host.dataset.state === 'loading'
    : [...target.querySelectorAll('.optional-feed-status-host[data-feed]')]
      .some(node => node.dataset.state === 'loading');
  if (busy) target.setAttribute('aria-busy', 'true');
  else target.removeAttribute('aria-busy');
}

/**
 * @param busyTarget A function returning the element this card's feed fills, for
 * a card that floats over the map instead of sitting inside a panel. Looked up
 * on each render because those elements are created lazily and replaced.
 */
export function mountOptionalFeedStatus(host, feedId, { onRetry = null, now = Date.now, busyTarget = null } = {}) {
  if (!host) return () => {};
  mounts.get(feedId)?.();
  const unregister = onRetry ? registerOptionalFeedRetry(feedId, onRetry) : null;
  const render = () => renderOptionalFeedStatus(host, feedId, { now: now(), busyTarget });
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
