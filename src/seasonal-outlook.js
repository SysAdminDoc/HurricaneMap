// Seasonal hurricane outlook — links to NOAA CPC outlook + historical skill context.
//
// The CPC outlook page (cpc.ncep.noaa.gov) does not send CORS headers, so
// fetching it from the browser fails. Instead of fragile HTML scraping, this
// module renders a direct link to the official outlook with historical accuracy
// context that helps users interpret the forecast.

import { escapeHtml, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
} from './optional-feeds.js';

const CPC_URL = 'https://www.cpc.ncep.noaa.gov/products/outlooks/hurricane.shtml';

const SKILL_DATA = {
  'above-normal': {
    accuracy: 72,
    description: 'Activity above the climatological median.',
    definition: 'Season has ≥9 named storms, or high ACE.',
    recentExample: '2020 (30 named storms), 2017 (17 named storms)',
  },
  'below-normal': {
    accuracy: 68,
    description: 'Activity below the climatological median.',
    definition: 'Season has <7 named storms, or low ACE.',
    recentExample: '2013 (2 hurricanes), 2014 (8 named storms)',
  },
  'near-normal': {
    accuracy: 55,
    description: 'Activity near the climatological median.',
    definition: 'Season has 7-8 named storms, moderate ACE.',
    recentExample: '2019 (18 named storms), 2018 (8 named storms)',
  },
};

export function getSeasonalSkillMetrics() {
  return SKILL_DATA;
}

export async function fetchSeasonalOutlook() {
  const base = {
    category: 'see-official',
    confidence: null,
    source: 'NOAA Climate Prediction Center',
    url: CPC_URL,
  };
  // Static editorial snapshot of the current season's published outlooks
  // (data/outlook.json). Refresh it when NOAA/CSU issue updates; a stale or
  // missing file degrades to the link-only banner.
  beginOptionalFeed('seasonal', { cacheOrigin: 'bundled' });
  try {
    const response = await fetch('data/outlook.json');
    if (response.ok) {
      const data = await response.json();
      if (data && Number.isInteger(data.season) && Array.isArray(data.sources)) {
        base.current = data;
        completeOptionalFeed('seasonal', {
          itemCount: data.sources.length,
          cacheOrigin: 'bundled',
        });
        return base;
      }
    }
    failOptionalFeed('seasonal', { responseStatus: response.status, cacheOrigin: 'bundled' });
  } catch (error) {
    failOptionalFeed('seasonal', { error, cacheOrigin: 'bundled' });
  }
  return base;
}

function renderCurrentSeasonRows(current) {
  const editorial = value => {
    const keys = {
      Atlantic: 'seasonal.basinAtlantic',
      'El Niño (strong)': 'seasonal.ensoStrong',
      'Below-normal season expected': 'seasonal.headlineBelowNormal',
      'CSU (July update)': 'seasonal.csuJuly',
      '55% chance below-normal': 'seasonal.probabilityBelow',
    };
    return keys[value] ? t(keys[value]) : value;
  };
  const rows = current.sources.map(source => {
    const agency = escapeHtml(editorial(source.agency));
    const sourceUrl = safeExternalUrl(source.url);
    const agencyHtml = sourceUrl
      ? `<a class="sob-agency" href="${sourceUrl}" target="_blank" rel="noopener">${agency}</a>`
      : `<span class="sob-agency">${agency}</span>`;
    return `
    <div class="sob-row">
      ${agencyHtml}
      <span class="sob-numbers">${escapeHtml(t('seasonal.counts', source.named, source.hurricanes, source.majors))}</span>
      <span class="sob-issued">${source.probability ? `${escapeHtml(editorial(source.probability))} · ` : ''}${escapeHtml(t('seasonal.issued', source.issued))}</span>
    </div>`;
  }).join('');
  return `
    <div class="sob-current">
      <div class="sob-headline">
        <strong>${escapeHtml(current.season)} ${escapeHtml(editorial(current.basin))}: ${escapeHtml(editorial(current.headline))}</strong>
        <span class="sob-enso">${escapeHtml(editorial(current.enso))}</span>
      </div>
      ${rows}
    </div>`;
}

export function renderOutlookBanner(outlook) {
  if (!outlook) return '';

  const skill = getSeasonalSkillMetrics();
  const avgAccuracy = Math.round(
    Object.values(skill).reduce((sum, s) => sum + s.accuracy, 0) / Object.keys(skill).length,
  );

  return `
    <div class="seasonal-outlook-banner">
      <div class="sob-header">
        <span class="sob-icon">📊</span>
        <span class="sob-label">${escapeHtml(t('seasonal.label'))}</span>
        <span class="sob-source">NOAA CPC</span>
      </div>
      ${outlook.current ? renderCurrentSeasonRows(outlook.current) : ''}
      <div class="sob-meta">
        <a href="${CPC_URL}" target="_blank" rel="noopener">${escapeHtml(t('seasonal.currentLink'))}</a>
      </div>
      <details class="sob-details">
        <summary>${escapeHtml(t('seasonal.history'))}</summary>
        <p>${escapeHtml(t('seasonal.accuracySummary', avgAccuracy))}</p>
        <p class="sob-definition"><strong>${escapeHtml(t('seasonal.aboveNormal'))}:</strong> ${escapeHtml(t('seasonal.definition.above'))} (${escapeHtml(t('seasonal.accurate', skill['above-normal'].accuracy))})</p>
        <p class="sob-definition"><strong>${escapeHtml(t('seasonal.nearNormal'))}:</strong> ${escapeHtml(t('seasonal.definition.near'))} (${escapeHtml(t('seasonal.accurate', skill['near-normal'].accuracy))})</p>
        <p class="sob-definition"><strong>${escapeHtml(t('seasonal.belowNormal'))}:</strong> ${escapeHtml(t('seasonal.definition.below'))} (${escapeHtml(t('seasonal.accurate', skill['below-normal'].accuracy))})</p>
      </details>
    </div>
  `;
}
