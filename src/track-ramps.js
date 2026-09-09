// What a track segment's colour means, when it does not mean Saffir-Simpson.
//
// There is one ramp here, not one per encoding, and that is a measured result
// rather than a shortcut. Every mode of this app renders a LIGHT basemap: the
// dark theme's tile filter only greys OpenStreetMap's paper from #ffffff to
// #dedfdf, so a track has to be dark to clear the 3:1 that WCAG 2.2 SC 1.4.11
// asks of a graphical object. Sweeping the whole hue circle for the lightest
// colour that still clears 3:1 over all five basemap fills in all four modes
// shows the ceiling is nowhere near flat: greens, cyans and golds cap out
// around 0.20 HSL lightness, while the blue-to-red corridor reaches 0.48. A
// sequential ramp needs lightness range to be readable, and that corridor is
// the only place there is any. Three "different" ramps would therefore have
// been three samplings of the same corridor wearing different labels.
//
// So: one ramp, sampled at as many stops as an encoding has bins. Only one
// encoding is ever active, and the legend names it, so nothing is lost.
//
// scripts/check-track-ramps.mjs re-derives every stop below from RAMP_GEOMETRY
// and fails if any of them drifts, falls under 3:1 on any fill in any mode, or
// stops being separable under simulated protanopia, deuteranopia or
// tritanopia.

import { getDateLocale, t } from './i18n.js';

export const TRACK_COLOR_MODES = Object.freeze(['category', 'wind', 'pressure', 'month']);
export const DEFAULT_TRACK_COLOR_MODE = 'category';

/** The corridor, as the numbers that generated it. */
export const RAMP_GEOMETRY = Object.freeze({
  hueFrom: 256,
  hueTo: 340,
  lightnessFrom: 0.48,
  lightnessTo: 0.12,
  saturation: 1,
});

/**
 * A track point can carry no answer at all: `pres` is null for most storms
 * before the 1980s, and a storm can run outside the June-to-November season.
 * Those segments get this rather than the nearest bin, because putting a
 * pressureless 1851 track at one end of a pressure ramp invents a reading.
 */
export const NO_DATA_COLOR = '#4a4a52';

