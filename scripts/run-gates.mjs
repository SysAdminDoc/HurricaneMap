// Runs every non-browser release gate and reports all of them.
//
// `build` used to be one 84-link `&&` chain, so the first red gate hid the state
// of every gate after it: a single dependency advisory concealed an expired data
// snapshot and a broken distribution descriptor for weeks. This runner executes
// the whole set, prints one line per gate, and exits non-zero if any failed.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The ordered release gate set. Cheap structural checks run first so an obvious
// break is reported in seconds even though the whole run continues.
export const GATE_SCRIPTS = Object.freeze([
  'check:syntax',
  'check:sw',
  'check:styles',
  'check:network-timeouts',
  'check:readme-links',
  'check:release-truth',
  'check:licenses',
  'check:security',
  'check:pages-size',
  'check:release-manifest',
  'check:stac',
  'check:manifests',
  'check:export-provenance',
  'check:popup-sinks',
  'validate:data',
  'test:discovery',
  'test:dataset-status',
  'test:snapshot-freshness',
  'test:coverage',
  'validate:schemas',
  'test:stac',
  'test:category-contract',
  'test:i18n',
  'test:manifest-locale',
  'test:alerts',
  'test:peak-surge',
  'test:tides',
  'test:url-state',
  'test:filter-state',
  'test:settings',
  'test:fuzzy',
  'test:climatology',
  'test:decade-trends',
  'test:radar',
  'test:fema',
  'test:on-this-date',
  'test:geodesy',
  'test:network-timeouts',
  'test:diagnostics',
  'test:migrations',
  'test:metric-presenters',
  'test:shell-boundaries',
  'test:saved-views',
  'test:platform-enhancements',
  'test:search-history',
  'test:impact-scraper',
  'test:impact-utils',
  'test:impact-coverage',
  'test:report-export',
  'test:citation',
  'test:export-provenance',
  'test:qgis-export',
  'test:geojson-rfc7946',
  'test:similarity-vectors',
  'test:cone-utils',
  'test:cone-retro',
  'test:advisory-replay',
  'test:forecast-skill',
  'test:art-mode',
  'test:prep',
  'test:evac',
  'test:video-export',
  'test:track-timeline',
  'test:poster',
  'test:storm-events',
  'test:globe3d-utils',
  'test:globe-protocol',
  'test:exposure-utils',
  'test:hurdat2-refresh',
  'test:preprocess-provenance',
  'test:aoml',
  'test:notebook',
  'test:dependency-security',
  'test:layer-registry',
  'test:shared-probe',
  'test:panel-impacts',
  'test:release-gates',
  'test:goes-realtime',
  'test:active-polling',
  'test:active-products',
  'test:optional-feeds',
  'test:wind-context',
  'test:user-point',
  'test:storage-manager',
  'test:bundle-audit',
  'test:cdn-worker',
  'test:dockerfile',
  'test:static-server',
  'test:distributions',
]);

// Gates that need a browser, a staged bundle, or an explicit operator choice.
// `npm test` chains these after this runner; they are deliberately not here.
export const NON_GATE_SCRIPTS = Object.freeze([
  'check:security:offline',
  'test:distribution-offline',
  'test:smoke',
  'test:visual',
  'test:visual:update',
  'test:visual-platform',
  'test:aria',
  'test:optional-feeds-browser',
  'test:browser-matrix',
  'test:offline-smoke',
  'test:globe3d-smoke',
]);

// A gate nothing runs is not a gate. Anything named like one has to be claimed
// by GATE_SCRIPTS or excused by NON_GATE_SCRIPTS.
export function findUnclaimedGates(scripts) {
  const claimed = new Set([...GATE_SCRIPTS, ...NON_GATE_SCRIPTS]);
  return Object.keys(scripts)
    .filter(name => /^(check|validate|test):/.test(name))
    .filter(name => !claimed.has(name))
    .sort();
}

export function findMissingGates(scripts) {
  return GATE_SCRIPTS.filter(name => !Object.hasOwn(scripts, name));
}

// The slowest gate is validate:schemas at roughly half a minute; ten minutes
// is a hang, not a slow machine.
const GATE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_GATE_OUTPUT_BYTES = 32 * 1024 * 1024;

export function describeSpawnFailure(result) {
  if (result?.error?.code === 'ETIMEDOUT' || (result?.signal && result?.status === null && result?.error?.code !== 'ENOBUFS')) {
    return `killed after ${GATE_TIMEOUT_MS / 1000}s (${result.signal || 'timeout'})`;
  }
  if (result?.error?.code === 'ENOBUFS') {
    return `wrote more than ${MAX_GATE_OUTPUT_BYTES / 1024 / 1024} MB and was cut off; its real exit status is unknown`;
  }
  if (result?.error) return result.error.message;
  return '';
}

function lastMeaningfulLine(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('>'));
  return lines[lines.length - 1] || '';
}

async function main() {
  const { scripts } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const missing = findMissingGates(scripts);
  if (missing.length) {
    console.error(`release gates: package.json has no script for ${missing.join(', ')}`);
    process.exit(1);
  }
  const unclaimed = findUnclaimedGates(scripts);
  if (unclaimed.length) {
    console.error(
      `release gates: ${unclaimed.join(', ')} looks like a gate but nothing runs it; `
      + 'add it to GATE_SCRIPTS or list it in NON_GATE_SCRIPTS with a reason',
    );
    process.exit(1);
  }

  const failures = [];
  const started = Date.now();
  for (const [index, name] of GATE_SCRIPTS.entries()) {
    const position = `${String(index + 1).padStart(2, ' ')}/${GATE_SCRIPTS.length}`;
    const gateStarted = Date.now();
    const result = spawnSync(scripts[name], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
      maxBuffer: MAX_GATE_OUTPUT_BYTES,
      timeout: GATE_TIMEOUT_MS,
    });
    const seconds = ((Date.now() - gateStarted) / 1000).toFixed(1);
    if (result.status === 0) {
      console.log(`${position} PASS ${name} (${seconds}s) — ${lastMeaningfulLine(result.stdout)}`);
    } else {
      // A gate can die without ever setting an exit status — killed on the
      // timeout, or cut off for writing more than the buffer holds. Say which,
      // because the captured output alone reads like an unexplained failure.
      const reason = describeSpawnFailure(result);
      failures.push({ name, reason, output: `${result.stdout || ''}${result.stderr || ''}` });
      console.log(`${position} FAIL ${name} (${seconds}s)${reason ? ` — ${reason}` : ''}`);
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (failures.length) {
    for (const failure of failures) {
      const heading = failure.reason ? `${failure.name} (${failure.reason})` : failure.name;
      console.error(`\n----- ${heading} -----\n${failure.output.trimEnd()}`);
    }
    console.error(
      `\nrelease gates: ${GATE_SCRIPTS.length - failures.length}/${GATE_SCRIPTS.length} passed in ${elapsed}s; `
      + `failed: ${failures.map(failure => failure.name).join(', ')}`,
    );
    process.exit(1);
  }
  console.log(`\nrelease gates ok (${GATE_SCRIPTS.length}/${GATE_SCRIPTS.length} passed in ${elapsed}s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
