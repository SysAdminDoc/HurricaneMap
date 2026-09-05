// The contract a seasonal-outlook source has to satisfy.
//
// Its own module so the rules can be exercised directly: importing
// validate-data.mjs runs the whole validation as a side effect, and rules that
// can only be tested by planting values in live data stop being tested the day
// that data changes.
import { parseSnapshotDate } from '../src/snapshot-freshness.js';

// Seasonal outlooks write their counts as ranges, and the agencies do not agree
// on the dash: NOAA publishes "7-13" with an en dash, CSU a bare "9".
export function parseForecastRange(text) {
  const cleaned = String(text ?? '').trim();
  // Anchored, so the whole value has to be a count or a range and nothing else.
  // Splitting on the dash and dropping empty parts accepted far too much: a
  // leading minus read as the separator, so "-9" parsed as nine, and "9to13",
  // "004", "5-" and "to 9" all parsed as well. A storm count has no sign, no
  // leading zeros, and no text around it.
  // A dash needs no spaces around it; the word "to" does, or "9to13" reads as a
  // range and any typo containing the letters becomes a number.
  const match = /^(0|[1-9]\d*)(?:(?:\s*[-–—]\s*|\s+to\s+)(0|[1-9]\d*))?$/i.exec(cleaned);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return max < min ? null : { min, max };
}

// No Atlantic season has come near 30 named storms (2020 reached 30), so this
// is a nonsense bound rather than a forecast bound: it exists to catch a
// superseded source quietly carrying arbitrary figures.
const MAX_PLAUSIBLE_NAMED = 40;
// And a floor. No agency forecasts an Atlantic season with no named storms at
// all: the quietest on record, 1914, had one. A zero is a parsing accident or a
// placeholder somebody forgot to fill in, not a forecast.
const MIN_PLAUSIBLE_NAMED = 1;

export function validateOutlookSource(source, index, outlook, report) {
  const label = `data/outlook.json sources[${index}]`;
  const counts = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    report(`${label} must be an object.`);
    return counts;
  }
  for (const field of ['named', 'hurricanes', 'majors']) {
    if (source[field] === undefined || source[field] === null) continue;
    const range = parseForecastRange(source[field]);
    if (!range) {
      report(`${label}.${field} must be a number or a range such as "7-13", not ${JSON.stringify(source[field])}.`);
      continue;
    }
    if (range.max > MAX_PLAUSIBLE_NAMED) {
      report(`${label}.${field} forecasts ${range.max}, which is not a real seasonal figure.`);
    }
    // Only named storms get the floor: a forecast of no major hurricanes is
    // ordinary, a forecast of no storms at all is not.
    if (field === 'named' && range.max < MIN_PLAUSIBLE_NAMED) {
      report(`${label}.named forecasts ${range.max} storms for a whole season, which is not a real figure.`);
    }
    counts[field] = range;
  }
  // A season cannot have more major hurricanes than hurricanes, or more
  // hurricanes than named storms. A superseded source could hold any figures at
  // all, and the card prints it beside a correct headline.
  const ordered = [['majors', 'hurricanes'], ['hurricanes', 'named']];
  for (const [smaller, larger] of ordered) {
    if (!counts[smaller] || !counts[larger]) continue;
    if (counts[smaller].min > counts[larger].min || counts[smaller].max > counts[larger].max) {
      report(
        `${label}: ${smaller} ${source[smaller]} exceeds ${larger} ${source[larger]}; `
        + 'majors must fall within hurricanes, and hurricanes within named storms.',
      );
    }
  }

  // The forecast cycle for a season runs from the prior December through the
  // end of the season, and no source can be newer than the headline it sits
  // under. Anything else is a date nobody checked.
  const issued = parseSnapshotDate(source.issued);
  const headline = parseSnapshotDate(outlook.issued);
  // Say so rather than passing quietly: a date the rules cannot read is the
  // case the rules exist for, and returning early made it invisible.
  if (!issued) {
    report(`${label}.issued is not a date the forecast-cycle rules can read: ${JSON.stringify(source.issued)}.`);
    return counts;
  }
  if (!Number.isInteger(outlook.season)) {
    report(`data/outlook.json season must be an integer for sources[${index}] to be dated against it.`);
    return counts;
  }
  const earliest = new Date(Date.UTC(outlook.season - 1, 11, 1));
  const latest = parseSnapshotDate(outlook.valid_until) || headline;
  if (issued < earliest) {
    report(`${label}.issued ${source.issued} predates the ${outlook.season} forecast cycle, which opens ${earliest.toISOString().slice(0, 10)}.`);
  }
  if (latest && issued > latest) {
    report(`${label}.issued ${source.issued} falls after the ${outlook.season} outlook window closes ${latest.toISOString().slice(0, 10)}.`);
  }
  if (headline && issued > headline) {
    report(`${label}.issued ${source.issued} is newer than the headline issued ${outlook.issued}.`);
  }
  return counts;
}
