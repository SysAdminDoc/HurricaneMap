// Last-N viewed storms, persisted to localStorage. Surfaces as a dropdown
// when the search input gains focus with an empty value.
import {
  SEARCH_HISTORY_SCHEMA_VERSION,
  createVersionedRecord,
} from './schema-contract.js';

const KEY = 'hm-search-history-v1';
const MAX_ENTRIES = 8;
const VALID_CATEGORY_MIN = -1;
const VALID_CATEGORY_MAX = 5;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const migration = migrateHistoryRecord(JSON.parse(raw));
    if (migration.shouldPersist) save(migration.value);
    return migration.value;
  } catch (e) { return []; }
}
function save(arr) {
  try {
    localStorage.setItem(KEY, JSON.stringify(
      createVersionedRecord(SEARCH_HISTORY_SCHEMA_VERSION, 'entries', normalizeHistoryEntries(arr)),
    ));
  } catch (e) { /* quota */ }
}

export function recordView(landfall) {
  if (!landfall || !landfall.storm_id) return;
  const arr = load();
  const filtered = arr.filter(e => !(e.storm_id === landfall.storm_id && e.year === landfall.year));
  const entry = normalizeHistoryEntry({
    storm_id: landfall.storm_id,
    name: landfall.name,
    year: landfall.year,
    category: landfall.category,
    state: landfall.state,
    t: landfall.t,
    lat: landfall.lat,
    lon: landfall.lon,
  });
  if (!entry) return;
  filtered.unshift(entry);
  save(filtered);
}

export function getHistory() {
  return load();
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
}

export function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const stormId = normalizeText(entry.storm_id, 32);
  const year = toInteger(entry.year);
  const category = toInteger(entry.category);
  const lat = toFiniteNumber(entry.lat);
  const lon = toFiniteNumber(entry.lon);
  if (!stormId || !Number.isInteger(year) || year < 1800 || year > 2200) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    storm_id: stormId,
    name: normalizeText(entry.name, 80) || 'UNNAMED',
    year,
    category: Number.isInteger(category) && category >= VALID_CATEGORY_MIN && category <= VALID_CATEGORY_MAX ? category : -1,
    state: normalizeText(entry.state, 80),
    t: normalizeText(entry.t, 40),
    lat,
    lon,
  };
}

export function migrateHistoryRecord(record) {
  if (Array.isArray(record)) {
    return { value: normalizeHistoryEntries(record), status: 'legacy', shouldPersist: true };
  }
  if (!record || typeof record !== 'object') {
    return { value: [], status: 'invalid', shouldPersist: false };
  }
  if (record.schema_version !== SEARCH_HISTORY_SCHEMA_VERSION) {
    return { value: [], status: 'unsupported', shouldPersist: false };
  }
  return { value: normalizeHistoryEntries(record.entries), status: 'current', shouldPersist: false };
}

function normalizeHistoryEntries(entries) {
  return Array.isArray(entries)
    ? entries.map(normalizeHistoryEntry).filter(Boolean).slice(0, MAX_ENTRIES)
    : [];
}

function normalizeText(value, maxLength) {
  if (value == null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
