import { escapeHtml, formatStormName } from './html-utils.js';
import { t } from './i18n.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';

const DATA_URL = new URL('../data/forecast-skill.json', import.meta.url);
let dataPromise = null;

export async function loadForecastSkill() {
  if (!dataPromise) {
    dataPromise = fetchWithTimeout(DATA_URL, {}, REQUEST_TIMEOUT_MS.data).then(response => {
      if (!response.ok) throw new Error(`Forecast skill data returned ${response.status}`);
      return response.json();
    }).catch(error => {
      dataPromise = null;
      throw error;
    });
  }
  return dataPromise;
}

export function basinForStorm(storm) {
  return storm?.basin === 'EP' ? 'EP' : 'AL';
}

function sourceLink(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

export function renderForecastSkillData(host, storm, data) {
  if (!host) return;
  const basin = data?.basins?.[basinForStorm(storm)];
  if (!basin?.rows?.length) {
    host.innerHTML = `<p class="forecast-skill-error">${escapeHtml(t('forecastSkill.error'))}</p>`;
    return;
  }

  const basinLabel = t(`forecastSkill.basin.${basinForStorm(storm)}`);
  const scope = t('forecastSkill.scope', basinLabel, data.period.label, data.model);
  const rows = basin.rows.map(row => {
    const samples = row.trackSampleSize === row.intensitySampleSize
      ? String(row.trackSampleSize)
      : `${row.trackSampleSize} / ${row.intensitySampleSize}`;
    return `<tr>
      <th scope="row">${escapeHtml(t('forecastSkill.hours', row.leadHours))}</th>
      <td>${escapeHtml(row.trackErrorNmi.toFixed(1))}</td>
      <td>${escapeHtml(row.intensityErrorKt.toFixed(1))}</td>
      <td>${escapeHtml(samples)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `<section class="forecast-skill-control" aria-labelledby="forecast-skill-title">
    <div class="forecast-skill-heading">
      <h3 id="forecast-skill-title">${escapeHtml(t('forecastSkill.title'))}</h3>
      <span class="forecast-skill-badge">${escapeHtml(t('forecastSkill.measured'))}</span>
    </div>
    <p class="forecast-skill-scope">${escapeHtml(scope)}</p>
    <p>${escapeHtml(t('forecastSkill.explainer', formatStormName(storm?.name || 'this storm')))}</p>
    <div class="forecast-skill-table-wrap">
      <table class="forecast-skill-table">
        <caption class="sr-only">${escapeHtml(scope)}</caption>
        <thead><tr>
          <th scope="col">${escapeHtml(t('forecastSkill.lead'))}</th>
          <th scope="col">${escapeHtml(t('forecastSkill.track'))}</th>
          <th scope="col">${escapeHtml(t('forecastSkill.intensity'))}</th>
          <th scope="col">${escapeHtml(t('forecastSkill.sample'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="forecast-skill-definition">${escapeHtml(t('forecastSkill.definition'))}</p>
    <p class="forecast-skill-date">${escapeHtml(t('forecastSkill.bestTrack', data.bestTrackAsOf))}</p>
    <p class="forecast-skill-sources">
      ${sourceLink(data.sources.summary, t('forecastSkill.summarySource'))}
      · ${sourceLink(basin.url, t('forecastSkill.errorSource'))}
      · ${sourceLink(data.sources.methodology, t('forecastSkill.methodsSource'))}
    </p>
  </section>`;
}

export async function renderForecastSkill(host, storm) {
  if (!host) return;
  host.innerHTML = `<p class="forecast-skill-loading" role="status">${escapeHtml(t('forecastSkill.loading'))}</p>`;
  try {
    renderForecastSkillData(host, storm, await loadForecastSkill());
  } catch {
    host.innerHTML = `<p class="forecast-skill-error" role="status">${escapeHtml(t('forecastSkill.error'))}</p>`;
  }
}
