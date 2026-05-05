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

console.log(`syntax ok (${files.length} modules)`);
