import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'forecast-skill.json');
const PERIOD = Object.freeze({ startYear: 2021, endYear: 2025, label: '2021-2025' });
const LEADS = Object.freeze([0, 12, 24, 36, 48, 60, 72, 96, 120]);
const SOURCES = Object.freeze({
  AL: {
    label: 'Atlantic',
    url: 'https://www.nhc.noaa.gov/verification/errors/1989-present_OFCL_v_BCD5_ind_ATL_TI_errors.txt',
  },
  EP: {
    label: 'Eastern North Pacific',
    url: 'https://www.nhc.noaa.gov/verification/errors/1989-present_OFCL_v_BCD5_ind_EPAC_TI_errors.txt',
  },
});

// Published NHC five-year table. The builder recomputes these values from the
// individual forecast-error files and refuses to write if they diverge.
const EXPECTED = Object.freeze({
  AL: [
    [0, 6.9, 1676, 1.3, 1676], [12, 22.3, 1504, 5.0, 1504],
    [24, 33.6, 1336, 7.1, 1336], [36, 44.0, 1182, 8.5, 1182],
    [48, 55.9, 1049, 9.9, 1049], [60, 70.5, 923, 10.8, 923],
    [72, 86.4, 805, 11.6, 805], [96, 124.9, 613, 13.3, 613],
    [120, 181.0, 464, 14.7, 464],
  ],
  EP: [
    [0, 8.0, 1452, 1.4, 1452], [12, 21.4, 1281, 5.7, 1281],
    [24, 32.1, 1112, 9.0, 1112], [36, 41.6, 953, 10.9, 953],
    [48, 50.3, 807, 12.6, 807], [60, 61.1, 679, 13.7, 679],
    [72, 74.0, 574, 14.2, 573], [96, 101.4, 400, 16.0, 400],
    [120, 125.0, 273, 17.8, 273],
  ],
});

function yearFromDate(value) {
  const match = /^\d{2}-\d{2}-(\d{4})\//.exec(value || '');
  return match ? Number(match[1]) : NaN;
}

function roundOneTiesToEven(value) {
  const scaled = value * 10;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const rounded = Math.abs(fraction - 0.5) < 1e-9
    ? (lower % 2 === 0 ? lower : lower + 1)
    : Math.round(scaled);
  return rounded / 10;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function parseOfficialErrors(text, basin) {
  const lines = String(text).trim().split(/\r?\n/);
  if (!lines.some(line => /^Model\(s\) verified:\s+OFCL\s*$/.test(line))) {
    throw new Error(`${basin}: source is not an OFCL verification file`);
  }
  const headerIndex = lines.findIndex(line => line.startsWith('Date/Time'));
  if (headerIndex < 0) throw new Error(`${basin}: missing tabulation header`);
  const headers = lines[headerIndex].trim().split(/\s+/);
  const selectedLines = lines.slice(headerIndex + 1).filter(line => {
    const year = yearFromDate(line.trim().split(/\s+/, 1)[0]);
    return year >= PERIOD.startYear && year <= PERIOD.endYear;
  });
  const rows = selectedLines.map(line => line.trim().split(/\s+/));
  if (!rows.length) throw new Error(`${basin}: no rows in ${PERIOD.label}`);

  const output = LEADS.map(leadHours => {
    const prefix = String(leadHours).padStart(3, '0');
    const trackIndex = headers.indexOf(`${prefix}hT01`);
    const intensityIndex = headers.indexOf(`${prefix}hI01`);
    if (trackIndex < 0 || intensityIndex < 0) throw new Error(`${basin}: missing ${leadHours} h columns`);
    const track = rows.map(row => Number(row[trackIndex])).filter(value => Number.isFinite(value) && value > -9000);
    const intensity = rows.map(row => Number(row[intensityIndex])).filter(value => Number.isFinite(value) && value > -9000);
    return {
      leadHours,
      trackErrorNmi: roundOneTiesToEven(mean(track)),
      trackSampleSize: track.length,
      intensityErrorKt: roundOneTiesToEven(mean(intensity.map(Math.abs))),
      intensitySampleSize: intensity.length,
    };
  });

  const expected = EXPECTED[basin];
  const compact = output.map(row => [
    row.leadHours, row.trackErrorNmi, row.trackSampleSize,
    row.intensityErrorKt, row.intensitySampleSize,
  ]);
  if (JSON.stringify(compact) !== JSON.stringify(expected)) {
    throw new Error(`${basin}: computed values no longer match the published 2021-2025 NHC table`);
  }
  return {
    ...SOURCES[basin],
    sourceSubsetSha256: createHash('sha256').update(selectedLines.join('\n')).digest('hex'),
    rows: output,
  };
}

export async function buildForecastSkill(fetchImpl = fetch) {
  const entries = await Promise.all(Object.entries(SOURCES).map(async ([basin, source]) => {
    const response = await fetchImpl(source.url);
    if (!response.ok) throw new Error(`${basin}: source returned ${response.status}`);
    return [basin, parseOfficialErrors(await response.text(), basin)];
  }));
  return {
    schema: 1,
    period: PERIOD,
    sourceUpdated: '2026-07-08',
    bestTrackAsOf: '2026-05-18',
    model: 'OFCL',
    definitions: {
      trackError: 'Great-circle distance between the official forecast position and post-season best-track position at the verification time.',
      intensityError: 'Absolute difference between official forecast and post-season best-track maximum sustained wind at the verification time.',
      aggregation: 'Mean error across all qualifying official forecasts; tropical or subtropical at both initial and verifying time.',
    },
    sources: {
      methodology: 'https://www.nhc.noaa.gov/verification/verify2.shtml',
      summary: 'https://www.nhc.noaa.gov/verification/pdfs/OFCL_5-yr_averages.pdf',
      format: 'https://www.nhc.noaa.gov/verification/pdfs/Error_Tabulation_File_Format.pdf',
    },
    basins: Object.fromEntries(entries),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = await buildForecastSkill();
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, outputPath)} (${Object.values(data.basins).reduce((sum, basin) => sum + basin.rows.length, 0)} lead rows)`);
}
