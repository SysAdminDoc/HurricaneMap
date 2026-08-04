import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VISUAL_SPEC = 'tests/visual-regression.spec.mjs';

export function shouldSkipVisualRegression(platform = process.platform) {
  return platform !== 'win32';
}

export function visualSkipMessage(platform = process.platform) {
  return `visual regression skipped on ${platform}: checked-in baselines are Windows/Chromium-specific; run npm run test:visual on Windows (see README.md).`;
}

function run() {
  if (shouldSkipVisualRegression()) {
    console.log(visualSkipMessage());
    return 0;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  const result = spawnSync(process.execPath, [playwrightCli, 'test', VISUAL_SPEC, '--workers=1', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`visual regression could not start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = run();
}
