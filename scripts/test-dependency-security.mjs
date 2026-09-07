import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  findHighRiskFindings,
  findUnsignedPackages,
  parseAuditReport,
  validateAuditSnapshot,
  validateNpmPolicyText,
} from './check-dependency-security.mjs';

// The same shape check-dependency-security.mjs uses: npm is a script, not a
// binary, on Windows, so it is spawned through node rather than by name.
function runNpmForTest(args) {
  const command = process.platform === 'win32' ? process.execPath : 'npm';
  const argv = process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args]
    : args;
  try {
    return execFileSync(command, argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    return `${error.stdout || ''}
${error.stderr || ''}`;
  }
}

const report = parseAuditReport('npm warning\n{"vulnerabilities":{"demo":{"severity":"high","range":"<2.0.0","via":[{"source":12345}]}},"metadata":{"vulnerabilities":{"high":1,"critical":0}}}\n');
assert.equal(findHighRiskFindings(report).length, 1, 'high npm advisories must be surfaced');
assert.equal(findHighRiskFindings({ vulnerabilities: { demo: { severity: 'moderate' } } }).length, 0, 'moderate npm advisories are not release blockers');
assert.deepEqual(validateAuditSnapshot({
  schema_version: 1,
  lockfile_sha256: 'a'.repeat(64),
  generated_at_utc: '2026-08-02T00:00:00Z',
  expires_at_utc: '2026-09-30T00:00:00Z',
  audit: { vulnerabilities: {} },
}, 'b'.repeat(64), new Date('2026-08-02T00:00:00Z')).errors, [
  'npm audit snapshot does not match package-lock.json',
], 'offline snapshots must be bound to the lockfile');
const policy = JSON.parse(await readFile(new URL('../security/dependency-security-policy.json', import.meta.url), 'utf8'));
const leaflet = policy.vendors.find(vendor => vendor.id === 'leaflet');
const leafletAdvisory = leaflet.advisories.find(advisory => advisory.id === 'CVE-2025-69993');
assert.equal(leaflet.decision, 'disputed-upstream', 'Leaflet must use the permanent disputed-upstream decision');
assert.equal(Object.hasOwn(leaflet, 'review_expires_at_utc'), false, 'disputed Leaflet advisories must not expire');
assert.equal(leafletAdvisory.upstream_position_url, 'https://github.com/Leaflet/Leaflet/issues/10214');
assert.equal(leafletAdvisory.compensating_control, 'check:popup-sinks');
const cesium = policy.vendors.find(vendor => vendor.id === 'cesium');
assert.equal(cesium.decision, 'pinned-sri-isolation', 'Cesium must remain isolated behind the reviewed SRI policy');
assert.match(cesium.assets.javascript.integrity, /^sha384-[A-Za-z0-9+/]+=*$/);
assert.match(cesium.assets.stylesheet.integrity, /^sha384-[A-Za-z0-9+/]+=*$/);
// Anchored to the clock, not to a literal date that quietly becomes a date in
// the past: the point is that the review has not lapsed, not that it once ran.
const cesiumExpiry = Date.parse(cesium.review_expires_at_utc);
assert.ok(Number.isFinite(cesiumExpiry), 'Cesium review must carry a parsable expiry');
assert.ok(cesiumExpiry > Date.now(), `Cesium review lapsed on ${cesium.review_expires_at_utc}; re-review the pinned release and SRI pair`);
assert.ok(Date.parse(cesium.reviewed_at_utc) <= Date.now(), 'Cesium review cannot be dated in the future');
// A tarball whose bytes do not match what the registry signed is the shape the
// 2025-2026 campaigns took: a brand-new patch version of something already
// depended on, consumed within minutes. An advisory scan cannot see it, because
// nobody has reported it yet.
assert.deepEqual(findUnsignedPackages({ invalid: [], missing: [] }), [], 'a clean tree reports nothing');
assert.deepEqual(findUnsignedPackages(null), []);
assert.deepEqual(
  findUnsignedPackages({
    invalid: [{ name: 'ansi-regex', version: '6.2.4', reason: 'signature mismatch' }],
    missing: [{ name: 'left-pad', version: '1.3.0' }],
  }),
  [
    { kind: 'invalid', name: 'ansi-regex@6.2.4', reason: 'signature mismatch' },
    { kind: 'missing', name: 'left-pad@1.3.0', reason: '' },
  ],
  'both an unsigned and a wrongly signed tarball must be reported, with the version',
);

// The shape above is the shape npm actually emits. Read it back from the live
// command so the fixture cannot drift away from the tool it stands in for.
const signatureKeys = Object.keys(parseAuditReport(runNpmForTest(['audit', 'signatures', '--json'])) || {}).sort();
assert.deepEqual(
  signatureKeys,
  ['invalid', 'missing'],
  `npm audit signatures --json no longer reports { invalid, missing }: ${signatureKeys.join(', ')}`,
);

// The policy has to be in the tree, not just in someone's shell history.
assert.deepEqual(validateNpmPolicyText(await readFile(new URL('../.npmrc', import.meta.url), 'utf8')), []);
assert.deepEqual(
  validateNpmPolicyText(''),
  [
    '.npmrc must set min-release-age to at least 2 days, found nothing',
    '.npmrc must set ignore-scripts=true; the README documents the explicit npx playwright install',
    '.npmrc must set allow-git=none; a git dependency carries no registry signature to verify',
  ],
  'an empty .npmrc must fail on all three settings',
);
assert.deepEqual(
  validateNpmPolicyText([
    'min-release-age=1',
    'ignore-scripts=true',
    'allow-git=none',
  ].join('\n')).length,
  1,
  'a one-day window is shorter than the campaigns took to be noticed',
);
assert.deepEqual(
  validateNpmPolicyText([
    '; min-release-age=3',
    'min-release-age=3',
    'ignore-scripts=true',
    'allow-git=none',
  ].join('\n')).length,
  0,
  'a commented line must not be read as a setting, and a real one after it must be',
);

console.log('dependency security helpers ok (JSON parsing, severity gate, lock binding, registry signatures, install policy)');
