import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { categoryStrength } from '../src/data.js';
import { createDefaultFilters } from '../src/url-state.js';
import {
  hasActiveFilters,
  hasActivePrimaryFilters,
  isYearFiltered,
  applyFilterState,
  captureFilterState,
  resetPrimaryFilters,
  resetYearRange,
  filterByMacro,
  setYearRange,
  toggleCategory,
} from '../src/filter-state.js';

const defaults = { yearMinDefault: 1851, yearMaxDefault: 2025 };
const keyboardSource = readFileSync(new URL('../src/keyboard.js', import.meta.url), 'utf8');
assert.match(keyboardSource, /import \{ filterByMacro \} from '\.\/filter-state\.js';/, 'keyboard shortcut must import the macro filter');
assert.match(keyboardSource, /e\.ctrlKey && !e\.metaKey/, 'Cmd+M must remain available to macOS');
assert.doesNotMatch(keyboardSource, /window\.filterByMacro/, 'macro filtering must not cross a window global');

assert.deepEqual(
  [0, -1, 1, 2, 3, 4, 5].sort((a, b) => categoryStrength(a) - categoryStrength(b)),
  [0, -1, 1, 2, 3, 4, 5],
  'category strength must rank TD below TS below hurricanes',
);

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
  // Both endpoints beyond the same bound clamp instead of inverting.
  assert.equal(setYearRange(filters, '2100', '2200', defaults), true);
  assert.equal(filters.yearMin, 2025);
  assert.equal(filters.yearMax, 2025);
  assert.equal(setYearRange(filters, '1700', '1800', defaults), true);
  assert.equal(filters.yearMin, 1851);
  assert.equal(filters.yearMax, 1851);
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
  assert.equal(filterByMacro(filters, 'major'), true);
  assert.deepEqual(cats(filters), ['3', '4', '5']);
  assert.equal(filterByMacro(filters, 'tropical'), true);
  assert.deepEqual(cats(filters), ['ts']);
  assert.equal(filterByMacro(filters, 'unknown'), false);
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
  assert.equal(hasActiveFilters(filters, defaults, { showSST: true }), true);
  assert.equal(hasActiveFilters(filters, defaults, { showSST: false }), false);
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

// ------------------------------------------------- reset is recoverable
//
// One click of Reset filters clears nine pieces of state and then disables the
// button, so before this there was no way back to what the reader had built.
// The round trip has to return the exact prior state, not an approximation of
// it, so this compares field by field against a state that differs from the
// defaults in every one of the nine.
{
  const defaults = { yearMinDefault: 1851, yearMaxDefault: 2025 };
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.yearMin = 1992;
  filters.yearMax = 2005;
  filters.categories = new Set(['3', '4', '5']);
  filters.state = 'Florida';
  filters.showTracks = true;
  filters.showHeatmap = true;
  filters.retiredOnly = true;
  const layers = { surgeCategory: '4', showPopulation: true, showSST: true };

  const before = captureFilterState(filters, layers);
  assert.deepStrictEqual(before, {
    yearMin: 1992,
    yearMax: 2005,
    categories: ['3', '4', '5'],
    state: 'Florida',
    showTracks: true,
    showHeatmap: true,
    retiredOnly: true,
    surgeCategory: '4',
    showPopulation: true,
    showSST: true,
  }, 'the snapshot must carry all nine pieces of state');

  resetPrimaryFilters(filters, defaults);
  const cleared = captureFilterState(filters, { surgeCategory: '', showPopulation: false, showSST: false });
  assert.notDeepEqual(cleared, before, 'the reset must actually clear something');

  const restoredLayers = applyFilterState(filters, before);
  assert.deepStrictEqual(
    captureFilterState(filters, restoredLayers),
    before,
    'undoing a reset must return the exact prior state',
  );
  // Compared against the live object too, not only against another snapshot:
  // both sides of a snapshot comparison pass through the same String() and
  // Boolean() coercion, so a restore that wrote the year back as a string
  // round-tripped green.
  assert.strictEqual(filters.yearMin, 1992);
  assert.strictEqual(filters.yearMax, 2005);
  assert.strictEqual(filters.showTracks, true);
  assert.strictEqual(filters.retiredOnly, true);
  // The categories go back as a Set the filter engine can use, not the array
  // the snapshot stores them in.
  assert.ok(filters.categories instanceof Set);
  assert.deepEqual([...filters.categories].sort(), ['3', '4', '5']);

  // The snapshot is a copy. Mutating the live filters after taking it must not
  // change what undo will put back, or an undo restores the state the reader
  // was already looking at.
  const snapshot = captureFilterState(filters, restoredLayers);
  filters.categories.add('1');
  filters.state = 'Texas';
  assert.deepStrictEqual(snapshot.categories, ['3', '4', '5']);
  assert.equal(snapshot.state, 'Florida');
  applyFilterState(filters, snapshot);
  assert.deepStrictEqual([...filters.categories].sort(), ['3', '4', '5']);
  assert.strictEqual(filters.state, 'Florida');

  // A default state round-trips too: undo has to be able to restore "nothing
  // was filtered", which is what a reader gets after resetting twice. The
  // layers are passed as the controls actually report them when nothing is on,
  // rather than omitted: omitting them asserted captureFilterState's own
  // parameter defaults and nothing in the subject could have made it fail.
  const plain = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const off = { surgeCategory: '', showPopulation: false, showSST: false };
  const plainSnapshot = captureFilterState(plain, off);
  plain.state = 'Georgia';
  const plainLayers = applyFilterState(plain, plainSnapshot);
  assert.deepStrictEqual(captureFilterState(plain, plainLayers), plainSnapshot);
  assert.deepStrictEqual(plainLayers, off, 'a default snapshot must hand back all three layers off');
}

console.log('filter state ok');
