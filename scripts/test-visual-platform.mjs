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
assert.equal(visualSnapshots.filter((name) => name.endsWith('-win32.webp')).length, 16, 'visual WebP baseline count changed unexpectedly');

console.log('visual platform and baseline gates ok (Windows runs; Linux/macOS skip clearly; 16 lossless WebP baselines)');
