// Runs a Python gate with whatever interpreter this machine actually has.
//
// The npm scripts called bare `python`, which does not exist on distributions
// that ship only `python3`, so six gates died with a shell "not recognized"
// message that names nothing useful and looks like a broken repo rather than a
// missing interpreter. PATH is also not reliable: on Windows a perfectly good
// Python 3 install can be absent from PATH entirely, so when no name resolves
// we look in the conventional install locations before giving up.
//
//   node scripts/python.mjs scripts/test-geodesy-python.py [args...]
//
// Set HURRICANEMAP_PYTHON to pin a specific interpreter.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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

// Where Windows installers actually put Python, and where POSIX package
// managers put it, for the case where none of the names above are on PATH.
const WINDOWS_INSTALL_ROOTS = Object.freeze(['C:\\', 'C:\\Program Files', 'C:\\Program Files (x86)']);
const POSIX_INTERPRETERS = Object.freeze([
  '/usr/local/bin/python3',
  '/usr/bin/python3',
  '/opt/homebrew/bin/python3',
]);

const defaultFs = { existsSync, readdirSync };

/**
 * Major version from a `python --version` banner, or null if it is not one.
 * Python 2 answers --version successfully and prints to stderr, so "it replied"
 * is not enough: a Python 2 named `python` would otherwise be selected and then
 * handed a Python 3 script.
 */
export function pythonMajorVersion(banner) {
  return Number(/^Python (\d+)\./.exec(String(banner || '').trim())?.[1]) || null;
}

/** An explicitly pinned interpreter, when one is set. */
export function pinnedCandidate(env = process.env) {
  const pinned = String(env.HURRICANEMAP_PYTHON || '').trim();
  return pinned ? { command: pinned, args: [] } : null;
}

function directoryEntries(fs, dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Interpreters found on disk, newest minor version first. PATH is a convention,
 * not a guarantee: this is what keeps the gates running on a machine where the
 * install is fine but nothing exported it.
 */
export function installedCandidates(env = process.env, fs = defaultFs) {
  const roots = [...WINDOWS_INSTALL_ROOTS];
  if (env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, 'Programs', 'Python'));

  const windows = [];
  for (const dir of roots) {
    for (const entry of directoryEntries(fs, dir)) {
      const minor = /^Python3(\d+)$/.exec(entry)?.[1];
      if (minor === undefined) continue;
      const exe = path.join(dir, entry, 'python.exe');
      if (fs.existsSync(exe)) windows.push({ command: exe, args: [], minor: Number(minor) });
    }
  }
  // Newest first, then by path so two installs of the same minor stay in a
  // stable order rather than whatever the directory listing happened to give.
  windows.sort((a, b) => b.minor - a.minor || a.command.localeCompare(b.command));

  const launcher = 'C:\\Windows\\py.exe';
  const extras = fs.existsSync(launcher) ? [{ command: launcher, args: ['-3'] }] : [];
  const posix = POSIX_INTERPRETERS.filter(exe => fs.existsSync(exe)).map(exe => ({ command: exe, args: [] }));

  return [...windows.map(({ minor, ...candidate }) => candidate), ...extras, ...posix];
}

/** Everything worth probing when nothing is pinned, in probe order. */
export function searchCandidates(env = process.env, fs = defaultFs) {
  return [...INTERPRETER_CANDIDATES, ...installedCandidates(env, fs)];
}

/** The first candidate that reports itself as Python 3, or null when none do. */
export function resolvePythonInterpreter(candidates = INTERPRETER_CANDIDATES, run = spawnSync) {
  for (const candidate of candidates) {
    const probe = run(candidate.command, [...candidate.args, '--version'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (probe.status !== 0) continue;
    const version = `${probe.stdout || ''}${probe.stderr || ''}`.trim();
    if (pythonMajorVersion(version) !== 3) continue;
    return { ...candidate, version };
  }
  return null;
}

export function missingInterpreterMessage(candidates = INTERPRETER_CANDIDATES) {
  const names = candidates.map(candidate => [candidate.command, ...candidate.args].join(' '));
  return `No Python 3 interpreter found. Tried: ${names.join(', ')}. `
    + 'Install Python 3, put it on PATH, or set HURRICANEMAP_PYTHON to its full path.';
}

/**
 * The interpreter to run, or the reason there is none.
 *
 * A pin is honoured or it fails. Falling back to a different interpreter when
 * HURRICANEMAP_PYTHON points at something broken is the one outcome nobody who
 * set it wants: it runs the gates under an interpreter they explicitly did not
 * choose, and says nothing.
 */
export function selectInterpreter(env = process.env, fs = defaultFs, run = spawnSync) {
  const pinned = pinnedCandidate(env);
  if (pinned) {
    const resolved = resolvePythonInterpreter([pinned], run);
    return resolved ? { interpreter: resolved } : {
      error: `HURRICANEMAP_PYTHON is set to ${pinned.command}, which did not answer as Python 3. `
        + 'Point it at a Python 3 executable or unset it to search PATH and the usual install locations.',
    };
  }
  const candidates = searchCandidates(env, fs);
  const resolved = resolvePythonInterpreter(candidates, run);
  return resolved ? { interpreter: resolved } : { error: missingInterpreterMessage(candidates) };
}

/**
 * Why a launched interpreter produced no exit status, or '' when it exited
 * normally. Probing succeeds and the run still fails when PATH changes between
 * the two, when the interpreter is a .cmd shim Node refuses to spawn, or when
 * something kills it: exiting 1 with no output turns all of those into the same
 * blank failure.
 */
export function describeRunFailure(result, interpreter) {
  if (!result || result.status !== null && result.status !== undefined) return '';
  const name = interpreter ? [interpreter.command, ...interpreter.args].join(' ') : 'the interpreter';
  if (result.error) return `Could not run ${name}: ${result.error.code || 'spawn failed'} (${result.error.message}).`;
  if (result.signal) return `${name} was killed by ${result.signal}.`;
  return `${name} exited without a status.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = process.argv[2];
  if (!script) {
    console.error('usage: node scripts/python.mjs <script.py> [args...]');
    process.exit(2);
  }
  const { interpreter, error } = selectInterpreter();
  if (error) {
    console.error(error);
    process.exit(127);
  }
  const result = spawnSync(interpreter.command, [...interpreter.args, script, ...process.argv.slice(3)], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  const failure = describeRunFailure(result, interpreter);
  if (failure) console.error(failure);
  process.exit(result.status ?? 1);
}