const hex = ([r, g, b]) => `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

/** HSL to RGB. Hue in degrees, saturation and lightness in 0..1. */
function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = ((((hue % 360) + 360) % 360) / 60);
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
      : sector < 3 ? [0, chroma, second]
        : sector < 4 ? [0, second, chroma]
          : sector < 5 ? [second, 0, chroma]
            : [chroma, 0, second];
  const match = lightness - chroma / 2;
  return [(r + match) * 255, (g + match) * 255, (b + match) * 255];
}

/** The ramp sampled at `count` evenly spaced stops, lightest first. */
export function rampStops(count) {
  const { hueFrom, hueTo, lightnessFrom, lightnessTo, saturation } = RAMP_GEOMETRY;
  return Array.from({ length: count }, (_, index) => {
    const position = count === 1 ? 0 : index / (count - 1);
    return hex(hslToRgb(
      hueFrom + (hueTo - hueFrom) * position,
      saturation,
      lightnessFrom + (lightnessTo - lightnessFrom) * position,
    ));
  });
}

// Written out rather than generated at import time so a change to the geometry
// has to be a deliberate edit in two places, and so the gate has something to
// compare the generator against. Lightest first, which is the weak end.
export const WIND_RAMP = Object.freeze(['#4100f5', '#6b00d6', '#8700b8', '#940099', '#7a0062', '#5c0034', '#3d0014']);
export const PRESSURE_RAMP = WIND_RAMP;
export const MONTH_RAMP = Object.freeze(['#4100f5', '#7200d0', '#8e00ab', '#870078', '#62003c', '#3d0014']);

/**
 * Upper bound of each bin, ascending, with the last bin open-ended. Wind is
 * split finer than Saffir-Simpson at the bottom, where the category scale has
 * one 30-knot bucket for everything below hurricane strength.
 */
export const WIND_BINS = Object.freeze([50, 64, 83, 96, 113, 137, Infinity]);

/**
 * Pressure runs the other way: a lower minimum central pressure is a stronger
 * storm, so the bins are listed strongest-last to keep "darker is stronger"
 * true across both encodings.
 */
export const PRESSURE_BINS = Object.freeze([1005, 990, 975, 960, 945, 920, -Infinity]);

/** June through November. Anything outside the season has no bin. */
export const SEASON_MONTHS = Object.freeze([6, 7, 8, 9, 10, 11]);

function windBinIndex(wind) {
  if (!Number.isFinite(wind)) return -1;
  for (let index = 0; index < WIND_BINS.length; index += 1) {
    if (wind < WIND_BINS[index]) return index;
  }
  return WIND_BINS.length - 1;
}

function pressureBinIndex(pressure) {
  // Number.isFinite is not enough on its own here: the source writes blanks for
  // an unreported pressure, and Number('') is 0, which is finite and would read
  // as the strongest storm ever recorded.
  if (!Number.isFinite(pressure) || pressure <= 0) return -1;
  for (let index = 0; index < PRESSURE_BINS.length; index += 1) {
    if (pressure >= PRESSURE_BINS[index]) return index;
  }
  return PRESSURE_BINS.length - 1;
}

function monthBinIndex(iso) {
  if (!iso) return -1;
  const month = Number(String(iso).slice(5, 7));
  const at = SEASON_MONTHS.indexOf(month);
  return at;
}

/**
 * The colour for one track point under one encoding, or null when the caller
 * should fall back to its own default (which is what 'category' always does,
 * since that palette lives in settings.js and follows the colourblind toggle).
 */
export function trackPointColor(mode, point) {
  if (mode === 'wind') {
    const index = windBinIndex(point?.wind);
    return index < 0 ? NO_DATA_COLOR : WIND_RAMP[index];
  }
  if (mode === 'pressure') {
    const index = pressureBinIndex(point?.pres);
    return index < 0 ? NO_DATA_COLOR : PRESSURE_RAMP[index];
  }
  if (mode === 'month') {
    const index = monthBinIndex(point?.t);
    return index < 0 ? NO_DATA_COLOR : MONTH_RAMP[index];
  }
  return null;
}

function windBinLabel(index) {
  const lower = index === 0 ? 0 : WIND_BINS[index - 1];
  const upper = WIND_BINS[index];
  if (!Number.isFinite(upper)) return t('trackColor.windFrom', String(lower));
  if (index === 0) return t('trackColor.windUnder', String(upper));
  return t('trackColor.windRange', String(lower), String(upper - 1));
}

function pressureBinLabel(index) {
  const upper = index === 0 ? Infinity : PRESSURE_BINS[index - 1];
  const lower = PRESSURE_BINS[index];
  if (index === 0) return t('trackColor.pressureFrom', String(PRESSURE_BINS[0]));
  if (!Number.isFinite(lower)) return t('trackColor.pressureUnder', String(upper));
  return t('trackColor.pressureRange', String(lower), String(upper - 1));
}

function monthLabel(month) {
  // Through the app's own date locale, not the browser's: a Spanish reader on
  // an English browser is reading a Spanish panel.
  const formatter = new Intl.DateTimeFormat(getDateLocale(), { month: 'long', timeZone: 'UTC' });
  return formatter.format(new Date(Date.UTC(2024, month - 1, 15)));
}

/**
 * The legend for the active encoding: one row per bin, in the order the ramp
 * runs, plus the no-data row when that encoding can produce one. Returns an
 * empty array for 'category', which the Saffir-Simpson legend already covers.
 */
export function trackLegendRows(mode) {
  if (mode === 'wind') {
    return [
      ...WIND_RAMP.map((color, index) => ({ color, label: windBinLabel(index) })),
      { color: NO_DATA_COLOR, label: t('trackColor.noWind') },
    ];
  }
  if (mode === 'pressure') {
    return [
      ...PRESSURE_RAMP.map((color, index) => ({ color, label: pressureBinLabel(index) })),
      { color: NO_DATA_COLOR, label: t('trackColor.noPressure') },
    ];
  }
  if (mode === 'month') {
    return [
      ...MONTH_RAMP.map((color, index) => ({ color, label: monthLabel(SEASON_MONTHS[index]) })),
      { color: NO_DATA_COLOR, label: t('trackColor.offSeason') },
    ];
  }
  return [];
}

/** The heading the legend carries, so it says which variable it is showing. */
export function trackLegendTitle(mode) {
  if (mode === 'wind') return t('trackColor.legendWind');
  if (mode === 'pressure') return t('trackColor.legendPressure');
  if (mode === 'month') return t('trackColor.legendMonth');
  return '';
}

/**
 * Paint the legend for whatever a track's colour currently encodes into the
 * block index.html reserves for it. Empty for 'category', which the
 * Saffir-Simpson legend above it already explains, and the block is hidden
 * rather than left showing a heading for an encoding nothing is drawing.
 *
 * It lives here rather than in main.js because main.js is capped at 850 lines
 * by test:shell-boundaries and this is the module that already knows what the
 * rows are.
 */
export function renderTrackColorLegend(mode) {
  const host = document.getElementById('track-color-legend');
  const heading = document.getElementById('track-color-legend-title');
  const list = document.getElementById('track-color-legend-list');
  if (!host || !heading || !list) return 0;
  const rows = trackLegendRows(mode);
  if (!rows.length) {
    host.hidden = true;
    list.replaceChildren();
    heading.textContent = '';
    host.removeAttribute('aria-label');
    return 0;
  }
  const title = trackLegendTitle(mode);
  heading.textContent = title;
  host.setAttribute('aria-label', title);
  // Built as nodes rather than as an HTML string. These labels carry numbers
  // and month names out of Intl and the swatch carries a colour, so there is
  // nothing here that wants markup.
  list.replaceChildren(...rows.map((row) => {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'dot track-color-swatch';
    swatch.style.background = row.color;
    const label = document.createElement('span');
    label.textContent = row.label;
    item.append(swatch, label);
    return item;
  }));
  host.hidden = false;
  return rows.length;
}
