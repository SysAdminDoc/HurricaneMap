// Prints the CHANGELOG section for one version, for `gh release create
// --notes-file -`. Release notes retyped by hand drift from the changelog, and
// five versions here shipped with no release at all, so the notes come from the
// file that already has them.
//
// Headings are not written consistently. Both of these exist and both have to
// be found: "## v1.9.3: Metric parity and maintainability (2026-08-08)" and
// "## v1.9.1 - Advisory replay expansion, radar reliability, ... (2026-08-02)".
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function findSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  // Nothing that continues the version may follow it. The first attempt at this
  // put a period inside the boundary class, so "1.9" matched the heading for
  // v1.9.3 and "1" matched it too: `release:notes 1.9` exited 0 and printed
  // another release's notes straight into `gh release create --notes-file`.
  const heading = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(?![\\w.])`);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return null;

  // A fenced block can contain a line that starts with "## ", and a changelog
  // that quotes a heading is not unusual. Ending the section there truncated
  // the body mid-fence and dropped everything after it, silently and with a
  // zero exit.
  const rest = lines.slice(start + 1);
  let fence = null;
  let end = -1;
  for (const [index, line] of rest.entries()) {
    const opener = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      continue;
    }
    if (opener) { fence = opener[1]; continue; }
    if (/^##\s/.test(line)) { end = index; break; }
  }
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return { title: lines[start].replace(/^##\s+/, '').trim(), body };
}

async function main() {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.mjs <version>');
    process.exit(1);
  }
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = findSection(changelog, version);
  if (!section) {
    console.error(`release notes: CHANGELOG.md has no section for v${version}`);
    process.exit(1);
  }
  if (!section.body) {
    console.error(`release notes: the CHANGELOG.md section for v${version} is empty`);
    process.exit(1);
  }
  process.stdout.write(`${section.body}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
