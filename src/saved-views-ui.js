import {
  deleteSavedView,
  exportSavedViews,
  importSavedViews,
  loadSavedViews,
  prepareSavedViewsImport,
  saveCurrentView,
} from './saved-views.js';
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { announceLocalAction, confirmLocalAction } from './confirm-action.js';

export function initSavedViewsUI({ host, getCurrentHash, restoreHash }) {
  if (!host) return;
  let pendingImport = null;
  let importMode = 'merge';
  let importFailure = null;

  const render = () => {
    const views = loadSavedViews();
    const preview = pendingImport
      ? importFailure || prepareSavedViewsImport(pendingImport, { mode: importMode, existing: views })
      : null;
    host.innerHTML = `
      <div class="saved-view-create">
        <label class="sr-only" for="saved-view-name">${escapeHtml(t('savedViews.nameLabel'))}</label>
        <input id="saved-view-name" maxlength="60" placeholder="${escapeHtml(t('savedViews.namePlaceholder'))}" />
        <button class="settings-action" data-action="save" type="button">${escapeHtml(t('savedViews.saveCurrent'))}</button>
        <button class="settings-action" data-action="export" type="button"${views.length ? '' : ' disabled'}>${escapeHtml(t('savedViews.exportJson'))}</button>
        <button class="settings-action" data-action="choose-import" type="button">${escapeHtml(t('savedViews.importJson'))}</button>
        <label class="sr-only" for="saved-view-file">${escapeHtml(t('savedViews.importJson'))}</label>
        <input id="saved-view-file" class="visually-hidden" data-saved-view-file type="file" accept=".json,application/json" />
      </div>
      <div class="saved-view-status" role="status" aria-live="polite"></div>
      ${preview ? importPreviewMarkup(preview, importMode) : ''}
      <ul class="saved-view-list">
        ${views.map(view => `<li>
          <button class="saved-view-restore" data-action="restore" data-id="${view.id}" type="button">${escapeHtml(view.name)}</button>
          <button class="saved-view-delete" data-action="delete" data-id="${view.id}" type="button" aria-label="${escapeHtml(t('savedViews.delete', view.name))}">×</button>
        </li>`).join('') || `<li class="settings-help">${escapeHtml(t('savedViews.empty'))}</li>`}
      </ul>`;
  };

  host.addEventListener('change', async event => {
    const fileInput = event.target.closest('[data-saved-view-file]');
    if (fileInput) {
      const file = fileInput.files?.[0];
      if (!file) return;
      pendingImport = file.size <= 256 * 1024 ? await file.text() : '{';
      importMode = 'merge';
      importFailure = null;
      render();
      host.querySelector('.saved-view-import-preview')?.focus({ preventScroll: true });
      return;
    }
    const modeInput = event.target.closest('[name="saved-view-import-mode"]');
    if (modeInput) {
      importMode = modeInput.value;
      importFailure = null;
      render();
      host.querySelector(`[name="saved-view-import-mode"][value="${importMode}"]`)?.focus({ preventScroll: true });
    }
  });

  host.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const status = host.querySelector('.saved-view-status');
    if (button.dataset.action === 'save') {
      const input = host.querySelector('#saved-view-name');
      const view = saveCurrentView(input.value, getCurrentHash() || '#v=1');
      if (!view) {
        status.textContent = t('savedViews.enterName');
        input.focus();
        return;
      }
      render();
    } else if (button.dataset.action === 'delete') {
      const view = loadSavedViews().find(item => item.id === button.dataset.id);
      if (!view) return;
      const confirmed = await confirmLocalAction({
        title: t('savedViews.confirmDeleteTitle'),
        message: t('savedViews.confirmDeleteBody', view.name),
        confirmLabel: t('savedViews.confirmDeleteAction'),
        invoker: button,
      });
      if (!confirmed) return;
      deleteSavedView(button.dataset.id);
      render();
      const message = t('savedViews.deleted', view.name);
      host.querySelector('.saved-view-status').textContent = message;
      announceLocalAction(message);
      host.querySelector('#saved-view-name')?.focus({ preventScroll: true });
    } else if (button.dataset.action === 'restore') {
      const view = loadSavedViews().find(item => item.id === button.dataset.id);
      if (view) restoreHash(view.hash);
    } else if (button.dataset.action === 'export') {
      downloadJson(exportSavedViews());
    } else if (button.dataset.action === 'choose-import') {
      host.querySelector('[data-saved-view-file]')?.click();
    } else if (button.dataset.action === 'cancel-import') {
      pendingImport = null;
      importFailure = null;
      render();
      host.querySelector('[data-action="choose-import"]')?.focus({ preventScroll: true });
    } else if (button.dataset.action === 'commit-import') {
      const result = importSavedViews(pendingImport, { mode: importMode });
      if (!result.ok) {
        importFailure = result;
        render();
        host.querySelector('.saved-view-import-preview')?.focus({ preventScroll: true });
        return;
      }
      pendingImport = null;
      importFailure = null;
      render();
      const message = t('savedViews.imported', result.imported.length);
      host.querySelector('.saved-view-status').textContent = message;
      announceLocalAction(message);
      host.querySelector('#saved-view-name')?.focus({ preventScroll: true });
    }
  });
  render();
}

function importPreviewMarkup(preview, mode) {
  const errors = preview.errors || [];
  return `
    <section class="saved-view-import-preview" tabindex="-1" aria-labelledby="saved-view-import-title">
      <h4 id="saved-view-import-title">${escapeHtml(t('savedViews.importPreview'))}</h4>
      ${errors.length
        ? `<p class="saved-view-import-summary">${escapeHtml(t(`savedViews.importStatus.${preview.status}`))}</p>
           <ul class="saved-view-import-errors">${errors.map(error => `<li><code>${escapeHtml(error.path)}</code> ${escapeHtml(t(`savedViews.importError.${error.code}`))}</li>`).join('')}</ul>`
        : `<p class="saved-view-import-summary">${escapeHtml(t('savedViews.importCount', preview.imported.length))}${preview.omitted ? ` ${escapeHtml(t('savedViews.importOmitted', preview.omitted))}` : ''}</p>
           <ul class="saved-view-import-list">${preview.imported.map(view => `<li>${escapeHtml(view.name)}</li>`).join('')}</ul>`}
      <fieldset class="saved-view-import-mode">
        <legend>${escapeHtml(t('savedViews.importMode'))}</legend>
        <label><input name="saved-view-import-mode" type="radio" value="merge"${mode === 'merge' ? ' checked' : ''}> ${escapeHtml(t('savedViews.importMerge'))}</label>
        <label><input name="saved-view-import-mode" type="radio" value="replace"${mode === 'replace' ? ' checked' : ''}> ${escapeHtml(t('savedViews.importReplace'))}</label>
      </fieldset>
      <div class="saved-view-import-actions">
        <button class="text-btn" data-action="cancel-import" type="button">${escapeHtml(t('confirm.cancel'))}</button>
        <button class="settings-action" data-action="commit-import" type="button"${errors.length ? ' disabled' : ''}>${escapeHtml(t('savedViews.importAction'))}</button>
      </div>
    </section>`;
}

function downloadJson(body) {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `HurricaneMap-saved-views-${new Date().toISOString().split('T')[0]}.json`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
