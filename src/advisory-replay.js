// Replay of the forecasts NHC actually issued, beside the track the storm
// actually took.
//
// Unlike cone-retro.js — which applies published error radii to the *observed*
// centerline as a teaching device — every position, intensity and issue time
// here is read verbatim from the archived ATCF a-deck for that storm. Nothing is
// reconstructed. The cone is the only derived element: it is drawn around the
// issued forecast positions using the published radii of the era the advisory
// belongs to, which is how the operational cone was defined.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { buildConeEnvelope, loadConeRadii } from './cone-retro.js';

const ADVISORIES_URL = new URL('../data/advisories.json', import.meta.url);

let advisoriesPromise = null;
let layerGroup = null;
let layerMap = null;
let renderGeneration = 0;

export async function loadAdvisories() {
  if (!advisoriesPromise) {
    advisoriesPromise = fetch(ADVISORIES_URL).then(response => {
      if (!response.ok) throw new Error(`Advisory archive returned ${response.status}`);
      return response.json();
    }).catch(error => {
      advisoriesPromise = null;
      throw error;
    });
  }
  return advisoriesPromise;
}

export function getStormAdvisories(archive, stormId) {
  return archive?.storms?.[stormId] || null;
}

// The replay position is the record's ordinal, not the NHC advisory number.
// NHC can issue special/intermediate advisories that have no matching OFCL
// record, so advisory.n may be higher than the number of replayable records.
export function getAdvisoryReplayPosition(index, advisoryCount) {
  const count = Math.max(0, Math.trunc(Number(advisoryCount) || 0));
  const maxIndex = Math.max(0, count - 1);
  const safeIndex = Math.max(0, Math.min(Math.trunc(Number(index) || 0), maxIndex));
  return {
    index: safeIndex,
    number: count ? safeIndex + 1 : 0,
    count,
  };
}

// The published radii table stops at 120 h. Later leads (NHC's 6- and 7-day
// experimental forecasts) still plot as forecast positions, but they cannot
// contribute to a cone without inventing a radius for them.
export function buildAdvisoryConeSamples(advisory, radii) {
  const table = new Map(Object.entries(radii || {}).map(([hours, radius]) => [Number(hours), Number(radius)]));
  const samples = [];
  for (const [tau, lat, lon] of advisory?.f || []) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (tau === 0) {
      samples.push({ lat, lon, hours: 0, radius: 0 });
      continue;
    }
    const radius = table.get(tau);
    if (Number.isFinite(radius) && radius > 0) samples.push({ lat, lon, hours: tau, radius });
  }
  return samples.sort((a, b) => a.hours - b.hours);
}

export function summarizeAdvisoryErrors(advisory) {
  const errors = advisory?.e || [];
  const track = errors.filter(entry => Number.isFinite(entry[1]));
  const intensity = errors.filter(entry => Number.isFinite(entry[2]));
  const longest = track.length ? track.reduce((best, entry) => (entry[0] > best[0] ? entry : best)) : null;
  return {
    verifiedLeads: track.length,
    longestLeadHours: longest ? longest[0] : null,
    longestLeadTrackErrorNmi: longest ? longest[1] : null,
    meanTrackErrorNmi: track.length
      ? Math.round((track.reduce((sum, entry) => sum + entry[1], 0) / track.length) * 10) / 10
      : null,
    meanIntensityErrorKt: intensity.length
      ? Math.round((intensity.reduce((sum, entry) => sum + entry[2], 0) / intensity.length) * 10) / 10
      : null,
  };
}

// The best track is clipped to the forecast's own verification window so the
// comparison line answers "where did it actually go from here", rather than
// redrawing the whole storm.
export function clipBestTrack(storm, advisory) {
  const issueMs = Date.parse(advisory?.t || '');
  const leads = (advisory?.f || []).map(entry => entry[0]);
  if (!Number.isFinite(issueMs) || !leads.length) return [];
  const endMs = issueMs + Math.max(...leads) * 3_600_000;
  return (storm?.track || [])
    .filter(point => {
      const ms = Date.parse(point.t);
      return Number.isFinite(ms) && ms >= issueMs && ms <= endMs;
    })
    .map(point => [point.lat, point.lon]);
}

