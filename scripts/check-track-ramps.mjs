// The track ramps, held to the same bar as the comparison track colours.
//
// check-track-contrast.mjs measures four hand-picked pin colours. These are
// generated, so there are three separate things to check and only the first is
// what that gate does:
//
//   1. every stop clears 3:1 (WCAG 2.2 SC 1.4.11) on every basemap fill a
//      reader can see, in every mode, at the opacity showTrack actually draws;
//   2. every stop is what RAMP_GEOMETRY generates, so the written-out arrays
//      cannot drift away from the corridor they were derived from;
//   3. the stops stay separable from each other under simulated protanopia,
//      deuteranopia and tritanopia, which is the claim "colourblind-safe ramp"
//      actually makes. Contrast against the background says nothing about it:
//      a ramp of seven colours that all clear 3:1 and collapse into one under
//      deuteranopia would pass check 1 outright.
//
// The basemap is resolved with check-track-contrast.mjs's own machinery rather
// than a second copy, so the two gates cannot disagree about what a reader
// sees. Anything it cannot measure fails here too.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyCssFilter,
  cascadeOrder,
  composite,
  contrastRatio,
  enclosingConditions,
  MODE_CLASSES,
  parseHex,
  selectorApplies,
  stripCssComments,
  tilePaneRules,
} from './check-track-contrast.mjs';
import {
  MONTH_RAMP,
  NO_DATA_COLOR,
  PRESSURE_RAMP,
  rampStops,
  WIND_RAMP,
} from '../src/track-ramps.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styleDir = path.join(root, 'src');

const BASEMAP_SURFACES = Object.freeze({
  paper: '#ffffff',
  land: '#f2efe9',
  water: '#aad3df',
  forest: '#add19e',
  built: '#d9d0c9',
});

const MINIMUM_RATIO = 3;
// CIE76 dE. 2.3 is the just-noticeable difference for adjacent patches; a map
// line seen against a busy basemap needs more than that, and 10 is the figure
// the ramps were searched against.
const MINIMUM_DELTA_E = 10;

// Viénot, Brettel and Mollon (1999), the linear dichromat model the CVD
// tooling uses. Operates on linear-light sRGB.
const CVD_MATRICES = Object.freeze({
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
});

