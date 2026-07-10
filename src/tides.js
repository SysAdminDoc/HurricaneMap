// "What the water did" — NOAA CO-OPS tide-gauge water levels around a
// storm's landfall. Observed hourly heights vs astronomical predictions from
// api.tidesandcurrents.noaa.gov (CORS *; hourly product limited to 1
// year/request — our ±2-day windows are far inside that). Station picking
// uses the static data/tide-stations.json snapshot (see
// scripts/build_tide_stations.py). Loaded on demand from the storm panel —
// never automatically — to stay polite to the API.
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';

const API = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MAX_STATIONS = 3;
const MAX_KM = 150;
const WINDOW_HOURS = 48;

let stationsPromise = null;

function loadStations() {
  if (!stationsPromise) {
    stationsPromise = fetch('data/tide-stations.json')
      .then(res => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return stationsPromise;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function nearestStations(stations, lat, lon, { max = MAX_STATIONS, maxKm = MAX_KM } = {}) {
  if (!Array.isArray(stations)) return [];
  return stations
    .map(station => ({ ...station, km: haversineKm(lat, lon, station.lat, station.lon) }))
    .filter(station => station.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, max);
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildDataUrl(stationId, product, landfallIso) {
  const center = new Date(landfallIso);
  const begin = new Date(center.getTime() - WINDOW_HOURS * 3600_000);
  const end = new Date(center.getTime() + WINDOW_HOURS * 3600_000);
  const params = new URLSearchParams({
    product,
    application: 'HurricaneMap',
    begin_date: yyyymmdd(begin),
    end_date: yyyymmdd(end),
    datum: 'MLLW',
    station: stationId,
    time_zone: 'gmt',
    units: 'english',
    format: 'json',
  });
  if (product === 'predictions') params.set('interval', 'h');
  return `${API}?${params.toString()}`;
}

function parseSeries(payload, key) {
  const rows = payload?.[key];
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => ({ time: Date.parse(`${row.t.replace(' ', 'T')}Z`), ft: Number(row.v) }))
    .filter(point => Number.isFinite(point.time) && Number.isFinite(point.ft));
}

/** Max observed-minus-predicted residual (ft), matching points by hour. */
export function peakResidual(observed, predicted) {
  const predictedByTime = new Map(predicted.map(point => [point.time, point.ft]));
  let peak = null;
  for (const point of observed) {
    const base = predictedByTime.get(point.time);
    if (base == null) continue;
    const residual = point.ft - base;
    if (!peak || residual > peak.residual) peak = { residual, time: point.time, observed: point.ft };
  }
  return peak;
}

async function fetchStationSeries(station, landfallIso) {
  const [obsRes, predRes] = await Promise.all([
    fetch(buildDataUrl(station.id, 'hourly_height', landfallIso)),
    fetch(buildDataUrl(station.id, 'predictions', landfallIso)),
  ]);
  if (!obsRes.ok || !predRes.ok) return null;
  const observed = parseSeries(await obsRes.json(), 'data');
  const predicted = parseSeries(await predRes.json(), 'predictions');
  if (observed.length < 12 || predicted.length < 12) return null;
  return { station, observed, predicted, peak: peakResidual(observed, predicted) };
}

function chartSvg({ observed, predicted }, landfallMs) {
  const W = 320;
  const H = 110;
  const PAD = 6;
  const all = [...observed, ...predicted];
  const t0 = Math.min(...all.map(p => p.time));
  const t1 = Math.max(...all.map(p => p.time));
  const v0 = Math.min(...all.map(p => p.ft));
  const v1 = Math.max(...all.map(p => p.ft));
  const x = time => PAD + ((time - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = ft => H - PAD - ((ft - v0) / Math.max(0.01, v1 - v0)) * (H - 2 * PAD);
  const path = series => series.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.ft).toFixed(1)}`).join('');
  const landfallX = landfallMs >= t0 && landfallMs <= t1 ? x(landfallMs).toFixed(1) : null;
  return `
    <svg class="tide-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('tides.chartLabel')}" preserveAspectRatio="none">
      ${landfallX ? `<line x1="${landfallX}" y1="0" x2="${landfallX}" y2="${H}" class="tide-landfall-line" />` : ''}
      <path d="${path(predicted)}" class="tide-predicted" />
      <path d="${path(observed)}" class="tide-observed" />
    </svg>`;
}

function stationCard(result, landfallMs) {
  const { station, peak } = result;
  const peakLine = peak
    ? `<div class="tide-peak">${t('tides.peakResidual')}: <strong>+${peak.residual.toFixed(1)} ft</strong> · ${new Date(peak.time).toISOString().slice(0, 16).replace('T', ' ')}Z</div>`
    : '';
  return `
    <div class="tide-station">
      <div class="tide-station-head">
        <strong>${escapeHtml(station.name)}${station.state ? `, ${escapeHtml(station.state)}` : ''}</strong>
        <span class="tide-km">${Math.round(station.km)} km</span>
      </div>
      ${chartSvg(result, landfallMs)}
      ${peakLine}
    </div>`;
}

export async function renderTidesBlock(host, storm) {
  if (!host) return;
  // Hourly verified water levels are reliable from the 1990s on; older
  // storms rarely have retrievable gauge records via the API.
  if (!storm?.year || storm.year < 1990) return;
  // Anchor on the strongest landfall (Katrina: the LA Cat-3, not the FL
  // Cat-1 four days earlier) — that's the water story people come for.
  const landfall = (storm.us_landfalls || [])
    .filter(lf => lf?.t && Number.isFinite(lf.lat) && Number.isFinite(lf.lon))
    .reduce((best, lf) => (!best || (lf.category ?? -1) > (best.category ?? -1) ? lf : best), null);
  if (!landfall) return;

  host.innerHTML = `
    <h3 class="panel-section-h3">${t('tides.title')}</h3>
    <div class="tides-block">
      <button class="text-btn tide-load-btn" type="button">${t('tides.load')}</button>
    </div>`;
  host.querySelector('.tide-load-btn').addEventListener('click', async event => {
    const block = host.querySelector('.tides-block');
    event.target.disabled = true;
    event.target.textContent = t('tides.loading');
    try {
      const stations = await loadStations();
      const nearby = nearestStations(stations, landfall.lat, landfall.lon);
      const results = (await Promise.all(nearby.map(station => fetchStationSeries(station, landfall.t).catch(() => null))))
        .filter(Boolean);
      if (!results.length) {
        block.innerHTML = `<div class="tide-empty">${t('tides.empty')}</div>`;
        return;
      }
      const landfallMs = Date.parse(landfall.t);
      block.innerHTML = `
        <div class="tide-legend">
          <span class="tide-key tide-key--observed">${t('tides.observed')}</span>
          <span class="tide-key tide-key--predicted">${t('tides.predicted')}</span>
          <span class="tide-key tide-key--landfall">${t('tides.landfall')}</span>
        </div>
        ${results.map(result => stationCard(result, landfallMs)).join('')}
        <div class="im-source"><a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener">${t('tides.source')}</a></div>`;
    } catch {
      block.innerHTML = `<div class="tide-empty">${t('tides.empty')}</div>`;
    }
  }, { once: true });
}
