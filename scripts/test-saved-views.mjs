import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};

const {
  deleteSavedView,
  exportSavedViews,
  importSavedViews,
  loadSavedViews,
  migrateSavedViewsRecord,
  normalizeSavedView,
  prepareSavedViewsImport,
  saveCurrentView,
  validateSavedViewsImport,
} = await import('../src/saved-views.js');

assert.equal(normalizeSavedView({ name: '', hash: '#v=1' }), null);
assert.equal(normalizeSavedView({ name: 'Address', hash: `#v=1&x=${'a'.repeat(2050)}` }), null);
assert.equal(normalizeSavedView({ name: 'Future', hash: '#v=999&c=5' }), null);

storage.set('hm-saved-views-v1', JSON.stringify([
  { id: 'legacy', name: 'Katrina class', hash: '#v=1&y=2005-2005&p=AL122005' },
]));
assert.equal(loadSavedViews()[0].name, 'Katrina class');
assert.equal(JSON.parse(storage.get('hm-saved-views-v1')).schema_version, 1);

const saved = saveCurrentView(' Major storms ', '#v=1&c=3%2C4%2C5&u=mph');
assert.equal(saved.name, 'Major storms');
assert.equal(loadSavedViews().length, 2);
assert.equal(JSON.parse(exportSavedViews()).views.length, 2);
assert.equal(deleteSavedView(saved.id), true);
assert.equal(loadSavedViews().length, 1);

const future = migrateSavedViewsRecord({ schema_version: 999, views: [{ name: 'x', hash: '#v=1' }] });
assert.equal(future.status, 'unsupported');
assert.equal(future.shouldPersist, false);
assert.deepEqual(future.value, []);

const transfer = JSON.stringify({
  schema_version: 1,
  views: [
    { id: 'import-1', name: 'Katrina class', hash: '#v=1&y=2005-2005' },
    { id: 'import-2', name: 'Katrina class', hash: '#v=1&c=3%2C4%2C5' },
  ],
});
const mergePreview = prepareSavedViewsImport(transfer, { mode: 'merge', existing: loadSavedViews() });
assert.equal(mergePreview.ok, true);
assert.deepEqual(mergePreview.imported.map(view => view.name), ['Katrina class (2)', 'Katrina class (3)']);
const replacePreview = prepareSavedViewsImport(transfer, { mode: 'replace', existing: loadSavedViews() });
assert.deepEqual(replacePreview.imported.map(view => view.name), ['Katrina class', 'Katrina class (2)']);

const beforeInvalid = storage.get('hm-saved-views-v1');
assert.equal(importSavedViews('{bad json').status, 'malformed');
assert.equal(storage.get('hm-saved-views-v1'), beforeInvalid, 'malformed import must not change storage');
assert.equal(importSavedViews(JSON.stringify({ schema_version: 999, views: [] })).status, 'future-version');
assert.equal(storage.get('hm-saved-views-v1'), beforeInvalid, 'future import must not change storage');

const fieldErrors = validateSavedViewsImport({
  schema_version: 1,
  views: [{ name: '', hash: '#v=999', id: 'not valid!' }],
});
assert.equal(fieldErrors.ok, false);
assert.deepEqual(fieldErrors.errors.map(error => error.path), [
  '$.views[0].name',
  '$.views[0].hash',
  '$.views[0].id',
]);

const original = storage.get('hm-saved-views-v1');
let writes = 0;
const failingStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => {
    storage.set(key, value);
    writes += 1;
    if (writes === 1) throw new Error('quota');
  },
  removeItem: key => storage.delete(key),
};
assert.equal(importSavedViews(transfer, { mode: 'replace', storage: failingStorage }).status, 'write-failed');
assert.equal(storage.get('hm-saved-views-v1'), original, 'failed import must restore the exact original record');

const imported = importSavedViews(transfer, { mode: 'replace' });
assert.equal(imported.ok, true);
assert.deepEqual(loadSavedViews().map(view => view.name), ['Katrina class', 'Katrina class (2)']);

console.log('saved views ok (CRUD/export, strict import preview, deterministic merge, atomic rollback)');
