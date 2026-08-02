import { URL_STATE_VERSION } from './schema-contract.js';

export const YEAR_FALLBACK_MIN = 1851;
export const YEAR_FALLBACK_MAX = 2025;
export const CATEGORY_DEFAULTS = Object.freeze(['ts', '1', '2', '3', '4', '5']);

const VALID_CATEGORIES = new Set(CATEGORY_DEFAULTS);
const LAUNCHER_ACTIONS = new Set(['stats', 'compare']);
const VALID_UNITS = new Set(['kt', 'mph', 'kmh']);
const VALID_DAMAGE_MODES = new Set(['nominal', 'real']);
const STORM_ID_PATTERN = /^(?:AL|EP)\d{6}$/;
const ADVISORY_REPLAY_STATE_VERSION = '1';
const ADVISORY_CONE_ERAS = new Set(Array.from({ length: 11 }, (_, index) => String(2015 + index)));
const MAX_ADVISORY_REPLAY_INDEX = 999;
const MAX_HASH_LENGTH = 2048;

export { ADVISORY_REPLAY_STATE_VERSION };

export function launcherActionFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '').trim().toLowerCase();
  return LAUNCHER_ACTIONS.has(raw) ? raw : null;
}

export function categoryHashDefault() {
  return [...CATEGORY_DEFAULTS].sort().join(',');
}

export function createDefaultFilters({ yearMin = YEAR_FALLBACK_MIN, yearMax = YEAR_FALLBACK_MAX } = {}) {
  return {
    yearMin,
    yearMax,
    categories: new Set(CATEGORY_DEFAULTS),
    state: '',
    showTracks: false,
    showHeatmap: false,
    retiredOnly: false,
  };
}

export function encodeHashState(filters, {
  openStormId = '',
  comparisonIds = [],
  advisoryReplay = null,
  windUnit = 'kt',
  damageMode = 'real',
  yearMinDefault = YEAR_FALLBACK_MIN,
  yearMaxDefault = YEAR_FALLBACK_MAX,
} = {}) {
  const defaults = {
    y: `${yearMinDefault}-${yearMaxDefault}`,
    c: categoryHashDefault(),
    s: '',
    t: '0',
    h: '0',
    r: '0',
    storm: '',
    p: '',
    u: 'kt',
    d: 'real',
  };
  const current = {
    y: `${filters.yearMin}-${filters.yearMax}`,
    c: [...filters.categories].sort().join(','),
    s: filters.state,
    t: filters.showTracks ? '1' : '0',
    h: filters.showHeatmap ? '1' : '0',
    r: filters.retiredOnly ? '1' : '0',
    storm: openStormId || '',
    p: normalizeComparisonIds(comparisonIds).join(','),
    u: VALID_UNITS.has(windUnit) ? windUnit : 'kt',
    d: VALID_DAMAGE_MODES.has(damageMode) ? damageMode : 'real',
    replay: encodeAdvisoryReplayState(advisoryReplay, { stormId: openStormId }),
  };
  const parts = [];
  for (const key of Object.keys(current)) {
    if (current[key] !== defaults[key] && (current[key] || key === 'c')) {
      parts.push(`${key}=${encodeURIComponent(current[key])}`);
    }
  }
  return parts.length ? `#v=${URL_STATE_VERSION}&${parts.join('&')}` : '';
}

// The replay payload is versioned independently from the broader v=1 view so
// saved-view imports remain compatible while this state gains its own contract.
// The ordinal is zero-based, matching the advisory replay scrubber.
export function encodeAdvisoryReplayState(state, { stormId = '' } = {}) {
  const normalized = normalizeAdvisoryReplayState(state);
  if (!normalized || (stormId && normalized.stormId !== normalizeStormId(stormId))) return '';
  return [
    ADVISORY_REPLAY_STATE_VERSION,
    normalized.stormId,
    normalized.index,
    normalized.coneEra,
  ].join('.');
}

export function decodeAdvisoryReplayState(value, { stormId = '' } = {}) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts[0] !== ADVISORY_REPLAY_STATE_VERSION) return null;
  if (!/^\d{1,3}$/.test(parts[2])) return null;
  const normalized = normalizeAdvisoryReplayState({
    stormId: parts[1],
    index: parts[2],
    coneEra: parts[3],
  });
  if (!normalized || (stormId && normalized.stormId !== normalizeStormId(stormId))) return null;
  return normalized;
}

export function normalizeAdvisoryReplayState(state) {
  if (!state || typeof state !== 'object') return null;
  const stormId = normalizeStormId(state.stormId ?? state.storm_id);
  const index = Number(state.index);
  const coneEra = String(state.coneEra ?? state.cone_era ?? '');
  if (!stormId || !Number.isSafeInteger(index) || index < 0 || index > MAX_ADVISORY_REPLAY_INDEX) return null;
  if (!ADVISORY_CONE_ERAS.has(coneEra)) return null;
  return { stormId, index, coneEra };
}

