import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(root, 'security/dependency-security-policy.json');
const snapshotPath = path.join(root, 'security/npm-audit-snapshot.json');
const lockfilePath = path.join(root, 'package-lock.json');

export function parseAuditReport(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function findHighRiskFindings(report) {
  const findings = [];
  for (const [packageName, vulnerability] of Object.entries(report?.vulnerabilities || {})) {
    if (!['high', 'critical'].includes(vulnerability?.severity)) continue;
    const via = (vulnerability.via || [])
      .map(item => typeof item === 'string' ? item : item?.source || item?.url || item?.title)
      .filter(Boolean);
    findings.push({
      package: packageName,
      severity: vulnerability.severity,
      range: vulnerability.range || '',
      via,
    });
  }
  return findings;
}

export function validateAuditSnapshot(snapshot, lockfileSha256, now = new Date()) {
  const errors = [];
  if (snapshot?.schema_version !== 1) errors.push('npm audit snapshot schema_version must be 1');
  if (snapshot?.lockfile_sha256 !== lockfileSha256) errors.push('npm audit snapshot does not match package-lock.json');
  if (!validIso(snapshot?.generated_at_utc)) errors.push('npm audit snapshot generated_at_utc is invalid');
  if (!validIso(snapshot?.expires_at_utc)) errors.push('npm audit snapshot expires_at_utc is invalid');
  if (validIso(snapshot?.expires_at_utc) && Date.parse(snapshot.expires_at_utc) <= now.getTime()) {
    errors.push(`npm audit snapshot expired at ${snapshot.expires_at_utc}`);
  }
  const findings = findHighRiskFindings(snapshot?.audit);
  for (const finding of findings) {
    errors.push(`unreviewed npm ${finding.severity} advisory for ${finding.package}${finding.via.length ? ` (${finding.via.join(', ')})` : ''}`);
  }
  return { errors, findings };
}

async function main() {
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const lockfileSha256 = createHash('sha256').update(await readFile(lockfilePath)).digest('hex');
  const errors = [];
  const now = new Date();

  const live = process.argv.includes('--offline') ? null : runLiveAudit();
  let auditReport = live?.report;
  let auditSource = 'live npm audit';
  if (!auditReport) {
    const snapshotCheck = validateAuditSnapshot(snapshot, lockfileSha256, now);
    errors.push(...snapshotCheck.errors);
    auditReport = snapshot.audit;
    auditSource = 'checked-in npm audit snapshot';
    if (live?.error) console.warn(`dependency security: live npm audit unavailable; ${live.error}`);
  } else {
    const findings = findHighRiskFindings(auditReport);
    for (const finding of findings) {
      errors.push(`unreviewed npm ${finding.severity} advisory for ${finding.package}${finding.via.length ? ` (${finding.via.join(', ')})` : ''}`);
    }
  }

  errors.push(...await validateVendorPolicy(policy));

  if (errors.length) {
    for (const error of errors) console.error(`dependency security: ${error}`);
    process.exit(1);
  }

  const npmCounts = auditReport?.metadata?.vulnerabilities || {};
  console.log(
    `dependency security ok (${auditSource}; npm ${npmCounts.high || 0} high/${npmCounts.critical || 0} critical; `
    + `Leaflet ${policy.vendors.find(vendor => vendor.id === 'leaflet')?.version}; `
    + `Cesium ${policy.vendors.find(vendor => vendor.id === 'cesium')?.version})`,
  );
}

function runLiveAudit() {
  try {
    const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
    const npmArgs = process.platform === 'win32'
      ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'audit', '--json', '--audit-level=high']
      : ['audit', '--json', '--audit-level=high'];
    const stdout = execFileSync(npmCommand, npmArgs, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return { report: parseAuditReport(stdout) };
  } catch (error) {
    const report = parseAuditReport(`${error.stdout || ''}\n${error.stderr || ''}`);
    return report ? { report } : { error: error.message || 'npm audit failed without a JSON report' };
  }
}

async function validateVendorPolicy(policy) {
  const errors = [];
  if (policy?.schema_version !== 1 || !Array.isArray(policy.vendors)) {
    return ['vendor security policy must be a version 1 document with a vendors array'];
  }
  const vendors = new Map(policy.vendors.map(vendor => [vendor.id, vendor]));
  for (const id of ['leaflet', 'cesium']) {
    if (!vendors.has(id)) errors.push(`vendor security policy is missing ${id}`);
  }
  const leaflet = vendors.get('leaflet');
  if (leaflet) {
    const leafletText = await readFile(path.join(root, 'vendor/leaflet.js'), 'utf8');
    const version = leafletText.match(/Leaflet\s+(\d+\.\d+\.\d+)/)?.[1];
    if (version !== leaflet.version) errors.push(`Leaflet vendor version ${version || 'unknown'} does not match policy ${leaflet.version}`);
    for (const [relative, expected] of Object.entries(leaflet.files || {})) {
      const actual = createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex');
      if (actual !== expected) errors.push(`${relative} hash does not match the reviewed Leaflet asset`);
    }
    errors.push(...validateReviewWindow(leaflet));
    if (!String(await readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8')).includes(`Leaflet ${leaflet.version}`)) {
      errors.push('THIRD_PARTY_NOTICES.txt does not record the reviewed Leaflet version');
    }
    for (const advisory of leaflet.advisories || []) {
      if (!['high', 'critical'].includes(advisory.severity) || leaflet.decision !== 'time-bounded-exception') {
        errors.push(`Leaflet advisory ${advisory.id} lacks a time-bounded exception decision`);
      }
      if (!advisory.rationale || !advisory.next_action) errors.push(`Leaflet advisory ${advisory.id} lacks rationale or next action`);
    }
  }

  const cesium = vendors.get('cesium');
  if (cesium) {
    const host = await readFile(path.join(root, 'src/globe-host.js'), 'utf8');
    const version = host.match(/const CESIUM_VERSION = '([^']+)'/)?.[1];
    if (version !== cesium.version) errors.push(`Cesium version ${version || 'unknown'} does not match policy ${cesium.version}`);
    const jsIntegrity = host.match(/script\.integrity = '([^']+)'/)?.[1];
    const cssIntegrity = host.match(/link\.integrity = '([^']+)'/)?.[1];
    if (jsIntegrity !== cesium.assets?.javascript?.integrity) errors.push('Cesium JavaScript SRI does not match the reviewed policy');
    if (cssIntegrity !== cesium.assets?.stylesheet?.integrity) errors.push('Cesium stylesheet SRI does not match the reviewed policy');
    if (!host.includes('https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/')) {
      errors.push('Cesium host does not use the reviewed release URL');
    }
    errors.push(...validateReviewWindow(cesium));
    if (!String(await readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8')).includes(`CesiumJS ${cesium.version}`)) {
      errors.push('THIRD_PARTY_NOTICES.txt does not record the reviewed Cesium version');
    }
  }
  return errors;
}

function validateReviewWindow(vendor) {
  if (!validIso(vendor.reviewed_at_utc)) return [`${vendor.id} reviewed_at_utc is invalid`];
  if (!validIso(vendor.review_expires_at_utc)) return [`${vendor.id} review_expires_at_utc is invalid`];
  if (Date.parse(vendor.review_expires_at_utc) <= Date.parse(vendor.reviewed_at_utc)) return [`${vendor.id} review expiry must follow its review date`];
  if (Date.parse(vendor.review_expires_at_utc) <= Date.now()) return [`${vendor.id} security review expired at ${vendor.review_expires_at_utc}`];
  if (!vendor.next_action && vendor.id === 'cesium') return ['Cesium policy lacks a next action'];
  return [];
}

function validIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`dependency security: ${error.message || error}`);
    process.exit(1);
  });
}
