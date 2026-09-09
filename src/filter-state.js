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
