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
const SINK_RE = /\.(?:bindPopup|bindTooltip|setContent)\(\s*`([\s\S]*?)`/g;
const INTERPOLATION_RE = /\$\{([^{}]*)\}/g;
const SAFE_RE = /escapeHtml|escapeText|\bt\(/;

function findOffenders(text, file) {
  const offenders = [];
  for (const sink of text.matchAll(SINK_RE)) {
    const template = sink[1];
    for (const interpolation of template.matchAll(INTERPOLATION_RE)) {
      if (SAFE_RE.test(interpolation[1])) continue;
      const offset = (sink.index || 0) + sink[0].indexOf(template) + (interpolation.index || 0);
      const line = text.slice(0, offset).split('\n').length;
      offenders.push(`${file}:${line}: ${interpolation[0].trim().slice(0, 120)}`);
    }
  }
  return offenders;
}

// Regression fixtures: multiline templates and a nearby safe interpolation
// must not hide a separate unsafe value.
const multilineFixture = ['marker.bindPopup(`', '  ${dangerous}', '`)'].join('\n');
const mixedFixture = "marker.bindTooltip(`${t('safe')} ${dangerous}`)";
if (findOffenders(multilineFixture, 'fixture.js').length !== 1 ||
    findOffenders(mixedFixture, 'fixture.js').length !== 1) {
  throw new Error('popup sink guard regression fixtures failed');
}

const offenders = [];
for (const file of await readdir(srcDir)) {
  if (!file.endsWith('.js')) continue;
  const text = await readFile(path.join(srcDir, file), 'utf8');
  offenders.push(...findOffenders(text, `src/${file}`));
}

if (offenders.length) {
  console.error('Unescaped template interpolation into Leaflet HTML sinks:');
  for (const offender of offenders) console.error(`- ${offender}`);
  console.error('Wrap the interpolated content in escapeHtml()/escapeText() at the sink.');
  process.exit(1);
}
console.log('popup sinks ok (no unescaped template interpolation)');
