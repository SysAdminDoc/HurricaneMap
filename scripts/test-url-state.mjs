import assert from 'node:assert/strict';
import {
  CATEGORY_DEFAULTS,
  applyHashToFilters,
  createDefaultFilters,
  decodeAdvisoryReplayState,
  decodeHashState,
  encodeAdvisoryReplayState,
  encodeHashState,
  LAUNCHER_PANELS,
  launcherActionFromHash,
  normalizeAdvisoryReplayState,
  normalizeLauncherPanel,
  panelIntentFromHash,
  restoreFiltersFromHash,
  viewOptionsFromDecoded,
} from '../src/url-state.js';

// The bare token is the PWA manifest's form and the only one that shipped
// first. It is the whole hash, so it cannot coexist with a filter.
assert.equal(launcherActionFromHash('#stats'), 'stats');
assert.equal(launcherActionFromHash('compare'), 'compare');
assert.equal(launcherActionFromHash('#storm=AL122005'), null);

// Every panel the header launcher opens round-trips, in both forms, beside a
// filtered view. Driven off the exported list rather than a copy of it, so a
// panel added to the launcher without a hash token fails here.
assert.deepEqual(
  [...LAUNCHER_PANELS].sort(),
  ['compare', 'evac', 'on-this-date', 'prep', 'stats', 'table-view'],
  'the addressable launcher panels changed; the manifest shortcuts and openLauncherPanel follow this list',
);
for (const panel of LAUNCHER_PANELS) {
  assert.equal(launcherActionFromHash(`#${panel}`), panel, `bare #${panel} must open ${panel}`);

  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  filters.state = 'FL';
  const hash = encodeHashState(filters, {
    openPanel: panel,
    yearMinDefault: 1851,
    yearMaxDefault: 2025,
    knownStates: null,
  });
  assert.equal(hash, `#v=1&s=FL&panel=${panel}`, `${panel} must ride beside the filters`);
  assert.equal(launcherActionFromHash(hash), panel, `${panel} must survive the round trip`);
  assert.equal(viewOptionsFromDecoded(decodeHashState(hash)).openPanel, panel);
}

// A panel id this build does not know yields no panel rather than throwing, on
// both the bare and the keyed form. `constructor` and `__proto__` are here
// because a Set lookup is the difference between a rejection and a match on
// Object.prototype.
for (const unknown of ['nope', 'spatial-search', 'storm', 'constructor', '__proto__', '']) {
  assert.equal(launcherActionFromHash(`#${unknown}`), null, `bare #${unknown} must open nothing`);
  assert.equal(launcherActionFromHash(`#v=1&panel=${unknown}`), null, `panel=${unknown} must open nothing`);
  assert.equal(normalizeLauncherPanel(unknown), '');
}
assert.equal(launcherActionFromHash(undefined), null);
assert.equal(launcherActionFromHash('#v=2&panel=stats'), null, 'a future view version must not open a v1 panel');

// A versioned hash is a complete view, so it speaks for the panel even when it
// names none: '' means "no panel". Every other form says nothing, which is
// null, and leaves whatever is open alone.
for (const panel of LAUNCHER_PANELS) {
  assert.equal(panelIntentFromHash(`#v=1&panel=${panel}`), panel);
  assert.equal(panelIntentFromHash(`#${panel}`), panel, 'the manifest shortcut still names its panel');
}
assert.equal(panelIntentFromHash('#v=1&y=2005-2005'), '', 'a versioned view naming no panel means no panel');
assert.equal(panelIntentFromHash('#v=1'), '');
assert.equal(panelIntentFromHash('#v=1&panel=nope'), '', 'an unknown id is no panel, not a crash');
assert.equal(panelIntentFromHash('#t=1'), null, 'an unversioned filter says nothing about panels');
assert.equal(panelIntentFromHash('#storm=AL122005'), null, 'a storm link says nothing about panels');
assert.equal(panelIntentFromHash('#v=2&panel=stats'), null, 'a future view version speaks for nothing here');
assert.equal(panelIntentFromHash(''), null);
assert.equal(panelIntentFromHash(undefined), null);

// An unknown id must not be written back out either: a saved view captured from
// a build that knows a panel this one does not would otherwise be re-emitted.
{
  const filters = createDefaultFilters({ yearMin: 1851, yearMax: 2025 });
  assert.equal(
    encodeHashState(filters, { openPanel: 'nope', yearMinDefault: 1851, yearMaxDefault: 2025 }),
    '',
    'an unknown panel id must not shape a URL',
  );
}

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
    openPanel: '',
    windUnit: 'mph',
    damageMode: 'nominal',
    trackColorBy: 'category',
    dataRevision: null,
    advisoryReplay: null,
  });
  assert.deepEqual(viewOptionsFromDecoded(decodeHashState('#v=1')), {
    comparisonIds: [],
    openPanel: '',
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
