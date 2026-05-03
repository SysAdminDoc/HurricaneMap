// Inline SVG intensity chart for the storm panel.
//
// Two metrics on a shared time axis:
//   - sustained wind (kt) — left axis, line + dot per HURDAT2 track point,
//     dot color from Saffir-Simpson at that point.
//   - minimum pressure (mb) — right axis, dashed line. Inverted so "higher"
//     visually means "stronger" (lower mb = deeper storm).
//
// Vertical dashed markers at each U.S. landfall + a hover crosshair with a
// tooltip block. Pure SVG, no chart libraries.

import { categoryColor, formatTime } from './data.js';

const W = 360;          // total width in CSS px
const H = 160;          // total height
const M = { top: 14, right: 38, bottom: 28, left: 38 };
const PW = W - M.left - M.right;  // plot area width
const PH = H - M.top - M.bottom;

const WIND_DOMAIN = [0, 175];           // kt — covers Cat 5 with headroom
const PRES_DOMAIN = [880, 1015];        // mb — Allen '80 / Wilma '05 lower bound

function saffir(kt) {
  if (kt == null || kt < 34) return -1;
  if (kt < 64) return -1;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function renderIntensityChart(container, storm) {
  if (!container) return;
  const track = storm.track;
  if (!track || !track.length) {
    container.innerHTML = '';
    return;
  }
  const t0 = new Date(track[0].t).getTime();
  const t1 = new Date(track[track.length - 1].t).getTime();
  const tspan = Math.max(1, t1 - t0);

  const xOf = (t) => M.left + ((new Date(t).getTime() - t0) / tspan) * PW;
  const yWind = (w) => {
    if (w == null) return null;
    const v = Math.max(WIND_DOMAIN[0], Math.min(WIND_DOMAIN[1], w));
    return M.top + (1 - (v - WIND_DOMAIN[0]) / (WIND_DOMAIN[1] - WIND_DOMAIN[0])) * PH;
  };
  const yPres = (p) => {
    if (p == null) return null;
    // Invert pressure so lower mb = higher on chart (since lower mb = stronger storm).
    const v = Math.max(PRES_DOMAIN[0], Math.min(PRES_DOMAIN[1], p));
    return M.top + ((v - PRES_DOMAIN[0]) / (PRES_DOMAIN[1] - PRES_DOMAIN[0])) * PH;
  };

  // Build polyline points strings, splitting on null.
  const windSegments = buildSegments(track, (r) => r.wind, xOf, yWind);
  const presSegments = buildSegments(track, (r) => r.pres, xOf, yPres);

  // Saffir-Simpson reference bands on the wind axis (faint horizontal stripes).
  const bandY = (kt) => yWind(kt);
  const bandRects = [
    { y0: bandY(64), y1: bandY(83), color: 'rgba(166,227,161,0.06)' },   // Cat 1
    { y0: bandY(83), y1: bandY(96), color: 'rgba(249,226,175,0.06)' },   // Cat 2
    { y0: bandY(96), y1: bandY(113), color: 'rgba(250,179,135,0.06)' }, // Cat 3
    { y0: bandY(113), y1: bandY(137), color: 'rgba(243,139,168,0.06)' }, // Cat 4
    { y0: bandY(137), y1: bandY(WIND_DOMAIN[1]), color: 'rgba(203,166,247,0.06)' }, // Cat 5
  ].map(b => `<rect x="${M.left}" y="${b.y1}" width="${PW}" height="${b.y0 - b.y1}" fill="${b.color}"/>`).join('');

  // Y-axis tick labels (wind on left, pressure on right).
  const windTicks = [34, 64, 83, 96, 113, 137].filter(k => k <= WIND_DOMAIN[1]);
  const windAxis = windTicks.map(k => {
    const y = yWind(k);
    return `<g class="ax-tick">
      <line x1="${M.left}" y1="${y}" x2="${M.left + PW}" y2="${y}" stroke="rgba(205,214,244,0.06)" stroke-dasharray="2 3"/>
      <text x="${M.left - 4}" y="${y + 3}" text-anchor="end">${k}</text>
    </g>`;
  }).join('');
  const presTicks = [880, 920, 960, 1000];
  const presAxis = presTicks.map(p => {
    const y = yPres(p);
    return `<text class="ax-tick" x="${M.left + PW + 4}" y="${y + 3}" text-anchor="start">${p}</text>`;
  }).join('');

  // X-axis: 4 evenly spaced tick labels.
  const xTicks = 4;
  const xAxis = Array.from({ length: xTicks + 1 }, (_, i) => {
    const t = t0 + (tspan * i) / xTicks;
    const x = M.left + (PW * i) / xTicks;
    const d = new Date(t);
    const lbl = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return `<text class="ax-tick" x="${x}" y="${H - M.bottom + 14}" text-anchor="middle">${lbl}</text>`;
  }).join('');

  // Landfall markers (red dashed verticals).
  const landfallLines = (storm.us_landfalls || []).map(lf => {
    const x = xOf(lf.t);
    return `<line x1="${x}" x2="${x}" y1="${M.top}" y2="${M.top + PH}" stroke="rgba(243,139,168,0.7)" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${x}" y="${M.top - 3}" text-anchor="middle" fill="rgba(243,139,168,0.9)" font-size="9">L</text>`;
  }).join('');

  // Wind line + colored dots.
  const windLine = windSegments.map(seg =>
    `<polyline points="${seg.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="rgba(205,214,244,0.85)" stroke-width="1.4"/>`
  ).join('');
  const dots = track.map((r, i) => {
    if (r.wind == null) return '';
    const x = xOf(r.t);
    const y = yWind(r.wind);
    const c = categoryColor(saffir(r.wind));
    return `<circle data-i="${i}" cx="${x}" cy="${y}" r="2.5" fill="${c}" stroke="rgba(0,0,0,0.4)" stroke-width="0.6" class="chart-dot"/>`;
  }).join('');

  // Pressure line.
  const presLine = presSegments.map(seg =>
    `<polyline points="${seg.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="rgba(116,199,236,0.7)" stroke-width="1" stroke-dasharray="3 2"/>`
  ).join('');

  const svg = `
    <div class="intensity-chart">
      <div class="chart-legend">
        <span class="cl-item"><span class="cl-swatch wind"></span>Wind (kt) ↑</span>
        <span class="cl-item"><span class="cl-swatch pres"></span>Pressure (mb) ↓ inverted</span>
        <span class="cl-item cl-landfall">L = U.S. landfall</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="intensity-svg" role="img" aria-label="Intensity over time chart">
        ${bandRects}
        <line x1="${M.left}" y1="${M.top + PH}" x2="${M.left + PW}" y2="${M.top + PH}" stroke="rgba(205,214,244,0.18)"/>
        <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + PH}" stroke="rgba(205,214,244,0.18)"/>
        <line x1="${M.left + PW}" y1="${M.top}" x2="${M.left + PW}" y2="${M.top + PH}" stroke="rgba(205,214,244,0.18)"/>
        ${windAxis}
        ${presAxis}
        ${xAxis}
        ${landfallLines}
        ${presLine}
        ${windLine}
        ${dots}
        <line class="chart-cursor" x1="-10" x2="-10" y1="${M.top}" y2="${M.top + PH}" stroke="rgba(180,190,254,0.6)" stroke-width="1" style="display:none"/>
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;
  container.innerHTML = svg;

  // Hover interaction — highlight the closest track point.
  const svgEl = container.querySelector('.intensity-svg');
  const cursor = container.querySelector('.chart-cursor');
  const tooltip = container.querySelector('.chart-tooltip');
  svgEl.addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const xRel = ((e.clientX - rect.left) / rect.width) * W;
    if (xRel < M.left || xRel > M.left + PW) {
      cursor.style.display = 'none';
      tooltip.hidden = true;
      return;
    }
    // Find nearest track point in time.
    const tx = ((xRel - M.left) / PW) * tspan + t0;
    let best = 0;
    let bestDt = Infinity;
    for (let i = 0; i < track.length; i++) {
      const dt = Math.abs(new Date(track[i].t).getTime() - tx);
      if (dt < bestDt) { bestDt = dt; best = i; }
    }
    const r = track[best];
    const cx = xOf(r.t);
    cursor.setAttribute('x1', cx);
    cursor.setAttribute('x2', cx);
    cursor.style.display = '';
    const cat = saffir(r.wind);
    const catLabel = cat <= 0 ? (r.wind != null && r.wind >= 34 ? 'TS' : 'TD') : `Cat ${cat}`;
    tooltip.hidden = false;
    tooltip.innerHTML = `
      <div class="tt-time">${escapeHtml(formatTime(r.t))}</div>
      <div class="tt-row"><span>Wind</span><strong>${r.wind ?? '?'} kt</strong></div>
      <div class="tt-row"><span>Pressure</span><strong>${r.pres ?? '—'} mb</strong></div>
      <div class="tt-row"><span>Status</span><strong>${escapeHtml(r.status || '?')} · ${catLabel}</strong></div>
    `;
    // Position tooltip — flip sides if we'd run off the right edge of the panel.
    const ttRect = tooltip.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offsetX = (cx / W) * containerRect.width;
    const wantLeft = offsetX + 12;
    if (wantLeft + ttRect.width > containerRect.width - 8) {
      tooltip.style.left = `${offsetX - ttRect.width - 12}px`;
    } else {
      tooltip.style.left = `${wantLeft}px`;
    }
    tooltip.style.top = `4px`;
  });
  svgEl.addEventListener('mouseleave', () => {
    cursor.style.display = 'none';
    tooltip.hidden = true;
  });
}

function buildSegments(track, accessor, xOf, yOf) {
  const out = [];
  let cur = [];
  for (const r of track) {
    const v = accessor(r);
    const y = v == null ? null : yOf(v);
    if (y == null) {
      if (cur.length) { out.push(cur); cur = []; }
      continue;
    }
    cur.push({ x: xOf(r.t), y });
  }
  if (cur.length) out.push(cur);
  return out;
}
