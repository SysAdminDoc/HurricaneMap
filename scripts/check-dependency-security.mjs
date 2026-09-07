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

// npm audit signatures verifies every installed tarball against the registry's
// own signing key. An advisory scan cannot see a package that was never
// tampered with in a way anyone has reported yet; a broken or absent signature
// says the bytes are not the ones the registry published, which is what the
// 2025-2026 campaigns produced within minutes of publishing.
export function findUnsignedPackages(report) {
  const problems = [];
  // npm writes its failures as a JSON error envelope on stdout, not to stderr,
  // so a parsed object is not the same as a completed audit. "found no
  // installed dependencies to audit", a registry 5xx, a key fetch failure and a
  // private registry with no signing keys all arrive this way, and reading them
  // as an empty result printed "0 unsigned or invalid tarballs" for a check
  // that had verified nothing. The gate has to fail closed.
  if (report?.error) {
    const summary = report.error.summary || report.error.detail || 'npm reported an error';
    problems.push({ kind: 'unverified', name: 'the installed tree', reason: String(summary).slice(0, 200) });
    return problems;
  }
  if (!Array.isArray(report?.invalid) || !Array.isArray(report?.missing)) {
    problems.push({
      kind: 'unverified',
      name: 'the installed tree',
      reason: 'npm audit signatures did not report { invalid, missing }',
    });
    return problems;
  }
  for (const [kind, entries] of [['invalid', report.invalid], ['missing', report.missing]]) {
    for (const entry of entries) {
      const name = entry?.name || entry?.package || 'unknown package';
      const version = entry?.version ? `@${entry.version}` : '';
      problems.push({ kind, name: `${name}${version}`, reason: entry?.reason || entry?.integrity || '' });
    }
  }
  return problems;
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

  const signatures = process.argv.includes('--offline') ? null : runSignatureAudit();
  let signatureNote = 'signatures not checked (offline)';
  if (signatures?.report) {
    const unsigned = findUnsignedPackages(signatures.report);
    for (const problem of unsigned) {
      errors.push(
        problem.kind === 'unverified'
          ? `npm audit signatures verified nothing: ${problem.reason}`
          : `${problem.kind} registry signature for ${problem.name}${problem.reason ? ` (${problem.reason})` : ''}`,
      );
    }
    signatureNote = unsigned.some(problem => problem.kind === 'unverified')
      ? 'signatures unverified'
      : `signatures verified, ${unsigned.length} unsigned or invalid`;
  } else if (signatures?.error) {
    console.warn(`dependency security: npm audit signatures unavailable; ${signatures.error}`);
  }

  errors.push(...await validateNpmPolicy());
  errors.push(...await validateVendorPolicy(policy));

  if (errors.length) {
    for (const error of errors) console.error(`dependency security: ${error}`);
    process.exit(1);
  }

  const npmCounts = auditReport?.metadata?.vulnerabilities || {};
  console.log(
    `dependency security ok (${auditSource}; npm ${npmCounts.high || 0} high/${npmCounts.critical || 0} critical; `
    + `Leaflet ${policy.vendors.find(vendor => vendor.id === 'leaflet')?.version}; `
    + `Cesium ${policy.vendors.find(vendor => vendor.id === 'cesium')?.version}; ${signatureNote})`,
  );
}

// The install policy is only a policy if it is in the tree. A contributor who
// deletes .npmrc gets their dependencies the moment they are published again,
// with install scripts running, which is exactly the window the campaigns used.
export function validateNpmPolicyText(text) {
  const errors = [];
  const settings = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    settings.set(key.trim(), rest.join('=').trim());
  }
  const days = Number(settings.get('min-release-age'));
  if (!Number.isFinite(days) || days < 2) {
    errors.push(`.npmrc must set min-release-age to at least 2 days, found ${settings.get('min-release-age') ?? 'nothing'}`);
  }
  // npm's own docs: a package matching min-release-age-exclude "can always
  // resolve to its newest version, even when a release-age window is set". A
  // glob of * therefore turns the window off entirely while leaving the setting
  // above in place for anyone reading the file.
  const exclusions = [...settings.keys()].filter(key => key.startsWith('min-release-age-exclude'));
  for (const key of exclusions) {
    const value = settings.get(key);
    if (value === '*' || value === '**') {
      errors.push(`.npmrc sets ${key}=${value}, which exempts every package from the release window`);
    }
  }
  if (settings.get('ignore-scripts') !== 'true') {
    errors.push('.npmrc must set ignore-scripts=true; the README documents the explicit npx playwright install');
  }
  if (settings.get('allow-git') !== 'none') {
    errors.push('.npmrc must set allow-git=none; a git dependency carries no registry signature to verify');
  }
  return errors;
}

async function validateNpmPolicy() {
  try {
    return validateNpmPolicyText(await readFile(path.join(root, '.npmrc'), 'utf8'));
  } catch {
    return ['.npmrc is missing, so nothing constrains how dependencies are installed'];
  }
}

function runNpm(args) {
  const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
  const npmArgs = process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args]
    : args;
  return execFileSync(npmCommand, npmArgs, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function runSignatureAudit() {
  try {
    return { report: parseAuditReport(runNpm(['audit', 'signatures', '--json'])) };
  } catch (error) {
    const report = parseAuditReport(`${error.stdout || ''}
${error.stderr || ''}`);
    return report ? { report } : { error: error.message || 'npm audit signatures failed without a JSON report' };
  }
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
      if (!['high', 'critical'].includes(advisory.severity) || leaflet.decision !== 'disputed-upstream') {
        errors.push(`Leaflet advisory ${advisory.id} lacks a disputed-upstream decision`);
      }
      if (!advisory.rationale || !advisory.next_action || !advisory.upstream_position_url || advisory.compensating_control !== 'check:popup-sinks') {
        errors.push(`Leaflet advisory ${advisory.id} lacks its upstream citation or popup-sink compensating control`);
      }
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
  if (vendor.decision === 'disputed-upstream') {
    if (Object.prototype.hasOwnProperty.call(vendor, 'review_expires_at_utc')) {
      return [`${vendor.id} disputed-upstream decision must not have a review expiry`];
    }
    return [];
  }
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
