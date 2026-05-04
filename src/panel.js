// Storm details panel + Wikipedia/YouTube quicklinks.
import {
  ensureStormsLoaded, getStorm, categoryLabel, categoryClass,
  ktToMph, formatTime, getImpactsFor,
} from './data.js';
import { showTrack, clearTracks, getMap } from './map.js';
import { TrackAnimator } from './animation.js';
import { RadarOverlay } from './radar.js';
import { renderIntensityChart } from './chart.js';
import { togglePin, isPinned } from './compare.js';
import { radiiCount, showWindField, hideWindField } from './windfield.js';
import { closePanelsExcept } from './panels.js';
import {
  computeACE, findRapidIntensification, closestApproach,
  COASTAL_CITIES, formatNumber, buildExports, downloadBlob,
  findPressureFall, computeTranslationStats, kmhToMph,
} from './metrics.js';

const panel = document.getElementById('storm-panel');
const body = document.getElementById('panel-body');
const closeBtn = document.getElementById('close-panel');

let animator = null;
function getAnimator() {
  if (!animator) animator = new TrackAnimator(getMap());
  return animator;
}

let radar = null;
function getRadar() {
  if (!radar) radar = new RadarOverlay(getMap());
  return radar;
}

closeBtn.addEventListener('click', () => {
  panel.hidden = true;
  clearTracks();
  if (animator) animator.stop();
  if (radar) radar.close();
  hideWindField();
  document.dispatchEvent(new CustomEvent('storm-panel:close'));
});

export async function showStorm(landfall) {
  closePanelsExcept('storm-panel');
  panel.hidden = false;
  body.innerHTML = '<p class="meta-row" style="padding:24px 0;">Loading storm track…</p>';
  // Stop any running animation when switching storms.
  if (animator) animator.stop();
  await ensureStormsLoaded();
  const storm = getStorm(landfall.storm_id);
  if (!storm) {
    body.innerHTML = '<p>Could not find storm record.</p>';
    return;
  }
  clearTracks();
  await showTrack(storm.id);
  render(storm, landfall);
}

