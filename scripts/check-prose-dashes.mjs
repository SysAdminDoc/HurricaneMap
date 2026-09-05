// The repo's writing rule bans em and en dashes in prose a reader outside this
// machine will see. They are the single most reliable tell of generated text,
// and the rule had been applied only to lines that happened to be edited.
//
// Exempt, deliberately: fenced code blocks and indented code, because a dash
// inside a shell comment or a directory tree is code, not prose.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASHES = /[–—]/;

export function findProseDashes(text) {
  const hits = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    // A four-space indent is a Markdown code block, not a paragraph.
    if (/^ {4,}\S/.test(line) && !/^\s*[-*+]|^\s*\d+\./.test(line)) return;
    if (DASHES.test(line)) hits.push({ line: index + 1, text: line.trim() });
  });
  return hits;
}

async function markdownFiles() {
  const files = ['README.md', 'CHANGELOG.md'];
  for (const entry of await readdir(path.join(root, 'docs'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.posix.join('docs', entry.name));
  }
  return files;
}

const files = await markdownFiles();
assert.ok(files.length >= 3, 'the scan must cover README, CHANGELOG and the docs directory');

const failures = [];
let scanned = 0;
for (const file of files) {
  const hits = findProseDashes(await readFile(path.join(root, file), 'utf8'));
  scanned += 1;
  for (const hit of hits) failures.push(`${file}:${hit.line}: ${hit.text.slice(0, 120)}`);
}

if (failures.length) {
  console.error(`Em or en dashes found in prose (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('Use a period, a comma, parentheses, or split the sentence.');
  process.exit(1);
}

// A checker that cannot fail is not a checker.
assert.equal(findProseDashes('a — b').length, 1, 'an em dash in prose must be reported');
assert.equal(findProseDashes('a – b').length, 1, 'an en dash in prose must be reported');
assert.equal(findProseDashes('```\na — b\n```').length, 0, 'a fenced code block is exempt');
assert.equal(findProseDashes('~~~\na — b\n~~~').length, 0, 'tildes fence code too');
assert.equal(findProseDashes('    tree.js  # a — b').length, 0, 'an indented code block is exempt');
assert.equal(findProseDashes('- a — b').length, 1, 'an indented list item is still prose');
assert.equal(findProseDashes('a - b, a-b, 1851-2025').length, 0, 'hyphens are fine');

console.log(`prose dashes ok (${scanned} files, no em or en dash outside code)`);
