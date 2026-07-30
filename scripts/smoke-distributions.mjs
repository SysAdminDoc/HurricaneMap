import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stageDistribution } from './build-distribution.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', '.smoke-core');

try {
  await stageDistribution('core', output, { allowDirty: true });
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/smoke-offline-service-worker.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HURRICANEMAP_ROOT: output,
      HURRICANEMAP_EXPECT_PROFILE: 'core',
    },
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  await rm(output, { recursive: true, force: true });
}
