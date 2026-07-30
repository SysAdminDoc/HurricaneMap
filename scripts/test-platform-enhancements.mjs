import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { computeTooltipFallback } from '../src/tooltips.js';

const layerNames = ['tokens', 'reset', 'base', 'shell', 'components', 'utilities', 'themes', 'accessibility'];
const [html, ...styleFiles] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ...layerNames.map(layer => readFile(new URL(`../src/styles-${layer}.css`, import.meta.url), 'utf8')),
]);
const css = styleFiles.join('\n');

assert(/id="header-tooltip"[^>]+popover="hint"/.test(html), 'header tooltip must use the non-disruptive hint popover state');
assert(css.includes('.settings-menu:not(:popover-open) { display: none; }'), 'closed settings popovers must never override the UA hidden state');
assert(css.includes('@supports (anchor-name: --hm-anchor) and (top: anchor(bottom))'), 'anchor positioning must remain progressive');
assert(css.includes('.header-tooltip[data-fallback-open] { display: block; }'), 'non-popover tooltip fallback is missing');
assert(css.includes('position-anchor: --settings-trigger'), 'settings flyout is not associated with its trigger');

assert.deepEqual(
  computeTooltipFallback({ left: 100, right: 144, top: 20, bottom: 64 }, { width: 120, height: 32 }, { width: 500, height: 300 }),
  { left: 62, top: 72 },
);
assert.deepEqual(
  computeTooltipFallback({ left: 470, right: 500, top: 250, bottom: 294 }, { width: 160, height: 40 }, { width: 500, height: 300 }),
  { left: 332, top: 202 },
  'fallback tooltip should clamp to the right edge and flip above an overflowing anchor',
);

console.log('anchor positioning and hint popover enhancement ok');
