import {
  categoryLabel,
  ensureStormsLoaded,
  getLandfalls,
  getStorm,
  searchStorms,
} from './data.js';
import { fuzzyAugment } from './fuzzy.js';
import { escapeHtml, formatStormName } from './html-utils.js';
import { t } from './i18n.js';
import { getHistory } from './search-history.js';
import { buildSparkline } from './sparkline.js';

export function initSearchController({ input, results, onSelect }) {
  if (!input || !results || typeof onSelect !== 'function') return () => {};
  let activeIndex = -1;

  const setOpen = (open) => {
    results.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      activeIndex = -1;
      results.classList.remove('search-results--empty');
      input.removeAttribute('aria-activedescendant');
      results.querySelectorAll('[aria-selected="true"]')
        .forEach(element => element.setAttribute('aria-selected', 'false'));
    }
  };

  const getOptions = () => [...results.querySelectorAll('li[data-storm-id]')];

  const updateActiveOption = (nextIndex) => {
    const options = getOptions();
    if (!options.length) return;
    activeIndex = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
      const active = index === activeIndex;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
      if (!option.id) option.id = `search-option-${option.dataset.stormId}-${index}`;
      if (active) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const backfillSparklines = () => {
    ensureStormsLoaded().then(() => {
      for (const host of results.querySelectorAll('.search-result-spark-host')) {
        const storm = getStorm(host.dataset.stormId);
        if (storm?.track) {
          host.innerHTML = buildSparkline(storm.track, {
            title: `${storm.name || 'Storm'} ${storm.year || ''} wind profile`,
          });
        }
      }
    }).catch(() => { /* search remains usable without optional sparklines */ });
  };

  const wireResultClicks = () => {
    for (const option of getOptions()) {
      option.addEventListener('click', () => {
        const landfalls = getLandfalls();
        const landfall = landfalls.find(item =>
          item.storm_id === option.dataset.stormId &&
          item.t === option.dataset.t &&
          String(item.lat) === option.dataset.lat
        ) || landfalls.find(item => item.storm_id === option.dataset.stormId);
        if (landfall) onSelect(landfall);
        setOpen(false);
        input.value = '';
      });
    }
  };

  const renderRow = (landfall) => {
    const stormId = escapeHtml(landfall.storm_id);
    return `<li data-storm-id="${stormId}" data-t="${escapeHtml(landfall.t)}" data-lat="${escapeHtml(landfall.lat)}" data-lon="${escapeHtml(landfall.lon)}" role="option" tabindex="-1">
      <span class="search-result-spark-host" data-storm-id="${stormId}" aria-hidden="true"></span>
      <span class="search-result-text"><strong>${escapeHtml(landfall.year)}</strong> ${escapeHtml(formatStormName(landfall.name))} <span class="search-result-meta">· ${escapeHtml(categoryLabel(landfall.category))} ${escapeHtml(landfall.state || '')}</span></span>
    </li>`;
  };

  const showHistory = () => {
    const history = getHistory();
    if (!history.length) return false;
    results.classList.remove('search-results--empty');
    results.innerHTML = `<li class="search-section-label" aria-hidden="true">${t('search.recent')}</li>${history.map(renderRow).join('')}`;
    setOpen(true);
    backfillSparklines();
    wireResultClicks();
    return true;
  };

  const showEmpty = (query) => {
    results.classList.add('search-results--empty');
    results.innerHTML = `
      <li class="search-empty" role="status">
        <strong>${t('search.noMatch', escapeHtml(query.trim()))}</strong>
        <span>${t('search.help')}</span>
      </li>`;
    setOpen(true);
  };

  input.addEventListener('focus', () => { ensureStormsLoaded(); }, { once: true });
  input.addEventListener('focus', () => {
    if (!input.value.trim()) showHistory();
  });
  input.addEventListener('keydown', event => {
    if (results.hidden) return;
    const options = getOptions();
    if (!options.length) {
      if (event.key === 'Escape') setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      updateActiveOption(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      updateActiveOption(activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      options[activeIndex].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  });
  input.addEventListener('input', () => {
    const query = input.value;
    if (!query.trim()) {
      if (!showHistory()) {
        setOpen(false);
        results.innerHTML = '';
      }
      return;
    }
    const exact = searchStorms(query, getLandfalls());
    const fuzzy = exact.length < 5
      ? fuzzyAugment(query, getLandfalls(), exact, { limit: 5 })
      : [];
    if (!exact.length && !fuzzy.length) {
      showEmpty(query);
      return;
    }
    results.classList.remove('search-results--empty');
    setOpen(true);
    results.innerHTML = exact.map(renderRow).join('') +
      (fuzzy.length
        ? `<li class="search-section-label" aria-hidden="true">${t('search.suggest')}</li>${fuzzy.map(renderRow).join('')}`
        : '');
    updateActiveOption(0);
    backfillSparklines();
    wireResultClicks();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => setOpen(false), 180);
  });

  return () => setOpen(false);
}
