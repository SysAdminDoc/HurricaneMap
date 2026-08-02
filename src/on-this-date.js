// "On this date in history" sidebar — show storms that made US landfalls
// within ±7 days of today's calendar date across the entire historical record.

import { ensureStormsLoaded, getLandfalls, formatTime, categoryLabel, categoryClass, ktToMph } from './data.js';
import { showStorm } from './panel.js';
import { hidePanel, showPanel } from './panels.js';
import { formatWind } from './settings.js';
import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { calendarDistanceDays, isWithinDaysOfToday } from './on-this-date-utils.js';

const panel = document.getElementById('on-this-date-panel');
const body = document.getElementById('on-this-date-body');
const closeBtn = document.getElementById('close-on-this-date');

closeBtn.addEventListener('click', () => {
  hidePanel('on-this-date-panel');
});

document.addEventListener('hm-locale:change', () => {
  if (!panel.hidden) showOnThisDate();
});

/** Compute ISO month-day string (e.g., "09-15" for September 15). */
function getMonthDay(dateStr) {
  const d = new Date(dateStr);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${m}-${day}`;
}

function formatCalendarOffset(days) {
  if (days === 0) return t('onthisdate.offsetToday');
  const abs = Math.abs(days);
  return days > 0 ? t('onthisdate.offsetIn', abs) : t('onthisdate.offsetAgo', abs);
}

export async function showOnThisDate() {
  showPanel('on-this-date-panel');
  body.innerHTML = `<div class="state-loading">${t('onthisdate.loading')}</div>`;
  
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
          const stormName = lf.name && lf.name !== 'UNNAMED'
            ? lf.name
            : t('onthisdate.unnamedYear', lf.year);
          const daysFromToday = calendarDistanceDays(lf.t, todayMonthDay);
          const state = escapeHtml(lf.state || t('state.unknown'));
          return `
            <li class="otd-item">
              <div class="otd-header">
                <span class="otd-year">${lf.year}</span>
                <button class="otd-link" data-storm-id="${lf.storm_id}" title="${escapeHtml(t('onthisdate.showDetails'))}">
                  <strong>${escapeHtml(stormName)}</strong> ${t('onthisdate.atState', state)}
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
