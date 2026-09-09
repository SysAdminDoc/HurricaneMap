// Every outbound URL the app renders, probed against the live web.
//
// Sixty-odd https:// links live in src/*.js and nothing checked any of them.
// Two had already rotted before anyone noticed: the SEDAC credit link died on
// 2025-04-30 and the NCEI Storm Events path moved on 2026-08-25, and both were
// found by a person reading the code rather than by a gate. A link that 404s is
// a dead end for a reader; a link that redirects to a different host is worse,
// because the code still says where it points and the reader ends up somewhere
// else.
//
// This needs the network, so it is in NON_GATE_SCRIPTS rather than the release
// gate set, and it writes a snapshot of its last green run. check:release-truth
// fails when that snapshot goes stale, which is what makes an offline gate set
// able to notice that nobody has run the online one.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'src');
export const SNAPSHOT_PATH = 'security/link-probe-snapshot.json';
export const SNAPSHOT_MAX_AGE_DAYS = 60;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PARALLEL = 6;

// A redirect that lands on another host is normally rot. These are the ones
// that are not, each with the reason, so a genuine move still fails.
// A `host->*` entry means the host is a resolver: where it lands is not
// this repository's business, only that it still resolves.
export const ALLOWED_HOST_CHANGES = new Map([
  ['doi.org->*', 'a DOI is a redirector by definition. It resolves to whichever host the publisher currently serves the article from, and that changes when a journal moves or puts an access interstitial in front. A DOI that has rotted still fails this gate, because doi.org answers 404 for one that does not exist.'],
  ['www.nhc.noaa.gov->www.weather.gov', 'NHC serves some static pages from the NWS host'],
  ['github.com->www.github.com', 'GitHub canonicalises to www for some paths'],
  ['en.wikipedia.org->en.m.wikipedia.org', 'Wikipedia redirects to its mobile host for some clients'],
]);

// Hosts that answer a probe with a challenge or a block rather than the page,
// so a status from them says nothing about whether the link works for a reader.
// Each was checked by hand on the date given.
export const UNPROBEABLE_HOSTS = new Map([
  ['www.youtube.com', 'answers automated requests with a consent interstitial'],
  ['vdem.virginia.gov', "Node's fetch cannot complete the handshake with this host; curl reaches it and it answers 202 (checked 2026-09-08)"],
  ['geocode.arcgis.com', 'a geocoding endpoint, 403 without a query and a token'],
  ['api.tidesandcurrents.noaa.gov', 'a data endpoint that answers 400 without its query parameters'],
]);

// Reserved by RFC 2606 and RFC 6761 precisely so that they never resolve. Code
// uses them as deliberate placeholders, and probing one is a guaranteed failure
// that means nothing.
const UNRESOLVABLE_TLDS = new Set(['invalid', 'test', 'example', 'localhost']);

