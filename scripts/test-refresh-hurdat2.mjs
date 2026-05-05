import assert from 'node:assert/strict';

import {
  extractHurdatLinks,
  normalizeHurdatText,
  parseHurdatFilename,
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

const latest = selectLatestHurdatFiles(fixture);
assert.equal(latest.atlantic.file, 'hurdat2-1851-2025-02272026.txt', 'latest Atlantic file should prefer newest coverage year');
assert.equal(latest.nepac.file, 'hurdat2-nepac-1949-2025-02272026.txt', 'latest NEPAC file should prefer newest coverage year');

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
