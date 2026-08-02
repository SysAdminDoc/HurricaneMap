const REFERENCE_YEAR = 2024;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function calendarDayOfYear(month, day) {
  return Math.round(
    (Date.UTC(REFERENCE_YEAR, month, day) - Date.UTC(REFERENCE_YEAR, 0, 1)) / MS_PER_DAY,
  );
}

function monthDayParts(targetMonthDay) {
  const [month, day] = String(targetMonthDay).split('-').map(Number);
  return { month: month - 1, day };
}

export function isWithinDaysOfToday(lfDate, targetMonthDay, daysOffset = 7) {
  const date = new Date(lfDate);
  const { month, day } = monthDayParts(targetMonthDay);
  const lfDoy = calendarDayOfYear(date.getUTCMonth(), date.getUTCDate());
  const targetDoy = calendarDayOfYear(month, day);
  let diff = Math.abs(lfDoy - targetDoy);
  if (diff > 366 / 2) diff = 366 - diff;
  return diff <= daysOffset;
}

export function calendarDistanceDays(lfDate, targetMonthDay) {
  const date = new Date(lfDate);
  const { month, day } = monthDayParts(targetMonthDay);
  const raw = calendarDayOfYear(date.getUTCMonth(), date.getUTCDate()) - calendarDayOfYear(month, day);
  if (raw > 183) return raw - 366;
  if (raw < -183) return raw + 366;
  return raw;
}
