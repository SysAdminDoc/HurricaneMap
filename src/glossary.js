import { escapeHtml } from './html-utils.js';

// Glossary management — meteorological and hurricane terminology.
//
// Glossary data is fetched from data/glossary.json on first use.
// UI includes a searchable modal with term definitions and tooltips
// throughout the app.

let glossaryData = null;
let glossaryCache = {};

/** Fetch and cache the glossary. */
export async function loadGlossary() {
  if (glossaryData) return glossaryData;
  try {
    const resp = await fetch('./data/glossary.json');
    if (!resp.ok) throw new Error(`glossary.json: ${resp.status}`);
    glossaryData = await resp.json();
    // Build lookup map for quick access
    glossaryData.forEach(item => {
      glossaryCache[item.term.toLowerCase()] = item;
    });
    return glossaryData;
  } catch (err) {
    console.error('Failed to load glossary:', err);
    return [];
  }
}

/** Get a single glossary entry by term. */
export function getGlossaryEntry(term) {
  return glossaryCache[term.toLowerCase()] || null;
}

/** Search glossary by term or definition. */
export function searchGlossary(query) {
  if (!glossaryData || glossaryData.length === 0) return [];
  const q = query.toLowerCase();
  return glossaryData.filter(item =>
    item.term.toLowerCase().includes(q) ||
    item.definition.toLowerCase().includes(q)
  );
}

/** Initialize glossary modal and event listeners. */
export async function initGlossary() {
  await loadGlossary();
  
  // Create glossary modal if it doesn't exist
  if (document.getElementById('glossary-modal')) return;
  
  const modal = document.createElement('div');
  modal.id = 'glossary-modal';
  modal.className = 'glass glossary-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'glossary-title');
  modal.innerHTML = `
    <div class="glossary-content">
      <div class="glossary-header">
        <h2 id="glossary-title">Meteorology glossary</h2>
        <button class="close-btn" id="close-glossary" title="Close glossary" aria-label="Close glossary">×</button>
      </div>
      <input type="search" id="glossary-search" class="glossary-search" placeholder="Search terms or definitions" aria-label="Search glossary" />
      <div id="glossary-list" class="glossary-list"></div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Wire up search
  const searchInput = document.getElementById('glossary-search');
  const glossaryList = document.getElementById('glossary-list');
  const closeBtn = document.getElementById('close-glossary');
  
  const renderList = (items = glossaryData) => {
    if (!items.length) {
      glossaryList.innerHTML = `
        <div class="empty-state glossary-empty">
          <strong>No glossary match.</strong>
          <span>Try a broader term such as wind, pressure, eyewall, surge, or ACE.</span>
        </div>`;
      return;
    }
    glossaryList.innerHTML = items.map(item => `
      <div class="glossary-item">
        <h3 class="glossary-term">${escapeHtml(item.term)}</h3>
        <p class="glossary-definition">${escapeHtml(item.definition)}</p>
      </div>
    `).join('');
  };
  
  renderList();
  
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    const results = query ? searchGlossary(query) : glossaryData;
    renderList(results);
  });
  
  closeBtn.addEventListener('click', () => {
    modal.hidden = true;
    searchInput.value = '';
    renderList();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.hidden = true;
      searchInput.value = '';
      renderList();
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) {
      modal.hidden = true;
      searchInput.value = '';
      renderList();
    }
  });
}

/** Show the glossary modal. */
export function showGlossary() {
  const modal = document.getElementById('glossary-modal');
  if (modal) modal.hidden = false;
  const searchInput = document.getElementById('glossary-search');
  if (searchInput) searchInput.focus();
}
