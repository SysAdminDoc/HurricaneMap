// Compact, machine-readable provenance shared by every research export.
// The release gate binds this snapshot to data/metadata.json and
// data/release-manifest.json so exports remain reproducible without fetching
// the full 1,700+ artifact manifest at runtime.

export const EXPORT_PROVENANCE_SCHEMA_VERSION = 1;

const RELEASE = Object.freeze({
  generated_at_utc: '2026-08-02T00:00:00Z',
  source_commit: '3acb8db075ee106e12beddb075a064b0d421cf0c',
  manifest_sha256: 'e9f089057daa803ab845ef796c52bd1b1b20d46d51798cb4b476642594d0ba0f',
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
    bytes: 129824,
    sha256: '45accf325a95d241f768cb8c93a1d67064d4ba2b16da458209048369ab1f452f',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-02',
    schema_version: 1,
  }),
  'data/metadata.json': Object.freeze({
    path: 'data/metadata.json',
    bytes: 3013,
    sha256: 'f37d73a4a5c806374b172ebf6cbc875389671909101d27177c138521b9b3bd18',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-02',
    schema_version: 1,
  }),
  'data/storms.json': Object.freeze({
    path: 'data/storms.json',
    bytes: 2299081,
    sha256: '8c462a5c9fa8e49bf79a5ff26b97cc68c1fd4b1dfa77f822373f16920c74ed4b',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-02',
    schema_version: 1,
  }),
  'data/storms.json.gz': Object.freeze({
    path: 'data/storms.json.gz',
    bytes: 234595,
    sha256: '13a51a7fcbaccbe4af1960550cc7da0e4e7e555aa41334af2d9c04081aa16f1a',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-02',
    schema_version: 1,
  }),
});

const ALL_ARTIFACT_PATHS = Object.freeze(Object.keys(ARTIFACTS));

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
    app_version: '1.9.0',
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
