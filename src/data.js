// WMO-retired Atlantic hurricane names: name→[years] for quick lookup.
const RETIRED_LOOKUP = Object.freeze({
  CAROL:[1954],HAZEL:[1954],CONNIE:[1955],DIANE:[1955],IONE:[1955],JANET:[1955],
  AUDREY:[1957],DONNA:[1960],CARLA:[1961],HATTIE:[1961],FLORA:[1963],CLEO:[1964],
  HILDA:[1964],BETSY:[1965],INEZ:[1966],BEULAH:[1967],CAMILLE:[1969],CELIA:[1970],
  AGNES:[1972],CARMEN:[1974],FIFI:[1974],ELOISE:[1975],ANITA:[1977],DAVID:[1979],
  FREDERIC:[1979],ALLEN:[1980],ALICIA:[1983],ELENA:[1985],GLORIA:[1985],
  GILBERT:[1988],JOAN:[1988],HUGO:[1989],DIANA:[1990],KLAUS:[1990],BOB:[1991],
  ANDREW:[1992],LUIS:[1995],MARILYN:[1995],OPAL:[1995],ROXANNE:[1995],CESAR:[1996],
  FRAN:[1996],HORTENSE:[1996],GEORGES:[1998],MITCH:[1998],FLOYD:[1999],LENNY:[1999],
  KEITH:[2000],ALLISON:[2001],IRIS:[2001],MICHELLE:[2001],ISIDORE:[2002],LILI:[2002],
  FABIAN:[2003],ISABEL:[2003],JUAN:[2003],CHARLEY:[2004],FRANCES:[2004],IVAN:[2004],
  JEANNE:[2004],DENNIS:[2005],KATRINA:[2005],RITA:[2005],STAN:[2005],WILMA:[2005],
  DEAN:[2007],FELIX:[2007],NOEL:[2007],GUSTAV:[2008],IKE:[2008],PALOMA:[2008],
  IGOR:[2010],TOMAS:[2010],IRENE:[2011],SANDY:[2012],INGRID:[2013],ERIKA:[2015],
  JOAQUIN:[2015],MATTHEW:[2016],OTTO:[2016],HARVEY:[2017],IRMA:[2017],MARIA:[2017],
  NATE:[2017],FLORENCE:[2018],MICHAEL:[2018],DORIAN:[2019],LORENZO:[2019],
  LAURA:[2020],ETA:[2020],IOTA:[2020],IDA:[2021],FIONA:[2022],IAN:[2022],
  IDALIA:[2023],LEE:[2023],BERYL:[2024],HELENE:[2024],MILTON:[2024],
});

export function isRetired(name, year) {
  const years = RETIRED_LOOKUP[(name || '').toUpperCase()];
  return Array.isArray(years) && years.includes(year);
}

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
  impacts: null,       // storm_id -> raw + normalized Wikipedia impact fields
  enso: null,          // year (string) -> ONI value
};

let stormsLoaded = false;
let stormsPromise = null;

async function fetchJson(url, { optional = false, fallback = null, priority } = {}) {
  try {
    const init = priority ? { priority } : {};
    const response = await fetch(url, init);
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
  const [lf, st, md, im, enso] = await Promise.all([
    fetchJson('data/landfalls.json', { priority: 'high' }),
    fetchJson('data/stats.json', { priority: 'high' }),
    fetchJson('data/metadata.json', { optional: true, fallback: null }),
    fetchJson('data/impacts.json', { optional: true, fallback: {} }),
    fetchJson('data/enso.json', { optional: true, fallback: null }),
  ]);
  if (!Array.isArray(lf)) throw new Error('landfalls.json did not contain an array');
  if (!st || typeof st !== 'object') throw new Error('stats.json did not contain an object');
  DATA.landfalls = lf || [];
  DATA.stats = st || { total_storms: 0, total_landfall_events: 0 };
  DATA.metadata = md && typeof md === 'object' ? md : null;
  DATA.impacts = im || {};
  DATA.enso = enso && typeof enso === 'object' ? enso : null;
  return DATA;
}

export function getImpactsFor(stormId) {
  return DATA.impacts?.[stormId] || null;
}

function loadStormsViaWorker() {
  return new Promise((resolve) => {
    const worker = new Worker('src/storms-worker.js');
    worker.addEventListener('message', (e) => {
      worker.terminate();
      if (e.data.ok && Array.isArray(e.data.storms)) resolve(e.data.storms);
      else resolve(null);
    });
    worker.addEventListener('error', () => { worker.terminate(); resolve(null); });
    worker.postMessage('load');
  });
}

async function fetchStormsCompressed() {
  if (typeof DecompressionStream !== 'function') return fetchJson('data/storms.json');
  try {
    const res = await fetch('data/storms.json.gz');
    if (!res.ok) throw new Error(res.status);
    const ds = new DecompressionStream('gzip');
    const reader = res.body.pipeThrough(ds).getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, a) => n + a.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    return JSON.parse(new TextDecoder().decode(merged));
  } catch { return fetchJson('data/storms.json'); }
}

export function ensureStormsLoaded() {
  if (stormsLoaded) return Promise.resolve(DATA);
  if (stormsPromise) return stormsPromise;
  const loader = typeof Worker !== 'undefined'
    ? loadStormsViaWorker().then(storms => storms || fetchStormsCompressed())
    : fetchStormsCompressed();
  stormsPromise = loader
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

export function getEnsoForYear(year) {
  if (!DATA.enso) return null;
  const entry = DATA.enso[String(year)];
  if (!entry) return null;
  if (typeof entry === 'number') {
    const phase = entry >= 0.5 ? 'El Nino' : entry <= -0.5 ? 'La Nina' : 'Neutral';
    return { oni: entry, phase };
  }
  if (typeof entry.oni === 'number') {
    const LABELS = { 'el-nino': 'El Nino', 'la-nina': 'La Nina', 'neutral': 'Neutral' };
    return { oni: entry.oni, phase: LABELS[entry.phase] || 'Neutral' };
  }
  return null;
}

// Filter helpers
export function filterLandfalls(landfalls, filters) {
  return landfalls.filter(lf => {
    if (lf.year < filters.yearMin || lf.year > filters.yearMax) return false;
    if (!categoryAllowed(lf.category, filters.categories)) return false;
    if (filters.state && lf.state !== filters.state) return false;
    if (filters.retiredOnly && !isRetired(lf.name, lf.year)) return false;
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
    const tag = `${lf.name.toLowerCase()} ${lf.year} ${(lf.state || '').toLowerCase()}`;
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

export function windToCategory(kt) {
  if (kt == null || kt < 34) return 0;
  if (kt < 64) return -1;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
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
