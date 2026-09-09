// An export nobody imports is a promise to a caller that does not exist.
//
// It is not merely clutter. src/sst.js kept a pair of exported setters that no
// registry consulted any more, so they could drift from the contract they
// looked like they still served, and nothing would fail. The same shape hides
// which functions actually matter when someone reads the module.
//
// "Consumer" used to mean "some other file spells this word", which is a much
// weaker question than it looks. An adversarial review added a genuinely dead
// export to src/geodesy.js one name at a time: reset, render, update,
// formatDate, toRadians, normalize and state all passed, because those words
// occur in comments, in strings, as unrelated locals and as property names all
// over a codebase this size. Only an invented word like zzzTotallyUnusedThing
// was caught. So the question is now the right one: does an import statement
// somewhere actually bind this name.
//
// Anything used only inside its own file is reported separately, because
// dropping `export` there is a smaller, safer change than deleting the code.
//
// What this still cannot see, measured rather than guessed: 53 of the 113
// modules are consumed through an import whose result cannot be followed
// statically, and every export of those 53 is therefore taken on trust. Two
// causes, and only one of them is fixable here. src/main.js lazy-loads a panel
// as `(await Promise.all([import('./panel.js'), ensureOptionalData()]))[0]`,
// where the namespace goes through an array and no analysis short of running
// the code recovers it. The rest is this file having no scope analysis: a
// namespace bound as `const data = await import('/src/data.js')` is widened to
// the whole module as soon as some other function in the same file has its own
// `data`, which in a 5000-line smoke suite is often. Widening is the safe
// direction, since it can only ever call an export live and never dead, and
// ROADMAP.md carries the scope-aware version.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  lineAt,
  nonReferenceIdentifiers,
  parseModule,
  patternNames,
  POSITION_KEYS,
  referencesModuleBinding,
  scopeBinds,
  walk,
} from './js-ast.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src');

// Modules outside src/, scripts/ and tests/ that import from it. index.html and
// globe.html reach src/ through inline module scripts, which are parsed the
// same way; serve.py is a static file server and cannot import a name, so it is
// no longer consulted about one.
const EXTRA_MODULES = ['sw.js', 'cloudflare/worker.js'];
const HTML_ENTRY_POINTS = ['index.html', 'globe.html'];

// Modules whose namespace cannot be followed to specific names, so every export
// they have is taken on trust. This is a declaration, not a measurement: a
// module that becomes unfollowable has to be added here deliberately, and one
// that stops being unfollowable has to be removed, or the check fails. Without
// that, the exempt set grows quietly and the number in the success line is the
// only thing that ever notices.
//
// Every one of them is src/main.js's lazy-loader registry: `load: { stats:
// loadStats, ... }` is handed to wireApplicationShell and the loaders are
// called from inside it as `load.stats()`. Following that means tracking a
// function through an object literal into another module's parameter, which is
// a different kind of analysis from this one.
const NAMESPACE_ONLY = new Set([
  'src/diagnostics.js',
  'src/evac.js',
  'src/export.js',
  'src/globe3d.js',
  'src/on-this-date.js',
  'src/optional-feeds.js',
  'src/poster.js',
  'src/prep.js',
  'src/qgis.js',
  'src/report.js',
  'src/sst.js',
  'src/stats.js',
  'src/table-view.js',
]);

// Names an export can carry for a reason other than a caller.
const KEEP = new Map([
  ['src/i18n.js:default', 'the English catalog is the module default'],
  ['src/locales/en.js:default', 'a locale catalog is imported as a default'],
  ['src/locales/es.js:default', 'a locale catalog is imported as a default'],
  ['src/locales/ht.js:default', 'a locale catalog is imported as a default'],
]);

/**
 * Every name a module exports.
 *
 * The regex version could not see two forms at all, so their exports were not
 * even counted: `export function*`, because it looked for a space after
 * `function`, and `export const { a, b } = ...`, because it looked for a single
 * identifier.
 */
