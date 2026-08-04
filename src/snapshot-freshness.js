const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SNAPSHOT_MAX_AGE_DAYS = 45;

export function parseSnapshotDate(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

export function utcDateOnly(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function daysSinceSnapshot(issued, now = new Date()) {
  const issuedDate = parseSnapshotDate(issued);
  const nowDate = utcDateOnly(now);
  if (!issuedDate || !nowDate) return null;
  return Math.floor((nowDate.getTime() - issuedDate.getTime()) / DAY_MS);
}

export function isSnapshotExpired(validUntil, now = new Date()) {
  const expiryDate = parseSnapshotDate(validUntil);
  const nowDate = utcDateOnly(now);
  return Boolean(expiryDate && nowDate && nowDate > expiryDate);
}

export function getSnapshotStatus(snapshot, now = new Date()) {
  const daysOld = daysSinceSnapshot(snapshot?.issued, now);
  const expired = isSnapshotExpired(snapshot?.valid_until, now);
  return {
    daysOld,
    expired,
    stale: daysOld != null && daysOld > SNAPSHOT_MAX_AGE_DAYS,
    issued: parseSnapshotDate(snapshot?.issued),
    validUntil: parseSnapshotDate(snapshot?.valid_until),
  };
}

export function isInAtlanticHurricaneSeason(season, now = new Date()) {
  const date = utcDateOnly(now);
  return Boolean(
    date
    && Number.isInteger(season)
    && season === date.getUTCFullYear()
    && date.getUTCMonth() >= 5
    && date.getUTCMonth() <= 10,
  );
}
