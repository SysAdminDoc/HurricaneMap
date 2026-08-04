// Reproducible release citations shared by panels, exports, and the notebook.
import { getDataReleaseCitationMetadata } from './export-provenance.js';

export const CITATION_SCHEMA_VERSION = 1;
export const HURRICANEMAP_URL = 'https://sysadmindoc.github.io/HurricaneMap/';

function normalizeAccessDate(value) {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text || Date.now());
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function joinRevisionDates(dates) {
  return dates.length === 1 ? dates[0] : dates.join(', ');
}

function sourceShaText(sources) {
  return sources.map(source => `${source.label} SHA-256: ${source.sha256}`).join('; ');
}

function releaseUrl(releasePin) {
  return `${HURRICANEMAP_URL}#v=1&rel=${releasePin}`;
}

export function buildCitation({ accessDate = new Date(), url = null } = {}) {
  const release = getDataReleaseCitationMetadata();
  const accessed = normalizeAccessDate(accessDate);
  const year = accessed.slice(0, 4);
  const revisionDate = joinRevisionDates(release.revision_dates);
  const sourceHashes = sourceShaText(release.sources);
  const citationUrl = url || releaseUrl(release.release_pin);
  const sourceUrls = release.sources.map(source => source.source_url).join(', ');
  const apa = `SysAdminDoc. (${year}). HurricaneMap: Interactive hurricane landfall atlas (version ${release.app_version}) [Data set and web application]. HURDAT2 revision ${revisionDate}; ${sourceHashes}. Retrieved ${accessed}, from ${citationUrl}`;
  const bibtex = `@software{hurricanemap_${year},\n  author = {Parker, Matt},\n  title = {HurricaneMap: Interactive hurricane landfall atlas},\n  year = {${year}},\n  version = {${release.app_version}},\n  url = {${citationUrl}},\n  note = {HURDAT2 revision ${revisionDate}; ${sourceHashes}; accessed ${accessed}; source URLs: ${sourceUrls}}\n}`;
  return {
    schema_version: CITATION_SCHEMA_VERSION,
    apa,
    bibtex,
    accessed,
    url: citationUrl,
    release,
  };
}

export function citationCommentLines(citation, prefix = '# ') {
  const lines = [
    `${prefix}APA citation: ${citation.apa}`,
    `${prefix}BibTeX citation:`,
    ...citation.bibtex.split('\n').map(line => `${prefix}${line}`),
  ];
  return lines;
}

export function citationText(citation = buildCitation()) {
  return `APA citation: ${citation.apa}\n\nBibTeX citation:\n${citation.bibtex}`;
}
