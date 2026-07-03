// Hurricane track animation — opt-in, plays a spinning glyph along the storm's
// 6-hourly track with size that pulses with Saffir-Simpson intensity.
//
// "Size" here is split into two layers:
//   1. The eye/spiral glyph — fixed pixel size by category, follows the path.
//   2. The wind-field disk — geographic circle (km radius) that grows/shrinks
//      with the storm so it looks bigger when zoomed in.
//
// The animation is decoupled from real-storm time — full-track playback always
// runs `BASE_DURATION_MS` wall-clock seconds at 1× speed regardless of whether
// the storm lasted 3 days or 3 weeks.

import { categoryColor, formatTime, windToCategory, categoryLabel } from './data.js';
import { getStormRadarFrames } from './radar.js';
import { formatStormName } from './html-utils.js';

const L = window.L;

const BASE_DURATION_MS = 14000;
const FRAME_INTERPOLATION_STEPS = 4;

const GLYPH_PX = { 0: 38, '-1': 32, 1: 50, 2: 66, 3: 84, 4: 102, 5: 124 };
const WIND_KM = { 0: 90, '-1': 70, 1: 140, 2: 180, 3: 230, 4: 320, 5: 420 };

const HURRICANE_SVG = `
<svg viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>
    <radialGradient id="hg-cloud" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="rgba(255,255,255,0.55)"/>
      <stop offset="35%" stop-color="rgba(255,255,255,0.25)"/>
      <stop offset="75%" stop-color="rgba(255,255,255,0.05)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <circle cx="0" cy="0" r="48" fill="url(#hg-cloud)"/>
  <g class="hg-spin">
    <path d="M 0 -42 C  22 -38,  38 -22,  10 -2"  stroke="white" stroke-width="3.0" stroke-linecap="round" fill="none" opacity="0.92"/>
    <path d="M 0 -42 C  22 -38,  38 -22,  10 -2"  stroke="white" stroke-width="3.0" stroke-linecap="round" fill="none" opacity="0.92" transform="rotate(120)"/>
    <path d="M 0 -42 C  22 -38,  38 -22,  10 -2"  stroke="white" stroke-width="3.0" stroke-linecap="round" fill="none" opacity="0.92" transform="rotate(240)"/>
    <path d="M 0 -28 C  14 -26,  26 -14,   8  0"  stroke="white" stroke-width="2.0" stroke-linecap="round" fill="none" opacity="0.65"/>
    <path d="M 0 -28 C  14 -26,  26 -14,   8  0"  stroke="white" stroke-width="2.0" stroke-linecap="round" fill="none" opacity="0.65" transform="rotate(120)"/>
    <path d="M 0 -28 C  14 -26,  26 -14,   8  0"  stroke="white" stroke-width="2.0" stroke-linecap="round" fill="none" opacity="0.65" transform="rotate(240)"/>
  </g>
  <circle cx="0" cy="0" r="6" fill="none" stroke="white" stroke-width="1.6" opacity="0.95"/>
  <circle cx="0" cy="0" r="3" fill="rgba(15,15,25,0.85)"/>
</svg>`;

export class TrackAnimator {
  constructor(map) {
    this.map = map;
    this.marker = null;
    this.windCircle = null;
    this.controls = null;
    this.rafId = null;
    this.elapsed = 0;
    this.duration = BASE_DURATION_MS;
    this.speed = 1;
    this.paused = false;
    this.lastTickAt = 0;
    this.densifiedTrack = null;
    this.storm = null;
    this.endCallback = null;
    this.radarLayer = null;       // L.imageOverlay swapped in lockstep with sim UTC
    this.radarFrames = null;      // sorted [{ts, date, url, region}, ...] or null
    this.radarBounds = null;
    this.radarEnabled = true;     // toggled via checkbox in controls
    this.lastRadarUrl = null;
    this.controlsHost = null;
    this.stateCallback = null;
  }

  isPlaying() {
    return !!this.rafId && !this.paused;
  }

  isActive() {
    return !!this.marker && !!this.storm;
  }

  isActiveFor(stormId) {
    return this.isActive() && this.storm?.id === stormId;
  }

  hasEnded() {
    return this.isActive() && !this.rafId && this.elapsed >= this.duration;
  }

  getPlaybackState() {
    return {
      active: this.isActive(),
      playing: this.isPlaying(),
      paused: this.isActive() && this.paused,
      ended: this.hasEnded(),
      stormId: this.storm?.id || null,
    };
  }

