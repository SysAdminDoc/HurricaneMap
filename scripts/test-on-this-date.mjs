import assert from 'node:assert/strict';

process.env.TZ = 'America/New_York';
const {
  calendarDayOfYear,
  calendarDistanceDays,
  isWithinDaysOfToday,
} = await import('../src/on-this-date-utils.js');

assert.equal(calendarDayOfYear(0, 15), 14, 'January day-of-year offset should be stable');
assert.equal(calendarDayOfYear(6, 15), 196, 'July day-of-year offset must not lose a DST hour');
assert.equal(calendarDayOfYear(8, 10), 253, 'September day-of-year offset must not lose a DST hour');
assert.equal(calendarDayOfYear(10, 10), 314, 'November day-of-year offset must not lose a DST hour');

assert.equal(isWithinDaysOfToday('2024-07-22T12:00:00Z', '07-15'), true, 'a landfall exactly seven days away should match');
assert.equal(isWithinDaysOfToday('2024-07-23T12:00:00Z', '07-15'), false, 'a landfall eight days away should not match');
assert.equal(calendarDistanceDays('2024-07-22T12:00:00Z', '07-15'), 7, 'relative offset should preserve seven days');
assert.equal(calendarDistanceDays('2024-07-08T12:00:00Z', '07-15'), -7, 'relative offset should preserve negative seven days');
assert.equal(calendarDistanceDays('2024-01-02T12:00:00Z', '12-30'), 3, 'relative offset should wrap across New Year');

console.log('on-this-date calendar math ok (UTC day-of-year, America/New_York DST boundaries)');
