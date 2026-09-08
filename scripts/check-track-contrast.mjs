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

// The cascade order is declared, not guessed. src/styles.css names the layers
// and assigns each stylesheet to exactly one. Reading the directory and sorting
// by filename put styles-accessibility.css (the LAST layer) first and
// styles-tokens.css (the FIRST layer) second from last, so "the last
// declaration wins" was inverted for precisely the two sheets that decide this.
// A `:root` override in the themes or accessibility layer paints in every
// browser and was invisible here.
export function cascadeOrder(entryCss) {
  const declared = /@layer\s+([^;{]+);/.exec(entryCss);
  const order = declared ? declared[1].split(',').map(name => name.trim()) : [];
  return [...entryCss.matchAll(/@import\s+url\(\s*['"]\.\/([^'"]+)['"]\s*\)\s*layer\(\s*([\w-]+)\s*\)/g)]
    .map(match => ({ file: `src/${match[1]}`, layer: match[2], rank: order.indexOf(match[2]) }))
    .sort((a, b) => a.rank - b.rank);
}

// The class list on <html> in each mode a reader can be in. High contrast sits
// over the default theme, so it carries no light-theme class.
export const MODE_CLASSES = Object.freeze({
  dark: [],
  light: ['light-theme'],
  'high-contrast': ['high-contrast'],
});

// Split a selector list on the commas that separate selectors, not on the ones
// inside :not(), :is() or :where().
export function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of String(selector)) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += character;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

// Does this selector apply to a reader whose <html> carries these classes?
// Only the root compound decides, because everything that themes this app
// hangs off html or :root. Evaluating the selector beats classifying it by
// substring: `html:not( .light-theme )` reads as light to a substring test,
// `html:not(.light-theme):not(.high-contrast)` reads as high contrast, and
// `html.light-theme, html:not(.light-theme)` reads as one mode when it covers
// both. Each of those spellings paints somewhere the old test never looked.
export function selectorApplies(selector, classes) {
  const present = new Set(classes);
  return splitSelectorList(selector).some((part) => {
    let depth = 0;
    let root = '';
    for (const character of part) {
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (depth === 0 && /[\s>+~]/.test(character)) break;
      root += character;
    }
    const forbidden = new Set();
    for (const negation of root.matchAll(/:not\(([^()]*)\)/g)) {
      for (const found of negation[1].matchAll(/\.([\w-]+)/g)) forbidden.add(found[1]);
    }
    const required = new Set();
    for (const found of root.replace(/:not\([^()]*\)/g, '').matchAll(/\.([\w-]+)/g)) required.add(found[1]);
    if ([...required].some(name => !present.has(name))) return false;
    return ![...forbidden].some(name => present.has(name));
  });
}

// A conditional at-rule this gate does not model is a rule that may or may not
// paint, and measuring it either way is a guess. Report it rather than guess.
export function enclosingConditions(css, index) {
  const conditions = [];
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const character = css[i];
    if (character === '}') depth += 1;
    else if (character === '{') {
      if (depth === 0) {
        let start = 0;
        for (const boundary of ['}', '{', ';']) {
          const found = css.lastIndexOf(boundary, i - 1);
          if (found > start) start = found + 1;
        }
        const prelude = css.slice(start, i).trim().replace(/\s+/g, ' ');
        if (/^@(media|supports|container)\b/.test(prelude)) conditions.push(prelude);
      } else depth -= 1;
    }
  }
  return conditions;
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

const EXEMPTION_MARKER = 'data-hm-exemption="map-geometry-non-text-contrast"';

