// Compact, machine-readable provenance shared by every research export.
// The release gate binds this snapshot to data/metadata.json and
// data/release-manifest.json so exports remain reproducible without fetching
// the full 1,700+ artifact manifest at runtime.

export const EXPORT_PROVENANCE_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.9.1';

const RELEASE = Object.freeze({
  generated_at_utc: '2026-08-03T00:00:00Z',
  source_commit: 'a77210eb5cbf93419997ad1b7f8ce73fb6b6abc1',
  manifest_sha256: 'a9ee850aeebfd2f694fdfc989ea6662bdcb8dfbe8c89f7c31442f260aa1661a0',
  algorithm: 'SHA-256',
});

const ARTIFACTS = Object.freeze({
  'data/forecast-skill.json': Object.freeze({
    path: 'data/forecast-skill.json',
    bytes: 4866,
    sha256: 'b403a3941456b7a7a67b3ea402c81271e22f30f404cd7e310f9902d6eef86846',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-07-25',
    schema_version: 1,
  }),
  'data/hurdat2-atlantic.txt': Object.freeze({
    path: 'data/hurdat2-atlantic.txt',
    bytes: 7082381,
    sha256: '1b9b0c7beed5b4505838658b1d30e159fc84330c60891a58cfcf43ae55c37202',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt',
    source_date: '2026-02-27',
    schema_version: 'HURDAT2-current',
  }),
  'data/hurdat2-nepac.txt': Object.freeze({
    path: 'data/hurdat2-nepac.txt',
    bytes: 4083231,
    sha256: 'db65f8bc538d5c05e15f738c96111861d6ce3572c007879de58e44d4d05a9cd6',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-02272026.txt',
    source_date: '2026-02-27',
    schema_version: 'HURDAT2-current',
  }),
  'data/hurdat2-sources.json': Object.freeze({
    path: 'data/hurdat2-sources.json',
    bytes: 841,
    sha256: 'dfeb522b8f39cac235daa8b893df022d563882c05e8d0c21f932f4a587d49f23',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-02-27',
    schema_version: 1,
  }),
  'data/impacts.json': Object.freeze({
    path: 'data/impacts.json',
    bytes: 225841,
    sha256: 'a7453ef0cc976efaac8ee1e2d878f850a1fe415fb21f8ef6ac1b5239710468eb',
    source_url: 'https://en.wikipedia.org/',
    source_date: '2026-07-25',
    schema_version: 1,
  }),
  'data/landfalls.json': Object.freeze({
    path: 'data/landfalls.json',
    bytes: 142671,
    sha256: '7361e307cfd43dda7a36b32e2babb8ae244d4fc5f6be3f6a95fbc48b7a1aadd1',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-03',
    schema_version: 1,
  }),
  'data/metadata.json': Object.freeze({
    path: 'data/metadata.json',
    bytes: 7154,
    sha256: '9571eba079e39aa456a03f12d64f28dba66ef7bfa5cb042f8dcfbdb2ede6a809',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-03',
    schema_version: 1,
  }),
  'data/storms.json': Object.freeze({
    path: 'data/storms.json',
    bytes: 2299081,
    sha256: '8c462a5c9fa8e49bf79a5ff26b97cc68c1fd4b1dfa77f822373f16920c74ed4b',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-03',
    schema_version: 1,
  }),
  'data/storms.json.gz': Object.freeze({
    path: 'data/storms.json.gz',
    bytes: 234595,
    sha256: '13a51a7fcbaccbe4af1960550cc7da0e4e7e555aa41334af2d9c04081aa16f1a',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-03',
    schema_version: 1,
  }),
});

const ALL_ARTIFACT_PATHS = Object.freeze(Object.keys(ARTIFACTS));

const CITATION_SOURCE_ARTIFACTS = Object.freeze([
  Object.freeze({
    label: 'Atlantic',
    artifact: ARTIFACTS['data/hurdat2-atlantic.txt'],
  }),
  Object.freeze({
    label: 'Eastern Pacific',
    artifact: ARTIFACTS['data/hurdat2-nepac.txt'],
  }),
]);

export function getDataReleasePin() {
  return RELEASE.manifest_sha256;
}

export function getDataReleaseCitationMetadata() {
  const revisionDates = [...new Set(CITATION_SOURCE_ARTIFACTS.map(({ artifact }) => artifact.source_date))];
  return {
    app_version: APP_VERSION,
    release_pin: getDataReleasePin(),
    generated_at_utc: RELEASE.generated_at_utc,
    source_commit: RELEASE.source_commit,
    revision_dates: revisionDates,
    sources: CITATION_SOURCE_ARTIFACTS.map(({ label, artifact }) => ({
      label,
      source_date: artifact.source_date,
      source_url: artifact.source_url,
      sha256: artifact.sha256,
    })),
  };
}

export function buildExportProvenance({
  artifactPaths = ALL_ARTIFACT_PATHS,
  methodology = [],
  exportedAt = null,
} = {}) {
  const paths = [...new Set(artifactPaths)];
  const artifacts = paths.map(path => {
    const artifact = ARTIFACTS[path];
    if (!artifact) throw new Error(`Unknown export provenance artifact: ${path}`);
    return { ...artifact };
  });
  const provenance = {
    schema_version: EXPORT_PROVENANCE_SCHEMA_VERSION,
    app_version: APP_VERSION,
    exported_at_utc: exportedAt || null,
    data_release: {
      ...RELEASE,
      artifacts,
    },
    methodology: [...methodology],
  };
  return provenance;
}

export function getExportProvenanceArtifacts() {
  return Object.fromEntries(ALL_ARTIFACT_PATHS.map(path => [path, { ...ARTIFACTS[path] }]));
}
