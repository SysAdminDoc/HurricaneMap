import { categoryStrength } from './data.js';
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