function render(storm, landfall) {
  const niceName = titleCase(storm.name);
  const isUnnamed = !storm.name || storm.name === 'UNNAMED';
  const heading = isUnnamed ? `${storm.year} unnamed ${storm.basin === 'EP' ? 'Pacific' : 'Atlantic'} storm` : `${niceName} (${storm.year})`;
  const peakCat = saffirCat(storm.peak_wind_kt);
  const peakLabel = categoryLabel(peakCat);
  const lfCat = storm.landfall_max_category;
  const lfLabel = categoryLabel(lfCat);

  const wikiUrl = wikipediaUrl(storm);
  const ytUrl = youtubeUrl(storm);
  const noaaReportUrl = noaaTcrUrl(storm);
  const nhcWalletUrl = nhcWalletUrlFor(storm);
  const sliderUrl = sliderSatelliteUrl(storm);
  const tornadoUrl = tornadoSearchUrl(storm);
  const reconUrl = reconArchiveUrl(storm);

  const radarApi = getRadar();
  const landfallsHtml = storm.us_landfalls.map((lf, idx) => {
    const cat = categoryLabel(lf.category);
    const cls = categoryClass(lf.category);
    const inferred = lf.inferred ? '<span class="inferred-tag" title="Inferred from track interpolation — no explicit L marker in HURDAT2">inferred</span>' : '';
    const lfWithYear = { ...lf, year: storm.year };
    const radarBtn = radarApi.available(lfWithYear)
      ? `<button class="radar-quick-btn" data-lf-idx="${idx}" title="Show NEXRAD radar at this landfall — full-storm timeline if scraped offline">📡</button>`
      : '';
    return `<li>
      <span class="where"><span class="cat-pill ${cls}">${cat}</span> ${lf.state}${inferred}</span>
      <span class="when">${formatTime(lf.t)}${radarBtn}</span>
    </li>`;
  }).join('');

  const minPres = storm.min_pres_mb ? `${storm.min_pres_mb} mb` : '—';
  const peakWindMph = ktToMph(storm.peak_wind_kt);

  const ace = computeACE(storm.track);
  const aceStr = ace.value > 0 ? formatNumber(ace.value, 1) : '—';
  const ri = findRapidIntensification(storm.track);
  const riBadge = ri
    ? `<span class="storm-flag ri-flag" title="Rapid intensification: gained ${ri.delta_kt} kt in ${Math.round(ri.hours)}h (${formatTime(ri.from_t)} → ${formatTime(ri.to_t)}). NHC threshold is ≥30 kt / 24h.">⚡ Rapid intensification (+${ri.delta_kt} kt / 24h)</span>`
    : '';

  const pressureFall = findPressureFall(storm.track);
  const pfBadge = pressureFall
    ? `<span class="storm-flag pf-flag" title="Explosive deepening: pressure dropped ${formatNumber(pressureFall.drop_mb, 0)} mb in ${Math.round(pressureFall.hours)}h (${formatTime(pressureFall.from_t)} → ${formatTime(pressureFall.to_t)}). The conventional 'explosive' threshold is ≥20 mb / 24h.">📉 Explosive deepening (−${formatNumber(pressureFall.drop_mb, 0)} mb / 24h)</span>`
    : '';

  const transStats = computeTranslationStats(storm.track);
  const transStr = transStats
    ? `${formatNumber(transStats.mean_kmh, 0)} km/h <span style="font-size:11px;color:var(--subtext)">(${formatNumber(kmhToMph(transStats.mean_kmh), 0)} mph)</span>`
    : '—';
  const transTitle = transStats
    ? `Mean forward speed: ${formatNumber(transStats.mean_kmh, 1)} km/h. Peak: ${formatNumber(transStats.max_kmh, 0)} km/h${transStats.stalled_hours > 0 ? ` · stalled (<10 km/h) for ${formatNumber(transStats.stalled_hours, 0)} h total` : ''}.`
    : 'Translation speed unavailable — insufficient consecutive obs.';

  // Default closest-pass city: prefer one in the storm's first landfall state, else Miami.
  const defaultCity = pickDefaultCity(storm);
  const initialApproach = closestApproach(storm.track, defaultCity.lat, defaultCity.lon);

  body.innerHTML = `
    <h2>${escapeHtml(heading)}</h2>
    <div class="meta-row">
      <span class="cat-pill ${categoryClass(lfCat)}">${lfLabel} at landfall</span>
      <span>Peak intensity: <strong>${peakLabel} ${storm.peak_wind_kt} kt</strong></span>
      <span>${storm.basin === 'EP' ? 'Eastern Pacific basin' : 'Atlantic basin'}</span>
      <span>${storm.id}</span>
    </div>

    ${(riBadge || pfBadge) ? `<div class="storm-flags">${riBadge}${pfBadge}</div>` : ''}

    <div class="stat-grid">
      <div class="stat"><div class="label">Peak wind</div><div class="value">${storm.peak_wind_kt} kt <span style="font-size:11px;color:var(--subtext)">(${peakWindMph} mph)</span></div></div>
      <div class="stat"><div class="label">Min pressure</div><div class="value">${minPres}</div></div>
      <div class="stat" title="Accumulated Cyclone Energy — Σ(v²/10⁴) over 6-hourly obs ≥ 34 kt. Captures total wind-energy output across the storm's life. Atl. season avg ≈ 100, major hurricanes alone ≈ 10-30."><div class="label">ACE <span class="metric-info">ⓘ</span></div><div class="value">${aceStr}</div></div>
      <div class="stat" title="${escapeHtml(transTitle)}"><div class="label">Avg forward speed <span class="metric-info">ⓘ</span></div><div class="value">${transStr}</div></div>
      <div class="stat"><div class="label">U.S. landfalls</div><div class="value">${storm.us_landfall_count}</div></div>
    </div>

    <div class="closest-pass-row" id="closest-pass-row">
      <label class="closest-pass-label" for="closest-city">Closest pass to</label>
      <select class="closest-pass-select" id="closest-city">
        ${COASTAL_CITIES.map(c => `<option value="${escapeHtml(c.name)}"${c.name === defaultCity.name ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
      </select>
      <span class="closest-pass-value" id="closest-pass-value">${formatClosest(initialApproach)}</span>
    </div>

    ${renderImpactsBlock(storm)}

    <h3 class="panel-section-h3">Intensity over time</h3>
    <div class="chart-host" id="chart-host"></div>

    <h3 class="panel-section-h3">U.S. landfalls (chronological)</h3>
    <ul class="landfall-list">${landfallsHtml}</ul>

    <div class="action-row">
      ${wikiUrl ? `<a class="action-btn primary" href="${wikiUrl}" target="_blank" rel="noopener">Wikipedia</a>` : ''}
      ${ytUrl ? `<a class="action-btn" href="${ytUrl}" target="_blank" rel="noopener">YouTube footage</a>` : ''}
      ${noaaReportUrl ? `<a class="action-btn" href="${noaaReportUrl}" target="_blank" rel="noopener">NOAA report</a>` : ''}
      ${nhcWalletUrl ? `<a class="action-btn" href="${nhcWalletUrl}" target="_blank" rel="noopener">NHC archive</a>` : ''}
      ${sliderUrl ? `<a class="action-btn" href="${sliderUrl}" target="_blank" rel="noopener">🛰️ GOES satellite</a>` : ''}
      ${tornadoUrl ? `<a class="action-btn" href="${tornadoUrl}" target="_blank" rel="noopener">🌪️ Tornadoes (NOAA)</a>` : ''}
      ${reconUrl ? `<a class="action-btn" href="${reconUrl}" target="_blank" rel="noopener">✈️ Recon archive</a>` : ''}
    </div>

    <div class="export-row">
      <span class="export-label">Export track:</span>
      <button class="export-btn" data-export="csv" title="Comma-separated values — open in Excel, R, Python pandas">CSV</button>
      <button class="export-btn" data-export="geojson" title="GeoJSON FeatureCollection — open in QGIS, Mapbox, Leaflet">GeoJSON</button>
      <button class="export-btn" data-export="kml" title="KML — open in Google Earth, ArcGIS">KML</button>
      <button class="export-btn share-btn" id="share-btn" title="Copy a link to this exact view (filters + opened storm) to your clipboard"><span class="share-icon">🔗</span> Share view</button>
    </div>

    <div class="panel-actions-row">
      <button class="play-anim-btn" id="play-anim-btn" title="Animate the storm traveling its track">
        <span class="play-icon"></span>Play track animation
      </button>
      <button class="pin-btn ${isPinned(storm.id) ? 'pinned' : ''}" id="pin-btn" title="Pin this storm to the comparison tray">
        <span class="pin-icon">📌</span><span class="pin-label">${isPinned(storm.id) ? 'Pinned' : 'Pin to compare'}</span>
      </button>
    </div>
    ${radiiCount(storm) > 0 ? `
      <div class="wind-field-row">
        <label class="wf-toggle" title="Show HURDAT2 wind-radii swath (34/50/64 kt) along the track. Available for storms 2004+.">
          <input type="checkbox" id="wf-cb">
          <span>🌬️ Show wind-field swath (${radiiCount(storm)} analyzed records)</span>
        </label>
      </div>
    ` : ''}
  `;
  panel.scrollTop = 0;

  // Render the intensity chart inline in the panel. Pass the RI window so
  // the chart can red-tint that segment.
  renderIntensityChart(document.getElementById('chart-host'), storm, { ri });

  // Closest-pass selector — recompute on city change.
  const cityEl = document.getElementById('closest-city');
  const cpValEl = document.getElementById('closest-pass-value');
  if (cityEl && cpValEl) {
    cityEl.addEventListener('change', () => {
      const city = COASTAL_CITIES.find(c => c.name === cityEl.value);
      if (!city) return;
      const ap = closestApproach(storm.track, city.lat, city.lon);
      cpValEl.innerHTML = formatClosest(ap);
    });
  }

  // Export menu — generate Blob client-side and trigger a download.
  panel.querySelectorAll('.export-btn').forEach((btn) => {
    if (btn.id === 'share-btn') return;
    btn.addEventListener('click', () => {
      const kind = btn.dataset.export;
      const exports = buildExports(storm);
      if (exports[kind]) downloadBlob(exports[kind]);
    });
  });

  // Share button — copy the current permalink to the clipboard with a toast.
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const url = window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard');
      } catch {
        // Fallback for non-secure contexts: use a hidden textarea.
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('Link copied to clipboard'); }
        catch { showToast('Copy failed — select the address bar', 'warn'); }
        document.body.removeChild(ta);
      }
    });
  }

  const playBtn = document.getElementById('play-anim-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      getAnimator().play(storm);
    });
  }

  // Wire each radar quick-button to fetch NEXRAD imagery for that specific landfall.
  panel.querySelectorAll('.radar-quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.lfIdx, 10);
      getRadar().show(storm, idx);
    });
  });

  const pinBtn = document.getElementById('pin-btn');
  if (pinBtn) {
    pinBtn.addEventListener('click', async () => {
      const nowPinned = await togglePin(storm);
      pinBtn.classList.toggle('pinned', nowPinned);
      pinBtn.querySelector('.pin-label').textContent = nowPinned ? 'Pinned' : 'Pin to compare';
    });
  }

  const wfCb = document.getElementById('wf-cb');
  if (wfCb) {
    wfCb.addEventListener('change', () => {
      if (wfCb.checked) showWindField(storm);
      else hideWindField();
    });
  }
}

function titleCase(name) {
  if (!name || name === 'UNNAMED') return 'Unnamed';
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
}

// Map a U.S. state name to a representative city in COASTAL_CITIES so the
// closest-pass selector defaults to a relevant city for the storm at hand.
const STATE_TO_CITY = {
  'Florida': 'Miami, FL',
  'Texas': 'Galveston, TX',
  'Louisiana': 'New Orleans, LA',
  'Mississippi': 'Mobile, AL',
  'Alabama': 'Mobile, AL',
  'Georgia': 'Savannah, GA',
  'South Carolina': 'Charleston, SC',
  'North Carolina': 'Cape Hatteras, NC',
  'Virginia': 'Norfolk, VA',
  'Maryland': 'Norfolk, VA',
  'Delaware': 'Norfolk, VA',
  'New Jersey': 'New York, NY',
  'New York': 'New York, NY',
  'Connecticut': 'New York, NY',
  'Rhode Island': 'Boston, MA',
  'Massachusetts': 'Boston, MA',
  'New Hampshire': 'Boston, MA',
  'Maine': 'Boston, MA',
  'Hawaii': 'Honolulu, HI',
  'Puerto Rico': 'San Juan, PR',
};

function pickDefaultCity(storm) {
  const firstLf = storm.us_landfalls && storm.us_landfalls[0];
  const cityName = firstLf ? STATE_TO_CITY[firstLf.state] : null;
  if (cityName) {
    const c = COASTAL_CITIES.find(x => x.name === cityName);
    if (c) return c;
  }
  return storm.basin === 'EP'
    ? COASTAL_CITIES.find(x => x.name === 'Honolulu, HI') || COASTAL_CITIES[0]
    : COASTAL_CITIES[0];
}

function formatClosest(approach) {
  if (!approach) return '—';
  const mi = Math.round(approach.distance_mi);
  const km = Math.round(approach.distance_km);
  const r = approach.track_point;
  const wind = r.wind != null ? `${r.wind} kt` : '—';
  const date = formatTime(r.t);
  return `<strong>${mi.toLocaleString()} mi</strong> <span class="cp-meta-inline">(${km.toLocaleString()} km) · ${wind} · ${date}</span>`;
}

function saffirCat(kt) {
  if (kt == null || kt < 34) return 0;
  if (kt < 64) return -1;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

let _toastTimer = null;
function showToast(msg, tone = 'info') {
  let host = document.getElementById('hm-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'hm-toast-host';
    host.className = 'hm-toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `hm-toast hm-toast--${tone}`;
  el.setAttribute('role', tone === 'warn' ? 'alert' : 'status');
  el.textContent = msg;
  host.appendChild(el);
  // Force-reflow then animate in.
  requestAnimationFrame(() => el.classList.add('is-visible'));
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 240);
  }, 2200);
}

// Wikipedia article URL — best-effort. Tries the standard article naming pattern;
// the user's browser will redirect if Wikipedia has a different canonical title.
function wikipediaUrl(storm) {
  if (!storm.name || storm.name === 'UNNAMED') {
    return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(`${storm.year} Atlantic hurricane season`)}`;
  }
  const name = titleCase(storm.name);
  // Most modern named storms: "Hurricane <Name> (YYYY)" or "Tropical Storm <Name> (YYYY)"
  const peakCat = saffirCat(storm.peak_wind_kt);
  const prefix = peakCat >= 1 ? 'Hurricane' : 'Tropical_Storm';
  const slug = `${prefix}_${name}_(${storm.year})`;
  // Use Wikipedia search with the article title as query — handles redirects
  // and disambiguation gracefully even when the exact title doesn't exist.
  return `https://en.wikipedia.org/wiki/Special:Search?go=Go&search=${encodeURIComponent(slug.replace(/_/g, ' '))}`;
}

