// Offline-first household hurricane preparedness checklist and supply sizing.
// State is device-local and intentionally contains no addresses or account data.

import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { hidePanel, showPanel } from './panels.js';

const STORAGE_KEY = 'hm-prep-v1';
const MAX_HOUSEHOLD = 20;

export const PREP_ITEMS = [
  ['water', 'basics'], ['food', 'basics'], ['radio', 'basics'], ['flashlight', 'basics'],
  ['batteries', 'basics'], ['canOpener', 'basics'], ['firstAid', 'medical'],
  ['medications', 'medical'], ['medicalDevices', 'medical'], ['chargers', 'medical'],
  ['hygiene', 'household'], ['cash', 'household'], ['documents', 'documents'],
  ['contacts', 'documents'], ['petSupplies', 'needs'], ['infantSupplies', 'needs'],
];

const ITEM_IDS = new Set(PREP_ITEMS.map(([id]) => id));

export function normalizePrepState(value) {
  const source = value && typeof value === 'object' ? value : {};
  const household = Math.min(MAX_HOUSEHOLD, Math.max(1, Math.round(Number(source.household) || 1)));
  const mode = source.mode === 'home' ? 'home' : 'go';
  const checked = [...new Set(Array.isArray(source.checked) ? source.checked.filter(id => ITEM_IDS.has(id)) : [])];
  return { household, mode, checked };
}

export function calculatePrepSupplies(household, mode = 'go') {
  const people = Math.min(MAX_HOUSEHOLD, Math.max(1, Math.round(Number(household) || 1)));
  const days = mode === 'home' ? 14 : 3;
  const waterGallons = people * days;
  return {
    people,
    days,
    waterGallons,
    waterLiters: Math.round(waterGallons * 3.785),
    foodPersonDays: people * days,
  };
}

function loadState() {
  try { return normalizePrepState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return normalizePrepState(null); }
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePrepState(state))); }
  catch { /* private mode / storage quota — checklist still works for this view */ }
}

let state = null;
let wired = false;

function getPanel() { return document.getElementById('prep-panel'); }

function itemRows() {
  const checked = new Set(state.checked);
  const groups = new Map();
  for (const [id, category] of PREP_ITEMS) {
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(id);
  }
  return [...groups.entries()].map(([category, ids]) => `
    <fieldset class="prep-group">
      <legend>${escapeHtml(t(`prep.category.${category}`))}</legend>
      ${ids.map(id => `<label class="prep-item"><input type="checkbox" data-prep-item="${id}"${checked.has(id) ? ' checked' : ''}><span>${escapeHtml(t(`prep.item.${id}`))}</span></label>`).join('')}
    </fieldset>
  `).join('');
}

export function renderPrepPanel() {
  const body = document.getElementById('prep-body');
  if (!body) return;
  if (!state) state = loadState();
  const supplies = calculatePrepSupplies(state.household, state.mode);
  const completed = state.checked.length;
  const percentage = Math.round(completed / PREP_ITEMS.length * 100);
  body.innerHTML = `
    <header class="prep-header">
      <p>${escapeHtml(t('prep.intro'))}</p>
      <div class="prep-sources"><a href="https://www.ready.gov/kit" target="_blank" rel="noopener">Ready.gov</a><a href="https://www.redcross.org/get-help/how-to-prepare-for-emergencies/survival-kit-supplies.html" target="_blank" rel="noopener">American Red Cross</a></div>
    </header>
    <section class="prep-calculator" aria-labelledby="prep-calculator-title">
      <h3 id="prep-calculator-title">${escapeHtml(t('prep.calculator'))}</h3>
      <div class="prep-inputs">
        <label>${escapeHtml(t('prep.household'))}<input id="prep-household" type="number" inputmode="numeric" min="1" max="${MAX_HOUSEHOLD}" value="${supplies.people}"></label>
        <label>${escapeHtml(t('prep.plan'))}<select id="prep-mode"><option value="go"${state.mode === 'go' ? ' selected' : ''}>${escapeHtml(t('prep.goKit'))}</option><option value="home"${state.mode === 'home' ? ' selected' : ''}>${escapeHtml(t('prep.homeKit'))}</option></select></label>
      </div>
      <div class="prep-totals" role="status" aria-live="polite">
        <div><strong>${supplies.waterGallons}</strong><span>${escapeHtml(t('prep.gallonsWater'))}</span><small>${supplies.waterLiters} L</small></div>
        <div><strong>${supplies.foodPersonDays}</strong><span>${escapeHtml(t('prep.personDaysFood'))}</span><small>${escapeHtml(t('prep.forDays', supplies.days))}</small></div>
      </div>
      <p class="prep-note">${escapeHtml(t('prep.waterNote'))}</p>
    </section>
    <section class="prep-checklist" aria-labelledby="prep-checklist-title">
      <div class="prep-checklist-heading"><h3 id="prep-checklist-title">${escapeHtml(t('prep.checklist'))}</h3><strong>${completed}/${PREP_ITEMS.length}</strong></div>
      <div class="prep-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${PREP_ITEMS.length}" aria-valuenow="${completed}" aria-label="${escapeHtml(t('prep.progress'))}"><span style="width:${percentage}%"></span></div>
      ${itemRows()}
      <button class="text-btn prep-reset" id="prep-reset" type="button">${escapeHtml(t('prep.reset'))}</button>
    </section>
    <p class="prep-caveat">${escapeHtml(t('prep.caveat'))}</p>
  `;
}

function ensureWired() {
  if (wired) return;
  const panel = getPanel();
  if (!panel) return;
  wired = true;
  document.getElementById('close-prep')?.addEventListener('click', () => hidePanel('prep-panel'));
  panel.addEventListener('change', event => {
    if (!state) state = loadState();
    const target = event.target;
    if (target.id === 'prep-household') state.household = target.value;
    else if (target.id === 'prep-mode') state.mode = target.value;
    else if (target.matches('[data-prep-item]')) {
      const checked = new Set(state.checked);
      if (target.checked) checked.add(target.dataset.prepItem);
      else checked.delete(target.dataset.prepItem);
      state.checked = [...checked];
    }
    state = normalizePrepState(state);
    saveState(state);
    renderPrepPanel();
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('#prep-reset')) {
      state = { ...normalizePrepState(state), checked: [] };
      saveState(state);
      renderPrepPanel();
    }
  });
  document.addEventListener('hm-locale:change', () => {
    if (!panel.hidden) renderPrepPanel();
  });
}

export function openPrepPanel() {
  state = loadState();
  ensureWired();
  renderPrepPanel();
  showPanel('prep-panel');
}
