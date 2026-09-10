import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCitation, citationCommentLines, HURRICANEMAP_URL } from '../src/citation.js';
import { buildPublicationCSV } from '../src/export.js';
import { buildExports } from '../src/metrics.js';
import { buildQGISGeoJSON } from '../src/qgis.js';
import { generateStatisticalReport } from '../src/report.js';
import { buildTrackSVG } from '../src/svg-export.js';
import {
  createDefaultFilters,
  decodeHashState,
  encodeHashState,
  viewOptionsFromDecoded,
} from '../src/url-state.js';

const accessDate = '2026-08-03';
const citation = buildCitation({ accessDate });
assert.equal(citation.schema_version, 1);
assert.match(citation.apa, /version 1\.10\.0/);
assert.match(citation.apa, /HURDAT2 revision 2026-02-27/);
assert.match(citation.apa, /Atlantic SHA-256: 1b9b0c7beed5/);
assert.match(citation.apa, /Eastern Pacific SHA-256: db65f8bc538/);
assert.match(citation.apa, /Retrieved 2026-08-03/);
assert.match(citation.bibtex, /@software\{hurricanemap_2026/);
assert.match(citation.bibtex, /accessed 2026-08-03/);
assert.match(citation.url, /#v=1&rel=[a-f0-9]{64}$/);

const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
const pinnedHash = encodeHashState(filters, {
  dataRevision: citation.release.release_pin,
  pinDataRevision: true,
  yearMinDefault: 1851,
  yearMaxDefault: 2025,
});
assert.equal(pinnedHash, `#v=1&rel=${citation.release.release_pin}`);
assert.equal(viewOptionsFromDecoded(decodeHashState(pinnedHash)).dataRevision, citation.release.release_pin);

const landfalls = [{
  storm_id: 'AL122005', name: 'KATRINA', year: 2005, t: '2005-08-29T11:10:00Z',
  lat: 29.3, lon: -89.6, wind: 110, pres: 920, category: 3, state: 'Louisiana',
}];
const storms = [{
  id: 'AL122005', name: 'KATRINA', year: 2005, peak_wind_kt: 150,
  landfall_max_category: 3, landfall_max_wind_kt: 110,
  track: [
    { t: '2005-08-23T18:00:00Z', lat: 23.1, lon: -75.1, wind: 30, pres: 1008 },
    { t: '2005-08-28T18:00:00Z', lat: 26.3, lon: -88.6, wind: 150, pres: 902 },
    { t: '2005-08-29T11:10:00Z', lat: 29.3, lon: -89.6, wind: 110, pres: 920 },
  ],
}];
const fixtureFilters = { yearMin: 2005, yearMax: 2005, categories: new Set(['3']), state: 'Louisiana' };

const publication = buildPublicationCSV(fixtureFilters, { landfalls, generatedAt: `${accessDate}T12:34:56.000Z` });
assert.match(publication.csv, /# APA citation: SysAdminDoc\./);
assert.match(publication.csv, /# @software\{hurricanemap_2026/);

const report = generateStatisticalReport(fixtureFilters, {
  landfalls,
  generatedAt: `${accessDate}T12:34:56.000Z`,
  coverageYearRange: [1851, 2025],
  getImpacts: () => ({ deaths_total: 1, damage_millions_usd: 1 }),
});
assert.match(report.markdown, /## Copy-Paste Release Citation/);
assert.match(report.markdown, /@software\{hurricanemap_2026/);

const qgis = buildQGISGeoJSON({ landfalls, storms, filters: fixtureFilters, exportedAt: `${accessDate}T12:34:56.000Z` });
assert.match(qgis.metadata.citation.apa, /HURDAT2 revision 2026-02-27/);

const svg = buildTrackSVG(storms[0], { exportedAt: `${accessDate}T12:34:56.000Z` });
assert.match(svg, /hurricanemap-citation/);
assert.match(svg, /@software\{hurricanemap_2026/);

const stormExports = buildExports(storms[0]);
for (const [kind, result] of Object.entries(stormExports)) {
  assert.match(result.body, /APA citation|"citation"/, `${kind} export is missing its citation`);
  assert.match(result.body, /hurricanemap_20/, `${kind} export is missing BibTeX`);
}

const notebook = readFileSync(new URL('../notebooks/analysis-starter.ipynb', import.meta.url), 'utf8');
assert.match(notebook, /def build_citations\(/);
assert.match(notebook, /APA_CITATION/);
assert.match(notebook, /BIBTEX_CITATION/);

// CITATION.cff is what GitHub reads to offer "Cite this repository", and it is
// a third place the version and the project URLs are written down. Nothing here
// parses YAML: the fields checked are flat top-level scalars, and the indented
// blocks (authors, keywords, references, the folded abstract) are skipped by
// requiring the key to start at column zero. Adding a YAML dependency for this
// would drag in the licence notices and the install policy for one gate.
const citationFile = readFileSync(new URL('../CITATION.cff', import.meta.url), 'utf8');
const cffScalars = new Map();
for (const line of citationFile.split(/\r?\n/)) {
  const match = /^([a-z][a-z-]*): +(.*)$/.exec(line);
  if (!match) continue;
  const value = match[2].trim().replace(/^["'](.*)["']$/, '$1');
  if (value === '>-' || value === '|' || value === '') continue;
  cffScalars.set(match[1], value);
}

for (const required of ['cff-version', 'message', 'title', 'type', 'license', 'version', 'date-released', 'repository-code', 'url']) {
  assert.ok(cffScalars.has(required), `CITATION.cff is missing the required key ${required}`);
}
assert.equal(cffScalars.get('cff-version'), '1.2.0', 'CITATION.cff declares an unexpected schema version');
assert.equal(cffScalars.get('type'), 'software');
assert.match(citationFile, /^authors:\n(\s+-\s|\s+\w)/m, 'CITATION.cff must list at least one author');

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(
  cffScalars.get('version'),
  packageJson.version,
  `CITATION.cff version ${cffScalars.get('version')} does not match package.json ${packageJson.version}`,
);
// Compared against package.json rather than against literals repeated here, so
// these really can be said to fail on drift. package.json carried none of the
// three until 2026-09-08, which is why the first version of this check could
// only ever have caught the version.
assert.equal(cffScalars.get('license'), packageJson.license, 'CITATION.cff licence does not match package.json');
assert.equal(
  `${cffScalars.get('repository-code')}.git`,
  String(packageJson.repository?.url || '').replace(/^git\+/, ''),
  'CITATION.cff repository-code does not match package.json repository.url',
);
assert.equal(cffScalars.get('url'), packageJson.homepage, 'CITATION.cff url does not match package.json homepage');
assert.equal(packageJson.homepage, HURRICANEMAP_URL, 'package.json homepage does not match the URL the app cites');
assert.match(cffScalars.get('date-released'), /^\d{4}-\d{2}-\d{2}$/, 'CITATION.cff date-released must be ISO yyyy-mm-dd');

// When the changelog has already dated this version, the two have to agree.
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
// Both heading shapes are in use: "## v1.9.3: Title (date)" and
// "## v1.9.0 - Title (date)". Requiring the colon meant the date check silently
// did nothing for seven of the released versions.
const releaseHeading = new RegExp(`^## v${packageJson.version.replace(/\./g, '\\.')}[:\\s-][^\\n]*\\((\\d{4}-\\d{2}-\\d{2})\\)`, 'm').exec(changelog);
if (releaseHeading) {
  assert.equal(
    cffScalars.get('date-released'),
    releaseHeading[1],
    `CITATION.cff date-released ${cffScalars.get('date-released')} disagrees with the changelog heading ${releaseHeading[1]}`,
  );
}

// ---------------------------------------------------------------- per storm
//
// Every storm page used to emit the same BibTeX key and the same title, so two
// storms could not sit in one bibliography and neither entry recorded which
// storm the reader actually used. The key takes the HURDAT2 id rather than the
// name, because names repeat across basins and decades and ids do not.
{
  const katrina = buildCitation({
    accessDate: '2026-08-03',
    url: 'https://sysadmindoc.github.io/HurricaneMap/storms/katrina-2005/',
    storm: { id: 'AL122005', name: 'Katrina', year: 2005 },
  });
  const andrew = buildCitation({
    accessDate: '2026-08-03',
    url: 'https://sysadmindoc.github.io/HurricaneMap/storms/andrew-1992/',
    storm: { id: 'AL041992', name: 'Andrew', year: 1992 },
  });

  const keyOf = citation => citation.bibtex.match(/@software\{([^,]+),/)?.[1];
  assert.equal(keyOf(katrina), 'hurricanemap_al122005_2026');
  assert.equal(keyOf(andrew), 'hurricanemap_al041992_2026');
  assert.notEqual(keyOf(katrina), keyOf(andrew), 'two storms must not share a BibTeX key');

  // The entry has to say which storm it is, in both directions a reader reads.
  assert.match(katrina.apa, /Katrina \(2005\) \[AL122005\]/);
  assert.match(katrina.bibtex, /title = \{Katrina \(2005\) in HurricaneMap/);
  assert.match(andrew.apa, /Andrew \(1992\) \[AL041992\]/);

  // Two storms named the same in different years stay distinct, which is the
  // case a name-derived key would collide on.
  const earlier = buildCitation({ accessDate: '2026-08-03', storm: { id: 'AL091995', name: 'Opal', year: 1995 } });
  const later = buildCitation({ accessDate: '2026-08-03', storm: { id: 'AL152021', name: 'Opal', year: 2021 } });
  assert.notEqual(keyOf(earlier), keyOf(later), 'a repeated storm name must still produce distinct keys');

  // Without a storm the release citation is unchanged.
  const release = buildCitation({ accessDate: '2026-08-03' });
  assert.equal(keyOf(release), 'hurricanemap_2026');
  assert.doesNotMatch(release.apa, /\[AL\d{6}\]/);

  // RIS travels beside APA and BibTeX everywhere they appear.
  for (const citation of [release, katrina]) {
    assert.match(citation.ris, /^TY {2}- DATA$/m);
    assert.match(citation.ris, /^ER {2}- ?$/m);
    assert.match(citation.ris, new RegExp(`^UR {2}- ${citation.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.match(katrina.ris, /^TI {2}- Katrina \(2005\) in HurricaneMap/m);

  const lines = citationCommentLines(katrina, '# ');
  assert.ok(lines.some(line => line.includes('APA citation:')), 'export comments lost APA');
  assert.ok(lines.some(line => line.includes('BibTeX citation:')), 'export comments lost BibTeX');
  assert.ok(lines.some(line => line.includes('RIS citation:')), 'export comments never gained RIS');
}

// ------------------------------------------------- RIS on every surface
//
// "Everywhere APA and BibTeX appear" was claimed once and was true of three
// surfaces out of eight. The KML description, the markdown report, the QGIS
// GeoJSON metadata and the track SVG each inline their own citation block
// rather than going through citationCommentLines, so none of them picked RIS
// up when it was added to the shared helper.
//
// Named one by one rather than counted, so a surface that stops carrying a
// citation is a failure that says which one, instead of a total that quietly
// drops by one. These reuse the fixtures built above, so they exercise the same
// objects the assertions above already trust.
{
  const named = [
    ['publication csv', publication.csv],
    ['report markdown', report.markdown],
    ['qgis geojson', JSON.stringify(qgis)],
    ['track svg', svg],
    ...Object.entries(stormExports).map(([kind, result]) => [`export:${kind}`, result.body]),
  ];
  for (const [name, text] of named) {
    const body = String(text || '');
    assert.ok(body.length > 0, `${name} produced nothing, so this assertion proves nothing`);
    assert.match(body, /(APA|"apa")/i, `${name} lost its APA citation`);
    assert.match(body, /(bibtex|@software)/i, `${name} lost its BibTeX citation`);
    assert.match(body, /(TY {2}- DATA|"ris")/, `${name} carries APA and BibTeX but not the RIS record`);
  }
  assert.ok(named.length >= 7, `only ${named.length} export surfaces were checked`);
}

console.log('citation contracts ok (APA, BibTeX, exports, notebook, pinned URLs, and CITATION.cff)');
