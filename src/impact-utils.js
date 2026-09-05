export function getFatalityCount(impacts) {
  if (!impacts) return null;
  if (Number.isFinite(impacts.deaths_total)) return impacts.deaths_total;
  return parseLegacyDeaths(impacts.deaths);
}

export function getDamageMillions(impacts) {
  if (!impacts) return null;
  if (Number.isFinite(impacts.damage_millions_usd)) return impacts.damage_millions_usd;
  if (Number.isFinite(impacts.damage_usd_nominal)) return impacts.damage_usd_nominal / 1_000_000;
  return parseLegacyDamageMillions(impacts.damages);
}

export function getNominalDamageUsd(impacts) {
  if (!impacts) return null;
  if (Number.isFinite(impacts.damage_usd_nominal)) return impacts.damage_usd_nominal;
  const damageMillions = getDamageMillions(impacts);
  return Number.isFinite(damageMillions) ? Math.round(damageMillions * 1_000_000) : null;
}

export function getRawFatalityText(impacts) {
  return impacts?.deaths ? String(impacts.deaths) : '';
}

export function getRawDamageText(impacts) {
  return impacts?.damages ? String(impacts.damages) : '';
}

export function formatFatalityCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toLocaleString();
}

// Storm Events covers the states and territories a U.S. landfall can occur in.
// This decides whether the link is worth offering at all, not what it queries.
const STORM_EVENT_STATES = Object.freeze(new Set([
  'Alabama', 'Alaska', 'California', 'Connecticut', 'Delaware', 'District of Columbia',
  'Florida', 'Georgia', 'Hawaii', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts',
  'Mississippi', 'New Hampshire', 'New Jersey', 'New York', 'North Carolina',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'Texas', 'Virginia', 'Puerto Rico',
]));

// NCEI replaced the Storm Events jsp with a client-rendered app. Verified on
// 2026-09-05: the legacy `listevents.jsp` query, the current `?eventType=...`
// query and the bare address all return the same 1166-byte shell, and loading
// the search route with every parameter spelling leaves the form untouched.
// The old link therefore promised a filtered result and delivered a landing
// page, so the query string is gone and the terms go to the reader instead.
const STORM_EVENTS_SEARCH = 'https://www.ncei.noaa.gov/access/storm-events-database/search';

function stormEventsWindow(storm) {
  if (!storm?.year || storm.year < 1950 || !storm.track?.length) return null;
  const start = new Date(storm.track[0].t);
  const end = new Date(storm.track[storm.track.length - 1].t);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const states = [...new Set((storm.us_landfalls || [])
    .map(landfall => landfall?.state)
    .filter(state => STORM_EVENT_STATES.has(state)))];
  if (!states.length) return null;
  return { start, end, states };
}

export function tornadoSearchUrl(storm) {
  return stormEventsWindow(storm) ? STORM_EVENTS_SEARCH : null;
}

/** What to enter once the search page opens, since it cannot be pre-filled. */
export function tornadoSearchHint(storm) {
  const window = stormEventsWindow(storm);
  if (!window) return null;
  const day = date => date.toISOString().slice(0, 10);
  return `${window.states.join(', ')} · ${day(window.start)} to ${day(window.end)}`;
}

function parseLegacyDeaths(value) {
  if (!value) return null;
  const text = String(value).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const lowered = text.toLowerCase();
  if (lowered.includes('none reported') || lowered.includes('no fatalities') || lowered.includes('no deaths')) {
    return 0;
  }
  const numbers = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map(match => Math.round(Number(match[0].replace(/,/g, ''))))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  if (lowered.includes('direct') && lowered.includes('indirect') && numbers.length >= 2) {
    return numbers[0] + numbers[1];
  }
  if (/\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*\d/i.test(text) && numbers.length >= 2) {
    return Math.max(numbers[0], numbers[1]);
  }
  return numbers[0];
}

function parseLegacyDamageMillions(value) {
  if (!value) return null;
  const text = String(value).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const lowered = text.toLowerCase();
  const numbers = [...text.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)]
    .map(match => Number(match[0]))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  const hasExplicitUnit = /trillion|billion|million|thousand/.test(lowered);
  const hasPlusExpression = /\d+(?:\.\d+)?\s*\+\s*\d/.test(text.replace(/,/g, ''));
  const amount = hasPlusExpression && !hasExplicitUnit
    ? numbers.reduce((sum, number) => sum + number, 0)
    : numbers[0];
  if (!Number.isFinite(amount)) return null;
  if (lowered.includes('trillion')) return amount * 1_000_000;
  if (lowered.includes('billion')) return amount * 1_000;
  if (lowered.includes('million')) return amount;
  if (lowered.includes('thousand')) return amount / 1_000;
  if (amount >= 10_000) return amount / 1_000_000;
  return amount;
}
