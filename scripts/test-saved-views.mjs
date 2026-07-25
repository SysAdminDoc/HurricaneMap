import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const {
  deleteSavedView,
  exportSavedViews,
  loadSavedViews,
  migrateSavedViewsRecord,
  normalizeSavedView,
  saveCurrentView,
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

console.log('saved views ok (bounded names/hashes, legacy migration, CRUD/export)');
