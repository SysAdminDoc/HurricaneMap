// Search controller — owns the search input, result rendering, history dropdown,
// keyboard navigation (arrow/enter/escape), and fuzzy augmentation.
// Extracted from main.js (Phase D decomposition).

import { searchStorms, categoryLabel, ensureStormsLoaded, getStorm, getLandfalls } from './data.js';
import { buildSparkline } from './sparkline.js';
import { fuzzyAugment } from './fuzzy.js';
import { getHistory } from './search-history.js';
import { escapeHtml, formatStormName } from './html-utils.js';

/**
 * Wire the search input, results list, and all keyboard interactions.
 *
 * @param {{
 *   searchInput: HTMLInputElement,
 *   searchResults: HTMLElement,
 *   onSelect: (landfall: object) => void,
 * }} opts
 */
export function wireSearch({ searchInput, searchResults, onSelect }) {
  let activeIndex = -1;

  function setOpen(open) {
    searchResults.hidden = !open;
    searchInput.setAttribute('aria-expanded', String(open));
    if (!open) {
      activeIndex = -1;
      searchInput.removeAttribute('aria-activedescendant');
      searchResults.querySelectorAll('[aria-selected="true"]').forEach(el => el.setAttribute('aria-selected', 'false'));
    }
  }

  function getOptions() {
    return [...searchResults.querySelectorAll('li[data-storm-id]')];
  }

  function updateActiveOption(nextIndex) {
    const options = getOptions();
    if (!options.length) return;
    activeIndex = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
      const active = index === activeIndex;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
      if (!option.id) option.id = `search-option-${option.dataset.stormId}-${index}`;
      if (active) {
        searchInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function showHistoryDropdown() {
    const history = getHistory();
    if (!history.length) return;
    setOpen(true);
    searchResults.innerHTML = `<li class="search-section-label" aria-hidden="true">Recently viewed</li>` +
      history.map(h => {
        const name = escapeHtml(formatStormName(h.name));
        const cat = escapeHtml(categoryLabel(h.category));
        const state = escapeHtml(h.state || '');
        const stormId = escapeHtml(h.storm_id);
        return `<li data-storm-id="${stormId}" data-t="${escapeHtml(h.t)}" data-lat="${escapeHtml(h.lat)}" data-lon="${escapeHtml(h.lon)}" role="option" tabindex="-1">
          <span class="search-result-spark-host" data-storm-id="${stormId}" aria-hidden="true"></span>
          <span class="search-result-text"><strong>${escapeHtml(h.year)}</strong> ${name} <span class="search-result-meta">· ${cat} ${state}</span></span>
        </li>`;
      }).join('');
    backfillSparklines(searchResults);
    wireResultClicks(searchResults, onSelect, setOpen, searchInput);
  }

  function showNoResults(query) {
    const safeQuery = escapeHtml(query.trim());
    setOpen(true);
    searchResults.innerHTML = `
      <li class="search-empty" role="status">
        <strong>No storm matches "${safeQuery}"</strong>
        <span>Try a storm name, state, or year, such as Andrew, Florida, or 2005.</span>
      </li>
    `;
  }

  // Warm the storms cache as soon as the user focuses the search input so that
  // sparklines can render without a perceptible lag on the first keystroke.
  searchInput.addEventListener('focus', () => { ensureStormsLoaded(); }, { once: true });

  // History dropdown when input is focused with empty value.
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) return;
    showHistoryDropdown();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (searchResults.hidden) return;
    const options = getOptions();
    if (!options.length) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateActiveOption(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateActiveOption(activeIndex - 1);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      options[activeIndex].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    if (!q.trim()) {
      const history = getHistory();
      if (history.length) { showHistoryDropdown(); return; }
      setOpen(false);
      searchResults.innerHTML = '';
      return;
    }
    let results = searchStorms(q, getLandfalls());
    let fuzzy = [];
    if (results.length < 5) {
      fuzzy = fuzzyAugment(q, getLandfalls(), results, { limit: 5 });
    }
    if (!results.length && !fuzzy.length) {
      showNoResults(q);
      return;
    }
    setOpen(true);
    let html = results.map(renderRow).join('');
    if (fuzzy.length) {
      html += `<li class="search-section-label" aria-hidden="true">Did you mean…</li>`;
      html += fuzzy.map(renderRow).join('');
    }
    searchResults.innerHTML = html;
    updateActiveOption(0);
    backfillSparklines(searchResults);
    wireResultClicks(searchResults, onSelect, setOpen, searchInput);
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => { setOpen(false); }, 180);
  });
}

// --- helpers -----------------------------------------------------------------

function renderRow(lf) {
  const name = formatStormName(lf.name);
  const cat = categoryLabel(lf.category);
  const safeName = escapeHtml(name);
  const safeState = escapeHtml(lf.state || '');
  const safeStormId = escapeHtml(lf.storm_id);
  return `<li data-storm-id="${safeStormId}" data-t="${escapeHtml(lf.t)}" data-lat="${escapeHtml(lf.lat)}" data-lon="${escapeHtml(lf.lon)}" role="option" tabindex="-1">
    <span class="search-result-spark-host" data-storm-id="${safeStormId}" aria-hidden="true"></span>
    <span class="search-result-text"><strong>${escapeHtml(lf.year)}</strong> ${safeName} <span class="search-result-meta">· ${escapeHtml(cat)} ${safeState}</span></span>
  </li>`;
}

function backfillSparklines(container) {
  ensureStormsLoaded().then(() => {
    for (const host of container.querySelectorAll('.search-result-spark-host')) {
      const storm = getStorm(host.dataset.stormId);
      if (storm && storm.track) {
        host.innerHTML = buildSparkline(storm.track, { title: `${storm.name || 'Storm'} ${storm.year || ''} wind profile` });
      }
    }
  });
}

function wireResultClicks(container, onSelect, setOpen, searchInput) {
  for (const li of container.querySelectorAll('li[data-storm-id]')) {
    li.addEventListener('click', () => {
      const lf = getLandfalls().find(x =>
        x.storm_id === li.dataset.stormId &&
        x.t === li.dataset.t &&
        String(x.lat) === li.dataset.lat
      ) || getLandfalls().find(x => x.storm_id === li.dataset.stormId);
      if (lf) onSelect(lf);
      setOpen(false);
      searchInput.value = '';
    });
  }
}
