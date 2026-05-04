// First-run coachmark tour. Targets the four most important UI affordances
// so a returning visitor knows what to look for. Persists "seen" state
// in localStorage via settings.js.

import { getSetting, setSetting } from './settings.js';

const STEPS = [
  {
    target: '.app-header',
    title: 'Welcome to HurricaneMap',
    body: '174 years of U.S. hurricane and tropical-storm landfalls — every dot is a real recorded event from NOAA HURDAT2.',
    placement: 'bottom',
  },
  {
    target: '#filters',
    title: 'Filter the catalog',
    body: 'Narrow by year, Saffir-Simpson category, U.S. state, or search a storm by name (Katrina, Helene, Andrew…).',
    placement: 'right',
  },
  {
    target: '#toggle-stats',
    title: 'Open the statistics panel',
    body: 'Decadal trends, top-10 lists, ACE totals, and rapid-intensification counts across the entire dataset.',
    placement: 'bottom',
  },
  {
    target: '#toggle-info',
    title: 'About the data',
    body: 'Methodology, coverage gaps, and the radar archive for every storm since 1995. Dive in when you have questions.',
    placement: 'bottom',
  },
];

export function maybeStartOnboarding({ force = false } = {}) {
  if (!force && getSetting('onboarded')) return;
  // Defer one frame so the DOM is laid out and getBoundingClientRect is real.
  requestAnimationFrame(() => start());
}

function start() {
  let idx = 0;
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
        <button class="onb-skip text-btn" type="button">Skip tour</button>
        <div class="onb-nav">
          <button class="onb-prev text-btn" type="button">Back</button>
          <button class="onb-next action-btn primary" type="button">Next</button>
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

  function place() {
    const step = STEPS[idx];
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
      const cardW = 320;
      let cx = r.left + r.width / 2 - cardW / 2;
      let cy = r.bottom + 16;
      const winH = window.innerHeight;
      if (cy + 200 > winH - 16) cy = Math.max(16, r.top - 220);
      cx = Math.max(16, Math.min(window.innerWidth - cardW - 16, cx));
      card.style.left = `${cx}px`;
      card.style.top = `${cy}px`;
      card.style.transform = '';
    }
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    stepEl.textContent = `${idx + 1} of ${STEPS.length}`;
    prevBtn.disabled = idx === 0;
    nextBtn.textContent = idx === STEPS.length - 1 ? 'Got it' : 'Next';
  }

  function finish() {
    setSetting('onboarded', true);
    overlay.classList.add('fade-out');
    document.body.classList.remove('onb-active');
    setTimeout(() => overlay.remove(), 220);
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
  place();
}
