import { categoryLabel, categoryStrength, formatTime, windToCategory } from './data.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { formatWind } from './settings.js';
import { showPanel, hidePanel } from './panels.js';
import { getLocale, t } from './i18n.js';

const panel = document.getElementById('table-view-panel');
const body = document.getElementById('table-view-body');
const closeBtn = document.getElementById('close-table-view');

let lastSort = { col: 'year', dir: 'desc' };
let lastData = [];
let onSelectCb = null;

if (closeBtn) closeBtn.addEventListener('click', () => { hide(); });

export function show(landfalls, onSelect) {
  lastData = landfalls;
  onSelectCb = onSelect;
  render(landfalls);
  // Route through the shared panel manager so the exclusive side-panel lane
  // holds (no stacking on stats/storm panels) and layout offsets stay synced.
  showPanel('table-view-panel');
}

export function hide() {
  hidePanel('table-view-panel');
}

export function isOpen() {
  return panel && !panel.hidden;
}

export function buildTrackTimelineRows(track = [], landfalls = []) {
  const points = Array.isArray(track)
    ? track.filter(point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon)))
      .map(point => ({ ...point, lat: Number(point.lat), lon: Number(point.lon), wind: Number.isFinite(Number(point.wind)) ? Number(point.wind) : null }))
    : [];
  const peakWind = points.reduce((max, point) => Math.max(max, point.wind ?? -Infinity), -Infinity);

  return points.map((point, index) => {
    const category = windToCategory(point.wind);
    const previousCategory = index > 0 ? windToCategory(points[index - 1].wind) : null;
    const categoryChanged = index > 0 && category !== previousCategory;
    const matchingLandfalls = Array.isArray(landfalls)
      ? landfalls.filter(landfall => sameTrackTime(point.t, landfall?.t))
      : [];
    const isPeak = Number.isFinite(peakWind) && point.wind === peakWind;
    const isStart = index === 0;
    const isEnd = index === points.length - 1;
    const isMilestone = isStart || isEnd || isPeak || categoryChanged || matchingLandfalls.length > 0;
    const hazardRank = matchingLandfalls.length > 0 ? 0 : isPeak ? 1 : categoryChanged ? 2 : isStart || isEnd ? 3 : 4;
    return {
      point,
      index,
      category,
      previousCategory,
      categoryChanged,
      landfalls: matchingLandfalls,
      isPeak,
      isStart,
      isEnd,
      isMilestone,
      hazardRank,
    };
  });
}

export function renderTrackTimeline(host, storm) {
  if (!host) return;
  const rows = buildTrackTimelineRows(storm?.track, storm?.us_landfalls);
  const titleId = `${host.id || 'track-timeline'}-title`;
  if (!rows.length) {
    host.innerHTML = `
      <details class="track-timeline">
        <summary id="${titleId}">${escapeHtml(t('table.trackTimelineTitle'))}</summary>
        <p class="track-timeline-empty" role="status">${escapeHtml(t('table.trackTimelineUnavailable'))}</p>
      </details>
    `;
    return;
  }
  const milestones = rows.filter(row => row.isMilestone).sort((a, b) => (
    a.hazardRank - b.hazardRank || a.index - b.index
  ));
  host.innerHTML = `
    <details class="track-timeline">
      <summary id="${titleId}">
        <span class="track-timeline-title">${escapeHtml(t('table.trackTimelineTitle'))}</span>
        <span class="track-timeline-count">${escapeHtml(t('table.trackTimelineSummary', rows.length, milestones.length))}</span>
      </summary>
      <div class="track-timeline-body">
        <p class="track-timeline-intro">${escapeHtml(t('table.trackTimelineIntro'))}</p>
        <h4>${escapeHtml(t('table.trackHighlights'))}</h4>
        <ol class="track-timeline-list track-timeline-highlights" aria-label="${escapeHtml(t('table.trackHighlightsLabel'))}">
          ${milestones.map(renderTrackTimelineRow).join('')}
        </ol>
        <details class="track-timeline-observations">
          <summary>${escapeHtml(t('table.trackAllObservations', rows.length))}</summary>
          <ol class="track-timeline-list" aria-label="${escapeHtml(t('table.trackObservationsLabel'))}">
            ${rows.map(renderTrackTimelineRow).join('')}
          </ol>
        </details>
      </div>
    </details>
  `;
}

