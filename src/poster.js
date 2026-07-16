// High-resolution, shareable density poster for the currently filtered storm
// set. Rendering is deterministic and all source attribution is baked into the
// exported PNG rather than relying on surrounding page chrome.

import { ensureStormsLoaded, getAllStorms } from './data.js';
import { t } from './i18n.js';

export const POSTER_WIDTH = 1800;
export const POSTER_HEIGHT = 1200;
const PLOT = { left: 92, top: 185, right: 92, bottom: 112 };

function finitePoint(point) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
    ? { ...point, lat, lon }
    : null;
}

export function selectPosterStorms(storms, landfalls) {
  const ids = new Set((Array.isArray(landfalls) ? landfalls : []).map(item => item?.storm_id).filter(Boolean));
  return (Array.isArray(storms) ? storms : [])
    .filter(storm => ids.has(storm?.id) && Array.isArray(storm.track) && storm.track.filter(finitePoint).length > 1)
    .sort((a, b) => (Number(a.peak_wind_kt) || 0) - (Number(b.peak_wind_kt) || 0) || String(a.id).localeCompare(String(b.id)));
}

export function computePosterBounds(storms, aspect = (POSTER_WIDTH - PLOT.left - PLOT.right) / (POSTER_HEIGHT - PLOT.top - PLOT.bottom)) {
  const points = (Array.isArray(storms) ? storms : []).flatMap(storm => (storm.track || []).map(finitePoint).filter(Boolean));
  if (!points.length) return { minLat: 5, maxLat: 55, minLon: -145, maxLon: -35 };
  let minLat = Math.min(...points.map(point => point.lat));
  let maxLat = Math.max(...points.map(point => point.lat));
  let minLon = Math.min(...points.map(point => point.lon));
  let maxLon = Math.max(...points.map(point => point.lon));
  const latPad = Math.max(2, (maxLat - minLat) * 0.06);
  const lonPad = Math.max(3, (maxLon - minLon) * 0.04);
  minLat = Math.max(-90, minLat - latPad);
  maxLat = Math.min(90, maxLat + latPad);
  minLon = Math.max(-180, minLon - lonPad);
  maxLon = Math.min(180, maxLon + lonPad);

  const lonSpan = Math.max(1, maxLon - minLon);
  const latSpan = Math.max(1, maxLat - minLat);
  if (lonSpan / latSpan < aspect) {
    const target = latSpan * aspect;
    const half = (target - lonSpan) / 2;
    minLon = Math.max(-180, minLon - half);
    maxLon = Math.min(180, maxLon + half);
  } else {
    const target = lonSpan / aspect;
    const half = (target - latSpan) / 2;
    minLat = Math.max(-90, minLat - half);
    maxLat = Math.min(90, maxLat + half);
  }
  return { minLat, maxLat, minLon, maxLon };
}

export function projectPosterPoint(lat, lon, bounds, width = POSTER_WIDTH, height = POSTER_HEIGHT) {
  const plotWidth = width - PLOT.left - PLOT.right;
  const plotHeight = height - PLOT.top - PLOT.bottom;
  return {
    x: PLOT.left + ((lon - bounds.minLon) / Math.max(1, bounds.maxLon - bounds.minLon)) * plotWidth,
    y: PLOT.top + ((bounds.maxLat - lat) / Math.max(1, bounds.maxLat - bounds.minLat)) * plotHeight,
  };
}

export function posterColor(wind, light = false) {
  const value = Number(wind) || 0;
  if (value >= 137) return light ? '#fffdf8' : '#fffaf3';
  if (value >= 113) return light ? '#f7c7dc' : '#f5c2e7';
  if (value >= 96) return light ? '#f58fa4' : '#f38ba8';
  if (value >= 83) return light ? '#ef965f' : '#fab387';
  if (value >= 64) return light ? '#d2a933' : '#f9e2af';
  if (value >= 34) return light ? '#277da8' : '#89b4fa';
  return light ? '#667085' : '#6c7086';
}

function filterLabel(filters, stormCount) {
  const start = Number(filters?.yearMin) || 1851;
  const end = Number(filters?.yearMax) || 2025;
  const parts = [t('poster.years', start, end)];
  if (filters?.state) parts.push(String(filters.state));
  const categories = [...(filters?.categories || [])];
  if (categories.length && categories.length < 6) {
    parts.push(categories.map(value => value === 'ts' ? 'TS' : `Cat ${value}`).join(', '));
  }
  parts.push(t('poster.stormCount', stormCount));
  return parts.join('  ·  ');
}

