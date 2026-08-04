// P12.1 — Publication-ready export: One-click export of filtered dataset as CSV with documentation

import { getLandfalls, filterLandfalls, getCoverageYearRange } from './data.js';
import { buildExportProvenance } from './export-provenance.js';
import { buildCitation, citationCommentLines } from './citation.js';
import { presentCategory, roundMetric } from './metric-presenters.js';

export function buildPublicationCSV(filters, {
  generatedAt = new Date().toISOString(),
  landfalls = getLandfalls(),
} = {}) {
  // Get all landfalls and filter them
  const filtered = filterLandfalls(landfalls, filters);
  
  // Build CSV with comprehensive headers
  const headers = [
    'storm_id',
    'name',
    'year',
    'month',
    'day',
    'hour',
    'latitude',
    'longitude',
    'wind_speed_kt',
    'wind_speed_mph',
    'pressure_mb',
    'category',
    'state',
  ];
  
  const rows = [headers];
  
  for (const lf of filtered) {
    // Ensure defaults for undefined values
    const windMph = Number.isFinite(lf.wind) ? roundMetric(lf.wind * 1.15078) : '';
    // Landfall records carry only the ISO timestamp `t` — derive the
    // documented month/day/hour columns from it.
    const when = lf.t ? new Date(lf.t) : null;
    const validWhen = when && !Number.isNaN(when.getTime());
    const row = [
      lf.storm_id || '',
      lf.name || 'UNNAMED',
      lf.year || '',
      validWhen ? when.getUTCMonth() + 1 : '',
      validWhen ? when.getUTCDate() : '',
      validWhen ? when.getUTCHours() : '',
      Number.isFinite(lf.lat) ? lf.lat.toFixed(3) : '',
      Number.isFinite(lf.lon) ? lf.lon.toFixed(3) : '',
      lf.wind || '',
      windMph,
      lf.pres || '',
      publicationCategoryLabel(lf.category),
      lf.state || '',
    ];
    rows.push(row);
  }
  
  // Build CSV content
  const textColumns = new Set(['storm_id', 'name', 'category', 'state']);
  let csv = rows.map(row => row.map((cell, index) => csvEscape(cell, {
    preventFormula: textColumns.has(headers[index]),
  })).join(',')).join('\n');
  
  // Add data dictionary as comments
  const uniqueStorms = new Set(filtered.map(lf => lf.storm_id)).size;
  const [coverageMin, coverageMax] = getCoverageYearRange();
  const citation = buildCitation({ accessDate: generatedAt });
  const provenance = buildExportProvenance({
    artifactPaths: [
      'data/landfalls.json',
      'data/metadata.json',
      'data/hurdat2-sources.json',
      'data/hurdat2-atlantic.txt',
      'data/hurdat2-nepac.txt',
    ],
    exportedAt: generatedAt,
    methodology: [
      'Landfalls are the shipped NOAA/NHC HURDAT2-derived records selected by the supplied filters.',
      'UTC month, day, and hour fields are derived from each record timestamp.',
      'Wind speeds are converted from knots with mph = knots × 1.15078.',
    ],
  });
  const dataDictionary = `# HurricaneMap Publication-Ready Export
# Generated: ${generatedAt}
# Data source: NOAA NHC HURDAT2 (Public Domain)
# Attribution: "Data from NOAA National Hurricane Center HURDAT2 best-track database, 1851-present"
#
# Data Dictionary:
# storm_id: 6-character identifier (AALLNNNN: AL=Atlantic, LL=basin, NNNN=sequence, YYYY=year)
# name: Hurricane or tropical storm name
# year: Year of occurrence (${coverageMin}-${coverageMax})
# month: Month (1-12)
# day: Day of month
# hour: Hour (UTC, 0-23)
# latitude: Position latitude (decimal degrees, -90 to 90)
# longitude: Position longitude (decimal degrees, -180 to 180)
# wind_speed_kt: Maximum sustained winds (knots)
# wind_speed_mph: Maximum sustained winds (miles per hour) converted from knots * 1.15078
# pressure_mb: Central pressure (millibars)
# category: Tropical Depression (TD), Tropical Storm (TS), or Saffir-Simpson category 1-5
# state: U.S. state at landfall
#
# Methodology:
# - Landfalls are identified as points where storm track crosses a U.S. state boundary
# - Category assigned by Saffir-Simpson scale: TS (34-63 kt), 1-5 (64-137+ kt)
# - Wind speeds converted: mph = knots * 1.15078
# - Pressure data sparse before 1945; see HURDAT2 documentation
#
# Citation:
# Landsea, C. W., and J. L. Franklin, 2013: The Atlantic Hurricane Database Re-analysis Project:
# Documentation for the 1851-2012 Alterations and Additions to the Hurdat Version 2 Database.
# NOAA Technical Memorandum NWS NHC-7.
#
# License & Usage:
# HURDAT2 data is Public Domain (released by NOAA/NHC).
# This export provided as-is; please cite original HURDAT2 source in publications.
#
${citationCommentLines(citation).join('\n')}
#
# Filters applied:
# - Years: ${filters.yearMin}-${filters.yearMax}
# - Categories: ${Array.from(filters.categories).sort().join(', ') || 'All'}
# - State: ${filters.state || 'All'}
# - Result: ${filtered.length} landfall records from ${uniqueStorms} unique storms
#
# Provenance (JSON, schema v1): ${JSON.stringify(provenance)}
#
`;
  
  csv = dataDictionary + '\n' + csv;
  
  const timestamp = generatedAt.split('T')[0];
  return {
    csv,
    filename: `HurricaneMap-Export-${timestamp}.csv`,
    provenance,
    citation,
  };
}

export function exportPublicationCSV(filters) {
  const result = buildPublicationCSV(filters);
  downloadCSV(result.csv, result.filename);
  return result;
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvEscape(value, { preventFormula = false } = {}) {
  let cell = value == null ? '' : String(value);
  if (preventFormula && /^[\s]*[=+\-@]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function publicationCategoryLabel(category) {
  return presentCategory(category, { style: 'short', missing: '' });
}
