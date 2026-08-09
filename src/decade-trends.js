// Decade-by-decade trend analysis: named-storm count, major-hurricane %,
// ACE total, deadliest and costliest storms per decade.
import { getStats, getLandfalls, ensureStormsLoaded, getStorm, getImpactsFor } from './data.js';
import { computeACE } from './metrics.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import {
  getDamageMillions,
  getFatalityCount,
  getRawDamageText,
  getRawFatalityText,
} from './impact-utils.js';
import { t } from './i18n.js';

let _cache = null;

// Pure decade bucketing helper. The browser-facing loader below supplies the
// data accessors; fixed-fixture tests can supply Maps instead.
export function buildDecadeTrendSeries(
  landfalls,
  getStormById,
  getImpactsById,
  { computeAce = computeACE } = {},
) {
  const lf = Array.isArray(landfalls) ? landfalls : [];
  if (!lf.length) return [];
  const yearMin = lf.reduce((a, b) => Math.min(a, b.year), 3000);
  const yearMax = lf.reduce((a, b) => Math.max(a, b.year), 0);

  const decades = new Map();
  for (let y = Math.floor(yearMin / 10) * 10; y <= yearMax; y += 10) {
    const decadeLabel = Math.floor(y / 10);
    decades.set(decadeLabel, {
      decade: decadeLabel,
      start: y,
      end: y + 9,
      named: new Set(),
      major: 0,
      totalLF: 0,
      ace: 0,
      deathlyStorms: [],
      costlyStorms: [],
    });
  }

  const seenStormIds = new Set();
  for (const landfall of lf) {
    if (seenStormIds.has(landfall.storm_id)) continue;
    seenStormIds.add(landfall.storm_id);

    const storm = getStormById?.(landfall.storm_id);
    if (!storm || !storm.track) continue;
    const decadeLabel = Math.floor(landfall.year / 10);
    const bucket = decades.get(decadeLabel);
    if (!bucket) continue;

    const peak = storm.track.reduce((a, p) => Math.max(a, p.wind || 0), 0);
    if (peak >= 34) bucket.named.add(landfall.storm_id);
    if (peak >= 96) bucket.major += 1;

    try {
      const ace = computeAce(storm.track);
      if (Number.isFinite(ace?.value)) bucket.ace += ace.value;
    } catch (e) { /* ignore */ }

    const impacts = getImpactsById?.(landfall.storm_id);
    if (impacts) {
      const deaths = getFatalityCount(impacts);
      const damages = getDamageMillions(impacts);
      if (Number.isFinite(deaths) && deaths > 0) {
        bucket.deathlyStorms.push({
          id: landfall.storm_id,
          name: storm.name,
          year: landfall.year,
          deaths,
          rawDeaths: getRawFatalityText(impacts),
        });
      }
      if (Number.isFinite(damages) && damages > 0) {
        bucket.costlyStorms.push({
          id: landfall.storm_id,
          name: storm.name,
          year: landfall.year,
          damages,
          rawDamages: getRawDamageText(impacts),
        });
      }
    }
  }

  for (const landfall of lf) {
    const decadeLabel = Math.floor(landfall.year / 10);
    const bucket = decades.get(decadeLabel);
    if (bucket) bucket.totalLF += 1;
  }

  const series = [];
  for (const [decadeLabel, bucket] of decades) {
    bucket.deathlyStorms.sort((a, b) => b.deaths - a.deaths);
    bucket.costlyStorms.sort((a, b) => b.damages - a.damages);
    const majorPct = bucket.named.size > 0
      ? ((bucket.major / bucket.named.size) * 100).toFixed(0)
      : '0';
    series.push({
      decadeLabel,
      decade: `${bucket.decade * 10}s`,
      named: bucket.named.size,
      major: bucket.major,
      majorPct,
      ace: bucket.ace,
      deadliest: bucket.deathlyStorms[0] || null,
      costliest: bucket.costlyStorms[0] || null,
    });
  }
  return series.sort((a, b) => a.decadeLabel - b.decadeLabel);
}

// Compute decade-level aggregates with details.
async function buildDecadeTrends() {
  if (_cache) return _cache;
  await ensureStormsLoaded();
  const stats = getStats();
  if (!stats) return null;

  _cache = buildDecadeTrendSeries(getLandfalls(), getStorm, getImpactsFor);
  return _cache;
}

// Render a table-style decade analysis.
export async function renderDecadeTrends(host) {
  if (!host) return;
  host.innerHTML = `<div class="dt-loading">Computing decade trends…</div>`;
  
  const series = await buildDecadeTrends();
  if (!series || series.length === 0) {
    host.innerHTML = `<p>No decade data available.</p>`;
    return;
  }

  // Build table rows.
  const rows = series.map(d => `
    <tr class="dt-row">
      <th scope="row" class="dt-decade">${d.decade}</th>
      <td class="dt-named">${d.named}</td>
      <td class="dt-major">${d.major} (${d.majorPct}%)</td>
      <td class="dt-ace">${d.ace.toFixed(0)}</td>
      <td class="dt-deadliest">
        ${d.deadliest
          ? `<span title="Deaths: ${escapeHtml(d.deadliest.rawDeaths)}">${escapeHtml(formatStormName(d.deadliest.name))} (${d.deadliest.year})</span>`
          : '—'}
      </td>
      <td class="dt-costliest">
        ${d.costliest
          ? `<span title="Damages: ${escapeHtml(d.costliest.rawDamages)}">${escapeHtml(formatStormName(d.costliest.name))} (${d.costliest.year})</span>`
          : '—'}
      </td>
    </tr>
  `).join('');

  host.innerHTML = `
    <div class="dt-table-wrap" role="region" tabindex="0" aria-label="${escapeHtml(t('stats.decadeTrends'))}">
      <table class="dt-table">
        <thead>
          <tr>
            <th scope="col" class="dt-decade">Decade</th>
            <th scope="col" class="dt-named" title="Named storms (≥34kt)">Named</th>
            <th scope="col" class="dt-major" title="Major hurricanes (≥96kt / Cat 3+)">Major</th>
            <th scope="col" class="dt-ace" title="Accumulated Cyclone Energy">ACE</th>
            <th scope="col" class="dt-deadliest">Deadliest</th>
            <th scope="col" class="dt-costliest">Costliest</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    <p class="dt-note">
      Major hurricane % reflects Category 3+ at peak intensity (≥96 kt).
      Deadliest/costliest use normalized impact fields from Wikipedia infoboxes.
      Hover over storm names to see details.
    </p>
  `;
}
