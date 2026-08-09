// Pure comparison metric definitions shared by the panel and CSV export.
// Keep raw reads, diff metadata, and presentation together so the two
// surfaces cannot silently drift apart.

import { t as defaultTranslate } from './i18n.js';
import { windToCategory } from './data.js';
import {
  computeACE,
  computeTranslationStats,
  findRapidIntensification,
  computeRIRiskScore,
  generateStormBiography,
} from './metrics.js';
import {
  presentCategory,
  presentNumber,
  presentPressure,
  presentWind,
} from './metric-presenters.js';
import { formatStormName } from './html-utils.js';

const MISSING = '—';

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function formatDate(value, locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return MISSING;
  return date.toLocaleDateString(locale || 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function trackFor(pin) {
  return Array.isArray(pin?.storm?.track) ? pin.storm.track : [];
}

function statesFor(pin) {
  const states = [...new Set(
    (Array.isArray(pin?.storm?.us_landfalls) ? pin.storm.us_landfalls : [])
      .map(landfall => landfall?.state)
      .filter(Boolean),
  )];
  return states.length ? states.join(', ') : null;
}

const COMPARISON_ROW_DEFINITIONS = Object.freeze([
  {
    id: 'peak-wind',
    labelKey: 'compare.metric.peakWind',
    kind: 'number',
    direction: 'higher',
    card: true,
    getValue: pin => finiteOrNull(pin?.storm?.peak_wind_kt),
    formatValue: (value, { windUnit }) => presentWind(value, { unit: windUnit }),
  },
  {
    id: 'minimum-pressure',
    labelKey: 'compare.metric.minPressure',
    kind: 'number',
    direction: 'lower',
    card: true,
    getValue: pin => finiteOrNull(pin?.storm?.min_pres_mb),
    formatValue: value => presentPressure(value),
  },
  {
    id: 'peak-category',
    labelKey: 'compare.metric.peakCategory',
    kind: 'category',
    card: true,
    getValue: pin => windToCategory(pin?.storm?.peak_wind_kt),
    formatValue: value => presentCategory(value),
  },
  {
    id: 'landfall-category',
    labelKey: 'compare.metric.landfallCategory',
    kind: 'category',
    card: true,
    getValue: pin => finiteOrNull(pin?.storm?.landfall_max_category),
    formatValue: value => presentCategory(value),
  },
  {
    id: 'us-landfalls',
    labelKey: 'compare.metric.usLandfalls',
    kind: 'number',
    direction: 'higher',
    card: true,
    getValue: pin => finiteOrNull(pin?.storm?.us_landfall_count),
    formatValue: value => presentNumber(value),
  },
  {
    id: 'track-points',
    labelKey: 'compare.metric.trackPoints',
    kind: 'number',
    direction: 'higher',
    getValue: pin => trackFor(pin).length,
    formatValue: value => presentNumber(value),
  },
  {
    id: 'genesis',
    labelKey: 'compare.metric.genesis',
    kind: 'text',
    getValue: pin => trackFor(pin)[0]?.t ?? null,
    formatValue: (value, { locale }) => formatDate(value, locale),
  },
  {
    id: 'final',
    labelKey: 'compare.metric.final',
    kind: 'text',
    getValue: pin => trackFor(pin).at(-1)?.t ?? null,
    formatValue: (value, { locale }) => formatDate(value, locale),
  },
  {
    id: 'states-hit',
    labelKey: 'compare.metric.statesHit',
    kind: 'text',
    card: true,
    getValue: statesFor,
    formatValue: value => value || MISSING,
  },
  {
    id: 'ace',
    labelKey: 'compare.metric.ace',
    kind: 'number',
    direction: 'higher',
    getValue: pin => finiteOrNull(computeACE(trackFor(pin)).value),
    formatValue: value => presentNumber(value, 2),
  },
  {
    id: 'forward-speed',
    labelKey: 'compare.metric.forwardSpeed',
    kind: 'number',
    direction: 'higher',
    getValue: pin => finiteOrNull(computeTranslationStats(trackFor(pin))?.mean_kmh),
    formatValue: value => presentNumber(value, 1),
  },
  {
    id: 'rapid-intensification',
    labelKey: 'compare.metric.rapidIntensification',
    kind: 'text',
    getValue: pin => findRapidIntensification(trackFor(pin)),
    formatValue: (value, { translate }) => value
      ? translate(
        'compare.riDetected',
        `+${presentNumber(value.delta_kt)} kt`,
        presentNumber(Math.round(value.hours)),
      )
      : translate('compare.riNone'),
  },
  {
    id: 'ri-risk-category',
    labelKey: 'compare.metric.riRiskCategory',
    kind: 'category',
    getValue: (pin, { allStorms }) => computeRIRiskScore(pin?.storm, allStorms),
    formatValue: (value, { translate }) => value?.category || translate('compare.notAvailable'),
  },
]);

export const COMPARISON_ROW_IDS = Object.freeze(
  COMPARISON_ROW_DEFINITIONS.map(row => row.id),
);

/** Return the typed row contract bound to the current locale/settings. */
export function getComparisonRows({
  allStorms = [],
  translate = defaultTranslate,
  windUnit = 'kt',
  locale = 'en-US',
} = {}) {
  const context = { allStorms, translate, windUnit, locale };
  return COMPARISON_ROW_DEFINITIONS.map(definition => ({
    id: definition.id,
    label: translate(definition.labelKey),
    kind: definition.kind,
    direction: definition.direction,
    card: Boolean(definition.card),
    getValue: pin => definition.getValue(pin, context),
    formatValue: value => definition.formatValue(value, context),
  }));
}

export function formatComparisonValue(row, pin) {
  return row.formatValue(row.getValue(pin));
}

/** Escape a value for CSV (wrap in quotes if it contains CSV syntax). */
export function escapeCSV(value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/** Build comparison table and narrative CSV without touching browser APIs. */
export function buildComparisonCSVText({
  storms = [],
  allStorms = [],
  translate = defaultTranslate,
  windUnit = 'kt',
  locale = 'en-US',
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!storms.length) return '';
  const rows = getComparisonRows({ allStorms, translate, windUnit, locale });
  const header = [
    translate('compare.csv.metric'),
    ...storms.map(pin => `${formatStormName(pin.name)} (${pin.year})`),
  ].map(escapeCSV).join(',');
  const tableRows = rows.map(row => [
    row.label,
    ...storms.map(pin => formatComparisonValue(row, pin)),
  ].map(escapeCSV).join(','));
  const narrativeSection = [
    '',
    '',
    translate('compare.narrativesTitle'),
    `${translate('compare.narrativeLanguage')},${escapeCSV(translate('compare.narrativeLanguageEnglish'))}`,
    ...storms.map(pin => escapeCSV(
      `${formatStormName(pin.name)} (${pin.year}): ${generateStormBiography(pin.storm, {})}`,
    )),
  ];
  return [
    header,
    ...tableRows,
    ...narrativeSection,
    '',
    `${translate('compare.dataSource')}: ${translate('compare.dataSourceValue')}`,
    `${translate('compare.generated')}: ${generatedAt}`,
  ].join('\n');
}
