import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderOutlookBanner } from '../src/seasonal-outlook.js';
import {
  getSnapshotStatus,
  isInAtlanticHurricaneSeason,
  parseSnapshotDate,
  SNAPSHOT_MAX_AGE_DAYS,
} from '../src/snapshot-freshness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outlook = JSON.parse(await readFile(path.join(root, 'data/outlook.json'), 'utf8'));
const enso = JSON.parse(await readFile(path.join(root, 'data/enso.json'), 'utf8'));

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const iso = date => date.toISOString().slice(0, 10);

// Pure date parsing, independent of the snapshots.
assert.ok(parseSnapshotDate('2026-02-28'));
assert.equal(parseSnapshotDate('2026-02-29'), null);

// Every hand-maintained window is read from the data, never pinned to a literal
// date: a test that hardcodes the expiry it is meant to police goes green on
// exactly the snapshot it should reject.
const windows = [
  { label: 'data/outlook.json', snapshot: outlook },
  ...outlook.sources.map((source, index) => ({ label: `data/outlook.json sources[${index}]`, snapshot: source })),
  { label: 'data/enso.json _meta', snapshot: enso._meta },
];
// Anchored to the real clock, not to the data. Deriving every probe from the
// snapshots proves the mechanism works but would pass just as happily on a
// snapshot that expired a year ago, which is the failure this test exists for.
// Deliberately the real clock, never HURRICANEMAP_VALIDATION_DATE: that
// variable steers the validator subprocesses below, and honouring it here would
// let `HURRICANEMAP_VALIDATION_DATE=2020-01-01 npm run build` switch off the one
// assertion that notices the snapshots have gone stale.
const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
for (const { label, snapshot } of windows) {
  const issued = parseSnapshotDate(snapshot.issued);
  const validUntil = parseSnapshotDate(snapshot.valid_until);
  assert.ok(issued, `${label}.issued must be an ISO date`);
  assert.ok(validUntil, `${label}.valid_until must be an ISO date`);
  assert.ok(validUntil > issued, `${label} must stay valid past its own issue date`);
  assert.ok(
    issued <= today,
    `${label}.issued is ${snapshot.issued}, in the future as of ${iso(today)}`,
  );
  assert.ok(
    validUntil >= today,
    `${label} expired on ${snapshot.valid_until}; refresh it from ${snapshot.url || 'its published source'} rather than extending the window`,
  );
}

const outlookIssued = parseSnapshotDate(outlook.issued);
const outlookValidUntil = parseSnapshotDate(outlook.valid_until);
const earliestExpiry = windows
  .map(({ snapshot }) => parseSnapshotDate(snapshot.valid_until))
  .reduce((earliest, candidate) => candidate < earliest ? candidate : earliest);
// The snapshots are refreshed on their own schedules, so a probe date has to
// clear the most recently issued one or the validator rejects it as a future
// issue date rather than exercising the window it is aimed at.
const latestIssued = windows
  .map(({ snapshot }) => parseSnapshotDate(snapshot.issued))
  .reduce((latest, candidate) => candidate > latest ? candidate : latest);

// Probe dates derived from the snapshots themselves.
const freshDay = addDays(latestIssued, 1);
const outlookAgeLimit = addDays(outlookIssued, SNAPSHOT_MAX_AGE_DAYS + 1);
const staleDay = outlookAgeLimit > freshDay ? outlookAgeLimit : freshDay;
const expiredDay = addDays(earliestExpiry, 1);

// The stale probe only proves the age gate if it is still inside every window
// and still inside the season; otherwise it would be testing expiry instead.
assert.ok(
  staleDay <= earliestExpiry,
  `the snapshot windows are too short to exercise the >${SNAPSHOT_MAX_AGE_DAYS}-day age gate; `
  + `extend valid_until past ${iso(staleDay)}`,
);
assert.equal(isInAtlanticHurricaneSeason(outlook.season, staleDay), true);
assert.equal(isInAtlanticHurricaneSeason(outlook.season, new Date(Date.UTC(outlook.season, 0, 15))), false);

const freshAgeDays = Math.round((freshDay.getTime() - outlookIssued.getTime()) / DAY_MS);
assert.ok(freshAgeDays <= SNAPSHOT_MAX_AGE_DAYS, 'the outlook is already stale on the day after the newest snapshot was issued');
assert.deepEqual(
  getSnapshotStatus(outlook, freshDay),
  {
    daysOld: freshAgeDays,
    expired: false,
    stale: false,
    issued: outlookIssued,
    validUntil: outlookValidUntil,
  },
);
assert.equal(getSnapshotStatus(outlook, staleDay).stale, true);
assert.equal(getSnapshotStatus(outlook, staleDay).expired, false);
assert.equal(getSnapshotStatus(outlook, expiredDay).expired, true);
assert.equal(getSnapshotStatus(enso._meta, freshDay).expired, false);
assert.equal(getSnapshotStatus(enso._meta, addDays(parseSnapshotDate(enso._meta.valid_until), 1)).expired, true);

const banner = renderOutlookBanner({ current: outlook }, { now: freshDay });
assert.ok(banner.includes(`valid through ${outlook.valid_until}`), 'the banner must publish the live outlook window');
assert.match(banner, /products\/outlooks\/hurricane\.shtml/);
const staleBanner = renderOutlookBanner({ current: outlook }, { now: staleDay });
assert.match(staleBanner, /days old; check the current NOAA CPC product/);

function validateAt(date) {
  return spawnSync(process.execPath, ['scripts/validate-data.mjs'], {
    cwd: root,
    env: { ...process.env, HURRICANEMAP_VALIDATION_DATE: iso(date) },
    encoding: 'utf8',
  });
}

const clean = validateAt(freshDay);
assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);

const stale = validateAt(staleDay);
assert.equal(stale.status, 0, `${stale.stdout}\n${stale.stderr}`);
assert.match(`${stale.stdout}\n${stale.stderr}`, /Data validation warnings/);
assert.match(`${stale.stdout}\n${stale.stderr}`, />45 days/);

const expired = validateAt(expiredDay);
assert.notEqual(expired.status, 0);
assert.match(`${expired.stdout}\n${expired.stderr}`, /past valid_until/);

console.log(
  `snapshot freshness contracts ok (${windows.length} windows, earliest expiry ${iso(earliestExpiry)}, `
  + `age gate at ${iso(staleDay)}, validator expiry at ${iso(expiredDay)})`,
);
