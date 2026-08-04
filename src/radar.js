// Historical NEXRAD composite radar overlay for hurricane landfalls.
//
// Source priority (offline-first):
//   1. Local archive at  data/radar/<file>  if listed in data/radar/manifest.json
//   2. Remote Iowa Environmental Mesonet (IEM) NEXRAD mosaic archive
//      https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/
//
// Local data is scraped via scripts/scrape_radar.py and committed to the repo
// so the tool works fully offline once cloned. The manifest's `frames` map
// keys exact UTC timestamps to local file paths so the stepper / loop / play
// controls can hit local first and only touch IEM as a fallback.
//
// Manifest schema (data/radar/manifest.json):
//   {
//     "<storm_id>": {
//       "name": "KATRINA", "year": 2005, "dir": "Katrina-2005",
//       "region": "uscomp",
//       "landfalls": { "0": "200508251830", "1": "200508291110", ... },
//       "frames":    { "200508241800": "Katrina-2005/t_200508241800.png", ... }
//     }
//   }
//
// Coverage:
//   uscomp (CONUS)        — n0r — Aug 1995 onward, 5-min cadence from Aug 2003;
//                            modern online tiles use the canonical n0q layer
//   hicomp (Hawaii)       — n0q — 2010 onward
//   prcomp (Puerto Rico)  — n0q — 2010 onward
//
// Geographic bounds (precomputed from each region's world file + image size):
//   uscomp: 6000 x 2600 px @ 0.01°  -> [[24, -126], [50, -66]]
//   hicomp: 2000 x 1800 px @ 0.005° -> [[15.44, -162.4], [24.44, -152.4]]
//   prcomp: 1000 x 1000 px @ 0.01°  -> [[13.1, -71.07], [23.1, -61.07]]
//
// The PNGs are indexed-palette with black background for "no echo". We render
// them through `mix-blend-mode: screen` so only the colored reflectivity
// shows through on the dark basemap.

import { formatTime } from './data.js';
import { escapeHtml } from './html-utils.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
} from './optional-feeds.js';
import { cacheRadarPack, isQuotaExceededError } from './storage-manager.js';
import {
  buildIemRadarTileProbeUrl,
  buildIemRadarTileUrl,
  buildRadarProbeTimes,
  isRadarFrameResponseAvailable,
} from './radar-utils.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

// Leaflet is loaded from CDN as a UMD module, available as window.L
const L = window.L;

const LOCAL_ROOT = 'data/radar';
const MANIFEST_URL = 'data/radar/manifest.json';

const REGIONS = {
  uscomp: {
    bounds: [[24, -126], [50, -66]],
    product: 'n0r',
    remoteProduct: 'n0q',
    remoteProductStart: Date.UTC(2010, 10, 13, 16, 25),
    sector: 'uscomp',
    probeTile: { z: 3, x: 2, y: 3 },
    maxNativeZoom: 7,
    earliestYear: 1995,
  },
  hicomp: {
    bounds: [[15.44, -162.4], [24.44, -152.4]],
    product: 'n0q',
    sector: 'hicomp',
    probeTile: { z: 3, x: 0, y: 3 },
    maxNativeZoom: 8,
    earliestYear: 2010,
  },
  prcomp: {
    bounds: [[13.1, -71.07], [23.1, -61.07]],
    product: 'n0q',
    sector: 'prcomp',
    probeTile: { z: 3, x: 2, y: 3 },
    maxNativeZoom: 8,
    earliestYear: 2010,
  },
};

let manifest = null;
let manifestPromise = null;

function loadManifest() {
  if (manifest) return Promise.resolve(manifest);
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetchWithTimeout(MANIFEST_URL, {}, REQUEST_TIMEOUT_MS.data)
    .then(r => r.ok ? r.json() : {})
    .catch(() => ({}))
    .then(m => { manifest = m; return m; });
  return manifestPromise;
}

/** Public helper for the track animation: returns the storm's full local
 *  frame list sorted ascending by UTC, or null if no offline data is bundled. */
