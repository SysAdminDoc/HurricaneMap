import { escapeHtml } from './html-utils.js';
import { t } from './i18n.js';
import { activateDialogFocus } from './dialog-focus.js';
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from './network.js';
import {
  beginOptionalFeed,
  completeOptionalFeed,
  failOptionalFeed,
  isOptionalFeedRequestCurrent,
} from './optional-feeds.js';
import { mountOptionalFeedStatus } from './optional-feed-ui.js';

// Glossary management — meteorological and hurricane terminology.
//
// Glossary data is fetched from data/glossary.json on first use.
// UI includes a searchable modal with term definitions and tooltips
// throughout the app.

let glossaryData = null;
let glossaryCache = {};
let releaseGlossaryFocus = null;

let glossaryLoad = null;

/**
 * Fetch and cache the glossary.
 *
 * Concurrent callers share one load. Two rapid opens used to start two: the
 * second superseded the first, the first returned an empty array, and whichever
 * built the modal first built it with no terms while the other found the modal
 * already there and returned without rendering. The reader saw "No matching
 * terms" until they typed something.
 */
export async function loadGlossary() {
  if (glossaryData) {
    completeOptionalFeed('glossary', {
      cacheOrigin: 'memory',
      itemCount: glossaryData.length,
    });
    return glossaryData;
  }
  if (!glossaryLoad) {
    // Cleared when it settles, so a failed load can be retried.
    glossaryLoad = loadGlossaryOnce().finally(() => { glossaryLoad = null; });
  }
  return glossaryLoad;
}

async function loadGlossaryOnce() {
  const request = beginOptionalFeed('glossary', { cacheOrigin: 'bundled' });
  try {
    const resp = await fetchWithTimeout('./data/glossary.json', {}, REQUEST_TIMEOUT_MS.data);
    if (!resp.ok) {
      const error = new Error(`glossary.json: ${resp.status}`);
      error.responseStatus = resp.status;
      throw error;
    }
    const data = await resp.json();
    if (!Array.isArray(data) || data.some(item => !item || typeof item.term !== 'string' || typeof item.definition !== 'string')) {
      throw new SyntaxError('glossary response is malformed');
    }
    if (!isOptionalFeedRequestCurrent('glossary', request.requestId)) return glossaryData || [];
    glossaryData = data;
    // Build lookup map for quick access
    glossaryData.forEach(item => {
      glossaryCache[item.term.toLowerCase()] = item;
    });
    completeOptionalFeed('glossary', {
      cacheOrigin: 'bundled',
      itemCount: glossaryData.length,
      requestId: request.requestId,
    });
    return glossaryData;
  } catch (err) {
    if (!isOptionalFeedRequestCurrent('glossary', request.requestId)) return glossaryData || [];
    failOptionalFeed('glossary', {
      error: err,
      responseStatus: err.responseStatus || 0,
      cacheOrigin: 'bundled',
      requestId: request.requestId,
    });
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
        <h2 id="glossary-title">${t('glossary.title')}</h2>
        <button class="close-btn" id="close-glossary" title="Close glossary" aria-label="Close glossary">×</button>
      </div>
      <input type="search" id="glossary-search" class="glossary-search" placeholder="${t('glossary.searchPlaceholder')}" aria-label="${t('glossary.title')}" />
      <p class="content-language-note" data-content-language="en">${t('content.englishSource')}</p>
      <div id="glossary-list" class="glossary-list"></div>
    </div>
  `;
  document.body.appendChild(modal);
  const statusHost = document.createElement('div');
  statusHost.id = 'glossary-feed-status';
  statusHost.className = 'optional-feed-status-overlay glass';
  document.body.appendChild(statusHost);
  
  // Wire up search
  const searchInput = document.getElementById('glossary-search');
  const glossaryList = document.getElementById('glossary-list');
  const closeBtn = document.getElementById('close-glossary');
  
  const renderList = (items = glossaryData || []) => {
    if (!items.length) {
      glossaryList.innerHTML = `
        <div class="empty-state glossary-empty">
          <strong>${t('glossary.noResults')}</strong>
          <span>Try a broader term such as wind, pressure, eyewall, surge, or ACE.</span>
        </div>`;
      return;
    }
    glossaryList.innerHTML = items.map(item => `
      <div class="glossary-item" lang="${escapeHtml(item.language)}">
        <h3 class="glossary-term">${escapeHtml(item.term)}</h3>
        <p class="glossary-definition">${escapeHtml(item.definition)}</p>
      </div>
    `).join('');
  };
  
  renderList();
  mountOptionalFeedStatus(statusHost, 'glossary', {
    onRetry: async () => {
      const data = await loadGlossary();
      renderList(data);
      return data;
    },
  });
  
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    const results = query ? searchGlossary(query) : (glossaryData || []);
    renderList(results);
  });
  
  const closeGlossary = () => {
    modal.hidden = true;
    searchInput.value = '';
    renderList();
    releaseGlossaryFocus?.();
    releaseGlossaryFocus = null;
  };

  closeBtn.addEventListener('click', closeGlossary);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeGlossary();
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) {
      e.preventDefault();
      closeGlossary();
    }
  });
}

/** Show the glossary modal. */
export function showGlossary() {
  const modal = document.getElementById('glossary-modal');
  if (!modal) return;
  modal.hidden = false;
  releaseGlossaryFocus = activateDialogFocus(modal, { initialFocus: '#glossary-search' });
}
