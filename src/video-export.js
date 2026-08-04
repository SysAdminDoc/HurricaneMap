// Self-contained WebM track export.
//
// The live Leaflet map cannot be captured reliably because its basemap and
// raster overlays are cross-origin. Export a clean, deterministic track card
// instead: the storm path, current eye, category legend, dates, and NOAA
// attribution are all drawn into one same-origin canvas before recording.

import { categoryColor, categoryLabel, formatTime, windToCategory } from './data.js';
import { formatStormName } from './html-utils.js';

export const VIDEO_FPS_OPTIONS = Object.freeze([24, 30, 60]);
export const VIDEO_DURATION_OPTIONS = Object.freeze([5, 10, 15, 30]);
export const VIDEO_DIMENSIONS = Object.freeze({ width: 1280, height: 720 });

const VIDEO_MIME_TYPES = Object.freeze([
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]);
const LEGEND_CATEGORIES = Object.freeze([0, -1, 1, 2, 3, 4, 5]);
const EXPORT_PADDING = Object.freeze({ left: 72, right: 42, top: 122, bottom: 94 });

export function getSupportedVideoMimeType(mediaRecorderClass = globalThis.MediaRecorder) {
  if (typeof mediaRecorderClass !== 'function' || typeof mediaRecorderClass.isTypeSupported !== 'function') return '';
  return VIDEO_MIME_TYPES.find(type => mediaRecorderClass.isTypeSupported(type)) || '';
}

export function getVideoExportSupport({
  mediaRecorderClass = globalThis.MediaRecorder,
  canvasPrototype = globalThis.HTMLCanvasElement?.prototype,
} = {}) {
  if (typeof canvasPrototype?.captureStream !== 'function') {
    return { available: false, reason: 'capture-stream' };
  }
  const mimeType = getSupportedVideoMimeType(mediaRecorderClass);
  if (!mimeType) return { available: false, reason: 'webm-media-recorder' };
  return { available: true, reason: 'available', mimeType };
}

export function normalizeVideoOptions(options = {}) {
  const fpsInput = Number(options.fps);
  const durationInput = Number(options.durationSeconds);
  const fps = VIDEO_FPS_OPTIONS.includes(fpsInput)
    ? fpsInput
    : nearestOption(fpsInput, VIDEO_FPS_OPTIONS, 30);
  const durationSeconds = VIDEO_DURATION_OPTIONS.includes(durationInput)
    ? durationInput
    : nearestOption(durationInput, VIDEO_DURATION_OPTIONS, 10);
  return {
    fps,
    durationSeconds,
    width: VIDEO_DIMENSIONS.width,
    height: VIDEO_DIMENSIONS.height,
  };
}

export function formatVideoFilename(storm) {
  const name = formatStormName(storm?.name).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'storm';
  const year = Number.isInteger(Number(storm?.year)) ? `-${storm.year}` : '';
  return `HurricaneMap-${name}${year}-track.webm`;
}

export function sampleTrack(track, progress) {
  const points = validTrack(track);
  if (!points.length) return null;
  if (points.length === 1) return { ...points[0] };
  const t = clamp(Number(progress), 0, 1);
  const position = t * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  const fraction = position - index;
  const a = points[index];
  const b = points[index + 1];
  return {
    lat: lerp(a.lat, b.lat, fraction),
    lon: lerp(a.lon, b.lon, fraction),
    wind: lerpOptional(a.wind, b.wind, fraction),
    t: interpolateTime(a.t, b.t, fraction),
    status: fraction < 0.5 ? a.status : b.status,
  };
}

export function drawVideoFrame(context, storm, progress, {
  width = VIDEO_DIMENSIONS.width,
  height = VIDEO_DIMENSIONS.height,
} = {}) {
  if (!context) throw new TypeError('A 2D canvas context is required');
  const track = validTrack(storm?.track);
  if (!track.length) throw new TypeError('A storm with at least one valid track point is required');
  const bounds = trackBounds(track);
  const project = point => projectPoint(point, bounds, width, height);
  const current = sampleTrack(track, progress);
  const currentCategory = windToCategory(current.wind);
  const currentColor = categoryColor(currentCategory);
  const completedProgress = clamp(Number(progress), 0, 1);

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#11111b';
  context.fillRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, 'rgba(49, 50, 68, 0.72)');
  background.addColorStop(1, 'rgba(17, 17, 27, 0.98)');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  drawHeader(context, storm, track, current, currentCategory, width);
  drawGrid(context, bounds, project, width, height);
  drawTrack(context, track, project, completedProgress, currentColor);
  drawCurrentPoint(context, project(current), currentColor, currentCategory, current.wind);
  drawLegend(context, width, height);
  drawAttribution(context, width, height);
  return current;
}

