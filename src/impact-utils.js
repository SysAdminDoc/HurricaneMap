export function getFatalityCount(impacts) {
  if (!impacts) return null;
  if (Number.isFinite(impacts.deaths_total)) return impacts.deaths_total;
  return parseLegacyDeaths(impacts.deaths);
}

export function getDamageMillions(impacts) {
  if (!impacts) return null;
  if (Number.isFinite(impacts.damage_millions_usd)) return impacts.damage_millions_usd;
  if (Number.isFinite(impacts.damage_usd_nominal)) return impacts.damage_usd_nominal / 1_000_000;
  return parseLegacyDamageMillions(impacts.damages);
}

export function getNominalDamageUsd(impacts) {
  if (!impacts) return null;
  if (Number.isFinite(impacts.damage_usd_nominal)) return impacts.damage_usd_nominal;
  const damageMillions = getDamageMillions(impacts);
  return Number.isFinite(damageMillions) ? Math.round(damageMillions * 1_000_000) : null;
}

export function getRawFatalityText(impacts) {
  return impacts?.deaths ? String(impacts.deaths) : '';
}

export function getRawDamageText(impacts) {
  return impacts?.damages ? String(impacts.damages) : '';
}

export function formatFatalityCount(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toLocaleString();
}

function parseLegacyDeaths(value) {
  if (!value) return null;
  const text = String(value).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const lowered = text.toLowerCase();
  if (lowered.includes('none reported') || lowered.includes('no fatalities') || lowered.includes('no deaths')) {
    return 0;
  }
  const numbers = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map(match => Math.round(Number(match[0].replace(/,/g, ''))))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  if (lowered.includes('direct') && lowered.includes('indirect') && numbers.length >= 2) {
    return numbers[0] + numbers[1];
  }
  if (/\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to)\s*\d/i.test(text) && numbers.length >= 2) {
    return Math.max(numbers[0], numbers[1]);
  }
  return numbers[0];
}

function parseLegacyDamageMillions(value) {
  if (!value) return null;
  const text = String(value).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  const lowered = text.toLowerCase();
  const numbers = [...text.replace(/,/g, '').matchAll(/\d+(?:\.\d+)?/g)]
    .map(match => Number(match[0]))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  const hasExplicitUnit = /trillion|billion|million|thousand/.test(lowered);
  const hasPlusExpression = /\d+(?:\.\d+)?\s*\+\s*\d/.test(text.replace(/,/g, ''));
  const amount = hasPlusExpression && !hasExplicitUnit
    ? numbers.reduce((sum, number) => sum + number, 0)
    : numbers[0];
  if (!Number.isFinite(amount)) return null;
  if (lowered.includes('trillion')) return amount * 1_000_000;
  if (lowered.includes('billion')) return amount * 1_000;
  if (lowered.includes('million')) return amount;
  if (lowered.includes('thousand')) return amount / 1_000;
  if (amount >= 10_000) return amount / 1_000_000;
  return amount;
}
