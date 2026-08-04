import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeDistribution, stageDistribution } from './build-distribution.mjs';
import { validateStac } from './check-stac.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', '.test-core');
const [core, full] = await Promise.all([
  describeDistribution('core'),
  describeDistribution('full'),
]);

assert.equal(core.source_commit, full.source_commit, 'profiles must identify the same source commit');
assert.equal(core.radar_file_count, 0, 'core distribution must omit radar PNGs');
assert(core.mandatory_bytes < 10 * 1024 * 1024, `core mandatory install is unexpectedly large: ${core.mandatory_bytes}`);
assert(core.source_bundle_bytes > 11 * 1024 * 1024, `source bundle is unexpectedly small: ${core.source_bundle_bytes}`);
assert(core.source_bundle_bytes <= core.source_bundle_max_bytes, 'source bundle exceeds its declared size cap');
assert.equal(core.source_bundle_file_count, 3, 'source bundle must contain both raw basins and the release manifest');
assert(full.radar_file_count >= 1600, 'full distribution must retain the bundled radar archive');
assert(core.bytes < 35 * 1024 * 1024, `core distribution is unexpectedly large: ${core.bytes}`);
assert(full.bytes > 450 * 1024 * 1024, `full distribution is unexpectedly small: ${full.bytes}`);
for (const required of [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'manifest.es.webmanifest',
  'manifest.ht.webmanifest',
  'example.png',
  'branding/logo-192.png',
  'branding/logo-512.png',
  'branding/logo-192-maskable.png',
  'branding/logo-512-maskable.png',
  'branding/screenshot-narrow.png',
  'data/landfalls.json',
  'data/storms.json.gz',
  'data/hurdat2-atlantic.txt',
  'data/hurdat2-nepac.txt',
  'data/release-manifest.json',
  'data/radar/manifest.json',
  'data/stac/catalog.json',
  'data/stac/collections/hurdat2.json',
  'data/stac/collections/radar.json',
  'data/stac/items/hurdat2.json',
]) {
  assert(core.files.includes(required), `core distribution is missing ${required}`);
  assert(full.files.includes(required), `full distribution is missing ${required}`);
}

try {
  await stageDistribution('core', output, { allowDirty: true });
  const descriptor = JSON.parse(await readFile(path.join(output, 'data/distribution.json'), 'utf8'));
  const releaseManifest = JSON.parse(await readFile(path.join(output, 'data/release-manifest.json'), 'utf8'));
  const radarManifest = JSON.parse(await readFile(path.join(output, 'data/radar/manifest.json'), 'utf8'));
  assert.equal(descriptor.profile, 'core');
  assert.equal(releaseManifest.source_commit, descriptor.source_commit);
  assert(!releaseManifest.artifacts.some(artifact => artifact.path.endsWith('.png')), 'core manifest must omit radar frame artifacts');
  const distributionBytes = await readFile(path.join(output, 'data/distribution.json'));
  const distributionArtifact = releaseManifest.artifacts.find(artifact => artifact.path === 'data/distribution.json');
  assert.equal(distributionArtifact.bytes, distributionBytes.length);
  assert.equal(distributionArtifact.sha256, createHash('sha256').update(distributionBytes).digest('hex'));
  assert.equal(descriptor.capabilities.historical_offline, true);
  assert.equal(descriptor.capabilities.bundled_radar, false);
  assert.equal(descriptor.capabilities.remote_radar, true);
  assert.equal(descriptor.capabilities.source_bundle, true);
  assert.equal(descriptor.payload.mandatory_bytes, core.mandatory_bytes);
  assert.equal(descriptor.payload.mandatory_file_count, core.mandatory_file_count);
  assert.equal(descriptor.payload.source_bundle_bytes, core.source_bundle_bytes);
  assert.equal(descriptor.payload.source_bundle_max_bytes, core.source_bundle_max_bytes);
  assert.deepEqual(radarManifest, {}, 'core radar manifest must not claim bundled frames');
  const stac = await validateStac({ root: output, profile: 'core' });
  assert.equal(stac.collections, 2);
  assert.equal(stac.radarAssets, full.radar_file_count);
} finally {
  await rm(output, { recursive: true, force: true });
}

console.log(
  `distribution profiles ok (core ${(core.bytes / 1024 / 1024).toFixed(1)} MB, `
  + `full ${(full.bytes / 1024 / 1024).toFixed(1)} MB with ${full.radar_file_count} radar frames)`,
);
