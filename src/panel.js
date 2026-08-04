// Storm details panel + Wikipedia/YouTube quicklinks.
import {
  ensureStormsLoaded, getStorm, categoryLabel, categoryClass,
  formatTime, getImpactsFor, getBillionsFor, getAllStorms, getMetadata,
  isDatasetAvailable, windToCategory,
} from './data.js';
import { showTrack, clearTracks, getMap } from './map.js';
import { TrackAnimator } from './animation.js';
import { RadarOverlay, getStormRadarFrames } from './radar.js';
import { renderIntensityChart } from './chart.js';
import { isPinned } from './compare.js';
import { radiiCount, hideWindField } from './windfield.js';
import { hwmInfo, showHwm, hideHwm } from './hwm.js';
import { hidePanel, minimizePanel, restorePanel, showPanel } from './panels.js';
import {
  computeACE, findRapidIntensification, closestApproach,
  COASTAL_CITIES, formatNumber,
  findPressureFall, computeTranslationStats, kmhToMph, daysAtIntensity,
  findSimilarStorms, computeRIRiskScore, generateStormBiography,
} from './metrics.js';
import { formatWind, getSetting } from './settings.js';
import {
  BILLIONS_DATASET_STATUS, NCEI_BILLIONS_DATASET_ID,
  inflateUSD, formatMillionsUSD, isClosedSeries, seriesEndYear,
} from './inflation.js';
import { escapeHtml, formatStormName, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import {
  ensureExposureDensitiesLoaded,
  estimatePopulationExposure,
  formatExposurePeople,
  formatExposureTooltip,
} from './exposure.js';
import {
  getDamageMillions,
  getRawDamageText,
  getRawFatalityText,
  tornadoSearchUrl,
} from './impact-utils.js';
import { renderStormEventsSummary } from './storm-events.js';
import { clearRetrospectiveCone } from './cone-retro.js';
import { clearAdvisoryReplay } from './advisory-replay.js';
import { clearRiskTrajectories } from './art-mode.js';
import { presentPressure } from './metric-presenters.js';
import { renderForecastSkill } from './forecast-skill.js';
import { formatClosest, wirePanelControls } from './panel-controls.js';
import { renderTrackTimeline } from './table-view.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import { inspectRadarFrameCache } from './storage-manager.js';
import { getBundledDatasetState, getBundledDatasetStatus } from './optional-feeds.js';
import { cancelFemaRequest, loadFemaContext } from './fema-panel.js';
const panel = document.getElementById('storm-panel');
const body = document.getElementById('panel-body');
const stickyHeader = document.getElementById('panel-sticky-header');
const closeBtn = document.getElementById('close-panel');
let animator = null;
function getAnimator() {
  if (!animator) animator = new TrackAnimator(getMap());
  return animator;
}
let playbackAutoMinimized = false;
function enterPlaybackMapMode() {
  if (!panel || panel.hidden) return;
  playbackAutoMinimized = !panel.classList.contains('minimized');
  minimizePanel('storm-panel');
  document.body.classList.add('track-playback-active');
}

function leavePlaybackMapMode({ restore = false } = {}) {
  document.body.classList.remove('track-playback-active');
  if (restore && playbackAutoMinimized && panel && !panel.hidden) {
    restorePanel('storm-panel');
  }
  playbackAutoMinimized = false;
}
let radar = null;
function getRadar() {
  if (!radar) radar = new RadarOverlay(getMap());
  return radar;
}
async function refreshRadarCacheStatus(stormId) {
  const host = document.getElementById('radar-cache-status');
  if (!host || host.dataset.stormId !== stormId) return;
  try {
    const frameSet = await getStormRadarFrames(stormId);
    const state = await inspectRadarFrameCache(frameSet?.frames || []);
    if (!host.isConnected || host.dataset.stormId !== stormId) return;
    host.dataset.state = state.state;
    if (state.state === 'complete') {
      host.textContent = t('radar.cacheComplete', state.cached, state.total);
    } else if (state.state === 'partial') {
      host.textContent = t('radar.cachePartial', state.cached, state.total);
    } else if (state.state === 'empty') {
      host.textContent = t('radar.cacheEmpty', state.total);
    } else {
      host.textContent = t('radar.cacheUnavailable');
    }
  } catch {
    if (host.isConnected && host.dataset.stormId === stormId) {
      host.dataset.state = 'unavailable';
      host.textContent = t('radar.cacheUnavailable');
    }
  }
}
closeBtn.addEventListener('click', () => {
  hidePanel('storm-panel');
  cancelFemaRequest();
  clearTracks();
  if (animator) animator.stop();
  if (radar) radar.close();
  hideWindField();
  hideHwm();
  clearRetrospectiveCone();
  clearRiskTrajectories();
  clearAdvisoryReplay();
  document.dispatchEvent(new CustomEvent('storm-panel:close'));
});
// Other managed panels hide the storm panel through panels.js. Keep map-owned
// storm overlays tied to that panel rather than leaving orphaned geometry and
// legends over the newly opened surface.
document.addEventListener('hm-panel:hidden', event => {
  if (event.detail?.id !== 'storm-panel') return;
  clearRetrospectiveCone();
  clearRiskTrajectories();
  clearAdvisoryReplay();
});
let showStormSeq = 0;
export async function showStorm(landfall, { advisoryReplay = null } = {}) {
  // Sequence guard: rapid marker clicks interleave across the awaits below
  // (storms.json / exposure-index loads); only the latest click may render.
  const seq = ++showStormSeq;
  showPanel('storm-panel');
  stickyHeader.innerHTML = '';
  body.innerHTML = `
    <div class="storm-loading-state" role="status" aria-live="polite">
      <span class="storm-loading-dot" aria-hidden="true"></span>
      <span>${t('panel.loading')}</span>
    </div>
  `;
  // Stop any running animation and drop the previous storm's overlays when
  // switching storms — the wind-field swath otherwise outlives its checkbox.
  if (animator) animator.stop();
  hideWindField();
  hideHwm();
  clearRetrospectiveCone();
  clearRiskTrajectories();
  clearAdvisoryReplay();
  await ensureStormsLoaded();
  if (seq !== showStormSeq) return;
  const storm = getStorm(landfall.storm_id);
  if (!storm) {
    body.innerHTML = `
      <div class="storm-error-state" role="alert">
        <strong>${t('panel.errorTitle')}</strong>
        <span>${t('panel.errorDetail')}</span>
      </div>
    `;
    return;
  }
  clearTracks();
  await showTrack(storm.id);
  if (seq !== showStormSeq) return;
  if (radiiCount(storm) > 0) {
    try {
      await ensureExposureDensitiesLoaded();
    } catch (error) {
      console.warn('Population exposure density index unavailable:', error);
    }
    if (seq !== showStormSeq) return;
  }
  const allStorms = getAllStorms();
  render(storm, landfall, allStorms, advisoryReplay, seq);
}
function render(storm, landfall, allStorms, advisoryReplay = null, renderSeq = showStormSeq) {
  const niceName = formatStormName(storm.name);
  const isUnnamed = !storm.name || storm.name === 'UNNAMED';
  const heading = isUnnamed
    ? t(storm.basin === 'EP' ? 'panel.unnamedPacific' : 'panel.unnamedAtlantic', storm.year)
    : `${niceName} (${storm.year})`;
  const peakCat = windToCategory(storm.peak_wind_kt);
  const peakLabel = categoryLabel(peakCat);
  const lfCat = storm.landfall_max_category ?? -1;
  const lfLabel = categoryLabel(lfCat);

  const wikiUrl = wikipediaUrl(storm);
  const ytUrl = youtubeUrl(storm);
  const noaaReportUrl = noaaTcrUrl(storm);
  const nhcWalletUrl = nhcWalletUrlFor(storm);
  const sliderUrl = sliderSatelliteUrl(storm);
  const tornadoUrl = tornadoSearchUrl(storm);
  const reconUrl = reconArchiveUrl(storm);

  const radarApi = getRadar();
  const landfallsHtml = storm.us_landfalls && storm.us_landfalls.length > 0 
    ? storm.us_landfalls.map((lf, idx) => {
      const cat = categoryLabel(lf.category);
      const cls = categoryClass(lf.category);
      const inferred = lf.inferred ? '<span class="inferred-tag" title="Inferred from track interpolation — no explicit L marker in HURDAT2">inferred</span>' : '';
      const lfWithYear = { ...lf, year: storm.year };
      const radarBtn = radarApi.available(lfWithYear)
        ? `<button class="radar-quick-btn" data-lf-idx="${idx}" title="Show NEXRAD radar at this landfall" aria-label="Show NEXRAD radar for ${escapeHtml(formatTime(lf.t))}">Radar</button>`
        : '';
      return `<li>
        <span class="where"><span class="cat-pill ${cls}">${cat}</span> ${escapeHtml(lf.state || t('state.unknown'))}${inferred}</span>
        <span class="when">${formatTime(lf.t)}${radarBtn}</span>
      </li>`;
    }).join('')
    : '<li><em style="color:var(--text-dim);">No US landfalls on record</em></li>';

  const minPres = presentPressure(storm.min_pres_mb);

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

  // Compute RI risk score
  const riRisk = computeRIRiskScore(storm, allStorms);
  const riRiskTitle = `RI Risk Score: Based on ${riRisk.similar_count} similar historical storms (peak wind ±15kt, genesis month ±1mo, first-24h gain ±10kt). ${riRisk.ri_count} of them experienced RI (≥30kt/24h). Probability: ${Math.round(riRisk.probability * 100)}%.`;
  const riRiskIcon = riRisk.category === 'high' ? '🔴' : riRisk.category === 'medium' ? '🟡' : '🟢';
  const riRiskTile = `<div class="stat" title="${escapeHtml(riRiskTitle)}"><div class="label">RI risk <span class="metric-info">ⓘ</span></div><div class="value">${riRiskIcon} ${riRisk.category === 'high' ? 'High' : riRisk.category === 'medium' ? 'Medium' : 'Low'}</div></div>`;
  const exposure = estimatePopulationExposure(storm);
  const exposureTile = renderExposureStatTile(exposure);

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
  const impacts = getImpactsFor(storm.id);

  // Generate storm biography
  const biography = generateStormBiography(storm, impacts);

  // Populate the sticky header with title and action buttons
  stickyHeader.innerHTML = `
    <div class="storm-panel-header">
      <h2 id="storm-panel-title">${escapeHtml(heading)}</h2>
      <div class="meta-row">
        <span class="cat-pill ${categoryClass(lfCat)}">${lfLabel} at landfall</span>
        <span>Peak intensity: <strong>${peakLabel} ${storm.peak_wind_kt} kt</strong></span>
        <span>${storm.basin === 'EP' ? 'Eastern Pacific basin' : 'Atlantic basin'}</span>
        <span>${escapeHtml(storm.id)}</span>
      </div>
    </div>
    <div class="panel-actions-sticky">
      <button class="play-anim-btn" id="play-anim-btn" title="Animate the storm traveling its track">
        <span class="play-icon" aria-hidden="true"></span><span class="play-label">${t('panel.playTrack')}</span>
      </button>
      <button class="pin-btn ${isPinned(storm.id) ? 'pinned' : ''}" id="pin-btn" title="Pin this storm to the comparison tray">
        <span class="pin-icon">📌</span><span class="pin-label">${isPinned(storm.id) ? 'Pinned' : 'Pin to compare'}</span>
      </button>
    </div>
    <div class="panel-playback-host" id="panel-playback-host" hidden></div>
  `;

  body.innerHTML = `
    <div class="storm-panel-layout">
      <section class="storm-summary-cluster" aria-label="Storm summary">
        <div class="biography-text" lang="en">
          <span class="content-language-note" data-content-language="en" title="${escapeHtml(t('content.englishSourceDetail'))}">${escapeHtml(t('content.englishSource'))}</span>
          <span>${escapeHtml(biography)}</span>
        </div>

        ${riBadge || pfBadge ? `<div class="storm-flags">${riBadge}${pfBadge}</div>` : ''}

        <div class="stat-grid">
          <div class="stat"><div class="label">${t('panel.peakWind')}</div><div class="value">${formatWind(storm.peak_wind_kt)}${getSetting('windUnit') !== 'kt' ? ` <span style="font-size:11px;color:var(--subtext)">(${storm.peak_wind_kt} kt)</span>` : ''}</div></div>
          <div class="stat"><div class="label">${t('panel.minPressure')}</div><div class="value">${minPres}</div></div>
          <div class="stat" title="Accumulated Cyclone Energy — Σ(v²/10⁴) over 6-hourly obs ≥ 34 kt. Captures total wind-energy output across the storm's life. Atl. season avg ≈ 100, major hurricanes alone ≈ 10-30."><div class="label">ACE <span class="metric-info">ⓘ</span></div><div class="value">${aceStr}</div></div>
          <div class="stat" title="${escapeHtml(transTitle)}"><div class="label">Avg forward speed <span class="metric-info">ⓘ</span></div><div class="value">${transStr}</div></div>
          <div class="stat"><div class="label">${t('panel.landfalls')}</div><div class="value">${storm.us_landfall_count ?? 0}</div></div>
          ${exposureTile}
          ${riRiskTile}
        </div>

        <div class="closest-pass-row" id="closest-pass-row">
          <label class="closest-pass-label" for="closest-city">Closest pass to</label>
          <select class="closest-pass-select" id="closest-city">
            ${COASTAL_CITIES.map(c => `<option value="${escapeHtml(c.name)}"${c.name === defaultCity.name ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
          <span class="closest-pass-value" id="closest-pass-value">${formatClosest(initialApproach)}</span>
          <div class="return-periods-row" id="return-periods-row"></div>
        </div>

        ${renderImpactsBlock(storm, impacts)}
        <div class="storm-events-host" id="storm-events-host"></div>
        <div class="rainfall-host" id="rainfall-host"></div>
        <div class="tides-host" id="tides-host"></div>
      </section>

      <section class="storm-analysis-cluster" aria-label="Storm analysis">
        <h3 class="panel-section-h3">${t('panel.similarStorms')}</h3>
        <div class="similar-storms-host" id="similar-storms-host"></div>

        <h3 class="panel-section-h3">${t('panel.daysAtIntensity')}</h3>
        <div class="dai-host" id="dai-host"></div>

        <h3 class="panel-section-h3">Intensity over time</h3>
        <div class="chart-host" id="chart-host"></div>
        <div class="chart-export-row">
          <button class="text-btn chart-export-btn" id="chart-export-png" title="Download the intensity chart as a PNG image">⤓ PNG</button>
          <button class="text-btn chart-export-btn" id="chart-export-svg" title="Download the intensity chart as a vector SVG">⤓ SVG</button>
        </div>
      </section>

      <section class="storm-resources-cluster" aria-label="Storm resources">
        <h3 class="panel-section-h3">U.S. landfalls (chronological)</h3>
        <ul class="landfall-list">${landfallsHtml}</ul>
        <div class="radar-cache-status" id="radar-cache-status" data-storm-id="${escapeHtml(storm.id)}" role="status" aria-live="polite">${escapeHtml(t('radar.cacheChecking'))}</div>
        <section class="fema-context" id="fema-context" data-state="loading" aria-labelledby="fema-context-title">
          <div class="fema-context-heading">
            <h3 id="fema-context-title">${t('panel.femaTitle')}</h3>
            <a href="https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries" target="_blank" rel="noopener">${t('panel.femaSource')}</a>
          </div>
          <div class="fema-context-body" role="status" aria-live="polite">${t('panel.femaLoading')}</div>
        </section>

        <div class="action-row">
          ${wikiUrl ? `<a class="action-btn primary" href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}
          ${ytUrl ? `<a class="action-btn" href="${escapeHtml(ytUrl)}" target="_blank" rel="noopener">YouTube footage</a>` : ''}
          ${noaaReportUrl ? `<a class="action-btn" href="${escapeHtml(noaaReportUrl)}" target="_blank" rel="noopener">NOAA report</a>` : ''}
          ${nhcWalletUrl ? `<a class="action-btn" href="${escapeHtml(nhcWalletUrl)}" target="_blank" rel="noopener">NHC archive</a>` : ''}
          ${sliderUrl ? `<a class="action-btn" href="${escapeHtml(sliderUrl)}" target="_blank" rel="noopener">GOES satellite</a>` : ''}
          ${tornadoUrl ? `<a class="action-btn" href="${escapeHtml(tornadoUrl)}" target="_blank" rel="noopener">Tornadoes (NOAA)</a>` : ''}
          ${reconUrl ? `<a class="action-btn" href="${escapeHtml(reconUrl)}" target="_blank" rel="noopener">Recon archive</a>` : ''}
        </div>

        <div class="export-row">
          <span class="export-label">${t('panel.exportTrack')}:</span>
          <button class="export-btn" data-export="csv" title="Comma-separated values — open in Excel, R, Python pandas">CSV</button>
          <button class="export-btn" data-export="csv_publication" title="Publication-ready CSV with data dictionary and methodology notes">CSV (publication)</button>
          <button class="export-btn" data-export="geojson" title="GeoJSON FeatureCollection — open in QGIS, Mapbox, Leaflet">GeoJSON</button>
          <button class="export-btn" data-export="kml" title="KML — open in Google Earth, ArcGIS">KML</button>
          <button class="export-btn" data-export="svg_map" title="SVG track map — publication-quality vector graphic">SVG map</button>
          <button class="export-btn share-btn" id="share-btn" title="Copy a link to this exact view (filters + opened storm) to your clipboard"><span class="share-icon">🔗</span> Share view</button>
        </div>
        <section class="video-export-control" aria-labelledby="video-export-title" aria-describedby="video-export-description">
          <h3 id="video-export-title">${t('panel.videoExport')}</h3>
          <p id="video-export-description">${t('panel.videoExportDescription')}</p>
          <div class="video-export-options">
            <label for="video-export-fps">${t('panel.videoExportFps')}</label>
            <select id="video-export-fps">
              <option value="24">${t('panel.videoExportFpsValue', '24')}</option>
              <option value="30" selected>${t('panel.videoExportFpsValue', '30')}</option>
              <option value="60">${t('panel.videoExportFpsValue', '60')}</option>
            </select>
            <label for="video-export-duration">${t('panel.videoExportDuration')}</label>
            <select id="video-export-duration">
              <option value="5">${t('panel.videoExportSeconds', '5')}</option>
              <option value="10" selected>${t('panel.videoExportSeconds', '10')}</option>
              <option value="15">${t('panel.videoExportSeconds', '15')}</option>
              <option value="30">${t('panel.videoExportSeconds', '30')}</option>
            </select>
            <button class="text-btn" id="video-export-btn" type="button" hidden>${t('panel.videoExportButton')}</button>
          </div>
          <p class="video-export-status" id="video-export-status" role="status" aria-live="polite"></p>
          <p class="video-export-unavailable" id="video-export-unavailable" role="status" hidden></p>
        </section>
        <div id="forecast-skill-host"></div>
        <div id="track-timeline-host"></div>
        <section class="advisory-replay-control" aria-labelledby="advisory-replay-title">
          <div class="cone-retro-heading">
            <h3 id="advisory-replay-title">${t('advisoryReplay.title')}</h3>
            <label class="wf-toggle">
              <input type="checkbox" id="advisory-replay-enabled">
              <span>${t('advisoryReplay.show')}</span>
            </label>
          </div>
          <p>${t('advisoryReplay.explainer')}</p>
          <div class="advisory-replay-steps" id="advisory-replay-steps" hidden>
            <div class="advisory-replay-nav">
              <button type="button" class="advisory-replay-step" id="advisory-replay-prev" aria-label="${t('advisoryReplay.previous')}">◀</button>
              <input type="range" id="advisory-replay-scrubber" min="0" max="0" value="0" step="1" aria-label="${t('advisoryReplay.scrubber')}">
              <button type="button" class="advisory-replay-step" id="advisory-replay-next" aria-label="${t('advisoryReplay.next')}">▶</button>
            </div>
            <p class="advisory-replay-meta" id="advisory-replay-meta"></p>
            <p class="advisory-replay-provenance" id="advisory-replay-provenance"></p>
            <ul class="advisory-replay-legend">
              <li><span class="advisory-swatch advisory-swatch--forecast"></span>${t('advisoryReplay.legendForecast')}</li>
              <li><span class="advisory-swatch advisory-swatch--actual"></span>${t('advisoryReplay.legendActual')}</li>
            </ul>
            <p class="advisory-replay-discussion" id="advisory-replay-discussion"></p>
          </div>
          <p class="cone-retro-status" id="advisory-replay-status" role="status" aria-live="polite"></p>
        </section>
        <section class="cone-retro-control" aria-labelledby="cone-retro-title">
          <div class="cone-retro-heading">
            <h3 id="cone-retro-title">${t('coneRetro.title')}</h3>
            <label class="wf-toggle">
              <input type="checkbox" id="cone-retro-enabled">
              <span>${t('coneRetro.show')}</span>
            </label>
          </div>
          <div class="cone-retro-options">
            <label for="cone-retro-era">${t('coneRetro.era')}</label>
            <select id="cone-retro-era">
              <option value="2015"${storm.year < 2020 ? ' selected' : ''}>2015</option>
              <option value="2025"${storm.year >= 2020 && storm.year < 2026 ? ' selected' : ''}>2025</option>
              <option value="2026"${storm.year >= 2026 ? ' selected' : ''}>2026</option>
            </select>
            <label class="wf-toggle">
              <input type="checkbox" id="cone-retro-ellipse">
              <span>${t('coneRetro.ellipseToggle')}</span>
            </label>
          </div>
          <p>${t('coneRetro.explainer')}</p>
          <p class="cone-retro-status" id="cone-retro-status" role="status" aria-live="polite"></p>
        </section>

        <section class="art-mode-control" aria-labelledby="art-mode-title">
          <div class="cone-retro-heading">
            <h3 id="art-mode-title">${t('art.title')}</h3>
            <label class="wf-toggle">
              <input type="checkbox" id="art-mode-enabled">
              <span>${t('art.show')}</span>
            </label>
          </div>
          <div class="cone-retro-options">
            <label for="art-mode-era">${t('coneRetro.era')}</label>
            <select id="art-mode-era" disabled>
              <option value="2015"${storm.year < 2020 ? ' selected' : ''}>2015</option>
              <option value="2025"${storm.year >= 2020 && storm.year < 2026 ? ' selected' : ''}>2025</option>
              <option value="2026"${storm.year >= 2026 ? ' selected' : ''}>2026</option>
            </select>
          </div>
          <p>${t('art.explainer')}</p>
          <p class="cone-retro-status" id="art-mode-status" role="status" aria-live="polite"></p>
        </section>

        ${radiiCount(storm) > 0 ? `
          <div class="wind-field-row">
            <label class="wf-toggle" title="Show HURDAT2 wind-radii swath (34/50/64 kt) along the track. Available for storms 2004+.">
              <input type="checkbox" id="wf-cb">
              <span>🌬️ Show wind-field swath (${radiiCount(storm)} analyzed records)</span>
            </label>
          </div>
        ` : ''}
        <div id="hwm-row-host"></div>
      </section>
    </div>
  `;
  panel.scrollTop = 0;

  // Render the intensity chart inline in the panel. Pass the RI window so
  // the chart can red-tint that segment.
  renderIntensityChart(document.getElementById('chart-host'), storm, { ri });

  // Days-at-intensity stacked horizontal bar.
  renderDaysAtIntensity(document.getElementById('dai-host'), storm.track);

  // Similar storms: compute top-5 neighbors and render.
  const similarStorms = findSimilarStorms(storm, allStorms, 5);
  renderSimilarStorms(document.getElementById('similar-storms-host'), similarStorms);
  renderStormEventsSummary(document.getElementById('storm-events-host'), storm);
  renderRainfallBlock(document.getElementById('rainfall-host'), storm);
  renderHwmRow(document.getElementById('hwm-row-host'), storm);
  renderTrackTimeline(document.getElementById('track-timeline-host'), storm);
  renderForecastSkill(document.getElementById('forecast-skill-host'), storm);
  refreshRadarCacheStatus(storm.id);
  loadFemaContext(storm, renderSeq, currentSeq => currentSeq === showStormSeq);
  import('./tides.js')
    .then(({ renderTidesBlock }) => renderTidesBlock(document.getElementById('tides-host'), storm))
    .catch(() => { /* tide gauges are optional context */ });

  wirePanelControls({
    panel,
    storm,
    allStorms,
    advisoryReplay,
    getAnimator,
    getRadar,
    enterPlaybackMapMode,
    leavePlaybackMapMode,
  });
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

function renderExposureStatTile(exposure) {
  if (!exposure?.available) return '';
  const tooltip = formatExposureTooltip(exposure);
  return `
    <div class="stat" title="${escapeHtml(tooltip)}">
      <div class="label">Est. exposure <span class="metric-info">ⓘ</span></div>
      <div class="value">${formatExposurePeople(exposure.headline_people)} <span style="font-size:11px;color:var(--subtext)">${escapeHtml(exposure.headline_label)} winds</span></div>
    </div>
  `;
}


function renderSimilarStorms(host, similarStorms) {
  if (!host || !Array.isArray(similarStorms) || similarStorms.length === 0) {
    if (host) host.innerHTML = `
      <div class="panel-empty-state">
        <strong>No close historical matches.</strong>
        <span>This storm is unusual across the current similarity dimensions.</span>
      </div>`;
    return;
  }
  const rows = similarStorms.map(s => {
    const score = (s.similarity_score * 100).toFixed(0);
    const cat = categoryLabel(windToCategory(s.peak_wind_kt || 0));
    const cls = categoryClass(windToCategory(s.peak_wind_kt || 0));
    return `<li class="similar-storm-row">
      <span class="similar-storm-name">${escapeHtml(formatStormName(s.name))} (${s.year})</span>
      <span class="similar-storm-cat cat-pill ${cls}" title="Peak intensity">${cat}</span>
      <span class="similar-storm-landfalls" title="Number of U.S. landfalls">${s.landfalls} landfall${s.landfalls !== 1 ? 's' : ''}</span>
      <span class="similar-storm-score" title="Similarity score: 0-100 higher=more similar">${score}%</span>
    </li>`;
  }).join('');
  host.innerHTML = `<ul class="similar-storms-list">${rows}</ul>`;
  
  // Wire clicks to show that storm (find its first landfall in data)
  host.querySelectorAll('.similar-storm-row').forEach((row, idx) => {
    row.addEventListener('click', async () => {
      const similar = similarStorms[idx];
      await ensureStormsLoaded();
      const targetStorm = getStorm(similar.storm_id);
      if (targetStorm && targetStorm.us_landfalls && targetStorm.us_landfalls.length > 0) {
        showStorm(targetStorm.us_landfalls[0]);
      }
    });
    row.style.cursor = 'pointer';
  });
}

// Wikipedia article URL — best-effort. Tries the standard article naming pattern;
// the user's browser will redirect if Wikipedia has a different canonical title.
function wikipediaUrl(storm) {
  if (!storm.name || storm.name === 'UNNAMED') {
    return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(`${storm.year} Atlantic hurricane season`)}`;
  }
  const name = formatStormName(storm.name);
  // Most modern named storms: "Hurricane <Name> (YYYY)" or "Tropical Storm <Name> (YYYY)"
  const peakCat = windToCategory(storm.peak_wind_kt);
  const prefix = peakCat >= 1 ? 'Hurricane' : 'Tropical_Storm';
  const slug = `${prefix}_${name}_(${storm.year})`;
  // Use Wikipedia search with the article title as query — handles redirects
  // and disambiguation gracefully even when the exact title doesn't exist.
  return `https://en.wikipedia.org/wiki/Special:Search?go=Go&search=${encodeURIComponent(slug.replace(/_/g, ' '))}`;
}

function youtubeUrl(storm) {
  const niceName = (!storm.name || storm.name === 'UNNAMED')
    ? `${storm.year} hurricane`
    : `${formatStormName(storm.name)} ${storm.year}`;
  const peakCat = windToCategory(storm.peak_wind_kt);
  const kind = peakCat >= 1 ? 'hurricane' : 'tropical storm';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${kind} ${niceName} landfall`)}`;
}

function noaaTcrUrl(storm) {
  // NOAA Tropical Cyclone Reports: only published from ~1958 onward, and well-indexed from 1995+.
  if (storm.year < 1995) return null;
  // The NHC "data" archive supports yearly indices.
  return `https://www.nhc.noaa.gov/data/tcr/index.php?season=${storm.year}&basin=atl`;
}

function renderImpactsBlock(storm, im = getImpactsFor(storm.id)) {
  const rows = [];
  const sources = [];
  if (im) {
    const rawDeaths = getRawFatalityText(im);
    const rawDamage = getRawDamageText(im);
    if (rawDeaths) rows.push(`<div class="im-row"><span class="im-label">${t('impacts.fatalities')}</span><span class="im-value">${escapeHtml(rawDeaths)}</span></div>`);
    if (rawDamage) {
      const mode = getSetting('damageMode');
      const nominalM = getDamageMillions(im);
      let valueHTML = escapeHtml(rawDamage);
      if (mode === 'real' && nominalM != null && storm.year) {
        const r = inflateUSD(nominalM, storm.year);
        if (r) {
          valueHTML = r.currentDollars
            ? `${formatMillionsUSD(r.real)} <span class="im-adj">(${storm.year} USD)</span>`
            : `${formatMillionsUSD(r.real)} <span class="im-adj">(2024 USD · ${formatMillionsUSD(nominalM)} nominal)</span>`;
        }
      } else if (mode === 'nominal' && nominalM != null) {
        valueHTML = `${formatMillionsUSD(nominalM)} <span class="im-adj">(${storm.year || ''} USD)</span>`;
      }
      rows.push(`<div class="im-row"><span class="im-label">${t('impacts.damage')}</span><span class="im-value">${valueHTML}</span></div>`);
    }
    if (rows.length) {
      const safeSourceUrl = safeExternalUrl(im.wiki_url);
      const confidence = ['high', 'medium', 'low'].includes(im.impact_confidence)
        ? im.impact_confidence
        : 'unknown';
      const confidenceText = escapeHtml(t('impacts.confidence', t(`impacts.confidence.${confidence}`)));
      const confidenceTitle = escapeHtml(im.impact_confidence_reason || '');
      const source = safeSourceUrl
        ? `<a href="${safeSourceUrl}" target="_blank" rel="noopener">${t('impacts.wikiSource')}</a>`
        : t('impacts.wikiSource');
      sources.push(`${source} · <span title="${confidenceTitle}">${confidenceText}</span>`);
    }
  }
  const billions = getBillionsFor(storm.id);
  const billionsStatus = getBundledDatasetStatus(getMetadata(), NCEI_BILLIONS_DATASET_ID) || BILLIONS_DATASET_STATUS;
  const billionsState = getBundledDatasetState(billionsStatus, isDatasetAvailable(NCEI_BILLIONS_DATASET_ID));
  const billionsEndYear = seriesEndYear(billionsStatus);
  if (billions && Number.isFinite(billions.cost_cpi_musd)) {
    const deaths = Number.isFinite(billions.deaths)
      ? ` · ${billions.deaths.toLocaleString()} ${t('impacts.deaths')}`
      : '';
    rows.push(`<div class="im-row"><span class="im-label">${t('impacts.ncei')}</span><span class="im-value">${formatMillionsUSD(billions.cost_cpi_musd)} <span class="im-adj">(2024 USD${deaths})</span></span></div>`);
    sources.push(`<a href="https://www.ncei.noaa.gov/access/billions/" target="_blank" rel="noopener">${t('impacts.nceiSource')}</a>`);
  } else if (billionsState === 'closed' && Number.isInteger(billionsEndYear) && Number(storm.year) > billionsEndYear) {
    rows.push(`<div class="im-row im-row--closed"><span class="im-label">${t('impacts.ncei')}</span><span class="im-value">${t('impacts.nceiClosed', billionsEndYear)}</span></div>`);
    const retirementUrl = safeExternalUrl(billionsStatus.retirement_citation?.url);
    if (retirementUrl) {
      sources.push(`<a href="${retirementUrl}" target="_blank" rel="noopener">${t('impacts.nceiRetirementSource')}</a>`);
    }
  } else if (billionsState === 'unavailable') {
    rows.push(`<div class="im-row im-row--missing"><span class="im-label">${t('impacts.ncei')}</span><span class="im-value">${t('impacts.nceiUnavailable')}</span></div>`);
  }
  if (!im) {
    rows.push(`<div class="im-row im-row--missing"><span class="im-value">${t('impacts.missingRecord')}</span></div>`);
  }
  if (!rows.length) return '';
  return `
    <h3 class="panel-section-h3">${t('panel.impacts')}</h3>
    <div class="impacts-block">
      ${rows.join('')}
      <div class="im-source">${sources.join(' · ')}</div>
    </div>
  `;
}

/** Aircraft reconnaissance archive (Tropical Atlantic mirror). Hurricane
 *  Hunters fly into Atlantic-basin storms threatening land — vortex
 *  messages, high-density observations, and dropsonde data. The archive
 *  is per-storm and best surfaced via search rather than a constructed URL. */
function reconArchiveUrl(storm) {
  if (storm.basin !== 'AL') return null;
  if (storm.year < 1989) return null;  // Tropical Atlantic archive thins out before this
  if (!storm.name || storm.name === 'UNNAMED') return null;
  const name = formatStormName(storm.name);
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
  // GOES-16 (East) cannot see Hawaii — Pacific landfalls need GOES-18 full disk.
  const isHawaii = lfs.length && lfs[0].state === 'Hawaii';
  const sat = isHawaii ? 'goes-18' : 'goes-16';
  const sec = isHawaii ? 'full_disk' : 'conus';
  // Default to the GeoColor product — most legible, day-and-night.
  return `https://rammb-slider.cira.colostate.edu/?sat=${sat}&sec=${sec}&start_unix=${unix}&time_step=10&motion=loop&im=12`;
}

// Days-at-intensity stacked horizontal bar. Visualizes how many hours of
// the storm's life were spent in each Saffir-Simpson tier — gives an
// at-a-glance sense of "long Cat-4 grinder" vs "brief brushing TS".
function renderDaysAtIntensity(host, track) {
  if (!host) return;
  const buckets = daysAtIntensity(track);
  const order = [
    { k: 'td', label: 'TD',    cls: 'cat-ts' },
    { k: 'ts', label: 'TS',    cls: 'cat-ts' },
    { k: 'c1', label: 'Cat 1', cls: 'cat-1'  },
    { k: 'c2', label: 'Cat 2', cls: 'cat-2'  },
    { k: 'c3', label: 'Cat 3', cls: 'cat-3'  },
    { k: 'c4', label: 'Cat 4', cls: 'cat-4'  },
    { k: 'c5', label: 'Cat 5', cls: 'cat-5'  },
  ];
  const total = order.reduce((s, t) => s + buckets[t.k], 0);
  if (total <= 0) {
    host.innerHTML = '<div class="dai-empty">No tier-resolved track data available.</div>';
    return;
  }
  const parts = order.filter(tier => buckets[tier.k] > 0).map(tier => {
    const hrs = buckets[tier.k];
    const pct = (hrs / total) * 100;
    const days = hrs / 24;
    const dayStr = days >= 1 ? `${days.toFixed(1)} d` : `${Math.round(hrs)} h`;
    return { tier, pct, dayStr };
  });
  // Segments are presentational children of the role="img" bar — aria-label
  // on a generic div is prohibited (WCAG 4.1.2); the per-tier breakdown goes
  // on the bar's own label instead.
  const segs = parts.map(({ tier, pct, dayStr }) =>
    `<div class="dai-seg ${tier.cls}" style="flex-basis:${pct}%" title="${tier.label}: ${dayStr} (${pct.toFixed(0)}%)"><span class="dai-seg-label">${pct >= 8 ? `${tier.label} · ${dayStr}` : ''}</span></div>`,
  ).join('');
  const daiBreakdown = parts.map(({ tier, dayStr }) => `${tier.label} ${dayStr}`).join(', ');
  host.innerHTML = `
    <div class="dai-bar" role="img" aria-label="${t('panel.daysAtIntensity')}: ${daiBreakdown}">${segs}</div>
    <div class="dai-legend">
      <span class="dai-total">Total tracked: ${(total / 24).toFixed(1)} days</span>
    </div>
  `;
}

/** USGS high-water-mark toggle — only for storms with preprocessed marks. */
async function renderHwmRow(host, storm) {
  if (!host) return;
  const info = await hwmInfo(storm.id);
  if (!info) return;
  host.innerHTML = `
    <div class="wind-field-row">
      <label class="wf-toggle" title="${t('hwm.tooltip')}">
        <input type="checkbox" id="hwm-cb">
        <span>🌊 ${t('hwm.toggle', info.count)}</span>
      </label>
    </div>`;
  host.querySelector('#hwm-cb').addEventListener('change', async event => {
    if (event.target.checked) await showHwm(storm.id);
    else hideHwm();
  });
}

let rainfallPromise = null;
function loadRainfall() {
  if (!rainfallPromise) {
    rainfallPromise = fetchWithTimeout('./data/rainfall.json', {}, REQUEST_TIMEOUT_MS.data)
      .then(res => res.ok ? res.json() : null)
      .catch(() => null);
  }
  return rainfallPromise;
}

async function renderRainfallBlock(host, storm) {
  if (!host) return;
  const data = await loadRainfall();
  if (!data) return;
  const rec = data[storm.id];
  if (!rec) return;
  host.innerHTML = `
    <div class="panel-info-card">
      <div class="info-card-label">Peak rainfall (WPC)</div>
      <div class="info-card-value">${rec.peak_inches}" at ${escapeHtml(rec.station)}</div>
      <div class="info-card-source">Source: <a href="https://www.wpc.ncep.noaa.gov/tropical/rain/tcrainfall.html" target="_blank" rel="noopener">NOAA WPC TC Rainfall</a></div>
    </div>
  `;
}
