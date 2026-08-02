import assert from 'node:assert/strict';

import { fuzzyAugment, levenshtein } from '../src/fuzzy.js';

assert.equal(levenshtein('', ''), 0, 'empty strings should have zero edit distance');
assert.equal(levenshtein('', 'storm'), 5, 'an empty left operand should cost the right length');
assert.equal(levenshtein('storm', ''), 5, 'an empty right operand should cost the left length');
assert.equal(levenshtein('Katrina', 'Katrina'), 0, 'identical names should short-circuit');
assert.equal(levenshtein('kitten', 'sitting'), 3, 'the two-row dynamic program should count edits');

const katrina = { storm_id: 'AL122005', name: 'KATRINA', year: 2005 };
const andrew = { storm_id: 'AL041992', name: 'ANDREW', year: 1992 };
const unnamed = { storm_id: 'AL001900', name: 'UNNAMED', year: 1900 };
const landfalls = [katrina, andrew, unnamed];

assert.deepEqual(fuzzyAugment('Catrina', landfalls, []), [katrina], 'a one-edit Katrina typo should be found');
assert.deepEqual(fuzzyAugment('Andrwe', landfalls, []), [andrew], 'a transposed Andrew typo should be found');
assert.deepEqual(fuzzyAugment('Katrzzz', landfalls, []), [], 'distance-three noise should be rejected by the distance cap');
assert.deepEqual(fuzzyAugment('Cat', landfalls, []), [], 'queries shorter than four characters should not fuzzy-match');
assert.deepEqual(fuzzyAugment('Catrina', landfalls, [katrina]), [], 'substring results already shown must not be duplicated');
assert.deepEqual(fuzzyAugment('unnamed', landfalls, []), [], 'unnamed storms are not fuzzy-search candidates');

console.log('fuzzy search ok (edit distance, typo recovery, pruning, and duplicate suppression)');
