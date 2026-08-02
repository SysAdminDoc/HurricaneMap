import assert from 'node:assert/strict';

import {
  extractHurdatLinks,
  buildSourceManifest,
  normalizeHurdatText,
  parseHurdatFilename,
  revisionDateFromKey,
  selectLatestHurdatFiles,
} from './refresh-hurdat2.mjs';

const fixture = `
<a href="hurdat2-1851-2024-040225.txt">old atl</a>
<a href="hurdat2-1851-2025-02272026.txt">new atl</a>
<a href="hurdat2-atl-02052024.txt">legacy atl no coverage year</a>
<a href="hurdat2-nepac-1949-2024-031725.txt">old nepac</a>
<a href="hurdat2-nepac-1949-2025-02272026.txt">new nepac</a>
<a href="tracks_atl_readme.txt">not hurdat2</a>
`;

const links = extractHurdatLinks(fixture);
assert.deepEqual(links, [
  'hurdat2-1851-2024-040225.txt',
  'hurdat2-1851-2025-02272026.txt',
  'hurdat2-atl-02052024.txt',
  'hurdat2-nepac-1949-2024-031725.txt',
  'hurdat2-nepac-1949-2025-02272026.txt',
], 'directory parser should only keep HURDAT2 text links');

assert.deepEqual(parseHurdatFilename('hurdat2-1851-2025-02272026.txt'), {
  basin: 'atlantic',
  file: 'hurdat2-1851-2025-02272026.txt',
  endYear: 2025,
  revisionKey: '20260227',
}, 'Atlantic filename parser should read coverage year and revision date');

assert.deepEqual(parseHurdatFilename('hurdat2-nepac-1949-2024-031725.txt'), {
  basin: 'nepac',
  file: 'hurdat2-nepac-1949-2024-031725.txt',
  endYear: 2024,
  revisionKey: '20250317',
}, 'NEPAC filename parser should normalize six-digit revision dates');

assert.equal(parseHurdatFilename('hurdat2-atl-02052024.txt'), null, 'legacy Atlantic snapshot without coverage year should not be selected');
assert.equal(revisionDateFromKey('20260227'), '2026-02-27', 'revision key should expose an absolute source date');
assert.equal(revisionDateFromKey('20250317suffix'), '2025-03-17', 'revision date should ignore a filename suffix');
assert.throws(() => revisionDateFromKey('not-a-date'), /Invalid HURDAT2 revision key/);

const latest = selectLatestHurdatFiles(fixture);
assert.equal(latest.atlantic.file, 'hurdat2-1851-2025-02272026.txt', 'latest Atlantic file should prefer newest coverage year');
assert.equal(latest.nepac.file, 'hurdat2-nepac-1949-2025-02272026.txt', 'latest NEPAC file should prefer newest coverage year');

assert.deepEqual(buildSourceManifest([
  {
    key: 'atlantic',
    localPath: 'data/hurdat2-atlantic.txt',
    file: latest.atlantic.file,
    url: `https://www.nhc.noaa.gov/data/hurdat/${latest.atlantic.file}`,
    sourceDate: '2026-02-27',
    bytes: 123,
    newSha256: 'a'.repeat(64),
  },
  {
    key: 'nepac',
    localPath: 'data/hurdat2-nepac.txt',
    file: latest.nepac.file,
    url: `https://www.nhc.noaa.gov/data/hurdat/${latest.nepac.file}`,
    sourceDate: '2026-02-27',
    bytes: 456,
    newSha256: 'b'.repeat(64),
  },
]), {
  schema_version: 1,
  sources: [
    {
      id: 'atlantic',
      basin: 'AL',
      local_path: 'data/hurdat2-atlantic.txt',
      source_file: latest.atlantic.file,
      source_url: `https://www.nhc.noaa.gov/data/hurdat/${latest.atlantic.file}`,
      source_date: '2026-02-27',
      bytes: 123,
      sha256: 'a'.repeat(64),
    },
    {
      id: 'nepac',
      basin: 'EP',
      local_path: 'data/hurdat2-nepac.txt',
      source_file: latest.nepac.file,
      source_url: `https://www.nhc.noaa.gov/data/hurdat/${latest.nepac.file}`,
      source_date: '2026-02-27',
      bytes: 456,
      sha256: 'b'.repeat(64),
    },
  ],
}, 'source manifest should be a stable, revision-addressable lock');

const sameYearFixture = `
<a href="hurdat2-1851-2024-040225.txt">older same year</a>
<a href="hurdat2-1851-2024-040425.txt">newer same year</a>
<a href="hurdat2-nepac-1949-2025-02262026.txt">older same year</a>
<a href="hurdat2-nepac-1949-2025-02272026.txt">newer same year</a>
`;
const sameYear = selectLatestHurdatFiles(sameYearFixture);
assert.equal(sameYear.atlantic.file, 'hurdat2-1851-2024-040425.txt', 'same-year Atlantic selection should prefer latest revision');
assert.equal(sameYear.nepac.file, 'hurdat2-nepac-1949-2025-02272026.txt', 'same-year NEPAC selection should prefer latest revision');

assert.equal(normalizeHurdatText('a\r\nb\rc\n'), 'a\nb\nc\n', 'normalization should collapse CRLF/CR line endings');
assert.throws(() => selectLatestHurdatFiles('<a href="hurdat2-1851-2025-02272026.txt">atl only</a>'), /both current HURDAT2 files/, 'missing basin should fail loudly');

console.log('hurdat2 refresh utils ok');
