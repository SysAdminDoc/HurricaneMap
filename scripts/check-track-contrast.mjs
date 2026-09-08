// The comparison tracks have to stay readable on the basemap.
//
// The four pin colours used to serve the chip, the table column and the track,
// and a comment in styles-themes.css put the track at 4.28:1. That number was
// the flat colour against one OpenStreetMap fill, with the polyline's own 0.85
// opacity left out and the other fills unmeasured. Composited, the light set
// reached 2.52:1 and the dark set 1.02:1, both under the 3:1 that WCAG 2.2 SC
// 1.4.11 asks of a graphical object.
//
// The first version of this gate then made the same class of mistake one level
// up: it measured every colour against the raw OSM fills and merely checked the
// shape of the dark theme's tile filter, so the figure it printed was one no
// reader of the default theme ever sees. It now applies the filter. The colour
// matrices below were checked against Chromium's own painting of the shipped
// filter over all five fills, and agree to the byte on every channel. Anything
// in the filter this cannot apply fails the gate rather than being waved past.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styleDir = path.join(root, 'src');

// OpenStreetMap Carto's large-area fills, which is what a track actually
// crosses: paper, land, water, forest and built-up. The worst counts.
const BASEMAP_SURFACES = Object.freeze({
  paper: '#ffffff',
  land: '#f2efe9',
  water: '#aad3df',
  forest: '#add19e',
  built: '#d9d0c9',
});

const MINIMUM_RATIO = 3;

export function parseHex(value) {
  const clean = String(value).trim().replace('#', '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(clean)) return null;
  const full = clean.length === 3 ? [...clean].map(character => character + character).join('') : clean;
  return [0, 2, 4].map(index => Number.parseInt(full.slice(index, index + 2), 16));
}

const channel = value => {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

export const luminance = rgb => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

export function contrastRatio(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

// A stroke drawn at alpha over an opaque surface is the source-over blend, and
// what a reader sees is that blend against the same surface.
export const composite = (foreground, background, alpha) =>
  foreground.map((value, index) => value * alpha + background[index] * (1 - alpha));

// CSS filter functions, per Filter Effects. The shorthand filters operate on
// non-linear sRGB, which is why there is no linearisation here.
const clamp = value => Math.max(0, Math.min(255, value));
const applyMatrix = (rgb, m) => [
  clamp(m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2]),
  clamp(m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2]),
  clamp(m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2]),
];
const between = (identity, target, amount) => identity.map((value, index) => value + (target[index] - value) * amount);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
const GRAYSCALE = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722];

const saturateMatrix = s => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
];
const hueRotateMatrix = degrees => {
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
};

// Returns the filtered colour, or throws naming the function it cannot apply.
export function applyCssFilter(rgb, filter) {
  const text = String(filter || '').trim();
  if (!text || text === 'none') return [...rgb];
  let out = [...rgb];
  let consumed = 0;
  for (const match of text.matchAll(/([a-z-]+)\(\s*([^)]*)\)/gi)) {
    consumed += match[0].length;
    const name = match[1].toLowerCase();
    const raw = match[2].trim();
    const number = Number.parseFloat(raw);
    if (!Number.isFinite(number)) throw new Error(`${name}() has no numeric amount this gate can read: "${raw}"`);
    const amount = raw.endsWith('%') ? number / 100 : number;
    switch (name) {
      case 'sepia': out = applyMatrix(out, between(IDENTITY, SEPIA, amount)); break;
      case 'grayscale': out = applyMatrix(out, between(IDENTITY, GRAYSCALE, amount)); break;
      case 'saturate': out = applyMatrix(out, saturateMatrix(amount)); break;
      case 'hue-rotate': out = applyMatrix(out, hueRotateMatrix(raw.endsWith('rad') ? (number * 180) / Math.PI : number)); break;
      case 'brightness': out = out.map(value => clamp(value * amount)); break;
      case 'contrast': out = out.map(value => clamp(value * amount + 255 * (0.5 - 0.5 * amount))); break;
      case 'invert': out = out.map(value => clamp(value * (1 - amount) + (255 - value) * amount)); break;
      case 'opacity': break; // Alpha only; the tile pane sits on an opaque map.
      default: throw new Error(`${name}() is a filter this gate cannot apply, so the rendered basemap is unknown`);
    }
  }
  // A blur, a drop-shadow or a url() reference leaves text this loop did not
  // consume, and silently measuring the wrong colour is the failure mode here.
  const leftover = text.replace(/([a-z-]+)\(\s*([^)]*)\)/gi, '').trim();
  if (!consumed || leftover) throw new Error(`could not read the whole filter: "${text}"`);
  return out.map(Math.round);
}

