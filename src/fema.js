import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
} from './optional-feeds.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

export const FEMA_API_URL = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries';
export const FEMA_SOURCE_URL = FEMA_API_URL;
export const FEMA_QUERY_LIMIT = 5_000;
export const FEMA_DATE_PADDING_MS = 7 * 24 * 60 * 60 * 1_000;

const FEMA_FIELDS = Object.freeze([
  'femaDeclarationString',
  'disasterNumber',
  'state',
  'declarationType',
  'declarationDate',
  'incidentType',
  'declarationTitle',
  'incidentBeginDate',
  'incidentEndDate',
  'designatedArea',
]);

const femaCache = new Map();

function normalizeFemaText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function parseTimestamp(value) {
  const timestamp = Date.parse(String(value ?? ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatApiTimestamp(timestamp) {
  return new Date(timestamp).toISOString();
}

function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

function stormName(storm) {
  const name = normalizeFemaText(storm?.name);
  return name && name !== 'UNNAMED' ? name : '';
}

/** Return the padded track window used for both the API query and matching. */
export function getFemaStormWindow(storm) {
  const timestamps = (Array.isArray(storm?.track) ? storm.track : [])
    .map(record => parseTimestamp(record?.t))
    .filter(timestamp => timestamp != null);
  if (!timestamps.length) return null;
  const first = Math.min(...timestamps) - FEMA_DATE_PADDING_MS;
  const last = Math.max(...timestamps) + FEMA_DATE_PADDING_MS;
  return {
    start: formatApiTimestamp(first),
    end: formatApiTimestamp(last),
    startMs: first,
    endMs: last,
  };
}

export function buildFemaQuery(storm) {
  const name = stormName(storm);
  const window = getFemaStormWindow(storm);
  if (!name || !window) return '';
  const url = new URL(FEMA_API_URL);
  url.searchParams.set('$filter', [
    `contains(declarationTitle,'${escapeODataString(name)}')`,
    `incidentBeginDate le '${window.end}'`,
    `incidentEndDate ge '${window.start}'`,
  ].join(' and '));
  url.searchParams.set('$select', FEMA_FIELDS.join(','));
  url.searchParams.set('$top', String(FEMA_QUERY_LIMIT));
  url.searchParams.set('$orderby', 'incidentBeginDate asc');
  return url.toString();
}

function hasStormName(title, name) {
  const titleWords = normalizeFemaText(title).split(' ').filter(Boolean);
  const nameWords = normalizeFemaText(name).split(' ').filter(Boolean);
  if (!titleWords.length || !nameWords.length || nameWords.length > titleWords.length) return false;
  for (let index = 0; index <= titleWords.length - nameWords.length; index += 1) {
    if (nameWords.every((word, offset) => titleWords[index + offset] === word)) return true;
  }
  return false;
}

function overlapsWindow(row, window) {
  const start = parseTimestamp(row?.incidentBeginDate);
  const end = parseTimestamp(row?.incidentEndDate) ?? start;
  if (start == null || end == null) return false;
  return start <= window.endMs && end >= window.startMs;
}

function declarationKey(row) {
  const explicit = String(row?.femaDeclarationString ?? '').trim();
  if (explicit) return explicit;
  const number = Number(row?.disasterNumber);
  const state = String(row?.state ?? '').trim().toUpperCase();
  const type = String(row?.declarationType ?? '').trim().toUpperCase();
  return `${type || 'DECLARATION'}-${Number.isInteger(number) ? number : 'UNKNOWN'}-${state || 'US'}`;
}

function normalizeArea(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeState(value) {
  return String(value ?? '').trim().toUpperCase();
}

function sortDateValues(values) {
  return values
    .filter(Boolean)
    .sort((left, right) => (parseTimestamp(left) ?? Number.MAX_SAFE_INTEGER) - (parseTimestamp(right) ?? Number.MAX_SAFE_INTEGER));
}

function toPublicDeclaration(group) {
  const states = [...group.states.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, areas]) => ({
      state,
      areas: [...areas].sort((left, right) => left.localeCompare(right)),
    }));
  const dates = sortDateValues(group.incidentDates);
  const declarationDates = sortDateValues(group.declarationDates);
  const disasterNumber = Number.isInteger(group.disasterNumber) && group.disasterNumber > 0
    ? group.disasterNumber
    : null;
  return {
    id: group.id,
    disasterNumber,
    declarationType: group.declarationType,
    incidentType: group.incidentType,
    title: group.title,
    incidentBeginDate: dates[0] || null,
    incidentEndDate: dates[dates.length - 1] || null,
    declarationDate: declarationDates[0] || null,
    states,
    recordUrl: disasterNumber ? `https://www.fema.gov/disaster/${disasterNumber}` : '',
    rowCount: group.rowCount,
  };
}

/**
 * Collapse FEMA's one-row-per-designated-area response into declarations.
 * Title and incident-window checks remain client-side so a permissive API
 * response cannot silently associate a similarly named or distant storm.
 */
export function normalizeFemaRows(rows, storm) {
  const name = stormName(storm);
  const window = getFemaStormWindow(storm);
  if (!name || !window || !Array.isArray(rows)) return [];
  const groups = new Map();
  for (const row of rows) {
    if (!row || !hasStormName(row.declarationTitle, name) || !overlapsWindow(row, window)) continue;
    const id = declarationKey(row);
    let group = groups.get(id);
    if (!group) {
      const disasterNumber = Number(row.disasterNumber);
      group = {
        id,
        disasterNumber: Number.isInteger(disasterNumber) ? disasterNumber : null,
        declarationType: String(row.declarationType ?? '').trim(),
        incidentType: String(row.incidentType ?? '').trim(),
        title: String(row.declarationTitle ?? '').trim(),
        incidentDates: [],
        declarationDates: [],
        states: new Map(),
        rowCount: 0,
      };
      groups.set(id, group);
    }
    group.rowCount += 1;
    if (row.incidentBeginDate) group.incidentDates.push(String(row.incidentBeginDate));
    if (row.incidentEndDate) group.incidentDates.push(String(row.incidentEndDate));
    if (row.declarationDate) group.declarationDates.push(String(row.declarationDate));
    const state = normalizeState(row.state) || 'US';
    const area = normalizeArea(row.designatedArea);
    if (!group.states.has(state)) group.states.set(state, new Set());
    if (area) group.states.get(state).add(area);
  }
  return [...groups.values()]
    .map(toPublicDeclaration)
    .sort((left, right) => {
      const dateOrder = (parseTimestamp(left.incidentBeginDate) ?? Number.MAX_SAFE_INTEGER) -
        (parseTimestamp(right.incidentBeginDate) ?? Number.MAX_SAFE_INTEGER);
      return dateOrder || left.id.localeCompare(right.id);
    });
}

function emptyResult(reason = 'no-match', cacheOrigin = 'memory') {
  return { status: 'empty', records: [], reason, cacheOrigin, itemCount: 0 };
}

export function clearFemaCache() {
  femaCache.clear();
}

export async function fetchFemaDeclarations(
  storm,
  { fetchImpl = globalThis.fetch, signal } = {},
) {
  const query = buildFemaQuery(storm);
  const cacheKey = query || `no-query:${stormName(storm) || 'unnamed'}`;
  const cached = femaCache.get(cacheKey);
  if (cached) {
    const request = beginOptionalFeed('fema', { cacheOrigin: 'memory' });
    completeOptionalFeed('fema', {
      empty: cached.status === 'empty',
      cacheOrigin: 'memory',
      itemCount: cached.records.length,
      requestId: request.requestId,
    });
    return { ...cached, cacheOrigin: 'memory' };
  }

  const request = beginOptionalFeed('fema', { cacheOrigin: 'network' });
  if (!query) {
    const result = emptyResult('no-match', 'memory');
    femaCache.set(cacheKey, result);
    completeOptionalFeed('fema', { empty: true, cacheOrigin: 'memory', itemCount: 0, requestId: request.requestId });
    return result;
  }

  try {
    const response = await fetchWithTimeout(
      query,
      { signal, headers: { Accept: 'application/json' } },
      REQUEST_TIMEOUT_MS.fema,
      fetchImpl,
    );
    if (!response?.ok) {
      failOptionalFeed('fema', { responseStatus: Number(response?.status) || 0, requestId: request.requestId });
      return {
        status: 'error',
        records: [],
        responseStatus: Number(response?.status) || 0,
        cacheOrigin: 'network',
      };
    }
    const payload = await response.json();
    const rows = payload?.DisasterDeclarationsSummaries;
    if (!Array.isArray(rows)) throw new TypeError('FEMA response did not contain declaration summaries');
    const records = normalizeFemaRows(rows, storm);
    const result = {
      status: records.length ? 'success' : 'empty',
      records,
      reason: records.length ? null : 'no-match',
      cacheOrigin: 'network',
      itemCount: records.length,
      query,
    };
    femaCache.set(cacheKey, result);
    completeOptionalFeed('fema', {
      empty: records.length === 0,
      cacheOrigin: 'network',
      itemCount: records.length,
      requestId: request.requestId,
    });
    return result;
  } catch (error) {
    failOptionalFeed('fema', { error, requestId: request.requestId });
    return { status: 'error', records: [], error, cacheOrigin: 'network' };
  }
}

export function formatFemaDate(value, locale = undefined) {
  const timestamp = parseTimestamp(value);
  if (timestamp == null) return '';
  return new Date(timestamp).toLocaleDateString(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
