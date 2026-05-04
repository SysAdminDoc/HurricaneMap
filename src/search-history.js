// Last-N viewed storms, persisted to localStorage. Surfaces as a dropdown
// when the search input gains focus with an empty value.
const KEY = 'hm-search-history-v1';
const MAX_ENTRIES = 8;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_ENTRIES) : [];
  } catch (e) { return []; }
}
function save(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX_ENTRIES))); } catch (e) { /* quota */ }
}

export function recordView(landfall) {
  if (!landfall || !landfall.storm_id) return;
  const arr = load();
  const filtered = arr.filter(e => !(e.storm_id === landfall.storm_id && e.year === landfall.year));
  filtered.unshift({
    storm_id: landfall.storm_id,
    name: landfall.name,
    year: landfall.year,
    category: landfall.category,
    state: landfall.state,
    t: landfall.t,
    lat: landfall.lat,
    lon: landfall.lon,
  });
  save(filtered);
}

export function getHistory() {
  return load();
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
}
