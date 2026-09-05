// Runs a Python gate with whatever interpreter this machine actually has.
//
// The npm scripts called bare `python`, which does not exist on distributions
// that ship only `python3`, so six gates died with a shell "not recognized"
// message that names nothing useful and looks like a broken repo rather than a
// missing interpreter.
//
//   node scripts/python.mjs scripts/test-geodesy-python.py [args...]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// python3 first: on POSIX it is the one guaranteed to be Python 3, while bare
// `python` may be absent or, on older systems, Python 2. `py -3` is the Windows
// launcher, which is present even when neither name is on PATH.
export const INTERPRETER_CANDIDATES = Object.freeze([
  { command: 'python3', args: [] },
  { command: 'python', args: [] },
  { command: 'py', args: ['-3'] },
]);

/** The first candidate that answers `--version`, or null when none do. */
export function resolvePythonInterpreter(candidates = INTERPRETER_CANDIDATES, run = spawnSync) {
  for (const candidate of candidates) {
    const probe = run(candidate.command, [...candidate.args, '--version'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (probe.status === 0) {
      return { ...candidate, version: `${probe.stdout || ''}${probe.stderr || ''}`.trim() };
    }
  }
  return null;
}

export function missingInterpreterMessage() {
  const names = INTERPRETER_CANDIDATES.map(candidate => [candidate.command, ...candidate.args].join(' '));
  return `No Python 3 interpreter found. Tried: ${names.join(', ')}. Install Python 3 or put it on PATH.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = process.argv[2];
  if (!script) {
    console.error('usage: node scripts/python.mjs <script.py> [args...]');
    process.exit(2);
  }
  const interpreter = resolvePythonInterpreter();
  if (!interpreter) {
    console.error(missingInterpreterMessage());
    process.exit(127);
  }
  const result = spawnSync(interpreter.command, [...interpreter.args, script, ...process.argv.slice(3)], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(result.status ?? 1);
}
