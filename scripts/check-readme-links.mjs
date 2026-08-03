import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const links = [];
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

for (const match of readme.matchAll(markdownLink)) {
  let target = match[1].trim();
  if (target.startsWith('<')) target = target.slice(1, target.indexOf('>'));
  target = target.split(/[?#]/, 1)[0].trim();
  if (!target || target.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) continue;
  links.push(target);
}

const failures = [];
for (const target of new Set(links)) {
  const resolved = path.resolve(root, target.replaceAll('/', path.sep));
  const relative = path.relative(root, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    failures.push(`${target}: resolves outside the repository`);
    continue;
  }
  try {
    await stat(resolved);
  } catch {
    failures.push(`${target}: target does not exist`);
    continue;
  }
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relative], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    failures.push(`${target}: target is not tracked by git`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`README link check: ${failure}`);
  process.exit(1);
}
console.log(`README links ok (${new Set(links).size} relative targets tracked and present)`);
