// First-run coachmark tour. Targets the four most important UI affordances
// so a returning visitor knows what to look for. Persists "seen" state
// in localStorage via settings.js.

import { getSetting, setSetting } from './settings.js';
import { t } from './i18n.js';

function getSteps() {
  return [
    {
      target: '.app-header',
      title: t('onboarding.welcome'),
      body: t('onboarding.welcomeBody'),
      placement: 'bottom',
    },
    {
      target: '#filters',
      mobileTarget: '#toggle-filters',
      title: t('onboarding.filters'),
      mobileTitle: t('onboarding.filters'),
      body: t('onboarding.filtersBody'),
      mobileBody: t('onboarding.filtersBody'),
      placement: 'right',
      mobilePlacement: 'bottom',
    },
    {
      target: '#toggle-stats',
      title: t('onboarding.stats'),
      body: t('onboarding.statsBody'),
      placement: 'bottom',
    },
    {
      target: '#toggle-info',
      title: t('onboarding.about'),
      body: t('onboarding.aboutBody'),
      placement: 'bottom',
    },
  ];
}

export function maybeStartOnboarding({ force = false } = {}) {
  if (!force && getSetting('onboarded')) return;
  // Defer one frame so the DOM is laid out and getBoundingClientRect is real.
  requestAnimationFrame(() => start());
}

function start() {
  const STEPS = getSteps();
  let idx = 0;
  let finished = false;
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'onb-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'onb-title-id');
  overlay.setAttribute('aria-describedby', 'onb-body-id');
  overlay.innerHTML = `
    <div class="onb-spotlight" aria-hidden="true"></div>
    <div class="onb-card glass" role="document">
      <div class="onb-step" aria-live="polite"></div>
      <h3 class="onb-title" id="onb-title-id"></h3>
      <p class="onb-body" id="onb-body-id"></p>
      <div class="onb-actions">
        <button class="onb-skip text-btn" type="button">${t('onboarding.skip')}</button>
        <div class="onb-nav">
          <button class="onb-prev text-btn" type="button">${t('onboarding.back')}</button>
          <button class="onb-next action-btn primary" type="button">${t('onboarding.next')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('onb-active');

  const spotlight = overlay.querySelector('.onb-spotlight');
  const card = overlay.querySelector('.onb-card');
  const titleEl = overlay.querySelector('.onb-title');
  const bodyEl = overlay.querySelector('.onb-body');
  const stepEl = overlay.querySelector('.onb-step');
  const nextBtn = overlay.querySelector('.onb-next');
  const prevBtn = overlay.querySelector('.onb-prev');
  const skipBtn = overlay.querySelector('.onb-skip');

  function resolveStep(step) {
    const narrow = window.innerWidth <= 720;
    return {
      ...step,
      target: narrow && step.mobileTarget ? step.mobileTarget : step.target,
      title: narrow && step.mobileTitle ? step.mobileTitle : step.title,
      body: narrow && step.mobileBody ? step.mobileBody : step.body,
      placement: narrow && step.mobilePlacement ? step.mobilePlacement : step.placement,
    };
  }

  function place() {
    const step = resolveStep(STEPS[idx]);
    const target = document.querySelector(step.target);
    if (!target) {
      // Hide spotlight, center the card.
      spotlight.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
    } else {
      const r = target.getBoundingClientRect();
      const pad = 8;
      spotlight.style.display = '';
      spotlight.style.left = `${r.left - pad}px`;
      spotlight.style.top = `${r.top - pad}px`;
      spotlight.style.width = `${r.width + pad * 2}px`;
      spotlight.style.height = `${r.height + pad * 2}px`;
      // Position card relative to spotlight.
      const cardW = Math.min(340, window.innerWidth - 32);
      let cx = r.left + r.width / 2 - cardW / 2;
      let cy = step.placement === 'right' && window.innerWidth > 760
        ? r.top
        : r.bottom + 16;
      if (step.placement === 'right' && window.innerWidth > 760) {
        cx = r.right + 16;
      }
      const winH = window.innerHeight;
      if (cy + 200 > winH - 16) cy = Math.max(16, r.top - 220);
      cx = Math.max(16, Math.min(window.innerWidth - cardW - 16, cx));
      card.style.left = `${cx}px`;
      card.style.top = `${cy}px`;
      card.style.transform = '';
    }
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    stepEl.textContent = t('onboarding.step', idx + 1, STEPS.length);
    prevBtn.disabled = idx === 0;
    nextBtn.textContent = t(idx === STEPS.length - 1 ? 'onboarding.done' : 'onboarding.next');
  }

  function finish() {
    if (finished) return;
    finished = true;
    setSetting('onboarded', true);
    overlay.classList.add('fade-out');
    document.body.classList.remove('onb-active');
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', trapFocus);
    setTimeout(() => {
      overlay.remove();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus({ preventScroll: true });
      }
    }, 220);
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const focusable = [...overlay.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  nextBtn.addEventListener('click', () => {
    if (idx < STEPS.length - 1) { idx++; place(); }
    else finish();
  });
  prevBtn.addEventListener('click', () => { if (idx > 0) { idx--; place(); } });
  skipBtn.addEventListener('click', finish);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
  document.addEventListener('keydown', function escHandler(e) {
    if (!document.body.contains(overlay)) {
      document.removeEventListener('keydown', escHandler);
      return;
    }
    if (e.key === 'Escape') finish();
    else if (e.key === 'ArrowRight') nextBtn.click();
    else if (e.key === 'ArrowLeft') prevBtn.click();
  });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', trapFocus);
  place();
  nextBtn.focus({ preventScroll: true });
}
