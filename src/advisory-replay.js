// Replay of the forecasts NHC actually issued, beside the track the storm
// actually took.
//
// Unlike cone-retro.js — which applies published error radii to the *observed*
// centerline as a teaching device — every position, intensity and issue time
// here is read verbatim from what NHC archived for that storm. Nothing is
// reconstructed.
//
// The cone comes one of two ways, and the tooltip says which. From 2015 the
// record carries forecast positions and the cone is drawn around them with the
// published radii of that advisory's era, which is how the operational cone was
// defined. Before 2015 there is no radii table, and the record instead carries
// the polygon NHC actually drew, read out of its GIS package.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { buildConeEnvelope, loadConeRadii } from './cone-retro.js';
import { getMapOverlayColor } from './map-colors.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

const ADVISORIES_URL = new URL('../data/advisories.json', import.meta.url);

let advisoriesPromise = null;
let layerGroup = null;
let layerMap = null;
let renderGeneration = 0;

export async function loadAdvisories() {
  if (!advisoriesPromise) {
    advisoriesPromise = fetchWithTimeout(ADVISORIES_URL, {}, REQUEST_TIMEOUT_MS.advisory).then(response => {
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

export function buildAdvisoryBounds(advisory, envelope = [], actual = []) {
  const points = [
    ...(advisory?.f || []).map(([, lat, lon]) => [lat, lon]),
    ...envelope,
    ...actual,
  ].filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
  if (!points.length) return null;
  const latitudes = points.map(([lat]) => lat);
  const longitudes = points.map(([, lon]) => lon);
  return [
    [Math.min(...latitudes), Math.min(...longitudes)],
    [Math.max(...latitudes), Math.max(...longitudes)],
  ];
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
  // A polygon of at least three points is a cone NHC published; anything less
  // is not a cone, so the radii path still runs rather than drawing a sliver.
  const published = Array.isArray(advisory.c) && advisory.c.length >= 3;
  try {
    let envelope = advisory.c || [];
    if (!published) {
      const radii = await loadConeRadii();
      if (generation !== renderGeneration) return { status: 'stale' };
      const era = radii.eras[String(coneEra)] || radii.eras['2025'];
      const basinRadii = storm.basin === 'EP' ? era.easternPacific : era.atlantic;
      const samples = buildAdvisoryConeSamples(advisory, basinRadii);
      envelope = samples.length >= 2 ? buildConeEnvelope(samples) : [];
    }

    ensureLayer(map);
    layerGroup.clearLayers();

    const actual = clipBestTrack(storm, advisory);
    if (actual.length >= 2) {
      window.L.polyline(actual, {
        color: getMapOverlayColor('actual'),
        weight: 3,
        opacity: 0.95,
        className: 'advisory-actual-line',
      }).bindTooltip(t('advisoryReplay.actualTooltip'), { sticky: true }).addTo(layerGroup);
    }

    if (envelope.length >= 3) {
      window.L.polygon(envelope, {
        color: getMapOverlayColor('forecast'),
        fillColor: getMapOverlayColor('forecast'),
        fillOpacity: 0.12,
        opacity: 0.85,
        weight: 2,
        dashArray: '6 4',
        className: 'advisory-cone-shape',
      }).bindTooltip(
        published
          ? t('advisoryReplay.conePublished', String(advisory.conePeriodHours || 120))
          : t('advisoryReplay.coneTooltip', String(coneEra)),
        { sticky: true },
      ).addTo(layerGroup);
    }

    const forecastLine = advisory.f.map(([, lat, lon]) => [lat, lon]);
    if (forecastLine.length >= 2) {
      window.L.polyline(forecastLine, {
        color: getMapOverlayColor('forecast'),
        weight: 2.5,
        opacity: 0.95,
        dashArray: '4 4',
        className: 'advisory-forecast-line',
      }).bindTooltip(t('advisoryReplay.forecastTooltip'), { sticky: true }).addTo(layerGroup);
    }

    const errorByLead = new Map((advisory.e || []).map(entry => [entry[0], entry]));
    // The first entry is where the storm was when the advisory went out, and
    // that is not always lead 0. An a-deck record opens on the synoptic
    // analysis; a GIS record opens on the position at issuance, three or six
    // hours later, because the forecast is initialised before it is published.
    for (const [index, [tau, lat, lon, wind]] of advisory.f.entries()) {
      const current = index === 0;
      const error = errorByLead.get(tau);
      const detail = error
        ? t('advisoryReplay.pointVerified', leadLabel(tau), String(wind), String(error[1]))
        : t('advisoryReplay.point', leadLabel(tau), String(wind));
      window.L.circleMarker([lat, lon], {
        radius: current ? 5 : 3.5,
        color: getMapOverlayColor('forecast'),
        fillColor: current ? getMapOverlayColor('forecast') : '#1e1e2e',
        fillOpacity: 1,
        weight: 2,
        className: 'advisory-forecast-point',
      }).bindTooltip(escapeHtml(detail), { direction: 'top' }).addTo(layerGroup);
    }

    const bounds = buildAdvisoryBounds(advisory, envelope, actual);

    return {
      status: 'rendered',
      index: clamped,
      advisory,
      conePoints: envelope.length,
      conePublished: published,
      summary: summarizeAdvisoryErrors(advisory),
      bounds,
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
