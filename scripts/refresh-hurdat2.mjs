import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE_URL = 'https://www.nhc.noaa.gov/data/hurdat/';

const TARGETS = {
  atlantic: {
    label: 'Atlantic',
    localPath: 'data/hurdat2-atlantic.txt',
    firstLinePattern: /^AL\d{6}\s*,/,
  },
  nepac: {
    label: 'Northeast/Central Pacific',
    localPath: 'data/hurdat2-nepac.txt',
    firstLinePattern: /^(EP|CP)\d{6}\s*,/,
  },
};

export function extractHurdatLinks(html) {
  if (typeof html !== 'string') return [];
  const links = new Set();
  for (const match of html.matchAll(/href=["']([^"']+\.txt)["']/gi)) {
    const file = decodeURIComponent(match[1].split('/').pop() || '').trim();
    if (/^hurdat2-.+\.txt$/i.test(file)) links.add(file);
  }
  return [...links].sort();
}

export function parseHurdatFilename(file) {
  const name = String(file || '').trim();
  let match = name.match(/^hurdat2-1851-(\d{4})-(\d{6,8}[a-z]?)\.txt$/i);
  if (match) {
    return {
      basin: 'atlantic',
      file: name,
      endYear: Number(match[1]),
      revisionKey: revisionSortKey(match[2]),
    };
  }
  match = name.match(/^hurdat2-atl-1851-(\d{4})-(\d{6,8}[a-z]?)\.txt$/i);
  if (match) {
    return {
      basin: 'atlantic',
      file: name,
      endYear: Number(match[1]),
      revisionKey: revisionSortKey(match[2]),
    };
  }
  match = name.match(/^hurdat2-nepac-1949-(\d{4})-(\d{6,8}[a-z]?)\.txt$/i);
  if (match) {
    return {
      basin: 'nepac',
      file: name,
      endYear: Number(match[1]),
      revisionKey: revisionSortKey(match[2]),
    };
  }
  return null;
}

export function selectLatestHurdatFiles(html) {
  const candidates = extractHurdatLinks(html)
    .map(parseHurdatFilename)
    .filter(Boolean);
  const latest = {};
  for (const candidate of candidates) {
    const current = latest[candidate.basin];
    if (!current || compareHurdatCandidates(candidate, current) > 0) {
      latest[candidate.basin] = candidate;
    }
  }
  if (!latest.atlantic || !latest.nepac) {
    throw new Error(`Could not detect both current HURDAT2 files from NOAA directory listing. Found: ${Object.keys(latest).join(', ') || 'none'}`);
  }
  return latest;
}

export function normalizeHurdatText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function refreshHurdat2Files(options = {}) {
  const sourceUrl = options.sourceUrl || process.env.HURDAT2_SOURCE_URL || DEFAULT_SOURCE_URL;
  const apply = options.apply === true;
  const minBytes = options.minBytes || 100_000;

  const directoryHtml = await fetchText(sourceUrl);
  const latest = selectLatestHurdatFiles(directoryHtml);
  const results = [];

  for (const key of ['atlantic', 'nepac']) {
    const target = TARGETS[key];
    const candidate = latest[key];
    const url = new URL(candidate.file, sourceUrl).href;
    const downloaded = normalizeHurdatText(await fetchText(url));
    validateHurdatText(downloaded, target, minBytes, candidate.file);

    const localPath = path.join(root, target.localPath);
    const current = normalizeHurdatText(await readFile(localPath, 'utf8'));
    const changed = current !== downloaded;
    if (apply && changed) {
      await writeFile(localPath, downloaded, 'utf8');
    }
    results.push({
      key,
      label: target.label,
      file: candidate.file,
      url,
      localPath: target.localPath,
      changed,
      oldSha256: sha256(current),
      newSha256: sha256(downloaded),
      bytes: Buffer.byteLength(downloaded, 'utf8'),
      endYear: candidate.endYear,
    });
  }

  return {
    sourceUrl,
    apply,
    changed: results.some(result => result.changed),
    results,
  };
}

function compareHurdatCandidates(a, b) {
  if (a.endYear !== b.endYear) return a.endYear - b.endYear;
  return a.revisionKey.localeCompare(b.revisionKey);
}

function revisionSortKey(token) {
  const value = String(token || '').toLowerCase();
  const digits = value.match(/\d+/)?.[0] || '000000';
  const suffix = value.slice(digits.length);
  let dateKey = digits.padStart(8, '0');
  if (digits.length === 8) {
    const mm = digits.slice(0, 2);
    const dd = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    dateKey = `${yyyy}${mm}${dd}`;
  } else if (digits.length === 6) {
    const mm = digits.slice(0, 2);
    const dd = digits.slice(2, 4);
    const yy = Number(digits.slice(4, 6));
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    dateKey = `${yyyy}${mm}${dd}`;
  }
  return `${dateKey}${suffix}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'HurricaneMap HURDAT2 refresh helper',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

function validateHurdatText(text, target, minBytes, file) {
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength < minBytes) {
    throw new Error(`${file} looks too small for ${target.label} HURDAT2 (${byteLength} bytes).`);
  }
  const firstLine = text.split('\n').find(line => line.trim());
  if (!target.firstLinePattern.test(firstLine || '')) {
    throw new Error(`${file} does not look like ${target.label} HURDAT2; first line was: ${firstLine || '(empty)'}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const args = {
    apply: false,
    sourceUrl: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--url') args.sourceUrl = argv[++i];
    else if (arg.startsWith('--url=')) args.sourceUrl = arg.slice('--url='.length);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/refresh-hurdat2.mjs [--dry-run] [--apply] [--url URL]

Detects the latest NOAA HURDAT2 Atlantic and NE/NC Pacific text files,
downloads them, compares them with data/hurdat2-*.txt, and writes canonical
local files when --apply is supplied.`);
}

async function main() {
  const result = await refreshHurdat2Files(parseArgs(process.argv.slice(2)));
  console.log(`HURDAT2 refresh ${result.apply ? 'apply' : 'dry-run'} complete (${result.changed ? 'changes detected' : 'no changes'}).`);
  for (const item of result.results) {
    const status = item.changed ? 'changed' : 'unchanged';
    console.log(`- ${item.label}: ${item.file} -> ${item.localPath} (${status}, ${item.bytes.toLocaleString()} bytes, ${item.newSha256.slice(0, 12)})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
