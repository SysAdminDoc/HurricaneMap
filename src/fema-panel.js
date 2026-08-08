import { escapeHtml, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import { FEMA_SOURCE_URL, fetchFemaDeclarations, formatFemaDate } from './fema.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';

let femaController = null;

export function cancelFemaRequest() {
  if (femaController) femaController.abort();
  femaController = null;
}

function femaLocale() {
  return document.documentElement?.lang || undefined;
}

function renderFemaDeclaration(record) {
  const dateStart = formatFemaDate(record.incidentBeginDate, femaLocale());
  const dateEnd = formatFemaDate(record.incidentEndDate, femaLocale());
  const declared = formatFemaDate(record.declarationDate, femaLocale());
  const dateLabel = dateStart && dateEnd && dateStart !== dateEnd
    ? t('panel.femaDateRange', dateStart, dateEnd)
    : dateStart || dateEnd || t('panel.femaDateUnavailable');
  const states = record.states.length
    ? record.states.map(group => `
        <div class="fema-state-group">
          <strong>${escapeHtml(group.state || t('state.unknown'))}</strong>
          <span>${escapeHtml(group.areas.length ? group.areas.join(', ') : t('panel.femaNoArea'))}</span>
        </div>`).join('')
    : `<span class="fema-no-area">${t('panel.femaNoArea')}</span>`;
  const recordLink = safeExternalUrl(record.recordUrl, { hosts: ['www.fema.gov'] });
  return `
    <article class="fema-declaration">
      <div class="fema-declaration-heading">
        <strong>${escapeHtml(record.declarationType || t('panel.femaDeclaration'))}</strong>
        <span>${escapeHtml(record.title || t('panel.femaUntitled'))}</span>
      </div>
      <dl class="fema-declaration-meta">
        <div><dt>${t('panel.femaIncident')}</dt><dd>${escapeHtml(record.incidentType || t('panel.femaUnknown'))}</dd></div>
        <div><dt>${t('panel.femaDates')}</dt><dd>${escapeHtml(dateLabel)}</dd></div>
        ${declared ? `<div><dt>${t('panel.femaDeclared')}</dt><dd>${escapeHtml(declared)}</dd></div>` : ''}
      </dl>
      <div class="fema-areas">
        <span class="fema-areas-label">${t('panel.femaAreas')}</span>
        <div class="fema-state-list">${states}</div>
      </div>
      ${recordLink ? `<a class="fema-record-link" href="${recordLink}" target="_blank" rel="noopener">${t('panel.femaRecord')}</a>` : ''}
    </article>`;
}

function renderFemaContext(host, result) {
  if (!host) return;
  host.dataset.state = result.status;
  const bodyHost = host.querySelector('.fema-context-body');
  if (!bodyHost) return;
  if (result.status === 'success' && result.records.length) {
    bodyHost.innerHTML = `
      <p class="fema-context-summary">${escapeHtml(t('panel.femaFound', result.records.length))}</p>
      <div class="fema-declaration-list">${result.records.map(renderFemaDeclaration).join('')}</div>
      <p class="fema-service-note">${t('panel.femaServiceNote')}</p>`;
    return;
  }
  if (result.status === 'empty') {
    bodyHost.innerHTML = `
      <p class="fema-status fema-status--empty">${t('panel.femaNoMatch')}</p>
      <p class="fema-service-note">${t('panel.femaNoMatchHelp')}</p>`;
    return;
  }
  const sourceUrl = safeExternalUrl(FEMA_SOURCE_URL, { hosts: ['www.fema.gov'] });
  const source = sourceUrl
    ? `<a href="${sourceUrl}" target="_blank" rel="noopener">${t('panel.femaSource')}</a>`
    : t('panel.femaSource');
  bodyHost.innerHTML = `
    <p class="fema-status fema-status--error">${t('panel.femaUnavailable')}</p>
    <p class="fema-service-note">${t('panel.femaUnavailableHelp', source)}</p>`;
}

export async function loadFemaContext(storm, renderSeq, isCurrent = () => true) {
  const host = document.getElementById('fema-context');
  if (!host) return;
  let statusHost = host.querySelector('#fema-feed-status');
  if (!statusHost) {
    statusHost = document.createElement('div');
    statusHost.id = 'fema-feed-status';
    statusHost.className = 'optional-feed-status-host';
    host.querySelector('.fema-context-heading')?.after(statusHost);
  }
  mountOptionalFeedStatus(statusHost, 'fema', {
    onRetry: () => loadFemaContext(storm, renderSeq, isCurrent),
  });
  cancelFemaRequest();
  femaController = new AbortController();
  const controller = femaController;
  try {
    const result = await fetchFemaDeclarations(storm, { signal: controller.signal });
    if (!isCurrent(renderSeq) || !host.isConnected || controller !== femaController) return;
    renderFemaContext(host, result);
  } catch {
    if (!isCurrent(renderSeq) || !host.isConnected || controller !== femaController) return;
    renderFemaContext(host, { status: 'error', records: [] });
  } finally {
    if (controller === femaController) femaController = null;
  }
}
