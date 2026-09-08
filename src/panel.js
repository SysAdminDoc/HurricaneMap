// Storm details panel + Wikipedia/YouTube quicklinks.
import {
  ensureStormsLoaded, ensureOptionalData, getStorm, categoryLabel, categoryClass,
  formatTime, getImpactsFor, getAllStorms, windToCategory,
} from './data.js';
import { showTrack, clearFocusTrack, getMap } from './map.js';
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
import { escapeHtml, formatStormName } from './html-utils.js';
import { t } from './i18n.js';
import {
  ensureExposureDensitiesLoaded,
  estimatePopulationExposure,
  formatExposurePeople,
  formatExposureTooltip,
} from './exposure.js';
import { tornadoSearchHint, tornadoSearchUrl } from './impact-utils.js';
import {
  nhcWalletUrlFor,
  noaaTcrUrl,
  reconArchiveUrl,
  renderImpactsBlock,
  sliderSatelliteUrl,
  wikipediaUrl,
  youtubeUrl,
} from './panel-impacts.js';
import { renderStormEventsSummary } from './storm-events.js';
import { clearRetrospectiveCone } from './cone-retro.js';
import { clearAdvisoryReplay } from './advisory-replay.js';
import { clearRiskTrajectories } from './art-mode.js';
import { presentPressure, MISSING_METRIC } from './metric-presenters.js';
import { renderForecastSkill } from './forecast-skill.js';
import { formatClosest, showToast, wirePanelControls } from './panel-controls.js';
import { renderDaysAtIntensity, renderSimilarStorms } from './panel-analysis.js';
import { renderTrackTimeline } from './table-view.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import { inspectRadarFrameCache } from './storage-manager.js';
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
// Everything the storm panel owns on the map. Its controls live inside the
// panel, so anything still running once the panel is gone cannot be turned off:
// the radar overlay kept its floating controls and the old storm's title, the
// track animator kept its rAF loop, and the wind-field swath and high-water
// marks stayed drawn over whichever panel had just opened.
function stopStormOverlays() {
  if (animator) animator.stop();
  if (radar) radar.close();
  hideWindField();
  hideHwm();
  clearRetrospectiveCone();
  clearRiskTrajectories();
  clearAdvisoryReplay();
}