function renderTrackTimelineRow(row) {
  const eventLabels = [];
  if (row.landfalls.length) {
    const states = row.landfalls.map(landfall => landfall.state || t('state.unknown')).join(', ');
    eventLabels.push(t('table.trackLandfall', states));
  }
  if (row.isPeak) eventLabels.push(t('table.trackPeak'));
  if (row.categoryChanged) {
    eventLabels.push(t('table.trackCategoryChange', categoryLabel(row.previousCategory), categoryLabel(row.category)));
  }
  if (row.isStart) eventLabels.push(t('table.trackStart'));
  if (row.isEnd) eventLabels.push(t('table.trackEnd'));
  const event = eventLabels.join(' · ') || t('table.trackObservation');
  const time = row.point.t ? formatTime(row.point.t) : t('table.trackTimeUnavailable');
  const wind = row.point.wind == null ? t('table.trackWindUnavailable') : formatWind(row.point.wind);
  return `
    <li class="track-timeline-row${row.isMilestone ? ' track-timeline-row--milestone' : ''}">
      <time datetime="${escapeHtml(row.point.t || '')}">${escapeHtml(time)}</time>
      <div class="track-timeline-row-detail">
        <strong>${escapeHtml(event)}</strong>
        <span>${escapeHtml(t('table.trackPosition', formatCoordinate(row.point.lat, 'N', 'S'), formatCoordinate(row.point.lon, 'E', 'W')))}</span>
        <span>${escapeHtml(t('table.trackIntensity', categoryLabel(row.category), wind))}</span>
      </div>
    </li>
  `;
}

function sameTrackTime(a, b) {
  if (a && b && a === b) return true;
  const aMs = Date.parse(a || '');
  const bMs = Date.parse(b || '');
  return Number.isFinite(aMs) && Number.isFinite(bMs) && Math.abs(aMs - bMs) <= 3 * 60 * 60 * 1000;
}

function formatCoordinate(value, positive, negative) {
  const number = Number(value);
  return `${Math.abs(number).toFixed(2)}°${number >= 0 ? positive : negative}`;
}

function render(landfalls) {
  if (!body) return;
  const sorted = sortRows([...landfalls], lastSort.col, lastSort.dir);
  const arrow = (col) => lastSort.col === col ? (lastSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  const th = (col, labelKey = col) => `<th role="columnheader" aria-sort="${lastSort.col === col ? (lastSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" data-col="${col}" tabindex="0">${escapeHtml(t(`table.column.${labelKey}`))}${arrow(col)}</th>`;
  const category = value => value === 0
    ? t('table.category.td')
    : value === -1
      ? t('table.category.ts')
      : t('table.category.hurricane', value);
  const count = landfalls.length === 1
    ? t('table.countOne')
    : t('table.countMany', landfalls.length.toLocaleString(getLocale()));

  body.innerHTML = `
    <div class="table-view-scroll">
      <table class="table-view-table" role="table" aria-label="${escapeHtml(t('table.filteredLabel'))}">
        <thead>
          <tr>${th('year')}${th('name')}${th('category')}${th('state')}${th('wind')}${th('pres', 'pressure')}</tr>
        </thead>
        <tbody>
          ${sorted.map(lf => `<tr data-sid="${escapeHtml(lf.storm_id)}" data-t="${escapeHtml(lf.t)}" tabindex="0">
            <td>${lf.year}</td>
            <td>${escapeHtml(formatStormName(lf.name))}</td>
            <td><span class="cat-pill cat-${lf.category <= 0 ? 'ts' : lf.category}">${escapeHtml(category(lf.category))}</span></td>
            <td>${escapeHtml(lf.state || '')}</td>
            <td>${lf.wind ? formatWind(lf.wind) : '—'}</td>
            <td>${lf.pres ? `${lf.pres} mb` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="table-view-count">${escapeHtml(count)}</p>
  `;

  body.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => sortBy(th.dataset.col));
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter') sortBy(th.dataset.col); });
  });

  if (onSelectCb) {
    body.querySelectorAll('tr[data-sid]').forEach(tr => {
      const handler = () => {
        const lf = lastData.find(x => x.storm_id === tr.dataset.sid && x.t === tr.dataset.t);
        if (lf) onSelectCb(lf);
      };
      tr.addEventListener('click', handler);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
    });
  }
}

function sortBy(col) {
  if (lastSort.col === col) lastSort.dir = lastSort.dir === 'asc' ? 'desc' : 'asc';
  else { lastSort.col = col; lastSort.dir = col === 'year' || col === 'wind' || col === 'pres' || col === 'category' ? 'desc' : 'asc'; }
  render(lastData);
}

function sortRows(rows, col, dir) {
  const m = dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (col === 'name') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
    if (col === 'category') { va = categoryStrength(va); vb = categoryStrength(vb); }
    // Consistent comparator for null cells (pre-1870s pressure rows): equal
    // nulls compare 0, and null placement follows the sort direction.
    if (va == null && vb == null) return 0;
    if (va == null) return m; if (vb == null) return -m;
    return va < vb ? -m : va > vb ? m : 0;
  });
}
