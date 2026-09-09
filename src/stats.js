// Statistics panel: state hot/cold spots, decade trends, category mix.
import { t } from './i18n.js';
import { getStats, getAllStorms, getImpactsFor, ensureStormsLoaded } from './data.js';
import { hidePanel, showPanel } from './panels.js';
import { renderClimatologyChart } from './climatology.js';
import { renderDecadeTrends } from './decade-trends.js';
import { computeClimateTrends } from './metrics.js';
import { fetchSeasonalOutlook, renderOutlookBanner } from './seasonal-outlook.js';
import { escapeHtml } from './html-utils.js';
import { presentCategory } from './metric-presenters.js';
import { summarizeImpactCoverage } from './impact-coverage.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';

let seasonalStatusCleanup = () => {};
let seasonalRenderGeneration = 0;

const panel = document.getElementById('stats-panel');
const body = document.getElementById('stats-body');
const closeBtn = document.getElementById('close-stats');

closeBtn.addEventListener('click', () => {
  hidePanel('stats-panel');
});

export function toggleStats() {
  if (panel.hidden) {
    render();
    showPanel('stats-panel');
  } else {
    hidePanel('stats-panel');
  }
}

function render() {
  const stats = getStats();
  if (!stats) {
    body.innerHTML = `
      <div class="panel-empty-state">
        <strong>${t('stats.unavailable')}</strong>
        <span>${t('stats.unavailableDetail')}</span>
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
    { label: `${presentCategory(-1, { style: 'short' })} / sub-hurricane`, count: cat.ts_or_below, color: '--cat-ts' },
    { label: presentCategory(1, { style: 'long' }), count: cat.cat1, color: '--cat-1' },
    { label: presentCategory(2, { style: 'long' }), count: cat.cat2, color: '--cat-2' },
    { label: presentCategory(3, { style: 'long' }), count: cat.cat3, color: '--cat-3' },
    { label: presentCategory(4, { style: 'long' }), count: cat.cat4, color: '--cat-4' },
    { label: presentCategory(5, { style: 'long' }), count: cat.cat5, color: '--cat-5' },
  ];
  const maxCat = Math.max(...catRows.map(r => r.count));
  const catBars = catRows.map(r => coloredBar(r.label, r.count, maxCat, r.color)).join('');

  const cold = (stats.cold_spot_coastal_states || [])
    .map(s => `<span class="cold-tag">${s}</span>`).join('');

  body.innerHTML = `
    <h2 id="stats-panel-title">${t('stats.title')}</h2>
    <p class="stats-summary">
      ${t('stats.summaryLine', stats.total_storms, stats.total_landfall_events)}
      ${t('stats.hurricaneStrengthSuffix', stats.total_hurricane_landfalls)}
      ${t('stats.coverageRange', stats.year_range[0], stats.year_range[1])}
    </p>

    <div id="seasonal-outlook-host"></div>

    <div class="stats-panel-layout">
      <div class="stats-panel-column stats-panel-column--counts">
        <section class="stats-section stats-section--states">
          <h3>${t('stats.landfallsByState')}</h3>
          ${stateBars}
        </section>

        <section class="stats-section stats-section--categories">
          <h3>${t('stats.landfallsByCategory')}</h3>
          ${catBars}
        </section>

        <section class="stats-section stats-section--cold">
          <h3>${t('stats.noHitStates')}</h3>
          <div class="cold-list">${cold || `<span class="cold-tag">${t('stats.noColdStates')}</span>`}</div>
          <p class="stats-note">
            ${t('stats.coldNoteScope')}
            ${t('stats.coldNoteGaps')}
          </p>
        </section>
        <section class="stats-section stats-section--impact-coverage">
          <h3>${t('impacts.coverageTitle')}</h3>
          <div id="impact-coverage-summary" class="impact-coverage-summary"><span class="panel-muted">${t('panel.loading')}</span></div>
        </section>
      </div>

      <div class="stats-panel-column stats-panel-column--decades">
        <section class="stats-section stats-section--decades">
          <h3>${t('stats.landfallsByDecade')}</h3>
          ${decadeBars}
        </section>
      </div>

      <div class="stats-panel-column stats-panel-column--charts">
        <section class="stats-section stats-section--climatology">
          <h3>${t('stats.climatologyChartHeading', t('stats.climatologyChart'))}</h3>
          <div id="climatology-chart" class="clim-host"></div>
        </section>

        <section class="stats-section stats-section--climate">
          <h3>${t('stats.climateTrendsHeading', t('stats.climateTrends'))}</h3>
          <div id="climate-trends-chart" class="climate-trends-host"></div>
        </section>
      </div>

      <div class="stats-panel-column stats-panel-column--trend-table">
        <section class="stats-section stats-section--trend-table">
          <h3>${t('stats.decadeTrends')}</h3>
          <div id="decade-trends-chart" class="dt-host"></div>
        </section>
      </div>
    </div>
  `;
  // Async-render the climatology chart and decade trends after the synchronous stats are mounted.
  const climHost = document.getElementById('climatology-chart');
  if (climHost) renderClimatologyChart(climHost).catch(e => {
      climHost.innerHTML = `<p class="panel-inline-error">${t('stats.climatologyUnavailable', escapeHtml(e.message || t('stats.unknownError')))}</p>`;
  });
  
  const dtHost = document.getElementById('decade-trends-chart');
  if (dtHost) renderDecadeTrends(dtHost).catch(e => {
    dtHost.innerHTML = `<p class="panel-inline-error">${t('stats.decadeUnavailable', escapeHtml(e.message || t('stats.unknownError')))}</p>`;
  });

  const ctHost = document.getElementById('climate-trends-chart');
  if (ctHost) {
    ctHost.innerHTML = `<p class="panel-muted">${t('stats.climateTrendsLoading')}</p>`;
    ensureStormsLoaded().then(() => {
      if (!ctHost.isConnected) return;
      const trends = computeClimateTrends(getAllStorms());
      if (trends) renderClimateTrendsChart(ctHost, trends);
      else ctHost.innerHTML = `<p class="panel-muted">${t('stats.noTrendData')}</p>`;
    }).catch(e => {
      if (ctHost.isConnected) {
        ctHost.innerHTML = `<p class="panel-inline-error">${t('stats.climateTrendsUnavailable', escapeHtml(e.message || t('stats.unknownError')))}</p>`;
      }
    });
  }

  const impactHost = document.getElementById('impact-coverage-summary');
  if (impactHost) {
    ensureStormsLoaded().then(() => {
      if (!impactHost.isConnected) return;
      impactHost.innerHTML = renderImpactCoverage(
        summarizeImpactCoverage(getAllStorms(), stormId => Boolean(getImpactsFor(stormId))),
      );
    }).catch(() => {
      if (impactHost.isConnected) impactHost.textContent = t('impacts.coverageUnavailable');
    });
  }

  // Fetch and render the current NOAA seasonal outlook
  const outlookHost = document.getElementById('seasonal-outlook-host');
  if (outlookHost) {
    const renderSeasonal = async () => {
      const generation = ++seasonalRenderGeneration;
      seasonalStatusCleanup();
      const outlook = await fetchSeasonalOutlook();
      if (!outlookHost.isConnected || generation !== seasonalRenderGeneration) return;
      outlookHost.innerHTML = renderOutlookBanner(outlook);
      const statusHost = outlookHost.querySelector('[data-feed-status="seasonal"]');
      seasonalStatusCleanup = mountOptionalFeedStatus(statusHost, 'seasonal', { onRetry: renderSeasonal });
    };
    renderSeasonal().catch(e => {
      console.error('Seasonal outlook error:', e);
      seasonalStatusCleanup();
      outlookHost.innerHTML = '';
    });
  }
}

function renderImpactCoverage(coverage) {
  const percent = coverage.total ? Math.round(coverage.covered / coverage.total * 100) : 0;
  return `
    <p>${t('impacts.coverageSummary', coverage.covered, coverage.total, percent)}</p>
    <p class="stats-note">${t('impacts.missingMeaning')}</p>
    <details>
      <summary>${t('impacts.showByYear')}</summary>
      <div class="impact-coverage-table-wrap">
        <table class="impact-coverage-table">
          <thead><tr><th>${t('impacts.year')}</th><th>${t('impacts.covered')}</th><th>${t('impacts.missing')}</th></tr></thead>
          <tbody>${coverage.years.map(row => `<tr><th>${row.year}</th><td>${row.covered}</td><td>${row.missing}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`;
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
    host.innerHTML = `<p class="panel-muted">${t('stats.noRollingTrendData')}</p>`;
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

  // Three polylines: landfalls (blue), ACE (lavender), forward speed (green).
  // `points` takes a bare coordinate list. An `L` between pairs is `path`
  // syntax, and one in here makes the SVG parser reject the whole attribute,
  // so the curve silently does not draw.
  const lfPath = data.map((d) => `${margin.left + xScale(d.year)},${margin.top + yScaleLF(d.rolling_avg_landfalls)}`).join(' ');
  const acePath = data.map((d) => `${margin.left + xScale(d.year)},${margin.top + yScaleACE(d.rolling_avg_ace)}`).join(' ');
  const speedPath = data.map((d) => `${margin.left + xScale(d.year)},${margin.top + yScaleSpeed(d.rolling_avg_speed)}`).join(' ');

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:var(--mantle);border-radius:8px;border:1px solid var(--surface0);">
      <defs>
        <style>
          .ct-line { fill: none; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
          .ct-landfalls { stroke: var(--ink-link); }
          .ct-ace { stroke: var(--ink-accent); }
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
      <text x="${margin.left - 8}" y="${margin.top + 4}" class="ct-label" text-anchor="end" dominant-baseline="middle">${t('stats.high')}</text>
      <text x="${margin.left - 8}" y="${margin.top + plotH}" class="ct-label" text-anchor="end" dominant-baseline="middle">${t('stats.low')}</text>
      
      <!-- Legend -->
      <circle cx="${margin.left + 12}" cy="12" r="3" class="ct-landfalls" style="fill:var(--ink-link);" />
      <text x="${margin.left + 22}" y="16" class="ct-label">${t('stats.landfallsLegend')}</text>
      
      <circle cx="${margin.left + 120}" cy="12" r="3" style="fill:var(--ink-accent);" />
      <text x="${margin.left + 130}" y="16" class="ct-label">ACE</text>
      
      <circle cx="${margin.left + 170}" cy="12" r="3" style="fill:var(--cat-1);" />
      <text x="${margin.left + 180}" y="16" class="ct-label">${t('stats.forwardSpeed')}</text>
    </svg>
  `;

  host.innerHTML = svg;
  
  // Add a small text summary of trends
  const trendDir = (slope) => (slope > 0 ? t('stats.trendIncreasing') : slope < 0 ? t('stats.trendDecreasing') : t('stats.trendStable'));
  const summary = `
    <p class="trend-summary">
      <strong>${t('stats.trendDirectionLabel')}</strong><br/>
      ${t('stats.trendLandfalls')} ${trendDir(trends.trends.landfalls_slope)} · 
      ACE: ${trendDir(trends.trends.ace_slope)} · 
      ${t('stats.trendSpeed')} ${trendDir(trends.trends.speed_slope)}
    </p>
  `;
  host.innerHTML += summary;
}
