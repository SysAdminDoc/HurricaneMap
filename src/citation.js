// Reproducible release citations shared by panels, exports, and the notebook.
import { getDataReleaseCitationMetadata } from './export-provenance.js';

const CITATION_SCHEMA_VERSION = 1;
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

/**
 * The part of a citation that names which storm is being cited.
 *
 * Without it every one of the 596 storm pages emitted the same BibTeX key and
 * the same title, so two storms could not coexist in one bibliography and
 * neither entry recorded which storm the reader had actually used. IBTrACS is
 * the bar here: it asks its users to name the subset alongside the dataset.
 */
function stormSubject(storm) {
  if (!storm) return null;
  const id = String(storm.id || '').trim().toUpperCase();
  const name = String(storm.name || '').trim();
  const year = String(storm.year || '').trim();
  if (!id && !name) return null;
  const display = name && year ? `${name} (${year})` : name || id;
  return {
    id,
    display,
    // A BibTeX key is an identifier, so it takes the HURDAT2 id rather than the
    // name: names repeat across basins and decades, ids do not.
    key: (id || display).toLowerCase().replace(/[^a-z0-9]+/g, ''),
  };
}

function risRecord({ year, title, version, url, note }) {
  return [
    'TY  - DATA',
    'AU  - Parker, Matt',
    `PY  - ${year}`,
    `TI  - ${title}`,
    `ET  - ${version}`,
    `UR  - ${url}`,
    `N1  - ${note}`,
    'ER  - ',
  ].join('\n');
}

export function buildCitation({ accessDate = new Date(), url = null, storm = null } = {}) {
  const release = getDataReleaseCitationMetadata();
  const accessed = normalizeAccessDate(accessDate);
  const year = accessed.slice(0, 4);
  const revisionDate = joinRevisionDates(release.revision_dates);
  const sourceHashes = sourceShaText(release.sources);
  const citationUrl = url || releaseUrl(release.release_pin);
  const sourceUrls = release.sources.map(source => source.source_url).join(', ');
  const subject = stormSubject(storm);
  const atlas = 'HurricaneMap: Interactive hurricane landfall atlas';
  const title = subject ? `${subject.display} in ${atlas}` : atlas;
  const apaSubject = subject ? `${subject.display} [${subject.id}] in ` : '';
  const note = `HURDAT2 revision ${revisionDate}; ${sourceHashes}; accessed ${accessed}; source URLs: ${sourceUrls}`;
  const apa = `SysAdminDoc. (${year}). ${apaSubject}${atlas} (version ${release.app_version}) [Data set and web application]. HURDAT2 revision ${revisionDate}; ${sourceHashes}. Retrieved ${accessed}, from ${citationUrl}`;
  const bibtexKey = subject ? `hurricanemap_${subject.key}_${year}` : `hurricanemap_${year}`;
  const bibtex = `@software{${bibtexKey},\n  author = {Parker, Matt},\n  title = {${title}},\n  year = {${year}},\n  version = {${release.app_version}},\n  url = {${citationUrl}},\n  note = {${note}}\n}`;
  const ris = risRecord({ year, title, version: release.app_version, url: citationUrl, note });
  return {
    schema_version: CITATION_SCHEMA_VERSION,
    apa,
    bibtex,
    ris,
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
    `${prefix}RIS citation:`,
    ...citation.ris.split('\n').map(line => `${prefix}${line}`),
  ];
  return lines;
}

