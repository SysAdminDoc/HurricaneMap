import {
  hasActiveFilters,
  isYearFiltered,
  resetPrimaryFilters,
  resetYearRange,
  setYearRange,
  toggleCategory,
} from './filter-state.js';

export function createFilterController({
  filters,
  elements,
  yearDefaults,
  applyFilters,
  openState,
  setSurgeCategory,
  setPopulation,
  loadSST,
  resetTrackCache,
}) {
  const sync = () => {
    const defaults = yearDefaults();
    if (elements.yearMin) elements.yearMin.value = String(filters.yearMin);
    if (elements.yearMax) elements.yearMax.value = String(filters.yearMax);
    document.querySelector('.filter-row--year')?.classList.toggle(
      'active-filter',
      isYearFiltered(filters, defaults),
    );
    elements.catBtns.forEach(button => {
      const on = filters.categories.has(button.dataset.cat);
      button.classList.toggle('active', on);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    if (elements.stateFilter) elements.stateFilter.value = filters.state;
    if (elements.showTracks) elements.showTracks.checked = filters.showTracks;
    if (elements.showHeatmap) elements.showHeatmap.checked = filters.showHeatmap;
    if (elements.showRetiredOnly) elements.showRetiredOnly.checked = filters.retiredOnly;
  };

  const updateResetState = () => {
    if (!elements.resetFilters) return;
    const active = hasActiveFilters(filters, yearDefaults(), {
      surgeCategory: elements.surgeCategory?.value,
      showPopulation: elements.showPopulation?.checked,
      showSST: elements.showSST?.checked,
    });
    elements.resetFilters.disabled = !active;
    elements.resetFilters.title = active ? 'Reset all filters and map layers' : 'No active filters';
  };

  const resetYears = () => {
    resetYearRange(filters, yearDefaults());
    sync();
    applyFilters();
  };

  const wire = () => {
    const onYearChange = () => {
      if (setYearRange(filters, elements.yearMin.value, elements.yearMax.value, yearDefaults())) {
        applyFilters();
      }
    };
    elements.yearMin?.addEventListener('change', onYearChange);
    elements.yearMax?.addEventListener('change', onYearChange);
    for (const input of [elements.yearMin, elements.yearMax]) {
      input?.addEventListener('keydown', event => {
        if (event.key === 'Escape') resetYears();
      });
    }
    elements.clearYearFilter?.addEventListener('click', resetYears);

    for (const button of elements.catBtns) {
      button.setAttribute('aria-pressed', String(button.classList.contains('on')));
      button.addEventListener('click', () => {
        const on = toggleCategory(filters, button.dataset.cat);
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', String(on));
        applyFilters();
      });
    }

    elements.stateFilter?.addEventListener('change', () => {
      filters.state = elements.stateFilter.value;
      applyFilters();
      if (filters.state) openState(filters.state);
    });
    elements.showTracks?.addEventListener('change', () => {
      filters.showTracks = elements.showTracks.checked;
      applyFilters();
    });
    elements.showHeatmap?.addEventListener('change', () => {
      filters.showHeatmap = elements.showHeatmap.checked;
      applyFilters();
    });
    elements.showRetiredOnly?.addEventListener('change', () => {
      filters.retiredOnly = elements.showRetiredOnly.checked;
      applyFilters();
    });
    elements.surgeCategory?.addEventListener('change', () => {
      const value = Number.parseInt(elements.surgeCategory.value, 10);
      setSurgeCategory(Number.isFinite(value) && value > 0 ? value : null);
    });
    elements.showPopulation?.addEventListener('change', () => {
      setPopulation(elements.showPopulation.checked);
    });
    elements.showSST?.addEventListener('change', async () => {
      const { setSSTVisible } = await loadSST();
      setSSTVisible(elements.showSST.checked);
      updateResetState();
    });
    elements.resetFilters?.addEventListener('click', async () => {
      resetPrimaryFilters(filters, yearDefaults());
      sync();
      elements.surgeCategory.value = '';
      elements.showPopulation.checked = false;
      setSurgeCategory(null);
      setPopulation(false);
      if (elements.showSST?.checked) {
        elements.showSST.checked = false;
        const { setSSTVisible } = await loadSST();
        setSSTVisible(false);
      }
      resetTrackCache();
      applyFilters();
    });
  };

  return { sync, updateResetState, wire };
}