  emitState() {
    if (this.stateCallback) this.stateCallback(this.getPlaybackState());
  }

  /** Densify the 6-hour track by linear interpolation between adjacent points
   *  so the marker glides instead of teleporting between synoptic times. */
  densify(track) {
    const out = [];
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      for (let k = 0; k < FRAME_INTERPOLATION_STEPS; k++) {
        const f = k / FRAME_INTERPOLATION_STEPS;
        out.push({
          lat: a.lat + (b.lat - a.lat) * f,
          lon: a.lon + (b.lon - a.lon) * f,
          wind: lerpNum(a.wind, b.wind, f),
          pres: lerpNum(a.pres, b.pres, f),
          status: f < 0.5 ? a.status : b.status,
          t: lerpTime(a.t, b.t, f),
        });
      }
    }
    out.push(track[track.length - 1]);
    return out;
  }

  async play(storm, { onEnd, controlsHost, onStateChange } = {}) {
    if (!storm.track?.length) return;
    this.stop({ silent: true });
    this.storm = storm;
    this.densifiedTrack = this.densify(storm.track);
    this.elapsed = 0;
    this.paused = false;
    this.endCallback = onEnd || null;
    this.lastRadarUrl = null;
    this.controlsHost = controlsHost || null;
    this.stateCallback = typeof onStateChange === 'function' ? onStateChange : null;

    const first = this.densifiedTrack[0];
    this.marker = L.marker([first.lat, first.lon], {
      icon: this.buildIcon(GLYPH_PX[0]),
      interactive: false,
      keyboard: false,
      zIndexOffset: 800,
    }).addTo(this.map);

    this.windCircle = L.circle([first.lat, first.lon], {
      radius: 1000,
      color: '#cdd6f4',
      weight: 1,
      opacity: 0.5,
      fillColor: '#cdd6f4',
      fillOpacity: 0.10,
      interactive: false,
    }).addTo(this.map);

    // Pull this storm's local radar frames so we can paint reflectivity into
    // the animation in lockstep with the simulated UTC clock. Returns null if
    // the storm has no offline radar (e.g. pre-1995 storms or post-2025).
    // The animator can be stopped or restarted for another storm while this
    // await is in flight (first manifest.json fetch) — bail if so, or the
    // stale continuation rebuilds controls and overwrites radar frames.
    const radar = await getStormRadarFrames(storm.id);
    if (this.storm !== storm || !this.marker) return;
    if (radar) {
      this.radarFrames = radar.frames;
      this.radarBounds = radar.bounds;
    } else {
      this.radarFrames = null;
      this.radarBounds = null;
    }

    this.buildControls();
    this.lastTickAt = performance.now();
    this.tick();
    this.emitState();
  }

  buildIcon(sizePx) {
    return L.divIcon({
      className: 'hurricane-glyph',
      html: `<div class="hg-inner" style="width:${sizePx}px;height:${sizePx}px;">${HURRICANE_SVG}</div>`,
      iconSize: [sizePx, sizePx],
      iconAnchor: [sizePx / 2, sizePx / 2],
    });
  }

  tick = () => {
    if (!this.marker) return;
    const now = performance.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;
    if (!this.paused) {
      this.elapsed += dt * this.speed;
    }
    const t = Math.min(1, this.elapsed / this.duration);
    const sample = this.sampleAt(t);
    this.updateGlyph(sample);
    this.updateRadar(sample.t);
    this.updateControlsHud(sample, t);
    if (t < 1) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = null;
      this.markEnded();
    }
  };

  /** Sync the radar overlay to the current simulated UTC time. We pick the
   *  most recent local frame whose timestamp is ≤ the simulated time so
   *  the radar lags the glyph by at most one HURDAT2 6-hour interval — the
   *  glyph shows where the eye IS, the radar shows what was last observed.
   *  No-ops when radar is disabled, no local frames exist for this storm,
   *  or the storm is between US-coverage windows. */
  updateRadar(simIso) {
    if (!this.radarEnabled || !this.radarFrames || !this.radarBounds) return;
    const simMs = new Date(simIso).getTime();
    let best = null;
    for (const f of this.radarFrames) {
      if (f.date.getTime() <= simMs) best = f;
      else break;
    }
    if (!best) {
      // Sim time is before the first available frame — clear any stale layer.
      if (this.radarLayer) {
        this.map.removeLayer(this.radarLayer);
        this.radarLayer = null;
        this.lastRadarUrl = null;
      }
      return;
    }
    if (best.url === this.lastRadarUrl) return;
    if (!this.radarLayer) {
      this.radarLayer = L.imageOverlay(best.url, this.radarBounds, {
        opacity: 1.0,
        className: 'radar-overlay-img',
        interactive: false,
      });
      this.radarLayer.addTo(this.map);
    } else {
      this.radarLayer.setUrl(best.url);
    }
    this.lastRadarUrl = best.url;
  }

  sampleAt(t) {
    // Single-point tracks (a handful of 1860s storms) have no segment to
    // interpolate — return the lone fix directly instead of indexing [-1].
    if (this.densifiedTrack.length === 1) return this.densifiedTrack[0];
    const n = this.densifiedTrack.length - 1;
    const idx = t * n;
    const i = Math.max(0, Math.min(n - 1, Math.floor(idx)));
    const f = idx - i;
    const a = this.densifiedTrack[i];
    const b = this.densifiedTrack[i + 1];
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      wind: lerpNum(a.wind, b.wind, f),
      pres: lerpNum(a.pres, b.pres, f),
      status: f < 0.5 ? a.status : b.status,
      t: lerpTime(a.t, b.t, f),
    };
  }

  updateGlyph({ lat, lon, wind, status }) {
    const cat = windToCategory(wind);
    const px = GLYPH_PX[cat];
    const km = WIND_KM[cat];
    const color = categoryColor(cat);

    this.marker.setLatLng([lat, lon]);
    // Recreate the icon when the size bucket changes (avoids inline-style writes
    // on a Leaflet-owned <img>; divIcons are cheap enough to swap).
    if (this.marker._lastSizePx !== px) {
      this.marker.setIcon(this.buildIcon(px));
      this.marker._lastSizePx = px;
    }
    this.windCircle.setLatLng([lat, lon]);
    this.windCircle.setRadius(km * 1000);
    this.windCircle.setStyle({ color, fillColor: color });
  }

  buildControls() {
    const host = this.controlsHost || document.body;
    let el = this.controls;
    if (!el || !host.contains(el)) {
      if (el) el.remove();
      el = document.createElement('div');
      el.className = this.controlsHost ? 'anim-controls anim-controls-inline glass' : 'anim-controls glass';
      host.appendChild(el);
    }
    if (this.controlsHost) this.controlsHost.hidden = false;
    const radarCount = this.radarFrames?.length || 0;
    const radarChip = radarCount
      ? `<label class="anim-radar-toggle" title="Show NEXRAD reflectivity in lockstep with the simulated UTC clock">
            <input type="checkbox" class="anim-radar-cb" ${this.radarEnabled ? 'checked' : ''}>
            radar (${radarCount})
          </label>`
      : '<span class="anim-radar-toggle anim-radar-disabled" title="No archived radar for this storm (pre-1995 or out of coverage)">radar unavailable</span>';
    el.innerHTML = `
      <button class="anim-btn" data-act="toggle" title="Pause playback" aria-label="Pause playback">Pause</button>
      <button class="anim-btn" data-act="restart" title="Restart playback" aria-label="Restart playback">Restart</button>
      <input type="range" min="0" max="1000" value="0" class="anim-scrubber" />
      <select class="anim-speed" title="Playback speed">
        <option value="0.5">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="2">2×</option>
        <option value="4">4×</option>
      </select>
      ${radarChip}
      <div class="anim-hud">
        <div class="anim-title"></div>
        <div class="anim-meta"></div>
      </div>
      <button class="anim-btn anim-close" data-act="close" title="Close animation" aria-label="Close animation">Close</button>
    `;
    el.hidden = false;
    this.controls = el;
    const radarCb = el.querySelector('.anim-radar-cb');
    if (radarCb) {
      radarCb.addEventListener('change', () => {
        this.radarEnabled = radarCb.checked;
        if (!this.radarEnabled && this.radarLayer) {
          this.map.removeLayer(this.radarLayer);
          this.radarLayer = null;
          this.lastRadarUrl = null;
        }
      });
    }

    const titleEl = el.querySelector('.anim-title');
    titleEl.textContent = formatStormTitle(this.storm);

    el.querySelector('[data-act="toggle"]').addEventListener('click', () => this.togglePause());
    el.querySelector('[data-act="restart"]').addEventListener('click', () => this.restart());
    el.querySelector('[data-act="close"]').addEventListener('click', () => this.stop());
    el.querySelector('.anim-speed').addEventListener('change', (e) => {
      this.speed = parseFloat(e.target.value);
    });
    const scrub = el.querySelector('.anim-scrubber');
    scrub.addEventListener('input', (e) => {
      const t = parseInt(e.target.value, 10) / 1000;
      // Scrubbing back after the animation ended (rAF chain stopped) must not
      // leave a zombie "neither playing nor paused" state — land in an
      // explicit pause so the toggle button resumes with a single click.
      if (!this.rafId && !this.paused && this.elapsed >= this.duration) {
        this.paused = true;
        const btn = this.controls?.querySelector('[data-act="toggle"]');
        if (btn) {
          btn.textContent = 'Play';
          btn.title = 'Resume playback';
          btn.setAttribute('aria-label', btn.title);
        }
        this.emitState();
      }
      this.elapsed = t * this.duration;
      // While scrubbing we want the visual to update immediately, even paused.
      const sample = this.sampleAt(t);
      this.updateGlyph(sample);
      this.updateControlsHud(sample, t, /*fromScrub*/ true);
    });
  }

  updateControlsHud(sample, t, fromScrub = false) {
    if (!this.controls) return;
    const cat = windToCategory(sample.wind);
    const wind = sample.wind != null ? Math.round(sample.wind) : null;
    const meta = `${formatTime(sample.t)} · ${categoryLabel(cat)} · ${sample.status} · ${wind ?? '?'} kt`;
    this.controls.querySelector('.anim-meta').textContent = meta;
    if (!fromScrub) {
      this.controls.querySelector('.anim-scrubber').value = String(Math.round(t * 1000));
    }
  }

  togglePause() {
    if (!this.isActive()) return;
    if (this.hasEnded()) {
      this.restart();
      return;
    }
    this.paused = !this.paused;
    const btn = this.controls?.querySelector('[data-act="toggle"]');
    if (btn) {
      btn.textContent = this.paused ? 'Play' : 'Pause';
      btn.title = this.paused ? 'Resume playback' : 'Pause playback';
      btn.setAttribute('aria-label', btn.title);
    }
    if (!this.paused && !this.rafId && this.elapsed < this.duration) {
      this.lastTickAt = performance.now();
      this.tick();
    }
    this.emitState();
  }

  restart() {
    this.elapsed = 0;
    this.paused = false;
    const btn = this.controls?.querySelector('[data-act="toggle"]');
    if (btn) {
      btn.textContent = 'Pause';
      btn.title = 'Pause playback';
      btn.setAttribute('aria-label', btn.title);
    }
    if (!this.rafId) {
      this.lastTickAt = performance.now();
      this.tick();
    }
    this.emitState();
  }

  markEnded() {
    const btn = this.controls?.querySelector('[data-act="toggle"]');
    if (btn) {
      btn.textContent = 'Replay';
      btn.title = 'Replay track animation';
      btn.setAttribute('aria-label', btn.title);
    }
    this.emitState();
    if (this.endCallback) this.endCallback();
  }

  stop({ silent = false } = {}) {
    const callback = this.stateCallback;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.marker) {
      this.map.removeLayer(this.marker);
      this.marker = null;
    }
    if (this.windCircle) {
      this.map.removeLayer(this.windCircle);
      this.windCircle = null;
    }
    if (this.radarLayer) {
      this.map.removeLayer(this.radarLayer);
      this.radarLayer = null;
    }
    if (this.controls) {
      this.controls.hidden = true;
    }
    if (this.controlsHost) {
      this.controlsHost.hidden = true;
    }
    this.densifiedTrack = null;
    this.storm = null;
    this.radarFrames = null;
    this.radarBounds = null;
    this.lastRadarUrl = null;
    this.controlsHost = null;
    this.stateCallback = null;
    this.paused = false;
    this.elapsed = 0;
    if (!silent && callback) {
      callback({ active: false, playing: false, paused: false, ended: false, stormId: null });
    }
  }
}

function lerpNum(a, b, f) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * f;
}

function lerpTime(a, b, f) {
  if (!a || !b) return a || b || '';
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return a || b || '';
  return new Date(ta + (tb - ta) * f).toISOString();
}


function formatStormTitle(storm) {
  return (!storm.name || storm.name === 'UNNAMED')
    ? `${storm.year} unnamed storm`
    : `${formatStormName(storm.name)} (${storm.year})`;
}
