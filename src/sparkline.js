// Tiny inline sparkline for storm wind-over-time. Designed to live inside
// search results and other dense UI surfaces. Self-contained SVG, no deps.
import { getPaletteColor } from './settings.js';
import { escapeHtml } from './html-utils.js';

const W = 64;
const H = 18;
const PAD_X = 1;
const PAD_Y = 2;

function tierFromKt(kt) {
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  if (kt >= 34) return 0; // TS
  return -1;
}

export function buildSparkline(track, opts = {}) {
  if (!track || !track.length) return '';
  const max = Math.max(...track.map(p => p.wind || 0), 60);
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;
  const last = track.length - 1;
  // Build polyline points + segmented stroke under the curve so each Saffir
  // tier carries the right color. Gradient would be cleaner but adds code.
  const pts = track.map((p, i) => {
    const x = PAD_X + (last === 0 ? innerW / 2 : (i / last) * innerW);
    const y = PAD_Y + innerH - ((p.wind || 0) / max) * innerH;
    return [x, y, p.wind || 0];
  });
  // Filled path under the curve, color = peak tier of the storm.
  const peakTier = Math.max(...track.map(p => tierFromKt(p.wind || 0)));
  const fill = peakTier >= 0 ? getPaletteColor(Math.max(0, peakTier)) : '#7f849c';
  const path = pts.map(([x, y], i) => (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`)).join('');
  const area = `${path}L${(PAD_X + innerW).toFixed(1)},${(PAD_Y + innerH).toFixed(1)}L${PAD_X.toFixed(1)},${(PAD_Y + innerH).toFixed(1)}Z`;
  const baselineY = (PAD_Y + innerH).toFixed(1);
  const title = opts.title ? escapeHtml(opts.title) : '';
  return `<svg class="storm-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="${area}" fill="${fill}" fill-opacity="0.32"/>
    <path d="${path}" fill="none" stroke="${fill}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${PAD_X}" y1="${baselineY}" x2="${(PAD_X + innerW).toFixed(1)}" y2="${baselineY}" stroke="currentColor" stroke-opacity="0.18" stroke-width="0.5"/>
    ${title ? `<title>${title}</title>` : ''}
  </svg>`;
}
