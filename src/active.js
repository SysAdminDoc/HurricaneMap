// Active storm tracking — pulls NHC's live CurrentStorms.json feed at boot,
// hourly while storms are active, quieter when the feed is empty, and with
// explicit backoff when the proxy/NHC path is delayed or rate-limited. When storms are active, renders their
// advisory tracks + cones of uncertainty in a distinctive electric-blue
// style.

import { getMap } from './map.js';
import { escapeHtml, safeExternalUrl } from './html-utils.js';
import {
  activeAdvisoryKey,
  activeFeedStatusText,
  computeActivePollDelay,
  isPotentialTropicalCyclone,
  pronunciationUrlForActiveStorm,
} from './active-polling.js';
import {
  clearOfficialForecastCache,
  clearOfficialForecastContext,
  renderOfficialForecastContext,
} from './cone.js';
import { hideGoesRealtimeContext, latestStormPoint, renderGoesRealtimeContext } from './goes-realtime.js';
import { clearTropicalAlerts, renderTropicalAlerts } from './alerts.js';
import { bearingDeg, compassLabel, kmToMi } from './metrics.js';
import { clearPeakSurge, clearPeakSurgeCache, renderPeakSurge } from './peak-surge.js';
import { getSetting } from './settings.js';
import { t } from './i18n.js';
import { clearTropicalOutlook, renderTropicalOutlook } from './outlook.js';
import { clearMarineWarnings, renderMarineWarnings } from './marine-warnings.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  idleOptionalFeed,
  reportOptionalFeedResult,
} from './optional-feeds.js';

const L = window.L;

const NHC_DIRECT = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const NHC_CF_PROXY = '/nhc/CurrentStorms.json';
const NHC_FALLBACK = 'https://corsproxy.io/?url=' + encodeURIComponent(NHC_DIRECT);
const REQUEST_TIMEOUT_MS = 12 * 1000;

let layerGroup = null;
let badgeEl = null;
let lastStorms = null;
let lastAdvisoryKey = '';
let lastSuccessfulFetchAt = null;
let nextPollAt = null;
let pollTimer = null;
let pollingStarted = false;
let consecutiveFailures = 0;

export async function startActiveStormPolling() {
  if (pollingStarted) return;
  pollingStarted = true;

  // Listen for active-storm context toggle changes.
  document.addEventListener('hm-settings:change', (e) => {
    if (
      e.detail.key === 'nhcForecastCone' ||
      e.detail.key === 'goesRealtime'
    ) {
      if (lastStorms) {
        renderActive(lastStorms);
      }
    }
    if (e.detail.key === 'nhcOutlook' || e.detail.key === 'marineWarnings') {
      renderOperationalLayers();
    }
  });
  document.addEventListener('hm-locale:change', () => {
    if (lastStorms) renderActive(lastStorms);
    renderOperationalLayers();
  });

  await renderOperationalLayers();
  await fetchAndRender();
}

async function fetchAndRender() {
  beginOptionalFeed('active', { nextRetryAt: nextPollAt });
  const result = await fetchCurrentStorms();
  const storms = result.storms || [];
  const countForStatus = result.ok ? storms.length : (lastStorms?.length || 0);
  const state = result.ok ? 'ok' : (result.status === 429 ? 'rate-limit' : 'error');

  if (!result.ok) {
    consecutiveFailures += 1;
    const delay = computeActivePollDelay({
      ok: false,
      status: result.status,
      stormCount: countForStatus,
      failureCount: consecutiveFailures,
    });
    scheduleNextPoll(delay);
    failOptionalFeed('active', {
      responseStatus: result.status,
      error: result.error,
      nextRetryAt: nextPollAt,
    });
    ensureBadge(countForStatus, {
      state,
      fetchedAt: lastSuccessfulFetchAt,
      nextPollAt,
      status: result.status,
    });
    return;
  }

  consecutiveFailures = 0;
  lastSuccessfulFetchAt = Date.now();
  lastStorms = storms;
  const advisoryKey = activeAdvisoryKey(storms);
  const advisoryChanged = Boolean(advisoryKey && advisoryKey !== lastAdvisoryKey);
  lastAdvisoryKey = advisoryKey;

  const delay = computeActivePollDelay({
    ok: true,
    stormCount: storms.length,
  });
  scheduleNextPoll(delay);
  completeOptionalFeed('active', {
    empty: storms.length === 0,
    itemCount: storms.length,
    completedAt: lastSuccessfulFetchAt,
    nextRetryAt: nextPollAt,
  });
  ensureBadge(storms.length, {
    state,
    fetchedAt: lastSuccessfulFetchAt,
    nextPollAt,
    advisoryChanged,
  });

  await renderOperationalLayers();

  if (!storms.length) {
    clearActiveLayers();
    hideGoesRealtimeContext();
    idleOptionalFeed('forecast');
    idleOptionalFeed('alerts');
    idleOptionalFeed('surge');
    idleOptionalFeed('goes');
    clearOfficialForecastContext();
    clearOfficialForecastCache();
    clearTropicalAlerts();
    clearPeakSurge();
    clearPeakSurgeCache();
    return;
  }
  await renderActive(storms);
}