function drawBackground(ctx, light) {
  const gradient = ctx.createLinearGradient(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  if (light) {
    gradient.addColorStop(0, '#294b70');
    gradient.addColorStop(0.55, '#173652');
    gradient.addColorStop(1, '#10273d');
  } else {
    gradient.addColorStop(0, '#11111b');
    gradient.addColorStop(0.55, '#181825');
    gradient.addColorStop(1, '#0c0d16');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
}

function drawGrid(ctx, bounds, light) {
  ctx.save();
  ctx.strokeStyle = light ? 'rgba(255,255,255,0.11)' : 'rgba(205,214,244,0.08)';
  ctx.fillStyle = light ? 'rgba(255,255,255,0.52)' : 'rgba(205,214,244,0.42)';
  ctx.lineWidth = 1;
  ctx.font = '18px Inter, system-ui, sans-serif';
  for (let lon = Math.ceil(bounds.minLon / 10) * 10; lon <= bounds.maxLon; lon += 10) {
    const { x } = projectPosterPoint(bounds.minLat, lon, bounds);
    ctx.beginPath(); ctx.moveTo(x, PLOT.top); ctx.lineTo(x, POSTER_HEIGHT - PLOT.bottom); ctx.stroke();
    ctx.fillText(`${Math.abs(lon)}°${lon <= 0 ? 'W' : 'E'}`, x + 6, POSTER_HEIGHT - PLOT.bottom - 8);
  }
  for (let lat = Math.ceil(bounds.minLat / 10) * 10; lat <= bounds.maxLat; lat += 10) {
    const { y } = projectPosterPoint(lat, bounds.minLon, bounds);
    ctx.beginPath(); ctx.moveTo(PLOT.left, y); ctx.lineTo(POSTER_WIDTH - PLOT.right, y); ctx.stroke();
    ctx.fillText(`${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, PLOT.left + 6, y - 7);
  }
  ctx.restore();
}

function drawTracks(ctx, storms, bounds, light) {
  let segmentCount = 0;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const storm of storms) {
    const track = (storm.track || []).map(finitePoint).filter(Boolean);
    for (let index = 1; index < track.length; index += 1) {
      const previous = track[index - 1];
      const point = track[index];
      if (Math.abs(point.lon - previous.lon) > 90) continue;
      const from = projectPosterPoint(previous.lat, previous.lon, bounds);
      const to = projectPosterPoint(point.lat, point.lon, bounds);
      const progress = index / Math.max(1, track.length - 1);
      const intensity = Math.min(1, Math.max(0, (Number(point.wind) || 0) / 140));
      ctx.strokeStyle = posterColor(point.wind, light);
      ctx.globalAlpha = 0.2 + intensity * 0.45;
      ctx.lineWidth = 0.7 + progress * 1.7 + intensity * 1.15;
      if ((Number(point.wind) || 0) >= 137) {
        ctx.shadowColor = light ? 'rgba(255,255,255,0.72)' : 'rgba(255,250,243,0.8)';
        ctx.shadowBlur = 5;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      segmentCount += 1;
    }
  }
  ctx.restore();
  return segmentCount;
}

function drawTypography(ctx, subtitle, light) {
  const primary = light ? '#fffdf8' : '#cdd6f4';
  const muted = light ? 'rgba(255,255,255,0.72)' : '#a6adc8';
  ctx.fillStyle = primary;
  ctx.font = '800 54px Inter, system-ui, sans-serif';
  ctx.fillText(t('poster.canvasTitle'), PLOT.left, 82);
  ctx.fillStyle = muted;
  ctx.font = '500 25px Inter, system-ui, sans-serif';
  ctx.fillText(subtitle, PLOT.left, 126);
  ctx.font = '500 19px Inter, system-ui, sans-serif';
  ctx.fillText(t('poster.canvasNote'), PLOT.left, 158);
  ctx.textAlign = 'right';
  ctx.font = '600 18px Inter, system-ui, sans-serif';
  ctx.fillText(t('poster.attribution'), POSTER_WIDTH - PLOT.right, POSTER_HEIGHT - 54);
  ctx.textAlign = 'left';
}

export function renderPosterCanvas(canvas, storms, { filters = {}, light = false } = {}) {
  if (!canvas?.getContext) return { stormCount: 0, segmentCount: 0, bounds: null };
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  const bounds = computePosterBounds(storms);
  drawBackground(context, light);
  drawGrid(context, bounds, light);
  const segmentCount = drawTracks(context, storms, bounds, light);
  const subtitle = filterLabel(filters, storms.length);
  drawTypography(context, subtitle, light);
  canvas.dataset.stormCount = String(storms.length);
  canvas.dataset.segmentCount = String(segmentCount);
  canvas.dataset.attribution = t('poster.attribution');
  canvas.setAttribute('aria-label', `${t('poster.canvasTitle')}. ${subtitle}`);
  return { stormCount: storms.length, segmentCount, bounds };
}

let latest = { storms: [], filters: {} };

function closePoster() {
  const view = document.getElementById('poster-view');
  if (view) view.hidden = true;
  document.body.classList.remove('poster-open');
}

export async function downloadPosterPng() {
  const canvas = document.getElementById('poster-canvas');
  if (!canvas) return false;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `HurricaneMap-tracks-${latest.filters.yearMin || 1851}-${latest.filters.yearMax || 2025}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

let wired = false;
function ensureWired() {
  if (wired) return;
  wired = true;
  document.getElementById('close-poster')?.addEventListener('click', closePoster);
  document.getElementById('poster-export')?.addEventListener('click', downloadPosterPng);
  document.getElementById('poster-view')?.addEventListener('click', event => {
    if (event.target.matches('#poster-view')) closePoster();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('poster-view')?.hidden) closePoster();
  });
}

export async function openPoster({ landfalls = [], filters = {} } = {}) {
  const view = document.getElementById('poster-view');
  const status = document.getElementById('poster-status');
  const canvas = document.getElementById('poster-canvas');
  if (!view || !status || !canvas) return null;
  ensureWired();
  view.hidden = false;
  document.body.classList.add('poster-open');
  status.textContent = t('poster.rendering');
  await ensureStormsLoaded();
  const storms = selectPosterStorms(getAllStorms(), landfalls);
  latest = { storms, filters: { ...filters, categories: new Set(filters.categories || []) } };
  if (document.fonts?.ready) await document.fonts.ready;
  const result = renderPosterCanvas(canvas, storms, {
    filters: latest.filters,
    light: document.documentElement.dataset.theme === 'light',
  });
  status.textContent = storms.length ? t('poster.ready', storms.length) : t('poster.empty');
  document.getElementById('poster-export').disabled = !storms.length;
  document.getElementById('close-poster')?.focus({ preventScroll: true });
  return result;
}
