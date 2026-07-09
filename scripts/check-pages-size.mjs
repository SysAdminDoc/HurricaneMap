// GitHub Pages hard-caps published sites at 1 GB. The radar archive alone is
// ~507 MB, so a careless scrape can brick deployment silently. Fail the build
// before that happens; the escape hatch is offloading radar PNGs behind the
// Cloudflare worker (see cloudflare/ + wrangler.toml).
import { execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT_BYTES = 900 * 1024 * 1024; // 90% of the 1 GB GitHub Pages cap

// GH Pages publishes the git tree, so tracked files are exactly the deployable set.
const listing = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const files = listing.toString('utf8').split('\0').filter(Boolean);

let total = 0;
let radarTotal = 0;
await Promise.all(files.map(async file => {
  try {
    const info = await stat(path.join(root, file));
    total += info.size;
    if (file.startsWith('data/radar/')) radarTotal += info.size;
  } catch {
    // Deleted-but-staged entries are not deployable; skip.
  }
}));

const mb = bytes => (bytes / (1024 * 1024)).toFixed(1);
if (total > LIMIT_BYTES) {
  console.error(`pages size check FAILED: tracked tree is ${mb(total)} MB (radar ${mb(radarTotal)} MB), over the ${mb(LIMIT_BYTES)} MB guard below GitHub Pages' 1 GB cap.`);
  console.error('Prune the radar archive (scripts/scrape_radar.py flags) or offload frames behind the Cloudflare worker before publishing.');
  process.exit(1);
}
console.log(`pages size ok (${mb(total)} MB tracked, radar ${mb(radarTotal)} MB, guard ${mb(LIMIT_BYTES)} MB)`);
