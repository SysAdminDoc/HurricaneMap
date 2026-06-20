import { categoryLabel } from './data.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { formatWind } from './settings.js';

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
  if (panel) panel.hidden = false;
}

export function hide() {
  if (panel) panel.hidden = true;
}

export function isOpen() {
  return panel && !panel.hidden;
}

function render(landfalls) {
  if (!body) return;
  const sorted = sortRows([...landfalls], lastSort.col, lastSort.dir);
  const arrow = (col) => lastSort.col === col ? (lastSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  const th = (col, label) => `<th role="columnheader" aria-sort="${lastSort.col === col ? (lastSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" data-col="${col}" tabindex="0">${label}${arrow(col)}</th>`;

  body.innerHTML = `
    <div class="table-view-scroll">
      <table class="table-view-table" role="table" aria-label="Filtered hurricane landfalls">
        <thead>
          <tr>${th('year', 'Year')}${th('name', 'Name')}${th('category', 'Category')}${th('state', 'State')}${th('wind', 'Wind')}${th('pres', 'Pressure')}</tr>
        </thead>
        <tbody>
          ${sorted.map(lf => `<tr data-sid="${escapeHtml(lf.storm_id)}" data-t="${escapeHtml(lf.t)}" tabindex="0">
            <td>${lf.year}</td>
            <td>${escapeHtml(formatStormName(lf.name))}</td>
            <td><span class="cat-pill cat-${lf.category <= 0 ? 'ts' : lf.category}">${escapeHtml(categoryLabel(lf.category))}</span></td>
            <td>${escapeHtml(lf.state || '')}</td>
            <td>${lf.wind ? formatWind(lf.wind) : '—'}</td>
            <td>${lf.pres ? `${lf.pres} mb` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="table-view-count">${landfalls.length.toLocaleString()} landfall${landfalls.length === 1 ? '' : 's'}</p>
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
    if (va == null) return 1; if (vb == null) return -1;
    return va < vb ? -m : va > vb ? m : 0;
  });
}
