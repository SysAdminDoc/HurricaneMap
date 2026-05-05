// Decade-by-decade trend analysis: named-storm count, major-hurricane %,
// ACE total, deadliest and costliest storms per decade.
import { getStats, getLandfalls, ensureStormsLoaded, getStorm, getImpactsFor } from './data.js';
import { computeACE } from './metrics.js';
import { escapeHtml, formatStormName } from './html-utils.js';

let _cache = null;

function parseLeadingNumber(value) {
  if (value == null) return null;
  const match = String(value).replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

// Compute decade-level aggregates with details.
async function buildDecadeTrends() {
  if (_cache) return _cache;
  await ensureStormsLoaded();
  const stats = getStats();
  if (!stats) return null;

  const lf = getLandfalls();
  const yearMin = lf.reduce((a, b) => Math.min(a, b.year), 3000);
  const yearMax = lf.reduce((a, b) => Math.max(a, b.year), 0);

  // Decade buckets: 1850s = decade 185, 1860s = decade 186, etc.
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

  // Walk all landfalls and storms.
  const seenStormIds = new Set();
  for (const lf of getLandfalls()) {
    if (seenStormIds.has(lf.storm_id)) continue;
    seenStormIds.add(lf.storm_id);
    
    const s = getStorm(lf.storm_id);
    if (!s || !s.track) continue;

    const yr = lf.year;
    const decadeLabel = Math.floor(yr / 10);
    const bucket = decades.get(decadeLabel);
    if (!bucket) continue;

    // Named storms (>= 34kt)
    const peak = s.track.reduce((a, p) => Math.max(a, p.wind || 0), 0);
    if (peak >= 34) {
      bucket.named.add(lf.storm_id);
    }

    // Major hurricanes (>= 96kt, Cat 3+)
    if (peak >= 96) {
      bucket.major += 1;
    }

    // ACE
    try {
      const ace = computeACE(s.track);
      if (Number.isFinite(ace?.value)) bucket.ace += ace.value;
    } catch (e) { /* ignore */ }

    // Track deadliest and costliest for later ranking.
    const impacts = getImpactsFor(lf.storm_id);
    if (impacts) {
      const deaths = parseLeadingNumber(impacts.deaths);
      const damages = parseLeadingNumber(impacts.damages);
      if (deaths != null) bucket.deathlyStorms.push({ id: lf.storm_id, name: s.name, year: yr, deaths, rawDeaths: impacts.deaths });
      if (damages != null) bucket.costlyStorms.push({ id: lf.storm_id, name: s.name, year: yr, damages, rawDamages: impacts.damages });
    }
  }

  // Landfalls per decade (already counted in stats, but for clarity):
  for (const lf of getLandfalls()) {
    const decadeLabel = Math.floor(lf.year / 10);
    const bucket = decades.get(decadeLabel);
    if (bucket) bucket.totalLF += 1;
  }

  // Sort and pick top deadly/costly.
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

  _cache = series.sort((a, b) => a.decadeLabel - b.decadeLabel);
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
          ? `<span title="Damages: ${escapeHtml(d.costliest.rawDamages)} million USD">${escapeHtml(formatStormName(d.costliest.name))} (${d.costliest.year})</span>`
          : '—'}
      </td>
    </tr>
  `).join('');

  host.innerHTML = `
    <div class="dt-table-wrap">
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
      Deadliest/costliest are nominal dollars (not inflation-adjusted).
      Hover over storm names to see details.
    </p>
  `;
}