async function renderOperationalLayers() {
  const map = getMap();
  const outlookEnabled = getSetting('nhcOutlook');
  const marineEnabled = getSetting('marineWarnings');
  if (outlookEnabled) beginOptionalFeed('outlook');
  else idleOptionalFeed('outlook');
  if (marineEnabled) beginOptionalFeed('marine');
  else idleOptionalFeed('marine');
  const [outlookResult, marineResult] = await Promise.all([
    renderTropicalOutlook({ map, enabled: outlookEnabled }),
    renderMarineWarnings({ map, enabled: marineEnabled }),
  ]);
  reportOptionalFeedResult('outlook', outlookResult);
  reportOptionalFeedResult('marine', marineResult);
}

function resolveProxyUrl() {
  try {
    const origin = new URL(location.origin);
    if (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1') {
      return NHC_FALLBACK;
    }
  } catch { /* fall through */ }
  return NHC_CF_PROXY;
}

async function tryFetch(url, signal) {
  const response = await fetch(url, { cache: 'no-cache', signal });
  if (response.status === 429) return { ok: false, status: 429, storms: [] };
  if (!response.ok) return { ok: false, status: response.status || 0, storms: [] };
  const data = await response.json();
  return { ok: true, status: response.status, storms: (data && data.activeStorms) || [] };
}

async function tryFetchWithTimeout(url) {
  // Per-attempt controller: a hung primary must not consume the fallback's
  // abort budget too.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await tryFetch(url, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCurrentStorms() {
  const primaryUrl = resolveProxyUrl();
  const fallbackUrl = primaryUrl === NHC_CF_PROXY ? NHC_FALLBACK : NHC_CF_PROXY;
  let primary = null;
  try {
    primary = await tryFetchWithTimeout(primaryUrl);
    // Honor rate-limit backoff without hammering the fallback.
    if (primary.ok || primary.status === 429) return primary;
  } catch { /* primary threw — fall through to fallback */ }
  // Hosts without the Cloudflare /nhc/ route (e.g. GitHub Pages) return 404
  // here rather than throwing, so non-ok results must also trigger fallback.
  try {
    return await tryFetchWithTimeout(fallbackUrl);
  } catch (error) {
    return primary || { ok: false, status: 0, storms: [], error };
  }
}

function scheduleNextPoll(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  nextPollAt = Date.now() + delayMs;
  pollTimer = setTimeout(fetchAndRender, delayMs);
}

function clearActiveLayers() {
  if (layerGroup) {
    getMap().removeLayer(layerGroup);
    layerGroup = null;
  }
}

