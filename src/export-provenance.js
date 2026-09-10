// Compact, machine-readable provenance shared by every research export.
// The release gate binds this snapshot to data/metadata.json and
// data/release-manifest.json so exports remain reproducible without fetching
// the full 1,700+ artifact manifest at runtime.

export const EXPORT_PROVENANCE_SCHEMA_VERSION = 1;
const APP_VERSION = '1.9.3';

const RELEASE = Object.freeze({
  generated_at_utc: '2026-08-08T00:00:00Z',
  source_commit: '177e0f9c5411ed1499e1d69059882e357cce6e9d',
  manifest_sha256: '4b40b2f37c3cac8422ebed0c9033cbd6316ec42d09447f222177458100cd3c24',
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
  'data/coverage.json': Object.freeze({
    path: 'data/coverage.json',
    bytes: 16950,
    sha256: 'b632a143a1f5eec3aea9894194f9381807cbb2c196f64c5ae75ff3c86cca8362',
    source_url: 'https://github.com/SysAdminDoc/HurricaneMap',
    source_date: '2026-08-08',
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
    bytes: 223946,
    sha256: '0b69f2965353583f2638f59285f48c53fba473f116b530bfaab853c19723cadb',
    source_url: 'https://en.wikipedia.org/',
    source_date: '2026-07-25',
    schema_version: 1,
  }),
  'data/landfalls.json': Object.freeze({
    path: 'data/landfalls.json',
    bytes: 141563,
    sha256: 'e4d21ef815c41773f4630875c7e7d13c63ffa102350f77bc848084b3f35b68dc',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-08',
    schema_version: 1,
  }),
  'data/metadata.json': Object.freeze({
    path: 'data/metadata.json',
    bytes: 7819,
    sha256: 'd3e36b14e41ad6a9244378e2b27b8f3edb90715ec0a8ff955ec93eb1367ca260',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-08',
    schema_version: 1,
  }),
  'data/storms.json': Object.freeze({
    path: 'data/storms.json',
    bytes: 2275482,
    sha256: '42dca908a6ac22766ef991243b2238c560a7110050e6dba6a620bfefc0e1950c',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-08',
    schema_version: 1,
  }),
  'data/storms.json.gz': Object.freeze({
    path: 'data/storms.json.gz',
    bytes: 232295,
    sha256: 'ec727afea5654942e1c69fe80232c1ef358ebcb7cdc2dfa81a423fa38ffe67d6',
    source_url: 'https://www.nhc.noaa.gov/data/hurdat/',
    source_date: '2026-08-08',
    schema_version: 1,
  }),
});

const COVERAGE = Object.freeze({
  schema_version: 1,
  generated_at_utc: '2026-08-08T00:00:00Z',
  source_commit: '177e0f9c5411ed1499e1d69059882e357cce6e9d',
  catalog: Object.freeze({
    basins: ['AL', 'EP'],
    year_range: [1851, 2025],
    storm_count: 590,
    landfall_event_count: 753,
    hurricane_landfall_count: 370,
  }),
  datasets: Object.freeze([
    Object.freeze({ id: 'hurdat2', value_status: 'final', lifecycle_status: 'active', basins: ['AL', 'EP'], year_range: [1851, 2025], end_date: '2025-12-31', availability: Object.freeze({ runnable: true, records: 753, storms: 590, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'aoml-landfalls', value_status: 'final', lifecycle_status: 'active', basins: ['AL'], year_range: [1851, 2025], end_date: '2025-12-31', availability: Object.freeze({ runnable: true, records: 386, storms: null, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'storm-impacts', value_status: 'inferred', lifecycle_status: 'active', basins: ['AL', 'EP'], year_range: [1950, 2025], end_date: '2025-12-31', availability: Object.freeze({ runnable: true, records: 242, storms: 242, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'ncei-billions', value_status: 'closed', lifecycle_status: 'closed', basins: ['AL', 'EP'], year_range: [1980, 2024], end_date: '2024-12-31', availability: Object.freeze({ runnable: false, records: 65, storms: 65, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'enso', value_status: 'final', lifecycle_status: 'active', basins: [], year_range: [1950, 2025], end_date: '2025-12-31', availability: Object.freeze({ runnable: true, records: 76, storms: null, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'seasonal-outlook', value_status: 'operational', lifecycle_status: 'active', basins: ['AL'], year_range: [2026, 2026], end_date: '2026-12-31', availability: Object.freeze({ runnable: true, records: 2, storms: null, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'forecast-skill', value_status: 'final', lifecycle_status: 'active', basins: ['AL', 'EP'], year_range: [2021, 2025], end_date: '2025-12-31', availability: Object.freeze({ runnable: true, records: 18, storms: null, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'advisory-replay', value_status: 'operational', lifecycle_status: 'active', basins: ['AL'], year_range: [2008, 2024], end_date: '2024-12-31', availability: Object.freeze({ runnable: true, records: null, storms: 51, frames: null, advisories: 1667, marks: null }) }),
    Object.freeze({ id: 'storm-events', value_status: 'final', lifecycle_status: 'active', basins: ['AL'], year_range: [1953, 2024], end_date: '2025-12-31', availability: Object.freeze({ runnable: true, records: 155, storms: 155, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'rainfall', value_status: 'final', lifecycle_status: 'active', basins: ['AL'], year_range: [1950, 2020], end_date: '2024-12-31', availability: Object.freeze({ runnable: true, records: 211, storms: 211, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'radar-archive', value_status: 'final', lifecycle_status: 'active', basins: ['AL', 'EP'], year_range: [1995, 2025], end_date: null, availability: Object.freeze({ runnable: true, records: null, storms: 139, frames: 1703, advisories: null, marks: null }) }),
    Object.freeze({ id: 'hwm', value_status: 'final', lifecycle_status: 'active', basins: ['AL'], year_range: [2003, 2024], end_date: null, availability: Object.freeze({ runnable: true, records: null, storms: 25, frames: null, advisories: null, marks: 10741 }) }),
    Object.freeze({ id: 'tide-stations', value_status: 'final', lifecycle_status: 'active', basins: [], year_range: null, end_date: null, availability: Object.freeze({ runnable: true, records: 301, storms: null, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'storm-boundaries', value_status: 'final', lifecycle_status: 'active', basins: [], year_range: null, end_date: null, availability: Object.freeze({ runnable: true, records: 52, storms: null, frames: null, advisories: null, marks: null }) }),
    Object.freeze({ id: 'glossary', value_status: 'final', lifecycle_status: 'active', basins: [], year_range: null, end_date: null, availability: Object.freeze({ runnable: true, records: 20, storms: null, frames: null, advisories: null, marks: null }) }),
  ]),
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
      coverage: COVERAGE,
      artifacts,
    },
    methodology: [...methodology],
  };
  return provenance;
}

export function getExportProvenanceArtifacts() {
  return Object.fromEntries(ALL_ARTIFACT_PATHS.map(path => [path, { ...ARTIFACTS[path] }]));
}