export async function getStormRadarFrames(stormId) {
  await loadManifest();
  const entry = manifest?.[stormId];
  if (!entry?.frames || !entry.region) return null;
  const region = entry.region;
  const frames = Object.entries(entry.frames)
    .map(([ts, file]) => ({
      ts,
      date: stampToDate(ts),
      url: `${LOCAL_ROOT}/${file}`,
      region,
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
  return frames.length ? { frames, region, bounds: REGIONS[region].bounds } : null;
}

function regionFor(landfall) {
  if (landfall.state === 'Hawaii') return 'hicomp';
  if (landfall.state === 'Puerto Rico') return 'prcomp';
  return 'uscomp';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function dateToStamp(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}

function stampToDate(stamp) {
  return new Date(Date.UTC(
    parseInt(stamp.slice(0, 4), 10),
    parseInt(stamp.slice(4, 6), 10) - 1,
    parseInt(stamp.slice(6, 8), 10),
    parseInt(stamp.slice(8, 10), 10),
    parseInt(stamp.slice(10, 12), 10),
  ));
}

function roundToMinutes(date, mins) {
  const ms = date.getTime();
  const stepMs = mins * 60 * 1000;
  return new Date(Math.floor(ms / stepMs) * stepMs);
}

function buildLocalFrame(region, file, date) {
  return { url: `${LOCAL_ROOT}/${file}`, source: 'local', date, region };
}

function buildRemoteFrame(region, date) {
  const config = REGIONS[region];
  const stamp = dateToStamp(date);
  const product = config.remoteProduct && date.getTime() >= config.remoteProductStart
    ? config.remoteProduct
    : config.product;
  return {
    url: buildIemRadarTileUrl(config.sector, product, stamp),
    probeUrl: buildIemRadarTileProbeUrl(config.sector, product, stamp, config.probeTile),
    source: 'remote',
    date,
    region,
  };
}

/** For ONLINE mode only: probe IEM for the nearest available five-minute frame
 *  on either side of the target. Returns null if nothing is within ±60 min. */
async function findRemoteNearest(region, target, maxMinutes = 60) {
  for (const probe of buildRadarProbeTimes(target, maxMinutes, 5)) {
    const frame = buildRemoteFrame(region, probe);
    try {
      const r = await fetchWithTimeout(frame.probeUrl, { method: 'HEAD' }, REQUEST_TIMEOUT_MS.radar);
      if (isRadarFrameResponseAvailable(r)) return frame;
    } catch (_) { /* keep probing */ }
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
    this.storm = null;
    this.stormId = null;
    this.localFrames = null;     // sorted array of {ts, date, url} for full-storm loop
    this.animTimer = null;
    this.loopPending = false;    // online loop probe in flight
    this.session = 0;            // bumped on show()/close() to cancel stale awaits
  }

  available(landfall) {
    const r = REGIONS[regionFor(landfall)];
    return landfall.year >= r.earliestYear;
  }

  /** Open radar for a specific landfall on a specific storm.
   *  `storm` is the full storm record (from storms.json) so we can pan the
   *  map along the storm's track during the loop. */
  async show(storm, lfIdx) {
    // The remote walkback below can spend seconds in HEAD probes; if the user
    // closes radar or opens another landfall meanwhile, this session token
    // stops the stale continuation from resurrecting the overlay.
    const session = ++this.session;
    this.stopAnimation();
    beginOptionalFeed('radar', { cacheOrigin: 'bundled' });
    await loadManifest();
    if (session !== this.session) return;
    this.storm = storm;
    this.stormId = storm.id;
    const lf = storm.us_landfalls[lfIdx];
    this.landfall = { ...lf, year: storm.year };
    this.region = regionFor(this.landfall);

    // Pre-compute the sorted local frame list for this storm before building
    // controls so the loop button can advertise the right frame count.
    const stormEntry = manifest?.[this.stormId];
    if (stormEntry?.frames) {
      this.localFrames = Object.entries(stormEntry.frames)
        .map(([ts, file]) => ({
          ts,
          date: stampToDate(ts),
          url: `${LOCAL_ROOT}/${file}`,
          source: 'local',
          region: this.region,
        }))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    } else {
      this.localFrames = [];
    }

    this.buildControls(this.landfall);
    this.setStatus('Locating radar frame…');

    // Pick the local frame at this landfall's timestamp if we have one.
    let landfallTs = stormEntry?.landfalls?.[String(lfIdx)];
    let frame = null;
    if (landfallTs && stormEntry.frames[landfallTs]) {
      frame = buildLocalFrame(this.region, stormEntry.frames[landfallTs], stampToDate(landfallTs));
    } else {
      // Fall back to remote walkback.
      const target = new Date(this.landfall.t);
      frame = await findRemoteNearest(this.region, target);
      if (session !== this.session) return;
      if (!frame) {
        completeOptionalFeed('radar', { empty: true, itemCount: 0, cacheOrigin: 'network' });
        this.setStatus('No archived radar found within ±1 hour of landfall.');
        return;
      }
    }

    this.currentDate = frame.date;
    this.draw(frame);
    completeOptionalFeed('radar', {
      itemCount: this.localFrames.length || 1,
      cacheOrigin: frame.source === 'remote' ? 'network' : 'bundled',
    });
    this.setStatus(this.timestampLabel(frame.source));

    this.map.setView([lf.lat, lf.lon], Math.max(this.map.getZoom(), 7), { animate: true });
  }

  draw(frame) {
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
    const config = REGIONS[this.region];
    if (frame.source === 'remote') {
      this.overlay = L.tileLayer(frame.url, {
        opacity: 1.0,
        className: 'radar-overlay-tile',
        bounds: config.bounds,
        maxNativeZoom: config.maxNativeZoom,
        maxZoom: this.map.getMaxZoom(),
        noWrap: true,
        interactive: false,
      }).addTo(this.map);
      return;
    }
    this.overlay = L.imageOverlay(frame.url, config.bounds, {
      opacity: 1.0,
      className: 'radar-overlay-img',
      interactive: false,
    }).addTo(this.map);
  }

  timestampLabel(source = 'local') {
    if (!this.currentDate) return '';
    const tag = source === 'remote' ? ' · online' : '';
    return formatTime(this.currentDate.toISOString()) + tag;
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
    const totalFrames = this.localFrames?.length || 0;
    const loopHint = totalFrames > 1 ? `Animate full storm (${totalFrames} frames)` : 'Animate ±30 min around landfall';
    el.innerHTML = `
      <div class="radar-title">
        <span class="radar-pip"></span>
        NEXRAD radar — ${escapeHtml(landfall.state)} landfall
      </div>
      <div class="radar-controls-row">
        <button class="radar-btn" data-act="prev" title="Previous frame">◀</button>
        <span class="radar-time" id="radar-time">…</span>
        <button class="radar-btn" data-act="next" title="Next frame">▶</button>
        <button class="radar-btn" data-act="loop" title="${loopHint}">▶▶</button>
        ${totalFrames ? '<button class="radar-btn radar-save" data-act="save" title="Save a bounded offline radar pack for this storm">Save offline</button>' : ''}
        <button class="radar-btn radar-close" data-act="close" title="Close radar">×</button>
      </div>
      <div class="radar-source">Source: Iowa State IEM NEXRAD archive</div>
    `;
    this.controls = el;
    el.querySelector('[data-act="prev"]').addEventListener('click', () => this.step(-1));
    el.querySelector('[data-act="next"]').addEventListener('click', () => this.step(+1));
    el.querySelector('[data-act="loop"]').addEventListener('click', () => this.toggleLoop());
    el.querySelector('[data-act="save"]')?.addEventListener('click', event => this.saveOfflinePack(event.currentTarget));
    el.querySelector('[data-act="close"]').addEventListener('click', () => this.close());
  }

  async saveOfflinePack(button) {
    if (!this.stormId || !this.localFrames?.length || !button) return;
    button.disabled = true;
    this.setStatus('Saving radar pack…');
    try {
      const result = await cacheRadarPack(this.stormId, this.localFrames, {
        onProgress: ({ saved, total }) => this.setStatus(`Saving radar pack ${saved}/${total}…`),
      });
      this.setStatus(`Saved ${result.saved} radar frames for offline use.`);
      button.textContent = 'Saved';
    } catch (error) {
      this.setStatus(isQuotaExceededError(error)
        ? 'Not enough storage. Clear optional radar or tile data in Settings.'
        : 'Radar pack could not be saved.');
      button.disabled = false;
    }
  }

  setStatus(text) {
    const el = document.getElementById('radar-time');
    if (el) el.textContent = text;
  }

  /** Step ±N frames in the local frame list when available. If there aren't
   *  any local frames (storm not in the offline archive), step ±5 minutes
   *  against IEM directly. */
  async step(direction) {
    this.stopAnimation();
    if (!this.currentDate) return;
    if (this.localFrames && this.localFrames.length > 1) {
      const curStamp = dateToStamp(this.currentDate);
      let idx = this.localFrames.findIndex(f => f.ts === curStamp);
      if (idx < 0) idx = 0;
      const next = this.localFrames[Math.max(0, Math.min(this.localFrames.length - 1, idx + direction))];
      if (next.ts === curStamp) {
        this.setStatus(`(${direction > 0 ? 'last' : 'first'} frame) ${this.timestampLabel()}`);
        return;
      }
      this.currentDate = next.date;
      this.draw(next);
      this.panToTrackPoint(next.date);
      this.setStatus(this.timestampLabel('local'));
      return;
    }
    // Online stepper: 5-min steps.
    const session = this.session;
    const next = new Date(this.currentDate.getTime() + direction * 5 * 60 * 1000);
    const frame = buildRemoteFrame(this.region, next);
    this.setStatus('Loading…');
    beginOptionalFeed('radar');
    try {
      const r = await fetchWithTimeout(frame.probeUrl, { method: 'HEAD' }, REQUEST_TIMEOUT_MS.radar);
      if (session !== this.session) return;
      if (!isRadarFrameResponseAvailable(r)) {
        failOptionalFeed('radar', { responseStatus: r.status });
        this.setStatus(`No frame at ${formatTime(next.toISOString())}`);
        return;
      }
    } catch (error) {
      if (session !== this.session) return;
      failOptionalFeed('radar', { error });
      this.setStatus(`Failed to load ${formatTime(next.toISOString())}`);
      return;
    }
    this.currentDate = next;
    this.draw(frame);
    completeOptionalFeed('radar', { itemCount: 1 });
    this.setStatus(this.timestampLabel('remote'));
  }

  /** Pan the map to follow the storm during the loop. We snap to the closest
   *  HURDAT2 track point to the current radar timestamp. */
  panToTrackPoint(date) {
    if (!this.storm?.track) return;
    let best = null;
    let bestDt = Infinity;
    const target = date.getTime();
    for (const rec of this.storm.track) {
      const dt = Math.abs(new Date(rec.t).getTime() - target);
      if (dt < bestDt) {
        bestDt = dt;
        best = rec;
      }
    }
    if (best) {
      this.map.panTo([best.lat, best.lon], { animate: true, duration: 0.4 });
    }
  }

  async toggleLoop() {
    const btn = this.controls?.querySelector('[data-act="loop"]');
    if (this.animTimer || this.loopPending) {
      // Second click while running OR while the online probe is still in
      // flight means "stop" — without the pending flag, two probes could
      // finish and start two intervals, only one of which is stoppable.
      this.stopAnimation();
      return;
    }

    const session = this.session;
    let frames = [];

    // Prefer the full-storm local frame list when available.
    if (this.localFrames && this.localFrames.length > 1) {
      frames = this.localFrames;
    } else {
      // Online mode: probe ±30 min around the landfall in 5-min steps.
      this.loopPending = true;
      this.setStatus('Building loop (probing IEM)…');
      const t0 = new Date(this.landfall.t);
      const start = new Date(t0.getTime() - 30 * 60 * 1000);
      for (let m = 0; m <= 60; m += 5) {
        if (session !== this.session || !this.loopPending) return;
        const d = roundToMinutes(new Date(start.getTime() + m * 60 * 1000), 5);
        const frame = buildRemoteFrame(this.region, d);
        try {
          const r = await fetchWithTimeout(frame.probeUrl, { method: 'HEAD' }, REQUEST_TIMEOUT_MS.radar);
          if (isRadarFrameResponseAvailable(r)) frames.push(frame);
        } catch (_) { /* skip */ }
      }
      if (session !== this.session || !this.loopPending) return;
      this.loopPending = false;
    }

    if (!frames.length) {
      this.setStatus('No frames available for loop.');
      return;
    }
    if (btn) btn.textContent = '⏸';
    let idx = 0;
    // Total target: ~16 sec across the loop, with 350-1200 ms per frame.
    const perFrame = Math.max(350, Math.min(1200, Math.round(16000 / frames.length)));
    const tick = () => {
      const f = frames[idx];
      this.currentDate = f.date;
      this.draw(f);
      this.panToTrackPoint(f.date);
      this.setStatus(`${this.timestampLabel(f.source)} (${idx + 1}/${frames.length})`);
      idx = (idx + 1) % frames.length;
    };
    tick();
    this.animTimer = setInterval(tick, perFrame);
  }

  stopAnimation() {
    this.loopPending = false;
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    const btn = this.controls?.querySelector('[data-act="loop"]');
    if (btn) btn.textContent = '▶▶';
  }

  close() {
    this.session++;
    this.stopAnimation();
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
    if (this.controls) this.controls.hidden = true;
    this.landfall = null;
    this.storm = null;
    this.stormId = null;
    this.currentDate = null;
    this.localFrames = null;
  }
}
