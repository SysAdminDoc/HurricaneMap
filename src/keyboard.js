// Keyboard navigation & shortcuts
// - ? key opens shortcuts palette
// - Ctrl+M: Major hurricanes only filter
// - Ctrl+T: Tropical storms only filter
// - Ctrl+L: Focus search input
// - Escape: Close panels / clear focus
// - Tab: Navigate interactive elements
// - Arrow keys: Navigate within panels and timeline

const palette = document.getElementById('keyboard-palette');
const paletteClose = palette?.querySelector('.palette-close');

// Reference to global filter state and apply function (wired by main.js)
let applyFilters = null;

export function init(applyFiltersFn) {
  applyFilters = applyFiltersFn;
  setupGlobalShortcuts();
  setupPaletteHandlers();
  setupFocusHighlight();
}

function setupGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + M: Major hurricanes only
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
      e.preventDefault();
      filterMajorOnly();
    }
    // Ctrl/Cmd + T: Tropical storms only
    else if ((e.ctrlKey || e.metaKey) && e.key === 't') {
      e.preventDefault();
      filterTropicalOnly();
    }
    // Ctrl/Cmd + L: Focus search
    else if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.focus();
    }
    // ?: Open shortcuts palette
    else if (e.key === '?' && !isInputFocused()) {
      e.preventDefault();
      openPalette();
    }
    // Escape: Close palette, close panels
    else if (e.key === 'Escape') {
      if (palette && !palette.hidden) {
        closePalette();
      } else {
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

  // Close palette on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && palette && !palette.hidden) {
      closePalette();
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
  palette.setAttribute('aria-hidden', 'false');
  
  // Focus the close button or first focusable element
  const closeBtn = palette.querySelector('.palette-close');
  if (closeBtn) closeBtn.focus();
}

function closePalette() {
  if (!palette) return;
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

function filterTropicalOnly() {
  // Filter to Tropical Storm only
  if (typeof window.filterByMacro === 'function') {
    window.filterByMacro('tropical');
  }
}

function closeAllPanels() {
  const panels = document.querySelectorAll(
    '[id$="-panel"]'
  );
  panels.forEach(panel => {
    panel.hidden = true;
  });
}

function isInputFocused() {
  const active = document.activeElement;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  );
}

function showToast(message, type = 'info') {
  // Use existing toast infrastructure if available
  if (window.showToast) {
    window.showToast(message, type);
  } else {
    console.info(message);
  }
}

export { openPalette, closePalette };
