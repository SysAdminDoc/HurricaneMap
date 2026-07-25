// NHC Graphical Tropical Weather Outlook disturbance points.
// The fixed KMZ endpoints are fetched through the same-origin Cloudflare
// allowlist. The 2026 `zerox` style is rendered as a gray X, distinct from
// the yellow low-risk X used for non-zero formation chances.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';

const BASINS = ['atl', 'pac', 'cpac'];
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

let layerGroup = null;
let layerMap = null;
let legendEl = null;
let renderGeneration = 0;

export function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXml(match?.[1] || '');
}

export function parseOutlookKml(kml, basin = '') {
  const points = [];
  const placemarks = String(kml || '').match(/<Placemark(?:\s[^>]*)?>[\s\S]*?<\/Placemark>/gi) || [];
  for (const placemark of placemarks) {
    const pointBlock = placemark.match(/<Point(?:\s[^>]*)?>[\s\S]*?<\/Point>/i)?.[0];
    if (!pointBlock) continue;
    const coordinateText = tagValue(pointBlock, 'coordinates');
    const [lon, lat] = coordinateText.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const fields = {};
    for (const match of placemark.matchAll(/<Data\s+name=["']([^"']+)["'][^>]*>[\s\S]*?<value(?:\s[^>]*)?>([\s\S]*?)<\/value>[\s\S]*?<\/Data>/gi)) {
      fields[match[1]] = decodeXml(match[2]);
    }
    const style = tagValue(placemark, 'styleUrl').replace(/^#/, '').toLowerCase();
    const category = String(fields['7day_category'] || fields['2day_category'] || '').toLowerCase();
    const risk = style === 'zerox' || category === 'nearzero'
      ? 'near-zero'
      : style === 'highx' || category === 'high'
        ? 'high'
        : style === 'medx' || category === 'medium'
          ? 'medium'
          : 'low';
    points.push({
      basin,
      disturbance: fields.Disturbance || '',
      lat,
      lon,
      risk,
      twoDay: fields['2day_percentage'] || '',
      sevenDay: fields['7day_percentage'] || '',
      discussion: fields.Discussion || '',
    });
  }
  return points;
}

export async function extractKmlFromKmz(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('KMZ end-of-directory record not found');
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid KMZ central directory');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const filename = decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));
    offset += 46 + filenameLength + extraLength + commentLength;
    if (!filename.toLowerCase().endsWith('.kml')) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Invalid KMZ local header');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    if (method === 0) return decoder.decode(compressed);
    if (method !== 8 || typeof DecompressionStream !== 'function') {
      throw new Error('KMZ compression is unsupported in this browser');
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return decoder.decode(await new Response(stream).arrayBuffer());
  }
  throw new Error('KMZ contains no KML document');
}

async function fetchBasin(basin, force) {
  const cached = cache.get(basin);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.points;
  const response = await fetch(`/nhc/outlook/${basin}.kmz`, { cache: 'no-cache' });
  if (!response.ok) {
    const error = new Error(`NHC ${basin} outlook returned ${response.status}`);
    error.responseStatus = response.status;
    throw error;
  }
  const kml = await extractKmlFromKmz(await response.arrayBuffer());
  const points = parseOutlookKml(kml, basin);
  cache.set(basin, { fetchedAt: Date.now(), points });
  return points;
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function updateLegend(points) {
  if (!points.length) {
    if (legendEl) legendEl.hidden = true;
    return;
  }
  if (!legendEl) {
    legendEl = document.createElement('div');
    legendEl.id = 'nhc-outlook-legend';
    legendEl.className = 'nhc-outlook-legend glass';
    legendEl.setAttribute('role', 'group');
    document.body.appendChild(legendEl);
  }
  legendEl.setAttribute('aria-label', t('outlook.legendTitle'));
  legendEl.innerHTML = `<strong>${t('outlook.legendTitle')}</strong><span><b class="nhc-outlook-x nhc-outlook-x--near-zero">×</b>${t('outlook.nearZero')}</span><span><b class="nhc-outlook-x nhc-outlook-x--low">×</b>${t('outlook.nonZero')}</span>`;
  legendEl.hidden = false;
}

export async function renderTropicalOutlook({ map, enabled = true, force = false } = {}) {
  if (!map || !enabled) {
    clearTropicalOutlook();
    return { status: 'idle', pointCount: 0 };
  }
  const generation = ++renderGeneration;
  ensureLayer(map);
  const cacheOrigin = BASINS.every(basin => {
    const cached = cache.get(basin);
    return !force && cached && Date.now() - cached.fetchedAt < CACHE_MS;
  }) ? 'memory' : 'network';
  const results = await Promise.allSettled(BASINS.map(basin => fetchBasin(basin, force)));
  if (generation !== renderGeneration) return { status: 'stale', pointCount: 0 };
  const points = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const failures = results.filter(result => result.status === 'rejected');
  if (!points.length && failures.length === results.length) {
    const error = failures[0]?.reason;
    return {
      status: 'error',
      pointCount: 0,
      error,
      responseStatus: error?.responseStatus || 0,
    };
  }
  layerGroup.clearLayers();
  for (const point of points) {
    const marker = window.L.marker([point.lat, point.lon], {
      icon: window.L.divIcon({
        className: 'nhc-outlook-marker',
        html: `<span class="nhc-outlook-x nhc-outlook-x--${point.risk}" aria-hidden="true">×</span>`,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
      keyboard: true,
      title: `${t('outlook.disturbance')} ${point.disturbance}`.trim(),
    });
    const chance = `${t('outlook.twoDay')}: ${point.twoDay || '—'} · ${t('outlook.sevenDay')}: ${point.sevenDay || '—'}`;
    marker.bindTooltip(`<strong>${escapeHtml(`${t('outlook.disturbance')} ${point.disturbance}`.trim())}</strong><br>${escapeHtml(chance)}${point.discussion ? `<br>${escapeHtml(point.discussion)}` : ''}`, { direction: 'top', sticky: true });
    layerGroup.addLayer(marker);
  }
  updateLegend(points);
  return {
    status: points.length ? 'rendered' : 'empty',
    pointCount: points.length,
    cacheOrigin,
  };
}

export function clearTropicalOutlook() {
  renderGeneration += 1;
  if (layerGroup) layerGroup.clearLayers();
  if (legendEl) legendEl.hidden = true;
}
