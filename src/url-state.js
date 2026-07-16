export const YEAR_FALLBACK_MIN = 1851;
export const YEAR_FALLBACK_MAX = 2025;
export const CATEGORY_DEFAULTS = Object.freeze(['ts', '1', '2', '3', '4', '5']);

const VALID_CATEGORIES = new Set(CATEGORY_DEFAULTS);
const LAUNCHER_ACTIONS = new Set(['stats', 'compare']);

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
  };
  const current = {
    y: `${filters.yearMin}-${filters.yearMax}`,
    c: [...filters.categories].sort().join(','),
    s: filters.state,
    t: filters.showTracks ? '1' : '0',
    h: filters.showHeatmap ? '1' : '0',
    r: filters.retiredOnly ? '1' : '0',
    storm: openStormId || '',
  };
  const parts = [];
  for (const key of Object.keys(current)) {
    if (current[key] !== defaults[key] && (current[key] || key === 'c')) {
      parts.push(`${key}=${encodeURIComponent(current[key])}`);
    }
  }
  return parts.length ? `#${parts.join('&')}` : '';
}

export function decodeHashState(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
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

export function restoreFiltersFromHash(hash, currentFilters, {
  yearMinDefault = YEAR_FALLBACK_MIN,
  yearMaxDefault = YEAR_FALLBACK_MAX,
  knownStates = null,
} = {}) {
  const decoded = decodeHashState(hash);
  if (!decoded) return { decoded: null, filters: cloneFilters(currentFilters) };

  const next = cloneFilters(currentFilters);
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
