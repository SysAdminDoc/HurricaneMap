// 174-year timeline ribbon along the bottom of the viewport.
//
// One vertical bar per dataset year. Bar height = number of landfall
// events that year, color = darkest category that year. Click sets the
// year filter to that single year. Drag a range to set yearMin/yearMax.
// Collapsible — saves real estate when not in use.

import { t } from './i18n.js';

let host = null;
let onChange = null;
let collapsed = false;
let lastVisible = []; // memoize so we don't repaint on identical state

let Y0 = 1851;
let Y1 = 2025;
let selectedMin = Y0;
let selectedMax = Y1;

function catTier(cat) {
  // Return a "intensity rank" 0..6 for color escalation.
  if (cat === 5) return 6;
  if (cat === 4) return 5;
  if (cat === 3) return 4;
  if (cat === 2) return 3;
  if (cat === 1) return 2;
  return 1;
}

function tierColor(t) {
  // Intentionally CSS-var-driven so the colorblind palette swap propagates.
  if (t >= 6) return 'var(--cat-5)';
  if (t === 5) return 'var(--cat-4)';
  if (t === 4) return 'var(--cat-3)';
  if (t === 3) return 'var(--cat-2)';
  if (t === 2) return 'var(--cat-1)';
  return 'var(--cat-ts)';
}

