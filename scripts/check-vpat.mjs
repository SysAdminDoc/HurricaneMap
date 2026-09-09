// The accessibility conformance report has to keep up with the accessibility
// work, and it did not: it was dated 2026-08-02 and 2026-08-08 while the styles
// and the suite behind its claims kept moving through September. A report that
// falls behind is worse than none, because it states a conformance position for
// a build that no longer exists.
//
// Three things are checked. The report's date is not older than the newest
// commit touching the accessibility styles or the accessibility suite. Every
// row names what checks it, so a claim can be traced to something that runs.
// And the report is reachable: linked from the README and the About dialog, and
// listed in the sitemap, because a differentiator nothing points at is invisible.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VPAT_PATH = 'docs/VPAT.html';
const WATCHED = ['src/styles-accessibility.css', 'tests/aria-regression.spec.mjs'];
const PUBLIC_URL = 'https://sysadmindoc.github.io/HurricaneMap/docs/VPAT.html';

const failures = [];
const fail = message => failures.push(message);

const [vpat, readme, indexHtml, sitemap] = await Promise.all([
  readFile(path.join(root, VPAT_PATH), 'utf8'),
  readFile(path.join(root, 'README.md'), 'utf8'),
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'sitemap.xml'), 'utf8'),
]);

const stated = /<strong>Date:<\/strong>\s*(\d{4}-\d{2}-\d{2})/.exec(vpat)?.[1];
if (!stated) fail(`${VPAT_PATH} does not state a date in its metadata block`);

// Committer date, not author date: a rebased or cherry-picked accessibility
// change lands in the tree when it is committed, and that is the moment the
// report stops describing what is there.
function newestCommitDate(relative) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relative], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

const watchedDates = WATCHED
  .map(relative => ({ relative, date: newestCommitDate(relative) }))
  .filter(entry => entry.date);

// No git history at all is a shallow clone or an export, not a stale report.
if (stated && watchedDates.length) {
  for (const { relative, date } of watchedDates) {
    if (stated < date) {
      fail(
        `${VPAT_PATH} is dated ${stated} but ${relative} last changed on ${date}. `
        + 'Re-read the report against what the suite now covers, then date it.',
      );
    }
  }
}

const rows = [...vpat.matchAll(/<tr><td>([0-9.]+) [^<]*<\/td>([\s\S]*?)<\/tr>/g)];
if (rows.length < 30) fail(`${VPAT_PATH} carries only ${rows.length} criteria rows, which cannot be a WCAG 2.2 AA report`);
for (const [, criterion, body] of rows) {
  const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]);
  if (cells.length < 4) {
    fail(`${VPAT_PATH} criterion ${criterion} has no Evidence cell; every claim must name what checks it`);
    continue;
  }
  const evidence = cells[cells.length - 1].replace(/<[^>]+>/g, ' ').trim();
  if (evidence.length < 40) {
    fail(`${VPAT_PATH} criterion ${criterion} has an Evidence cell too short to name anything: ${JSON.stringify(evidence)}`);
  }
  // Either something runs, or the row says plainly that nothing does.
  if (!/npm run|Manual|No audio|No content flashes|No gesture|No motion|No time limit|No image of text/.test(evidence)) {
    fail(`${VPAT_PATH} criterion ${criterion} names neither a command nor a manual audit: ${JSON.stringify(evidence.slice(0, 80))}`);
  }
}

if (!readme.includes(`(${VPAT_PATH})`)) fail(`README.md does not link ${VPAT_PATH}`);
if (!indexHtml.includes(`docs/VPAT.html`)) fail('index.html does not link the conformance report from the About dialog');
if (!sitemap.includes(PUBLIC_URL)) fail(`sitemap.xml does not list ${PUBLIC_URL}`);

if (failures.length) {
  for (const message of failures) console.error(`  - ${message}`);
  console.error(`VPAT check FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log(
  `VPAT ok (${rows.length} criteria, each naming its evidence, dated ${stated} against `
  + `${watchedDates.map(entry => `${path.basename(entry.relative)} ${entry.date}`).join(' and ') || 'no git history'}, `
  + 'linked from the README, the About dialog and the sitemap)',
);