closeBtn.addEventListener('click', () => {
  // hidePanel dispatches hm-panel:hidden, and the handler below runs the
  // overlay teardown, so only the parts unique to a real close belong here.
  hidePanel('storm-panel');
  cancelFemaRequest();
  document.dispatchEvent(new CustomEvent('storm-panel:close'));
});
// Other managed panels hide the storm panel through panels.js. Keep map-owned
// storm overlays tied to that panel rather than leaving orphaned geometry and
// legends over the newly opened surface.
let showStormSeq = 0;
document.addEventListener('hm-panel:hidden', event => {
  if (event.detail?.id !== 'storm-panel') return;
  // Closing is as much a reason to abandon a render as opening a different
  // storm is. A render still working through its awaits would otherwise finish
  // into a panel nobody is looking at and leave its track drawn on the map.
  showStormSeq += 1;
  stopStormOverlays();
  // The track belongs to the panel too. Only the close button used to clear it,
  // so opening any other panel over the storm panel left its track behind on a
  // map that no longer said which storm it was. Only the panel's own track:
  // clearing the whole layer took the "show tracks" filter's lines with it.
  clearFocusTrack();
});
export async function showStorm(landfall, { advisoryReplay = null } = {}) {
  // Sequence guard: rapid marker clicks interleave across the awaits below
  // (storms.json / exposure-index loads); only the latest click may render.
  const seq = ++showStormSeq;
  showPanel('storm-panel');
  // Three places open this panel without going through the map's own click
  // handler: On This Date, the state panel's storm list and the similar-storms
  // rows. They left the URL describing whatever was open before, so the Share
  // button copied a link to a different view than the one on screen. Saying so
  // here covers every entry point, present and future, instead of asking each
  // caller to remember.
  document.dispatchEvent(new CustomEvent('hm-storm:open', { detail: { landfall } }));
  stickyHeader.innerHTML = '';
  body.innerHTML = `
    <div class="storm-loading-state" role="status" aria-live="polite">
      <span class="storm-loading-dot" aria-hidden="true"></span>
      <span>${t('panel.loading')}</span>
    </div>
  `;
  // Stop any running animation and drop the previous storm's overlays when
  // switching storms — the wind-field swath otherwise outlives its checkbox,
  // and the radar controls kept the previous storm's title.
  stopStormOverlays();
  // Not only through main.js's lazy loader: On This Date and the state panel's
  // storm list import showStorm directly, and without this they rendered
  // "NOAA NCEI data unavailable" and "no impact record is bundled" as facts
  // while both files were still in flight.
  await Promise.all([ensureStormsLoaded(), ensureOptionalData()]);
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
  await showTrack(storm.id, { focus: true });
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
  const tornadoHint = tornadoSearchHint(storm);
  const reconUrl = reconArchiveUrl(storm);

  const radarApi = getRadar();
  const landfallsHtml = storm.us_landfalls && storm.us_landfalls.length > 0 
    ? storm.us_landfalls.map((lf, idx) => {
      const cat = categoryLabel(lf.category);
      const cls = categoryClass(lf.category);
      const inferred = lf.inferred ? `<span class="inferred-tag" title="${escapeHtml(t('panel.inferredTitle'))}">${t('panel.inferredTag')}</span>` : '';
      const lfWithYear = { ...lf, year: storm.year };
      const radarBtn = radarApi.available(lfWithYear)
        ? `<button class="radar-quick-btn" data-lf-idx="${idx}" title="${t('panel.showRadarTitle')}" aria-label="${escapeHtml(t('panel.showRadarFor', formatTime(lf.t)))}">${t('panel.radarLabel')}</button>`
        : '';
      return `<li>
        <span class="where"><span class="cat-pill ${cls}">${cat}</span> ${escapeHtml(lf.state || t('state.unknown'))}${inferred}</span>
        <span class="when">${formatTime(lf.t)}${radarBtn}</span>
      </li>`;
    }).join('')
    : `<li><em style="color:var(--text-dim);">${t('panel.noLandfallsRecord')}</em></li>`;

  const minPres = presentPressure(storm.min_pres_mb);

  const ace = computeACE(storm.track);
  // A storm that never reached tropical-storm strength at a synoptic hour has
  // an ACE of zero, and zero is the answer. The marker is for a value that
  // could not be computed at all.
  const aceStr = Number.isFinite(ace.value) ? formatNumber(ace.value, 1) : MISSING_METRIC;
  const ri = findRapidIntensification(storm.track);
  const riBadge = ri
    ? `<span class="storm-flag ri-flag" title="Rapid intensification: gained ${ri.delta_kt} kt in ${Math.round(ri.hours)}h (${formatTime(ri.from_t)} → ${formatTime(ri.to_t)}). NHC threshold is ≥30 kt / 24h.">${t('panel.riFlag', ri.delta_kt)}</span>`
    : '';

  const pressureFall = findPressureFall(storm.track);
  const pfBadge = pressureFall
    ? `<span class="storm-flag pf-flag" title="Explosive deepening: pressure dropped ${formatNumber(pressureFall.drop_mb, 0)} mb in ${Math.round(pressureFall.hours)}h (${formatTime(pressureFall.from_t)} → ${formatTime(pressureFall.to_t)}). The conventional 'explosive' threshold is ≥20 mb / 24h.">${t('panel.pressureFallFlag', formatNumber(pressureFall.drop_mb, 0))}</span>`
    : '';

  // Compute RI risk score
  const riRisk = computeRIRiskScore(storm, allStorms);
  const riRiskTitle = `RI Risk Score: Based on ${riRisk.similar_count} similar historical storms (peak wind ±15kt, genesis month ±1mo, first-24h gain ±10kt). ${riRisk.ri_count} of them experienced RI (≥30kt/24h). Probability: ${Math.round(riRisk.probability * 100)}%.`;
  const riRiskIcon = riRisk.category === 'high' ? '🔴' : riRisk.category === 'medium' ? '🟡' : '🟢';
  const riRiskTile = `<div class="stat" title="${escapeHtml(riRiskTitle)}"><div class="label">${t('panel.riRiskLabel')} <span class="metric-info">ⓘ</span></div><div class="value">${riRiskIcon} ${riRisk.category === 'high' ? t('panel.riskHigh') : riRisk.category === 'medium' ? t('panel.riskMedium') : t('panel.riskLow')}</div></div>`;
  const exposure = estimatePopulationExposure(storm);
  const exposureTile = renderExposureStatTile(exposure);

  const transStats = computeTranslationStats(storm.track);
  const transStr = transStats
    ? `${formatNumber(transStats.mean_kmh, 0)} km/h <span style="font-size:11px;color:var(--subtext)">(${formatNumber(kmhToMph(transStats.mean_kmh), 0)} mph)</span>`
    : MISSING_METRIC;
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
        <span class="cat-pill ${categoryClass(lfCat)}">${t('panel.catAtLandfall', lfLabel)}</span>
        <span>${t('panel.peakIntensityLabel')} <strong>${peakLabel} ${storm.peak_wind_kt} kt</strong></span>
        <span>${storm.basin === 'EP' ? t('panel.basinEastPacific') : t('panel.basinAtlantic')}</span>
        <span>${escapeHtml(storm.id)}</span>
      </div>
    </div>
    <div class="panel-actions-sticky">
      <button class="play-anim-btn" id="play-anim-btn" title="${t('panel.animateTitle')}">
        <span class="play-icon" aria-hidden="true"></span><span class="play-label">${t('panel.playTrack')}</span>
      </button>
      <button class="pin-btn ${isPinned(storm.id) ? 'pinned' : ''}" id="pin-btn" title="${t('panel.pinTitle')}">
        <span class="pin-icon">📌</span><span class="pin-label">${isPinned(storm.id) ? t('compare.pinned') : t('compare.pin')}</span>
      </button>
    </div>
    <div class="panel-playback-host" id="panel-playback-host" hidden></div>
  `;

  body.innerHTML = `
    <div class="storm-panel-layout">
      <section class="storm-summary-cluster" aria-label="${t('panel.summarySection')}">
        <div class="biography-text" lang="en">
          <span class="content-language-note" data-content-language="en" title="${escapeHtml(t('content.englishSourceDetail'))}">${escapeHtml(t('content.englishSource'))}</span>
          <span>${escapeHtml(biography)}</span>
        </div>

        ${riBadge || pfBadge ? `<div class="storm-flags">${riBadge}${pfBadge}</div>` : ''}

        <div class="stat-grid">
          <div class="stat"><div class="label">${t('panel.peakWind')}</div><div class="value">${formatWind(storm.peak_wind_kt)}${getSetting('windUnit') !== 'kt' ? ` <span style="font-size:11px;color:var(--subtext)">(${storm.peak_wind_kt} kt)</span>` : ''}</div></div>
          <div class="stat"><div class="label">${t('panel.minPressure')}</div><div class="value">${minPres}</div></div>
          <div class="stat" title="${escapeHtml(t('panel.aceTitle'))}"><div class="label">ACE <span class="metric-info">ⓘ</span></div><div class="value">${aceStr}</div></div>
          <div class="stat" title="${escapeHtml(transTitle)}"><div class="label">${t('panel.avgForwardSpeed')} <span class="metric-info">ⓘ</span></div><div class="value">${transStr}</div></div>
          <div class="stat"><div class="label">${t('panel.landfalls')}</div><div class="value">${storm.us_landfall_count ?? 0}</div></div>
          ${exposureTile}
          ${riRiskTile}
        </div>

        <div class="closest-pass-row" id="closest-pass-row">
          <label class="closest-pass-label" for="closest-city">${t('panel.closestPassTo')}</label>
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

      <section class="storm-analysis-cluster" aria-label="${t('panel.analysisSection')}">
        <h3 class="panel-section-h3">${t('panel.similarStorms')}</h3>
        <div class="similar-storms-host" id="similar-storms-host"></div>

        <h3 class="panel-section-h3">${t('panel.daysAtIntensity')}</h3>
        <div class="dai-host" id="dai-host"></div>

        <h3 class="panel-section-h3">${t('panel.intensityOverTime')}</h3>
        <div class="chart-host" id="chart-host"></div>
        <div class="chart-export-row">
          <button class="text-btn chart-export-btn" id="chart-export-png" title="${t('panel.downloadChartPng')}">⤓ PNG</button>
          <button class="text-btn chart-export-btn" id="chart-export-svg" title="${t('panel.downloadChartSvg')}">⤓ SVG</button>
        </div>
      </section>

      <section class="storm-resources-cluster" aria-label="${t('panel.resourcesSection')}">
        <h3 class="panel-section-h3">${t('panel.landfallsSection')}</h3>
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
          ${ytUrl ? `<a class="action-btn" href="${escapeHtml(ytUrl)}" target="_blank" rel="noopener">${t('links.youtube')}</a>` : ''}
          ${noaaReportUrl ? `<a class="action-btn" href="${escapeHtml(noaaReportUrl)}" target="_blank" rel="noopener">${t('links.noaaReport')}</a>` : ''}
          ${nhcWalletUrl ? `<a class="action-btn" href="${escapeHtml(nhcWalletUrl)}" target="_blank" rel="noopener">${t('links.nhcArchive')}</a>` : ''}
          ${sliderUrl ? `<a class="action-btn" href="${escapeHtml(sliderUrl)}" target="_blank" rel="noopener">${t('links.goesSatellite')}</a>` : ''}
          ${tornadoUrl ? `<a class="action-btn" href="${escapeHtml(tornadoUrl)}" title="${escapeHtml(t('links.tornadoHint', tornadoHint?.states, tornadoHint?.from, tornadoHint?.to))}" target="_blank" rel="noopener">Storm Events (NOAA)</a>` : ''}
          ${reconUrl ? `<a class="action-btn" href="${escapeHtml(reconUrl)}" target="_blank" rel="noopener">${t('links.reconArchive')}</a>` : ''}
        </div>

        <div class="export-row">
          <span class="export-label">${t('panel.exportTrack')}:</span>
          <button class="export-btn" data-export="csv" title="${escapeHtml(t('panel.exportCsvTitle'))}">CSV</button>
          <button class="export-btn" data-export="csv_publication" title="${escapeHtml(t('panel.exportCsvPublicationTitle'))}">${t('panel.exportCsvPublication')}</button>
          <button class="export-btn" data-export="geojson" title="${escapeHtml(t('panel.exportGeojsonTitle'))}">GeoJSON</button>
          <button class="export-btn" data-export="kml" title="${escapeHtml(t('panel.exportKmlTitle'))}">KML</button>
          <button class="export-btn" data-export="svg_map" title="${escapeHtml(t('panel.exportSvgMapTitle'))}">${t('panel.exportSvgMap')}</button>
          <button class="export-btn share-btn" id="share-btn" title="${escapeHtml(t('panel.shareViewTitle'))}"><span class="share-icon">🔗</span> ${t('panel.shareView')}</button>
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
              <span>${t('panel.windSwathToggle', radiiCount(storm))}</span>
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
  renderSimilarStorms(document.getElementById('similar-storms-host'), similarStorms, showStorm);
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
      <div class="label">${t('panel.estExposure')} <span class="metric-info">ⓘ</span></div>
      <div class="value">${formatExposurePeople(exposure.headline_people)} <span style="font-size:11px;color:var(--subtext)">${t('panel.exposureWinds', escapeHtml(exposure.headline_label))}</span></div>
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
    if (!event.target.checked) return hideHwm();
    // Nothing drawn means the box comes back up rather than claiming an overlay.
    if (!await showHwm(storm.id)) event.target.checked = false;
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
      <div class="info-card-source">${t('panel.infoSource')} <a href="https://www.wpc.ncep.noaa.gov/tropical/rain/tcrainfall.html" target="_blank" rel="noopener">NOAA WPC TC Rainfall</a></div>
    </div>
  `;
}
