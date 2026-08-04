import { readFile } from 'node:fs/promises';

const layers = ['tokens', 'reset', 'base', 'shell', 'components', 'utilities', 'themes', 'accessibility'];
const entry = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const expectedOrder = `@layer ${layers.join(', ')};`;
const COMPONENTS_IMPORTANT_CAP = 0;
const errors = [];
if (!entry.startsWith(expectedOrder)) errors.push('styles.css does not declare the approved cascade order');

const seenRules = new Map();
let ruleCount = 0;
function topLevelBlocks(css) {
  const result = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];
    if (comment) {
      if (char === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      result.push(css.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  return result.filter(Boolean);
}

for (const layer of layers) {
  const importRule = `@import url('./styles-${layer}.css') layer(${layer});`;
  if (!entry.includes(importRule)) errors.push(`styles.css is missing ${layer} layer import`);
  const css = await readFile(new URL(`../src/styles-${layer}.css`, import.meta.url), 'utf8');
  const importantCount = (css.match(/!important\b/g) || []).length;
  if (layer === 'components' && importantCount > COMPONENTS_IMPORTANT_CAP) {
    errors.push(`components layer has ${importantCount} !important declarations; cap is ${COMPONENTS_IMPORTANT_CAP}`);
  }
  const rules = topLevelBlocks(css);
  if (!css.trim()) errors.push(`${layer} layer is empty`);
  ruleCount += rules.length;
  for (const rule of rules) {
    const normalized = rule.replace(/\s+/g, ' ').trim();
    if (seenRules.has(normalized)) {
      errors.push(`exact duplicate rule remains in ${seenRules.get(normalized)} and ${layer}`);
    } else {
      seenRules.set(normalized, layer);
    }
  }
}
if (ruleCount < 1200) errors.push(`layered stylesheet exposes only ${ruleCount} top-level rules`);
if (/[#.][\w-]+\s+[>#.+~]*\s*[#.][\w-]+\s+[>#.+~]*\s*[#.][\w-]+\s+[>#.+~]*\s*[#.][\w-]+\s+[>#.+~]*\s*[#.][\w-]+/.test(entry)) {
  errors.push('styles.css entrypoint introduces a high-specificity selector');
}

const linkTags = [...index.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]);
function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
}
const preloadTags = linkTags.filter(tag => attribute(tag, 'rel').toLowerCase() === 'preload');
const stylePreloadHrefs = preloadTags
  .filter(tag => attribute(tag, 'as').toLowerCase() === 'style')
  .map(tag => attribute(tag, 'href'));
const expectedStylePreloads = layers.map(layer => `src/styles-${layer}.css`);
const missingStylePreloads = expectedStylePreloads.filter(href => !stylePreloadHrefs.includes(href));
if (missingStylePreloads.length) errors.push(`index.html is missing parallel style preloads: ${missingStylePreloads.join(', ')}`);
const stylePreloadOrder = expectedStylePreloads.map(href => stylePreloadHrefs.indexOf(href));
if (stylePreloadOrder.some(index => index < 0) || stylePreloadOrder.some((index, position) => position > 0 && index < stylePreloadOrder[position - 1])) {
  errors.push('index.html style preloads do not preserve the declared @layer order');
}
for (const font of ['fonts/inter-latin.woff2', 'fonts/jetbrains-mono-latin.woff2']) {
  const fontTag = preloadTags.find(tag => attribute(tag, 'as').toLowerCase() === 'font' && attribute(tag, 'href') === font);
  if (!fontTag || attribute(fontTag, 'type').toLowerCase() !== 'font/woff2' || !/\bcrossorigin(?:\s|=|>|$)/i.test(fontTag)) {
    errors.push(`index.html must preload ${font} as a reusable WOFF2 font`);
  }
}

if (errors.length) {
  errors.forEach(error => console.error(`style layers: ${error}`));
  process.exit(1);
}
console.log(`style layers ok (${layers.length} ordered layers, ${ruleCount} simple rules, no exact duplicates)`);
