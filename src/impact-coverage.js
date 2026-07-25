export function summarizeImpactCoverage(storms, hasImpact) {
  const byYear = new Map();
  const seen = new Set();
  for (const storm of Array.isArray(storms) ? storms : []) {
    if (!storm?.id || seen.has(storm.id) || !Number.isInteger(storm.year)) continue;
    seen.add(storm.id);
    const row = byYear.get(storm.year) || { year: storm.year, total: 0, covered: 0, missing: 0 };
    row.total += 1;
    if (hasImpact(storm.id)) row.covered += 1;
    else row.missing += 1;
    byYear.set(storm.year, row);
  }
  const years = [...byYear.values()].sort((a, b) => a.year - b.year);
  return {
    total: years.reduce((sum, row) => sum + row.total, 0),
    covered: years.reduce((sum, row) => sum + row.covered, 0),
    missing: years.reduce((sum, row) => sum + row.missing, 0),
    years,
  };
}
