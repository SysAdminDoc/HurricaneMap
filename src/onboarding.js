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

export function isIosSafari() {
  const browser = typeof navigator === 'undefined' ? {} : navigator;
  const userAgent = String(browser.userAgent || '');
  const platform = String(browser.platform || '');
  const iosDevice = /iPad|iPhone|iPod/i.test(userAgent) ||
    /iPad|iPhone|iPod/i.test(platform) ||
    (platform === 'MacIntel' && Number(browser.maxTouchPoints || 0) > 1);
  const safari = /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS|GSA|DuckDuckGo)/i.test(userAgent);
  const standalone = browser.standalone === true ||
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches
    ));
  return iosDevice && safari && !standalone;
}

let iosInstallOverlay = null;

export function showIosInstallCoachmark({ returnFocus = document.activeElement } = {}) {
  if (!isIosSafari() || iosInstallOverlay) return false;

  const previousFocus = returnFocus;
  const overlay = document.createElement('div');
  overlay.className = 'onb-overlay ios-install-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'ios-install-title');
  overlay.setAttribute('aria-describedby', 'ios-install-body ios-install-note');

  const card = document.createElement('div');
  card.className = 'onb-card glass ios-install-card';
  card.setAttribute('role', 'document');

  const title = document.createElement('h2');
  title.className = 'onb-title';
  title.id = 'ios-install-title';
  title.textContent = t('onboarding.iosInstallTitle');

  const body = document.createElement('p');
  body.className = 'onb-body';
  body.id = 'ios-install-body';
  body.textContent = t('onboarding.iosInstallBody');

  const steps = document.createElement('ol');
  steps.className = 'ios-install-steps';
  for (const key of [
    'onboarding.iosInstallStepShare',
    'onboarding.iosInstallStepAdd',
    'onboarding.iosInstallStepOpen',
  ]) {
    const item = document.createElement('li');
    item.textContent = t(key);
    steps.appendChild(item);
  }

  const note = document.createElement('p');
  note.className = 'onb-body ios-install-note';
  note.id = 'ios-install-note';
  note.textContent = t('onboarding.iosInstallNote');

  const actions = document.createElement('div');
  actions.className = 'onb-actions';
  const dismiss = document.createElement('button');
  dismiss.className = 'onb-next action-btn primary ios-install-dismiss';
  dismiss.type = 'button';
  dismiss.textContent = t('onboarding.iosInstallDismiss');
  actions.appendChild(dismiss);

  card.append(title, body, steps, note, actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  iosInstallOverlay = overlay;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add('fade-out');
    document.removeEventListener('keydown', onKeydown);
    window.setTimeout(() => {
      overlay.remove();
      iosInstallOverlay = null;
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
        previousFocus.focus({ preventScroll: true });
      }
    }, 220);
  };
  const onKeydown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    dismiss.focus({ preventScroll: true });
  };
  dismiss.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);
  dismiss.focus({ preventScroll: true });
  return true;
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
