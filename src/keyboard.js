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

const palette = document.getElementById('keyboard-palette');
const paletteClose = palette?.querySelector('.palette-close');

export function init() {
  setupGlobalShortcuts();
  setupPaletteHandlers();
  setupFocusHighlight();
}

function setupGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    // Ctrl/Cmd + M: Major hurricanes only
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault();
      filterMajorOnly();
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
  // Add visible focus indicators via :focus-visible
  // This is handled by CSS, but we can enhance with manual highlights if needed
  
  // Trap focus inside modals
  document.addEventListener('keydown', (e) => {
    if (palette && !palette.hidden && e.key === 'Tab') {
      const focusableElements = palette.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  });
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
  
  // Focus the close button or first focusable element
  const closeBtn = palette.querySelector('.palette-close');
  if (closeBtn) closeBtn.focus();
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
}

function filterMajorOnly() {
  // Filter to Category 3, 4, 5 only
  // This needs to be coordinated with main.js filters
  if (typeof window.filterByMacro === 'function') {
    window.filterByMacro('major');
  }
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
    document.querySelector('.onb-overlay')
  );
}

export { openPalette, closePalette };
