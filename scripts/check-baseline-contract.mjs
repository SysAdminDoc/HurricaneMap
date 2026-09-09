// The browser contract is dates, and the README says the same dates.
//
// Three things can go wrong with a support claim and this gate catches all
// three. The README can drift from the contract the tests enforce. A feature
// the app cannot run without can be claimed at a Baseline tier it has not
// reached yet. And the paragraph can quietly acquire a version number, which is
// the thing this contract exists to avoid: Chrome went to a two-week release
// cadence on 2026-09-08, so a milestone number written down today means a
// different browser every fortnight.
//
// What this gate does NOT check is whether an engine has the features. Only an
// engine can answer that, so test:browser-matrix does it against all three.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASELINE_FEATURES, contractFloor, readmeClaim } from './baseline-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const today = new Date().toISOString().slice(0, 10);

function fail(message) {
  failures.push(message);
}

const readme = await readFile(path.join(root, 'README.md'), 'utf8');

// The support paragraph. Bounded so a version number somewhere else in the
// README, where it is talking about a dependency rather than a browser, is not
// this gate's business.
// The lookahead has to accept end-of-file, or moving this section to the end
// of the README fails the build with a message saying it is not there.
const sectionMatch = readme.match(/\n## Browser support\n([\s\S]*?)(?=\n## |$)/);
if (!sectionMatch) {
  fail('README.md has no "## Browser support" section, so nothing states the contract to a reader');
}
const section = sectionMatch?.[1] || '';

for (const feature of BASELINE_FEATURES) {
  const tier = feature.baseline === 'widely' ? feature.widelyAvailable : feature.newlyAvailable;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(feature.newlyAvailable) || !/^\d{4}-\d{2}-\d{2}$/.test(feature.widelyAvailable)) {
    fail(`${feature.id}: Baseline dates must be written as YYYY-MM-DD`);
    continue;
  }

  // Widely available is defined as newly available plus 30 months. A row where
  // those two do not agree is a transcription error, and a wrong date here
  // becomes a wrong claim in the README.
  const newly = new Date(`${feature.newlyAvailable}T00:00:00Z`);
  const expectedWide = new Date(newly);
  expectedWide.setUTCMonth(expectedWide.getUTCMonth() + 30);
  const expected = expectedWide.toISOString().slice(0, 10);
  if (expected !== feature.widelyAvailable) {
    fail(
      `${feature.id}: widely available is newly available plus 30 months, which is ${expected}, `
      + `but the contract says ${feature.widelyAvailable}`,
    );
  }

  // A feature the app cannot run without, claimed at a tier it has not reached,
  // is a support claim for a browser population that does not exist yet.
  if (feature.requirement === 'required' && tier > today) {
    fail(
      `${feature.id} is required and claimed Baseline ${feature.baseline} as of ${tier}, `
      + `which is in the future (today is ${today})`,
    );
  }

  if (feature.requirement !== 'required' && feature.requirement !== 'progressive') {
    fail(`${feature.id}: requirement must be "required" or "progressive", not ${JSON.stringify(feature.requirement)}`);
  }

  // A row is only allowed to claim a fallback if it names one, and a row with
  // no fallback is not allowed to look like it has one. Getting this backwards
  // is how a hard requirement gets described to a reader as optional.
  if (feature.requirement === 'progressive' && !feature.fallback) {
    fail(`${feature.id} is marked progressive, so it has to name the path taken without the feature`);
  }
  if (feature.requirement === 'required' && feature.fallback) {
    fail(`${feature.id} is marked required, so it cannot also name a fallback`);
  }

  const claim = readmeClaim(feature);
  if (section && !section.includes(claim)) {
    fail(`README.md's browser support section does not state "${claim}"`);
  }
}

// The floor the app actually sits at has to be the one the README leads with,
// or the paragraph understates what the app needs.
const floor = contractFloor();
if (section && floor && !section.includes(floor)) {
  fail(
    `README.md's browser support section does not state the contract floor ${floor}, `
    + 'the latest Baseline date among the features with no fallback',
  );
}

// No milestone numbers. This is the rule the contract exists to hold: a floor
// written as a version is stale the fortnight after it is written.
// A milestone can be written as "Chrome 120", "Chrome v120", "Chrome M120",
// "Chrome-120" or "Chromium >= 120", and the browser need not be one of the
// three the tests drive. All of those age the same way, so all of them fail.
const versionMention = section.match(
  /\b(Chrome|Chromium|Firefox|Safari|Edge|WebKit|Gecko|Blink|Opera|Samsung Internet)\b[\s\-]*(?:ESR[\s\-]*)?(?:[><]=?|≥|≤)?[\s]*[vM]?\d+(?:\.\d+)*\b/i,
);
if (versionMention) {
  fail(
    `README.md's browser support section names a browser version ("${versionMention[0].trim()}"). `
    + 'State the Baseline date instead; version numbers age and dates do not.',
  );
}

if (failures.length) {
  for (const message of failures) console.error(`  - ${message}`);
  console.error(`baseline contract FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
  process.exit(1);
}

const required = BASELINE_FEATURES.filter(feature => feature.requirement === 'required').length;
console.log(
  `baseline contract ok (${BASELINE_FEATURES.length} features, ${required} with no fallback, `
  + `floor ${floor}, README states every date and no version number)`,
);
