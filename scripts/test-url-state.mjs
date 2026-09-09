import assert from 'node:assert/strict';
import {
  CATEGORY_DEFAULTS,
  applyHashToFilters,
  createDefaultFilters,
  decodeAdvisoryReplayState,
  decodeHashState,
  encodeAdvisoryReplayState,
  encodeHashState,
  launcherActionFromHash,
  normalizeAdvisoryReplayState,
  restoreFiltersFromHash,
  viewOptionsFromDecoded,
} from '../src/url-state.js';

assert.equal(launcherActionFromHash('#stats'), 'stats');
assert.equal(launcherActionFromHash('compare'), 'compare');
assert.equal(launcherActionFromHash('#storm=AL122005'), null);

function cats(filters) {
  return [...filters.categories].sort();
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(encodeHashState(filters, { yearMinDefault: 1851, yearMaxDefault: 2025 }), '');
}

// A cold load hands encodeHashState the live data release. That alone must not
// put a 64-character fragment on a URL the reader never shaped.
{
  const REL = 'a'.repeat(64);
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const opts = { dataRevision: REL, yearMinDefault: 1851, yearMaxDefault: 2025 };
  assert.equal(encodeHashState(filters, opts), '');

  // A deliberate capture (a saved view, a citation) records the release even
  // when the view is the default one, and it decodes back.
  const pinned = encodeHashState(filters, { ...opts, pinDataRevision: true });
  assert.equal(pinned, `#v=1&rel=${REL}`);
  assert.equal(viewOptionsFromDecoded(decodeHashState(pinned)).dataRevision, REL);

  // Once any other state is going into the URL, the release rides along in its
  // usual position so a shared link still cites an exact release.
  filters.state = 'Florida';
  const shaped = encodeHashState(filters, { ...opts, openStormId: 'AL122005' });
  assert.equal(shaped, `#v=1&s=Florida&storm=AL122005&rel=${REL}`);
  assert.equal(viewOptionsFromDecoded(decodeHashState(shaped)).dataRevision, REL);
}

// The wind unit and damage mode come from stored settings, so main.js hands
// them to every writeHash. A reader who once chose mph has not shaped the URL
// they just opened, and used to get a 64-character fragment for it anyway.
{
  const REL = 'b'.repeat(64);
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const opts = {
    dataRevision: REL, windUnit: 'mph', damageMode: 'nominal',
    yearMinDefault: 1851, yearMaxDefault: 2025,
  };
  assert.equal(encodeHashState(filters, opts), '');

  // A capture records them, so a saved view reopens in the units it was saved in.
  assert.equal(
    encodeHashState(filters, { ...opts, pinDataRevision: true }),
    `#v=1&u=mph&d=nominal&rel=${REL}`,
  );

  // So does any URL the reader did shape.
  const shaped = encodeHashState(filters, { ...opts, openStormId: 'AL122005' });
  assert.equal(shaped, `#v=1&storm=AL122005&u=mph&d=nominal&rel=${REL}`);
  const restored = viewOptionsFromDecoded(decodeHashState(shaped));
  assert.equal(restored.windUnit, 'mph');
  assert.equal(restored.damageMode, 'nominal');
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.categories = new Set(['5', '4', '3']);
  filters.state = 'Florida';
  filters.showTracks = true;
  assert.equal(
    encodeHashState(filters, {
      openStormId: 'AL122005',
      yearMinDefault: 1851,
      yearMaxDefault: 2025,
    }),
    '#v=1&c=3%2C4%2C5&s=Florida&t=1&storm=AL122005',
  );
}

{
  assert.deepEqual(decodeHashState('#s=%E0%A4%A&c=3'), { c: '3' });
  assert.equal(decodeHashState(''), null);
  assert.deepEqual(decodeHashState('#not-a-pair&h=1'), { h: '1' });
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const { decoded, filters: restored } = restoreFiltersFromHash('#c=bad&s=NotAState', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: { Florida: true },
  });
  assert.deepEqual(decoded, { c: 'bad', s: 'NotAState' });
  assert.deepEqual(cats(restored), [...CATEGORY_DEFAULTS].sort());
  assert.equal(restored.state, '');
}

// An explicit empty selection must survive sharing and reload.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.categories.clear();
  const hash = encodeHashState(filters, { yearMinDefault: 1851, yearMaxDefault: 2025 });
  assert.equal(hash, '#v=1&c=');
  const { filters: restored } = restoreFiltersFromHash(hash, createDefaultFilters());
  assert.deepEqual(cats(restored), []);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const { filters: restored } = restoreFiltersFromHash('#y=2030-1800&c=3,4&s=Florida&t=1&h=1', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: new Set(['Florida']),
  });
  assert.equal(restored.yearMin, 1851);
  assert.equal(restored.yearMax, 2025);
  assert.deepEqual(cats(restored), ['3', '4']);
  assert.equal(restored.state, 'Florida');
  assert.equal(restored.showTracks, true);
  assert.equal(restored.showHeatmap, true);
}

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.state = 'Texas';
  filters.categories = new Set(['ts']);
  const decoded = applyHashToFilters(filters, '#s=Florida&c=1,2', {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: ['Florida', 'Texas'],
  });
  assert.deepEqual(decoded, { s: 'Florida', c: '1,2' });
  assert.equal(filters.state, 'Florida');
  assert.deepEqual(cats(filters), ['1', '2']);
}

// Both endpoints out of bounds on the same side must clamp, not invert.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const { filters: restored } = restoreFiltersFromHash('#y=2100-2200', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.equal(restored.yearMin, 2025);
  assert.equal(restored.yearMax, 2025);
  const { filters: below } = restoreFiltersFromHash('#y=1700-1800', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.equal(below.yearMin, 1851);
  assert.equal(below.yearMax, 1851);
}

