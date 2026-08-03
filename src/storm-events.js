// NOAA/NCEI Storm Events summary for hurricane landfall windows.

import { t } from './i18n.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

let stormEventsPromise = null;

export async function loadStormEvents() {
  if (!stormEventsPromise) {
    stormEventsPromise = fetchWithTimeout('./data/storm-events.json', { cache: 'no-cache' }, REQUEST_TIMEOUT_MS.data)
      .then(response => {
        if (!response.ok) throw new Error(`Storm Events data returned ${response.status}`);
        return response.json();
      })
      .catch(() => { stormEventsPromise = null; return null; });
  }
  return stormEventsPromise;
}

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
      `No tornado or hail reports were found in affected states from ${before}h before to ${after}h after U.S. landfall.`,
      source,
    );
  }

  const tornadoStates = statesForType(record, 'tornado');
  const hailStates = statesForType(record, 'hail');
  const maxHail = record.max_hail_in ? ` · largest ${formatNumber(record.max_hail_in, 2)} in` : '';
  const strongest = record.strongest_tornado_scale ? ` · strongest ${escapeHtml(record.strongest_tornado_scale)}` : '';

  return `
    <h3 class="panel-section-h3">${t('stormevents.title')}</h3>
    <div class="storm-events-block">
      <div class="se-row">
        <span class="se-label">Tornado activity during landfall</span>
        <span class="se-value">${record.tornado_count || 0} report${record.tornado_count === 1 ? '' : 's'}${tornadoStates ? ` in ${escapeHtml(tornadoStates)}` : ''}${strongest}</span>
      </div>
      <div class="se-row">
        <span class="se-label">Hail activity during landfall</span>
        <span class="se-value">${record.hail_count || 0} report${record.hail_count === 1 ? '' : 's'}${hailStates ? ` in ${escapeHtml(hailStates)}` : ''}${maxHail}</span>
      </div>
      ${renderSampleEvents(record.sample_events)}
      <div class="se-source">${escapeHtml(source)} · ${before}h before to ${after}h after U.S. landfall</div>
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
  return `<ul class="se-samples" aria-label="Sample matching Storm Events">${rows}</ul>`;
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

function formatNumber(value, decimals = 0) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
