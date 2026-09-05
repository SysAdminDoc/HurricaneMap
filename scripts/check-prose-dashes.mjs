// The repo's writing rule bans em and en dashes in prose a reader outside this
// machine will see. They are the single most reliable tell of generated text,
// and the rule had been applied only to lines that happened to be edited.
//
// Code is exempt, because a dash in a shell comment, a directory tree or an
// inline code span is code rather than prose. Getting that boundary right is
// the whole job: a checker that exempts too much stops checking, and one that
// exempts too little cannot be satisfied without mangling a code sample.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASHES = /[–—]/;

// A fence opens with at least three backticks or tildes and closes with at
// least as many of the same character. A naive toggle gets this wrong in both
// directions: a ``` inside a ```` block closes it, and a ~~~ inside a ```
// block closes that too.
// Indentation is allowed up to a list item's content column, because a fenced
// block inside a numbered step is indented four spaces and was being read as
// prose. A fence closes at any indent, so an opener at column 0 and a closer at
// column 4 still pair up.
const FENCE = /^(\s{0,8})(`{3,}|~{3,})(.*)$/;

function stripInlineCode(line) {
  return line
    .replace(/<!--[\s\S]*?-->/g, '')      // an HTML comment is not prose
    .replace(/`+[^`]*`+/g, '')            // inline code spans, including in table cells
    .replace(/\]\([^)]*\)/g, ']()')       // link targets are addresses, not prose
    .replace(/^\s*\[[^\]]+\]:\s*\S+$/, ''); // link reference definitions
}

export function findProseDashes(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  let fence = null;
  let htmlBlock = false;
  lines.forEach((line, index) => {
    const match = FENCE.exec(line);
    if (match) {
      const [, , marker, rest] = match;
      if (!fence) {
        fence = { char: marker[0], length: marker.length };
        return;
      }
      // Only the same character, at least as long, and with nothing after it.
      if (marker[0] === fence.char && marker.length >= fence.length && !rest.trim()) fence = null;
      return;
    }
    if (fence) return;
    // A <pre> can open mid-line and close mid-line, and the text after the
    // close is prose. Blank the block out rather than skipping whole lines:
    // skipping missed the prose beside it and flagged the code inside it.
    let subject = line;
    if (htmlBlock) {
      const close = subject.search(/<\/pre>/i);
      if (close === -1) return;
      htmlBlock = false;
      subject = subject.slice(close + 6);
    }
    subject = subject.replace(/<pre\b[\s\S]*?<\/pre>/gi, '');
    const open = subject.search(/<pre\b/i);
    if (open !== -1) {
      htmlBlock = true;
      subject = subject.slice(0, open);
    }
    if (DASHES.test(stripInlineCode(subject))) hits.push({ line: index + 1, text: line.trim() });
  });
  // A file whose fences do not balance is a problem in its own right: the tail
  // of it was exempted by an accident of punctuation.
  if (fence) hits.push({ line: lines.length, text: `unclosed ${fence.char.repeat(fence.length)} fence: everything after it went unchecked` });
  return hits;
}

async function markdownFiles(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
    // Recursive: docs/research holds six files, 220 dashes, and the gate used
    // to report "6 files" and pass without ever opening any of them.
    if (entry.isDirectory()) found.push(...await markdownFiles(path.join(directory, entry.name), relative));
    else if (entry.name.endsWith('.md')) found.push(relative);
  }
  return found;
}

// A checker that cannot fail is not a checker, and one that fails on code
// cannot be satisfied. Both directions, before it is pointed at the repo.
assert.equal(findProseDashes('a — b').length, 1, 'an em dash in prose must be reported');
assert.equal(findProseDashes('a – b').length, 1, 'an en dash in prose must be reported');
assert.equal(findProseDashes('```\na — b\n```').length, 0, 'a fenced code block is exempt');
assert.equal(findProseDashes('```js\na — b\n```').length, 0, 'a language tag does not change that');
assert.equal(findProseDashes('~~~\na — b\n~~~').length, 0, 'tildes fence code too');
assert.equal(findProseDashes('````\n```\na — b\n```\n````').length, 0, 'a longer fence survives a shorter one inside it');
assert.equal(findProseDashes('```\ncode\n~~~\nstill code — here\n```').length, 0, 'the other marker does not close a fence');
assert.equal(findProseDashes('```\nunclosed — forever').length, 1, 'an unclosed fence is reported, not trusted');
assert.equal(findProseDashes('- a — b').length, 1, 'a list item is prose');
assert.equal(findProseDashes('  - nested — item').length, 1, 'so is a nested one');
assert.equal(findProseDashes('    a continuation paragraph — indented under a list item').length, 1);
assert.equal(findProseDashes('    1) step one — indented').length, 1);
assert.equal(findProseDashes('| `a — b` | c |').length, 0, 'code in a table cell is still code');
assert.equal(findProseDashes('The placeholder is `—` for a missing figure.').length, 0, 'an inline code span is code');
assert.equal(findProseDashes('The placeholder is `—` and — this is prose.').length, 1, 'but only the span is exempt');
assert.equal(findProseDashes('<!-- a — b -->').length, 0, 'an HTML comment is not prose');
assert.equal(findProseDashes('<pre>\na — b\n</pre>').length, 0, 'an HTML pre block is code');
assert.equal(findProseDashes('<div><pre>\ncmd --x — y\n</pre></div>').length, 0, 'even opened mid-line');
assert.equal(findProseDashes('<pre>x</pre> and prose — here').length, 1, 'and the prose beside it is still prose');
assert.equal(findProseDashes('<pre>\nc\n</pre> and prose — here').length, 1, 'including on the closing line');
assert.equal(
  findProseDashes('1. Run this:\n\n    ```\n    cmd --a — b\n    ```\n').length,
  0,
  'a fence indented into a list item is still a fence',
);
assert.equal(
  findProseDashes('```\ncode — here\n    ```\nprose — after the block\n').length,
  1,
  'a fence closed at a deeper indent still closes, so the prose after it is checked',
);
assert.equal(findProseDashes('[text](https://example.com/a–b)').length, 0, 'a link target is an address');
assert.equal(findProseDashes('a - b, a-b, 1851-2025').length, 0, 'hyphens are fine');

