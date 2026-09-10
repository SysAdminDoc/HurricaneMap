// Every custom property the stylesheets read has to be declared somewhere.
//
// `--surface2` was read in four rules and declared in none. CSS fails
// silently: an undeclared property inside color-mix() makes the whole
// `border` shorthand invalid, so the optional-feed diagnostics cards rendered
// with no border in every theme, and the high-contrast intensity grid line
// resolved to an empty string. Nothing was red, nothing was logged, and it
// stood for months.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styleDir = path.join(root, 'src');

// Properties supplied by a caller rather than declared in the sheets: a rule
// may legitimately read one that only an element-level style or a JS-set value
// provides. Each entry needs a reason, not just a name.
const EXTERNALLY_SUPPLIED = new Map([
  ['--radar-swatch', 'set inline per legend stop by src/radar.js'],
  ['--legend-color', 'set inline per category by src/timeline.js'],
]);

const declared = new Set(EXTERNALLY_SUPPLIED.keys());
const used = new Map();

const files = (await readdir(styleDir)).filter(name => name.endsWith('.css')).sort();
if (!files.length) {
  console.error('css variables: no stylesheets found in src/');
  process.exit(1);
}

for (const file of files) {
  const source = await readFile(path.join(styleDir, file), 'utf8');
  for (const match of source.matchAll(/(^|[;{\s])(--[\w-]+)\s*:/g)) declared.add(match[2]);
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!used.has(match[1])) used.set(match[1], []);
      used.get(match[1]).push(`${file}:${index + 1}`);
    }
  });
}

// A fallback (`var(--maybe, red)`) is a deliberate optional read, so it is not
// required to be declared. Strip those before comparing.
const optional = new Set();
for (const file of files) {
  const source = await readFile(path.join(styleDir, file), 'utf8');
  for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*,/g)) optional.add(match[1]);
}

// An alias, and the one way it comes apart from its target.
//
// A custom property is substituted at the element its declaration applies to,
// so `--a: var(--b)` freezes to whatever --b means in that selector. Declaring
// --b again in another theme block is harmless, because those are alternatives
// on the same element and the cascade picks one before either is substituted.
// Declaring --b again on a *descendant* is not: --a keeps the outer value
// inside that subtree, and the two silently disagree.
//
// --text-dim: var(--subtext) sat at :root while --subtext is also declared on
// html.light-theme:not(.high-contrast) .storm-panel, so the panel's own muted
// text kept the :root colour and read 3.47:1 beside a sibling at 4.43:1.
// Nothing caught it: both properties were declared, and both were read.
const ROOT_LEVEL = /^(?::root|html|body)(?:[.:#[][^\s>+~]*)*$/;
const isRootLevel = selector => selector
  .split(',')
  .map(part => part.replace(/\/\*[\s\S]*?\*\//g, '').trim())
  .filter(Boolean)
  .every(part => ROOT_LEVEL.test(part));

const declarationScopes = new Map();
const aliasSites = [];
for (const file of files) {
  const source = await readFile(path.join(styleDir, file), 'utf8');
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    if (!selector || selector.startsWith('@')) continue;
    for (const declaration of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const name = declaration[1];
      if (!declarationScopes.has(name)) declarationScopes.set(name, new Set());
      declarationScopes.get(name).add(selector);
      const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(declaration[2].trim());
      if (alias) {
        const line = source.slice(0, block.index + declaration.index).split('\n').length;
        aliasSites.push({ file, line, selector, name, target: alias[1] });
      }
    }
  }
}

const stale = [];
for (const site of aliasSites) {
  if (!isRootLevel(site.selector)) continue;
  const aliasScopes = declarationScopes.get(site.name) || new Set();
  const orphaned = [...(declarationScopes.get(site.target) || new Set())]
    .filter(selector => !isRootLevel(selector) && !aliasScopes.has(selector));
  if (orphaned.length) {
    stale.push(
      `${site.file}:${site.line} ${site.name}: var(${site.target}) is declared at the root, but `
      + `${site.target} is declared again on ${orphaned.map(selector => `\`${selector}\``).join(', ')}, `
      + `where ${site.name} keeps the root value`,
    );
  }
}
if (stale.length) {
  console.error(
    `css variables: ${stale.length} alias${stale.length === 1 ? ' that stops' : 'es that stop'} following their target inside a subtree.\n`
    + '  Declare the alias in the same scope, or read the target directly at the point of use.\n  '
    + stale.join('\n  '),
  );
  process.exit(1);
}

const undeclared = [...used.entries()]
  .filter(([name]) => !declared.has(name) && !optional.has(name))
  .map(([name, sites]) => `${name} (read at ${sites.slice(0, 4).join(', ')}${sites.length > 4 ? `, +${sites.length - 4} more` : ''})`);

if (undeclared.length) {
  console.error(`css variables: read but never declared:\n  ${undeclared.join('\n  ')}`);
  process.exit(1);
}

const unusedExternals = [...EXTERNALLY_SUPPLIED.keys()].filter(name => !used.has(name));
if (unusedExternals.length) {
  console.error(`css variables: the externally-supplied allowlist names properties nothing reads: ${unusedExternals.join(', ')}`);
  process.exit(1);
}

console.log(
  `css variables ok (${declared.size} declared, ${used.size} read across ${files.length} stylesheets, `
  + `${aliasSites.length} aliases and none of them left behind by a scoped override of its target)`,
);
