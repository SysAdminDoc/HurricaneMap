// Annual climatology multi-line chart: yearly ACE total, named-storm count,
// US-landfall count, 1851-present. Surfaces in the stats panel as a third
// chart-style block. Computes once on first render and caches; cache survives
// for the life of the page session.
import { getLandfalls, ensureStormsLoaded, getStorm } from './data.js';
import { computeACE } from './metrics.js';

let _cache = null;

// Build per-year aggregates. Walks every loaded storm exactly once.
async function buildClimatology() {
  if (_cache) return _cache;
  await ensureStormsLoaded();
  const lf = getLandfalls();
  const yearMin = lf.reduce((a, b) => Math.min(a, b.year), 3000);
  const yearMax = lf.reduce((a, b) => Math.max(a, b.year), 0);
  // Map: year -> { ace, named: Set, landfalls }
  const m = new Map();
  for (let y = yearMin; y <= yearMax; y++) m.set(y, { ace: 0, named: new Set(), landfalls: 0 });

  // Named-storm + ACE: walk every storm with a track. NOTE: getStorm() is
  // populated by ensureStormsLoaded() from the generated storm bundle.
  // For seasons before NHC naming (pre-1950), HURDAT2 still IDs storms.
  // We approximate "named storm" as "storm with peak winds >= 34kt at some
  // point in track" (i.e. tropical-storm or stronger). This matches NOAA's
  // post-1950 naming threshold and gives a sensible pre-naming-era proxy.
  // Iterate by storm-id from the landfall list to drive lookups.
  const seenStormIds = new Set();
  for (const l of lf) {
    if (seenStormIds.has(l.storm_id)) continue;
    seenStormIds.add(l.storm_id);
    const s = getStorm(l.storm_id);
    if (!s || !s.track) continue;
    // ACE: storm contributes to its year-of-occurrence (use first track timestamp).
    const firstT = s.track[0]?.t;
    const yr = firstT ? new Date(firstT).getUTCFullYear() : l.year;
    const bucket = m.get(yr) || (m.set(yr, { ace: 0, named: new Set(), landfalls: 0 }), m.get(yr));
    try {
      const ace = computeACE(s.track);
      if (Number.isFinite(ace?.value)) bucket.ace += ace.value;
    } catch (e) { /* ignore */ }
    // Named-storm: peak wind >= 34kt
    const peak = s.track.reduce((a, p) => Math.max(a, p.wind || 0), 0);
    if (peak >= 34) bucket.named.add(l.storm_id);
  }
  // Landfalls per year — count rows directly.
  for (const l of lf) {
    const b = m.get(l.year) || (m.set(l.year, { ace: 0, named: new Set(), landfalls: 0 }), m.get(l.year));
    b.landfalls += 1;
  }

  const series = [];
  for (let y = yearMin; y <= yearMax; y++) {
    const b = m.get(y) || { ace: 0, named: new Set(), landfalls: 0 };
    series.push({ year: y, ace: b.ace, named: b.named.size, landfalls: b.landfalls });
  }
  _cache = { series, yearMin, yearMax };
  return _cache;
}

// SVG multi-line chart. Three lines on a shared x-axis (years), three
// independent y-scales rendered in a small legend. Annotates super-seasons
// (top 3 ACE years) with vertical guide lines.
export async function renderClimatologyChart(host) {
  if (!host) return;
  host.innerHTML = `<div class="clim-loading">Computing 174-year climatology…</div>`;
  const { series, yearMin, yearMax } = await buildClimatology();

  const W = 640, H = 220;
  const padL = 36, padR = 20, padT = 14, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxACE = Math.max(...series.map(s => s.ace), 1);
  const maxNamed = Math.max(...series.map(s => s.named), 1);
  const maxLF = Math.max(...series.map(s => s.landfalls), 1);

  const xAt = (y) => padL + ((y - yearMin) / (yearMax - yearMin || 1)) * innerW;
  const yACE = (v) => padT + innerH - (v / maxACE) * innerH;
  const yNamed = (v) => padT + innerH - (v / maxNamed) * innerH;
  const yLF = (v) => padT + innerH - (v / maxLF) * innerH;

  const path = (acc) => 'M' + series.map((s, i) => `${xAt(s.year).toFixed(1)},${acc(s).toFixed(1)}`).join(' L');
  const acePath = path(s => yACE(s.ace));
  const namedPath = path(s => yNamed(s.named));
  const lfPath = path(s => yLF(s.landfalls));

  // Top 3 ACE years for annotation.
  const top3 = [...series].sort((a, b) => b.ace - a.ace).slice(0, 3);
  const annotations = top3.map(s => {
    const x = xAt(s.year);
    return `
      <line class="clim-marker" x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" />
      <text class="clim-marker-label" x="${x.toFixed(1)}" y="${(padT - 2).toFixed(1)}" text-anchor="middle">${s.year}</text>
    `;
  }).join('');

  // Year axis ticks every 25 years.
  const ticks = [];
  const tickStep = 25;
  let tStart = Math.ceil(yearMin / tickStep) * tickStep;
  for (let y = tStart; y <= yearMax; y += tickStep) {
    const x = xAt(y);
    ticks.push(`<text class="clim-tick" x="${x.toFixed(1)}" y="${(padT + innerH + 14).toFixed(1)}" text-anchor="middle">${y}</text>
                <line class="clim-tick-line" x1="${x.toFixed(1)}" y1="${(padT + innerH).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(padT + innerH + 4).toFixed(1)}" />`);
  }

  host.innerHTML = `
    <div class="clim-chart-wrap">
      <svg class="clim-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Annual climatology: ACE, named storms, US landfalls, ${yearMin} to ${yearMax}">
        <!-- baseline -->
        <line class="clim-axis" x1="${padL}" y1="${(padT + innerH).toFixed(1)}" x2="${(padL + innerW).toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" />
        ${annotations}
        <!-- ACE line (filled area for emphasis) -->
        <path class="clim-line clim-ace" d="${acePath}" fill="none" />
        <!-- Named-storm count -->
        <path class="clim-line clim-named" d="${namedPath}" fill="none" />
        <!-- US landfalls -->
        <path class="clim-line clim-landfalls" d="${lfPath}" fill="none" />
        ${ticks.join('')}
      </svg>
      <div class="clim-legend">
        <div class="clim-legend-item"><span class="clim-swatch clim-ace"></span> ACE (Accumulated Cyclone Energy) — peak ${maxACE.toFixed(0)}</div>
        <div class="clim-legend-item"><span class="clim-swatch clim-named"></span> Named storms (≥34 kt) — peak ${maxNamed}</div>
        <div class="clim-legend-item"><span class="clim-swatch clim-landfalls"></span> US landfalls — peak ${maxLF}</div>
      </div>
      <p class="clim-note">Top 3 landfall-storm ACE years annotated at top: ${top3.map(s => `<strong>${s.year}</strong> (${s.ace.toFixed(0)})`).join(', ')}. ACE is subtotaled only for storms in this U.S.-landfall catalog; the named-storm threshold is the post-1950 naming convention applied retroactively.</p>
    </div>`;
}
