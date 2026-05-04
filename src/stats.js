// Statistics panel: state hot/cold spots, decade trends, category mix.
import { getStats, getLandfalls, getAllStorms } from './data.js';
import { closePanelsExcept, syncPanelControls } from './panels.js';
import { renderClimatologyChart } from './climatology.js';
import { renderDecadeTrends } from './decade-trends.js';
import { computeClimateTrends } from './metrics.js';
import { fetchSeasonalOutlook, renderOutlookBanner } from './seasonal-outlook.js';
import { escapeHtml } from './html-utils.js';

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
    body.innerHTML = `
      <div class="panel-empty-state">
        <strong>Statistics unavailable.</strong>
        <span>The summary dataset did not load. Refresh the page or verify the data files are being served.</span>
      </div>`;
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
    <h2 id="stats-panel-title">Statistics</h2>
    <p class="stats-summary">
      ${stats.total_storms} U.S.-landfalling storms · ${stats.total_landfall_events} landfall events ·
      ${stats.total_hurricane_landfalls} of those at hurricane strength.
      Coverage: ${stats.year_range[0]}–${stats.year_range[1]}.
    </p>

    <div id="seasonal-outlook-host"></div>

    <section class="stats-section">
      <h3>Landfalls by state</h3>
      ${stateBars}
    </section>

    <section class="stats-section">
      <h3>Landfalls by decade</h3>
      ${decadeBars}
    </section>

    <section class="stats-section">
      <h3>Landfalls by category</h3>
      ${catBars}
    </section>

    <section class="stats-section">
      <h3>Annual climatology — ACE, named storms, US landfalls</h3>
      <div id="climatology-chart" class="clim-host"></div>
    </section>

    <section class="stats-section">
      <h3>Climate trends — 10-year rolling averages</h3>
      <div id="climate-trends-chart" class="climate-trends-host"></div>
    </section>

    <section class="stats-section">
      <h3>Decade-by-decade trends</h3>
      <div id="decade-trends-chart" class="dt-host"></div>
    </section>

    <section class="stats-section">
      <h3>Coastal states with no recorded hurricane landfall</h3>
      <div class="cold-list">${cold || '<span class="cold-tag">none</span>'}</div>
      <p class="stats-note">
        Tropical storms have hit these states; only Cat 1+ direct landfalls are excluded here.
        HURDAT2's 1971-1990 continental-U.S. landfall markings have known gaps.
      </p>
    </section>
  `;
  // Async-render the climatology chart and decade trends after the synchronous stats are mounted.
  const climHost = document.getElementById('climatology-chart');
  if (climHost) renderClimatologyChart(climHost).catch(e => {
      climHost.innerHTML = `<p class="panel-inline-error">Climatology chart unavailable: ${escapeHtml(e.message || 'unknown error')}</p>`;
  });
  
  const dtHost = document.getElementById('decade-trends-chart');
  if (dtHost) renderDecadeTrends(dtHost).catch(e => {
    dtHost.innerHTML = `<p class="panel-inline-error">Decade trends unavailable: ${escapeHtml(e.message || 'unknown error')}</p>`;
  });

  const ctHost = document.getElementById('climate-trends-chart');
  if (ctHost) {
    try {
      const allStorms = getAllStorms();
      const trends = computeClimateTrends(allStorms);
      if (trends) renderClimateTrendsChart(ctHost, trends);
      else ctHost.innerHTML = '<p class="panel-muted">No trend data available.</p>';
    } catch (e) {
      ctHost.innerHTML = `<p class="panel-inline-error">Climate trends unavailable: ${escapeHtml(e.message || 'unknown error')}</p>`;
    }
  }

  // Fetch and render the current NOAA seasonal outlook
  const outlookHost = document.getElementById('seasonal-outlook-host');
  if (outlookHost) {
    fetchSeasonalOutlook()
      .then(outlook => {
        outlookHost.innerHTML = renderOutlookBanner(outlook);
      })
      .catch(e => {
        console.error('Seasonal outlook error:', e);
        outlookHost.innerHTML = '';
      });
  }
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

function renderClimateTrendsChart(host, trends) {
  if (!trends || !trends.rolling || trends.rolling.length === 0) {
    host.innerHTML = '<p class="panel-muted">No rolling trend data available.</p>';
    return;
  }

  const data = trends.rolling;
  const width = 800, height = 280;
  const margin = { top: 10, right: 20, bottom: 40, left: 50 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const years = data.map(d => d.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const xScale = (year) => ((year - minYear) / (maxYear - minYear)) * plotW;

  const maxLandfalls = Math.max(...data.map(d => d.rolling_avg_landfalls || 0));
  const maxACE = Math.max(...data.map(d => d.rolling_avg_ace || 0));
  const maxSpeed = Math.max(...data.map(d => d.rolling_avg_speed || 0));

  const yScaleLF = (val) => plotH - (val / (maxLandfalls || 1)) * plotH * 0.8;
  const yScaleACE = (val) => plotH - (val / (maxACE || 1)) * plotH * 0.8;
  const yScaleSpeed = (val) => plotH - (val / (maxSpeed || 1)) * plotH * 0.8;

  // Three polylines: landfalls (blue), ACE (lavender), forward speed (green)
  const lfPath = data.map((d, i) => `${margin.left + xScale(d.year)},${margin.top + yScaleLF(d.rolling_avg_landfalls)}`).join(' L ');
  const acePath = data.map((d, i) => `${margin.left + xScale(d.year)},${margin.top + yScaleACE(d.rolling_avg_ace)}`).join(' L ');
  const speedPath = data.map((d, i) => `${margin.left + xScale(d.year)},${margin.top + yScaleSpeed(d.rolling_avg_speed)}`).join(' L ');

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:var(--mantle);border-radius:8px;border:1px solid var(--surface0);">
      <defs>
        <style>
          .ct-line { fill: none; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
          .ct-landfalls { stroke: var(--sapphire); }
          .ct-ace { stroke: var(--lavender); }
          .ct-speed { stroke: var(--cat-1); }
          .ct-axis { stroke: var(--surface0); stroke-width: 1; }
          .ct-label { font-size: 11px; fill: var(--subtext); }
          .ct-title { font-size: 12px; fill: var(--text); font-weight: 600; }
        </style>
      </defs>
      
      <!-- Y axes -->
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="ct-axis" />
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="ct-axis" />
      
      <!-- Grid lines for Y -->
      <line x1="${margin.left}" y1="${margin.top + plotH * 0.5}" x2="${width - margin.right}" y2="${margin.top + plotH * 0.5}" class="ct-axis" opacity="0.2" />
      
      <!-- Polylines -->
      <polyline points="${lfPath}" class="ct-line ct-landfalls" />
      <polyline points="${acePath}" class="ct-line ct-ace" />
      <polyline points="${speedPath}" class="ct-line ct-speed" />
      
      <!-- Y-axis labels -->
      <text x="${margin.left - 8}" y="${margin.top + 4}" class="ct-label" text-anchor="end" dominant-baseline="middle">High</text>
      <text x="${margin.left - 8}" y="${margin.top + plotH}" class="ct-label" text-anchor="end" dominant-baseline="middle">Low</text>
      
      <!-- Legend -->
      <circle cx="${margin.left + 12}" cy="12" r="3" class="ct-landfalls" style="fill:var(--sapphire);" />
      <text x="${margin.left + 22}" y="16" class="ct-label">Landfalls</text>
      
      <circle cx="${margin.left + 120}" cy="12" r="3" style="fill:var(--lavender);" />
      <text x="${margin.left + 130}" y="16" class="ct-label">ACE</text>
      
      <circle cx="${margin.left + 170}" cy="12" r="3" style="fill:var(--cat-1);" />
      <text x="${margin.left + 180}" y="16" class="ct-label">Forward speed</text>
    </svg>
  `;

  host.innerHTML = svg;
  
  // Add a small text summary of trends
  const trendDir = (slope) => slope > 0 ? '↑ increasing' : slope < 0 ? '↓ decreasing' : '→ stable';
  const summary = `
    <p class="trend-summary">
      <strong>Trend direction (10-year rolling avg):</strong><br/>
      Landfalls: ${trendDir(trends.trends.landfalls_slope)} · 
      ACE: ${trendDir(trends.trends.ace_slope)} · 
      Speed: ${trendDir(trends.trends.speed_slope)}
    </p>
  `;
  host.innerHTML += summary;
}
