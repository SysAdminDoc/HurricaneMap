// P10.5 — Active-season timelapse: play through all 6-hourly track points for a selected season at variable speed

import { getStorm, getLandfalls } from './data.js';
import { showTrack, clearTracks } from './map.js';

let timelapseActive = false;
let timelapseAnimationId = null;
let currentTrackIndex = 0;
let currentPointIndex = 0;
let allTrackPoints = [];
let playSpeed = 1; // 1x = 1 frame per 100ms, 2x = 1 frame per 50ms, 4x = 1 frame per 25ms

const controls = document.getElementById('timelapse-controls');
const playBtn = controls?.querySelector('.timelapse-play');
const pauseBtn = controls?.querySelector('.timelapse-pause');
const stopBtn = controls?.querySelector('.timelapse-stop');
const speedControl = controls?.querySelector('.timelapse-speed');
const progressLabel = controls?.querySelector('.timelapse-progress');

if (playBtn) playBtn.addEventListener('click', startTimelapse);
if (pauseBtn) pauseBtn.addEventListener('click', pauseTimelapse);
if (stopBtn) stopBtn.addEventListener('click', stopTimelapse);
if (speedControl) speedControl.addEventListener('change', (e) => {
  playSpeed = parseInt(e.target.value, 10);
});

export function maybeShowTimelapseControls(filters) {
  // Show timelapse controls only if a single year (season) is selected
  if (!controls) return;
  
  const isSeasonSelected = filters.yearMin === filters.yearMax;
  controls.hidden = !isSeasonSelected;
  
  if (isSeasonSelected) {
    const year = filters.yearMin;
    const landfalls = getLandfalls().filter(lf => lf.year === year);
    const storms = [...new Set(landfalls.map(lf => lf.storm_id))];
    const label = `${storms.length} storm${storms.length !== 1 ? 's' : ''} in ${year}`;
    const seasonLabel = controls?.querySelector('.timelapse-season');
    if (seasonLabel) seasonLabel.textContent = label;
  }
}

async function startTimelapse() {
  if (timelapseActive) return;
  timelapseActive = true;
  
  // Collect all track points for selected year
  const filters = window.filters || {};
  if (filters.yearMin !== filters.yearMax) return; // Only works with single year
  
  const year = filters.yearMin;
  const landfalls = getLandfalls().filter(lf => lf.year === year);
  const stormIds = [...new Set(landfalls.map(lf => lf.storm_id))];
  
  allTrackPoints = [];
  const tracksByStorm = {};
  
  for (const stormId of stormIds) {
    const storm = await getStorm(stormId);
    if (!storm || !storm.track) continue;
    tracksByStorm[stormId] = storm.track;
    allTrackPoints.push(...storm.track.map((pt, idx) => ({ stormId, idx, pt })));
  }
  
  if (allTrackPoints.length === 0) return;
  
  // Sort by date (assuming track points are in chronological order per storm)
  allTrackPoints.sort((a, b) => {
    const aDate = new Date(a.pt.timestamp || 0);
    const bDate = new Date(b.pt.timestamp || 0);
    return aDate - bDate;
  });
  
  // Show tracks for this season
  clearTracks();
  for (const stormId of stormIds) {
    showTrack(stormId, { weight: 1.5, opacity: 0.3 });
  }
  
  currentPointIndex = 0;
  animateTimelapse();
}

function animateTimelapse() {
  if (!timelapseActive || currentPointIndex >= allTrackPoints.length) {
    stopTimelapse();
    return;
  }
  
  const { pt } = allTrackPoints[currentPointIndex];
  // Update visible point marker on map
  highlightTimelapsePoint(pt);
  
  // Update progress
  const progress = Math.round((currentPointIndex / allTrackPoints.length) * 100);
  if (progressLabel) progressLabel.textContent = `${progress}%`;
  
  currentPointIndex++;
  
  // Frame delay based on speed: 1x = 100ms, 2x = 50ms, 4x = 25ms
  const frameDelay = 100 / playSpeed;
  timelapseAnimationId = setTimeout(animateTimelapse, frameDelay);
}

function highlightTimelapsePoint(pt) {
  // Draw a marker or highlight at the current point
  // For now, just log it
  // In a full implementation, would draw a moving marker on the map
  console.debug('Timelapse point', pt);
}

function pauseTimelapse() {
  if (timelapseAnimationId) {
    clearTimeout(timelapseAnimationId);
    timelapseAnimationId = null;
  }
  timelapseActive = false;
}

function stopTimelapse() {
  pauseTimelapse();
  clearTracks();
  currentPointIndex = 0;
  allTrackPoints = [];
  if (progressLabel) progressLabel.textContent = '0%';
}