async function main() {
  const files = (await readdir(styleDir)).filter(name => name.endsWith('.css')).sort();
  const stylesheets = new Map();
  for (const file of files) stylesheets.set(`src/${file}`, await readFile(path.join(styleDir, file), 'utf8'));
  const compareJs = await readFile(path.join(root, 'src/compare.js'), 'utf8');
  const errors = [];

  // The polyline's alpha, read from the call that draws it rather than assumed.
  const opacityMatch = compareJs.match(/\bopacity:\s*([0-9.]+),/);
  const opacity = opacityMatch ? Number(opacityMatch[1]) : null;
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    console.error(`track contrast: could not read the comparison track opacity from src/compare.js (found ${opacityMatch?.[1]})`);
    process.exit(1);
  }

  // Every declaration of a track token in every stylesheet, so a theme or
  // high-contrast override is measured rather than assumed absent. Reading a
  // subset was its own bug: the shell and utilities layers are both later than
  // tokens, so an override in either would have been invisible.
  const declarations = new Map();
  for (const [file, css] of stylesheets) {
    for (const match of css.matchAll(/--pin-([1-4])-track:\s*([^;]+);/g)) {
      const slot = Number(match[1]);
      if (!declarations.has(slot)) declarations.set(slot, []);
      declarations.get(slot).push({ file, value: match[2].trim() });
    }
  }
  for (const slot of [1, 2, 3, 4]) {
    if (!declarations.has(slot)) errors.push(`no stylesheet declares --pin-${slot}-track`);
  }

  const fallbacks = new Map(
    [...compareJs.matchAll(/trackToken:\s*'--pin-([1-4])-track',\s*trackFallback:\s*'([^']+)'/g)]
      .map(match => [Number(match[1]), match[2].trim()]),
  );
  for (const slot of [1, 2, 3, 4]) {
    if (!fallbacks.has(slot)) errors.push(`src/compare.js declares no trackFallback for --pin-${slot}-track`);
  }

  // What the basemap actually looks like in each theme. The light theme sets
  // the tile pane back to filter: none; the dark theme, which is the default,
  // recolours it, and that is the surface most readers see a track on.
  const themes = [];
  const allCss = [...stylesheets.values()].join('\n');
  const darkFilter = allCss.match(/html:not\(\.light-theme\)\s*#map\s*\.leaflet-tile-pane\s*\{[^}]*?filter:\s*([^;]+);/)?.[1];
  const lightFilter = allCss.match(/html\.light-theme\s*#map\s*\.leaflet-tile-pane\s*\{[^}]*?filter:\s*([^;]+);/)?.[1];
  if (!darkFilter) {
    errors.push('no rule filters the dark-theme tile pane any more, so this gate cannot tell what the basemap looks like');
  }
  for (const [name, filter] of [['dark', darkFilter], ['light', lightFilter ?? 'none']]) {
    if (filter === undefined) continue;
    const surfaces = {};
    try {
      for (const [surface, hex] of Object.entries(BASEMAP_SURFACES)) surfaces[surface] = applyCssFilter(parseHex(hex), filter);
    } catch (error) {
      errors.push(`the ${name} theme's tile filter cannot be measured: ${error.message}`);
      continue;
    }
    themes.push({ name, filter: String(filter).trim(), surfaces });
  }

  const measured = [];
  for (const slot of [1, 2, 3, 4]) {
    const rootDeclaration = (declarations.get(slot) || [])[0];
    if (rootDeclaration && fallbacks.has(slot) && fallbacks.get(slot).toLowerCase() !== rootDeclaration.value.toLowerCase()) {
      errors.push(
        `src/compare.js falls back to ${fallbacks.get(slot)} for slot ${slot} but ${rootDeclaration.file} declares ${rootDeclaration.value}`,
      );
    }
    const candidates = [
      ...(declarations.get(slot) || []),
      ...(fallbacks.has(slot) ? [{ file: 'src/compare.js', value: fallbacks.get(slot) }] : []),
    ];
    for (const candidate of candidates) {
      const rgb = parseHex(candidate.value);
      if (!rgb) {
        errors.push(`${candidate.file} gives --pin-${slot}-track a value this gate cannot measure: ${candidate.value}`);
        continue;
      }
      for (const theme of themes) {
        for (const [surface, background] of Object.entries(theme.surfaces)) {
          const ratio = contrastRatio(composite(rgb, background, opacity), background);
          measured.push({ slot, theme: theme.name, surface, value: candidate.value, file: candidate.file, ratio });
          if (ratio < MINIMUM_RATIO) {
            errors.push(
              `${candidate.file}: --pin-${slot}-track ${candidate.value} is ${ratio.toFixed(2)}:1 on the ${theme.name} theme's `
              + `${surface} fill at ${opacity} opacity, under ${MINIMUM_RATIO}:1`,
            );
          }
        }
      }
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`track contrast: ${error}`);
    process.exit(1);
  }

  const worst = measured.reduce((lowest, row) => (row.ratio < lowest.ratio ? row : lowest));
  console.log(
    `track contrast ok (${measured.length} measurements at ${opacity} opacity across ${themes.length} rendered basemaps, worst `
    + `${worst.ratio.toFixed(2)}:1 for --pin-${worst.slot}-track on the ${worst.theme} theme's ${worst.surface} fill)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
