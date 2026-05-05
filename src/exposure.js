// Population exposure screening estimate.
//
// HurricaneMap does not ship a bulky gridded population raster. This module
// combines HURDAT2 wind-radii geometry near U.S. landfall times with the
// state-density attributes already bundled in data/us-states.geojson. Treat
// the result as a first-pass planning metric, not a census-block exposure
// model.

const NM2_TO_SQMI = 1.324293337;
const DEFAULT_LANDFALL_WINDOW_HOURS = 18;

const THRESHOLDS = [
  { key: 'cat1', label: 'Cat-1+', kt: 64 },
  { key: 'cat2', label: 'Cat-2+', kt: 83 },
  { key: 'cat3', label: 'Cat-3+', kt: 96 },
  { key: 'cat5', label: 'Cat-5', kt: 137 },
];

const REGION_LAND_FACTORS = {
  'Puerto Rico': 0.58,
  'Hawaii': 0.46,
  'Florida': 0.40,
  'Louisiana': 0.32,
  'Mississippi': 0.32,
  'Alabama': 0.32,
  'Texas': 0.30,
  'Georgia': 0.34,
  'South Carolina': 0.34,
  'North Carolina': 0.34,
  'Virginia': 0.30,
  'Maryland': 0.28,
  'Delaware': 0.28,
  'New Jersey': 0.26,
  'New York': 0.25,
  'Connecticut': 0.24,
  'Rhode Island': 0.24,
  'Massachusetts': 0.25,
  'Maine': 0.24,
};

let cachedStateDensities = null;

export function buildStateDensityIndex(usStatesGeojson) {
  const features = usStatesGeojson?.features;
  if (!Array.isArray(features)) return {};
  return Object.fromEntries(features
    .map((feature) => {
      const name = feature?.properties?.name || feature?.properties?.NAME;
      const density = Number(feature?.properties?.density);
      if (!name || !Number.isFinite(density) || density <= 0) return null;
      return [name, density];
    })
    .filter(Boolean));
}

export async function ensureExposureDensitiesLoaded(url = './data/us-states.geojson') {
  if (cachedStateDensities) return cachedStateDensities;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Population density index unavailable (${res.status})`);
  cachedStateDensities = buildStateDensityIndex(await res.json());
  return cachedStateDensities;
}

export function estimatePopulationExposure(storm, options = {}) {
  const track = Array.isArray(storm?.track) ? storm.track : [];
  const landfalls = uniqueLandfalls(storm?.us_landfalls);
  const records = track.filter(record => Array.isArray(record.radii) && record.radii.length >= 12);
  const stateDensities = options.stateDensities || cachedStateDensities || {};
  const windowHours = options.windowHours || DEFAULT_LANDFALL_WINDOW_HOURS;

  if (!records.length) {
    return unavailable('Population exposure requires HURDAT2 wind-radii records, available for most storms from 2004 onward.');
  }
  if (!landfalls.length) {
    return unavailable('Population exposure requires a U.S. landfall state.');
  }

  const byState = new Map();
  const analyzed = new Set();

  for (const landfall of landfalls) {
    if (!landfall?.state) continue;
    const density = densityForState(landfall.state, stateDensities);
    if (!Number.isFinite(density) || density <= 0) continue;

    const nearbyRecords = recordsNearLandfall(records, landfall, windowHours);
    for (const record of nearbyRecords) {
      analyzed.add(`${record.t || ''}:${landfall.state}`);
      const area64 = windRadiiAreaSqMi(record.radii.slice(8, 12));
      if (area64 <= 0) continue;
      const landFactor = landInteractionFactor(landfall);

      for (const threshold of THRESHOLDS) {
        const footprintArea = threshold.key === 'cat1'
          ? area64
          : inferredInnerCoreAreaSqMi(area64, Number(record.wind || landfall.wind || 0), threshold.kt);
        if (footprintArea <= 0) continue;
        const effectiveLandArea = footprintArea * landFactor;
        const exposed = effectiveLandArea * density;
        mergeStateExposure(byState, landfall.state, threshold.key, {
          people: exposed,
          area_sqmi: effectiveLandArea,
          record_time: record.t || null,
          wind_kt: Number(record.wind || 0),
          density_per_sqmi: density,
        });
      }
    }
  }

  const totals = Object.fromEntries(THRESHOLDS.map(threshold => [threshold.key, 0]));
  const maxAreaSqmi = Object.fromEntries(THRESHOLDS.map(threshold => [threshold.key, 0]));
  for (const state of byState.values()) {
    for (const threshold of THRESHOLDS) {
      const best = state[threshold.key];
      if (!best) continue;
      totals[threshold.key] += best.people;
      maxAreaSqmi[threshold.key] += best.area_sqmi;
    }
  }

  const headlineKey = totals.cat2 > 0 ? 'cat2' : 'cat1';
  if (totals[headlineKey] <= 0) {
    return unavailable('No hurricane-force wind-radii footprint was available near U.S. landfall.');
  }

  const affectedStates = [...byState.keys()].sort();
  return {
    available: true,
    headline_key: headlineKey,
    headline_label: labelForKey(headlineKey),
    headline_people: totals[headlineKey],
    exposed: totals,
    max_area_sqmi: maxAreaSqmi,
    affected_states: affectedStates,
    analyzed_records: analyzed.size,
    density_source: 'data/us-states.geojson density attributes',
    methodology: 'Screening estimate using HURDAT2 64 kt wind-radii geometry near U.S. landfall times, inferred inner-core Cat-2/3/5 areas, and state-level population density. It is not a gridded census or LandScan model.',
  };
}

export function formatExposurePeople(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value < 10_000) return '<10K';
  if (value < 950_000) return `${Math.round(value / 1_000).toLocaleString()}K`;
  if (value < 9_950_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1_000_000).toLocaleString()}M`;
}

