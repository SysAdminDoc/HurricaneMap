// Historical NEXRAD composite radar overlay for hurricane landfalls.
//
// Source: Iowa Environmental Mesonet (IEM) NEXRAD mosaic archive.
//   https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/
//
// Coverage:
//   uscomp (CONUS)        — n0r — Aug 1995 onward, 5-min cadence from Aug 2003
//   hicomp (Hawaii)       — n0q — limited; per-storm verification at fetch time
//   prcomp (Puerto Rico)  — n0q — limited; per-storm verification at fetch time
//
// Geographic bounds (precomputed from each region's world file + image size):
//   uscomp: 6000 x 2600 px @ 0.01°  -> [[24, -126], [50, -66]]
//   hicomp: 2000 x 1800 px @ 0.005° -> [[15.44, -162.4], [24.44, -152.4]]
//   prcomp: 1000 x 1000 px @ 0.01°  -> [[13.1, -71.07], [23.1, -61.07]]
//
// The PNGs are indexed-palette with black background for "no echo". We render
// them through `mix-blend-mode: lighten` so only the colored reflectivity
// shows through on the dark basemap.

import { formatTime } from './data.js';

const IEM_ROOT = 'https://mesonet.agron.iastate.edu/archive/data';

const REGIONS = {
  uscomp: {
    bounds: [[24, -126], [50, -66]],
    product: 'n0r',
    earliestYear: 1995,
  },
  hicomp: {
    bounds: [[15.44, -162.4], [24.44, -152.4]],
    product: 'n0q',
    earliestYear: 2010,
  },
  prcomp: {
    bounds: [[13.1, -71.07], [23.1, -61.07]],
    product: 'n0q',
    earliestYear: 2010,
  },
};

/** Pick the right regional composite for a landfall. */
function regionFor(landfall) {
  if (landfall.state === 'Hawaii') return 'hicomp';
  if (landfall.state === 'Puerto Rico') return 'prcomp';
  return 'uscomp';
}

/** Round a Date down to the nearest N-minute boundary. */
function roundToMinutes(date, mins) {
  const ms = date.getTime();
  const stepMs = mins * 60 * 1000;
  return new Date(Math.floor(ms / stepMs) * stepMs);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function buildUrl(region, date) {
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const HH = pad2(date.getUTCHours());
  const MI = pad2(date.getUTCMinutes());
  const stamp = `${yyyy}${mm}${dd}${HH}${MI}`;
  const product = REGIONS[region].product;
  return `${IEM_ROOT}/${yyyy}/${mm}/${dd}/GIS/${region}/${product}_${stamp}.png`;
}

/** HEAD-probe the IEM archive for the closest available frame to the target time.
 *  Walks back in 5-min steps up to maxMinutes. Returns { url, date } or null. */
async function findNearestFrame(region, targetDate, maxMinutes = 60) {
  // Try the rounded 5-min frame first.
  let probe = roundToMinutes(targetDate, 5);
  for (let stepMin = 0; stepMin <= maxMinutes; stepMin += 5) {
    const url = buildUrl(region, probe);
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return { url, date: probe };
    } catch (_) { /* CORS / network — try next */ }
    probe = new Date(probe.getTime() - 5 * 60 * 1000);
  }
  // Hourly fallback for 1995-2002 archive.
  probe = roundToMinutes(targetDate, 60);
  for (let stepHr = 0; stepHr <= 3; stepHr++) {
    const url = buildUrl(region, probe);
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok) return { url, date: probe };
    } catch (_) { /* keep trying */ }
    probe = new Date(probe.getTime() - 60 * 60 * 1000);
  }
  return null;
}

export class RadarOverlay {
  constructor(map) {
    this.map = map;
    this.overlay = null;
    this.controls = null;
    this.region = null;
    this.currentDate = null;
    this.landfall = null;
    this.animTimer = null;
  }

  available(landfall) {
    const r = REGIONS[regionFor(landfall)];
    return landfall.year >= r.earliestYear;
  }

  async show(landfall) {
    this.stopAnimation();
    this.landfall = landfall;
    this.region = regionFor(landfall);
    const target = new Date(landfall.t);
    this.buildControls(landfall);
    this.setStatus('Locating nearest radar frame…');
    const found = await findNearestFrame(this.region, target);
    if (!found) {
      this.setStatus('No archived radar found within ±1 hour of landfall.');
      return;
    }
    this.currentDate = found.date;
    this.draw(found.url);
    this.setStatus(this.timestampLabel());

    // Center the map on the landfall so the radar return is visible.
    this.map.setView([landfall.lat, landfall.lon], Math.max(this.map.getZoom(), 7), { animate: true });
  }

