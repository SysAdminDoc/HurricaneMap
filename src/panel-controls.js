// Interaction wiring for the rendered storm panel.
//
// panel.js owns storm data composition and markup. This module owns the
// controls that are created by that markup so a re-render has one explicit
// binding boundary and export actions cannot drift into the renderer.
import { formatTime } from './data.js';
import { getMap } from './map.js';
import { exportChartAsPng, exportChartAsSvg } from './chart-export.js';
import { togglePin } from './compare.js';
import { showWindField, hideWindField } from './windfield.js';
import {
  closestApproach, COASTAL_CITIES, computeCityReturnPeriods,
  buildExports, downloadBlob,
} from './metrics.js';
import { formatWind } from './settings.js';
import { escapeHtml, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import { clearRetrospectiveCone, renderRetrospectiveCone } from './cone-retro.js';
import {
  clearAdvisoryReplay,
  getAdvisoryReplayPosition,
  getStormAdvisories,
  loadAdvisories,
  renderAdvisory,
} from './advisory-replay.js';
import { clearRiskTrajectories, renderRiskTrajectories } from './art-mode.js';

export function formatClosest(approach) {
  if (!approach) return '—';
  const mi = Math.round(approach.distance_mi);
  const km = Math.round(approach.distance_km);
  const point = approach.track_point;
  const wind = point.wind != null ? formatWind(point.wind) : '—';
  const date = formatTime(point.t);
  return '<strong>' + mi.toLocaleString() + ' mi</strong> <span class="cp-meta-inline">('
    + km.toLocaleString() + ' km) · ' + wind + ' · ' + date + '</span>';
}

export function formatReturnPeriods(returnPeriods) {
  if (!returnPeriods) return '';
  const items = [];
  if (returnPeriods.cat5_years) items.push('Cat 5: ~' + returnPeriods.cat5_years + 'y');
  else if (returnPeriods.cat5_count === 0) items.push('Cat 5: never');
  if (returnPeriods.cat3_years) items.push('Cat 3+: ~' + returnPeriods.cat3_years + 'y');
  else if (returnPeriods.cat3_count === 0) items.push('Cat 3+: never');
  if (returnPeriods.cat1_years) items.push('Cat 1+: ~' + returnPeriods.cat1_years + 'y');
  else if (returnPeriods.cat1_count === 0) items.push('Cat 1+: never');
  if (items.length === 0) return '';
  return '<span class="return-periods-label">Return period (50 km radius):</span> ' + items.join(' • ');
}

function showToast(message, tone = 'info') {
  let host = document.getElementById('hm-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'hm-toast-host';
    host.className = 'hm-toast-host';
    document.body.appendChild(host);
  }
  const element = document.createElement('div');
  element.className = 'hm-toast hm-toast--' + tone;
  element.setAttribute('role', tone === 'warn' ? 'alert' : 'status');
  element.textContent = message;
  host.appendChild(element);
  requestAnimationFrame(() => element.classList.add('is-visible'));
  setTimeout(() => {
    element.classList.remove('is-visible');
    setTimeout(() => element.remove(), 240);
  }, 2200);
}

let advisoryReplaySequence = 0;

function wireAdvisoryReplay(storm, initialReplay = null) {
  const enabled = document.getElementById('advisory-replay-enabled');
  const steps = document.getElementById('advisory-replay-steps');
  const scrubber = document.getElementById('advisory-replay-scrubber');
  const previous = document.getElementById('advisory-replay-prev');
  const next = document.getElementById('advisory-replay-next');
  const meta = document.getElementById('advisory-replay-meta');
  const provenance = document.getElementById('advisory-replay-provenance');
  const discussion = document.getElementById('advisory-replay-discussion');
  const status = document.getElementById('advisory-replay-status');
  if (!enabled || !steps || !scrubber || !previous || !next || !meta || !provenance || !discussion || !status) return;

  const sequence = ++advisoryReplaySequence;
  let record = null;
  let coneEra = '2025';
  let hasFramedReplay = false;

  const notifyReplayState = detail => {
    document.dispatchEvent(new CustomEvent('advisory-replay:change', { detail }));
  };

  const show = async index => {
    const result = await renderAdvisory(storm, { map: getMap(), record, coneEra, index });
    if (sequence !== advisoryReplaySequence) return;
    if (result.status !== 'rendered') {
      status.textContent = result.status === 'error' ? t('advisoryReplay.error') : '';
      return;
    }
    const { advisory, summary } = result;
    const map = getMap();
    if (result.bounds && map) {
      const mapBounds = map.getBounds();
      if (!hasFramedReplay || !mapBounds.intersects(result.bounds)) {
        map.fitBounds(result.bounds, { padding: [40, 40] });
      }
      hasFramedReplay = true;
    }
    const replayPosition = getAdvisoryReplayPosition(result.index, record.advisories.length);
    const positionText = t('advisoryReplay.position', String(replayPosition.number), String(replayPosition.count));
    const nhcNumberText = t('advisoryReplay.nhcNumber', String(advisory.n));
    scrubber.value = String(replayPosition.index);
    scrubber.setAttribute('aria-valuenow', String(replayPosition.index));
    scrubber.setAttribute('aria-valuetext', [positionText, nhcNumberText].join(' · '));
    previous.disabled = replayPosition.index <= 0;
    next.disabled = replayPosition.index >= replayPosition.count - 1;
    meta.textContent = [
      positionText,
      nhcNumberText,
      t('advisoryReplay.issued', formatTime(advisory.t)),
    ].join(' · ');
    provenance.textContent = record.unmatchedForecasts > 0
      ? t('advisoryReplay.postTropical', String(record.unmatchedForecasts))
      : record.missingDiscussions > 0
        ? t('advisoryReplay.missingDiscussions', String(record.missingDiscussions))
        : '';
    status.textContent = summary.verifiedLeads
      ? [
        t('advisoryReplay.verified', String(summary.verifiedLeads), String(summary.meanTrackErrorNmi)),
        t('advisoryReplay.longest', String(summary.longestLeadHours), String(summary.longestLeadTrackErrorNmi)),
      ].join(' ')
      : t('advisoryReplay.unverified');
    discussion.innerHTML = advisory.discussion
      ? '<a href="' + escapeHtml(safeExternalUrl(advisory.discussion)) + '" target="_blank" rel="noopener noreferrer">'
        + escapeHtml(t('advisoryReplay.discussion')) + '</a>'
      : escapeHtml(t('advisoryReplay.noDiscussion'));
    notifyReplayState({
      active: true,
      stormId: storm.id,
      index: replayPosition.index,
      coneEra,
      advisoryNumber: advisory.n,
      issueTime: advisory.t,
    });
  };

  const sync = async () => {
    if (!enabled.checked) {
      clearAdvisoryReplay();
      hasFramedReplay = false;
      steps.hidden = true;
      provenance.textContent = '';
      status.textContent = '';
      notifyReplayState({ active: false, stormId: storm.id });
      return;
    }
    status.textContent = t('advisoryReplay.loading');
    let archive;
    try {
      archive = await loadAdvisories();
    } catch {
      if (sequence !== advisoryReplaySequence) return;
      status.textContent = t('advisoryReplay.error');
      return;
    }
    if (sequence !== advisoryReplaySequence) return;
    record = getStormAdvisories(archive, storm.id);
    coneEra = record?.coneEra || archive?.era?.coneEra || '2025';
    if (!record?.advisories?.length) {
      steps.hidden = true;
      provenance.textContent = '';
      status.textContent = t('advisoryReplay.unavailable', archive?.era?.label || '');
      enabled.checked = false;
      notifyReplayState({ active: false, stormId: storm.id });
      return;
    }
    steps.hidden = false;
    scrubber.max = String(record.advisories.length - 1);
    const recordConeEra = record.coneEra || archive?.era?.coneEra || '2025';
    coneEra = initialReplay?.coneEra === recordConeEra ? initialReplay.coneEra : recordConeEra;
    scrubber.value = String(initialReplay?.index ?? 0);
    await show(Number(scrubber.value));
  };

  enabled.addEventListener('change', sync);
  scrubber.addEventListener('input', () => { if (record) show(Number(scrubber.value || 0)); });
  previous.addEventListener('click', () => { if (record) show(Number(scrubber.value || 0) - 1); });
  next.addEventListener('click', () => { if (record) show(Number(scrubber.value || 0) + 1); });
  if (initialReplay?.stormId === storm.id) {
    enabled.checked = true;
    sync();
  }
}

export function wirePanelControls({
  panel,
  storm,
  allStorms,
  advisoryReplay = null,
  getAnimator,
  getRadar,
  enterPlaybackMapMode,
  leavePlaybackMapMode,
}) {
  const pngButton = document.getElementById('chart-export-png');
  const svgButton = document.getElementById('chart-export-svg');
  if (pngButton) pngButton.addEventListener('click', async () => {
    const svg = panel.querySelector('.intensity-svg');
    try {
      await exportChartAsPng(svg, storm.name);
      showToast(t('toast.chartSavedPNG'));
    } catch { showToast(t('toast.exportFailedPNG'), 'warn'); }
  });
  if (svgButton) svgButton.addEventListener('click', () => {
    const svg = panel.querySelector('.intensity-svg');
    if (exportChartAsSvg(svg, storm.name)) showToast(t('toast.chartSavedSVG'));
    else showToast(t('toast.exportFailedSVG'), 'warn');
  });

  const city = document.getElementById('closest-city');
  const closestValue = document.getElementById('closest-pass-value');
  const returnPeriods = document.getElementById('return-periods-row');
  if (city && closestValue) {
    const updateClosestPass = () => {
      const selectedCity = COASTAL_CITIES.find(item => item.name === city.value);
      if (!selectedCity) return;
      const approach = closestApproach(storm.track, selectedCity.lat, selectedCity.lon);
      const periods = computeCityReturnPeriods(selectedCity, allStorms);
      closestValue.innerHTML = formatClosest(approach);
      if (returnPeriods) returnPeriods.innerHTML = formatReturnPeriods(periods);
    };
    updateClosestPass();
    city.addEventListener('change', updateClosestPass);
  }

  panel.querySelectorAll('.export-btn').forEach(button => {
    if (button.id === 'share-btn') return;
    button.addEventListener('click', async () => {
      const kind = button.dataset.export;
      if (kind === 'svg_map') {
        const { exportTrackSVG } = await import('./svg-export.js');
        await exportTrackSVG(storm.id);
        return;
      }
      const exports = buildExports(storm);
      if (exports[kind]) downloadBlob(exports[kind]);
    });
  });

  const shareButton = document.getElementById('share-btn');
  if (shareButton) {
    shareButton.addEventListener('click', async () => {
      const url = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'HurricaneMap', url });
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        showToast(t('toast.linkCopied'));
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try { document.execCommand('copy'); showToast(t('toast.linkCopied')); }
        catch { showToast(t('toast.copyFailed'), 'warn'); }
        document.body.removeChild(textarea);
      }
    });
  }

  const playButton = document.getElementById('play-anim-btn');
  if (playButton) {
    const playLabel = playButton.querySelector('.play-label');
    const syncPlayButton = (state = {}) => {
      const isThisStorm = state.stormId === storm.id;
      const activeForThisStorm = isThisStorm && state.active;
      const playing = isThisStorm && state.playing;
      const paused = isThisStorm && (state.paused || state.ended);
      document.body.classList.toggle('track-playback-active', activeForThisStorm);
      if (!activeForThisStorm) leavePlaybackMapMode({ restore: true });
      playButton.classList.toggle('is-playing', playing);
      playButton.classList.toggle('is-paused', paused);
      playButton.setAttribute('aria-pressed', String(playing));
      playButton.title = playing ? t('panel.pauseTrack') : paused ? t('panel.resumeTrack') : t('panel.playTrack');
      if (playLabel) playLabel.textContent = playing ? t('panel.pauseTrack') : paused ? t('panel.resumeTrack') : t('panel.playTrack');
    };

    playButton.addEventListener('click', async () => {
      const animator = getAnimator();
      if (animator.isActiveFor(storm.id)) {
        animator.togglePause();
        syncPlayButton(animator.getPlaybackState());
        return;
      }
      playButton.disabled = true;
      if (playLabel) playLabel.textContent = t('panel.loadingPlayback');
      try {
        enterPlaybackMapMode();
        await animator.play(storm, {
          onStateChange: syncPlayButton,
          onEnd: () => syncPlayButton(animator.getPlaybackState()),
        });
      } catch (error) {
        console.error('Failed to start track animation:', error);
        showToast(t('toast.playbackFailed'), 'warn');
        syncPlayButton({ active: false });
      } finally {
        playButton.disabled = false;
        syncPlayButton(animator.getPlaybackState());
      }
    });
  }

  panel.querySelectorAll('.radar-quick-btn').forEach(button => {
    button.addEventListener('click', () => {
      const index = parseInt(button.dataset.lfIdx, 10);
      getRadar().show(storm, index);
    });
  });

  const pinButton = document.getElementById('pin-btn');
  if (pinButton) {
    pinButton.addEventListener('click', async () => {
      try {
        const nowPinned = await togglePin(storm);
        pinButton.classList.toggle('pinned', nowPinned);
        pinButton.querySelector('.pin-label').textContent = nowPinned ? 'Pinned' : 'Pin to compare';
      } catch (error) {
        console.error('Failed to toggle pin:', error);
        showToast(t('toast.pinFailed'), 'warn');
      }
    });
  }

  const windFieldCheckbox = document.getElementById('wf-cb');
  if (windFieldCheckbox) {
    windFieldCheckbox.addEventListener('change', () => {
      if (windFieldCheckbox.checked) showWindField(storm);
      else hideWindField();
    });
  }

  wireAdvisoryReplay(storm, advisoryReplay);

  const coneEnabled = document.getElementById('cone-retro-enabled');
  const coneEra = document.getElementById('cone-retro-era');
  const coneEllipse = document.getElementById('cone-retro-ellipse');
  const coneStatus = document.getElementById('cone-retro-status');
  if (coneEnabled && coneEra && coneEllipse && coneStatus) {
    const syncCone = async () => {
      coneEra.disabled = !coneEnabled.checked;
      coneEllipse.disabled = !coneEnabled.checked;
      if (!coneEnabled.checked) {
        clearRetrospectiveCone();
        coneStatus.textContent = '';
        return;
      }
      coneStatus.textContent = t('coneRetro.loading');
      const result = await renderRetrospectiveCone(storm, {
        map: getMap(),
        era: coneEra.value,
        ellipse: coneEllipse.checked,
      });
      coneStatus.textContent = result.status === 'rendered'
        ? t('coneRetro.ready', result.sampleCount)
        : result.status === 'error' ? t('coneRetro.error') : '';
    };
    coneEnabled.addEventListener('change', syncCone);
    coneEra.addEventListener('change', syncCone);
    coneEllipse.addEventListener('change', syncCone);
    syncCone();
  }

  const artEnabled = document.getElementById('art-mode-enabled');
  const artEra = document.getElementById('art-mode-era');
  const artStatus = document.getElementById('art-mode-status');
  if (artEnabled && artEra && artStatus) {
    const syncArt = async () => {
      artEra.disabled = !artEnabled.checked;
      if (!artEnabled.checked) {
        clearRiskTrajectories();
        artStatus.textContent = '';
        return;
      }
      artStatus.textContent = t('art.loading');
      const result = await renderRiskTrajectories(storm, { map: getMap(), era: artEra.value });
      artStatus.textContent = result.status === 'rendered'
        ? t(result.reduced ? 'art.readyStatic' : 'art.ready', result.pathCount)
        : result.status === 'error' ? t('art.error') : '';
    };
    artEnabled.addEventListener('change', syncArt);
    artEra.addEventListener('change', syncArt);
  }
}
