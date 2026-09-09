// Tree reading for the gates that cannot do their job by matching text.
//
// Three of them need it now: the injected-transport rule, which has to tell a
// parameter that binds a seam from a property that passes one on; the unused
// import check; and the dead export check, which was asking whether a name is
// spelled anywhere rather than whether anything imports it.
import { parse } from 'acorn';

const POSITION_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);

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

/** Every `var` and function declaration anywhere inside a function body. */
function hoistedNames(body) {
  const names = [];
  walk(body, node => {
    if (FUNCTION_TYPES.has(node.type) && node !== body) return;
    if (node.type === 'VariableDeclaration' && node.kind === 'var') {
      for (const declarator of node.declarations) patternNames(declarator.id, names);
    }
    if (node.type === 'FunctionDeclaration' && node.id?.name) names.push(node.id.name);
  });
  return names;
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
      walk(node.id, inner => { if (inner.type === 'Identifier') notAReference.add(inner); });
    }
    if (FUNCTION_TYPES.has(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (node.id) notAReference.add(node.id);
      for (const parameter of node.params || []) {
        walk(parameter, inner => { if (inner.type === 'Identifier') notAReference.add(inner); });
      }
    }
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') {
      if (node.local) notAReference.add(node.local);
      if (node.imported) notAReference.add(node.imported);
    }
    if (node.type === 'ExportSpecifier') {
      if (node.exported) notAReference.add(node.exported);
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

    let inner = shadowed;
    if (!inner) {
      if (FUNCTION_TYPES.has(node.type)) {
        const bound = [];
        for (const parameter of node.params || []) patternNames(parameter, bound);
        if (node.id?.name) bound.push(node.id.name);
        bound.push(...hoistedNames(node.body));
        if (bound.includes(name)) inner = true;
      } else if (node.type === 'BlockStatement' || node.type === 'Program') {
        const bound = [];
        for (const statement of node.body || []) bound.push(...declaredBy(statement, { includeVar: false }));
        if (node.type !== 'Program' && bound.includes(name)) inner = true;
      } else if (node.type === 'CatchClause' && node.param) {
        const bound = patternNames(node.param);
        if (bound.includes(name)) inner = true;
      } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        if (node.id?.name === name) inner = true;
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
      visit(node[key], inner);
    }
  };

  visit(tree, false);
  return found;
}

/** The 1-based line a character offset falls on. */
export function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}
