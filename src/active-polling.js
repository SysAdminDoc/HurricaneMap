export const ACTIVE_STORM_POLL_MS = 60 * 60 * 1000;
export const INACTIVE_STORM_POLL_MS = 6 * 60 * 60 * 1000;
export const ACTIVE_FEED_RETRY_MS = 15 * 60 * 1000;
export const ACTIVE_FEED_RATE_LIMIT_MS = 2 * 60 * 60 * 1000;
export const MAX_ACTIVE_FEED_BACKOFF_MS = 4 * 60 * 60 * 1000;

export function isPotentialTropicalCyclone(storm) {
  const classification = String(storm?.classification || '').trim().toLowerCase();
  return classification === 'ptc' || classification.includes('potential tropical cyclone');
}

export function pronunciationUrlForActiveStorm(storm) {
  const basin = `${storm?.id || ''} ${storm?.binNumber || ''}`.toUpperCase();
  return /(?:^|\s)(?:EP|CP)\d/.test(basin)
    ? 'https://www.nhc.noaa.gov/pdf/aboutnames_pronounce_epac.pdf'
    : 'https://www.nhc.noaa.gov/pdf/aboutnames_pronounce_atlc.pdf';
}

export function computeActivePollDelay({
  ok,
  status = 0,
  stormCount = 0,
  failureCount = 0,
} = {}) {
  if (status === 429) return ACTIVE_FEED_RATE_LIMIT_MS;
  if (!ok) {
    const failures = Math.max(1, Number(failureCount) || 1);
    return Math.min(
      ACTIVE_FEED_RETRY_MS * (2 ** (failures - 1)),
      MAX_ACTIVE_FEED_BACKOFF_MS,
    );
  }
  return stormCount > 0 ? ACTIVE_STORM_POLL_MS : INACTIVE_STORM_POLL_MS;
}

export function activeAdvisoryKey(storms = []) {
  if (!Array.isArray(storms) || !storms.length) return '';
  return storms
    .map(storm => stormAdvisoryToken(storm))
    .sort()
    .join('|');
}

export function activeFeedStatusText({
  state = 'ok',
  stormCount = 0,
  fetchedAt = null,
  nextPollAt = null,
  status = 0,
} = {}) {
  if (state === 'rate-limit') {
    const message = t('status.feedRateLimited');
    return nextPollAt ? t('status.feedRetry', message, formatUtcClock(nextPollAt)) : message;
  }
  if (state === 'error') {
    const code = status ? ` (${status})` : '';
    const message = `${t('status.feedDelayed')}${code}`;
    return nextPollAt ? t('status.feedRetry', message, formatUtcClock(nextPollAt)) : message;
  }
  if (stormCount > 0) {
    const updated = fetchedAt
      ? t('status.feedUpdatedAt', formatUtcClock(fetchedAt))
      : t('status.feedUpdated');
    return t('status.feedHourly', updated);
  }
  const message = t('status.noActiveStorms');
  return nextPollAt ? t('status.feedNextCheck', message, formatUtcClock(nextPollAt)) : message;
}

export function formatUtcClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '--:--';
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function stormAdvisoryToken(storm = {}) {
  return [
    normalizeStormIdentifier(storm),
    advisoryValue(storm, [
      'advNum',
      'advisoryNumber',
      'advisoryNum',
      'advisory',
      'lastUpdate',
      'lastUpdated',
      'issueTime',
      'validTime',
      'date',
    ]),
    advisoryValue(storm.forecastTrack, ['advNum', 'advisoryNumber', 'issueTime', 'validTime']),
    advisoryValue(storm.trackCone, ['advNum', 'advisoryNumber', 'issueTime', 'validTime']),
    advisoryValue(storm.publicAdvisory, ['advNum', 'advisoryNumber', 'issueTime', 'validTime']),
    advisoryValue(storm.forecastAdvisory, ['advNum', 'advisoryNumber', 'issueTime', 'validTime']),
    latestPointToken(storm.track),
    latestPointToken(storm.forecastTrack),
  ].filter(Boolean).join(':');
}

function normalizeStormIdentifier(storm = {}) {
  return String(
    storm.id ||
    storm.stormId ||
    storm.binNumber ||
    storm.atcfId ||
    storm.name ||
    'unknown',
  ).trim().toUpperCase();
}

function advisoryValue(target, keys) {
  const item = Array.isArray(target) ? target[target.length - 1] : target;
  if (!item || typeof item !== 'object') return '';
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
      return String(item[key]).trim();
    }
  }
  return '';
}

function latestPointToken(points) {
  if (!Array.isArray(points) || !points.length) return '';
  const point = points[points.length - 1];
  if (!point || typeof point !== 'object') return '';
  return [
    point.lat ?? point.latitude ?? '',
    point.lon ?? point.lng ?? point.longitude ?? '',
    point.time ?? point.date ?? point.validTime ?? '',
  ].map(value => String(value).trim()).join(',');
}
import { t } from './i18n.js';
