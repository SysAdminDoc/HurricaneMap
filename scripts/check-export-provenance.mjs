import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExportProvenance,
  getExportProvenanceArtifacts,
  EXPORT_PROVENANCE_SCHEMA_VERSION,
} from '../src/export-provenance.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [packageJson, metadata, coverage, releaseManifest, releaseManifestBytes] = await Promise.all([
  readJson('package.json'),
  readJson('data/metadata.json'),
  readJson('data/coverage.json'),
  readJson('data/release-manifest.json'),
  readFile(path.join(root, 'data/release-manifest.json')),
]);
const provenance = buildExportProvenance();
const expectedManifestHash = createHash('sha256').update(releaseManifestBytes).digest('hex');

function fail(message) {
  throw new Error(`export provenance: ${message}`);
}

if (EXPORT_PROVENANCE_SCHEMA_VERSION !== 1 || provenance.schema_version !== 1) fail('schema version must be 1');
if (provenance.app_version !== packageJson.version || metadata.generator?.app_version !== packageJson.version) {
  fail('app version is not synchronized with package.json and metadata.json');
}
if (provenance.data_release.generated_at_utc !== releaseManifest.generated_at_utc) fail('release timestamp is stale');
if (provenance.data_release.source_commit !== releaseManifest.source_commit) fail('release source commit is stale');
if (provenance.data_release.algorithm !== releaseManifest.algorithm) fail('release hash algorithm is stale');
if (provenance.data_release.manifest_sha256 !== expectedManifestHash) fail('release manifest hash is stale');
if (JSON.stringify(provenance.data_release.coverage) !== JSON.stringify(compactCoverage(coverage))) {
  fail('archive coverage summary is stale');
}

const checkedArtifacts = getExportProvenanceArtifacts();
const manifestArtifacts = new Map(releaseManifest.artifacts.map(artifact => [artifact.path, artifact]));
for (const [artifactPath, artifact] of Object.entries(checkedArtifacts)) {
  const expected = manifestArtifacts.get(artifactPath);
  if (!expected) fail(`artifact is absent from release manifest: ${artifactPath}`);
  for (const field of ['bytes', 'sha256', 'source_url', 'source_date', 'schema_version']) {
    if (artifact[field] !== expected[field]) fail(`${artifactPath} ${field} is stale`);
  }
  if (!/^https:\/\//.test(artifact.source_url)) fail(`${artifactPath} source URL is not HTTPS`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.source_date)) fail(`${artifactPath} source date is not absolute`);
}

console.log(`export provenance ok (${Object.keys(checkedArtifacts).length} bound artifacts, ${provenance.data_release.source_commit.slice(0, 12)})`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function compactCoverage(value) {
  return {
    schema_version: value.schema_version,
    generated_at_utc: value.generated_at_utc,
    source_commit: value.source_commit,
    catalog: value.catalog,
    datasets: value.datasets.map(dataset => ({
      id: dataset.id,
      value_status: dataset.value_status,
      lifecycle_status: dataset.lifecycle_status,
      basins: dataset.basins,
      year_range: dataset.year_range,
      end_date: dataset.end_date,
      availability: {
        runnable: dataset.availability?.runnable,
        records: dataset.availability?.records ?? null,
        storms: dataset.availability?.storms ?? null,
        frames: dataset.availability?.frames ?? null,
        advisories: dataset.availability?.advisories ?? null,
        marks: dataset.availability?.marks ?? null,
      },
    })),
  };
}
