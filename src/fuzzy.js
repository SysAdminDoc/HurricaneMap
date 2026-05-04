// Tiny Levenshtein implementation for fuzzy storm-name search. Used as a
// fallback when no substring match is found, so "Catrina" → Katrina,
// "Andrwe" → Andrew. Capped at distance 2 to avoid noise.
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  // Two-row dynamic programming.
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

// Fuzzy-augment a base substring search. Adds storms whose name is within
// `maxDist` edits of the query, ranked by distance asc + recency desc.
export function fuzzyAugment(query, landfalls, alreadyMatched, { maxDist = 2, limit = 25 } = {}) {
  const q = query.trim().toLowerCase();
  if (q.length < 4) return [];
  const seen = new Set(alreadyMatched.map(lf => lf.storm_id));
  const candidates = [];
  for (const lf of landfalls) {
    if (seen.has(lf.storm_id)) continue;
    const name = lf.name.toLowerCase();
    if (name === 'unnamed') continue;
    // Skip already-substring matches (handled elsewhere) and obvious non-matches.
    if (name.includes(q)) continue;
    if (Math.abs(name.length - q.length) > maxDist) continue;
    const d = levenshtein(name, q);
    if (d <= maxDist) {
      candidates.push({ lf, d });
      seen.add(lf.storm_id);
    }
  }
  candidates.sort((a, b) => a.d - b.d || b.lf.year - a.lf.year);
  return candidates.slice(0, limit).map(c => c.lf);
}
