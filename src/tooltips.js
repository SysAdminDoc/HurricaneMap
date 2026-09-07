// Progressive header tooltips. Modern browsers use a non-disruptive
// popover="hint" tethered with CSS anchor positioning; the same interaction
// falls back to fixed coordinates while keeping native title text for no-JS.

const EDGE_GAP = 8;

export function computeTooltipFallback(anchorRect, tooltipSize, viewport) {
  const width = Math.max(0, Number(tooltipSize?.width) || 0);
  const height = Math.max(0, Number(tooltipSize?.height) || 0);
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const center = (Number(anchorRect?.left) + Number(anchorRect?.right)) / 2;
  const left = Math.min(
    Math.max(EDGE_GAP, center - width / 2),
    Math.max(EDGE_GAP, viewportWidth - width - EDGE_GAP),
  );
  const below = Number(anchorRect?.bottom) + EDGE_GAP;
  const above = Number(anchorRect?.top) - height - EDGE_GAP;
  const top = below + height <= viewportHeight - EDGE_GAP ? below : Math.max(EDGE_GAP, above);
  return { left, top };
}

export function initHeaderTooltips() {
  const tooltip = document.getElementById('header-tooltip');
  const buttons = [...document.querySelectorAll('.header-actions .icon-btn[title]')];
  if (!tooltip || !buttons.length || tooltip.dataset.wired) return;
  tooltip.dataset.wired = 'true';

  const supportsPopover = typeof tooltip.showPopover === 'function' && typeof tooltip.hidePopover === 'function';
  const supportsAnchor = globalThis.CSS?.supports?.('anchor-name: --hm-tooltip-anchor')
    && globalThis.CSS?.supports?.('top: anchor(bottom)');
  tooltip.dataset.anchorPositioning = String(Boolean(supportsAnchor));

  let activeButton = null;
  let activeTitle = '';
  let previousDescription = null;
  let showTimer = 0;
  let hideTimer = 0;
  // WCAG 2.2 SC 1.4.13 wants hover content dismissible without moving the
  // pointer or the focus. Escape hides it, and it stays hidden for that control
  // until the pointer leaves and comes back, or a tooltip the reader has just
  // dismissed reappears under a stationary cursor.
  let dismissedButton = null;

  function cancelTimer() {
    clearTimeout(showTimer);
    showTimer = 0;
  }

  // The same rule asks that the pointer be able to move onto the content
  // without it vanishing. Leaving the button starts a short grace period that
  // entering the tooltip cancels.
  function cancelHide() {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function scheduleHide(delay = 140) {
    cancelHide();
    hideTimer = setTimeout(hideTooltip, delay);
  }

  function cleanupActive() {
    if (!activeButton) return;
    activeButton.classList.remove('hm-tooltip-anchor');
    if (activeTitle) activeButton.title = activeTitle;
    if (previousDescription == null) activeButton.removeAttribute('aria-describedby');
    else activeButton.setAttribute('aria-describedby', previousDescription);
    activeButton = null;
    activeTitle = '';
    previousDescription = null;
    tooltip.removeAttribute('data-fallback-open');
    tooltip.style.removeProperty('left');
    tooltip.style.removeProperty('top');
  }

  function hideTooltip() {
    cancelTimer();
    cancelHide();
    if (supportsPopover) {
      try {
        if (tooltip.matches(':popover-open')) tooltip.hidePopover();
      } catch { /* a partially implemented popover API falls through */ }
    }
    cleanupActive();
  }

  function openTooltip(button) {
    cancelTimer();
    if (!button?.isConnected || button.offsetParent === null) return;
    const title = button.getAttribute('title')?.trim();
    if (!title) return;
    hideTooltip();
    activeButton = button;
    activeTitle = title;
    previousDescription = button.getAttribute('aria-describedby');
    button.removeAttribute('title');
    button.setAttribute('aria-describedby', tooltip.id);
    button.classList.add('hm-tooltip-anchor');
    tooltip.textContent = title;

    let opened = false;
    if (supportsPopover) {
      try {
        tooltip.showPopover();
        opened = true;
      } catch { /* use the fixed-position fallback */ }
    }
    if (!opened) tooltip.setAttribute('data-fallback-open', '');

    if (!supportsAnchor) {
      const anchorRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const position = computeTooltipFallback(anchorRect, tooltipRect, { width: innerWidth, height: innerHeight });
      tooltip.style.left = `${position.left}px`;
      tooltip.style.top = `${position.top}px`;
    }
  }

  function scheduleTooltip(button, delay = 320) {
    cancelTimer();
    showTimer = setTimeout(() => openTooltip(button), delay);
  }

  for (const button of buttons) {
    button.addEventListener('pointerenter', () => {
      cancelHide();
      if (dismissedButton === button) return;
      scheduleTooltip(button);
    });
    button.addEventListener('pointerleave', () => {
      cancelTimer();
      // Leaving the control is what clears a dismissal: coming back is a fresh
      // request for the tooltip.
      if (dismissedButton === button) dismissedButton = null;
      if (document.activeElement !== button || !button.matches(':focus-visible')) scheduleHide();
    });
    button.addEventListener('focus', () => {
      if (dismissedButton === button) return;
      if (button.matches(':focus-visible')) scheduleTooltip(button, 0);
    });
    button.addEventListener('blur', () => {
      if (dismissedButton === button) dismissedButton = null;
      hideTooltip();
    });
    button.addEventListener('click', hideTooltip);
  }

  tooltip.addEventListener('pointerenter', cancelHide);
  tooltip.addEventListener('pointerleave', () => scheduleHide());

  // Capture, so the tooltip is dismissed before anything else acts on Escape,
  // and the event is stopped only when there was in fact a tooltip to dismiss.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!activeButton && !showTimer) return;
    dismissedButton = activeButton;
    hideTooltip();
    if (dismissedButton) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);

  tooltip.addEventListener('toggle', event => {
    if (event.newState === 'closed') cleanupActive();
  });
  window.addEventListener('resize', hideTooltip, { passive: true });
  document.addEventListener('scroll', hideTooltip, { capture: true, passive: true });
}
