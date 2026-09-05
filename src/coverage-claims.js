// What the archive actually covers, in two tiers.
//
// One "1851 to 2025" line implies the whole app reaches back 174 years. The
// best track does; the radar loop starts in 1995, advisory replay covers a
// couple of dozen recent storms, and the surveyed high-water marks fewer
// still. data/coverage.json has held that truth per dataset for a while, and
// the headline copy did not use it.
//
// Both the About dialog and the gate that keeps README honest read these, so
// the two cannot drift apart.

// The layers whose depth is materially shallower than the best track. Anything
// derived from the best track itself covers the same years and is not listed.
export const SHALLOW_LAYERS = Object.freeze(['radar-archive', 'advisory-replay', 'hwm']);

export function bestTrackDepth(coverage) {
  const catalog = coverage?.catalog;
  if (!Array.isArray(catalog?.year_range) || catalog.year_range.length !== 2) return null;
  const [from, to] = catalog.year_range;
  return {
    from,
    to,
    years: to - from + 1,
    storms: catalog.storm_count,
    landfalls: catalog.landfall_event_count,
  };
}

export function layerDepths(coverage, ids = SHALLOW_LAYERS) {
  return ids
    .map(id => (coverage?.datasets || []).find(dataset => dataset.id === id))
    .filter(dataset => Array.isArray(dataset?.year_range) && dataset.year_range.length === 2)
    .map(dataset => ({
      id: dataset.id,
      label: dataset.label || dataset.id,
      from: dataset.year_range[0],
      to: dataset.year_range[1],
      storms: dataset.availability?.storms ?? null,
    }));
}

/**
 * When the next HURDAT2 revision is expected.
 *
 * NHC reissues the database once a year, in the spring, after the hurricane
 * committee meets. Naming the expectation is the difference between a reader
 * knowing the data is current and assuming it has been abandoned.
 */
export function nextRevisionExpectation(metadata) {
  const dates = (metadata?.sources || [])
    .map(source => source.source_date)
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
    .sort();
  const latest = dates.at(-1);
  if (!latest) return null;
  const [year, month] = latest.split('-');
  return { revised: latest, expectedYear: Number(year) + 1, expectedMonth: Number(month) };
}
