// The accessibility conformance report has to keep up with the accessibility
// work, and it did not: it was dated 2026-08-02 and 2026-08-08 while the styles
// and the suite behind its claims kept moving through September. A report that
// falls behind is worse than none, because it states a conformance position for
// a build that no longer exists.
//
// What is checked here, and why each one is here rather than trusted:
//
//   - The date is not older than the newest commit touching the accessibility
//     styles or the accessibility suite, and is not in the future. A future
//     date would disable the freshness check for as long as it stands.
//   - Every row names what checks it, and every command it names exists. Two
//     rows shipped naming `check:outbound-links` and `check:untranslated-strings`,
//     which are the file names; the scripts are `check:links` and
//     `check:untranslated`, so "a reader can run it" was false for both.
//   - The number of rows resting on a manual audit is counted here and has to
//     match what the report and the README tell a reader. That number was
//     written by hand as eleven when it was eight, in two places.
//   - The report is reachable: a real anchor in the README and in the About
//     dialog, and a sitemap entry. A substring test passed for prose that
//     merely mentioned the path.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VPAT_PATH = 'docs/VPAT.html';
const WATCHED = ['src/styles-accessibility.css', 'tests/aria-regression.spec.mjs'];
const PUBLIC_URL = 'https://sysadmindoc.github.io/HurricaneMap/docs/VPAT.html';
const EXPECTED_ROWS = 40;

const failures = [];
const fail = message => failures.push(message);

const [vpat, readme, indexHtml, sitemap, packageJson] = await Promise.all([
  readFile(path.join(root, VPAT_PATH), 'utf8'),
  readFile(path.join(root, 'README.md'), 'utf8'),
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'sitemap.xml'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8'),
]);

const stated = /<strong>Date:<\/strong>\s*(\d{4}-\d{2}-\d{2})/.exec(vpat)?.[1];
if (!stated) fail(`${VPAT_PATH} does not state a date in its metadata block`);

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// A shallow clone grafts its history, so `git log -1 -- <path>` reports the
// grafted tip as touching every path and every file looks like it changed
// today. Comparing against that would demand a re-dated report on every commit,
// and it would do it only on the machines that clone shallowly. Better to check
// nothing than to check the wrong thing differently per machine.
const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
const watchedDates = shallow
  ? []
  : WATCHED
    .map(relative => ({ relative, date: git(['log', '-1', '--format=%cs', '--', relative]) }))
    .filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.date || ''));

if (stated) {
  // A day of slack: the date in the report is typed by a person in their own
  // timezone, and comparing it against UTC failed for up to fourteen hours for
  // anyone east of it. What this is for is a date years ahead, which would
  // disable the freshness check for as long as it stood.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (stated > tomorrow) {
    fail(`${VPAT_PATH} is dated ${stated}, which is in the future and would disable this check until then`);
  }
  for (const { relative, date } of watchedDates) {
    if (stated < date) {
      fail(
        `${VPAT_PATH} is dated ${stated} but ${relative} last changed on ${date}. `
        + 'Re-read the report against what the suite now covers, then date it.',
      );
    }
  }
}

// Attributes allowed on the row: one added to a <tr> used to drop it from this
// scan entirely, which is how ten rows could be reduced to "Checked." and still
// pass. The count is exact for the same reason.
const rows = [...vpat.matchAll(/<tr[^>]*><td[^>]*>([0-9.]+) [^<]*<\/td>([\s\S]*?)<\/tr>/g)];
if (rows.length !== EXPECTED_ROWS) {
  fail(`${VPAT_PATH} carries ${rows.length} criteria rows; WCAG 2.2 AA is ${EXPECTED_ROWS} here, so one has been added, removed or hidden`);
}

const scripts = new Set(Object.keys(JSON.parse(packageJson).scripts || {}));
let manualRows = 0;
for (const [, criterion, body] of rows) {
  const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]);
  if (cells.length < 4) {
    fail(`${VPAT_PATH} criterion ${criterion} has no Evidence cell; every claim must name what checks it`);
    continue;
  }
  const evidence = cells[cells.length - 1];
  const text = evidence.replace(/<[^>]+>/g, ' ').trim();
  if (text.length < 40) {
    fail(`${VPAT_PATH} criterion ${criterion} has an Evidence cell too short to name anything: ${JSON.stringify(text)}`);
  }
  if (/\bManual\b/.test(text)) manualRows += 1;
  if (!/npm run|Manual|No audio|No content flashes|No gesture|No motion|No time limit|No image of text/.test(text)) {
    fail(`${VPAT_PATH} criterion ${criterion} names neither a command nor a manual audit: ${JSON.stringify(text.slice(0, 80))}`);
  }
  for (const [, named] of text.matchAll(/npm run ([a-z0-9:-]+)/g)) {
    if (!scripts.has(named)) {
      fail(`${VPAT_PATH} criterion ${criterion} names \`npm run ${named}\`, which is not a script in package.json`);
    }
  }
}

// Counted here rather than typed anywhere, so the number a reader is given
// cannot drift from the report it describes.
const claim = `${manualRows} of the ${rows.length} rows`;
if (!vpat.includes(claim)) fail(`${VPAT_PATH} must state "${claim}" rest on a manual audit`);
if (!readme.includes(claim)) fail(`README.md must state "${claim}", which is what the report now says`);

// Real anchors, not a mention. Prose naming the path used to satisfy both.
if (!new RegExp(String.raw`\]\(${VPAT_PATH}\)`).test(readme)) fail(`README.md does not link ${VPAT_PATH} as a markdown link`);
if (!/<a\s[^>]*href="docs\/VPAT\.html"/.test(indexHtml)) fail('index.html does not link the conformance report from the About dialog');
if (!sitemap.includes(`<loc>${PUBLIC_URL}</loc>`)) fail(`sitemap.xml does not list ${PUBLIC_URL}`);

if (failures.length) {
  for (const message of failures) console.error(`  - ${message}`);
  console.error(`VPAT check FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log(
  `VPAT ok (${rows.length} criteria, ${manualRows} resting on a manual audit, every named command exists, `
  + `dated ${stated} against ${watchedDates.map(entry => `${path.basename(entry.relative)} ${entry.date}`).join(' and ') || 'no per-file history'}, `
  + 'linked from the README, the About dialog and the sitemap)',
);