const toLinear = (value) => {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (value) => {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(255 * (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055));
};

export function simulateCvd(rgb, kind) {
  const m = CVD_MATRICES[kind];
  const [r, g, b] = rgb.map(toLinear);
  return [
    toSrgb(m[0] * r + m[1] * g + m[2] * b),
    toSrgb(m[3] * r + m[4] * g + m[5] * b),
    toSrgb(m[6] * r + m[7] * g + m[8] * b),
  ];
}

function toLab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function deltaE(a, b) {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The one alpha showTrack draws at, read from the call rather than assumed. */
async function trackOpacity(errors) {
  const mapJs = await readFile(path.join(root, 'src/map.js'), 'utf8');
  const match = mapJs.match(/color: segmentColor\(seg, color\),\s*\n\s*weight:[^\n]*\n\s*opacity:\s*([0-9.]+),/);
  const value = match ? Number(match[1]) : null;
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    errors.push(`could not read the track opacity from src/map.js (found ${match?.[1]})`);
    return null;
  }
  return value;
}

/** The basemap each mode renders, resolved exactly as the sibling gate does. */
async function basemapsByMode(errors) {
  const entry = await readFile(path.join(styleDir, 'styles.css'), 'utf8');
  const stylesheets = [];
  for (const item of cascadeOrder(entry)) {
    const raw = await readFile(path.join(styleDir, path.basename(item.file)), 'utf8');
    stylesheets.push({ ...item, css: stripCssComments(raw) });
  }
  const FILTER_DECLARATION_RE = /(?:^|[;{\s])filter\s*:\s*([^;}]+)/g;
  const paneFilters = [];
  for (const [rank, sheet] of stylesheets.entries()) {
    for (const rule of tilePaneRules(sheet.css)) {
      const flattened = rule.body.replace(/(^|[{};])\s*[@&][^{};]*\{/g, '$1 ').replace(/\}/g, ' ');
      const found = [...flattened.matchAll(FILTER_DECLARATION_RE)];
      if (!found.length) continue;
      const at = sheet.css.indexOf(rule.body);
      if (at !== -1 && enclosingConditions(sheet.css, at).length) {
        errors.push(`${sheet.file} filters the tile pane inside a condition this gate cannot evaluate`);
        continue;
      }
      paneFilters.push({
        selector: rule.selector,
        filter: found[found.length - 1][1].replace(/!important\s*$/i, '').trim().toLowerCase(),
        rank,
        at,
      });
    }
  }
  const modes = [];
  for (const mode of Object.keys(MODE_CLASSES)) {
    const applies = paneFilters
      .filter(entryItem => selectorApplies(entryItem.selector, MODE_CLASSES[mode]))
      .sort((a, b) => (a.rank - b.rank) || (a.at - b.at));
    const pane = applies.length ? applies[applies.length - 1] : null;
    if (!pane) {
      errors.push(`no tile-pane rule applies in ${mode}, so this gate cannot tell what that basemap looks like`);
      continue;
    }
    const surfaces = {};
    try {
      for (const [name, hex] of Object.entries(BASEMAP_SURFACES)) {
        surfaces[name] = applyCssFilter(parseHex(hex), pane.filter);
      }
    } catch (error) {
      errors.push(`the tile filter on ${pane.selector} cannot be measured: ${error.message}`);
      continue;
    }
    modes.push({ mode, pane, surfaces });
  }
  return modes;
}

async function main() {
  const errors = [];
  const opacity = await trackOpacity(errors);
  const modes = await basemapsByMode(errors);
  if (opacity === null || !modes.length) {
    for (const error of errors) console.error(`track ramps: ${error}`);
    process.exit(1);
  }

  const ramps = [
    { name: 'wind', stops: WIND_RAMP },
    { name: 'pressure', stops: PRESSURE_RAMP },
    { name: 'month', stops: MONTH_RAMP },
  ];

  // 2. Generated, not typed. A stop that drifts from the corridor is a colour
  //    nothing measured before it shipped.
  for (const { name, stops } of ramps) {
    const derived = rampStops(stops.length);
    for (const [index, stop] of stops.entries()) {
      if (stop.toLowerCase() !== derived[index].toLowerCase()) {
        errors.push(
          `${name} stop ${index} is ${stop} but RAMP_GEOMETRY generates ${derived[index]}; `
          + 'the written-out ramp has drifted from the corridor it was derived from',
        );
      }
    }
  }

  // 1. Contrast, including the no-data colour, which paints just as much track
  //    as any ramp stop does.
  let measurements = 0;
  let worst = null;
  for (const { name, stops } of [...ramps, { name: 'no-data', stops: [NO_DATA_COLOR] }]) {
    for (const stop of stops) {
      const rgb = parseHex(stop);
      if (!rgb) {
        errors.push(`${name} carries a value this gate cannot measure: ${stop}`);
        continue;
      }
      for (const entry of modes) {
        for (const [surface, background] of Object.entries(entry.surfaces)) {
          const ratio = contrastRatio(composite(rgb, background, opacity), background);
          measurements += 1;
          if (!worst || ratio < worst.ratio) worst = { ratio, name, stop, surface, mode: entry.mode };
          if (ratio < MINIMUM_RATIO) {
            errors.push(
              `${name} stop ${stop} is ${ratio.toFixed(2)}:1 on the ${surface} fill of the basemap a `
              + `${entry.mode} reader sees, at ${opacity} opacity, under ${MINIMUM_RATIO}:1`,
            );
          }
        }
      }
    }
  }

  // 3. Separability, including under each dichromacy. Every pair, not just
  //    neighbours: a ramp that folds back on itself puts two different
  //    readings in the same colour just as surely as two adjacent stops do.
  let worstPair = null;
  for (const { name, stops } of ramps) {
    for (const kind of ['normal', 'protanopia', 'deuteranopia', 'tritanopia']) {
      const seen = stops.map(stop => (kind === 'normal' ? parseHex(stop) : simulateCvd(parseHex(stop), kind)));
      for (let i = 0; i < seen.length; i += 1) {
        for (let j = i + 1; j < seen.length; j += 1) {
          const distance = deltaE(seen[i], seen[j]);
          if (!worstPair || distance < worstPair.distance) {
            worstPair = { distance, name, kind, a: stops[i], b: stops[j] };
          }
          if (distance < MINIMUM_DELTA_E) {
            errors.push(
              `${name} stops ${stops[i]} and ${stops[j]} are dE ${distance.toFixed(1)} apart under `
              + `${kind}, under the ${MINIMUM_DELTA_E} this ramp claims`,
            );
          }
        }
      }
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`track ramps: ${error}`);
    process.exit(1);
  }

  console.log(
    `track ramps ok (${measurements} contrast measurements at ${opacity} opacity across ${modes.length} modes; `
    + `worst ${worst.ratio.toFixed(2)}:1 for ${worst.name} ${worst.stop} on the ${worst.surface} fill in `
    + `${worst.mode}; closest pair dE ${worstPair.distance.toFixed(1)} in ${worstPair.name} under ${worstPair.kind})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