function youtubeUrl(storm) {
  const niceName = (!storm.name || storm.name === 'UNNAMED')
    ? `${storm.year} hurricane`
    : `${titleCase(storm.name)} ${storm.year}`;
  const peakCat = saffirCat(storm.peak_wind_kt);
  const kind = peakCat >= 1 ? 'hurricane' : 'tropical storm';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${kind} ${niceName} landfall`)}`;
}

function noaaTcrUrl(storm) {
  // NOAA Tropical Cyclone Reports: only published from ~1958 onward, and well-indexed from 1995+.
  if (storm.year < 1995) return null;
  // The NHC "data" archive supports yearly indices.
  return `https://www.nhc.noaa.gov/data/tcr/index.php?season=${storm.year}&basin=atl`;
}

function renderImpactsBlock(storm) {
  const im = getImpactsFor(storm.id);
  if (!im) return '';
  const rows = [];
  if (im.deaths) rows.push(`<div class="im-row"><span class="im-label">Fatalities</span><span class="im-value">${escapeHtml(im.deaths)}</span></div>`);
  if (im.damages) rows.push(`<div class="im-row"><span class="im-label">Damage</span><span class="im-value">${escapeHtml(im.damages)}</span></div>`);
  if (!rows.length) return '';
  const src = im.wiki_url ? `<a href="${im.wiki_url}" target="_blank" rel="noopener">Source: Wikipedia</a>` : 'Source: Wikipedia';
  return `
    <h3 class="panel-section-h3">Impacts</h3>
    <div class="impacts-block">
      ${rows.join('')}
      <div class="im-source">${src}</div>
    </div>
  `;
}

