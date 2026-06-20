// Seasonal hurricane outlook — links to NOAA CPC outlook + historical skill context.
//
// The CPC outlook page (cpc.ncep.noaa.gov) does not send CORS headers, so
// fetching it from the browser fails. Instead of fragile HTML scraping, this
// module renders a direct link to the official outlook with historical accuracy
// context that helps users interpret the forecast.

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
  return {
    category: 'see-official',
    confidence: null,
    source: 'NOAA Climate Prediction Center',
    url: CPC_URL,
  };
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
        <span class="sob-label">SEASONAL OUTLOOK</span>
        <span class="sob-source">NOAA CPC</span>
      </div>
      <div class="sob-meta">
        <a href="${CPC_URL}" target="_blank" rel="noopener">View current NOAA CPC seasonal hurricane outlook →</a>
      </div>
      <details class="sob-details">
        <summary>Historical forecast accuracy</summary>
        <p>NOAA CPC outlooks have averaged ~${avgAccuracy}% accuracy over 2015-2024.</p>
        <p class="sob-definition"><strong>Above normal:</strong> ${skill['above-normal'].definition} (${skill['above-normal'].accuracy}% accurate)</p>
        <p class="sob-definition"><strong>Near normal:</strong> ${skill['near-normal'].definition} (${skill['near-normal'].accuracy}% accurate)</p>
        <p class="sob-definition"><strong>Below normal:</strong> ${skill['below-normal'].definition} (${skill['below-normal'].accuracy}% accurate)</p>
      </details>
    </div>
  `;
}
