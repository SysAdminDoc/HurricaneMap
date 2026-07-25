// Pure presentation rules shared by UI, reports, and machine-readable exports.
// Callers choose the missing-value token appropriate to their surface.

export const MISSING_METRIC = '—';

const WIND_FACTORS = Object.freeze({
  kt: 1,
  mph: 1.15078,
  kmh: 1.852,
});

const WIND_LABELS = Object.freeze({
  kt: 'kt',
  mph: 'mph',
  kmh: 'km/h',
});

export function presentNumber(value, decimals = 0, { missing = MISSING_METRIC } = {}) {
  if (!Number.isFinite(value)) return missing;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function roundMetric(value, decimals = 0) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function presentCategory(category, {
  style = 'display',
  missing = MISSING_METRIC,
} = {}) {
  if (category === 0) {
    if (style === 'long') return 'Tropical Depression';
    return 'TD';
  }
  if (category === -1) {
    if (style === 'long') return 'Tropical Storm';
    return 'TS';
  }
  if (!Number.isInteger(category) || category < 1 || category > 5) return missing;
  if (style === 'short') return String(category);
  if (style === 'long') return `Category ${category}`;
  return `Cat ${category}`;
}

export function convertWindKnots(knots, unit = 'kt') {
  if (!Number.isFinite(knots) || !Object.hasOwn(WIND_FACTORS, unit)) return null;
  return knots * WIND_FACTORS[unit];
}

export function presentWind(knots, {
  unit = 'kt',
  decimals = 0,
  suffix = true,
  missing = MISSING_METRIC,
} = {}) {
  const converted = convertWindKnots(knots, unit);
  if (!Number.isFinite(converted)) return missing;
  const value = decimals == null
    ? String(Math.round(converted))
    : converted.toFixed(decimals);
  return suffix ? `${value} ${WIND_LABELS[unit]}` : value;
}

export function presentPressure(pressureMb, { missing = MISSING_METRIC } = {}) {
  return Number.isFinite(pressureMb) ? `${presentNumber(pressureMb)} mb` : missing;
}

export function presentFatalities(value, { missing = 'N/A' } = {}) {
  if (!Number.isFinite(value)) return missing;
  const count = value >= 10_000
    ? `${Math.round(value / 1_000)}k`
    : value.toLocaleString('en-US');
  return `${count} ${value === 1 ? 'fatality' : 'fatalities'}`;
}

export function presentDamageMillions(value, { missing = 'N/A' } = {}) {
  if (!Number.isFinite(value)) return missing;
  if (value >= 1000) {
    const billions = value / 1000;
    return `$${billions.toLocaleString('en-US', {
      maximumFractionDigits: billions >= 10 ? 0 : 1,
    })}B`;
  }
  if (value >= 1) {
    return `$${value.toLocaleString('en-US', {
      maximumFractionDigits: value >= 10 ? 0 : 1,
    })}M`;
  }
  return `$${Math.round(value * 1000).toLocaleString('en-US')}K`;
}
