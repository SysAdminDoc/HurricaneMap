// The storm panel's analysis section: the similar-storms list and the
// days-at-intensity bar.
//
// Split out of panel.js, which has a line budget test:shell-boundaries enforces
// precisely so the renderer does not become the place everything lands. Both of
// these render into a host element and wire their own interaction, so neither
// needs anything from the panel's own state.
import { ensureStormsLoaded, getStorm, categoryLabel, categoryClass, windToCategory } from './data.js';
import { daysAtIntensity } from './metrics.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { getDateLocale, t } from './i18n.js';
import { showToast } from './panel-controls.js';

// onSelect rather than an import of showStorm: that lives in panel.js, which
// imports this module, and the cycle left showStorm undefined at click time.
export function renderSimilarStorms(host, similarStorms, onSelect) {
  if (!host || !Array.isArray(similarStorms) || similarStorms.length === 0) {
    if (host) host.innerHTML = `
      <div class="panel-empty-state">
        <strong>${t('panel.noCloseMatches')}</strong>
        <span>${t('panel.unusualStorm')}</span>
      </div>`;
    return;
  }
  const rows = similarStorms.map(s => {
    const score = (s.similarity_score * 100).toFixed(0);
    const cat = categoryLabel(windToCategory(s.peak_wind_kt || 0));
    const cls = categoryClass(windToCategory(s.peak_wind_kt || 0));
    // A button rather than a listener on an <li>: the rows had cursor:pointer and
    // no tabindex, no role and no key handling, so a keyboard reader could not
    // reach any of them.
    return `<li><button type="button" class="similar-storm-row">
      <span class="similar-storm-name">${escapeHtml(formatStormName(s.name, { unnamed: t('storm.unnamed') }))} (${s.year})</span>
      <span class="similar-storm-cat cat-pill ${cls}" title="${t('table.trackPeak')}">${cat}</span>
      <span class="similar-storm-landfalls" title="${t('panel.landfallCountLabel')}">${s.landfalls === 1 ? t('panel.similarLandfallsOne', s.landfalls) : t('panel.similarLandfallsMany', s.landfalls)}</span>
      <span class="similar-storm-score" title="${escapeHtml(t('panel.similarityScoreTitle'))}">${score}%</span>
    </button></li>`;
  }).join('');
  host.innerHTML = `<ul class="similar-storms-list">${rows}</ul>`;
  
  // Wire clicks to show that storm (find its first landfall in data)
  host.querySelectorAll('.similar-storm-row').forEach((row, idx) => {
    row.addEventListener('click', async () => {
      const similar = similarStorms[idx];
      await ensureStormsLoaded();
      const targetStorm = getStorm(similar.storm_id);
      const landfall = targetStorm?.us_landfalls?.[0];
      if (!landfall) {
        // Every similar storm in this list has at least one U.S. landfall, since
        // the catalog is built from them, but a row that cannot open anything
        // must say so rather than swallow the click.
        showToast(t('panel.similarUnavailable'), 'warn');
        return;
      }
      // A us_landfalls record has no storm_id of its own, and no name or year
      // either, so passing one straight through left the panel looking up an
      // undefined storm and the view history discarding the entry for having no
      // year. It carries its parent's identity now.
      onSelect({
        ...landfall,
        storm_id: similar.storm_id,
        name: targetStorm.name,
        year: targetStorm.year,
      });
    });
  });
}

// Days-at-intensity stacked horizontal bar. Visualizes how many hours of
// the storm's life were spent in each Saffir-Simpson tier — gives an
// at-a-glance sense of "long Cat-4 grinder" vs "brief brushing TS".
// A span of track time in the reader's own language. These labels were built
// by hand as `${days.toFixed(1)} d` and `${Math.round(hrs)} h`, so the unit was
// the English abbreviation whatever language the panel was in: a Spanish reader
// read "3.2 d" and a Creole reader read the same. Intl.DurationFormat carries
// the units for every locale, and it is asked through getDateLocale() for the
// same reason dates are, because ICU has no data for `ht` and would otherwise
// fall back to the browser's language.
//
// Baseline 2025-03-04. Below the floor the old hand-built form is kept, which
// is wrong in the same way it always was rather than newly broken.
function formatTrackDuration(hours) {
  const whole = Math.max(0, Math.round(hours));
  const days = Math.floor(whole / 24);
  const rest = whole % 24;
  if (typeof Intl.DurationFormat !== 'function') {
    return days >= 1 ? `${(whole / 24).toFixed(1)} d` : `${rest} h`;
  }
  const parts = {};
  if (days) parts.days = days;
  if (rest || !days) parts.hours = rest;
  return new Intl.DurationFormat(getDateLocale(), { style: 'narrow' }).format(parts);
}

export function renderDaysAtIntensity(host, track) {
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
    host.innerHTML = `<div class="dai-empty">${t('panel.noTierTrack')}</div>`;
    return;
  }
  const parts = order.filter(tier => buckets[tier.k] > 0).map(tier => {
    const hrs = buckets[tier.k];
    const pct = (hrs / total) * 100;
    return { tier, pct, dayStr: formatTrackDuration(hrs) };
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
      <span class="dai-total">${t('panel.daysTotalTracked', formatTrackDuration(total))}</span>
    </div>
  `;
}
