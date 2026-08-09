// Keyboard navigation & shortcuts
// - ? key opens shortcuts palette
// - Ctrl+M: Major hurricanes only filter
// - Escape: Close panels / clear focus
// - Tab: Navigate interactive elements
// - Arrow keys: Navigate within panels and timeline
//
// Ctrl+T (new tab) and Ctrl+L (omnibox) are browser-reserved in every major
// browser and never reach page content — do not bind them.

import { closeAllPanels } from './panels.js';
import { activateDialogFocus } from './dialog-focus.js';
import { filterByMacro } from './filter-state.js';

const palette = document.getElementById('keyboard-palette');
const paletteClose = palette?.querySelector('.palette-close');
let releasePaletteFocus = null;

export function init({ filters, onFilterChange } = {}) {
  setupGlobalShortcuts({ filters, onFilterChange });
  setupPaletteHandlers();
  setupFocusHighlight();
}

function setupGlobalShortcuts({ filters, onFilterChange } = {}) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    // Ctrl + M: Major hurricanes only. Cmd + M remains the macOS minimize
    // window shortcut and must never be claimed by the page.
    if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      filterMajorOnly(filters, onFilterChange);
    }
    // ?: Open shortcuts palette
    else if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !isInputFocused()) {
      e.preventDefault();
      openPalette();
    }
    // Escape: Close palette, close panels
    else if (e.key === 'Escape') {
      if (palette && !palette.hidden) {
        closePalette();
        e.preventDefault();
      } else if (!isBlockingSurfaceOpen()) {
        // Close any open panels
        closeAllPanels();
      }
    }
  });
}

function setupPaletteHandlers() {
  if (!palette) return;
  
  if (paletteClose) {
    paletteClose.addEventListener('click', closePalette);
  }

  palette.addEventListener('click', (e) => {
    if (e.target === palette) closePalette();
  });

  // Close palette on Escape
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && palette && !palette.hidden) {
      closePalette();
      e.preventDefault();
    }
  });

  // Close palette when clicking outside
  document.addEventListener('click', (e) => {
    if (palette && !palette.hidden && !palette.contains(e.target)) {
      closePalette();
    }
  });
}

function setupFocusHighlight() {
  // Visible focus indicators are handled by the shared :focus-visible tokens.
}

function openPalette() {
  if (!palette) return;
  palette.hidden = false;
  if (typeof palette.showModal === 'function' && !palette.open) {
    palette.showModal();
  } else {
    palette.setAttribute('open', '');
  }
  palette.setAttribute('aria-hidden', 'false');
  releasePaletteFocus = activateDialogFocus(palette, { initialFocus: '.palette-close' });
}

function closePalette() {
  if (!palette) return;
  if (typeof palette.close === 'function' && palette.open) {
    palette.close();
  } else {
    palette.removeAttribute('open');
  }
  palette.hidden = true;
  palette.setAttribute('aria-hidden', 'true');
  releasePaletteFocus?.();
  releasePaletteFocus = null;
}

function filterMajorOnly(filters, onFilterChange) {
  if (!filters || !filterByMacro(filters, 'major')) return;
  onFilterChange?.();
}

function isInputFocused() {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  );
}

function isBlockingSurfaceOpen() {
  // The settings menu is a popover — it never carries the hidden attribute,
  // so it must be tested with :popover-open (the old :not([hidden]) check
  // matched permanently and blocked Escape from ever closing panels).
  return Boolean(
    document.querySelector('#settings-menu:popover-open') ||
    document.querySelector('#info-modal:not([hidden])') ||
    document.querySelector('#glossary-modal:not([hidden])') ||
    document.querySelector('#globe3d-panel:not([hidden])') ||
    document.querySelector('.onb-overlay')
  );
}

export { openPalette, closePalette };
