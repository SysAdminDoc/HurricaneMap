// The comparison tracks have to stay readable on the basemap.
//
// The four pin colours used to serve the chip, the table column and the track,
// and a comment in styles-themes.css put the track at 4.28:1. That number was
// the flat colour against one OpenStreetMap fill, with the polyline's own 0.85
// opacity left out and the other fills unmeasured. Composited, the light set
// reached 2.52:1 and the dark set 1.02:1, both under the 3:1 that WCAG 2.2 SC
// 1.4.11 asks of a graphical object. This recomputes the real figure from the
// tokens and the opacity as they are written in source, so the palette cannot
// drift back under the line and a comment cannot claim a ratio nothing checked.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

// OpenStreetMap Carto's large-area fills, which is what a track actually
// crosses: paper, land, water, forest and built-up. The worst of the five is
// the one that counts.
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
};

// A stroke drawn at alpha over an opaque surface is the source-over blend, and
// what a reader sees is that blend against the same surface.
export const composite = (foreground, background, alpha) =>
  foreground.map((value, index) => value * alpha + background[index] * (1 - alpha));

async function main() {
  const [tokensCss, themesCss, accessibilityCss, componentsCss, compareJs] = await Promise.all([
    read('src/styles-tokens.css'),
    read('src/styles-themes.css'),
    read('src/styles-accessibility.css'),
    read('src/styles-components.css'),
    read('src/compare.js'),
  ]);
  const errors = [];

  // The polyline's alpha, read from the call that draws it rather than assumed.
  const opacityMatch = compareJs.match(/opacity:\s*([0-9.]+),/);
  const opacity = opacityMatch ? Number(opacityMatch[1]) : null;
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    console.error(`track contrast: could not read the comparison track opacity from src/compare.js (found ${opacityMatch?.[1]})`);
    process.exit(1);
  }

  // Every declaration of a track token anywhere in the stylesheets, so a theme
  // or high-contrast override is measured too rather than assumed absent.
  const declarations = new Map();
  for (const [file, css] of [
    ['src/styles-tokens.css', tokensCss],
    ['src/styles-themes.css', themesCss],
    ['src/styles-accessibility.css', accessibilityCss],
    ['src/styles-components.css', componentsCss],
  ]) {
    for (const match of css.matchAll(/--pin-([1-4])-track:\s*([^;]+);/g)) {
      const slot = Number(match[1]);
      if (!declarations.has(slot)) declarations.set(slot, []);
      declarations.get(slot).push({ file, value: match[2].trim() });
    }
  }
  for (const slot of [1, 2, 3, 4]) {
    if (!declarations.has(slot)) errors.push(`no stylesheet declares --pin-${slot}-track`);
  }

  // The JS fallbacks are what a caller with no document gets, so they are held
  // to the same bar and have to name the same colour as the token.
  const fallbacks = new Map(
    [...compareJs.matchAll(/trackToken:\s*'--pin-([1-4])-track',\s*trackFallback:\s*'([^']+)'/g)]
      .map(match => [Number(match[1]), match[2].trim()]),
  );
  for (const slot of [1, 2, 3, 4]) {
    if (!fallbacks.has(slot)) errors.push(`src/compare.js declares no trackFallback for --pin-${slot}-track`);
  }

  const measured = [];
  for (const slot of [1, 2, 3, 4]) {
    const candidates = [
      ...(declarations.get(slot) || []),
      ...(fallbacks.has(slot) ? [{ file: 'src/compare.js', value: fallbacks.get(slot) }] : []),
    ];
    const rootDeclaration = (declarations.get(slot) || [])[0];
    if (rootDeclaration && fallbacks.has(slot) && fallbacks.get(slot).toLowerCase() !== rootDeclaration.value.toLowerCase()) {
      errors.push(
        `src/compare.js falls back to ${fallbacks.get(slot)} for slot ${slot} but ${rootDeclaration.file} declares ${rootDeclaration.value}`,
      );
    }
    for (const candidate of candidates) {
      const rgb = parseHex(candidate.value);
      if (!rgb) {
        errors.push(`${candidate.file} gives --pin-${slot}-track a value this gate cannot measure: ${candidate.value}`);
        continue;
      }
      for (const [surface, background] of Object.entries(BASEMAP_SURFACES)) {
        const backgroundRgb = parseHex(background);
        const ratio = contrastRatio(composite(rgb, backgroundRgb, opacity), backgroundRgb);
        measured.push({ slot, surface, value: candidate.value, file: candidate.file, ratio });
        if (ratio < MINIMUM_RATIO) {
          errors.push(
            `${candidate.file}: --pin-${slot}-track ${candidate.value} is ${ratio.toFixed(2)}:1 on the ${surface} fill `
            + `at ${opacity} opacity, under ${MINIMUM_RATIO}:1`,
          );
        }
      }
    }
  }

  // The whole premise is that the basemap stays light in both themes, so the
  // dark theme's tile filter is checked rather than trusted. An inversion would
  // make every figure above the wrong way round.
  const tileFilter = componentsCss.match(/html:not\(\.light-theme\)\s*#map\s*\.leaflet-tile-pane\s*\{[^}]*filter:\s*([^;]+);/)?.[1];
  if (!tileFilter) {
    errors.push('src/styles-components.css no longer filters the dark-theme tile pane, so this gate cannot tell what the basemap looks like');
  } else if (/invert\(\s*(?:[1-9]|0?\.[5-9])/.test(tileFilter)) {
    errors.push(`the dark theme now inverts the basemap (${tileFilter.trim()}), so the track colours have to be rechecked against a dark map`);
  } else {
    const brightness = Number(tileFilter.match(/brightness\(([0-9.]+)\)/)?.[1] ?? 1);
    if (brightness < 0.5) {
      errors.push(`the dark theme darkens the basemap to ${brightness}, which is no longer the light map these colours were chosen for`);
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`track contrast: ${error}`);
    process.exit(1);
  }

  const worst = measured.reduce((lowest, row) => (row.ratio < lowest.ratio ? row : lowest));
  console.log(
    `track contrast ok (${measured.length} measurements at ${opacity} opacity, worst `
    + `${worst.ratio.toFixed(2)}:1 for --pin-${worst.slot}-track on the ${worst.surface} fill)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
