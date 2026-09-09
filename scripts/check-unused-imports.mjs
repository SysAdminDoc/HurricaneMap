// An import nothing uses.
//
// This is how a deletion goes half-finished. Removing the one function that
// called clearTropicalOutlook and clearMarineWarnings left both names imported
// into src/active.js and referenced nowhere, and nothing noticed: the dead
// export check counts a name as live if any other file so much as spells it,
// and an orphaned import spells it. The two exports stayed alive because of an
// import that existed only to keep them alive.
//
// This is not about tidiness. sw.js builds its precache by walking import
// specifiers, so the module graph is a list of what every reader downloads, and
// a specifier held open by a dead binding is a file fetched for nothing.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseModule, walk } from './js-ast.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

/**
 * Names this module imports and never mentions again.
 *
 * A name counts as used if it is referenced anywhere outside the import that
 * bound it. That is deliberately generous: the only question here is whether
 * the binding is read at all, and generosity is what keeps a check about dead
 * code from reporting live code. Two Identifier positions are not references
 * and are excluded, because both would make every name look used: the key of a
 * non-shorthand property, and the member of a non-computed member expression.
 */
export function findUnusedImports(source) {
  const tree = parseModule(source);

  const bound = new Map();
  // The Identifier nodes inside the import statement itself. Skipping the
  // ImportDeclaration in the walk below is not enough, because the walk still
  // descends into it, and then every name looks used by its own import.
  const notAReference = new Set();
  for (const node of tree.body) {
    if (node.type !== 'ImportDeclaration') continue;
    for (const specifier of node.specifiers) {
      if (specifier.local?.name) bound.set(specifier.local.name, node.source.value);
      if (specifier.local) notAReference.add(specifier.local);
      if (specifier.imported) notAReference.add(specifier.imported);
    }
  }
  if (!bound.size) return [];

  walk(tree, node => {
    if (node.type === 'Property' && !node.computed && !node.shorthand && node.key?.type === 'Identifier') {
      notAReference.add(node.key);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
      notAReference.add(node.property);
    }
  });

  const referenced = new Set();
  walk(tree, node => {
    if (node.type === 'Identifier' && !notAReference.has(node)) referenced.add(node.name);
    // `export { name }` reads the binding without an Identifier this walk
    // would otherwise treat as a reference.
    if (node.type === 'ExportSpecifier' && node.local?.name) referenced.add(node.local.name);
  });

  return [...bound]
    .filter(([name]) => !referenced.has(name))
    .map(([name, specifier]) => ({ name, specifier }));
}

async function main() {
  // Recursive, because src/locales/ is three modules this used to skip: it
  // reported 110 where the dead-export check reports 113.
  const files = (await readdir(srcDir, { recursive: true }))
    .map(file => String(file).split(path.sep).join('/'))
    .filter(file => file.endsWith('.js'));
  const offenders = [];
  let scanned = 0;

  for (const file of files) {
    const source = await readFile(path.join(srcDir, file), 'utf8');
    scanned += 1;
    for (const { name, specifier } of findUnusedImports(source)) {
      offenders.push(`src/${file}: imports ${name} from ${specifier} and never uses it`);
    }
  }

  if (offenders.length) {
    for (const offender of offenders) console.error(`unused import: ${offender}`);
    process.exit(1);
  }
  console.log(`unused imports ok (${scanned} modules, every imported name is referenced)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
