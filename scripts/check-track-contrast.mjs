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

// CSS angles come in four units and hue-rotate() accepts all of them. Reading
// `100grad` or `0.25turn` as degrees is not an approximation, it is a different
// rotation: those two and `90deg` are the same angle, and treating them as 100
// and 0.25 degrees gave three different colours. Anything unrecognised throws,
// which is how the rest of this function already behaves.
function degreesFromAngle(raw, number) {
  const text = String(raw).trim().toLowerCase();
  if (text.endsWith('grad')) return (number * 360) / 400;
  if (text.endsWith('turn')) return number * 360;
  if (text.endsWith('rad')) return (number * 180) / Math.PI;
  if (text.endsWith('deg')) return number;
  if (/^[+-]?[\d.]+(e[+-]?\d+)?$/.test(text)) return number;
  throw new Error(`hue-rotate() angle unit this gate cannot convert: "${raw}"`);
}

export function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// Every rule whose selector names the tile pane, with its full block. Braces are
// counted, so a nested block inside the rule stays part of it instead of ending
// it early.
export function tilePaneRules(css) {
  const rules = [];
  const target = '.leaflet-tile-pane';
  let from = 0;
  while (true) {
    const hit = css.indexOf(target, from);
    if (hit === -1) break;
    from = hit + target.length;
    const open = css.indexOf('{', hit);
    if (open === -1) break;
    // The selector runs back to the end of whatever came before it.
    let selectorStart = 0;
    for (const boundary of ['}', '{', ';']) {
      const found = css.lastIndexOf(boundary, hit);
      if (found > selectorStart) selectorStart = found + 1;
    }
    const selector = css.slice(selectorStart, open).trim().replace(/\s+/g, ' ');
    if (!selector.includes(target)) continue;
    let depth = 0;
    let close = open;
    for (; close < css.length; close += 1) {
      if (css[close] === '{') depth += 1;
      else if (css[close] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    rules.push({ selector, body: css.slice(open + 1, close) });
    from = close;
  }
  return rules;
}

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
      case 'hue-rotate': out = applyMatrix(out, hueRotateMatrix(degreesFromAngle(raw, number))); break;
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

// Regression fixtures for the angle handling. 90deg, 100grad and 0.25turn are
// the same rotation, and reading the last two as degrees silently produced two
// different colours, which is worse than failing: the gate would have reported
// a contrast figure for a basemap nobody sees. Anything it cannot convert has
// to throw, the way an unknown filter function already does.
{
  const probe = parseHex('9ecfde');
  const asDegrees = String(applyCssFilter(probe, 'hue-rotate(90deg)'));
  for (const spelling of ['hue-rotate(100grad)', 'hue-rotate(0.25turn)', 'hue-rotate(1.5708rad)']) {
    if (String(applyCssFilter(probe, spelling)) !== asDegrees) {
      throw new Error(`angle-unit regression: ${spelling} does not match hue-rotate(90deg)`);
    }
  }
  let threw = false;
  try { applyCssFilter(probe, 'hue-rotate(90quux)'); } catch { threw = true; }
  if (!threw) throw new Error('angle-unit regression: an unconvertible unit must throw rather than be read as degrees');
}

// Which theme a selector belongs to. `html:not(.light-theme)` contains the
// text `.light-theme`, so the negation has to be tested first or every dark
// rule reads as a light one.
export function themeScope(selector) {
  const text = String(selector).toLowerCase();
  if (text.includes('.high-contrast')) return 'high-contrast';
  if (text.includes(':not(.light-theme)')) return 'dark';
  if (text.includes('.light-theme')) return 'light';
  return 'base';
}

// The selector of the rule a declaration sits in, found by walking back to the
// brace that opens its block. A declaration inside `@layer tokens { :root { } }`
// belongs to `:root`, not to the layer.
export function declaringSelector(css, index) {
  let depth = 0;
  let open = -1;
  for (let i = index - 1; i >= 0; i -= 1) {
    const character = css[i];
    if (character === '}') depth += 1;
    else if (character === '{') {
      if (depth === 0) { open = i; break; }
      depth -= 1;
    }
  }
  if (open === -1) return '';
  let start = 0;
  for (const boundary of ['}', '{', ';']) {
    const found = css.lastIndexOf(boundary, open - 1);
    if (found > start) start = found + 1;
  }
  return css.slice(start, open).trim().replace(/\s+/g, ' ');
}

// The three modes a reader can be in. High contrast sits last because the
// accessibility layer is last, so its tile-pane rule beats the dark theme's at
// equal specificity and a high-contrast reader gets the unfiltered basemap in
// either theme.
const SCOPES = ['dark', 'light', 'high-contrast'];
const EXEMPTION_MARKER = 'data-hm-exemption="map-geometry-non-text-contrast"';

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

  // Every declaration of a track token in every stylesheet, with the selector
  // it was written under. Reading a subset was its own bug: the shell and
  // utilities layers are both later than tokens, so an override in either would
  // have been invisible. Reading the value without its selector was the next
  // one: a high-contrast override measured against the dark theme's basemap is
  // a colour nobody sees on a surface nobody renders.
  const declarations = new Map();
  for (const [file, raw] of stylesheets) {
    const css = stripCssComments(raw);
    for (const match of css.matchAll(/--pin-([1-4])-track:\s*([^;]+);/g)) {
      const slot = Number(match[1]);
      const selector = declaringSelector(css, match.index);
      if (!declarations.has(slot)) declarations.set(slot, []);
      declarations.get(slot).push({ file, value: match[2].trim(), selector, scope: themeScope(selector) });
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

  // What the basemap actually looks like. The rules are found rather than
  // named: this used to read three hard-coded selectors, so a fourth rule
  // repainting the tile pane (a palette mode, say) would have been a basemap
  // nothing measured.
  //
  // Three things this has to get right, each of which it got wrong first.
  // Comments are stripped before anything else, or a comment that merely
  // mentions the tile pane is read as the selector of the rule after it. The
  // block is found by counting braces rather than stopping at the first `}`,
  // so a nested `&:hover { }` cannot shadow the declaration under it. And the
  // LAST `filter` in the block wins, the way a browser resolves it, with
  // `backdrop-filter` excluded by a boundary because these stylesheets use it
  // twenty times and matching it means measuring a surface nobody renders.
  const allCss = stripCssComments([...stylesheets.values()].join('\n'));
  const FILTER_DECLARATION_RE = /(?:^|[;{\s])filter\s*:\s*([^;}]+)/g;
  const paneFilters = [];
  for (const rule of tilePaneRules(allCss)) {
    // Nested blocks used to be deleted wholesale before the declarations were
    // read, which threw away a `filter` inside a nested `@media` that Chromium
    // applies. A nested block is part of the rule, so its declarations count;
    // only the selector or condition line is dropped.
    const flattened = rule.body.replace(/(^|[{};])\s*[@&][^{};]*\{/g, '$1 ').replace(/\}/g, ' ');
    const found = [...flattened.matchAll(FILTER_DECLARATION_RE)];
    if (!found.length) {
      // A tile-pane rule with no filter at all is ordinary: several set only a
      // transition or a will-change. An escaped property name is not. A
      // hex-escaped spelling is one Chromium honours and this gate cannot read,
      // and a rule using it dropped the reported rule count from three to two
      // in silence.
      if (/\\[0-9a-fA-F]/.test(rule.body)) {
        errors.push(
          `${rule.selector} spells a property with a CSS escape, which this gate cannot read; `
          + 'write the property name out so the filter it may set is measurable',
        );
      }
      continue;
    }
    const filter = found[found.length - 1][1].replace(/!important\s*$/i, '').trim().toLowerCase();
    paneFilters.push({ selector: rule.selector, filter, scope: themeScope(rule.selector) });
  }
  if (!paneFilters.length) {
    errors.push('no rule filters the tile pane any more, so this gate cannot tell what the basemap looks like');
  }

  // Resolve each mode to the one basemap and the four tokens a reader in that
  // mode actually gets. Pairing them is the point: measuring every token
  // against every basemap counted combinations nobody renders, and it would
  // reject a high-contrast override for failing on the dark theme's basemap,
  // which is a surface that override never appears on.
  const pick = (list, scope) => {
    const scoped = list.filter(entry => entry.scope === scope);
    const base = list.filter(entry => entry.scope === 'base');
    const chosen = scoped.length ? scoped : base;
    return chosen.length ? chosen[chosen.length - 1] : null;
  };

  const modes = [];
  for (const scope of SCOPES) {
    const pane = pick(paneFilters, scope);
    if (!pane) {
      errors.push(`no tile-pane rule applies in ${scope}, so this gate cannot tell what that reader's basemap looks like`);
      continue;
    }
    const surfaces = {};
    let measurable = true;
    try {
      for (const [surface, hex] of Object.entries(BASEMAP_SURFACES)) {
        surfaces[surface] = applyCssFilter(parseHex(hex), pane.filter);
      }
    } catch (error) {
      errors.push(`the tile filter on ${pane.selector} cannot be measured: ${error.message}`);
      measurable = false;
    }
    if (!measurable) continue;
    const tokens = new Map();
    for (const slot of [1, 2, 3, 4]) {
      const declaration = pick(declarations.get(slot) || [], scope);
      if (declaration) tokens.set(slot, declaration);
    }
    modes.push({ scope, pane, surfaces, tokens });
  }

  // src/compare.js hard-codes a fallback for each token, used when the custom
  // property is missing. It has to agree with the default declaration.
  for (const slot of [1, 2, 3, 4]) {
    const base = pick(declarations.get(slot) || [], 'dark');
    if (base && fallbacks.has(slot) && fallbacks.get(slot).toLowerCase() !== base.value.toLowerCase()) {
      errors.push(
        `src/compare.js falls back to ${fallbacks.get(slot)} for slot ${slot} but ${base.file} declares ${base.value}`,
      );
    }
  }

  const measured = [];
  for (const mode of modes) {
    for (const [slot, declaration] of mode.tokens) {
      const rgb = parseHex(declaration.value);
      if (!rgb) {
        errors.push(`${declaration.file} gives --pin-${slot}-track a value this gate cannot measure: ${declaration.value}`);
        continue;
      }
      for (const [surface, background] of Object.entries(mode.surfaces)) {
        const ratio = contrastRatio(composite(rgb, background, opacity), background);
        measured.push({ slot, scope: mode.scope, surface, value: declaration.value, file: declaration.file, ratio });
        if (ratio < MINIMUM_RATIO) {
          errors.push(
            `${declaration.file}: --pin-${slot}-track ${declaration.value} is ${ratio.toFixed(2)}:1 on the ${surface} fill of `
            + `the basemap a ${mode.scope} reader sees (${mode.pane.selector}), at ${opacity} opacity, under ${MINIMUM_RATIO}:1`,
          );
        }
      }
    }
  }

  // High contrast is a mode a reader turns on to get more separation, and on
  // the map it gets none: its tile-pane rule takes the basemap back to
  // unfiltered, which is what the light theme does, and there is no
  // high-contrast value for any of the four track tokens. That is a defensible
  // position, and the VPAT states it with the measurements behind it. It is not
  // a defensible silence, so this fails if the claim goes missing while the
  // situation that needs it stays.
  const signature = mode => [
    mode.pane.filter,
    ...[1, 2, 3, 4].map(slot => mode.tokens.get(slot)?.value ?? 'unset'),
  ].join('|');
  const highContrast = modes.find(mode => mode.scope === 'high-contrast');
  const twin = highContrast
    && modes.find(mode => mode.scope !== 'high-contrast' && signature(mode) === signature(highContrast));
  if (twin) {
    const vpat = await readFile(path.join(root, 'docs/VPAT.html'), 'utf8').catch(() => '');
    if (!vpat.includes(EXEMPTION_MARKER)) {
      errors.push(
        `high contrast renders the same basemap and the same track colours as the ${twin.scope} theme, and `
        + `docs/VPAT.html does not carry ${EXEMPTION_MARKER}. Either give high contrast its own basemap or its own `
        + 'track tokens, or state the exemption in the VPAT so the mode stops claiming coverage it does not have',
      );
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`track contrast: ${error}`);
    process.exit(1);
  }

  const worst = measured.reduce((lowest, row) => (row.ratio < lowest.ratio ? row : lowest));
  const perMode = modes.map(mode => {
    const rows = measured.filter(row => row.scope === mode.scope);
    const low = rows.reduce((lowest, row) => (row.ratio < lowest.ratio ? row : lowest));
    return `${mode.scope} ${low.ratio.toFixed(2)}:1`;
  });
  console.log(
    `track contrast ok (${measured.length} measurements at ${opacity} opacity across ${modes.length} modes from `
    + `${paneFilters.length} tile-pane rules; worst per mode ${perMode.join(', ')}; worst overall `
    + `${worst.ratio.toFixed(2)}:1 for --pin-${worst.slot}-track on the ${worst.surface} fill in ${worst.scope}`
    + `${twin ? `; high contrast matches the ${twin.scope} theme and is exempted in the VPAT` : ''})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
