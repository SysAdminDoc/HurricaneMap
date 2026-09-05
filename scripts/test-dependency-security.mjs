import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  findHighRiskFindings,
  parseAuditReport,
  validateAuditSnapshot,
} from './check-dependency-security.mjs';

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
console.log('dependency security helpers ok (JSON parsing, severity gate, lock binding)');
