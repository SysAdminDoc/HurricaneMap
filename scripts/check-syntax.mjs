import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

const srcFiles = (await readdir(srcDir))
  .filter(name => name.endsWith('.js'))
  .map(name => path.join(srcDir, name))
  .sort();

const files = [...srcFiles, path.join(root, 'sw.js')];
const failures = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const result = spawnSync(
    process.execPath,
    ['--check', '--input-type=module'],
    { input: source, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    failures.push({
      file: path.relative(root, file),
      output: `${result.stderr || ''}${result.stdout || ''}`.trim(),
    });
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`Syntax check failed: ${failure.file}`);
    console.error(failure.output || '(no parser output)');
  }
  process.exit(1);
}

// A regex written through a tool that eats escapes lands a raw control byte
// where the escape should have been: `\b` becomes U+0008, and the pattern then
// matches nothing while still parsing cleanly. It cost two rounds of "the fix
// does not work" before instrumenting showed the subject was right and the
// pattern was unmatchable. Nothing here is meant to contain a raw control
// character, so the whole tree is checked rather than the file it happened in.
// Everything below space except tab, newline and carriage return, plus DEL.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const textDirectories = ['src', 'scripts', 'tests', 'cloudflare'];
const textExtensions = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md', '.py', '.txt']);
const controlOffenders = [];

for (const directory of [...textDirectories, '.']) {
  const absolute = path.join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
    const relative = path.relative(root, path.join(absolute, entry.name)).replaceAll('\\', '/');
    const source = await readFile(path.join(absolute, entry.name), 'utf8');
    const match = CONTROL.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split('\n').length;
    controlOffenders.push(`${relative}:${line} contains U+${match[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`);
  }
}

if (controlOffenders.length) {
  console.error('Raw control characters in source, almost certainly a mangled escape:');
  for (const offender of controlOffenders) console.error(`- ${offender}`);
  process.exit(1);
}

console.log(`syntax ok (${files.length} modules, no control characters in ${textDirectories.length + 1} source directories)`);
