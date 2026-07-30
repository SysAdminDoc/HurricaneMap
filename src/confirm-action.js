import { activateDialogFocus } from './dialog-focus.js';
import { t } from './i18n.js';

const DIALOG_ID = 'confirm-local-action';
let activeConfirmation = null;

function getDialog(documentRef) {
  let dialog = documentRef.getElementById(DIALOG_ID);
  if (dialog) return dialog;
  dialog = documentRef.createElement('dialog');
  dialog.id = DIALOG_ID;
  dialog.className = 'confirm-action-dialog glass';
  dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
  dialog.setAttribute('aria-describedby', `${DIALOG_ID}-message`);
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="${DIALOG_ID}-title"></h2>
      <p id="${DIALOG_ID}-message"></p>
      <div class="confirm-action-buttons">
        <button class="text-btn confirm-action-cancel" type="submit" value="cancel"></button>
        <button class="settings-action confirm-action-submit" type="submit" value="confirm"></button>
      </div>
    </form>`;
  documentRef.body.appendChild(dialog);
  return dialog;
}

export function confirmLocalAction({
  title,
  message,
  confirmLabel,
  invoker = globalThis.document?.activeElement,
  documentRef = globalThis.document,
} = {}) {
  if (!documentRef?.body || activeConfirmation) return Promise.resolve(false);
  const dialog = getDialog(documentRef);
  const opener = invoker instanceof documentRef.defaultView.HTMLElement ? invoker : null;
  const openerPopover = opener?.closest?.('[popover]');
  const reopenPopover = Boolean(openerPopover?.matches?.(':popover-open'));
  dialog.querySelector(`#${DIALOG_ID}-title`).textContent = String(title || '');
  dialog.querySelector(`#${DIALOG_ID}-message`).textContent = String(message || '');
  dialog.querySelector('.confirm-action-cancel').textContent = t('confirm.cancel');
  dialog.querySelector('.confirm-action-submit').textContent = String(confirmLabel || '');
  dialog.returnValue = '';

  return new Promise(resolve => {
    const finish = () => {
      const confirmed = dialog.returnValue === 'confirm';
      if (reopenPopover && !openerPopover.matches(':popover-open')) {
        openerPopover.showPopover();
      }
      releaseFocus({ restoreFocus: false });
      const complete = () => {
        if (opener?.isConnected && !opener.hidden) {
          opener.focus({ preventScroll: true });
        }
        activeConfirmation = null;
        resolve(confirmed);
      };
      if (typeof documentRef.defaultView?.requestAnimationFrame === 'function') {
        documentRef.defaultView.requestAnimationFrame(complete);
      } else {
        complete();
      }
    };
    dialog.addEventListener('close', finish, { once: true });
    dialog.showModal();
    const releaseFocus = activateDialogFocus(dialog, {
      initialFocus: '.confirm-action-cancel',
      returnFocus: opener,
    });
    activeConfirmation = { dialog };
  });
}

export function announceLocalAction(message, documentRef = globalThis.document) {
  const status = documentRef?.getElementById?.('map-announce');
  if (!status) return;
  status.textContent = '';
  const announce = () => { status.textContent = String(message || ''); };
  if (typeof documentRef.defaultView?.requestAnimationFrame === 'function') {
    documentRef.defaultView.requestAnimationFrame(announce);
  } else {
    announce();
  }
}
