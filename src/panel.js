// Storm details panel + Wikipedia/YouTube quicklinks.
import {
  ensureStormsLoaded, getStorm, categoryLabel, categoryClass,
  ktToMph, formatTime,
} from './data.js';
import { showTrack, clearTracks, getMap } from './map.js';
import { TrackAnimator } from './animation.js';
import { RadarOverlay } from './radar.js';

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
});

export async function showStorm(landfall) {
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

  const radarApi = getRadar();
  const landfallsHtml = storm.us_landfalls.map((lf, idx) => {
    const cat = categoryLabel(lf.category);
    const cls = categoryClass(lf.category);
    const inferred = lf.inferred ? '<span class="inferred-tag" title="Inferred from track interpolation — no explicit L marker in HURDAT2">inferred</span>' : '';
    const lfWithYear = { ...lf, year: storm.year };
    const radarBtn = radarApi.available(lfWithYear)
      ? `<button class="radar-quick-btn" data-lf-idx="${idx}" title="Show NEXRAD radar at this landfall">📡</button>`
      : '';
    return `<li>
      <span class="where"><span class="cat-pill ${cls}">${cat}</span> ${lf.state}${inferred}</span>
      <span class="when">${formatTime(lf.t)}${radarBtn}</span>
    </li>`;
  }).join('');

  const minPres = storm.min_pres_mb ? `${storm.min_pres_mb} mb` : '—';
  const peakWindMph = ktToMph(storm.peak_wind_kt);

  body.innerHTML = `
    <h2>${escapeHtml(heading)}</h2>
    <div class="meta-row">
      <span class="cat-pill ${categoryClass(lfCat)}">${lfLabel} at landfall</span>
      <span>Peak intensity: <strong>${peakLabel} ${storm.peak_wind_kt} kt</strong></span>
      <span>${storm.basin === 'EP' ? 'Eastern Pacific basin' : 'Atlantic basin'}</span>
      <span>${storm.id}</span>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="label">Peak wind</div><div class="value">${storm.peak_wind_kt} kt <span style="font-size:11px;color:var(--subtext)">(${peakWindMph} mph)</span></div></div>
      <div class="stat"><div class="label">Min pressure</div><div class="value">${minPres}</div></div>
      <div class="stat"><div class="label">U.S. landfalls</div><div class="value">${storm.us_landfall_count}</div></div>
      <div class="stat"><div class="label">Track points</div><div class="value">${storm.track.length}</div></div>
    </div>

    <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--subtext);margin:0 0 6px;">U.S. landfalls (chronological)</h3>
    <ul class="landfall-list">${landfallsHtml}</ul>

    <div class="action-row">
      ${wikiUrl ? `<a class="action-btn primary" href="${wikiUrl}" target="_blank" rel="noopener">Wikipedia</a>` : ''}
      ${ytUrl ? `<a class="action-btn" href="${ytUrl}" target="_blank" rel="noopener">YouTube footage</a>` : ''}
      ${noaaReportUrl ? `<a class="action-btn" href="${noaaReportUrl}" target="_blank" rel="noopener">NOAA report</a>` : ''}
      ${nhcWalletUrl ? `<a class="action-btn" href="${nhcWalletUrl}" target="_blank" rel="noopener">NHC archive</a>` : ''}
    </div>

    <button class="play-anim-btn" id="play-anim-btn" title="Animate the storm traveling its track">
      <span class="play-icon"></span>Play track animation
    </button>
  `;
  panel.scrollTop = 0;

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
      const lf = storm.us_landfalls[idx];
      if (!lf) return;
      getRadar().show({ ...lf, year: storm.year });
    });
  });
}

function titleCase(name) {
  if (!name || name === 'UNNAMED') return 'Unnamed';
  return name[0].toUpperCase() + name.slice(1).toLowerCase();
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

function nhcWalletUrlFor(storm) {
  // NHC storm wallet: 1995-onward, numbered AL/EPxxYYYY.
  if (storm.year < 1995) return null;
  return `https://www.nhc.noaa.gov/archive/${storm.year}/${storm.id}.shtml`;
}
