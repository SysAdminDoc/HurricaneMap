// Shared keyboard-focus contract for modal surfaces that are not all native
// <dialog> elements. Activation captures the opener, moves focus into the
// surface, traps Tab/Shift+Tab, and returns focus when the surface closes.

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusableElements(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !element.hidden &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      rect.width > 0 &&
      rect.height > 0;
  });
}

export function activateDialogFocus(dialog, { initialFocus = null, returnFocus = null } = {}) {
  if (!(dialog instanceof HTMLElement)) return () => {};
  const opener = returnFocus instanceof HTMLElement
    ? returnFocus
    : document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  let active = true;

  const resolveInitial = () => {
    if (initialFocus instanceof HTMLElement) return initialFocus;
    if (typeof initialFocus === 'string') return dialog.querySelector(initialFocus);
    return visibleFocusableElements(dialog)[0] || dialog;
  };

  const onKeydown = event => {
    if (!active || event.key !== 'Tab') return;
    const focusable = visibleFocusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };

  dialog.addEventListener('keydown', onKeydown);
  if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  resolveInitial()?.focus({ preventScroll: true });

  return ({ restoreFocus = true } = {}) => {
    if (!active) return;
    active = false;
    dialog.removeEventListener('keydown', onKeydown);
    if (restoreFocus && opener?.isConnected && !opener.hidden) {
      opener.focus({ preventScroll: true });
    }
  };
}