export function findExports(source) {
  const tree = parseModule(source);
  const names = [];
  const push = (name, offset) => {
    if (name && !names.some(entry => entry.name === name)) {
      names.push({ name, line: lineAt(source, offset) });
    }
  };

  for (const node of tree.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      push('default', node.start);
      continue;
    }
    if (node.type === 'ExportAllDeclaration') {
      if (node.exported?.name) push(node.exported.name, node.start);
      continue;
    }
    if (node.type !== 'ExportNamedDeclaration') continue;
    for (const specifier of node.specifiers || []) {
      const name = specifier.exported?.name ?? specifier.exported?.value;
      push(name, node.start);
    }
    const declaration = node.declaration;
    if (!declaration) continue;
    if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
      push(declaration.id?.name, node.start);
      continue;
    }
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        for (const name of patternNames(declarator.id)) push(name, node.start);
      }
    }
  }
  return names;
}

/**
 * What one module imports, as module path to the set of names it binds there.
 * '*' means the whole module: a namespace import, or a dynamic import whose
 * result this does not try to follow. That direction is the safe one, since it
 * can only ever call an export live, never dead.
 */
export function findImports(source, fromFile) {
  const tree = parseModule(source);
  const imports = new Map();
  const add = (specifier, name) => {
    if (typeof specifier !== 'string') return;
    // The site root is the repository root, so a browser-absolute specifier is
    // as real a consumer as a relative one. The smoke suite reaches modules
    // that way from inside page.evaluate, where there is no file to be relative
    // to: `await import('/src/nhc-proxy.js')`.
    // A browser accepts a cache-busting suffix and this repository might one
    // day write one, at which point a used export would be called dead and the
    // build would fail on correct code.
    const bare = specifier.split('?')[0].split('#')[0];
    const resolved = bare.startsWith('/')
      ? bare.slice(1)
      : bare.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), bare))
        : null;
    if (!resolved) return;
    // An extensionless specifier names the same module; credit both spellings
    // rather than neither.
    if (!/\.[a-z]+$/i.test(resolved)) {
      addResolved(`${resolved}.js`, name);
      addResolved(`${resolved}/index.js`, name);
    }
    addResolved(resolved, name);
  };
  function addResolved(resolved, name) {
    if (!imports.has(resolved)) imports.set(resolved, new Set());
    imports.get(resolved).add(name);
  }

  // A binding that holds a whole module namespace, the specifier it came from,
  // and the scope it lives in. Reading one member off it consumes that name and
  // nothing else, which is the difference between this and the first draft:
  // main.js lazy-loads with dynamic import(), and treating the module as
  // consumed wholesale exempted 55 of 113 modules from the check entirely.
  //
  // The scope matters as much as the member reads. Without it, `const data =
  // await import('/src/data.js')` inside one arrow function widened to the
  // whole module because a different function in the same file bound its own
  // `data`, and in a five-thousand-line smoke suite that is most of them.
  const namespaces = [];
  const declareNamespace = (name, specifier, scope) => {
    if (name && specifier && scope) namespaces.push({ name, specifier, scope });
  };

  // The block a declaration belongs to, so a namespace is resolved where it
  // exists rather than across the whole file. Loop heads and switch bodies are
  // scopes as much as a block is, and attributing a declaration in one of them
  // to the block outside resolves it against code it cannot see.
  const SCOPE_NODES = new Set([
    'Program',
    'BlockStatement',
    'StaticBlock',
    'SwitchStatement',
    'ForStatement',
    'ForOfStatement',
    'ForInStatement',
  ]);
  const blockOf = new Map();
  const trackBlocks = (node, block) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) trackBlocks(child, block);
      return;
    }
    if (typeof node.type !== 'string') return;
    const next = SCOPE_NODES.has(node.type) ? node : block;
    if (node.type === 'VariableDeclarator') blockOf.set(node, next);
    for (const key of Object.keys(node)) {
      if (POSITION_KEYS.has(key)) continue;
      trackBlocks(node[key], next);
    }
  };
  trackBlocks(tree, tree);

  for (const node of tree.body) {
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') add(node.source.value, 'default');
        else if (specifier.type === 'ImportNamespaceSpecifier') declareNamespace(specifier.local.name, node.source.value, tree);
        else add(node.source.value, specifier.imported?.name ?? specifier.imported?.value);
      }
      continue;
    }
    // `export { a } from './x.js'` and `export * from './x.js'` consume too.
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const specifier of node.specifiers) {
        add(node.source.value, specifier.local?.name ?? specifier.local?.value);
      }
      continue;
    }
    if (node.type === 'ExportAllDeclaration' && node.source) add(node.source.value, '*');
  }

  // The shapes a dynamic import is actually written in here. Anything else
  // falls through to '*', which can only call an export live, never dead.
  // A lazy loader: `const loadPanel = once(() => import('./panel.js'))`, called
  // later as `const { showStorm } = await loadPanel()`. src/main.js reaches most
  // of the application this way, so without following it two thirds of src/ was
  // exempt from this check. Two shapes appear: the import returned directly, and
  // the import taken as the first element of a Promise.all that also warms some
  // data.
  const isPromiseAll = call => call?.type === 'CallExpression'
    && call.callee?.type === 'MemberExpression'
    && call.callee.object?.name === 'Promise'
    && call.callee.property?.name === 'all';

  const importInside = expression => {
    if (!expression || typeof expression.type !== 'string') return null;
    if (expression.type === 'AwaitExpression') return importInside(expression.argument);
    if (expression.type === 'ImportExpression') {
      return expression.source?.type === 'Literal' ? expression : null;
    }
    // (await Promise.all([import('./panel.js'), ensureOptionalData()]))[0]
    if (expression.type === 'MemberExpression' && expression.computed
      && typeof expression.property?.value === 'number') {
      const call = expression.object?.type === 'AwaitExpression'
        ? expression.object.argument
        : expression.object;
      if (!isPromiseAll(call)) return null;
      const elements = call.arguments[0]?.elements;
      return importInside(elements?.[expression.property.value]);
    }
    return null;
  };

  const returnedExpression = fn => {
    if (fn?.type !== 'ArrowFunctionExpression' && fn?.type !== 'FunctionExpression') return null;
    if (fn.body?.type !== 'BlockStatement') return fn.body;
    let returned = null;
    walk(fn.body, inner => {
      if (returned || inner.type !== 'ReturnStatement') return;
      returned = inner.argument;
    });
    return returned;
  };

  const loaderFn = value => {
    let fn = value;
    // once(fn), memoize(fn) and anything else that wraps the loader in a single
    // call and hands back a function of the same shape.
    if (fn?.type === 'CallExpression' && fn.arguments.length === 1) fn = fn.arguments[0];
    return importInside(returnedExpression(fn));
  };

  // Name to the modules calling it reaches. Usually one. A table of loaders
  // read with a computed key reaches every module in the table, and whatever
  // the caller then does with the result is done to all of them, which is
  // exactly right: src/i18n.js writes `LOCALE_LOADERS[locale]().then(module =>
  // module.default)`, and `default` is consumed from both catalogs whichever
  // one the key selects.
  const loaders = new Map();
  for (const node of tree.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const declarator of node.declarations) {
      if (declarator.id?.type !== 'Identifier') continue;
      const single = loaderFn(declarator.init);
      if (single) {
        loaders.set(declarator.id.name, [single]);
        continue;
      }
      if (declarator.init?.type !== 'ObjectExpression') continue;
      const table = [];
      for (const property of declarator.init.properties) {
        if (property.type === 'SpreadElement') continue;
        const imported = loaderFn(property.value);
        if (imported) table.push(imported);
      }
      if (table.length) loaders.set(declarator.id.name, table);
    }
  }

  // Return the import expression itself, not its specifier. The sweep below
  // marks anything it did not follow as consuming the whole module, and it
  // looks for the ImportExpression node: claiming the AwaitExpression wrapped
  // around it left every `await import(...)` unclaimed, so every module reached
  // that way was exempted no matter how carefully the binding was resolved.
  const dynamic = node => {
    if (node?.type === 'AwaitExpression') return dynamic(node.argument);
    if (node?.type === 'ChainExpression') return dynamic(node.expression);
    // Calling a loader is reaching for its module, so the three shapes below
    // read it exactly as they read a bare import().
    if (node?.type === 'CallExpression') {
      if (node.callee?.type === 'Identifier' && loaders.has(node.callee.name)) {
        return loaders.get(node.callee.name);
      }
      // LOCALE_LOADERS[locale]()
      if (node.callee?.type === 'MemberExpression'
        && node.callee.object?.type === 'Identifier'
        && loaders.has(node.callee.object.name)) {
        return loaders.get(node.callee.object.name);
      }
    }
    if (node?.type === 'ImportExpression' && node.source?.type === 'Literal') return [node];
    return null;
  };
  const claimed = new Set();

  walk(tree, node => {
    // const { showStats } = await import('./stats.js')
    if (node.type === 'VariableDeclarator') {
      const imports = dynamic(node.init);
      if (!imports) return;
      for (const imported of imports) {
        claimed.add(imported);
        const target = imported.source.value;
        if (node.id.type === 'ObjectPattern') {
          for (const property of node.id.properties) {
            if (property.type === 'RestElement') { add(target, '*'); continue; }
            const key = property.computed ? null : (property.key?.name ?? property.key?.value);
            add(target, key || '*');
          }
          continue;
        }
        if (node.id.type === 'Identifier') {
          declareNamespace(node.id.name, target, blockOf.get(node) || tree);
          continue;
        }
        add(target, '*');
      }
      return;
    }
    // (await import('./stats.js')).showStats
    if (node.type === 'MemberExpression' && !node.computed) {
      const imports = dynamic(node.object);
      if (!imports) return;
      for (const imported of imports) {
        claimed.add(imported);
        const target = imported.source.value;
        if (node.property?.type === 'Identifier') add(target, node.property.name);
        else add(target, '*');
      }
      return;
    }
    // `let mapModule = null; ... mapModule ||= await import('./map.js')`, read
    // later as `mapModule?.getMap?.()`. The declaration carries no import, so
    // the assignment is where the binding learns what it holds.
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') {
      const imports = dynamic(node.right);
      if (imports) {
        for (const imported of imports) {
          claimed.add(imported);
          declareNamespace(node.left.name, imported.source.value, tree);
        }
        return;
      }
    }
    // import('./stats.js').then(module => module.showStats()), and the same
    // through a loader: loadKeyboard().then(({ init }) => init(...)). Asking
    // dynamic() rather than matching an ImportExpression is what makes the
    // second one work; without it, src/main.js reached keyboard.js and state.js
    // only this way and both modules' exports were reported dead.
    if (node.type === 'CallExpression'
      && node.callee?.type === 'MemberExpression'
      && !node.callee.computed
      && node.callee.property?.name === 'then'
      && dynamic(node.callee.object)) {
      const handler = node.arguments[0];
      const parameter = handler?.params?.[0];
      for (const imported of dynamic(node.callee.object)) {
        const target = imported.source.value;
        claimed.add(imported);
        if (parameter?.type === 'Identifier') declareNamespace(parameter.name, target, handler);
        else if (parameter?.type === 'ObjectPattern') {
          for (const property of parameter.properties) {
            const key = property.type === 'RestElement' || property.computed
              ? null
              : (property.key?.name ?? property.key?.value);
            add(target, key || '*');
          }
        } else add(target, '*');
      }
    }
  });

  // Whatever is left is a dynamic import this does not follow.
  walk(tree, node => {
    if (node.type !== 'ImportExpression' || claimed.has(node)) return;
    if (node.source?.type === 'Literal') add(node.source.value, '*');
  });

  // Resolve each namespace inside the scope that declared it, stopping at any
  // inner scope that binds the same name, because that is a different variable.
  const notAReference = nonReferenceIdentifiers(tree);
  for (const binding of namespaces) {
    let widened = false;
    const visit = (node, shadowed) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child, shadowed);
        return;
      }
      if (typeof node.type !== 'string') return;

      // `ns.name` consumes that one export and nothing else.
      if (!shadowed
        && node.type === 'MemberExpression'
        && !node.computed
        && node.object?.type === 'Identifier'
        && node.object.name === binding.name) {
        if (node.property?.type === 'Identifier') add(binding.specifier, node.property.name);
        else widened = true;
        return;
      }

      // Any other read of it could reach anything in the module.
      if (!shadowed
        && node.type === 'Identifier'
        && node.name === binding.name
        && !notAReference.has(node)) {
        widened = true;
        return;
      }

      const inner = shadowed || scopeBinds(node, binding.name);
      for (const key of Object.keys(node)) {
        if (POSITION_KEYS.has(key)) continue;
        visit(node[key], inner);
      }
    };
    // Descend into the declaring scope rather than visiting it, because that
    // scope is the one that binds this very name: testing it for a shadow
    // would suppress the whole subtree on the first step and report every
    // export of the module dead.
    for (const key of Object.keys(binding.scope)) {
      if (POSITION_KEYS.has(key)) continue;
      visit(binding.scope[key], false);
    }
    if (widened) add(binding.specifier, '*');
  }

  return imports;
}