export async function exportTrackVideo(storm, options = {}, {
  documentRef = globalThis.document,
  mediaRecorderClass = globalThis.MediaRecorder,
  onProgress = null,
} = {}) {
  const support = getVideoExportSupport({
    mediaRecorderClass,
    canvasPrototype: globalThis.HTMLCanvasElement?.prototype,
  });
  if (!support.available) throw new Error(`Video export unavailable: ${support.reason}`);
  if (!documentRef?.createElement) throw new Error('Video export requires a browser document');

  const settings = normalizeVideoOptions(options);
  const canvas = documentRef.createElement('canvas');
  canvas.width = settings.width;
  canvas.height = settings.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || typeof canvas.captureStream !== 'function') throw new Error('Canvas video capture is unavailable');

  const stream = canvas.captureStream(settings.fps);
  let recorder;
  try {
    recorder = new mediaRecorderClass(stream, {
      mimeType: support.mimeType,
      videoBitsPerSecond: 4_000_000,
    });
  } catch {
    recorder = new mediaRecorderClass(stream, { mimeType: support.mimeType });
  }

  const chunks = [];
  const recording = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = event => reject(event.error || new Error('MediaRecorder failed'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: support.mimeType }));
  });
  const frameCount = Math.max(2, Math.round(settings.durationSeconds * settings.fps));
  const intervalMs = 1000 / settings.fps;
  let timer = null;

  try {
    recorder.start(250);
    await new Promise((resolve, reject) => {
      let frame = 0;
      const render = () => {
        try {
          const progress = frame / (frameCount - 1);
          drawVideoFrame(context, storm, progress, settings);
          if (typeof onProgress === 'function') onProgress(Math.round(progress * 100));
          frame += 1;
          if (frame >= frameCount) {
            timer = setTimeout(() => {
              if (recorder.state === 'recording') recorder.stop();
              resolve();
            }, intervalMs);
            return;
          }
          timer = setTimeout(render, intervalMs);
        } catch (error) {
          reject(error);
        }
      };
      render();
    });
    const blob = await recording;
    return { blob, filename: formatVideoFilename(storm), mimeType: support.mimeType, settings };
  } finally {
    if (timer) clearTimeout(timer);
    if (recorder.state === 'recording') recorder.stop();
    stream.getTracks().forEach(track => track.stop());
  }
}

export function downloadVideo({ blob, filename }) {
  if (!(blob instanceof Blob) || !blob.size) throw new TypeError('A non-empty video blob is required');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 250);
}

function validTrack(track) {
  if (!Array.isArray(track)) return [];
  return track.filter(point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon)))
    .map(point => ({
      lat: Number(point.lat),
      lon: Number(point.lon),
      wind: Number.isFinite(Number(point.wind)) ? Number(point.wind) : null,
      t: point.t || '',
      status: point.status || '',
    }));
}

function trackBounds(track) {
  const lats = track.map(point => point.lat);
  const lons = track.map(point => point.lon);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLon = Math.min(...lons);
  let maxLon = Math.max(...lons);
  const latPad = Math.max((maxLat - minLat) * 0.12, 2);
  const lonPad = Math.max((maxLon - minLon) * 0.12, 2);
  minLat -= latPad;
  maxLat += latPad;
  minLon -= lonPad;
  maxLon += lonPad;
  return {
    minLat, maxLat, minLon, maxLon,
    latSpan: Math.max(1, maxLat - minLat),
    lonSpan: Math.max(1, maxLon - minLon),
  };
}

function projectPoint(point, bounds, width, height) {
  const plotWidth = width - EXPORT_PADDING.left - EXPORT_PADDING.right;
  const plotHeight = height - EXPORT_PADDING.top - EXPORT_PADDING.bottom;
  return {
    x: EXPORT_PADDING.left + ((point.lon - bounds.minLon) / bounds.lonSpan) * plotWidth,
    y: EXPORT_PADDING.top + ((bounds.maxLat - point.lat) / bounds.latSpan) * plotHeight,
  };
}

