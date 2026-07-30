import {
  deleteSavedView,
  exportSavedViews,
  loadSavedViews,
  saveCurrentView,
} from './saved-views.js';
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { announceLocalAction, confirmLocalAction } from './confirm-action.js';

export function initSavedViewsUI({ host, getCurrentHash, restoreHash }) {
  if (!host) return;

  const render = () => {
    const views = loadSavedViews();
    host.innerHTML = `
      <div class="saved-view-create">
        <label class="sr-only" for="saved-view-name">${escapeHtml(t('savedViews.nameLabel'))}</label>
        <input id="saved-view-name" maxlength="60" placeholder="${escapeHtml(t('savedViews.namePlaceholder'))}" />
        <button class="settings-action" data-action="save" type="button">${escapeHtml(t('savedViews.saveCurrent'))}</button>
        <button class="settings-action" data-action="export" type="button"${views.length ? '' : ' disabled'}>${escapeHtml(t('savedViews.exportJson'))}</button>
      </div>
      <div class="saved-view-status" role="status" aria-live="polite"></div>
      <ul class="saved-view-list">
        ${views.map(view => `<li>
          <button class="saved-view-restore" data-action="restore" data-id="${view.id}" type="button">${escapeHtml(view.name)}</button>
          <button class="saved-view-delete" data-action="delete" data-id="${view.id}" type="button" aria-label="${escapeHtml(t('savedViews.delete', view.name))}">×</button>
        </li>`).join('') || `<li class="settings-help">${escapeHtml(t('savedViews.empty'))}</li>`}
      </ul>`;
  };

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
    }
  });
  render();
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
