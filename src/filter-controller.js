import { getDateLocale, t } from './i18n.js';
import {
  excludingFilterNames,
  hasActiveFilters,
  isYearFiltered,
  resetExcludingFilters,
  applyFilterState,
  captureFilterState,
  resetPrimaryFilters,
  resetYearRange,
  setYearRange,
  toggleCategory,
} from './filter-state.js';

/** "year range and state", in the reader's language. */
function listFormat(items) {
  if (typeof Intl?.ListFormat === 'function') {
    return new Intl.ListFormat(getDateLocale(), { style: 'long', type: 'conjunction' }).format(items);
  }
  return items.join(', ');
}

/**
 * What to say when the filters exclude everything. A blank map under "0 of 759"
 * reads as a broken app, and every other surface in here already had an empty
 * state; this was the one that did not.
 *
 * The filters responsible are named rather than summarised, because the reader
 * has to know which control to undo.
 */
export function renderEmptyFilterState(isEmpty, filters, defaults) {
  const host = document.getElementById('filter-empty');
  const message = document.getElementById('filter-empty-message');
  if (!host || !message) return;
  if (!isEmpty) {
    host.hidden = true;
    message.textContent = '';
    return;
  }
  const labels = excludingFilterNames(filters, defaults).map(name => t(`filters.emptyName.${name}`));
  message.textContent = labels.length
    ? t('filters.emptyWithFilters', listFormat(labels))
    : t('filters.emptyNoFilters');
  const reset = host.querySelector('#filter-empty-reset');
  if (reset) reset.hidden = labels.length === 0;
  host.hidden = false;
}

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
    elements.resetFilters.title = t(active ? 'filters.resetTitleActive' : 'filters.resetTitleIdle');
  };

  const populateStateFilter = (byState = {}) => {
    if (!elements.stateFilter) return;
    const allStatesOption = elements.stateFilter.querySelector('option[value=""]');
    elements.stateFilter.replaceChildren(...(allStatesOption ? [allStatesOption] : []));
    for (const state of Object.keys(byState).sort()) {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = `${state} (${byState[state].total})`;
      elements.stateFilter.appendChild(option);
    }
    elements.stateFilter.value = filters.state;
  };

  // Held for the rest of the session rather than for a few seconds: the reader
  // who realises they wanted their filters back is usually the one who has
  // already looked at the map for a while.
  let undoSnapshot = null;

  const readLayerControls = () => ({
    surgeCategory: elements.surgeCategory?.value ?? '',
    showPopulation: Boolean(elements.showPopulation?.checked),
    showSST: Boolean(elements.showSST?.checked),
  });

  const showUndo = (visible) => {
    if (elements.undoResetFilters) elements.undoResetFilters.hidden = !visible;
  };

  /**
   * The one part of a reset or an undo that needs a chunk fetched, kept last
   * and kept off the path everything else takes.
   *
   * loadSST memoises its promise including a rejection, so a single failed
   * fetch poisons it for the session. Awaiting it in the middle of the reset
   * handler meant an unreachable chunk destroyed nine pieces of state and then
   * threw before the undo control was ever shown: the snapshot existed and
   * nothing could reach it. The undo handler had it worse, awaiting on every
   * undo including one restoring "off", stranding applyFilters and leaving a
   * visible button that had already cleared its own snapshot.
   */
  const applySeaSurfaceLayer = (visible, { wasOn = true } = {}) => {
    // Nothing to turn off that was never on: asking for the chunk then would
    // download it on a visit that never enabled the layer, which the reset
    // handler did for every reader once this moved out of its guard.
    if (!elements.showSST || (!visible && !wasOn)) return;
    loadSST()
      .then(({ setSSTVisible }) => setSSTVisible(visible))
      .catch(error => {
        console.error('Sea-surface layer unavailable:', error);
        // Same rule as the checkbox's own handler: a box left ticked over a
        // layer that will never arrive is a lie, and the reset button goes on
        // counting it.
        if (!visible) return;
        elements.showSST.checked = false;
        updateResetState();
      });
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
    elements.showSST?.addEventListener('change', () => {
      const visible = elements.showSST.checked;
      updateResetState();
      loadSST()
        .then(({ setSSTVisible }) => setSSTVisible(visible))
        .catch(error => {
          // The import is memoised including its rejection, so a box left
          // ticked over a layer that will never arrive stays a lie for the
          // rest of the session, and the reset button keeps counting it.
          console.error('Sea-surface layer unavailable:', error);
          elements.showSST.checked = false;
          updateResetState();
        });
    });
    // The empty state's own control. It clears only the filters that can
    // exclude a landfall and leaves the map layers alone, which is what its
    // message promises.
    document.getElementById('filter-empty-reset')?.addEventListener('click', () => {
      resetExcludingFilters(filters, yearDefaults());
      sync();
      resetTrackCache();
      applyFilters();
      document.getElementById('toggle-filters')?.focus({ preventScroll: true });
    });
    elements.resetFilters?.addEventListener('click', () => {
      // One click clears nine pieces of state and then disables the button, so
      // without this there was no way back to what the reader had built.
      undoSnapshot = captureFilterState(filters, readLayerControls());
      resetPrimaryFilters(filters, yearDefaults());
      sync();
      elements.surgeCategory.value = '';
      elements.showPopulation.checked = false;
      setSurgeCategory(null);
      setPopulation(false);
      if (elements.showSST) elements.showSST.checked = false;
      resetTrackCache();
      applyFilters();
      showUndo(true);
      applySeaSurfaceLayer(false, { wasOn: undoSnapshot.showSST });
    });

    elements.undoResetFilters?.addEventListener('click', () => {
      if (!undoSnapshot) return;
      // Read before the checkbox is reassigned: turning a layer off that was
      // never on has nothing to do, and asking for its chunk to do nothing
      // downloads it on a visit that never used it.
      const seaSurfaceWasOn = Boolean(elements.showSST?.checked);
      const layers = applyFilterState(filters, undoSnapshot);
      undoSnapshot = null;
      sync();
      elements.surgeCategory.value = layers.surgeCategory;
      elements.showPopulation.checked = layers.showPopulation;
      const surge = Number.parseInt(layers.surgeCategory, 10);
      setSurgeCategory(Number.isFinite(surge) && surge > 0 ? surge : null);
      setPopulation(layers.showPopulation);
      if (elements.showSST) elements.showSST.checked = layers.showSST;
      resetTrackCache();
      applyFilters();
      showUndo(false);
      elements.resetFilters?.focus({ preventScroll: true });
      applySeaSurfaceLayer(layers.showSST, { wasOn: seaSurfaceWasOn });
    });
  };

  return { sync, updateResetState, populateStateFilter, wire };
}
