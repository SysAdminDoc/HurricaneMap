import { CATEGORY_DEFAULTS, createDefaultFilters } from './url-state.js';

export function setYearRange(filters, yearMin, yearMax, {
  yearMinDefault,
  yearMaxDefault,
} = {}) {
  const a = Number.parseInt(yearMin, 10);
  const b = Number.parseInt(yearMax, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  filters.yearMin = Math.max(yearMinDefault, Math.min(a, b));
  filters.yearMax = Math.min(yearMaxDefault, Math.max(a, b));
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

export function setCategoryMacro(filters, mode) {
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
