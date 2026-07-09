// Leaflet renders bindPopup/bindTooltip/setContent strings as raw HTML
// (disputed CVE-2025-69993, no upstream patch planned on 1.9.x). Tripwire:
// any template literal interpolated directly into one of those sinks must
// visibly escape on the same statement (escapeHtml/escapeText) or resolve
// through the i18n table (t(...)). Variables passed to sinks can't be judged
// statically — escape at the sink and this check stays quiet.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SINK_RE = /\.(?:bindPopup|bindTooltip|setContent)\(\s*`[^`]*\$\{/g;
const SAFE_RE = /escapeHtml|escapeText|\bt\(/;

const offenders = [];
for (const file of await readdir(srcDir)) {
  if (!file.endsWith('.js')) continue;
  const text = await readFile(path.join(srcDir, file), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    SINK_RE.lastIndex = 0;
    if (SINK_RE.test(line) && !SAFE_RE.test(line)) {
      offenders.push(`src/${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
}

if (offenders.length) {
  console.error('Unescaped template interpolation into Leaflet HTML sinks:');
  for (const offender of offenders) console.error(`- ${offender}`);
  console.error('Wrap the interpolated content in escapeHtml()/escapeText() at the sink.');
  process.exit(1);
}
console.log('popup sinks ok (no unescaped template interpolation)');