export function stripComments(text) {
  let output = '';
  let index = 0;
  let inString = null;
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (inString) {
      if (character === '\\') { output += '  '; index += 2; continue; }
      if (character === inString) inString = null;
      output += character;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      inString = character;
      output += character;
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') { output += ' '; index += 1; }
      continue;
    }
    if (character === '/' && next === '*') {
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        output += text[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      output += '  ';
      index += 2;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

// A URL built with ${} cannot be probed as written. Its origin still can, and a
// dead host is the failure that matters most, so the origin is probed instead
// and the entry says which it is.
export function extractUrls(file, source) {
  const code = stripComments(source);
  const found = new Map();
  for (const match of code.matchAll(/(['"`])(https:\/\/[^'"`]*)\1/g)) {
    const literal = match[2];
    const interpolation = literal.indexOf('${');
    const candidate = interpolation < 0 ? literal : literal.slice(0, interpolation);
    let url;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (!url.hostname || !url.hostname.includes('.')) continue;
    if (UNRESOLVABLE_TLDS.has(url.hostname.split('.').pop().toLowerCase())) continue;
    // A tile template carries {z}/{x}/{y}, which is not a path any server has.
    // Like an interpolated URL, only its origin can be probed.
    const templated = interpolation >= 0 || /[{}]/.test(literal);
    const probe = templated ? url.origin : url.toString();
    const kind = templated ? 'origin' : 'exact';
    if (!found.has(probe)) found.set(probe, { url: probe, kind, files: new Set() });
    found.get(probe).files.add(file);
  }
  return [...found.values()];
}

async function probe(entry) {
  const coded = new URL(entry.url).hostname;
  const unprobeable = UNPROBEABLE_HOSTS.get(coded);
  if (unprobeable) return { ...entry, skipped: unprobeable };

  const attempt = async method => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(entry.url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        // A reader reaches these in a browser, and several hosts answer a
        // bot user-agent with a 403 they would never send a reader. The Red
        // Cross page is one: 403 to a custom agent, 200 to this.
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      return { status: response.status, finalUrl: response.url || entry.url };
    } finally {
      clearTimeout(timer);
    }
  };

  let result;
  try {
    result = await attempt('HEAD');
    // Plenty of servers refuse HEAD outright, or answer it wrongly.
    if (result.status === 405 || result.status === 501 || result.status === 403 || result.status >= 500) {
      result = await attempt('GET');
    }
  } catch (error) {
    try {
      result = await attempt('GET');
    } catch (retryError) {
      return { ...entry, error: retryError.name === 'AbortError' ? `no answer in ${REQUEST_TIMEOUT_MS / 1000}s` : retryError.message };
    }
  }

  const finalHost = (() => {
    try { return new URL(result.finalUrl).hostname; } catch { return coded; }
  })();
  return { ...entry, status: result.status, finalUrl: result.finalUrl, codedHost: coded, finalHost };
}

async function main() {
  const write = process.argv.includes('--write');
  const files = (await readdir(sourceDir)).filter(name => name.endsWith('.js')).sort();
  const byUrl = new Map();
  for (const file of files) {
    for (const entry of extractUrls(file, await readFile(path.join(sourceDir, file), 'utf8'))) {
      if (!byUrl.has(entry.url)) byUrl.set(entry.url, { ...entry, files: new Set() });
      for (const name of entry.files) byUrl.get(entry.url).files.add(name);
    }
  }
  const entries = [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
  if (!entries.length) {
    console.error('outbound links: no https:// literals found in src/, which cannot be right');
    process.exit(1);
  }

  const results = [];
  for (let index = 0; index < entries.length; index += MAX_PARALLEL) {
    results.push(...await Promise.all(entries.slice(index, index + MAX_PARALLEL).map(probe)));
  }

  const failures = [];
  let skipped = 0;
  for (const result of results) {
    const where = [...result.files].join(', ');
    if (result.skipped) { skipped += 1; continue; }
    if (result.error) {
      failures.push(`${result.url} (${where}) could not be reached: ${result.error}`);
      continue;
    }
    if (result.status >= 400) {
      // An origin probe asks whether the host is still there, not whether its
      // root is a page. A 404 from a CDN root is not rot; no answer at all is.
      if (result.kind === 'origin') continue;
      failures.push(`${result.url} (${where}) answered ${result.status}`);
      continue;
    }
    if (result.finalHost !== result.codedHost) {
      const move = `${result.codedHost}->${result.finalHost}`;
      if (!ALLOWED_HOST_CHANGES.has(move) && !ALLOWED_HOST_CHANGES.has(`${result.codedHost}->*`)) {
        failures.push(`${result.url} (${where}) redirects to another host: ${result.finalUrl}`);
      }
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error(`outbound links: ${failure}`);
    console.error(`outbound links: ${failures.length} of ${results.length} failed`);
    process.exit(1);
  }

  const summary = `outbound links ok (${results.length - skipped} probed, ${skipped} unprobeable by policy, across ${files.length} modules)`;
  if (write) {
    const snapshot = {
      schema: 1,
      checkedAt: new Date().toISOString().slice(0, 10),
      urlCount: results.length,
      probed: results.length - skipped,
      skipped: [...UNPROBEABLE_HOSTS.keys()],
      note: `Written by npm run check:links -- --write. check:release-truth fails when this is more than ${SNAPSHOT_MAX_AGE_DAYS} days old.`,
    };
    await writeFile(path.join(root, SNAPSHOT_PATH), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    console.log(`${summary}; wrote ${SNAPSHOT_PATH} for ${snapshot.checkedAt}`);
    return;
  }
  console.log(summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
