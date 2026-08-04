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
const now = new Date('2026-08-03T12:00:00Z');

assert.ok(parseSnapshotDate('2026-02-28'));
assert.equal(parseSnapshotDate('2026-02-29'), null);
assert.deepEqual(
  getSnapshotStatus(outlook, now),
  {
    daysOld: 26,
    expired: false,
    stale: false,
    issued: parseSnapshotDate('2026-07-08'),
    validUntil: parseSnapshotDate('2026-09-30'),
  },
);
assert.equal(getSnapshotStatus({ issued: '2026-06-01', valid_until: '2026-09-30' }, now).stale, true);
assert.equal(getSnapshotStatus({ issued: '2026-07-08', valid_until: '2026-08-02' }, now).expired, true);
assert.equal(isInAtlanticHurricaneSeason(2026, now), true);
assert.equal(enso._meta.valid_until, '2026-08-31');

const banner = renderOutlookBanner({ current: outlook }, { now });
assert.match(banner, /valid through 2026-09-30/);
assert.match(banner, /products\/outlooks\/hurricane\.shtml/);
const staleBanner = renderOutlookBanner({
  current: { ...outlook, issued: '2026-06-01' },
}, { now });
assert.match(staleBanner, /days old; check the current NOAA CPC product/);

const clean = spawnSync(process.execPath, ['scripts/validate-data.mjs'], {
  cwd: root,
  env: { ...process.env, HURRICANEMAP_VALIDATION_DATE: '2026-08-03' },
  encoding: 'utf8',
});
assert.equal(clean.status, 0, `${clean.stdout}\n${clean.stderr}`);

const stale = spawnSync(process.execPath, ['scripts/validate-data.mjs'], {
  cwd: root,
  env: { ...process.env, HURRICANEMAP_VALIDATION_DATE: '2026-08-24' },
  encoding: 'utf8',
});
assert.equal(stale.status, 0, `${stale.stdout}\n${stale.stderr}`);
assert.match(`${stale.stdout}\n${stale.stderr}`, /Data validation warnings/);
assert.match(`${stale.stdout}\n${stale.stderr}`, />45 days/);

const expired = spawnSync(process.execPath, ['scripts/validate-data.mjs'], {
  cwd: root,
  env: { ...process.env, HURRICANEMAP_VALIDATION_DATE: '2026-10-01' },
  encoding: 'utf8',
});
assert.notEqual(expired.status, 0);
assert.match(`${expired.stdout}\n${expired.stderr}`, /past valid_until/);

console.log('snapshot freshness contracts ok (date windows, in-season age gate, card state, validator expiry)');
