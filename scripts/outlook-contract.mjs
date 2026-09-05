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
  if (!cleaned) return null;
  const parts = cleaned.split(/\s*(?:[-–—]|to)\s*/i).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const numbers = parts.map(part => (/^\d+$/.test(part) ? Number(part) : null));
  if (numbers.some(value => value === null)) return null;
  const [min, max = numbers[0]] = numbers;
  return max < min ? null : { min, max };
}

// No Atlantic season has come near 30 named storms (2020 reached 30), so this
// is a nonsense bound rather than a forecast bound: it exists to catch a
// superseded source quietly carrying arbitrary figures.
const MAX_PLAUSIBLE_NAMED = 40;

export function validateOutlookSource(source, index, outlook, report) {
  const label = `data/outlook.json sources[${index}]`;
  const counts = {};
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
  if (!issued || !Number.isInteger(outlook.season)) return counts;
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