function updateAppBadge(count) {
  try {
    if (count > 0 && navigator.setAppBadge) navigator.setAppBadge(count);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch { /* not installed as PWA or API unavailable */ }
}

function ensureBadge(count, {
  state = 'ok',
  fetchedAt = null,
  nextPollAt: scheduledAt = null,
  status = 0,
  advisoryChanged = false,
} = {}) {
  if (!badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.id = 'active-storm-badge';
    badgeEl.className = 'active-badge glass';
    badgeEl.setAttribute('role', 'status');
    badgeEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(badgeEl);
  }

  updateAppBadge(count);

  const shouldShow = count > 0 || state === 'error' || state === 'rate-limit';
  if (!shouldShow) {
    badgeEl.hidden = true;
    badgeEl.removeAttribute('data-state');
    return;
  }

  const mainText = count > 0
    ? t(count === 1 ? 'status.activeStorm' : 'status.activeStorms', count)
    : t(state === 'rate-limit' ? 'status.feedRateLimited' : 'status.feedDelayed');
  const statusText = activeFeedStatusText({
    state,
    stormCount: count,
    fetchedAt,
    nextPollAt: scheduledAt,
    status,
  });
  const links = count > 0 ? `
      <a class="ab-link" href="https://www.tropicaltidbits.com/storminfo/" target="_blank" rel="noopener" title="Model spaghetti tracks (Tropical Tidbits)">models</a>
      <a class="ab-link" href="https://www.trackthetropics.com/" target="_blank" rel="noopener" title="Spaghetti model viewer">tracks</a>
    ` : '';

  badgeEl.hidden = false;
  badgeEl.dataset.state = advisoryChanged ? 'updated' : state;
  badgeEl.setAttribute('aria-label', `${mainText}. ${statusText}`);
  badgeEl.innerHTML = `
      <span class="ab-pulse"></span>
      <span class="ab-main">
        <span class="ab-text">${escapeHtml(mainText)}</span>
        <span class="ab-status">${escapeHtml(statusText)}</span>
      </span>
      ${links}
    `;
}

/** " · 512 mi NE of you" when the user has geolocated in spatial search
 *  (shared hm-user-point-v1 key — written only by "Use my location"). */
function distanceFromUser([stormLat, stormLon]) {
  try {
    const point = JSON.parse(localStorage.getItem('hm-user-point-v1') || 'null');
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return '';
    const km = 6371 * 2 * Math.asin(Math.sqrt(
      Math.sin((stormLat - point.lat) * Math.PI / 360) ** 2 +
      Math.cos(point.lat * Math.PI / 180) * Math.cos(stormLat * Math.PI / 180) *
      Math.sin((stormLon - point.lon) * Math.PI / 360) ** 2,
    ));
    const dir = compassLabel(bearingDeg(point.lat, point.lon, stormLat, stormLon));
    return ` · ${Math.round(kmToMi(km))} mi ${dir} of you`;
  } catch {
    return '';
  }
}

export function activeStormDisplayName(storm) {
  const name = String(storm?.name || '').trim();
  if (name && name.toUpperCase() !== 'UNNAMED') return name;
  const number = String(storm?.binNumber || storm?.id || '').match(/\d{1,2}/)?.[0] || '';
  if (isPotentialTropicalCyclone(storm)) {
    return `${t('active.ptc')}${number ? ` ${Number(number)}` : ''}`;
  }
  return number ? `${t('active.storm')} ${Number(number)}` : t('active.storm');
}

function activeStormCardHtml(storm, currentPoint) {
  const name = activeStormDisplayName(storm);
  const classification = isPotentialTropicalCyclone(storm)
    ? t('active.ptc')
    : String(storm.classification || '').trim();
  const intensity = Number(storm.intensity);
  const links = [
    [safeExternalUrl(storm.publicAdvisory?.url), t('active.advisory')],
    [safeExternalUrl(storm.forecastDiscussion?.url), t('active.discussion')],
    [safeExternalUrl(pronunciationUrlForActiveStorm(storm)), t('active.pronunciation')],
    ['https://www.nhc.noaa.gov/rip-currents/map.html', t('active.ripCurrents')],
  ].filter(([url]) => url);
  return `<article class="active-storm-card">
    <h3>${escapeHtml(name)}</h3>
    <p>${escapeHtml([
      classification,
      Number.isFinite(intensity) ? `${intensity} kt` : '',
      currentPoint ? `${currentPoint[0].toFixed(1)}, ${currentPoint[1].toFixed(1)}` : '',
    ].filter(Boolean).join(' · '))}</p>
    <nav aria-label="${escapeHtml(t('active.links'))}">${links.map(([url, label]) => `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`).join('')}</nav>
  </article>`;
}

async function renderActive(storms) {
  const map = getMap();
  if (layerGroup) map.removeLayer(layerGroup);
  layerGroup = L.layerGroup();

  for (const s of storms) {
    // CurrentStorms.json exposes the current fix, not forecast/best-track
    // point arrays. Official observed/forecast tracks and cone geometry are
    // rendered below from the NHC FeatureServer.
    const point = latestStormPoint(s);
    const cur = point ? [point.lat, point.lon] : null;
    if (cur) {
      const ptc = isPotentialTropicalCyclone(s);
      const displayName = activeStormDisplayName(s);
      L.circleMarker(cur, {
        radius: 8, color: '#11111b', weight: 2,
        fillColor: ptc ? '#cba6f7' : '#89b4fa', fillOpacity: 0.95,
        dashArray: ptc ? '4 3' : null,
      }).bindTooltip(
        escapeHtml(`${displayName}${s.classification ? ' · ' + (ptc ? t('active.ptc') : s.classification) : ''}${s.intensity ? ' · ' + s.intensity + ' kt' : ''}${distanceFromUser(cur)}`),
        { direction: 'top' },
      ).bindPopup(activeStormCardHtml(s, cur), { className: 'active-storm-popup' }).addTo(layerGroup);
    }
  }
  layerGroup.addTo(map);

  const officialConeEnabled = getSetting('nhcForecastCone');
  if (officialConeEnabled) {
    beginOptionalFeed('forecast');
    beginOptionalFeed('alerts');
    beginOptionalFeed('surge');
  } else {
    idleOptionalFeed('forecast');
    idleOptionalFeed('alerts');
    idleOptionalFeed('surge');
  }
  const forecastResult = await renderOfficialForecastContext(storms, {
    map,
    enabled: officialConeEnabled,
  });
  reportOptionalFeedResult('forecast', forecastResult);

  // 2026 cone standard: coastal + inland tropical watches/warnings travel
  // with the official cone toggle.
  const alertsResult = await renderTropicalAlerts(storms, {
    map,
    enabled: officialConeEnabled,
  });
  reportOptionalFeedResult('alerts', alertsResult);

  // Peak Storm Surge forecast (published during surge watches/warnings;
  // empty otherwise) — same toggle as the official cone context.
  const surgeResult = await renderPeakSurge(storms, {
    map,
    enabled: officialConeEnabled,
  });
  reportOptionalFeedResult('surge', surgeResult);

  const goesEnabled = getSetting('goesRealtime');
  if (goesEnabled) {
    beginOptionalFeed('goes');
    const goesResult = await renderGoesRealtimeContext(storms, {
      map,
      enabled: true,
    });
    if (goesResult.status !== 'rendered') reportOptionalFeedResult('goes', goesResult);
  } else {
    hideGoesRealtimeContext();
    idleOptionalFeed('goes');
  }

}

export function clearActiveOperationalLayers() {
  clearTropicalOutlook();
  clearMarineWarnings();
}