/** NOAA Storm Events listing pre-filtered to tornadoes during this storm's
 *  active window in any state it affected. Storm Events DB starts 1950 but
 *  tornado linkage is most useful from 1995 onward. */
function tornadoSearchUrl(storm) {
  if (!storm.year || storm.year < 1950) return null;
  if (!storm.track?.length) return null;
  const start = new Date(storm.track[0].t);
  const end = new Date(storm.track[storm.track.length - 1].t);
  const states = [...new Set((storm.us_landfalls || []).map(l => l.state))];
  if (!states.length) return null;
  // Storm Events expects FIPS state codes.
  const FIPS = {
    'Alabama': '01', 'Alaska': '02', 'Connecticut': '09', 'Delaware': '10',
    'District of Columbia': '11', 'Florida': '12', 'Georgia': '13', 'Hawaii': '15',
    'Louisiana': '22', 'Maine': '23', 'Maryland': '24', 'Massachusetts': '25',
    'Mississippi': '28', 'New Hampshire': '33', 'New Jersey': '34', 'New York': '36',
    'North Carolina': '37', 'Pennsylvania': '42', 'Puerto Rico': '72',
    'Rhode Island': '44', 'South Carolina': '45', 'Texas': '48', 'Virginia': '51',
    'California': '06',
  };
  const fipsList = states.map(s => `${FIPS[s] || ''},${s.toUpperCase()}`).filter(Boolean).join('%2C');
  if (!fipsList) return null;
  const params = new URLSearchParams({
    eventType: '(C) Tornado',
    beginDate_mm: String(start.getUTCMonth() + 1).padStart(2, '0'),
    beginDate_dd: String(start.getUTCDate()).padStart(2, '0'),
    beginDate_yyyy: String(start.getUTCFullYear()),
    endDate_mm: String(end.getUTCMonth() + 1).padStart(2, '0'),
    endDate_dd: String(end.getUTCDate()).padStart(2, '0'),
    endDate_yyyy: String(end.getUTCFullYear()),
    statefips: fipsList,
  });
  return `https://www.ncei.noaa.gov/stormevents/listevents.jsp?${params.toString()}`;
}

