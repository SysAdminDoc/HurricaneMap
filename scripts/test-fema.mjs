import assert from 'node:assert/strict';

import {
  FEMA_QUERY_LIMIT,
  buildFemaQuery,
  clearFemaCache,
  fetchFemaDeclarations,
  formatFemaDate,
  getFemaStormWindow,
  normalizeFemaRows,
} from '../src/fema.js';
import { getOptionalFeedState } from '../src/optional-feeds.js';

const storm = {
  name: 'KATRINA',
  track: [
    { t: '2005-08-23T00:00:00Z' },
    { t: '2005-09-01T00:00:00Z' },
  ],
};

const rows = [
  {
    femaDeclarationString: 'DR-1603-LA',
    disasterNumber: 1603,
    state: 'LA',
    declarationType: 'DR',
    declarationDate: '2005-08-29T00:00:00.000Z',
    incidentType: 'Hurricane',
    declarationTitle: 'HURRICANE KATRINA',
    incidentBeginDate: '2005-08-23T00:00:00.000Z',
    incidentEndDate: '2005-09-15T00:00:00.000Z',
    designatedArea: 'Orleans (Parish)',
  },
  {
    femaDeclarationString: 'DR-1603-LA',
    disasterNumber: 1603,
    state: 'LA',
    declarationType: 'DR',
    declarationDate: '2005-08-29T00:00:00.000Z',
    incidentType: 'Hurricane',
    declarationTitle: 'HURRICANE KATRINA',
    incidentBeginDate: '2005-08-23T00:00:00.000Z',
    incidentEndDate: '2005-09-15T00:00:00.000Z',
    designatedArea: 'Jefferson (Parish)',
  },
  {
    femaDeclarationString: 'EM-3263-DE',
    disasterNumber: 3263,
    state: 'DE',
    declarationType: 'EM',
    declarationDate: '2005-08-30T00:00:00.000Z',
    incidentType: 'Hurricane',
    declarationTitle: 'HURRICANE KATRINA EVACUATION',
    incidentBeginDate: '2005-08-25T00:00:00.000Z',
    incidentEndDate: '2005-09-02T00:00:00.000Z',
    designatedArea: 'Statewide (State)',
  },
  {
    femaDeclarationString: 'DR-1604-LA',
    disasterNumber: 1604,
    state: 'LA',
    declarationType: 'DR',
    declarationTitle: 'HURRICANE RITA',
    incidentBeginDate: '2005-08-23T00:00:00.000Z',
    incidentEndDate: '2005-09-15T00:00:00.000Z',
    designatedArea: 'Cameron (Parish)',
  },
  {
    femaDeclarationString: 'DR-1100-LA',
    disasterNumber: 1100,
    state: 'LA',
    declarationType: 'DR',
    declarationTitle: 'HURRICANE KATRINA',
    incidentBeginDate: '2004-08-23T00:00:00.000Z',
    incidentEndDate: '2004-09-15T00:00:00.000Z',
    designatedArea: 'Old Parish (Parish)',
  },
];

const window = getFemaStormWindow(storm);
assert(window.start < '2005-08-23T00:00:00.000Z' && window.end > '2005-09-01T00:00:00.000Z');

const query = buildFemaQuery(storm);
const queryUrl = new URL(query);
const filter = queryUrl.searchParams.get('$filter');
assert.match(filter, /contains\(declarationTitle,'KATRINA'\)/);
assert.match(filter, /incidentBeginDate le '2005-09-08T00:00:00\.000Z'/);
assert.match(filter, /incidentEndDate ge '2005-08-16T00:00:00\.000Z'/);
assert.equal(queryUrl.searchParams.get('$top'), String(FEMA_QUERY_LIMIT));
assert(queryUrl.searchParams.get('$select')?.includes('designatedArea'));

const normalized = normalizeFemaRows(rows, storm);
assert.equal(normalized.length, 2, 'title/date matching must discard unrelated declarations');
assert.deepEqual(normalized[0].states, [
  { state: 'LA', areas: ['Jefferson (Parish)', 'Orleans (Parish)'] },
]);
assert.equal(normalized[0].declarationType, 'DR');
assert.equal(normalized[0].disasterNumber, 1603);
assert.equal(normalized[0].recordUrl, 'https://www.fema.gov/disaster/1603');
assert.equal(normalized[1].states[0].state, 'DE');

clearFemaCache();
let fetchCount = 0;
const response = {
  ok: true,
  status: 200,
  async json() { return { DisasterDeclarationsSummaries: rows }; },
};
const fetchImpl = async () => {
  fetchCount += 1;
  return response;
};
const fetched = await fetchFemaDeclarations(storm, { fetchImpl });
assert.equal(fetched.status, 'success');
assert.equal(fetched.records.length, 2);
const cached = await fetchFemaDeclarations(storm, { fetchImpl });
assert.equal(cached.cacheOrigin, 'memory');
assert.equal(fetchCount, 1, 'repeat panel opens should use the memory cache');
assert.equal(getOptionalFeedState('fema').state, 'success');

clearFemaCache();
const empty = await fetchFemaDeclarations(storm, {
  fetchImpl: async () => ({ ok: true, status: 200, async json() { return { DisasterDeclarationsSummaries: [] }; } }),
});
assert.equal(empty.status, 'empty');
assert.equal(empty.reason, 'no-match');
assert.equal(getOptionalFeedState('fema').state, 'empty');

clearFemaCache();
const unavailable = await fetchFemaDeclarations(storm, {
  fetchImpl: async () => ({ ok: false, status: 503 }),
});
assert.equal(unavailable.status, 'error');
assert.equal(unavailable.responseStatus, 503);
assert.equal(getOptionalFeedState('fema').state, 'stale', 'a failed refresh should retain the last-good optional-feed state');

clearFemaCache();
let malformed = await fetchFemaDeclarations(storm, {
  fetchImpl: async () => ({ ok: true, status: 200, async json() { return {}; } }),
});
assert.equal(malformed.status, 'error');

clearFemaCache();
let called = false;
const unnamed = await fetchFemaDeclarations({ name: 'UNNAMED', track: storm.track }, {
  fetchImpl: async () => { called = true; throw new Error('should not fetch unnamed storms'); },
});
assert.equal(unnamed.status, 'empty');
assert.equal(called, false);
assert.equal(formatFemaDate('2005-08-29T00:00:00.000Z', 'en-US'), 'Aug 29, 2005');

console.log('FEMA context contract ok (query bounds, title/date matching, grouping, cache, empty, failure)');
