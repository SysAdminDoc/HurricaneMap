import assert from 'node:assert/strict';

import { getDamageMillions, getFatalityCount, tornadoSearchHint, tornadoSearchUrl } from '../src/impact-utils.js';
import { getCoverageYearRange } from '../src/data.js';
import { buildPublicationCSV, csvEscape, publicationCategoryLabel } from '../src/export.js';
import { inflateUSD } from '../src/inflation.js';
import { buildFilterTitle, findImpactLeader, generateStatisticalReport } from '../src/report.js';

const landfalls = [
  { storm_id: 'ALPHA2000', name: 'ALPHA', year: 2000, wind: 80 },
  { storm_id: 'BETA2001', name: 'BETA', year: 2001, wind: 90 },
  { storm_id: 'ALPHA2000', name: 'ALPHA', year: 2000, wind: 60 },
];

const impacts = {
  ALPHA2000: { deaths_total: 12, damage_millions_usd: 450 },
  BETA2001: { deaths_total: 2, damage_millions_usd: 1500 },
};

assert.equal(findImpactLeader(landfalls, getFatalityCount, { getImpacts: id => impacts[id] }).storm_id, 'ALPHA2000');
assert.equal(findImpactLeader(landfalls, getDamageMillions, { getImpacts: id => impacts[id] }).storm_id, 'BETA2001');

assert.equal(csvEscape('=HYPERLINK("https://example.com")', { preventFormula: true }), `"'=HYPERLINK(""https://example.com"")"`);
assert.equal(csvEscape('-89.600', { preventFormula: false }), '-89.600');
assert.equal(csvEscape('Louisiana, USA'), '"Louisiana, USA"');
assert.equal(publicationCategoryLabel(0), 'TD');
assert.equal(publicationCategoryLabel(-1), 'TS');

assert.deepEqual(getCoverageYearRange({ coverage: { year_range: [2026, 1851] } }), [1851, 2026]);
assert.equal(
  buildFilterTitle({ yearMin: 1851, yearMax: 2026, categories: new Set(['ts', '1', '2', '3', '4', '5']), state: '' }, [1851, 2026]),
  'All landfalls (1851-2026, all categories, all states)',
);

const exportLandfalls = [
  { storm_id: 'ALPHA2000', name: 'ALPHA', year: 2000, t: '2000-08-01T12:00:00Z', wind: 80, category: 1, state: 'Florida' },
  { storm_id: 'BETA2001', name: 'BETA', year: 2001, t: '2001-09-01T12:00:00Z', wind: 90, category: 2, state: 'Louisiana' },
];
const exportFilters = { yearMin: 2000, yearMax: 2001, categories: new Set(['1', '2']), state: '' };
const publication = buildPublicationCSV(exportFilters, {
  landfalls: exportLandfalls,
  generatedAt: '2026-08-02T12:34:56.000Z',
});
assert.equal(publication.provenance.schema_version, 1);
assert.match(publication.csv, /# Provenance \(JSON, schema v1\):/);

const report = generateStatisticalReport(exportFilters, {
  landfalls: exportLandfalls,
  generatedAt: '2026-08-02T12:34:56.000Z',
  coverageYearRange: [1851, 2025],
  getImpacts: id => impacts[id],
});
assert.equal(report.provenance.schema_version, 1);
assert.match(report.markdown, /## Release Provenance/);

const futureDamage = inflateUSD(125, 2025);
assert.deepEqual(futureDamage, { real: 125, factor: 1, baseYear: 2025, currentDollars: true });

// This used to assert statefips === '22,LOUISIANA,28,MISSISSIPPI,12,FLORIDA'.
// That assertion was wrong: it pinned the shape of a parameter the destination
// ignores. NCEI's Storm Events is now a client-rendered app that reads no
// filters from the URL, so the old link opened an unfiltered landing page while
// the test reported the filter as correct. The contract is now the gating (who
// gets a link at all) and the search terms handed to the reader.
const katrina = {
  year: 2005,
  track: [{ t: '2005-08-23T18:00:00Z' }, { t: '2005-08-31T18:00:00Z' }],
  us_landfalls: [{ state: 'Louisiana' }, { state: 'Mississippi' }, { state: 'Florida' }, { state: 'Oregon' }],
};
const tornadoUrl = tornadoSearchUrl(katrina);
assert.equal(tornadoUrl, 'https://www.ncei.noaa.gov/access/storm-events-database/search');
assert.equal(new URL(tornadoUrl).search, '', 'no query string: every parameter form is ignored by the destination');
// The parts stay separate so the sentence around them can be translated: the
// connective used to be a hardcoded English "to" inside the Spanish and Haitian
// Creole strings. State names are deliberately not translated, because they are
// typed into an English form.
assert.deepEqual(
  tornadoSearchHint(katrina),
  { states: 'Louisiana, Mississippi, Florida', from: '2005-08-23', to: '2005-08-31' },
  'the reader gets the terms the link cannot carry, and Oregon is dropped as uncovered',
);
// Storm Events begins in 1950, and a storm with no covered landfall state has
// nothing to look up, so neither gets a link at all.
assert.equal(tornadoSearchUrl({ ...katrina, year: 1949 }), null);
assert.equal(tornadoSearchHint({ ...katrina, year: 1949 }), null);
assert.equal(tornadoSearchUrl({ ...katrina, us_landfalls: [{ state: 'Oregon' }] }), null);
assert.equal(tornadoSearchUrl({ ...katrina, us_landfalls: [] }), null);
assert.equal(tornadoSearchUrl({ ...katrina, track: [{ t: 'not a date' }] }), null);
assert.equal(tornadoSearchUrl({ ...katrina, track: [] }), null);

console.log('report export ok');