/** The bodies of a page's inline module scripts. */
function htmlScripts(html) {
  const inline = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    if (/\ssrc\s*=\s*["']/i.test(attributes)) continue;
    if (/\stype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attributes)) continue;
    inline.push(match[2]);
  }
  return inline;
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

  // Every file that could import a name, keyed by its repo-relative path so a
  // relative specifier resolves against it.
  const importers = new Map([...modules]);
  for (const name of ['scripts', 'tests']) {
    const dir = path.join(root, name);
    for (const file of await readdir(dir, { recursive: true })) {
      if (!/\.(?:js|mjs)$/.test(String(file))) continue;
      importers.set(
        `${name}/${String(file).replace(/\\/g, '/')}`,
        await readFile(path.join(dir, String(file)), 'utf8'),
      );
    }
  }
  for (const file of EXTRA_MODULES) {
    const body = await readFile(path.join(root, file), 'utf8').catch(() => null);
    if (body !== null) importers.set(file, body);
  }
  for (const file of HTML_ENTRY_POINTS) {
    const html = await readFile(path.join(root, file), 'utf8').catch(() => null);
    if (html === null) continue;
    // Only the inline module scripts. A page that loads a module with src=
    // makes it an entry point, and an entry point's own exports are held to
    // exactly the same rule as any other module's, so there is nothing to
    // credit: src/main.js exports nothing at all. An earlier version built a
    // synthetic importer here that filtered for './' and so matched neither
    // entry point, and would have credited nothing even if it had, since a
    // side-effect import names no specifiers. It read as protection and was
    // not any.
    for (const [index, body] of htmlScripts(html).entries()) {
      importers.set(`${file}#script-${index}`, body);
    }
  }

  // name -> the set of modules that bind it, and the modules imported wholesale.
  const importedNames = new Map();
  const wholeModules = new Set();
  const unparsed = [];
  for (const [file, source] of importers) {
    const owner = file.includes('#') ? file.slice(0, file.indexOf('#')) : file;
    let found;
    try {
      found = findImports(source, owner);
    } catch (error) {
      unparsed.push(`${file}: ${String(error?.message || error).slice(0, 120)}`);
      continue;
    }
    for (const [target, names] of found) {
      for (const name of names) {
        if (name === '*') {
          wholeModules.add(target);
          continue;
        }
        if (!importedNames.has(name)) importedNames.set(name, new Set());
        importedNames.get(name).add({ from: owner, target });
      }
    }
  }

  const dead = [];
  const internalOnly = [];
  let exportCount = 0;
  for (const [file, source] of modules) {
    let exports;
    try {
      exports = findExports(source);
    } catch (error) {
      unparsed.push(`${file}: ${String(error?.message || error).slice(0, 120)}`);
      continue;
    }
    exportCount += exports.length;
    for (const { name, line } of exports) {
      if (KEEP.has(`${file}:${name}`)) continue;
      const target = file.replace(/\.js$/, '.js');
      if (wholeModules.has(target)) continue;
      const bindings = importedNames.get(name);
      const external = bindings && [...bindings].some(entry => entry.target === target && entry.from !== file);
      if (external) continue;

      // Used inside its own file, or used nowhere at all. Scope aware, because
      // asking only whether the name appears is the same word match this file
      // set out to remove: a module exporting `state` with an unrelated
      // `let state` in some other function looked like it used the export, and
      // the finding was demoted from a failure to a line in the success text.
      const usedInternally = usesNameOutsideItsExport(source, name);
      (usedInternally ? internalOnly : dead).push({ file, line, name });
    }
  }

  // The exempt set has to be exactly what the file declares.
  const exemptNow = [...wholeModules].filter(target => modules.has(target)).sort();
  const undeclared = exemptNow.filter(target => !NAMESPACE_ONLY.has(target));
  const stale = [...NAMESPACE_ONLY].filter(target => !exemptNow.includes(target)).sort();

  if (unparsed.length) {
    for (const problem of unparsed) console.error(`dead exports: could not parse ${problem}`);
    process.exit(1);
  }

  if (dead.length) {
    for (const entry of dead) {
      console.error(`dead exports: ${entry.file}:${entry.line} exports ${entry.name}, which nothing imports and nothing in the module uses`);
    }
    console.error(`dead exports: ${dead.length} export${dead.length === 1 ? '' : 's'} with no consumer anywhere; delete them`);
    process.exit(1);
  }

  if (undeclared.length || stale.length) {
    for (const target of undeclared) {
      console.error(
        `dead exports: ${target} is imported in a way this check cannot follow to specific names, so every `
        + 'export it has is now unchecked. Add it to NAMESPACE_ONLY with the reason, or import it in a way '
        + 'that can be followed.',
      );
    }
    for (const target of stale) {
      console.error(
        `dead exports: ${target} is listed in NAMESPACE_ONLY but its namespace is now followed. Remove it, `
        + 'or the exemption outlives the reason for it.',
      );
    }
    process.exit(1);
  }

  console.log(
    `dead exports ok (${modules.size} modules, ${exportCount} exports, none unimported; `
    + `${internalOnly.length} used only inside their own module; `
    + `${exemptNow.length} whose namespace cannot be followed, all declared)`,
  );
}

/**
 * Whether the module refers to the name somewhere other than the declaration
 * that exports it. A function calling itself does not make it live, and neither
 * does the export statement naming it.
 */
export function usesNameOutsideItsExport(source, name) {
  const tree = parseModule(source);
  const declared = new Set();

  for (const node of tree.body) {
    if (node.type === 'ExportNamedDeclaration') {
      for (const specifier of node.specifiers || []) {
        if (specifier.local) declared.add(specifier.local);
        if (specifier.exported) declared.add(specifier.exported);
      }
    }
    const declaration = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
      ? node.declaration
      : null;
    if (!declaration) continue;
    if (declaration.id) declared.add(declaration.id);
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        walk(declarator.id, inner => { if (inner.type === 'Identifier') declared.add(inner); });
      }
    }
  }

  return referencesModuleBinding(tree, name, declared);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