// The strings a reader actually sees are not all in markdown: the page title,
// the social cards, the PWA install name, the in-app glossary and every
// translated string are read by more people than the README is. A lone em dash
// is a placeholder glyph for "no value" there and has to survive, so these
// surfaces are checked for the connector form only.
const APP_SURFACES = [
  'index.html',
  'manifest.webmanifest',
  // The localised install names are the same surface as the English one, and
  // were left carrying the punctuation the English one had removed.
  'manifest.es.webmanifest',
  'manifest.ht.webmanifest',
  'data/glossary.json',
  'src/i18n.js',
  // The About panel builds its own year ranges rather than taking them from a
  // translated string, so it needed checking too.
  'src/about-ui.js',
];
const CONNECTOR = /\S\s*[–—]\s+\S|\S\s+[–—]\s*\S/;

export function findConnectorDashes(text, { code = false } = {}) {
  const hits = [];
  let blockComment = false;
  text.split(/\r?\n/).forEach((line, index) => {
    let subject = line;
    if (code) {
      // Code comments are for developers, and the rule exempts them. Strip
      // them rather than rewrite a comment to satisfy the checker.
      if (blockComment) {
        if (!line.includes('*/')) return;
        blockComment = false;
        subject = line.slice(line.indexOf('*/') + 2);
      }
      // Blank out string literals first. A `//` or `/*` inside one is content,
      // not a comment: treating it as a comment truncated the line and, for
      // `/*`, silenced every line after it until some later `*/`.
      const strings = [];
      subject = subject.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, match => {
        strings.push(match);
        return ` ${strings.length - 1} `;
      });
      subject = subject.replace(/\/\*[\s\S]*?\*\//g, '');
      if (/\/\*/.test(subject)) {
        blockComment = true;
        subject = subject.slice(0, subject.indexOf('/*'));
      }
      subject = subject.replace(/\/\/.*$/, '');
      subject = subject.replace(/ (\d+) /g, (_, index) => strings[Number(index)]);
    }
    if (CONNECTOR.test(subject)) hits.push({ line: index + 1, text: line.trim() });
  });
  return hits;
}

assert.equal(findConnectorDashes("'Evicted — repair needed'").length, 1, 'a connector dash in app copy is prose');
assert.equal(findConnectorDashes('<span>—</span>').length, 0, 'a placeholder glyph is not prose');
assert.equal(findConnectorDashes("  return '—';").length, 0, 'nor is one returned as a value');
assert.equal(findConnectorDashes("'wind—driven'").length, 0, 'a closed-up dash is not the connector form');
assert.equal(findConnectorDashes('title: "A: B"').length, 0);
assert.equal(findConnectorDashes('// a note — for developers', { code: true }).length, 0, 'a code comment is exempt');
assert.equal(findConnectorDashes('/* a note — for developers */', { code: true }).length, 0);
assert.equal(
  findConnectorDashes('/*\n a note — for developers\n*/\n', { code: true }).length,
  0,
  'including a block comment spanning lines',
);
assert.equal(
  findConnectorDashes("const s = 'shown — to a reader'; // a note — for developers", { code: true }).length,
  1,
  'but a string on the same line as a comment is still checked',
);
assert.equal(
  findConnectorDashes("const url = 'https://x/y'; // note — here", { code: true }).length,
  0,
  'the // inside a URL must not be mistaken for a comment',
);
// A `//` or a `/*` inside a string is content. Reading either as a comment
// truncated the line, and `/*` silenced every line after it as well.
assert.equal(
  findConnectorDashes("const p = 'a//b'; const t = 'Wind — gust';", { code: true }).length,
  1,
  'a // inside a string must not hide the rest of the line',
);
assert.equal(
  findConnectorDashes("const s = '/*';\nconst t = 'Evicted — repair needed';\nconst u = 'Storm — surge';", { code: true }).length,
  2,
  'a /* inside a string must not silence the rest of the file',
);
assert.equal(findConnectorDashes('const t = `a — b`;', { code: true }).length, 1, 'a template literal is still copy');

const files = ['README.md', 'CHANGELOG.md', 'LICENSE.md', ...(await markdownFiles(path.join(root, 'docs'), 'docs'))];
assert.ok(files.length >= 8, `the scan must cover the docs tree, found only ${files.length} files`);

const failures = [];
for (const file of files) {
  for (const hit of findProseDashes(await readFile(path.join(root, file), 'utf8'))) {
    failures.push(`${file}:${hit.line}: ${hit.text.slice(0, 120)}`);
  }
}
for (const file of APP_SURFACES) {
  for (const hit of findConnectorDashes(await readFile(path.join(root, file), 'utf8'), { code: file.endsWith('.js') })) {
    failures.push(`${file}:${hit.line}: ${hit.text.slice(0, 120)}`);
  }
}

if (failures.length) {
  console.error(`Em or en dashes found in prose (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('Use a period, a comma, parentheses, or split the sentence.');
  process.exit(1);
}

console.log(`prose dashes ok (${files.length} markdown files and ${APP_SURFACES.length} app surfaces, no em or en dash outside code)`);
