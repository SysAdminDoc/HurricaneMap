// Leaflet renders bindPopup/bindTooltip/setContent strings as raw HTML.
// CVE-2025-69993 makes application-owned popup strings an avoidable trust
// boundary: bindPopup must receive a DOM builder, while tooltip templates must
// visibly escape each interpolation or resolve through the i18n table.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SINK_RE = /\.(?:bindPopup|bindTooltip|setContent)\(\s*`([\s\S]*?)`/g;
const INTERPOLATION_RE = /\$\{([^{}]*)\}/g;
const SAFE_RE = /escapeHtml|escapeText|\bt\(/;
const POPUP_LITERAL_RE = /\.bindPopup\(\s*([`'"])/g;
const POPUP_BUILDER_RE = /\.bindPopup\(\s*([A-Za-z_$][\w$]*)\s*\(/g;
const POPUP_VARIABLE_RE = /\.bindPopup\(\s*([A-Za-z_$][\w$]*)\s*(?=,|\))/g;

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

function findPopupStringOffenders(text, file) {
  const offenders = [];
  const add = (match, detail) => {
    const line = text.slice(0, match.index || 0).split('\n').length;
    offenders.push(`${file}:${line}: ${detail}`);
  };
  for (const match of text.matchAll(POPUP_LITERAL_RE)) {
    add(match, 'bindPopup received a string literal');
  }
  for (const match of text.matchAll(POPUP_BUILDER_RE)) {
    if (!/(?:Element|Node)$/.test(match[1])) {
      add(match, `bindPopup builder ${match[1]}() does not declare DOM content`);
    }
  }
  for (const match of text.matchAll(POPUP_VARIABLE_RE)) {
    add(match, `bindPopup received unverified variable ${match[1]}`);
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
const popupFixture = [
  'marker.bindPopup(activeStormCardHtml(storm))',
  'marker.bindPopup(popupHtml)',
  'marker.bindPopup(activeStormCardElement(storm))',
].join('\n');
if (findPopupStringOffenders(popupFixture, 'fixture.js').length !== 2) {
  throw new Error('DOM-only popup guard regression fixtures failed');
}

const offenders = [];
for (const file of await readdir(srcDir)) {
  if (!file.endsWith('.js')) continue;
  const text = await readFile(path.join(srcDir, file), 'utf8');
  offenders.push(...findOffenders(text, `src/${file}`));
  offenders.push(...findPopupStringOffenders(text, `src/${file}`));
}

if (offenders.length) {
  console.error('Unsafe Leaflet content sink:');
  for (const offender of offenders) console.error(`- ${offender}`);
  console.error('Use a DOM Element/Node builder for popups and escape every tooltip interpolation.');
  process.exit(1);
}
console.log('popup sinks ok (DOM-only popups; no unescaped tooltip interpolation)');
