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

const STORM_EVENT_STATE_FIPS = Object.freeze({
  Alabama: '01', Alaska: '02', California: '06', Connecticut: '09', Delaware: '10',
  'District of Columbia': '11', Florida: '12', Georgia: '13', Hawaii: '15', Louisiana: '22',
  Maine: '23', Maryland: '24', Massachusetts: '25', Mississippi: '28', 'New Hampshire': '33',
  'New Jersey': '34', 'New York': '36', 'North Carolina': '37', Pennsylvania: '42',
  'Rhode Island': '44', 'South Carolina': '45', Texas: '48', Virginia: '51', 'Puerto Rico': '72',
});

export function tornadoSearchUrl(storm) {
  if (!storm?.year || storm.year < 1950 || !storm.track?.length) return null;
  const start = new Date(storm.track[0].t);
  const end = new Date(storm.track[storm.track.length - 1].t);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  const stateFilters = [...new Set((storm.us_landfalls || [])
    .map(landfall => landfall?.state)
    .filter(state => STORM_EVENT_STATE_FIPS[state]))]
    .map(state => `${STORM_EVENT_STATE_FIPS[state]},${state.toUpperCase()}`);
  if (!stateFilters.length) return null;
  const params = new URLSearchParams({
    eventType: '(C) Tornado',
    beginDate_mm: String(start.getUTCMonth() + 1).padStart(2, '0'),
    beginDate_dd: String(start.getUTCDate()).padStart(2, '0'),
    beginDate_yyyy: String(start.getUTCFullYear()),
    endDate_mm: String(end.getUTCMonth() + 1).padStart(2, '0'),
    endDate_dd: String(end.getUTCDate()).padStart(2, '0'),
    endDate_yyyy: String(end.getUTCFullYear()),
    statefips: stateFilters.join(','),
  });
  return `https://www.ncei.noaa.gov/stormevents/listevents.jsp?${params}`;
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
