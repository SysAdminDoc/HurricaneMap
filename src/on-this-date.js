// "On this date in history" sidebar — show storms that made US landfalls
// within ±7 days of today's calendar date across the entire historical record.

import { ensureStormsLoaded, getLandfalls, formatTime, categoryLabel, categoryClass, ktToMph } from './data.js';
import { showStorm } from './panel.js';
import { hidePanel, showPanel } from './panels.js';
import { formatWind } from './settings.js';
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';

const panel = document.getElementById('on-this-date-panel');
const body = document.getElementById('on-this-date-body');
const closeBtn = document.getElementById('close-on-this-date');

closeBtn.addEventListener('click', () => {
  hidePanel('on-this-date-panel');
});

/** Compute ISO month-day string (e.g., "09-15" for September 15). */
function getMonthDay(dateStr) {
  const d = new Date(dateStr);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${m}-${day}`;
}

/** Check if a landfall date is within ±7 days of the given month-day. */
function isWithinDaysOfToday(lfDate, targetMonthDay, daysOffset = 7) {
  const lfDateObj = new Date(lfDate);
  const lfMonth = lfDateObj.getUTCMonth();
  const lfDay = lfDateObj.getUTCDate();
  
  const targetParts = targetMonthDay.split('-');
  const targetMonth = parseInt(targetParts[0], 10) - 1;
  const targetDay = parseInt(targetParts[1], 10);
  
  // Day-of-year distance (0-365, wraps at year boundary)
  // Create dates in a leap year (2024) to handle Feb 29 correctly
  const lfDoyDate = new Date(2024, lfMonth, lfDay);
  const targetDoyDate = new Date(2024, targetMonth, targetDay);
  const lfDoy = Math.floor((lfDoyDate - new Date(2024, 0, 1)) / (24 * 60 * 60 * 1000));
  const targetDoy = Math.floor((targetDoyDate - new Date(2024, 0, 1)) / (24 * 60 * 60 * 1000));
  
  let diff = Math.abs(lfDoy - targetDoy);
  // Wrap around year boundary (365/366 days)
  const daysInYear = 366; // 2024 is a leap year
  if (diff > daysInYear / 2) {
    diff = daysInYear - diff;
  }
  return diff <= daysOffset;
}

function calendarDistanceDays(lfDate, targetMonthDay) {
  const lfDateObj = new Date(lfDate);
  const lfMonth = lfDateObj.getUTCMonth();
  const lfDay = lfDateObj.getUTCDate();
  const [targetMonthRaw, targetDayRaw] = targetMonthDay.split('-').map(Number);
  const lfDoyDate = new Date(2024, lfMonth, lfDay);
  const targetDoyDate = new Date(2024, targetMonthRaw - 1, targetDayRaw);
  const lfDoy = Math.floor((lfDoyDate - new Date(2024, 0, 1)) / (24 * 60 * 60 * 1000));
  const targetDoy = Math.floor((targetDoyDate - new Date(2024, 0, 1)) / (24 * 60 * 60 * 1000));
  const raw = lfDoy - targetDoy;
  if (raw > 183) return raw - 366;
  if (raw < -183) return raw + 366;
  return raw;
}

function formatCalendarOffset(days) {
  if (days === 0) return 'today';
  const abs = Math.abs(days);
  return days > 0 ? `in ${abs}d` : `${abs}d ago`;
}

export async function showOnThisDate() {
  showPanel('on-this-date-panel');
  body.innerHTML = '<div class="state-loading">Finding historical landfalls near today...</div>';
  
  await ensureStormsLoaded();
  const landfalls = getLandfalls();
  const today = new Date();
  const todayMonthDay = getMonthDay(today.toISOString());
  
  // Find all landfalls within ±7 days of today
  const matchingLandfalls = landfalls.filter(lf => isWithinDaysOfToday(lf.t, todayMonthDay, 7));
  
  // Sort by year (newest first, then by date)
  matchingLandfalls.sort((a, b) => {
    const aDiff = Math.abs(a.year - today.getFullYear());
    const bDiff = Math.abs(b.year - today.getFullYear());
    if (aDiff !== bDiff) return aDiff - bDiff; // Closer years first
    return new Date(b.t) - new Date(a.t);
  });
  
  if (matchingLandfalls.length === 0) {
    body.innerHTML = `
      <div class="otd-content">
        <h2>${t('onthisdate.title')}</h2>
        <div class="empty-state">
          <strong>${t('onthisdate.empty')}</strong>
          <span>${t('onthisdate.emptyDetail', todayMonthDay)}</span>
        </div>
      </div>
    `;
    return;
  }
  
  const html = `
    <div class="otd-content">
      <h2>${t('onthisdate.title')}</h2>
      <p class="otd-meta">${t('onthisdate.meta', todayMonthDay)}</p>
      <ul class="otd-list">
        ${matchingLandfalls.map(lf => {
          const cat = categoryLabel(lf.category);
          const cls = categoryClass(lf.category);
          const wind = formatWind(lf.wind);
          const date = formatTime(lf.t);
          const stormName = lf.storm_name && lf.storm_name !== 'UNNAMED'
            ? lf.storm_name
            : `${lf.year} unnamed`;
          const daysFromToday = calendarDistanceDays(lf.t, todayMonthDay);
          return `
            <li class="otd-item">
              <div class="otd-header">
                <span class="otd-year">${lf.year}</span>
                <button class="otd-link" data-storm-id="${lf.storm_id}" title="Show full storm details">
                  <strong>${escapeHtml(stormName)}</strong> at ${escapeHtml(lf.state || 'Unknown')}
                </button>
              </div>
              <div class="otd-details">
                <span class="cat-pill ${cls}">${cat}</span>
                <span class="otd-wind">${wind}</span>
                <span class="otd-date">${date}</span>
                <span class="otd-days">${formatCalendarOffset(daysFromToday)}</span>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;
  
  body.innerHTML = html;
  
  // Wire up storm-link clicks
  body.querySelectorAll('.otd-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const stormId = btn.dataset.stormId;
      const lf = landfalls.find(x => x.storm_id === stormId);
      if (lf) showStorm(lf);
    });
  });
}