function ensureLayer(map) {
  if (layerGroup && layerMap === map) return;
  if (layerGroup && layerMap) layerMap.removeLayer(layerGroup);
  layerMap = map;
  layerGroup = window.L.layerGroup().addTo(map);
}

function leadLabel(hours) {
  return hours === 0 ? t('advisoryReplay.initial') : `${hours} h`;
}

export async function renderAdvisory(storm, { map, record, coneEra = '2025', index = 0 } = {}) {
  if (!storm || !map || !record?.advisories?.length) return { status: 'idle' };
  const generation = ++renderGeneration;
  const clamped = Math.max(0, Math.min(index, record.advisories.length - 1));
  const advisory = record.advisories[clamped];
  try {
    const radii = await loadConeRadii();
    if (generation !== renderGeneration) return { status: 'stale' };
    const era = radii.eras[String(coneEra)] || radii.eras['2025'];
    const basinRadii = storm.basin === 'EP' ? era.easternPacific : era.atlantic;
    const samples = buildAdvisoryConeSamples(advisory, basinRadii);
    const envelope = samples.length >= 2 ? buildConeEnvelope(samples) : [];

    ensureLayer(map);
    layerGroup.clearLayers();

    const actual = clipBestTrack(storm, advisory);
    if (actual.length >= 2) {
      window.L.polyline(actual, {
        color: '#a6e3a1',
        weight: 3,
        opacity: 0.95,
        className: 'advisory-actual-line',
      }).bindTooltip(t('advisoryReplay.actualTooltip'), { sticky: true }).addTo(layerGroup);
    }

    if (envelope.length >= 3) {
      window.L.polygon(envelope, {
        color: '#f9e2af',
        fillColor: '#f9e2af',
        fillOpacity: 0.12,
        opacity: 0.85,
        weight: 2,
        dashArray: '6 4',
        className: 'advisory-cone-shape',
      }).bindTooltip(t('advisoryReplay.coneTooltip', String(coneEra)), { sticky: true }).addTo(layerGroup);
    }

    const forecastLine = advisory.f.map(([, lat, lon]) => [lat, lon]);
    if (forecastLine.length >= 2) {
      window.L.polyline(forecastLine, {
        color: '#f9e2af',
        weight: 2.5,
        opacity: 0.95,
        dashArray: '4 4',
        className: 'advisory-forecast-line',
      }).bindTooltip(t('advisoryReplay.forecastTooltip'), { sticky: true }).addTo(layerGroup);
    }

    const errorByLead = new Map((advisory.e || []).map(entry => [entry[0], entry]));
    for (const [tau, lat, lon, wind] of advisory.f) {
      const error = errorByLead.get(tau);
      const detail = error
        ? t('advisoryReplay.pointVerified', leadLabel(tau), String(wind), String(error[1]))
        : t('advisoryReplay.point', leadLabel(tau), String(wind));
      window.L.circleMarker([lat, lon], {
        radius: tau === 0 ? 5 : 3.5,
        color: '#f9e2af',
        fillColor: tau === 0 ? '#f9e2af' : '#1e1e2e',
        fillOpacity: 1,
        weight: 2,
        className: 'advisory-forecast-point',
      }).bindTooltip(escapeHtml(detail), { direction: 'top' }).addTo(layerGroup);
    }

    return {
      status: 'rendered',
      index: clamped,
      advisory,
      conePoints: envelope.length,
      summary: summarizeAdvisoryErrors(advisory),
    };
  } catch (error) {
    if (generation !== renderGeneration) return { status: 'stale' };
    clearAdvisoryReplay();
    return { status: 'error', error };
  }
}

export function clearAdvisoryReplay() {
  renderGeneration += 1;
  if (layerGroup) layerGroup.clearLayers();
}
