import assert from 'node:assert/strict';

globalThis.document = {
  documentElement: { lang: 'en' },
  dispatchEvent() {},
  getElementById() { return null; },
};

const { buildTrackTimelineRows, renderTrackTimeline } = await import('../src/table-view.js');

const track = [
  { t: '2005-08-23T18:00:00Z', lat: 23.1, lon: -75.1, wind: 30 },
  { t: '2005-08-24T18:00:00Z', lat: 25.2, lon: -77.4, wind: 50 },
  { t: '2005-08-25T18:00:00Z', lat: 26.4, lon: -79.2, wind: 83 },
  { t: '2005-08-26T18:00:00Z', lat: 27.6, lon: -81.1, wind: 110 },
];
const landfalls = [{ t: '2005-08-25T18:30:00Z', state: 'Florida' }];
const rows = buildTrackTimelineRows(track, landfalls);

assert.equal(rows.length, track.length);
assert.equal(rows[2].categoryChanged, true);
assert.equal(rows[2].landfalls[0].state, 'Florida');
assert.equal(rows[3].isPeak, true);
assert(rows.filter(row => row.isMilestone).length >= 4, 'timeline omitted hazard milestones');
const ranked = rows.filter(row => row.isMilestone).sort((a, b) => (
  a.hazardRank - b.hazardRank || a.index - b.index
));
assert.equal(ranked[0].landfalls[0].state, 'Florida');
assert(ranked.every((row, index) => index === 0 || row.hazardRank >= ranked[index - 1].hazardRank));

const host = { id: 'track-timeline-host', innerHTML: '' };
renderTrackTimeline(host, { track, us_landfalls: landfalls });
assert.match(host.innerHTML, /track-timeline-highlights/);
assert.match(host.innerHTML, /Landfall: Florida/);
assert.match(host.innerHTML, /Show all 4 chronological observations/);
assert.match(host.innerHTML, /aria-label="Storm hazard highlights ordered by relevance"/);

console.log('track timeline contracts ok (milestones, landfalls, category changes, and accessible markup)');
