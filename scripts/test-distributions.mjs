import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeDistribution, SOURCE_BUNDLE_FILES, stageDistribution } from './build-distribution.mjs';
import { validateStac } from './check-stac.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = {
  core: path.join(root, 'dist', '.test-core'),
  full: path.join(root, 'dist', '.test-full'),
};
const [core, full] = await Promise.all([
  describeDistribution('core'),
  describeDistribution('full'),
]);

const sourceDescriptor = JSON.parse(await readFile(path.join(root, 'data/distribution.json'), 'utf8'));
const sourceManifest = JSON.parse(await readFile(path.join(root, 'data/release-manifest.json'), 'utf8'));
assertDescriptor(sourceDescriptor, full, 'source descriptor');
assert.equal(sourceDescriptor.profile, 'full', 'tracked source descriptor must describe the full repository payload');
assert.equal(sourceDescriptor.source_commit, sourceManifest.source_commit, 'source descriptor and release manifest source commits must agree');
await assertManifestAgreement(root, sourceDescriptor, sourceManifest, 'source descriptor');

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
  'serve.py',
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
  for (const [profile, description] of [['core', core], ['full', full]]) {
    const result = await stageDistribution(profile, outputs[profile], { allowDirty: true });
    const descriptor = JSON.parse(await readFile(path.join(outputs[profile], 'data/distribution.json')));
    const releaseManifest = JSON.parse(await readFile(path.join(outputs[profile], 'data/release-manifest.json')));
    assertDescriptor(descriptor, description, `${profile} descriptor`);
    assert.deepEqual(descriptor, result.descriptor, `${profile} stage result descriptor drifted from staged descriptor`);
    await assertManifestAgreement(outputs[profile], descriptor, releaseManifest, `${profile} descriptor`);
    const radarManifest = JSON.parse(await readFile(path.join(outputs[profile], 'data/radar/manifest.json')));
    if (profile === 'core') {
      assert(!releaseManifest.artifacts.some(artifact => artifact.path.endsWith('.png')), 'core manifest must omit radar frame artifacts');
      assert.deepEqual(radarManifest, {}, 'core radar manifest must not claim bundled frames');
    } else {
      assert.equal(Object.keys(radarManifest).length > 0, true, 'full radar manifest must retain bundled frames');
    }
    const stac = await validateStac({ root: outputs[profile], profile });
    assert.equal(stac.collections, 2);
    assert.equal(stac.radarAssets, full.radar_file_count);
  }
} finally {
  await Promise.all(Object.values(outputs).map(output => rm(output, { recursive: true, force: true })));
}

console.log(
  `distribution profiles ok (core ${(core.bytes / 1024 / 1024).toFixed(1)} MB, `
  + `full ${(full.bytes / 1024 / 1024).toFixed(1)} MB with ${full.radar_file_count} radar frames)`,
);

function assertDescriptor(descriptor, description, label) {
  assert.equal(descriptor.schema_version, 1, `${label} schema version`);
  assert.equal(descriptor.profile, description.profile, `${label} profile`);
  assert.match(descriptor.source_commit, /^[a-f0-9]{40}$/, `${label} source commit`);
  assert.equal(descriptor.capabilities.historical_offline, true, `${label} historical capability`);
  assert.equal(descriptor.capabilities.bundled_radar, description.profile === 'full', `${label} radar capability`);
  assert.equal(descriptor.capabilities.remote_radar, true, `${label} remote radar capability`);
  assert.equal(descriptor.capabilities.source_bundle, true, `${label} source bundle capability`);
  for (const key of [
    'file_count',
    'bytes',
    'mandatory_bytes',
    'mandatory_file_count',
    'source_bundle_file_count',
    'source_bundle_max_bytes',
    'radar_file_count',
    'radar_bytes',
  ]) {
    assert.equal(descriptor.payload[key], description[key], `${label} payload ${key}`);
  }
  assert(descriptor.payload.source_bundle_bytes <= descriptor.payload.source_bundle_max_bytes, `${label} source bundle exceeds cap`);
}

async function assertManifestAgreement(directory, descriptor, releaseManifest, label) {
  assert.equal(releaseManifest.source_commit, descriptor.source_commit, `${label} source commit`);
  const descriptorBytes = await readFile(path.join(directory, 'data/distribution.json'));
  const descriptorArtifact = releaseManifest.artifacts.find(artifact => artifact.path === 'data/distribution.json');
  assert.equal(descriptorArtifact.bytes, descriptorBytes.length, `${label} descriptor byte count`);
  assert.equal(descriptorArtifact.sha256, createHash('sha256').update(descriptorBytes).digest('hex'), `${label} descriptor hash`);

  const sourceArtifacts = releaseManifest.artifacts.filter(artifact => SOURCE_BUNDLE_FILES.has(artifact.path));
  const releaseManifestBytes = (await readFile(path.join(directory, 'data/release-manifest.json'))).length;
  assert.equal(sourceArtifacts.length + 1, descriptor.payload.source_bundle_file_count, `${label} source bundle file count`);
  assert.equal(sourceArtifacts.reduce((sum, artifact) => sum + artifact.bytes, 0) + releaseManifestBytes, descriptor.payload.source_bundle_bytes, `${label} source bundle bytes`);
  const radarArtifacts = releaseManifest.artifacts.filter(artifact => artifact.path.startsWith('data/radar/') && artifact.path.endsWith('.png'));
  assert.equal(radarArtifacts.length, descriptor.payload.radar_file_count, `${label} radar file count`);
  assert.equal(radarArtifacts.reduce((sum, artifact) => sum + artifact.bytes, 0), descriptor.payload.radar_bytes, `${label} radar bytes`);
}
