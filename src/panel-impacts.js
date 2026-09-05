// Storm impacts and the outbound source links that sit beside them.
//
// Split out of panel.js, which was pinned at its 800-line ceiling: every
// routine edit had to be paid for by deleting a comment somewhere else, which
// is the opposite of what the budget is for.
import { getBillionsFor, getImpactsFor, getMetadata, isDatasetAvailable, windToCategory } from './data.js';
import { escapeHtml, formatStormName, safeExternalUrl } from './html-utils.js';
import { t } from './i18n.js';
import {
  getDamageMillions,
  getRawDamageText,
  getRawFatalityText,
} from './impact-utils.js';
import {
  BILLIONS_DATASET_STATUS, NCEI_BILLIONS_DATASET_ID,
  formatMillionsUSD, inflateUSD, seriesEndYear,
} from './inflation.js';
import { getBundledDatasetState, getBundledDatasetStatus } from './optional-feeds.js';
import { getSetting } from './settings.js';

// Wikipedia article URL — best-effort. Tries the standard article naming pattern;
// the user's browser will redirect if Wikipedia has a different canonical title.
export function wikipediaUrl(storm) {
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

export function youtubeUrl(storm) {
  const niceName = (!storm.name || storm.name === 'UNNAMED')
    ? `${storm.year} hurricane`
    : `${formatStormName(storm.name)} ${storm.year}`;
  const peakCat = windToCategory(storm.peak_wind_kt);
  const kind = peakCat >= 1 ? 'hurricane' : 'tropical storm';
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${kind} ${niceName} landfall`)}`;
}

export function noaaTcrUrl(storm) {
  // NOAA Tropical Cyclone Reports: only published from ~1958 onward, and well-indexed from 1995+.
  if (storm.year < 1995) return null;
  // The NHC "data" archive supports yearly indices.
  return `https://www.nhc.noaa.gov/data/tcr/index.php?season=${storm.year}&basin=atl`;
}

export function renderImpactsBlock(storm, im = getImpactsFor(storm.id)) {
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
    const cite = billionsStatus.retirement_citation;
    const link = (url, key) => (url ? sources.push(`<a href="${url}" target="_blank" rel="noopener">${t(key)}</a>`) : null);
    link(safeExternalUrl(cite?.url), 'impacts.nceiRetirementSource');
    link(safeExternalUrl(cite?.successor?.url), 'impacts.nceiSuccessorSource');
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
export function reconArchiveUrl(storm) {
  if (storm.basin !== 'AL') return null;
  if (storm.year < 1989) return null;  // Tropical Atlantic archive thins out before this
  if (!storm.name || storm.name === 'UNNAMED') return null;
  const name = formatStormName(storm.name);
  // Tropical Atlantic uses a per-storm storm-archive page indexed by name+year.
  return `https://tropicalatlantic.com/recon/?archive=${storm.year}&storm=${encodeURIComponent(name)}`;
}

export function nhcWalletUrlFor(storm) {
  // NHC storm wallet: 1995-onward, numbered AL/EPxxYYYY.
  if (storm.year < 1995) return null;
  return `https://www.nhc.noaa.gov/archive/${storm.year}/${storm.id}.shtml`;
}

/** Open the storm's first U.S. landfall on CIRA's RAMMB SLIDER. SLIDER carries
 *  GOES-16 (East) imagery from late 2017 onward. We pin to the storm's first
 *  landfall time so the user lands on the eyewall over the coast. */
export function sliderSatelliteUrl(storm) {
  if (storm.year < 2018) return null;
  const lfs = storm.us_landfalls || [];
  const refIso = lfs.length ? lfs[0].t : storm.track[0]?.t;
  if (!refIso) return null;
  const ts = new Date(refIso);
  // SLIDER takes Unix seconds and a sector. CONUS sector is the right scale
  // for U.S. landfalls; tropical-atlantic for storms still over open ocean.
  const unix = Math.floor(ts.getTime() / 1000);
  // GOES-19 replaced goes-16 as East on 2025-04-07; Hawaii needs GOES-18.
  const isHawaii = lfs.length && lfs[0].state === 'Hawaii';
  const sat = isHawaii ? 'goes-18' : 'goes-19';
  const sec = isHawaii ? 'full_disk' : 'conus';
  // GeoColor is most legible day-and-night. Canonical CIRA host only.
  return `https://slider.cira.colostate.edu/?sat=${sat}&sec=${sec}&start_unix=${unix}&time_step=10&motion=loop&im=12`;
}