  draw(url) {
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
    const { bounds } = REGIONS[this.region];
    this.overlay = L.imageOverlay(url, bounds, {
      opacity: 1.0,
      className: 'radar-overlay-img',
      interactive: false,
    }).addTo(this.map);
  }

  timestampLabel() {
    return formatTime(this.currentDate.toISOString());
  }

  buildControls(landfall) {
    let el = document.getElementById('radar-controls');
    if (!el) {
      el = document.createElement('div');
      el.id = 'radar-controls';
      el.className = 'radar-controls glass';
      document.body.appendChild(el);
    }
    el.hidden = false;
    el.innerHTML = `
      <div class="radar-title">
        <span class="radar-pip"></span>
        NEXRAD radar — ${escapeHtml(landfall.state)} landfall
      </div>
      <div class="radar-controls-row">
        <button class="radar-btn" data-act="prev" title="−5 min">◀</button>
        <span class="radar-time" id="radar-time">…</span>
        <button class="radar-btn" data-act="next" title="+5 min">▶</button>
        <button class="radar-btn" data-act="loop" title="Animate ±30 min around landfall">▶▶</button>
        <button class="radar-btn radar-close" data-act="close" title="Close radar">×</button>
      </div>
      <div class="radar-source">Source: Iowa State IEM NEXRAD archive</div>
    `;
    this.controls = el;
    el.querySelector('[data-act="prev"]').addEventListener('click', () => this.step(-5));
    el.querySelector('[data-act="next"]').addEventListener('click', () => this.step(5));
    el.querySelector('[data-act="loop"]').addEventListener('click', () => this.toggleLoop());
    el.querySelector('[data-act="close"]').addEventListener('click', () => this.close());
  }

  setStatus(text) {
    const el = document.getElementById('radar-time');
    if (el) el.textContent = text;
  }

  async step(deltaMinutes) {
    this.stopAnimation();
    if (!this.currentDate) return;
    const next = new Date(this.currentDate.getTime() + deltaMinutes * 60 * 1000);
    const url = buildUrl(this.region, next);
    this.setStatus('Loading…');
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (!r.ok) {
        this.setStatus(`No frame at ${formatTime(next.toISOString())}`);
        return;
      }
    } catch (_) {
      this.setStatus(`Failed to load ${formatTime(next.toISOString())}`);
      return;
    }
    this.currentDate = next;
    this.draw(url);
    this.setStatus(this.timestampLabel());
  }

  async toggleLoop() {
    const btn = this.controls?.querySelector('[data-act="loop"]');
    if (this.animTimer) {
      this.stopAnimation();
      if (btn) btn.textContent = '▶▶';
      return;
    }
    if (btn) btn.textContent = '⏸';
    // Pre-flight: probe ±30 min around landfall in 5-min steps and only keep
    // frames that exist. Keeps the animation smooth even when some are missing.
    const t0 = new Date(this.landfall.t);
    const start = new Date(t0.getTime() - 30 * 60 * 1000);
    const frames = [];
    this.setStatus('Building loop (probing frames)…');
    for (let m = 0; m <= 60; m += 5) {
      const d = new Date(start.getTime() + m * 60 * 1000);
      const u = buildUrl(this.region, roundToMinutes(d, 5));
      try {
        const r = await fetch(u, { method: 'HEAD' });
        if (r.ok) frames.push({ url: u, date: roundToMinutes(d, 5) });
      } catch (_) { /* skip */ }
    }
    if (!frames.length) {
      this.setStatus('No frames available for loop.');
      if (btn) btn.textContent = '▶▶';
      return;
    }
    let idx = 0;
    const tick = () => {
      const f = frames[idx];
      this.currentDate = f.date;
      this.draw(f.url);
      this.setStatus(`${this.timestampLabel()} (${idx + 1}/${frames.length})`);
      idx = (idx + 1) % frames.length;
    };
    tick();
    this.animTimer = setInterval(tick, 600);
  }

  stopAnimation() {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    const btn = this.controls?.querySelector('[data-act="loop"]');
    if (btn) btn.textContent = '▶▶';
  }

  close() {
    this.stopAnimation();
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
    if (this.controls) this.controls.hidden = true;
    this.landfall = null;
    this.currentDate = null;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
