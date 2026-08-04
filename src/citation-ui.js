// Shared copy-paste citation controls for panels and release surfaces.
import { buildCitation } from './citation.js';
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';

let initialized = false;
let nextCitationId = 0;

export function renderCitationBlock() {
  const citation = buildCitation();
  const apaId = citationId('apa');
  const bibtexId = citationId('bibtex');
  return `
    <details class="citation-block" data-citation-block>
      <summary>${escapeHtml(t('citation.title'))}</summary>
      <p class="citation-description">${escapeHtml(t('citation.description'))}</p>
      <div class="citation-field">
        <div class="citation-field-heading">
          <label for="${apaId}">${escapeHtml(t('citation.apa'))}</label>
          <button type="button" class="text-btn citation-copy-btn" data-citation-copy="apa">${escapeHtml(t('citation.copy'))}</button>
        </div>
        <textarea id="${apaId}" data-citation-value="apa" readonly rows="4" spellcheck="false" aria-label="${escapeHtml(t('citation.apa'))}">${escapeHtml(citation.apa)}</textarea>
      </div>
      <div class="citation-field">
        <div class="citation-field-heading">
          <label for="${bibtexId}">${escapeHtml(t('citation.bibtex'))}</label>
          <button type="button" class="text-btn citation-copy-btn" data-citation-copy="bibtex">${escapeHtml(t('citation.copy'))}</button>
        </div>
        <textarea id="${bibtexId}" data-citation-value="bibtex" readonly rows="8" spellcheck="false" aria-label="${escapeHtml(t('citation.bibtex'))}">${escapeHtml(citation.bibtex)}</textarea>
      </div>
      <p class="citation-status" data-citation-status role="status" aria-live="polite"></p>
    </details>`;
}

export function mountCitationHost(host) {
  if (!host) return;
  host.innerHTML = renderCitationBlock();
}

export function initCitationUI() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-citation-copy]');
    if (!button) return;
    const block = button.closest('[data-citation-block]');
    const value = block?.querySelector(`[data-citation-value="${button.dataset.citationCopy}"]`)?.value;
    const status = block?.querySelector('[data-citation-status]');
    if (!value || !status) return;
    try {
      await copyText(value);
      status.textContent = t('citation.copied');
    } catch {
      status.textContent = t('citation.copyFailed');
    }
  });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy command failed');
  } finally {
    textarea.remove();
  }
}

function citationId(kind) {
  nextCitationId += 1;
  return `citation-${kind}-${nextCitationId}`;
}
