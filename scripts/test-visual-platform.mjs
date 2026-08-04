import assert from 'node:assert/strict';
import { shouldSkipVisualRegression, visualSkipMessage } from './run-visual-regression.mjs';

assert.equal(shouldSkipVisualRegression('win32'), false, 'Windows must run the visual regression suite');
assert.equal(shouldSkipVisualRegression('linux'), true, 'Linux must skip OS-specific visual baselines');
assert.equal(shouldSkipVisualRegression('darwin'), true, 'macOS must skip OS-specific visual baselines');
assert.match(visualSkipMessage('linux'), /visual regression skipped on linux/);
assert.match(visualSkipMessage('linux'), /Windows\/Chromium-specific/);

console.log('visual platform gate ok (Windows runs; Linux/macOS skip clearly)');
