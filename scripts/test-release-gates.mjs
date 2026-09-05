import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeSpawnFailure,
  findMissingGates,
  findUnclaimedGates,
  GATE_SCRIPTS,
  NON_GATE_SCRIPTS,
} from './run-gates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

// Every gate the runner names has to exist, and every gate-shaped script has to
// be claimed by exactly one of the two lists. This is what stops a gate from
// being added to package.json and then never run.
assert.deepEqual(findMissingGates(scripts), [], 'GATE_SCRIPTS names a script package.json does not define');
assert.deepEqual(findUnclaimedGates(scripts), [], 'a check:/validate:/test: script is claimed by neither list');
assert.equal(new Set(GATE_SCRIPTS).size, GATE_SCRIPTS.length, 'GATE_SCRIPTS must not repeat a gate');
assert.equal(
  GATE_SCRIPTS.filter(name => NON_GATE_SCRIPTS.includes(name)).length,
  0,
  'a gate cannot be both run and excluded',
);
const withoutTwoGates = { ...scripts };
delete withoutTwoGates['check:syntax'];
delete withoutTwoGates['test:i18n'];
assert.deepEqual(
  findMissingGates(withoutTwoGates).sort(),
  ['check:syntax', 'test:i18n'],
  'a removed gate must be reported',
);
assert.deepEqual(
  findUnclaimedGates({ ...scripts, 'check:brand-new': 'node scripts/nope.mjs' }),
  ['check:brand-new'],
  'a newly added gate that nothing runs must be reported',
);

// A gate can die without an exit status. Reporting those as a bare FAIL left an
// operator staring at truncated output with no stated cause.
assert.match(
  describeSpawnFailure({ status: null, signal: 'SIGTERM', error: { code: 'ENOBUFS', message: 'x' } }),
  /wrote more than \d+ MB and was cut off/,
);
assert.match(
  describeSpawnFailure({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'x' } }),
  /killed after \d+s/,
);
assert.match(describeSpawnFailure({ status: null, signal: 'SIGKILL' }), /killed after \d+s \(SIGKILL\)/);
assert.equal(describeSpawnFailure({ status: null, error: { code: 'ENOENT', message: 'spawn failed' } }), 'spawn failed');
assert.equal(describeSpawnFailure({ status: 1, signal: null }), '', 'an ordinary non-zero exit needs no extra explanation');
assert.equal(describeSpawnFailure(undefined), '');

console.log(`release gate runner ok (${GATE_SCRIPTS.length} gates claimed, ${NON_GATE_SCRIPTS.length} excluded, failure modes named)`);
