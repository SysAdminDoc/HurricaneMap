// P12.4 — Statistical summary auto-report: Generate one-page reports from filtered datasets.

import { filterLandfalls, getCoverageYearRange, getImpactsFor, getLandfalls } from './data.js';
import { buildExportProvenance } from './export-provenance.js';
import { getDamageMillions, getFatalityCount } from './impact-utils.js';
import {
  presentCategory,
  presentDamageMillions,
  presentFatalities,
} from './metric-presenters.js';

export function generateStatisticalReport(filters, {
  generatedAt = new Date(),
  landfalls = getLandfalls(),
  getImpacts = getImpactsFor,
  coverageYearRange = getCoverageYearRange(),
} = {}) {
  const filtered = filterLandfalls(landfalls, filters);
  const sortedByDate = filtered.slice().sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
  const parsedGeneratedDate = new Date(generatedAt);
  const generatedDate = Number.isNaN(parsedGeneratedDate.getTime()) ? new Date() : parsedGeneratedDate;
  const generatedIso = generatedDate.toISOString();

  const title = buildFilterTitle(filters, coverageYearRange);
  const timestamp = generatedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const uniqueStorms = new Set(filtered.map(lf => lf.storm_id).filter(Boolean)).size;
  const deadliestStorm = findImpactLeader(filtered, getFatalityCount, { getImpacts });
  const costliestStorm = findImpactLeader(filtered, getDamageMillions, { getImpacts });
  const strongestStorm = findStrongestStorm(filtered);
  const earliestLandfall = sortedByDate[0] || null;
  const latestLandfall = sortedByDate[sortedByDate.length - 1] || null;
  const provenance = buildExportProvenance({
    artifactPaths: [
      'data/landfalls.json',
      'data/metadata.json',
      'data/impacts.json',
      'data/hurdat2-sources.json',
      'data/hurdat2-atlantic.txt',
      'data/hurdat2-nepac.txt',
    ],
    exportedAt: generatedIso,
    methodology: [
      'Landfalls are the shipped NOAA/NHC HURDAT2-derived records selected by the supplied filters.',
      'Impact leaders use the bundled normalized impact records; missing records are excluded, not treated as zero.',
      'Month and date distributions use UTC timestamps carried by each landfall record.',
    ],
  });

  const monthCounts = {};
  for (let m = 1; m <= 12; m++) monthCounts[m] = 0;
  filtered.forEach(lf => {
    const m = landfallMonth(lf);
    if (m) monthCounts[m] = (monthCounts[m] || 0) + 1;
  });

  const stateCounts = {};
  filtered.forEach(lf => {
    if (lf.state) stateCounts[lf.state] = (stateCounts[lf.state] || 0) + 1;
  });
  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  const catCounts = {};
  filtered.forEach(lf => {
    const cat = presentCategory(lf.category, { style: 'short', missing: 'Unknown' });
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });

  const markdown = `# Hurricane Landfall Summary Report

**Report Date:** ${timestamp}  
**Data Source:** NOAA NHC HURDAT2 Best-Track Database  
**GitHub:** https://github.com/SysAdminDoc/HurricaneMap

---

## Filter Summary

${title}

---

## Key Metrics

| Metric | Value |
|--------|-------|
| **Total Landfalls** | ${filtered.length} |
| **Unique Storms** | ${uniqueStorms} |
| **Year Range** | ${filters.yearMin}-${filters.yearMax} |
| **Strongest Wind** | ${strongestStorm ? strongestStorm.wind + ' kt - ' + strongestStorm.name + ' (' + strongestStorm.year + ')' : 'N/A'} |
| **Deadliest Storm** | ${formatImpactLeader(deadliestStorm, formatFatalities)} |
| **Costliest Storm** | ${formatImpactLeader(costliestStorm, formatDamageMillions)} |

---

## Temporal Distribution

### By Month
${formatMonthChart(monthCounts, filtered.length)}

### Date Range
- **Earliest:** ${formatLandfallDate(earliestLandfall)}
- **Latest:** ${formatLandfallDate(latestLandfall)}

---

## Geographic Distribution

### Top 5 States
${formatTopStates(topStates)}

---

## Intensity Distribution

### By Saffir-Simpson Category
${formatCategoryDistribution(catCounts, filtered.length)}

---

## Data Source & Attribution

Historical hurricane landfall data sourced from **NOAA's National Hurricane Center HURDAT2 best-track database** (https://www.nhc.noaa.gov/data/).

**Citation:** Landsea, C. W., and J. L. Franklin, 2013: The Atlantic Hurricane Database Re-analysis Project: Documentation for the 1851-2012 Alterations and Additions to the HURDAT2 Database. NOAA Technical Memorandum NWS NHC-7.

### Methodology Notes

- **Landfalls** are identified as points where the cyclone center crosses a U.S. state boundary or coastline (HURDAT2 \`L\` marker or inferred via point-in-polygon).
- **Categories** assigned by Saffir-Simpson scale based on maximum sustained winds at landfall.
- **Wind Speed** recorded in knots (kt); conversion to mph: kt x 1.15078.
- **Impact leaders** use the bundled impact dataset when a storm has parsed casualty or damage data; storms without impact records are excluded from deadliest/costliest rankings.
- **Pre-1945 data** is less accurate due to pre-aircraft reconnaissance; pre-satellite data should be interpreted with caution.

## Release Provenance

\`\`\`json
${JSON.stringify(provenance, null, 2)}
\`\`\`

---

**Report Generated by HurricaneMap** - https://github.com/SysAdminDoc/HurricaneMap
`;

  return {
    markdown,
    title: `Hurricane-Summary-${generatedIso.split('T')[0]}`,
    provenance,
  };
}

