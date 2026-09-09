// Tree reading for the gates that cannot do their job by matching text.
//
// Three of them need it now: the injected-transport rule, which has to tell a
// parameter that binds a seam from a property that passes one on; the unused
// import check; and the dead export check, which was asking whether a name is
// spelled anywhere rather than whether anything imports it.
import { parse } from 'acorn';

export const POSITION_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);

export function parseModule(source) {
  return parse(String(source ?? ''), {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
  });
}

/** Every node in the tree, parents before children. */
export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (POSITION_KEYS.has(key)) continue;
    walk(node[key], visit);
  }
}

/** Every name a binding pattern introduces. */
export function patternNames(pattern, into = []) {
  if (!pattern || typeof pattern !== 'object') return into;
  switch (pattern.type) {
    case 'Identifier':
      into.push(pattern.name);
      return into;
    case 'AssignmentPattern':
      return patternNames(pattern.left, into);
    case 'RestElement':
      return patternNames(pattern.argument, into);
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        patternNames(property.type === 'RestElement' ? property.argument : property.value, into);
      }
      return into;
    case 'ArrayPattern':
      for (const element of pattern.elements) patternNames(element, into);
      return into;
    default:
      return into;
  }
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Names a statement introduces into the scope it sits in. */
function declaredBy(node, { includeVar }) {
  const names = [];
  if (!node || typeof node !== 'object') return names;
  if (node.type === 'VariableDeclaration') {
    if (node.kind === 'var' && !includeVar) return names;
    if (node.kind !== 'var' && includeVar) return names;
    for (const declarator of node.declarations) patternNames(declarator.id, names);
    return names;
  }
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id?.name) names.push(node.id.name);
    return names;
  }
  return names;
}

/**
 * Every `var` and function declaration in this function body, and not in the
 * bodies of functions nested inside it.
 *
 * This recurses by hand because `walk` visits and then descends regardless of
 * what the callback does: returning from the callback skips the rest of that
 * callback, not the subtree. A nested `function () { var m = 1; }` therefore
 * used to put `m` in the enclosing function's hoisted names, which made
 * scopeBinds claim a shadow that does not exist and suppressed every real read
 * of `m` in the function around it.
 */
function hoistedNames(fn) {
  const names = [];
  // `body` is the node whose var scope this is. Recursion must stop at any
  // OTHER function, and comparing against `body` is not enough on its own:
  // for `a => b => { var m; }` the outer arrow's body IS the inner arrow, so
  // the inner one is not `body` but is also not the root, and its vars used
  // to be attributed outwards. Depth says it plainly.
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node.type !== 'string') return;
    // A nested function has its own `var` scope. Its name, though, is declared
    // out here.
    if (FUNCTION_TYPES.has(node.type) && node !== fn) {
      if (node.type === 'FunctionDeclaration' && node.id?.name) names.push(node.id.name);
      return;
    }
    if (node.type === 'VariableDeclaration' && node.kind === 'var') {
      for (const declarator of node.declarations) patternNames(declarator.id, names);
    }
    if (node.type === 'FunctionDeclaration' && node.id?.name) names.push(node.id.name);
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return;
    for (const key of Object.keys(node)) {
      if (POSITION_KEYS.has(key)) continue;
      visit(node[key]);
    }
  };
  visit(fn);
  return names;
}

/**
 * Whether this node creates a scope that binds `name`, so a reference below it
 * belongs to that binding rather than to one further out.
 *
 * Program is deliberately excluded: a module-level binding is the one being
 * asked about, not a shadow of it.
 */
export function scopeBinds(node, name) {
  if (!node || typeof node.type !== 'string') return false;
  if (FUNCTION_TYPES.has(node.type)) {
    const bound = [];
    for (const parameter of node.params || []) patternNames(parameter, bound);
    if (node.id?.name) bound.push(node.id.name);
    bound.push(...hoistedNames(node));
    return bound.includes(name);
  }
  if (node.type === 'BlockStatement') {
    const bound = [];
    for (const statement of node.body || []) bound.push(...declaredBy(statement, { includeVar: false }));
    return bound.includes(name);
  }
  if (node.type === 'CatchClause' && node.param) return patternNames(node.param).includes(name);
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return node.id?.name === name;
  // A loop head binds for the whole loop. `for (const m of list)` beside a
  // module-level `m` is a different variable, and both directions matter: a
  // read of the loop variable must not count as a read of the outer binding,
  // and a genuinely dead export must not be rescued by one.
  if (node.type === 'ForStatement') {
    return node.init?.type === 'VariableDeclaration'
      && node.init.kind !== 'var'
      && node.init.declarations.some(d => patternNames(d.id).includes(name));
  }
  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    return node.left?.type === 'VariableDeclaration'
      && node.left.kind !== 'var'
      && node.left.declarations.some(d => patternNames(d.id).includes(name));
  }
  // A switch body is one block, and its cases share it.
  if (node.type === 'SwitchStatement') {
    return (node.cases || []).some(kase => (kase.consequent || [])
      .some(statement => declaredBy(statement, { includeVar: false }).includes(name)));
  }
  return false;
}

/**
 * Identifier positions that bind or name rather than read: a declaration, a
 * parameter, the key of a non-shorthand property, the member of a non-computed
 * member expression, and the parts of an import or export specifier.
 *
 * Every one of these would otherwise make a name look used by its own
 * declaration, or make an unrelated `{ state: 1 }` look like a reference.
 */
