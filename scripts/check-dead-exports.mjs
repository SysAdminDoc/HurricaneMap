// An export nobody imports is a promise to a caller that does not exist.
//
// It is not merely clutter. src/sst.js kept a pair of exported setters that no
// registry consulted any more, so they could drift from the contract they
// looked like they still served, and nothing would fail. The same shape hides
// which functions actually matter when someone reads the module.
//
// "Consumer" means: named in an import from another module, reached through a
// dynamic import, or spelled in one of the HTML entry points, the service
// worker, or the worker under cloudflare/. Anything used only inside its own
// file is reported separately, because dropping `export` there is a smaller,
// safer change than deleting the function.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankCommentsAndRegexes } from './js-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src');

// Files that may reach into src/ without an import statement this can see.
const EXTRA_CONSUMERS = ['sw.js', 'index.html', 'globe.html', 'cloudflare/worker.js', 'serve.py'];

// Names an export can carry for a reason other than a caller.
const KEEP = new Map([
  ['src/i18n.js:default', 'the English catalog is the module default'],
  ['src/locales/en.js:default', 'a locale catalog is imported as a default'],
  ['src/locales/es.js:default', 'a locale catalog is imported as a default'],
  ['src/locales/ht.js:default', 'a locale catalog is imported as a default'],
]);

export function findExports(source) {
  const text = blankCommentsAndRegexes(source);
  const names = [];
  const push = (name, index) => {
    if (name && !names.some(entry => entry.name === name)) {
      names.push({ name, line: source.slice(0, index).split(/\r?\n/).length });
    }
  };
  for (const match of text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) push(match[1], match.index);
  for (const match of text.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) push(match[1], match.index);
  for (const match of text.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) push(match[1], match.index);
  for (const match of text.matchAll(/^export\s+default\b/gm)) push('default', match.index);
  // `export { a, b as c }` re-exports what another module already named.
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      push(name, match.index);
    }
  }
  return names;
}

// Every place a name could be referenced, with its own module's text excluded
// so a function calling itself does not count as a consumer.
function referencedIn(name, texts) {
  const pattern = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`);
  return texts.some(text => pattern.test(text));
}

async function readAll(dir, results = new Map(), prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await readAll(path.join(dir, entry.name), results, relative);
      continue;
    }
    if (!/\.(?:js|mjs)$/.test(entry.name)) continue;
    results.set(`src/${relative}`, await readFile(path.join(dir, entry.name), 'utf8'));
  }
  return results;
}

async function main() {
  const modules = await readAll(sourceDir);
  const outside = new Map();
  for (const name of ['scripts', 'tests']) {
    const dir = path.join(root, name);
    for (const file of await readdir(dir, { recursive: true })) {
      if (!/\.(?:js|mjs)$/.test(String(file))) continue;
      const full = path.join(dir, String(file));
      outside.set(`${name}/${file}`, await readFile(full, 'utf8'));
    }
  }
  for (const file of EXTRA_CONSUMERS) {
    const body = await readFile(path.join(root, file), 'utf8').catch(() => null);
    if (body !== null) outside.set(file, body);
  }

  const dead = [];
  const internalOnly = [];
  for (const [file, source] of modules) {
    for (const { name, line } of findExports(source)) {
      if (KEEP.has(`${file}:${name}`)) continue;
      const elsewhere = [...modules.entries()].filter(([other]) => other !== file).map(([, text]) => text);
      const external = referencedIn(name, elsewhere) || referencedIn(name, [...outside.values()]);
      if (external) continue;
      // Used inside its own file, or used nowhere at all. Blank the module's
      // own export line before asking, or the declaration answers for itself.
      const withoutDeclaration = blankCommentsAndRegexes(source)
        .replace(new RegExp(`^export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+${name}\\b`, 'gm'), '')
        .replace(new RegExp(`^export\\s*\\{[^}]*\\}`, 'gm'), '');
      (referencedIn(name, [withoutDeclaration]) ? internalOnly : dead).push({ file, line, name });
    }
  }

  if (dead.length) {
    for (const entry of dead) {
      console.error(`dead exports: ${entry.file}:${entry.line} exports ${entry.name}, which nothing imports and nothing in the module uses`);
    }
    console.error(`dead exports: ${dead.length} export${dead.length === 1 ? '' : 's'} with no consumer anywhere; delete them`);
    process.exit(1);
  }

  console.log(
    `dead exports ok (${modules.size} modules, ${[...modules.values()].reduce((n, source) => n + findExports(source).length, 0)} exports, `
    + `none unreferenced; ${internalOnly.length} used only inside their own module)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