// retiredOnly round-trips through the hash.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.retiredOnly = true;
  const hash = encodeHashState(filters, { yearMinDefault: 1851, yearMaxDefault: 2025 });
  assert.equal(hash, '#v=1&r=1');
  const fresh = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  applyHashToFilters(fresh, hash, { yearMinDefault: 1851, yearMaxDefault: 2025 });
  assert.equal(fresh.retiredOnly, true);
}

// Unversioned hashes remain valid; future incompatible versions safely retain
// the caller's current state instead of partially applying unknown fields.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.state = 'Texas';
  const { decoded, filters: restored } = restoreFiltersFromHash('#v=999&s=Florida&c=5', filters, {
    knownStates: ['Florida', 'Texas'],
  });
  assert.equal(decoded.v, '999');
  assert.equal(restored.state, 'Texas');
  assert.deepEqual(cats(restored), [...CATEGORY_DEFAULTS].sort());
}

console.log('url state ok');

{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const hash = encodeHashState(filters, {
    comparisonIds: ['al122005', 'EP012024', 'BAD', 'AL122005'],
    windUnit: 'mph',
    damageMode: 'nominal',
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.equal(hash, '#v=1&p=AL122005%2CEP012024&u=mph&d=nominal');
  assert.deepEqual(viewOptionsFromDecoded(decodeHashState(hash)), {
    comparisonIds: ['AL122005', 'EP012024'],
    windUnit: 'mph',
    damageMode: 'nominal',
    trackColorBy: 'category',
    dataRevision: null,
    advisoryReplay: null,
  });
  assert.deepEqual(viewOptionsFromDecoded(decodeHashState('#v=1')), {
    comparisonIds: [],
    windUnit: 'kt',
    damageMode: 'real',
    trackColorBy: 'category',
    dataRevision: null,
    advisoryReplay: null,
  });

  // The track encoding is a qualifier, like the unit and the damage mode: it
  // comes from stored settings and describes how the reader has the app set
  // up, so it rides along only when the fragment is already carrying a view.
  {
    const bare = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
    assert.equal(
      encodeHashState(bare, { trackColorBy: 'wind', yearMinDefault: 1851, yearMaxDefault: 2025 }),
      '',
      'an encoding on its own must not turn a cold load into a fragment',
    );
    const shaped = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
    shaped.showTracks = true;
    const withView = encodeHashState(shaped, {
      trackColorBy: 'pressure', yearMinDefault: 1851, yearMaxDefault: 2025,
    });
    assert.equal(withView, '#v=1&t=1&tc=pressure');
    assert.equal(viewOptionsFromDecoded(decodeHashState(withView)).trackColorBy, 'pressure');
    // Round trip every value the setting can hold, not just the one above.
    for (const mode of ['category', 'wind', 'pressure', 'month']) {
      const round = encodeHashState(shaped, {
        trackColorBy: mode, yearMinDefault: 1851, yearMaxDefault: 2025,
      });
      assert.equal(
        viewOptionsFromDecoded(decodeHashState(round)).trackColorBy,
        mode,
        `${mode} did not survive the round trip`,
      );
    }
    // A value nobody publishes falls back rather than reaching a setter that
    // would then paint tracks with an undefined ramp.
    assert.equal(
      viewOptionsFromDecoded(decodeHashState('#v=1&t=1&tc=rainfall')).trackColorBy,
      'category',
    );
  }
  assert.equal(decodeHashState(`#v=1&x=${'a'.repeat(2050)}`), null);

  filters.categories = new Set(['3', '4', '5']);
  filters.showTracks = true;
  const { filters: defaultsRestored } = restoreFiltersFromHash('#v=1', filters, {
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.deepEqual(cats(defaultsRestored), [...CATEGORY_DEFAULTS].sort());
  assert.equal(defaultsRestored.showTracks, false);
}

{
  const replay = { stormId: 'al092022', index: 3, coneEra: '2025' };
  assert.equal(encodeAdvisoryReplayState(replay), '1.AL092022.3.2025');
  assert.deepEqual(decodeAdvisoryReplayState('1.AL092022.3.2025', { stormId: 'AL092022' }), {
    stormId: 'AL092022',
    index: 3,
    coneEra: '2025',
  });
  assert.equal(decodeAdvisoryReplayState('1.AL092022.3.2025', { stormId: 'AL142024' }), null);
  assert.equal(decodeAdvisoryReplayState('1.AL092022.bad.2025'), null);
  assert.equal(decodeAdvisoryReplayState('1.AL092022.1000.2025'), null);
  assert.equal(decodeAdvisoryReplayState('1.AL092022.3.2014'), null);
  assert.equal(normalizeAdvisoryReplayState({ storm_id: 'AL092022', index: 0, cone_era: '2025' }).stormId, 'AL092022');

  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  const hash = encodeHashState(filters, {
    openStormId: 'AL092022',
    advisoryReplay: replay,
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
  });
  assert.equal(hash, '#v=1&storm=AL092022&replay=1.AL092022.3.2025');
  assert.deepEqual(viewOptionsFromDecoded(decodeHashState(hash)).advisoryReplay, {
    stormId: 'AL092022',
    index: 3,
    coneEra: '2025',
  });
  assert.equal(
    encodeHashState(filters, { openStormId: 'AL142024', advisoryReplay: replay }),
    '#v=1&storm=AL142024',
    'replay state for another storm must not leak into a shared view',
  );
}
