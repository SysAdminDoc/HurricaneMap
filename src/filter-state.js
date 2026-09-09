import { CATEGORY_DEFAULTS, createDefaultFilters } from './url-state.js';

export function setYearRange(filters, yearMin, yearMax, {
  yearMinDefault,
  yearMaxDefault,
} = {}) {
  const a = Number.parseInt(yearMin, 10);
  const b = Number.parseInt(yearMax, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  // Clamp each endpoint into bounds AFTER ordering — the previous max()/min()
  // split inverted the range (yearMin > yearMax → empty map) when both typed
  // values fell outside the bounds on the same side (e.g. 2100/2200).
  const clamp = (v) => Math.max(yearMinDefault, Math.min(yearMaxDefault, v));
  filters.yearMin = clamp(Math.min(a, b));
  filters.yearMax = clamp(Math.max(a, b));
  return true;
}

export function resetYearRange(filters, {
  yearMinDefault,
  yearMaxDefault,
} = {}) {
  filters.yearMin = yearMinDefault;
  filters.yearMax = yearMaxDefault;
}

export function resetPrimaryFilters(filters, {
  yearMinDefault,
  yearMaxDefault,
} = {}) {
  const defaults = createDefaultFilters({ yearMin: yearMinDefault, yearMax: yearMaxDefault });
  filters.yearMin = defaults.yearMin;
  filters.yearMax = defaults.yearMax;
  filters.categories = defaults.categories;
  filters.state = defaults.state;
  filters.showTracks = defaults.showTracks;
  filters.showHeatmap = defaults.showHeatmap;
  filters.retiredOnly = defaults.retiredOnly;
}

/**
 * Reset exactly the filters excludingFilterNames can name, and nothing else.
 *
 * resetPrimaryFilters is the whole-sidebar reset and also clears showTracks and
 * showHeatmap. Those draw over the surviving landfalls rather than deciding
 * which survive, so a button whose message names only the year range and the
 * state must not switch them off.
 */
export function resetExcludingFilters(filters, { yearMinDefault, yearMaxDefault } = {}) {
  const defaults = createDefaultFilters({ yearMin: yearMinDefault, yearMax: yearMaxDefault });
  filters.yearMin = defaults.yearMin;
  filters.yearMax = defaults.yearMax;
  filters.categories = defaults.categories;
  filters.state = defaults.state;
  filters.retiredOnly = defaults.retiredOnly;
}

/**
 * Everything one click of Reset filters destroys, in one plain object.
 *
 * Nine pieces of state, and three of them do not live on the filters object:
 * the surge category, the population layer and the sea-surface layer are read
 * from their own controls and written back through their own modules. They are
 * passed in and handed back rather than reached for here, so this stays
 * testable without a document.
 */
export function captureFilterState(filters, layers = {}) {
  return {
    yearMin: filters.yearMin,
    yearMax: filters.yearMax,
    categories: [...filters.categories].sort(),
    state: filters.state || '',
    showTracks: Boolean(filters.showTracks),
    showHeatmap: Boolean(filters.showHeatmap),
    retiredOnly: Boolean(filters.retiredOnly),
    surgeCategory: String(layers.surgeCategory ?? ''),
    showPopulation: Boolean(layers.showPopulation),
    showSST: Boolean(layers.showSST),
  };
}

/** Put a captured state back. Returns the three layers for the caller to apply. */
export function applyFilterState(filters, snapshot) {
  filters.yearMin = snapshot.yearMin;
  filters.yearMax = snapshot.yearMax;
  filters.categories = new Set(snapshot.categories);
  filters.state = snapshot.state;
  filters.showTracks = snapshot.showTracks;
  filters.showHeatmap = snapshot.showHeatmap;
  filters.retiredOnly = snapshot.retiredOnly;
  return {
    surgeCategory: snapshot.surgeCategory,
    showPopulation: snapshot.showPopulation,
    showSST: snapshot.showSST,
  };
}

export function filterByMacro(filters, mode) {
  if (mode === 'major') {
    filters.categories = new Set(['3', '4', '5']);
    return true;
  }
  if (mode === 'tropical') {
    filters.categories = new Set(['ts']);
    return true;
  }
  return false;
}

export function toggleCategory(filters, category) {
  if (!CATEGORY_DEFAULTS.includes(category)) return filters.categories.has(category);
  if (filters.categories.has(category)) {
    filters.categories.delete(category);
  } else {
    filters.categories.add(category);
  }
  return filters.categories.has(category);
}

export function isYearFiltered(filters, {
  yearMinDefault,
  yearMaxDefault,
} = {}) {
  return filters.yearMin > yearMinDefault || filters.yearMax < yearMaxDefault;
}

export function hasActivePrimaryFilters(filters, {
  yearMinDefault,
  yearMaxDefault,
} = {}) {
  return filters.yearMin !== yearMinDefault ||
    filters.yearMax !== yearMaxDefault ||
    filters.state !== '' ||
    filters.showTracks ||
    filters.showHeatmap ||
    filters.retiredOnly ||
    filters.categories.size !== CATEGORY_DEFAULTS.length ||
    !CATEGORY_DEFAULTS.every(category => filters.categories.has(category));
}

/**
 * Which active filters could have excluded every landfall, so the empty state
 * can name what to undo rather than shrugging.
 *
 * showTracks and showHeatmap are deliberately absent: they change what is drawn
 * over the surviving landfalls, not which ones survive, so naming them would
 * send a reader to switch off something that is not the cause.
 */
export function excludingFilterNames(filters, { yearMinDefault, yearMaxDefault } = {}) {
  const names = [];
  if (filters.yearMin !== yearMinDefault || filters.yearMax !== yearMaxDefault) names.push('years');
  if (filters.categories.size !== CATEGORY_DEFAULTS.length
    || !CATEGORY_DEFAULTS.every(category => filters.categories.has(category))) names.push('categories');
  if (filters.state !== '') names.push('state');
  if (filters.retiredOnly) names.push('retired');
  return names;
}

export function hasActiveFilters(filters, defaults, {
  surgeCategory = '',
  showPopulation = false,
  showSST = false,
} = {}) {
  return hasActivePrimaryFilters(filters, defaults) ||
    Boolean(surgeCategory) ||
    Boolean(showPopulation) ||
    Boolean(showSST);
}
