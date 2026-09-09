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

/** The 1-based line a character offset falls on. */
export function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}
