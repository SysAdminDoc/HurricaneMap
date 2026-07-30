import { SAVED_VIEWS_SCHEMA_VERSION, createVersionedRecord } from './schema-contract.js';

export const SAVED_VIEWS_STORAGE_KEY = 'hm-saved-views-v1';
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

export function loadSavedViews(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SAVED_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const migration = migrateSavedViewsRecord(JSON.parse(raw));
    if (migration.shouldPersist) persist(migration.value, storage);
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

export function validateSavedViewsImport(input) {
  let record;
  try {
    record = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    return { ok: false, status: 'malformed', views: [], errors: [importError('$', 'malformed')] };
  }
  const legacy = Array.isArray(record);
  if (!legacy && (!record || typeof record !== 'object')) {
    return { ok: false, status: 'invalid', views: [], errors: [importError('$', 'object')] };
  }
  if (!legacy && record.schema_version !== SAVED_VIEWS_SCHEMA_VERSION) {
    return {
      ok: false,
      status: record.schema_version > SAVED_VIEWS_SCHEMA_VERSION ? 'future-version' : 'unsupported',
      views: [],
      errors: [importError('$.schema_version', 'schema')],
    };
  }
  const candidates = legacy ? record : record.views;
  if (!Array.isArray(candidates)) {
    return { ok: false, status: 'invalid', views: [], errors: [importError('$.views', 'array')] };
  }
  if (candidates.length > MAX_VIEWS) {
    return { ok: false, status: 'invalid', views: [], errors: [importError('$.views', 'limit')] };
  }
  const errors = [];
  const views = candidates.map((view, index) => validateImportedView(view, index, errors)).filter(Boolean);
  return {
    ok: errors.length === 0,
    status: errors.length ? 'invalid' : legacy ? 'legacy' : 'current',
    views: errors.length ? [] : views,
    errors,
  };
}

export function prepareSavedViewsImport(input, {
  mode = 'merge',
  existing = loadSavedViews(),
} = {}) {
  const validation = validateSavedViewsImport(input);
  if (!validation.ok) return { ...validation, mode, result: [], imported: [] };
  if (!['merge', 'replace'].includes(mode)) {
    return {
      ok: false,
      status: 'invalid-mode',
      mode,
      result: [],
      imported: [],
      errors: [importError('$.mode', 'mode')],
    };
  }
  const base = mode === 'merge' ? normalizeList(existing) : [];
  const usedNames = new Set(base.map(view => view.name.toLocaleLowerCase()));
  const usedIds = new Set(base.map(view => view.id));
  const resolved = validation.views.map(view => {
    const next = { ...view };
    next.name = uniqueName(next.name, usedNames);
    if (usedIds.has(next.id)) next.id = createId();
    usedIds.add(next.id);
    return next;
  });
  const imported = resolved.slice(0, Math.max(0, MAX_VIEWS - base.length));
  return {
    ...validation,
    mode,
    imported,
    omitted: resolved.length - imported.length,
    result: [...base, ...imported].slice(0, MAX_VIEWS),
  };
}

export function importSavedViews(input, {
  mode = 'merge',
  storage = globalThis.localStorage,
} = {}) {
  const original = storage?.getItem?.(SAVED_VIEWS_STORAGE_KEY) ?? null;
  const prepared = prepareSavedViewsImport(input, { mode, existing: loadSavedViews(storage) });
  if (!prepared.ok) return prepared;
  const serialized = JSON.stringify(
    createVersionedRecord(SAVED_VIEWS_SCHEMA_VERSION, 'views', prepared.result),
  );
  try {
    storage.setItem(SAVED_VIEWS_STORAGE_KEY, serialized);
    if (storage.getItem(SAVED_VIEWS_STORAGE_KEY) !== serialized) throw new Error('Saved view write verification failed');
    return { ...prepared, status: 'imported' };
  } catch {
    try {
      if (original == null) storage.removeItem?.(SAVED_VIEWS_STORAGE_KEY);
      else storage.setItem(SAVED_VIEWS_STORAGE_KEY, original);
    } catch { /* The original write error remains the actionable failure. */ }
    return {
      ok: false,
      status: 'write-failed',
      mode,
      result: [],
      imported: [],
      errors: [importError('$', 'write')],
    };
  }
}

function normalizeList(views) {
  if (!Array.isArray(views)) return [];
  return views.map(normalizeSavedView).filter(Boolean).slice(0, MAX_VIEWS);
}

function persist(views, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(
      createVersionedRecord(SAVED_VIEWS_SCHEMA_VERSION, 'views', normalizeList(views)),
    ));
  } catch { /* storage remains optional */ }
}

function validateImportedView(view, index, errors) {
  const path = `$.views[${index}]`;
  if (!view || typeof view !== 'object' || Array.isArray(view)) {
    errors.push(importError(path, 'object'));
    return null;
  }
  if (typeof view.name !== 'string' || !view.name.trim()) errors.push(importError(`${path}.name`, 'required'));
  else if (view.name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(view.name)) errors.push(importError(`${path}.name`, 'name'));
  if (typeof view.hash !== 'string' || !/^#v=1(?:&|$)/.test(view.hash) || view.hash.length > MAX_HASH) {
    errors.push(importError(`${path}.hash`, 'hash'));
  }
  if (view.id != null && !/^[a-z0-9-]{1,80}$/i.test(view.id)) errors.push(importError(`${path}.id`, 'id'));
  if (view.created_at != null && !validDate(view.created_at)) errors.push(importError(`${path}.created_at`, 'date'));
  if (errors.some(error => error.path.startsWith(`${path}.`) || error.path === path)) return null;
  return normalizeSavedView(view);
}

function uniqueName(name, usedNames) {
  const base = name.trim().slice(0, MAX_NAME);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    const marker = ` (${suffix})`;
    candidate = `${base.slice(0, MAX_NAME - marker.length).trimEnd()}${marker}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function importError(path, code) {
  return { path, code };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
