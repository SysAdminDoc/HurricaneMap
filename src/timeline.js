// 174-year timeline ribbon along the bottom of the viewport.
//
// One vertical bar per year (1851-2025). Bar height = number of landfall
// events that year, color = darkest category that year. Click sets the
// year filter to that single year. Drag a range to set yearMin/yearMax.
// Collapsible — saves real estate when not in use.

let host = null;
let onChange = null;
let collapsed = false;
let lastVisible = []; // memoize so we don't repaint on identical state

const Y0 = 1851;
const Y1 = 2025;

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
  onChange = callbacks?.onYearRangeChange || (() => {});
  host = document.createElement('section');
  host.className = 'timeline-ribbon glass';
  host.id = 'timeline';
  host.innerHTML = `
    <button class="timeline-toggle icon-btn" id="timeline-toggle" title="Collapse timeline" aria-label="Collapse timeline" aria-expanded="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>
    </button>
    <div class="timeline-inner">
      <div class="timeline-axis" id="timeline-axis" role="slider" aria-label="Year range" aria-valuemin="${Y0}" aria-valuemax="${Y1}" aria-valuenow="${Y0}" aria-valuetext="${Y0} to ${Y1}" tabindex="0"></div>
      <div class="timeline-labels">
        <span>${Y0}</span><span>1900</span><span>1950</span><span>2000</span><span>${Y1}</span>
      </div>
    </div>
  `;
  document.body.appendChild(host);

  const toggle = host.querySelector('#timeline-toggle');
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    host.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Expand timeline' : 'Collapse timeline';
  });

  redraw(landfalls);
  attachDragInteraction();
}

function attachDragInteraction() {
  const axis = host.querySelector('#timeline-axis');
  let dragStart = null;
  let dragEnd = null;
  function yearAt(clientX) {
    const r = axis.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(Y0 + pct * (Y1 - Y0));
  }
  axis.addEventListener('mousedown', (e) => {
    dragStart = yearAt(e.clientX);
    dragEnd = dragStart;
    axis.classList.add('dragging');
    drawSelection(dragStart, dragEnd);
  });
  axis.addEventListener('dblclick', (e) => {
    // Double-click resets to full range (1851-2025)
    e.stopPropagation();
    onChange({ yearMin: Y0, yearMax: Y1 });
  });
  window.addEventListener('mousemove', (e) => {
    if (dragStart == null) return;
    dragEnd = yearAt(e.clientX);
    drawSelection(dragStart, dragEnd);
  });
  window.addEventListener('mouseup', () => {
    if (dragStart == null) return;
    const a = Math.min(dragStart, dragEnd);
    const b = Math.max(dragStart, dragEnd);
    dragStart = dragEnd = null;
    axis.classList.remove('dragging');
    onChange({ yearMin: a, yearMax: b });
  });
}

function drawSelection(a, b) {
  const axis = host.querySelector('#timeline-axis');
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
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
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'tl-bar';
    bar.dataset.year = y;
    bar.title = v ? `${y} — ${v.count} landfall${v.count > 1 ? 's' : ''}` : `${y} — none`;
    bar.setAttribute('aria-label', bar.title);
    if (v) {
      const h = Math.max(8, (v.count / maxCount) * 100);
      bar.style.height = `${h}%`;
      bar.style.background = tierColor(v.tier);
    } else {
      bar.style.height = '4%';
      bar.classList.add('tl-empty');
    }
    bar.addEventListener('click', () => {
      onChange({ yearMin: y, yearMax: y });
    });
    axis.appendChild(bar);
  }
}

export function highlightYearRange(yearMin, yearMax) {
  if (!host) return;
  const axis = host.querySelector('#timeline-axis');
  if (!axis) return;
  drawSelection(yearMin, yearMax);
}