function drawHeader(context, storm, track, current, currentCategory, width) {
  const name = formatStormName(storm?.name);
  const year = Number.isInteger(Number(storm?.year)) ? ` (${storm.year})` : '';
  context.fillStyle = '#cdd6f4';
  context.font = '700 30px Inter, Segoe UI, sans-serif';
  context.fillText(`${name}${year}`, EXPORT_PADDING.left, 44);
  context.fillStyle = '#a6adc8';
  context.font = '500 16px Inter, Segoe UI, sans-serif';
  context.fillText(`Track playback · ${formatDate(track[0].t)} – ${formatDate(track.at(-1).t)}`, EXPORT_PADDING.left, 72);
  context.textAlign = 'right';
  context.fillStyle = categoryColor(currentCategory);
  context.font = '700 18px Inter, Segoe UI, sans-serif';
  context.fillText(`${categoryLabel(currentCategory)} · ${current.wind == null ? '—' : `${Math.round(current.wind)} kt`}`, width - EXPORT_PADDING.right, 44);
  context.fillStyle = '#a6adc8';
  context.font = '500 14px Inter, Segoe UI, sans-serif';
  context.fillText(formatTime(current.t), width - EXPORT_PADDING.right, 70);
  context.textAlign = 'left';
}

function drawGrid(context, bounds, project, width, height) {
  context.save();
  context.strokeStyle = 'rgba(166, 173, 200, 0.16)';
  context.fillStyle = 'rgba(166, 173, 200, 0.56)';
  context.lineWidth = 1;
  context.font = '500 12px Inter, Segoe UI, sans-serif';
  const latStep = chooseGridStep(bounds.latSpan);
  const lonStep = chooseGridStep(bounds.lonSpan);
  for (let lat = Math.ceil(bounds.minLat / latStep) * latStep; lat <= bounds.maxLat; lat += latStep) {
    const start = project({ lat, lon: bounds.minLon });
    const end = project({ lat, lon: bounds.maxLon });
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.fillText(`${Math.round(lat)}°`, EXPORT_PADDING.left - 8, start.y - 4);
  }
  for (let lon = Math.ceil(bounds.minLon / lonStep) * lonStep; lon <= bounds.maxLon; lon += lonStep) {
    const start = project({ lat: bounds.minLat, lon });
    const end = project({ lat: bounds.maxLat, lon });
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.fillText(`${Math.round(lon)}°`, start.x - 12, height - EXPORT_PADDING.bottom + 24);
  }
  context.restore();
}

function drawTrack(context, track, project, progress, currentColor) {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.setLineDash([7, 8]);
  context.strokeStyle = 'rgba(205, 214, 244, 0.34)';
  context.lineWidth = 3;
  drawPath(context, track.map(project));
  context.stroke();
  context.setLineDash([]);

  const completed = track.slice(0, Math.max(1, Math.ceil(progress * track.length)));
  const current = sampleTrack(track, progress);
  if (completed.length > 1) {
    context.strokeStyle = currentColor;
    context.globalAlpha = 0.95;
    context.lineWidth = 6;
    drawPath(context, [...completed, current].map(project));
    context.stroke();
  }
  context.restore();
}

function drawCurrentPoint(context, point, color, category, wind) {
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 22;
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, 13 + Math.max(0, category) * 2, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = '#11111b';
  context.beginPath();
  context.arc(point.x, point.y, 5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#cdd6f4';
  context.font = '700 13px Inter, Segoe UI, sans-serif';
  context.fillText(wind == null ? '—' : `${Math.round(wind)} kt`, point.x + 18, point.y - 16);
  context.restore();
}

function drawLegend(context, width, height) {
  let x = EXPORT_PADDING.left;
  const y = height - 50;
  context.font = '600 13px Inter, Segoe UI, sans-serif';
  for (const category of LEGEND_CATEGORIES) {
    const label = categoryLabel(category);
    const labelWidth = context.measureText(label).width;
    if (x + labelWidth + 42 > width - EXPORT_PADDING.right) break;
    context.fillStyle = categoryColor(category);
    context.fillRect(x, y - 11, 14, 14);
    context.fillStyle = '#cdd6f4';
    context.fillText(label, x + 21, y + 1);
    x += labelWidth + 54;
  }
}

function drawAttribution(context, width, height) {
  context.fillStyle = '#6c7086';
  context.font = '500 12px Inter, Segoe UI, sans-serif';
  context.textAlign = 'right';
  context.fillText('NOAA/NHC HURDAT2 best-track data · HurricaneMap', width - EXPORT_PADDING.right, height - 18);
  context.textAlign = 'left';
}

function drawPath(context, points) {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'date unavailable';
}

function chooseGridStep(span) {
  if (span > 60) return 20;
  if (span > 30) return 10;
  if (span > 12) return 5;
  return 2;
}

function nearestOption(value, options, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return options.reduce((nearest, option) => Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest, options[0]);
}

function interpolateTime(a, b, fraction) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return a || b || '';
  return new Date(ta + (tb - ta) * fraction).toISOString();
}

function lerp(a, b, fraction) {
  return a + (b - a) * fraction;
}

function lerpOptional(a, b, fraction) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return lerp(a, b, fraction);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