export function decodeHashState(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || raw.length > MAX_HASH_LENGTH) return null;
  const decoded = {};
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    let value;
    try {
      value = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      continue;
    }
    decoded[key] = value;
  }
  return decoded;
}

export function viewOptionsFromDecoded(decoded) {
  if (!decoded || (decoded.v !== undefined && decoded.v !== URL_STATE_VERSION)) {
    return { comparisonIds: [], windUnit: null, damageMode: null, advisoryReplay: null };
  }
  const versioned = decoded.v === URL_STATE_VERSION;
  return {
    comparisonIds: normalizeComparisonIds(String(decoded.p || '').split(',')),
    windUnit: VALID_UNITS.has(decoded.u) ? decoded.u : versioned ? 'kt' : null,
    damageMode: VALID_DAMAGE_MODES.has(decoded.d) ? decoded.d : versioned ? 'real' : null,
    advisoryReplay: versioned
      ? decodeAdvisoryReplayState(decoded.replay, { stormId: decoded.storm })
      : null,
  };
}

function normalizeComparisonIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').toUpperCase())
    .filter(id => STORM_ID_PATTERN.test(id)))].slice(0, 4);
}

export function restoreFiltersFromHash(hash, currentFilters, {
  yearMinDefault = YEAR_FALLBACK_MIN,
  yearMaxDefault = YEAR_FALLBACK_MAX,
  knownStates = null,
} = {}) {
  const decoded = decodeHashState(hash);
  if (!decoded) return { decoded: null, filters: cloneFilters(currentFilters) };

  if (decoded.v !== undefined && decoded.v !== URL_STATE_VERSION) {
    return { decoded, filters: cloneFilters(currentFilters) };
  }
  // A versioned hash is a complete saved/shareable view: omitted fields mean
  // contract defaults, not whatever happened to be active in this tab.
  const next = decoded.v === URL_STATE_VERSION
    ? createDefaultFilters({ yearMin: yearMinDefault, yearMax: yearMaxDefault })
    : cloneFilters(currentFilters);
  if (decoded.y && /^\d{4}-\d{4}$/.test(decoded.y)) {
    const [a, b] = decoded.y.split('-').map(Number);
    // Clamp each endpoint into bounds AFTER ordering — clamping lo with max()
    // and hi with min() inverts the range when both fall outside the bounds
    // on the same side (e.g. a stale #y=2100-2200 permalink → empty map).
    const clamp = (v) => Math.max(yearMinDefault, Math.min(yearMaxDefault, v));
    next.yearMin = clamp(Math.min(a, b));
    next.yearMax = clamp(Math.max(a, b));
  }
  if (decoded.c !== undefined) {
    const categories = decoded.c
      ? decoded.c.split(',').filter(category => VALID_CATEGORIES.has(category))
      : [];
    // Preserve an intentionally empty selection (`#c=`), but canonicalize a
    // non-empty value containing only unknown categories back to the default.
    next.categories = new Set(
      decoded.c && categories.length === 0 ? CATEGORY_DEFAULTS : categories,
    );
  }
  if (decoded.s !== undefined) {
    next.state = hasKnownState(knownStates, decoded.s) ? decoded.s : '';
  }
  if (decoded.t !== undefined) next.showTracks = decoded.t === '1';
  if (decoded.h !== undefined) next.showHeatmap = decoded.h === '1';
  if (decoded.r !== undefined) next.retiredOnly = decoded.r === '1';

  return { decoded, filters: next };
}

export function applyHashToFilters(filters, hash, options = {}) {
  const { decoded, filters: restored } = restoreFiltersFromHash(hash, filters, options);
  filters.yearMin = restored.yearMin;
  filters.yearMax = restored.yearMax;
  filters.categories = restored.categories;
  filters.state = restored.state;
  filters.showTracks = restored.showTracks;
  filters.showHeatmap = restored.showHeatmap;
  filters.retiredOnly = restored.retiredOnly;
  return decoded;
}

function cloneFilters(filters) {
  return {
    yearMin: filters.yearMin,
    yearMax: filters.yearMax,
    categories: new Set(filters.categories),
    state: filters.state || '',
    showTracks: Boolean(filters.showTracks),
    showHeatmap: Boolean(filters.showHeatmap),
    retiredOnly: Boolean(filters.retiredOnly),
  };
}

function hasKnownState(knownStates, state) {
  if (!state) return false;
  if (knownStates instanceof Set) return knownStates.has(state);
  if (Array.isArray(knownStates)) return knownStates.includes(state);
  if (knownStates && typeof knownStates === 'object') {
    return Object.prototype.hasOwnProperty.call(knownStates, state);
  }
  return false;
}

function normalizeStormId(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return STORM_ID_PATTERN.test(normalized) ? normalized : '';
}
