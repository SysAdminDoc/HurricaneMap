import assert from 'node:assert/strict';

import { PREP_ITEMS, calculatePrepSupplies, normalizePrepState } from '../src/prep.js';

assert.deepEqual(calculatePrepSupplies(4, 'go'), {
  people: 4,
  days: 3,
  waterGallons: 12,
  waterLiters: 45,
  foodPersonDays: 12,
});
assert.deepEqual(calculatePrepSupplies(3, 'home'), {
  people: 3,
  days: 14,
  waterGallons: 42,
  waterLiters: 159,
  foodPersonDays: 42,
});

const normalized = normalizePrepState({
  household: 999,
  mode: '<script>',
  checked: ['water', 'water', 'food', 'not-real'],
});
assert.equal(normalized.household, 20);
assert.equal(normalized.mode, 'go');
assert.deepEqual(normalized.checked, ['water', 'food']);
assert(PREP_ITEMS.length >= 16, 'preparedness checklist should cover essential and household-specific needs');
assert.equal(new Set(PREP_ITEMS.map(([id]) => id)).size, PREP_ITEMS.length, 'checklist IDs must be unique for persistence');

console.log('preparedness calculator ok');
