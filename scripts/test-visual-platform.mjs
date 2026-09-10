import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldSkipVisualRegression, visualSkipMessage } from './run-visual-regression.mjs';

assert.equal(shouldSkipVisualRegression('win32'), false, 'Windows must run the visual regression suite');
assert.equal(shouldSkipVisualRegression('linux'), true, 'Linux must skip OS-specific visual baselines');
assert.equal(shouldSkipVisualRegression('darwin'), true, 'macOS must skip OS-specific visual baselines');
assert.match(visualSkipMessage('linux'), /visual regression skipped on linux/);
assert.match(visualSkipMessage('linux'), /Windows\/Chromium-specific/);

const visualSpec = readFileSync(resolve('tests', 'visual-regression.spec.mjs'), 'utf8');
const visualSnapshots = readdirSync(resolve('tests', 'visual-regression.spec.mjs-snapshots'));
assert.match(visualSpec, /\.webp/);
assert.match(visualSpec, /quality:\s*100/);
assert.equal(visualSnapshots.filter((name) => name.endsWith('.png')).length, 0, 'visual baselines must not remain PNGs');
// 20 since 2026-09-09, when the side-by-side comparison landed with three of
// its own: matrix-desktop-compare-split, matrix-desktop-compare-crossfade and
// matrix-mobile-compare-stacked. b0085cd4 added the baselines and left this
// count at the 17 it had been since matrix-mobile-standalone-insets, so this
// gate has been failing since that commit and the tree was right, not it.
assert.equal(visualSnapshots.filter((name) => name.endsWith('-win32.webp')).length, 20, 'visual WebP baseline count changed unexpectedly');

console.log('visual platform and baseline gates ok (Windows runs; Linux/macOS skip clearly; 20 lossless WebP baselines)');
