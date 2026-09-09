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
  hasStoredSavedViews,
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

// Saving compared names exactly while importing compared them case-folded, so
// two views differing only in case could both be saved and then silently become
// one on the way back in. The two paths agree now, and the round trip is what
// proves it: a count that changes across export and import is the defect.
storage.clear();
saveCurrentView('Gulf coast', '#v=1&s=TX');
saveCurrentView('Gulf Coast', '#v=1&s=LA');
const savedNames = loadSavedViews().map(view => view.name);
assert.equal(savedNames.length, 1, `names differing only in case must not both be saved: ${savedNames.join(', ')}`);
assert.equal(savedNames[0], 'Gulf Coast', 'the later save must replace the earlier one');

const roundTrip = importSavedViews(exportSavedViews(), { mode: 'replace' });
assert.equal(roundTrip.ok, true);
assert.deepEqual(
  loadSavedViews().map(view => view.name),
  savedNames,
  'an export and import round trip must not change the saved views',
);

// ------------------------------------------------ record existence vs count
//
// The replace-import confirmation used to ask "how many views can I read?",
// which is [] for a record with an unknown schema_version or one truncated to
// invalid JSON. importSavedViews overwrites the key either way, so the guard
// was skipped exactly when the reader had data that could not be shown to them
// and the bytes went with no prompt. It asks "is anything stored?" now.
{
  const key = 'hm-saved-views-v1';

  storage.clear();
  assert.equal(hasStoredSavedViews(), false, 'an empty store holds nothing');

  storage.set(key, JSON.stringify({ schema_version: 1, views: [] }));
  assert.equal(hasStoredSavedViews(), true, 'an empty but present record still exists');
  assert.equal(loadSavedViews().length, 0);

  // A schema this build does not know. Readable count is 0; a record is there.
  storage.set(key, JSON.stringify({ schema_version: 99, views: [{ id: 'a', name: 'Future', hash: '#v=1' }] }));
  assert.equal(loadSavedViews().length, 0, 'an unsupported schema reads as no views');
  assert.equal(hasStoredSavedViews(), true, 'but the record is still there to be destroyed');

  // Truncated JSON. Same shape, no future version required.
  storage.set(key, '{"schema_version":1,"views":[{"id"');
  assert.equal(loadSavedViews().length, 0, 'invalid JSON reads as no views');
  assert.equal(hasStoredSavedViews(), true, 'but the record is still there to be destroyed');

  storage.clear();
  assert.equal(hasStoredSavedViews(), false);
}

console.log('saved views ok (CRUD/export, strict import preview, deterministic merge, atomic rollback, case-folded names)');
