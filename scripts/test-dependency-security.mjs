import assert from 'node:assert/strict';

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
console.log('dependency security helpers ok (JSON parsing, severity gate, lock binding)');
