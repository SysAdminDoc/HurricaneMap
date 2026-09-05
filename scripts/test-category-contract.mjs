import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { windToCategory } from '../src/data.js';

const glossary = JSON.parse(await readFile(new URL('../data/glossary.json', import.meta.url), 'utf8'));
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

const boundaryCases = [
  [0, 0],
  [33, 0],
  [34, -1],
  [63, -1],
  [64, 1],
  [82, 1],
  [83, 2],
  [95, 2],
  [96, 3],
  [112, 3],
  [113, 4],
  [136, 4],
  [137, 5],
  [200, 5],
];

for (const [windKt, expected] of boundaryCases) {
  assert.equal(
    windToCategory(windKt),
    expected,
    `${windKt} kt must map to category ${expected}`,
  );
}

const byTerm = new Map(glossary.map(entry => [entry.term, entry.definition]));
const scale = byTerm.get('Saffir-Simpson Scale');
const major = byTerm.get('Major Hurricane');
assert.ok(scale, 'glossary must define the Saffir-Simpson Scale');
assert.ok(major, 'glossary must define Major Hurricane');

for (const range of ['34-63 kt', '64-82 kt', '83-95 kt', '96-112 kt', '113-136 kt', '137+ kt']) {
  assert.ok(scale.includes(range), `Saffir-Simpson definition must include ${range}`);
}
assert.match(scale, /wind hazard only/i, 'Saffir-Simpson definition must describe a wind-only scale');
assert.match(major, /at least 96 kt \(111 mph\)/i, 'major-hurricane definition must start at 96 kt / 111 mph');

const definitions = glossary.map(entry => entry.definition).join('\n');
assert.doesNotMatch(definitions, /\b157\s*kt\b/i, 'glossary must not publish the obsolete 157 kt Category 5 threshold');
assert.doesNotMatch(definitions, /\b111\s*kt\b/i, 'glossary must not confuse the 111 mph major-hurricane threshold with knots');

// Hyphens, not en dashes: these expectations used to spell the README rows with
// en dashes while the glossary rows above spell the very same ranges with
// hyphens, so the README table was the odd one out and the repo's writing rule
// bans en dashes in prose. The numbers are unchanged.
for (const row of [
  '| TS / sub-hurricane | 34-63 kt |',
  '| Cat 1 | 64-82 kt |',
  '| Cat 2 | 83-95 kt |',
  '| Cat 3 (major) | 96-112 kt |',
  '| Cat 4 | 113-136 kt |',
  '| Cat 5 | 137+ kt |',
]) {
  assert.ok(readme.includes(row), `README category table must include ${row}`);
}

console.log(`Category contract validated across ${boundaryCases.length} wind boundaries and published glossary/README copy.`);