export function mountTimeline(landfalls, callbacks) {
  const requestedMin = Number(callbacks?.yearMin);
  const requestedMax = Number(callbacks?.yearMax);
  if (Number.isFinite(requestedMin) && Number.isFinite(requestedMax)) {
    Y0 = Math.min(requestedMin, requestedMax);
    Y1 = Math.max(requestedMin, requestedMax);
  }
  selectedMin = Y0;
  selectedMax = Y1;
  onChange = callbacks?.onYearRangeChange || (() => {});
  host = document.createElement('section');
  host.className = 'timeline-ribbon glass';
  host.id = 'timeline';
  host.innerHTML = `
    <button class="timeline-toggle icon-btn" id="timeline-toggle" title="${t('timeline.collapse')}" aria-label="${t('timeline.collapse')}" aria-expanded="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>
    </button>
    <div class="timeline-inner">
      <div class="timeline-head">
        <strong data-i18n="timeline.title">${t('timeline.title')}</strong>
        <span class="timeline-selection-label" id="timeline-selection-label">${Y0}–${Y1}</span>
        <span class="timeline-source" data-i18n="timeline.source">${t('timeline.source')}</span>
      </div>
      <div class="timeline-axis" id="timeline-axis" role="slider" aria-label="Year range" aria-valuemin="${Y0}" aria-valuemax="${Y1}" aria-valuenow="${Y0}" aria-valuetext="${Y0} to ${Y1}" tabindex="0"></div>
      <div class="timeline-footer">
        <div class="timeline-labels">
          <span>${Y0}</span><span>1900</span><span>1950</span><span>2000</span><span>${Y1}</span>
        </div>
        <div class="timeline-legend" aria-label="${t('timeline.legend')}" data-i18n-aria-label="timeline.legend">
          <span class="timeline-legend-item"><i style="--legend-color:var(--cat-ts)"></i><span data-i18n="timeline.ts">${t('timeline.ts')}</span></span>
          ${[1, 2, 3, 4, 5].map(cat => `<span class="timeline-legend-item"><i style="--legend-color:var(--cat-${cat})"></i><span>${t('timeline.cat', cat)}</span></span>`).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  document.body.classList.toggle('timeline-collapsed', collapsed);

  const toggle = host.querySelector('#timeline-toggle');
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    host.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('timeline-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const label = t(collapsed ? 'timeline.expand' : 'timeline.collapse');
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
  });

  redraw(landfalls);
  attachDragInteraction();
}

function attachDragInteraction() {
  const axis = host.querySelector('#timeline-axis');
  let pointerState = null;

  function yearAt(clientX) {
    const r = axis.getBoundingClientRect();
    if (!r.width) return Y0;
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(Y0 + pct * (Y1 - Y0));
  }

  function eventYearTarget(target) {
    if (!(target instanceof Element)) return null;
    const bar = target.closest('.tl-bar');
    if (!bar || !axis.contains(bar)) return null;
    const year = Number.parseInt(bar.dataset.year || '', 10);
    return Number.isFinite(year) ? year : null;
  }

  axis.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.isPrimary === false) return;
    const year = yearAt(e.clientX);
    pointerState = {
      id: e.pointerId,
      startX: e.clientX,
      startYear: year,
      currentYear: year,
      targetYear: eventYearTarget(e.target),
      moved: false,
      // Snapshot before drawSelection() mutates selectedMin/Max — this is
      // what pointercancel must restore.
      prevMin: selectedMin,
      prevMax: selectedMax,
    };
    axis.classList.add('dragging');
    try { axis.setPointerCapture(e.pointerId); } catch (_) {}
    drawSelection(year, year);
    e.preventDefault();
  });

  axis.addEventListener('pointermove', (e) => {
    if (!pointerState || e.pointerId !== pointerState.id) return;
    pointerState.currentYear = yearAt(e.clientX);
    if (Math.abs(e.clientX - pointerState.startX) > 6) pointerState.moved = true;
    if (pointerState.moved) drawSelection(pointerState.startYear, pointerState.currentYear);
  });

  axis.addEventListener('pointerup', (e) => {
    if (!pointerState || e.pointerId !== pointerState.id) return;
    const state = pointerState;
    pointerState = null;
    axis.classList.remove('dragging');
    try { axis.releasePointerCapture(e.pointerId); } catch (_) {}

    if (!state.moved) {
      const y = state.targetYear ?? yearAt(e.clientX);
      drawSelection(y, y);
      onChange({ yearMin: y, yearMax: y });
      return;
    }

    const a = Math.min(state.startYear, state.currentYear);
    const b = Math.max(state.startYear, state.currentYear);
    drawSelection(a, b);
    onChange({ yearMin: a, yearMax: b });
  });

  axis.addEventListener('pointercancel', (e) => {
    if (!pointerState || e.pointerId !== pointerState.id) return;
    const state = pointerState;
    pointerState = null;
    axis.classList.remove('dragging');
    // Restore the pre-gesture selection (drawSelection already overwrote
    // selectedMin/Max at pointerdown); the filters never changed, so the
    // ribbon must not show the collapsed single-year tap.
    drawSelection(state.prevMin, state.prevMax);
  });

  axis.addEventListener('dblclick', (e) => {
    // Double-click resets to the full metadata-defined range.
    e.stopPropagation();
    onChange({ yearMin: Y0, yearMax: Y1 });
  });

  axis.addEventListener('keydown', (e) => {
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (delta) {
      e.preventDefault();
      const y = Math.max(Y0, Math.min(Y1, selectedMax + delta));
      onChange({ yearMin: y, yearMax: y });
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange({ yearMin: Y0, yearMax: Y0 });
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange({ yearMin: Y1, yearMax: Y1 });
    } else if (e.key === 'Escape') {
      onChange({ yearMin: Y0, yearMax: Y1 });
    }
  });
}

function drawSelection(a, b) {
  const axis = host.querySelector('#timeline-axis');
  const clamp = value => Math.max(Y0, Math.min(Y1, Number(value)));
  const lo = clamp(Math.min(a, b));
  const hi = clamp(Math.max(a, b));
  selectedMin = lo;
  selectedMax = hi;
  let sel = axis.querySelector('.tl-selection');
  if (!sel) {
    sel = document.createElement('div');
    sel.className = 'tl-selection';
    axis.appendChild(sel);
  }
  const left = ((lo - Y0) / (Y1 - Y0)) * 100;
  const right = ((hi - Y0) / (Y1 - Y0)) * 100;
  sel.style.left = `${left}%`;
  sel.style.width = `${Math.max(0.3, right - left)}%`;
  // Keep ARIA slider state honest for AT.
  axis.setAttribute('aria-valuenow', String(lo));
  axis.setAttribute('aria-valuetext', `${lo} to ${hi}`);
  const selectionLabel = host.querySelector('#timeline-selection-label');
  if (selectionLabel) selectionLabel.textContent = lo === hi ? String(lo) : `${lo}–${hi}`;
}

export function redraw(landfalls) {
  if (!host) return;
  // Group landfalls by year — value = { count, peakTier }
  const byYear = new Map();
  for (const lf of landfalls) {
    const y = lf.year;
    if (y < Y0 || y > Y1) continue;
    const cur = byYear.get(y) || { count: 0, tier: 0 };
    cur.count += 1;
    cur.tier = Math.max(cur.tier, catTier(lf.category));
    byYear.set(y, cur);
  }
  let maxCount = 1;
  for (const v of byYear.values()) maxCount = Math.max(maxCount, v.count);

  const axis = host.querySelector('#timeline-axis');
  axis.innerHTML = '';
  for (let y = Y0; y <= Y1; y++) {
    const v = byYear.get(y);
    // Presentational: pointer/keyboard interaction lives on the axis, which
    // exposes role="slider" — nested interactive children fail WCAG 4.1.2.
    const bar = document.createElement('div');
    bar.className = 'tl-bar';
    bar.dataset.year = y;
    bar.title = v ? `${y} — ${v.count} landfall${v.count > 1 ? 's' : ''}` : `${y} — none`;
    bar.setAttribute('aria-hidden', 'true');
    if (v) {
      const h = Math.max(8, (v.count / maxCount) * 100);
      bar.style.height = `${h}%`;
      bar.style.background = tierColor(v.tier);
    } else {
      bar.style.height = '4%';
      bar.classList.add('tl-empty');
    }
    axis.appendChild(bar);
  }
}

export function highlightYearRange(yearMin, yearMax) {
  if (!host) return;
  const axis = host.querySelector('#timeline-axis');
  if (!axis) return;
  drawSelection(yearMin, yearMax);
}