export function formatExposureTooltip(exposure) {
  if (!exposure?.available) return exposure?.reason || 'Population exposure unavailable.';
  const pieces = [
    `Estimated exposure: ${formatExposurePeople(exposure.exposed.cat1)} Cat-1+, ${formatExposurePeople(exposure.exposed.cat3)} Cat-3+, ${formatExposurePeople(exposure.exposed.cat5)} Cat-5.`,
    `States: ${exposure.affected_states.join(', ') || 'unknown'}.`,
    `${exposure.analyzed_records} wind-radii/landfall matches analyzed.`,
    exposure.methodology,
  ];
  return pieces.join(' ');
}

export function windRadiiAreaSqMi(quadRadiiNm) {
  if (!Array.isArray(quadRadiiNm) || quadRadiiNm.length < 4) return 0;
  const areaNm2 = quadRadiiNm.slice(0, 4)
    .map(value => Math.max(0, Number(value) || 0))
    .reduce((sum, radius) => sum + (Math.PI * radius * radius) / 4, 0);
  return areaNm2 * NM2_TO_SQMI;
}

export function inferredInnerCoreAreaSqMi(area64SqMi, windKt, thresholdKt) {
  if (!Number.isFinite(area64SqMi) || area64SqMi <= 0) return 0;
  if (!Number.isFinite(windKt) || windKt < thresholdKt) return 0;
  const thresholdProfile = thresholdKt >= 137
    ? { base: 0.035, cap: 0.18 }
    : thresholdKt >= 96
      ? { base: 0.08, cap: 0.42 }
      : { base: 0.14, cap: 0.58 };
  const range = Math.max(10, windKt - 64);
  const headroom = Math.max(0, windKt - thresholdKt);
  const ratio = thresholdProfile.base
    + Math.pow(Math.min(1, headroom / range), 1.4) * (thresholdProfile.cap - thresholdProfile.base);
  return area64SqMi * clamp(ratio, thresholdProfile.base, thresholdProfile.cap);
}

function uniqueLandfalls(landfalls) {
  if (!Array.isArray(landfalls)) return [];
  const seen = new Set();
  const result = [];
  for (const landfall of landfalls) {
    if (!landfall?.state || !landfall.t) continue;
    const timestamp = Date.parse(landfall.t);
    const bucket = Number.isFinite(timestamp) ? Math.round(timestamp / (6 * 60 * 60 * 1000)) : landfall.t;
    const key = `${landfall.state}:${bucket}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(landfall);
  }
  return result;
}

function densityForState(state, densities) {
  const direct = Number(densities[state]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const values = Object.values(densities).map(Number).filter(value => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function recordsNearLandfall(records, landfall, windowHours) {
  const landfallMs = Date.parse(landfall.t);
  if (!Number.isFinite(landfallMs)) return [];
  const enriched = records
    .map(record => ({ record, diff: Math.abs(Date.parse(record.t) - landfallMs) / 36e5 }))
    .filter(item => Number.isFinite(item.diff))
    .sort((a, b) => a.diff - b.diff);
  const withinWindow = enriched.filter(item => item.diff <= windowHours).map(item => item.record);
  if (withinWindow.length) return withinWindow;
  return enriched.slice(0, 2).filter(item => item.diff <= windowHours * 2).map(item => item.record);
}

function landInteractionFactor(landfall) {
  const base = REGION_LAND_FACTORS[landfall.state] || 0.30;
  const categoryBonus = Number(landfall.category || 0) >= 3 ? 0.04 : 0;
  const inferredPenalty = landfall.inferred ? 0.05 : 0;
  return clamp(base + categoryBonus - inferredPenalty, 0.18, 0.64);
}

function mergeStateExposure(byState, stateName, thresholdKey, candidate) {
  if (!byState.has(stateName)) byState.set(stateName, {});
  const state = byState.get(stateName);
  if (!state[thresholdKey] || candidate.people > state[thresholdKey].people) {
    state[thresholdKey] = candidate;
  }
}

function labelForKey(key) {
  return THRESHOLDS.find(threshold => threshold.key === key)?.label || 'wind';
}

function unavailable(reason) {
  return {
    available: false,
    reason,
    headline_people: 0,
    exposed: { cat1: 0, cat2: 0, cat3: 0, cat5: 0 },
    max_area_sqmi: { cat1: 0, cat2: 0, cat3: 0, cat5: 0 },
    affected_states: [],
    analyzed_records: 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