async function main() {
  const entry = await readFile(path.join(styleDir, 'styles.css'), 'utf8');
  const order = cascadeOrder(entry);
  const errors = [];

  // A stylesheet outside the main cascade is fine on its own: globe-host.css
  // is loaded by the sandboxed globe.html and never reaches this document. One
  // that declares a track colour or filters the tile pane is not fine, because
  // its position in the cascade decides the answer and nothing here knows it.
  const imported = new Set(order.map(item => item.file));
  for (const name of (await readdir(styleDir)).filter(file => file.endsWith('.css') && file !== 'styles.css').sort()) {
    const file = `src/${name}`;
    if (imported.has(file)) continue;
    const css = stripCssComments(await readFile(path.join(styleDir, name), 'utf8'));
    const declares = /--pin-[1-4]-track:/.test(css) || tilePaneRules(css).length > 0;
    if (declares) {
      errors.push(`${file} declares a track colour or a tile-pane rule but src/styles.css does not import it, so its place in the cascade is unknown`);
    }
  }
  for (const item of order) {
    if (item.rank < 0) errors.push(`${item.file} is imported into layer ${item.layer}, which src/styles.css never declares`);
  }

  const stylesheets = [];
  for (const item of order) {
    const raw = await readFile(path.join(styleDir, path.basename(item.file)), 'utf8');
    stylesheets.push({ ...item, css: stripCssComments(raw) });
  }
  const compareJs = await readFile(path.join(root, 'src/compare.js'), 'utf8');

  // The polyline's alpha, read from the call that draws it rather than assumed.
  const opacityMatch = compareJs.match(/\bopacity:\s*([0-9.]+),/);
  const opacity = opacityMatch ? Number(opacityMatch[1]) : null;
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    console.error(`track contrast: could not read the comparison track opacity from src/compare.js (found ${opacityMatch?.[1]})`);
    process.exit(1);
  }

  // Every declaration of a track token, in cascade order, with the selector it
  // was written under. Reading a subset was the first bug here; reading the
  // value without its selector was the second; ordering by filename rather than
  // by layer was the third, and it inverted the two sheets that matter.
  const declarations = new Map();
  for (const [rank, sheet] of stylesheets.entries()) {
    for (const match of sheet.css.matchAll(/--pin-([1-4])-track:\s*([^;]+);/g)) {
      const slot = Number(match[1]);
      if (!declarations.has(slot)) declarations.set(slot, []);
      declarations.get(slot).push({
        file: sheet.file,
        value: match[2].trim(),
        selector: declaringSelector(sheet.css, match.index),
        conditions: enclosingConditions(sheet.css, match.index),
        rank,
        at: match.index,
      });
    }
  }
  for (const slot of [1, 2, 3, 4]) {
    if (!declarations.has(slot)) errors.push(`no stylesheet declares --pin-${slot}-track`);
    for (const entry of declarations.get(slot) || []) {
      if (entry.conditions.length) {
        errors.push(
          `${entry.file} declares --pin-${slot}-track inside ${entry.conditions.join(' inside ')}, a condition this `
          + 'gate cannot evaluate, so whether a reader sees this colour is unknown',
        );
      }
    }
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
  const FILTER_DECLARATION_RE = /(?:^|[;{\s])filter\s*:\s*([^;}]+)/g;
  const paneFilters = [];
  for (const [rank, sheet] of stylesheets.entries()) {
    for (const rule of tilePaneRules(sheet.css)) {
      // Nested blocks used to be deleted wholesale before the declarations were
      // read, which threw away a `filter` inside a nested `@media` that
      // Chromium applies. A nested block is part of the rule, so its
      // declarations count; only the selector or condition line is dropped.
      const flattened = rule.body.replace(/(^|[{};])\s*[@&][^{};]*\{/g, '$1 ').replace(/\}/g, ' ');
      const found = [...flattened.matchAll(FILTER_DECLARATION_RE)];
      if (!found.length) {
        // A tile-pane rule with no filter at all is ordinary: several set only
        // a transition or a will-change. An escaped property name is not. A
        // hex-escaped spelling is one Chromium honours and this gate cannot
        // read, and a rule using it dropped the reported rule count from three
        // to two in silence.
        if (/\\[0-9a-fA-F]/.test(rule.body)) {
          errors.push(
            `${rule.selector} spells a property with a CSS escape, which this gate cannot read; `
            + 'write the property name out so the filter it may set is measurable',
          );
        }
        continue;
      }
      const at = sheet.css.indexOf(rule.body);
      const conditions = at === -1 ? [] : enclosingConditions(sheet.css, at);
      if (conditions.length) {
        errors.push(
          `${sheet.file} filters the tile pane inside ${conditions.join(' inside ')}, a condition this gate cannot `
          + 'evaluate, so the basemap a reader sees is unknown',
        );
        continue;
      }
      paneFilters.push({
        file: sheet.file,
        selector: rule.selector,
        filter: found[found.length - 1][1].replace(/!important\s*$/i, '').trim().toLowerCase(),
        rank,
        at,
      });
    }
  }
  if (!paneFilters.length) {
    errors.push('no rule filters the tile pane any more, so this gate cannot tell what the basemap looks like');
  }

  // Resolve each mode to the one basemap and the four colours a reader in that
  // mode actually gets: every entry whose selector applies, latest layer wins,
  // then latest within the layer. Pairing them is the point. Measuring every
  // colour against every basemap counted combinations nobody renders, and it
  // would reject a high-contrast override for failing on the dark theme's
  // basemap, a surface that override never appears on.
  const pick = (list, mode) => {
    const applies = list
      .filter(entry => selectorApplies(entry.selector, MODE_CLASSES[mode]))
      .sort((a, b) => (a.rank - b.rank) || (a.at - b.at));
    return applies.length ? applies[applies.length - 1] : null;
  };

  const modes = [];
  for (const mode of Object.keys(MODE_CLASSES)) {
    const pane = pick(paneFilters, mode);
    if (!pane) {
      errors.push(`no tile-pane rule applies in ${mode}, so this gate cannot tell what that reader's basemap looks like`);
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
      const declaration = pick(declarations.get(slot) || [], mode);
      if (declaration) tokens.set(slot, declaration);
      else errors.push(`no declaration of --pin-${slot}-track applies in ${mode}`);
    }
    modes.push({ mode, pane, surfaces, tokens });
  }

  // src/compare.js hard-codes a fallback for each token, used when the custom
  // property is missing. It has to agree with what a default reader resolves.
  for (const slot of [1, 2, 3, 4]) {
    const base = pick(declarations.get(slot) || [], 'dark');
    if (base && fallbacks.has(slot) && fallbacks.get(slot).toLowerCase() !== base.value.toLowerCase()) {
      errors.push(
        `src/compare.js falls back to ${fallbacks.get(slot)} for slot ${slot} but ${base.file} resolves to ${base.value}`,
      );
    }
  }

  const measured = [];
  for (const entry of modes) {
    for (const [slot, declaration] of entry.tokens) {
      const rgb = parseHex(declaration.value);
      if (!rgb) {
        errors.push(`${declaration.file} gives --pin-${slot}-track a value this gate cannot measure: ${declaration.value}`);
        continue;
      }
      for (const [surface, background] of Object.entries(entry.surfaces)) {
        const ratio = contrastRatio(composite(rgb, background, opacity), background);
        measured.push({ slot, mode: entry.mode, surface, value: declaration.value, file: declaration.file, ratio });
        if (ratio < MINIMUM_RATIO) {
          errors.push(
            `${declaration.file}: --pin-${slot}-track ${declaration.value} is ${ratio.toFixed(2)}:1 on the ${surface} fill of `
            + `the basemap a ${entry.mode} reader sees (${entry.pane.selector}), at ${opacity} opacity, under ${MINIMUM_RATIO}:1`,
          );
        }
      }
    }
  }

  // High contrast is a mode a reader turns on to get more separation, and on
  // the map it gets none: its tile-pane rule takes the basemap back to
  // unfiltered, which is what the light theme does, and there is no
  // high-contrast value for any of the four track colours. That is a defensible
  // position, and the VPAT states it with the measurements behind it. It is not
  // a defensible silence, so this fails if the claim goes missing while the
  // situation that needs it stays.
  const signature = entry => [
    entry.pane.filter,
    ...[1, 2, 3, 4].map(slot => entry.tokens.get(slot)?.value ?? 'unset'),
  ].join('|');
  const highContrast = modes.find(entry => entry.mode === 'high-contrast');
  const twin = highContrast
    && modes.find(entry => entry.mode !== 'high-contrast' && signature(entry) === signature(highContrast));
  if (highContrast) {
    const vpat = await readFile(path.join(root, 'docs/VPAT.html'), 'utf8').catch(() => '');
    const stated = vpat.includes(EXEMPTION_MARKER);
    if (twin && !stated) {
      errors.push(
        `high contrast renders the same basemap and the same track colours as the ${twin.mode} theme, and `
        + `docs/VPAT.html does not carry ${EXEMPTION_MARKER}. Either give high contrast its own basemap or its own `
        + 'track colours, or state the exemption in the VPAT so the mode stops claiming coverage it does not have',
      );
    }
    // The mirror. An exemption left standing after high contrast grew its own
    // basemap is a claim about the product that is no longer true, and a
    // selector that quietly stops matching would otherwise retire the check
    // without anyone deciding to.
    if (!twin && stated) {
      errors.push(
        'high contrast now renders its own basemap or its own track colours, so the exemption in docs/VPAT.html is '
        + `stale; remove ${EXEMPTION_MARKER} and the paragraph explaining it`,
      );
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`track contrast: ${error}`);
    process.exit(1);
  }

  const worst = measured.reduce((lowest, row) => (row.ratio < lowest.ratio ? row : lowest));
  const perMode = modes.map((entry) => {
    const rows = measured.filter(row => row.mode === entry.mode);
    const low = rows.reduce((lowest, row) => (row.ratio < lowest.ratio ? row : lowest));
    return `${entry.mode} ${low.ratio.toFixed(2)}:1`;
  });
  console.log(
    `track contrast ok (${measured.length} measurements at ${opacity} opacity across ${modes.length} modes from `
    + `${paneFilters.length} tile-pane rules in ${stylesheets.length} layered stylesheets; worst per mode `
    + `${perMode.join(', ')}; worst overall ${worst.ratio.toFixed(2)}:1 for --pin-${worst.slot}-track on the `
    + `${worst.surface} fill in ${worst.mode}${twin ? `; high contrast matches the ${twin.mode} theme and is exempted in the VPAT` : ''})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
