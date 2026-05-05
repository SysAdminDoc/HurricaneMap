// Data loading + indexes for HurricaneMap.
// landfalls.json — flat list of every US landfall event (one per L marker).
// storms.json    — full track + metadata, keyed by storm id.
// stats.json     — pre-computed roll-ups (by state, decade, year, category).
// metadata.json  — generated data provenance, coverage, and source details.

const DATA = {
  landfalls: [],
  storms: [],          // populated lazily on first track-render
  stormsById: new Map(),
  stats: null,
  metadata: null,
  impacts: null,       // storm_id -> { deaths, damages, wiki_title, wiki_url }
};

let stormsLoaded = false;
let stormsPromise = null;

async function fetchJson(url, { optional = false, fallback = null } = {}) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (optional) {
      console.warn(`Optional dataset unavailable: ${url}`, error);
      return fallback;
    }
    throw new Error(`Unable to load ${url}: ${error.message || error}`);
  }
}

export async function loadInitial() {
  const [lf, st, md, im] = await Promise.all([
    fetchJson('data/landfalls.json'),
    fetchJson('data/stats.json'),
    fetchJson('data/metadata.json', { optional: true, fallback: null }),
    fetchJson('data/impacts.json', { optional: true, fallback: {} }),
  ]);
  if (!Array.isArray(lf)) throw new Error('landfalls.json did not contain an array');
  if (!st || typeof st !== 'object') throw new Error('stats.json did not contain an object');
  DATA.landfalls = lf || [];
  DATA.stats = st || { total_storms: 0, total_landfall_events: 0 };
  DATA.metadata = md && typeof md === 'object' ? md : null;
  DATA.impacts = im || {};
  return DATA;
}

export function getImpactsFor(stormId) {
  return DATA.impacts?.[stormId] || null;
}

export function ensureStormsLoaded() {
  if (stormsLoaded) return Promise.resolve(DATA);
  if (stormsPromise) return stormsPromise;
  stormsPromise = fetchJson('data/storms.json')
    .then(storms => {
      if (!Array.isArray(storms)) {
        throw new Error('storms.json did not contain an array');
      }
      DATA.storms = storms;
      DATA.stormsById = new Map(storms.map(s => [s.id, s]));
      stormsLoaded = true;
      return DATA;
    })
    .catch(e => {
      console.error('Failed to load storms data:', e);
      DATA.storms = [];
      DATA.stormsById = new Map();
      stormsLoaded = false;
      stormsPromise = null;
      return DATA;
    });
  return stormsPromise;
}

export function getStorm(id) {
  return DATA.stormsById.get(id);
}

export function getAllStorms() {
  return DATA.storms;
}

export function getLandfalls() {
  return DATA.landfalls;
}

export function getStats() {
  return DATA.stats;
}

export function getMetadata() {
  return DATA.metadata;
}

// Filter helpers
export function filterLandfalls(landfalls, filters) {
  return landfalls.filter(lf => {
    if (lf.year < filters.yearMin || lf.year > filters.yearMax) return false;
    if (!categoryAllowed(lf.category, filters.categories)) return false;
    if (filters.state && lf.state !== filters.state) return false;
    return true;
  });
}

function categoryAllowed(cat, allowed) {
  // Validate category is in expected range [-1 (unknown), 0 (TD), TS-5]
  if (typeof cat !== 'number' || cat < -1 || cat > 5) {
    return false; // Reject invalid categories
  }
  if (cat <= 0) return allowed.has('ts');
  return allowed.has(String(cat));
}

// Search index for the search box.
export function searchStorms(query, landfalls) {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  // Year-only search.
  if (/^\d{4}$/.test(q)) {
    const yr = parseInt(q, 10);
    const seen = new Set();
    const out = [];
    for (const lf of landfalls) {
      if (lf.year !== yr) continue;
      if (seen.has(lf.storm_id)) continue;
      seen.add(lf.storm_id);
      out.push(lf);
      if (out.length >= 25) break;
    }
    return out;
  }
  const seen = new Set();
  const out = [];
  for (const lf of landfalls) {
    const tag = `${lf.name.toLowerCase()} ${lf.year}`;
    if (!tag.includes(q)) continue;
    if (seen.has(lf.storm_id)) continue;
    seen.add(lf.storm_id);
    out.push(lf);
    if (out.length >= 25) break;
  }
  return out;
}

// Saffir-Simpson display helpers
export function categoryLabel(cat) {
  if (cat === -1) return 'TS';
  if (cat === 0) return 'TD';
  return `Cat ${cat}`;
}

export function categoryClass(cat) {
  if (cat <= 0) return 'cat-ts';
  return `cat-${cat}`;
}

// Palette-aware. Reads the active palette from settings.js so a single user
// toggle re-themes every dot, track segment, chart bar, and panel pill.
import { getPaletteColor } from './settings.js';
export function categoryColor(cat) {
  return getPaletteColor(cat);
}

export function ktToMph(kt) {
  return kt == null ? null : Math.round(kt * 1.15078);
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}
