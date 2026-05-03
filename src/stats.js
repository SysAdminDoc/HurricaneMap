// Statistics panel: state hot/cold spots, decade trends, category mix.
import { getStats, getLandfalls } from './data.js';
import { closePanelsExcept, syncPanelControls } from './panels.js';

const panel = document.getElementById('stats-panel');
const body = document.getElementById('stats-body');
const closeBtn = document.getElementById('close-stats');

closeBtn.addEventListener('click', () => {
  panel.hidden = true;
  syncPanelControls();
});

export function toggleStats() {
  if (panel.hidden) {
    closePanelsExcept('stats-panel');
    render();
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
  syncPanelControls();
}

function render() {
  const stats = getStats();
  if (!stats) {
    body.innerHTML = '<p>Stats unavailable.</p>';
    return;
  }
  const stateRows = Object.entries(stats.by_state)
    .map(([name, v]) => ({ name, total: v.total, hu: v.by_cat.slice(1).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);

  const maxTotal = stateRows[0]?.total || 1;
  const stateBars = stateRows.map(r => bar(r.name, r.total, maxTotal, ` (${r.hu} hurricane)`)).join('');

  const decades = Object.entries(stats.by_decade)
    .map(([d, v]) => ({ decade: d, total: v.total, major: v.by_cat.slice(3).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => parseInt(a.decade) - parseInt(b.decade));
  const maxDecade = Math.max(...decades.map(d => d.total));
  const decadeBars = decades.map(d => bar(`${d.decade}s`, d.total, maxDecade, d.major ? ` (${d.major} major)` : '')).join('');

  const cat = stats.by_category;
  const catRows = [
    { label: 'TS / sub-hurricane', count: cat.ts_or_below, color: '--cat-ts' },
    { label: 'Category 1', count: cat.cat1, color: '--cat-1' },
    { label: 'Category 2', count: cat.cat2, color: '--cat-2' },
    { label: 'Category 3', count: cat.cat3, color: '--cat-3' },
    { label: 'Category 4', count: cat.cat4, color: '--cat-4' },
    { label: 'Category 5', count: cat.cat5, color: '--cat-5' },
  ];
  const maxCat = Math.max(...catRows.map(r => r.count));
  const catBars = catRows.map(r => coloredBar(r.label, r.count, maxCat, r.color)).join('');

  const cold = (stats.cold_spot_coastal_states || [])
    .map(s => `<span class="cold-tag">${s}</span>`).join('');

  body.innerHTML = `
    <h2>Statistics</h2>
    <p style="font-size:12px;color:var(--subtext);margin:0 0 14px;">
      ${stats.total_storms} U.S.-landfalling storms · ${stats.total_landfall_events} landfall events ·
      ${stats.total_hurricane_landfalls} of those at hurricane strength.
      Coverage: ${stats.year_range[0]}–${stats.year_range[1]}.
    </p>

    <h3>Landfalls by state</h3>
    ${stateBars}

    <h3>Landfalls by decade</h3>
    ${decadeBars}

    <h3>Landfalls by category</h3>
    ${catBars}

    <h3>Coastal states with no recorded hurricane landfall</h3>
    <div class="cold-list">${cold || '<span class="cold-tag">none</span>'}</div>
    <p style="font-size:11px;color:var(--subtext);margin-top:8px;line-height:1.5;">
      Tropical storms have hit these states; only Cat 1+ direct landfalls are excluded here.
      Note that 1971-1990 has known gaps in HURDAT2's continental-U.S. landfall marking.
    </p>
  `;
}

function bar(label, count, max, suffix = '') {
  const pct = Math.round((count / max) * 100);
  return `<div class="bar-row" title="${label}: ${count}${suffix}">
    <span class="label">${label}</span>
    <span class="bar"><span class="fill" style="width:${pct}%"></span></span>
    <span class="count">${count}</span>
  </div>`;
}

function coloredBar(label, count, max, cssVar) {
  const pct = Math.round((count / max) * 100);
  return `<div class="bar-row">
    <span class="label">${label}</span>
    <span class="bar"><span class="fill" style="width:${pct}%;background:var(${cssVar})"></span></span>
    <span class="count">${count}</span>
  </div>`;
}
