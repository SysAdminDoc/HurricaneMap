import assert from 'node:assert/strict';
import impacts from '../data/impacts.json' with { type: 'json' };
import storms from '../data/storms.json' with { type: 'json' };
import { summarizeImpactCoverage } from '../src/impact-coverage.js';

const coverage = summarizeImpactCoverage(storms, stormId => Boolean(impacts[stormId]));
assert.equal(coverage.total, storms.length);
assert.equal(coverage.covered, Object.keys(impacts).length);
assert.equal(coverage.missing, coverage.total - coverage.covered);
assert.equal(coverage.years.reduce((sum, row) => sum + row.covered, 0), coverage.covered);
assert(coverage.years.every(row => row.total === row.covered + row.missing));
assert(coverage.years.some(row => row.covered > 0 && row.missing > 0));

for (const [stormId, impact] of Object.entries(impacts)) {
  assert.equal(impact.impact_provenance.source_title, impact.wiki_title, `${stormId} source title`);
  assert.equal(impact.impact_provenance.source_url, impact.wiki_url, `${stormId} source URL`);
  assert(['high', 'medium', 'low'].includes(impact.impact_confidence), `${stormId} confidence`);
  assert(impact.impact_confidence_reason, `${stormId} confidence reason`);
  assert(impact.deaths || impact.damages, `${stormId} raw source text`);
}

console.log(`impact coverage ok (${coverage.covered} covered, ${coverage.missing} explicitly missing)`);
