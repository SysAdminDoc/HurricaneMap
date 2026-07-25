import { SAVED_VIEWS_SCHEMA_VERSION, createVersionedRecord } from './schema-contract.js';

const STORAGE_KEY = 'hm-saved-views-v1';
const MAX_VIEWS = 20;
const MAX_NAME = 60;
const MAX_HASH = 2048;

export function normalizeSavedView(view) {
  if (!view || typeof view !== 'object') return null;
  const name = String(view.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
  const hash = String(view.hash || '');
  if (!name || hash.length > MAX_HASH || !/^#v=1(?:&|$)/.test(hash)) return null;
  return {
    id: /^[a-z0-9-]{1,80}$/i.test(view.id || '') ? view.id : createId(),
    name,
    hash,
    created_at: validDate(view.created_at) ? view.created_at : new Date().toISOString(),
  };
}

export function migrateSavedViewsRecord(record) {
  if (Array.isArray(record)) {
    return { value: normalizeList(record), status: 'legacy', shouldPersist: true };
  }
  if (!record || typeof record !== 'object') {
    return { value: [], status: 'invalid', shouldPersist: false };
  }
  if (record.schema_version !== SAVED_VIEWS_SCHEMA_VERSION) {
    return { value: [], status: 'unsupported', shouldPersist: false };
  }
  return { value: normalizeList(record.views), status: 'current', shouldPersist: false };
}

export function loadSavedViews() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const migration = migrateSavedViewsRecord(JSON.parse(raw));
    if (migration.shouldPersist) persist(migration.value);
    return migration.value;
  } catch {
    return [];
  }
}

export function saveCurrentView(name, hash) {
  const view = normalizeSavedView({ name, hash });
  if (!view) return null;
  const views = [view, ...loadSavedViews().filter(item => item.name !== view.name)].slice(0, MAX_VIEWS);
  persist(views);
  return view;
}

export function deleteSavedView(id) {
  const views = loadSavedViews();
  const next = views.filter(view => view.id !== id);
  if (next.length === views.length) return false;
  persist(next);
  return true;
}

export function exportSavedViews() {
  return JSON.stringify(
    createVersionedRecord(SAVED_VIEWS_SCHEMA_VERSION, 'views', loadSavedViews()),
    null,
    2,
  );
}

function normalizeList(views) {
  if (!Array.isArray(views)) return [];
  return views.map(normalizeSavedView).filter(Boolean).slice(0, MAX_VIEWS);
}

function persist(views) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(
      createVersionedRecord(SAVED_VIEWS_SCHEMA_VERSION, 'views', normalizeList(views)),
    ));
  } catch { /* storage remains optional */ }
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