/** Aircraft reconnaissance archive (Tropical Atlantic mirror). Hurricane
 *  Hunters fly into Atlantic-basin storms threatening land — vortex
 *  messages, high-density observations, and dropsonde data. The archive
 *  is per-storm and best surfaced via search rather than a constructed URL. */
function reconArchiveUrl(storm) {
  if (storm.basin !== 'AL') return null;
  if (storm.year < 1989) return null;  // Tropical Atlantic archive thins out before this
  if (!storm.name || storm.name === 'UNNAMED') return null;
  const name = storm.name[0].toUpperCase() + storm.name.slice(1).toLowerCase();
  // Tropical Atlantic uses a per-storm storm-archive page indexed by name+year.
  return `https://tropicalatlantic.com/recon/?archive=${storm.year}&storm=${encodeURIComponent(name)}`;
}

function nhcWalletUrlFor(storm) {
  // NHC storm wallet: 1995-onward, numbered AL/EPxxYYYY.
  if (storm.year < 1995) return null;
  return `https://www.nhc.noaa.gov/archive/${storm.year}/${storm.id}.shtml`;
}

/** Open the storm's first U.S. landfall on CIRA's RAMMB SLIDER. SLIDER carries
 *  GOES-16 (East) imagery from late 2017 onward. We pin to the storm's first
 *  landfall time so the user lands on the eyewall over the coast. */
function sliderSatelliteUrl(storm) {
  if (storm.year < 2018) return null;
  const lfs = storm.us_landfalls || [];
  const refIso = lfs.length ? lfs[0].t : storm.track[0]?.t;
  if (!refIso) return null;
  const ts = new Date(refIso);
  // SLIDER takes Unix seconds and a sector. CONUS sector is the right scale
  // for U.S. landfalls; tropical-atlantic for storms still over open ocean.
  const unix = Math.floor(ts.getTime() / 1000);
  const sector = lfs.length && lfs[0].state === 'Hawaii' ? 'goes-18---full_disk' : 'goes-16---conus';
  // Default to the GeoColor product — most legible, day-and-night.
  return `https://rammb-slider.cira.colostate.edu/?sat=goes-16&sec=${encodeURIComponent(sector.split('---')[1] || 'conus')}&start_unix=${unix}&time_step=10&motion=loop&im=12`;
}