export function buildFilterTitle(filters, [yearMinDefault, yearMaxDefault] = getCoverageYearRange()) {
  const parts = [];

  if (filters.yearMin !== yearMinDefault || filters.yearMax !== yearMaxDefault) {
    parts.push(`Years ${filters.yearMin}-${filters.yearMax}`);
  }

  if (filters.categories instanceof Set && filters.categories.size < 6) {
    const cats = Array.from(filters.categories).sort((a, b) => {
      const aNum = a === 'ts' ? -1 : parseInt(a, 10);
      const bNum = b === 'ts' ? -1 : parseInt(b, 10);
      return aNum - bNum;
    }).map(c => c === 'ts' ? 'Tropical Storm' : 'Cat ' + c);
    parts.push(`Categories: ${cats.join(', ') || 'None'}`);
  }

  if (filters.state) {
    parts.push(`State: ${filters.state}`);
  }

  if (parts.length === 0) {
    return `All landfalls (${yearMinDefault}-${yearMaxDefault}, all categories, all states)`;
  }

  return parts.join(' | ');
}

function monthName(m) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[m - 1] || '';
}

// Landfall records carry only the ISO timestamp `t`; derive calendar fields.
function landfallDateUTC(lf) {
  if (!lf?.t) return null;
  const when = new Date(lf.t);
  return Number.isNaN(when.getTime()) ? null : when;
}

function landfallMonth(lf) {
  const when = landfallDateUTC(lf);
  return when ? when.getUTCMonth() + 1 : null;
}

function formatLandfallDate(lf) {
  if (!lf) return 'N/A';
  const when = landfallDateUTC(lf);
  if (!when) return String(lf.year ?? 'N/A');
  return `${monthName(when.getUTCMonth() + 1)} ${when.getUTCDate()}, ${lf.year}`;
}

function formatMonthChart(counts, total) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lines = [];

  for (let i = 1; i <= 12; i++) {
    const count = counts[i] || 0;
    const pct = total > 0 ? Math.round(count / total * 100) : 0;
    const bar = '#'.repeat(Math.round(count / 3));
    lines.push(`- **${months[i - 1]}** - ${count} (${pct}%) ${bar}`);
  }

  return lines.join('\n');
}

function formatTopStates(topStates) {
  if (!topStates.length) return '- No matching landfalls.';
  return topStates
    .map(([state, count]) => `- **${state}** - ${count} landfall${count === 1 ? '' : 's'}`)
    .join('\n');
}

function formatCategoryDistribution(catCounts, total) {
  if (total === 0) return '- No matching landfalls.';
  return Object.entries(catCounts)
    .sort(([a], [b]) => {
      const aNum = a === 'TS' ? -1 : parseInt(a, 10);
      const bNum = b === 'TS' ? -1 : parseInt(b, 10);
      return aNum - bNum;
    })
    .map(([cat, count]) => `- **${cat === 'TS' ? 'Tropical Storm' : 'Category ' + cat}** - ${count} (${Math.round(count / total * 100)}%)`)
    .join('\n');
}

export function findImpactLeader(landfalls, valueSelector, { getImpacts = getImpactsFor } = {}) {
  const storms = new Map();
  for (const lf of landfalls || []) {
    if (lf?.storm_id && !storms.has(lf.storm_id)) storms.set(lf.storm_id, lf);
  }

  let leader = null;
  for (const [stormId, landfall] of storms) {
    const impacts = getImpacts(stormId);
    const value = valueSelector(impacts);
    if (!Number.isFinite(value)) continue;
    if (!leader || value > leader.value) {
      leader = { ...landfall, value, impacts };
    }
  }
  return leader;
}

function findStrongestStorm(landfalls) {
  let strongest = null;
  let maxWind = -Infinity;

  for (const lf of landfalls) {
    if (Number.isFinite(lf.wind) && lf.wind > maxWind) {
      maxWind = lf.wind;
      strongest = lf;
    }
  }

  return strongest;
}

function formatImpactLeader(leader, formatter) {
  if (!leader) return 'N/A';
  return `${leader.name || 'UNNAMED'} (${leader.year}) - ${formatter(leader.value)}`;
}

function formatFatalities(value) {
  return presentFatalities(value);
}

function formatDamageMillions(value) {
  return presentDamageMillions(value);
}

function timeKey(lf) {
  if (lf?.t) return lf.t;
  return `${String(lf?.year ?? 0).padStart(4, '0')}-${String(lf?.month ?? 1).padStart(2, '0')}-${String(lf?.day ?? 1).padStart(2, '0')}T${String(lf?.hour ?? 0).padStart(2, '0')}:00:00Z`;
}

export function downloadReportAsText(markdown, filename) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename + '.md');
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
