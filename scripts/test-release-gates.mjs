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
import {
  describeRunFailure,
  installedCandidates,
  INTERPRETER_CANDIDATES,
  missingInterpreterMessage,
  pinnedCandidate,
  pythonMajorVersion,
  resolvePythonInterpreter,
  searchCandidates,
  selectInterpreter,
} from './python.mjs';

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

// The Python gates run through a resolver rather than a bare `python`, which
// does not exist on systems shipping only `python3`.
const pythonGates = Object.entries(scripts).filter(([, command]) => /\.py(\s|$)/.test(command));
assert.ok(pythonGates.length >= 6, `expected at least six Python gates, found ${pythonGates.length}`);
for (const [name, command] of pythonGates) {
  assert.ok(
    command.includes('scripts/python.mjs'),
    `${name} invokes Python directly; route it through scripts/python.mjs so it resolves python3 too`,
  );
  assert.ok(!/(^|&&\s*)python\s/.test(command), `${name} still calls a bare python`);
}

assert.deepEqual(
  INTERPRETER_CANDIDATES.map(candidate => [candidate.command, ...candidate.args].join(' ')),
  ['python3', 'python', 'py -3'],
  'python3 must be tried first: on POSIX it is the name guaranteed to be Python 3',
);
const probes = [];
const found = resolvePythonInterpreter(INTERPRETER_CANDIDATES, (command, args) => {
  probes.push(command);
  return command === 'python' ? { status: 0, stdout: 'Python 3.12.0\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
});
assert.equal(found.command, 'python', 'the resolver must take the first candidate that answers');
assert.equal(found.version, 'Python 3.12.0');
assert.deepEqual(probes, ['python3', 'python'], 'the resolver must stop at the first working interpreter');
assert.equal(
  resolvePythonInterpreter(INTERPRETER_CANDIDATES, () => ({ status: 1, stdout: '', stderr: '' })),
  null,
  'no interpreter must resolve to null, not to a guess',
);
assert.match(missingInterpreterMessage(), /python3, python, py -3/, 'the failure must name what was tried');

// Python 2 exits 0 for --version and prints to stderr, so "it answered" is not
// enough: selecting it would hand a Python 3 script to a Python 2 interpreter.
assert.equal(pythonMajorVersion('Python 3.13.15'), 3);
assert.equal(pythonMajorVersion('Python 2.7.18'), 2);
assert.equal(pythonMajorVersion(''), null);
assert.equal(pythonMajorVersion('not a python banner'), null);
const skipped = [];
const skippedPython2 = resolvePythonInterpreter(INTERPRETER_CANDIDATES, (command, args) => {
  skipped.push(command);
  if (command === 'python3') return { status: 1, stdout: '', stderr: '' };
  if (command === 'python') return { status: 0, stdout: '', stderr: 'Python 2.7.18\n' };
  return { status: 0, stdout: 'Python 3.11.9\n', stderr: '' };
});
assert.equal(skippedPython2.command, 'py', 'a Python 2 named python must be skipped, not selected');
assert.equal(skippedPython2.version, 'Python 3.11.9');
assert.deepEqual(skipped, ['python3', 'python', 'py']);
assert.equal(
  resolvePythonInterpreter(INTERPRETER_CANDIDATES, () => ({ status: 0, stdout: '', stderr: 'Python 2.7.18\n' })),
  null,
  'a machine with only Python 2 must resolve to null, not to Python 2',
);

// PATH is a convention, not a guarantee. A Windows box can carry three healthy
// Python 3 installs and export none of them, which is what took six gates down
// on 2026-09-05 with nothing wrong but the environment.
const fakeTree = new Set([
  'C:\\Program Files\\Python312',
  'C:\\Program Files\\Python312\\python.exe',
  'D:\\Apps\\Programs\\Python\\Python311',
  'D:\\Apps\\Programs\\Python\\Python311\\python.exe',
  'D:\\Apps\\Programs\\Python\\Python313',
  'D:\\Apps\\Programs\\Python\\Python313\\python.exe',
  'C:\\Windows\\py.exe',
]);
const fakeFs = {
  existsSync: target => fakeTree.has(target),
  readdirSync: dir => {
    const prefix = dir.endsWith('\\') ? dir : `${dir}\\`;
    const names = [...fakeTree]
      .filter(entry => entry.startsWith(prefix) && !entry.slice(prefix.length).includes('\\'))
      .map(entry => entry.slice(prefix.length));
    if (!names.length) throw new Error(`ENOENT: ${dir}`);
    return names;
  },
};
const discovered = installedCandidates({ LOCALAPPDATA: 'D:\\Apps' }, fakeFs).map(c => c.command);
assert.deepEqual(
  discovered,
  [
    'D:\\Apps\\Programs\\Python\\Python313\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'D:\\Apps\\Programs\\Python\\Python311\\python.exe',
    'C:\\Windows\\py.exe',
  ],
  'installs off PATH must be found, newest minor version first',
);
assert.deepEqual(
  installedCandidates({ LOCALAPPDATA: 'D:\\Apps' }, fakeFs).at(-1).args,
  ['-3'],
  'the Windows launcher must still be asked for Python 3',
);
assert.deepEqual(
  installedCandidates({}, { existsSync: () => false, readdirSync: () => { throw new Error('ENOENT'); } }),
  [],
  'a machine with no install on disk must discover nothing rather than guess',
);
assert.equal(pinnedCandidate({}), null);
assert.deepEqual(pinnedCandidate({ HURRICANEMAP_PYTHON: '  C:\\py\\python.exe  ' }), {
  command: 'C:\\py\\python.exe',
  args: [],
});
const searched = searchCandidates({ LOCALAPPDATA: 'D:\\Apps' }, fakeFs).map(c => c.command);
assert.deepEqual(searched.slice(0, 3), ['python3', 'python', 'py'], 'PATH names come before disk discovery');
assert.ok(searched.includes('C:\\Program Files\\Python312\\python.exe'), 'disk discovery must still be probed');
assert.match(
  missingInterpreterMessage(searchCandidates({ LOCALAPPDATA: 'D:\\Apps' }, fakeFs)),
  /Python313\\python\.exe/,
  'the failure must name every location that was tried, not just the PATH names',
);

// A pin is honoured or it fails. Falling back to some other interpreter runs the
// gates under one the operator explicitly did not choose, and says nothing.
const answersPython3 = () => ({ status: 0, stdout: 'Python 3.13.15\n', stderr: '' });
const pinProbed = [];
const badPin = selectInterpreter({ HURRICANEMAP_PYTHON: 'C:\\nope\\python.exe', LOCALAPPDATA: 'D:\\Apps' }, fakeFs, cmd => {
  pinProbed.push(cmd);
  return cmd === 'C:\\nope\\python.exe' ? { status: null, error: { code: 'ENOENT' } } : answersPython3();
});
assert.equal(badPin.interpreter, undefined, 'a broken pin must not fall through to another interpreter');
assert.match(badPin.error, /HURRICANEMAP_PYTHON is set to C:\\nope\\python\.exe/);
assert.deepEqual(pinProbed, ['C:\\nope\\python.exe'], 'a pin must be the only thing probed');
assert.equal(
  selectInterpreter({ HURRICANEMAP_PYTHON: 'C:\\py\\python.exe' }, fakeFs, answersPython3).interpreter.command,
  'C:\\py\\python.exe',
  'a working pin must be used',
);
assert.equal(
  selectInterpreter({ LOCALAPPDATA: 'D:\\Apps' }, fakeFs, (cmd => (cmd === 'python3' ? answersPython3() : { status: 1 }))).interpreter.command,
  'python3',
  'with no pin the search runs normally',
);
assert.match(
  selectInterpreter({}, { existsSync: () => false, readdirSync: () => { throw new Error('x'); } }, () => ({ status: 1 })).error,
  /No Python 3 interpreter found/,
);
assert.match(missingInterpreterMessage(), /set HURRICANEMAP_PYTHON/, 'the failure must name the way out');

// Probing an interpreter and running it are two separate spawns. The second one
// can fail on its own, and exiting 1 with no output makes every cause look the
// same to whoever is reading the gate log.
const py313 = { command: 'C:\\py\\python.exe', args: [] };
assert.match(
  describeRunFailure({ status: null, error: { code: 'ENOENT', message: 'spawn ENOENT' } }, py313),
  /Could not run C:\\py\\python\.exe: ENOENT/,
);
assert.match(
  describeRunFailure({ status: null, error: { code: 'EINVAL', message: 'spawn EINVAL' } }, { command: 'py', args: ['-3'] }),
  /Could not run py -3: EINVAL/,
  'the launcher arguments belong in the message: `py` alone is not what ran',
);
assert.match(describeRunFailure({ status: null, signal: 'SIGKILL' }, py313), /killed by SIGKILL/);
assert.match(describeRunFailure({ status: null }, py313), /exited without a status/);
assert.equal(describeRunFailure({ status: 0 }, py313), '', 'a clean run explains nothing');
assert.equal(describeRunFailure({ status: 1 }, py313), '', 'a Python test that simply failed is already legible');
assert.equal(describeRunFailure(undefined, py313), '');

console.log(
  `release gate runner ok (${GATE_SCRIPTS.length} gates claimed, ${NON_GATE_SCRIPTS.length} excluded, `
  + `failure modes named, ${pythonGates.length} Python gates resolved portably)`,
);
