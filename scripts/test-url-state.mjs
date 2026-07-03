import assert from 'node:assert/strict';
import {
  CATEGORY_DEFAULTS,
  applyHashToFilters,
  createDefaultFilters,
  decodeHashState,
  encodeHashState,
  restoreFiltersFromHash,
} from '../src/url-state.js';

function cats(filters) {
  return [...filters.categories].sort();
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(encodeHashState(filters, { yearMinDefault: 1851, yearMaxDefault: 2025 }), '');
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.categories = new Set(['5', '4', '3']);
  filters.state = 'Florida';
  filters.showTracks = true;
  assert.equal(
    encodeHashState(filters, {
      openStormId: 'AL122005',
      yearMinDefault: 1851,
      yearMaxDefault: 2025,
    }),
    '#c=3%2C4%2C5&s=Florida&t=1&storm=AL122005',
  );
}

{
  assert.deepEqual(decodeHashState('#s=%E0%A4%A&c=3'), { c: '3' });
  assert.equal(decodeHashState(''), null);
  assert.deepEqual(decodeHashState('#not-a-pair&h=1'), { h: '1' });
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const { decoded, filters: restored } = restoreFiltersFromHash('#c=bad&s=NotAState', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: { Florida: true },
  });
  assert.deepEqual(decoded, { c: 'bad', s: 'NotAState' });
  assert.deepEqual(cats(restored), [...CATEGORY_DEFAULTS].sort());
  assert.equal(restored.state, '');
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const { filters: restored } = restoreFiltersFromHash('#y=2030-1800&c=3,4&s=Florida&t=1&h=1', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: new Set(['Florida']),
  });
  assert.equal(restored.yearMin, 1851);
  assert.equal(restored.yearMax, 2025);
  assert.deepEqual(cats(restored), ['3', '4']);
  assert.equal(restored.state, 'Florida');
  assert.equal(restored.showTracks, true);
  assert.equal(restored.showHeatmap, true);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.state = 'Texas';
  filters.categories = new Set(['ts']);
  const decoded = applyHashToFilters(filters, '#s=Florida&c=1,2', {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: ['Florida', 'Texas'],
  });
  assert.deepEqual(decoded, { s: 'Florida', c: '1,2' });
  assert.equal(filters.state, 'Florida');
  assert.deepEqual(cats(filters), ['1', '2']);
}

// Both endpoints out of bounds on the same side must clamp, not invert.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const { filters: restored } = restoreFiltersFromHash('#y=2100-2200', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.equal(restored.yearMin, 2025);
  assert.equal(restored.yearMax, 2025);
  const { filters: below } = restoreFiltersFromHash('#y=1700-1800', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.equal(below.yearMin, 1851);
  assert.equal(below.yearMax, 1851);
}

// retiredOnly round-trips through the hash.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.retiredOnly = true;
  const hash = encodeHashState(filters, { yearMinDefault: 1851, yearMaxDefault: 2025 });
  assert.equal(hash, '#r=1');
  const fresh = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  applyHashToFilters(fresh, hash, { yearMinDefault: 1851, yearMaxDefault: 2025 });
  assert.equal(fresh.retiredOnly, true);
}

console.log('url state ok');
