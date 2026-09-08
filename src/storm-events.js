// NOAA/NCEI Storm Events summary for hurricane landfall windows.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { presentNumber } from './metric-presenters.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  registerOptionalFeedRetry,
} from './optional-feeds.js';

let stormEventsPromise = null;

export async function loadStormEvents() {
  if (!stormEventsPromise) {
    const request = beginOptionalFeed('storm-events', { cacheOrigin: 'bundled' });
    stormEventsPromise = fetchWithTimeout('./data/storm-events.json', { cache: 'no-cache' }, REQUEST_TIMEOUT_MS.data)
      .then(response => {
        if (!response.ok) {
          const error = new Error(`Storm Events data returned ${response.status}`);
          error.responseStatus = response.status;
          throw error;
        }
        return response.json();
      })
      .then(data => {
        const stormCount = Object.keys(data?.storms || {}).length;
        completeOptionalFeed('storm-events', {
          empty: stormCount === 0,
          cacheOrigin: 'bundled',
          itemCount: stormCount,
          requestId: request.requestId,
        });
        return data;
      })
      .catch(error => {
        failOptionalFeed('storm-events', {
          error,
          responseStatus: error.responseStatus || 0,
          cacheOrigin: 'bundled',
          requestId: request.requestId,
        });
        stormEventsPromise = null;
        return null;
      });
  }
  return stormEventsPromise;
}

registerOptionalFeedRetry('storm-events', () => {
  stormEventsPromise = null;
  return loadStormEvents();
});

export function getStormEventRecord(data, stormId) {
  return data?.storms?.[stormId] || null;
}

export function renderStormEventsHtml(storm, record, metadata = {}) {
  const unavailable = storm?.year && storm.year < 1950;
  const method = metadata?.methodology || {};
  const before = method.window_before_hours ?? 24;
  const after = method.window_after_hours ?? 48;
  const source = metadata?.source?.name || 'NOAA/NCEI Storm Events Database';

  if (unavailable) {
    return emptyBlock(
      t('stormevents.title'),
      t('stormevents.unavailable'),
      source,
    );
  }

  if (!record || (!record.tornado_count && !record.hail_count)) {
    return emptyBlock(
      t('stormevents.title'),
      t('stormEvents.noneInWindow', before, after),
      source,
    );
  }

  const tornadoStates = statesForType(record, 'tornado');
  const hailStates = statesForType(record, 'hail');
  const maxHail = record.max_hail_in ? t('stormEvents.largestHail', presentNumber(record.max_hail_in, 2)) : '';
  const strongest = record.strongest_tornado_scale ? t('stormEvents.strongestTornado', escapeHtml(record.strongest_tornado_scale)) : '';

  return `
    <h3 class="panel-section-h3">${t('stormevents.title')}</h3>
    <div class="storm-events-block">
      <div class="se-row">
        <span class="se-label">${t('stormevents.tornadoActivity')}</span>
        <span class="se-value">${record.tornado_count === 1 ? t('stormEvents.reportsOne', 1) : t('stormEvents.reportsMany', record.tornado_count || 0)}${tornadoStates ? t('stormEvents.inStates', escapeHtml(tornadoStates)) : ''}${strongest}</span>
      </div>
      <div class="se-row">
        <span class="se-label">${t('stormevents.hailActivity')}</span>
        <span class="se-value">${record.hail_count === 1 ? t('stormEvents.reportsOne', 1) : t('stormEvents.reportsMany', record.hail_count || 0)}${hailStates ? t('stormEvents.inStates', escapeHtml(hailStates)) : ''}${maxHail}</span>
      </div>
      ${renderSampleEvents(record.sample_events)}
      <div class="se-source">${escapeHtml(source)} · ${t('stormEvents.window', before, after)}</div>
    </div>
  `;
}

export async function renderStormEventsSummary(host, storm) {
  if (!host) return;
  host.innerHTML = `
    <div class="storm-events-block storm-events-block--loading" role="status">
      Loading NOAA Storm Events summary...
    </div>
  `;
  const data = await loadStormEvents();
  if (!data) {
    host.innerHTML = emptyBlock(
      'Storm Events near landfall',
      'Storm Events summary data is unavailable right now.',
      'NOAA/NCEI Storm Events Database',
    );
    return;
  }
  host.innerHTML = renderStormEventsHtml(storm, getStormEventRecord(data, storm.id), data);
}

function statesForType(record, type) {
  const states = Object.entries(record.state_counts || {})
    .filter(([, counts]) => counts?.[type] > 0)
    .map(([state]) => state);
  if (states.length <= 3) return states.join(', ');
  return `${states.slice(0, 3).join(', ')} +${states.length - 3}`;
}

function renderSampleEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return '';
  const rows = events.slice(0, 4).map(event => {
    const place = [event.county, event.state].filter(Boolean).join(', ');
    const detail = event.type === 'Tornado' && event.tor_f_scale
      ? event.tor_f_scale
      : event.type === 'Hail' && event.magnitude
        ? `${event.magnitude} in`
        : '';
    return `<li><span>${escapeHtml(event.type)}</span><span>${escapeHtml(place)}</span><span>${escapeHtml(detail)}</span></li>`;
  }).join('');
  return `<ul class="se-samples" aria-label="${t('stormevents.sample')}">${rows}</ul>`;
}

function emptyBlock(title, message, source) {
  return `
    <h3 class="panel-section-h3">${escapeHtml(title)}</h3>
    <div class="storm-events-block storm-events-block--empty">
      <div class="se-empty">${escapeHtml(message)}</div>
      <div class="se-source">${escapeHtml(source)}</div>
    </div>
  `;
}

