import assert from 'node:assert/strict';
import { createDefaultFilters } from '../src/url-state.js';
import {
  hasActiveFilters,
  hasActivePrimaryFilters,
  isYearFiltered,
  resetPrimaryFilters,
  resetYearRange,
  setCategoryMacro,
  setYearRange,
  toggleCategory,
} from '../src/filter-state.js';

const defaults = { yearMinDefault: 1851, yearMaxDefault: 2025 };

function cats(filters) {
  return [...filters.categories].sort();
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(setYearRange(filters, '2030', '1800', defaults), true);
  assert.equal(filters.yearMin, 1851);
  assert.equal(filters.yearMax, 2025);
  assert.equal(setYearRange(filters, 'bad', '2020', defaults), false);
  assert.equal(filters.yearMin, 1851);
  assert.equal(filters.yearMax, 2025);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(isYearFiltered(filters, defaults), false);
  setYearRange(filters, '2005', '2005', defaults);
  assert.equal(isYearFiltered(filters, defaults), true);
  resetYearRange(filters, defaults);
  assert.equal(isYearFiltered(filters, defaults), false);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(setCategoryMacro(filters, 'major'), true);
  assert.deepEqual(cats(filters), ['3', '4', '5']);
  assert.equal(setCategoryMacro(filters, 'tropical'), true);
  assert.deepEqual(cats(filters), ['ts']);
  assert.equal(setCategoryMacro(filters, 'unknown'), false);
  assert.deepEqual(cats(filters), ['ts']);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(toggleCategory(filters, '3'), false);
  assert.equal(filters.categories.has('3'), false);
  assert.equal(toggleCategory(filters, '3'), true);
  assert.equal(filters.categories.has('3'), true);
  assert.equal(toggleCategory(filters, 'bad'), false);
  assert.equal(filters.categories.has('bad'), false);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(hasActivePrimaryFilters(filters, defaults), false);
  assert.equal(hasActiveFilters(filters, defaults), false);
  assert.equal(hasActiveFilters(filters, defaults, { surgeCategory: '3' }), true);
  assert.equal(hasActiveFilters(filters, defaults, { showPopulation: true }), true);
  filters.state = 'Florida';
  assert.equal(hasActivePrimaryFilters(filters, defaults), true);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.yearMin = 2005;
  filters.yearMax = 2005;
  filters.categories = new Set(['3', '4', '5']);
  filters.state = 'Louisiana';
  filters.showTracks = true;
  filters.showHeatmap = true;
  resetPrimaryFilters(filters, defaults);
  assert.equal(filters.yearMin, 1851);
  assert.equal(filters.yearMax, 2025);
  assert.deepEqual(cats(filters), ['1', '2', '3', '4', '5', 'ts']);
  assert.equal(filters.state, '');
  assert.equal(filters.showTracks, false);
  assert.equal(filters.showHeatmap, false);
  assert.equal(hasActivePrimaryFilters(filters, defaults), false);
}

console.log('filter state ok');