export function nonReferenceIdentifiers(tree, into = new Set()) {
  walk(tree, node => {
    if (node.type === 'Property' && !node.computed && !node.shorthand && node.key?.type === 'Identifier') {
      into.add(node.key);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
      into.add(node.property);
    }
    if (node.type === 'VariableDeclarator') {
      for (const bound of patternIdentifiers(node.id)) into.add(bound);
    }
    if (FUNCTION_TYPES.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) into.add(node.id);
      for (const parameter of node.params || []) {
        for (const bound of patternIdentifiers(parameter)) into.add(bound);
      }
    }
    if (node.type === 'CatchClause' && node.param) {
      for (const bound of patternIdentifiers(node.param)) into.add(bound);
    }
    // The target of an assignment is written, not read. `mapModule ||= await
    // import('./map.js')` names the binding it is filling, and counting that as
    // a read made the module look like it had escaped somewhere unknowable.
    // Compound arithmetic assignment (`+=`) does read its target, so only the
    // plain and logical forms are excluded.
    if (node.type === 'AssignmentExpression'
      && node.left?.type === 'Identifier'
      && ['=', '||=', '&&=', '??='].includes(node.operator)) {
      into.add(node.left);
    }
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') {
      if (node.local) into.add(node.local);
      if (node.imported) into.add(node.imported);
    }
    // A re-export declares nothing locally and reads nothing locally: both
    // halves name things in the other module's namespace. Counting the local
    // half as a reference let a re-exported name that happened to match a
    // dynamic-import binding widen that namespace and exempt every export of
    // the module behind it.
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const specifier of node.specifiers || []) {
        if (specifier.local) into.add(specifier.local);
        if (specifier.exported) into.add(specifier.exported);
      }
    }
    // `export * as ns from './m.js'` publishes a name that is not a binding.
    if (node.type === 'ExportAllDeclaration' && node.exported) into.add(node.exported);
    if (node.type === 'ExportSpecifier') {
      // Only the name being published, and only when it is a node of its own.
      // `export { m }` READS the local binding, and acorn gives the shorthand
      // form one Identifier for both halves, so excluding the published name
      // excluded the read as well and a namespace handed out of the module
      // never widened. `export { m as n }` has two nodes and only n is a name.
      if (node.exported && node.exported !== node.local) into.add(node.exported);
    }
  });
  return into;
}

/**
 * Whether the module-level binding `name` is read anywhere, ignoring the nodes
 * in `ignore` (its own declaration) and anywhere an inner scope has shadowed it.
 *
 * Without this, a module that exports `state` and also has `function other() {
 * let state = 2; return state; }` looked like it used the export. That is the
 * word match again, one level down.
 */
export function referencesModuleBinding(tree, name, ignore = new Set()) {
  let found = false;

  const notAReference = new Set(ignore);
  walk(tree, node => {
    if (node.type === 'Property' && !node.computed && !node.shorthand && node.key?.type === 'Identifier') {
      notAReference.add(node.key);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
      notAReference.add(node.property);
    }
    // A declaration binds; it does not read.
    if (node.type === 'VariableDeclarator') {
      for (const bound of patternIdentifiers(node.id)) notAReference.add(bound);
    }
    if (FUNCTION_TYPES.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) notAReference.add(node.id);
      for (const parameter of node.params || []) {
        for (const bound of patternIdentifiers(parameter)) notAReference.add(bound);
      }
    }
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') {
      if (node.local) notAReference.add(node.local);
      if (node.imported) notAReference.add(node.imported);
    }
    // A re-export declares nothing locally and reads nothing locally: both
    // halves name things in the other module's namespace. Counting the local
    // half as a reference let a re-exported name that happened to match a
    // dynamic-import binding widen that namespace and exempt every export of
    // the module behind it.
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const specifier of node.specifiers || []) {
        if (specifier.local) notAReference.add(specifier.local);
        if (specifier.exported) notAReference.add(specifier.exported);
      }
    }
    // `export * as ns from './m.js'` publishes a name that is not a binding.
    if (node.type === 'ExportAllDeclaration' && node.exported) notAReference.add(node.exported);
    if (node.type === 'ExportSpecifier') {
      // acorn gives shorthand `export { m }` one Identifier for both halves,
      // so excluding the published name would exclude the read of the binding
      // with it and a module that only publishes `m` would look like it never
      // used it.
      if (node.exported && node.exported !== node.local) notAReference.add(node.exported);
    }
  });

  const visit = (node, shadowed) => {
    if (found || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, shadowed);
      return;
    }
    if (typeof node.type !== 'string') return;

    if (!shadowed && node.type === 'Identifier' && node.name === name && !notAReference.has(node)) {
      found = true;
      return;
    }

    const inner = shadowed || scopeBinds(node, name);

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
      visit(node[key], inner);
    }
  };

  visit(tree, false);
  return found;
}

/**
 * The Identifier nodes a binding pattern introduces, as nodes rather than
 * names.
 *
 * Walking the whole pattern instead is wrong in one specific and easy-to-miss
 * way: `{ timeoutMs = PERSISTENCE_PROMPT_TIMEOUT_MS }` has a default value, and
 * that default is an expression that reads a real binding. Treating it as part
 * of the parameter marked it a non-reference, and a constant used only as a
 * parameter default one line below its own declaration was reported as having
 * no consumer at all.
 */
export function patternIdentifiers(pattern, into = []) {
  if (!pattern || typeof pattern !== 'object') return into;
  switch (pattern.type) {
    case 'Identifier':
      into.push(pattern);
      return into;
    case 'AssignmentPattern':
      return patternIdentifiers(pattern.left, into);
    case 'RestElement':
      return patternIdentifiers(pattern.argument, into);
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        patternIdentifiers(property.type === 'RestElement' ? property.argument : property.value, into);
      }
      return into;
    case 'ArrayPattern':
      for (const element of pattern.elements) patternIdentifiers(element, into);
      return into;
    default:
      return into;
  }
}

/** The 1-based line a character offset falls on. */
export function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}
