// What this app needs from a browser, recorded as Baseline dates.
//
// A version floor written into a test ages: Chrome moved to a two-week release
// cadence on 2026-09-08, so "Chrome 120 or newer" is a number that means
// something different every fortnight and nothing at all in two years. A
// Baseline date does not move. Once the WebDX group assigns a feature its
// newly-available date, that date is the day the last of the core browser set
// shipped it, and the widely-available date is that day plus 30 months. Neither
// is ever revised.
//
// So the contract below is dates, and the assertions are about dates and about
// the feature actually being present in the engine under test. No milestone
// numbers, in this file or in the README paragraph it backs. check:baseline
// enforces that.
//
// Dates are from the web-features dataset, read on 2026-09-09 through
// https://api.webstatus.dev/v1/features. Re-read them if a row is added; do not
// estimate one, because a wrong date here becomes a wrong claim in the README.

/**
 * `required` means there is no fallback: the app is broken in an engine without
 * it. `progressive` means the code feature-detects and has a path that works
 * without it, and the detection is named so the claim can be checked.
 */
export const BASELINE_FEATURES = Object.freeze([
  {
    id: 'cascade-layers',
    name: 'Cascade layers',
    baseline: 'widely',
    newlyAvailable: '2022-03-14',
    widelyAvailable: '2024-09-14',
    requirement: 'required',
    // src/styles.css opens with @layer tokens, reset, base, shell, components,
    // utilities, themes, accessibility. An engine that does not know the
    // at-rule drops every rule inside it, which is the entire stylesheet.
    used: 'src/styles.css declares the layer order on its first line',
    fallback: null,
    detect: { kind: 'global', name: 'CSSLayerBlockRule' },
  },
  {
    id: 'popover',
    name: 'Popover',
    baseline: 'newly',
    newlyAvailable: '2025-01-27',
    widelyAvailable: '2027-07-27',
    requirement: 'required',
    // The settings menu is a popover with no non-popover path, and several
    // modules test :popover-open, which throws as an unknown selector in an
    // engine without support rather than returning false.
    used: 'index.html gives #settings-menu the popover attribute; src/main.js matches :popover-open',
    fallback: null,
    detect: { kind: 'prototype', object: 'HTMLElement', property: 'popover' },
  },
  {
    id: 'compression-streams',
    name: 'Compression streams',
    baseline: 'widely',
    newlyAvailable: '2023-05-09',
    widelyAvailable: '2025-11-09',
    requirement: 'progressive',
    used: 'src/data.js reads data/storms.json.gz',
    fallback: 'fetches the uncompressed data/storms.json instead',
    detect: { kind: 'global', name: 'DecompressionStream' },
  },
  {
    id: 'js-modules-workers',
    name: 'JavaScript modules in workers',
    baseline: 'widely',
    newlyAvailable: '2023-06-06',
    widelyAvailable: '2025-12-06',
    requirement: 'progressive',
    used: 'src/data.js parses the track archive in src/storms-worker.js',
    fallback: 'parses the archive on the main thread when the worker errors',
    // Not a property lookup: the only honest answer is to start one and see
    // whether it reports back, which the matrix does because it has an engine.
    detect: null,
    probe: 'module-worker',
  },
  {
    id: 'custom-highlight-api',
    name: 'Custom highlights',
    baseline: 'newly',
    // Read from https://api.webstatus.dev/v1/features?q=highlight on
    // 2026-09-09: feature "highlight", status newly, low_date 2026-03-24. The
    // roadmap item that asked for this said June 2025, which is wrong; the
    // dataset is the authority and the date is recent enough that the fallback
    // is the path most readers will take for a while yet.
    newlyAvailable: '2026-03-24',
    widelyAvailable: '2028-09-24',
    requirement: 'progressive',
    used: 'src/search-highlight.js paints search matches through CSS.highlights',
    fallback: 'renders the result list with no highlighting, as it did before',
    detect: { kind: 'global', name: 'Highlight' },
  },
  {
    id: 'js-modules-service-workers',
    name: 'JavaScript modules in service workers',
    baseline: 'newly',
    newlyAvailable: '2026-01-13',
    widelyAvailable: '2028-07-13',
    requirement: 'progressive',
    // sw.js has no import statements and no import.meta, so it is a valid
    // classic script too. src/sw-updates.js tries the module type and then the
    // classic one, which is what Firefox ESR 140 needs; test:offline-smoke:classic
    // runs the whole offline suite with the module registration refused.
    used: 'src/sw-updates.js registers sw.js with the module type',
    fallback: 'retries the same file as a classic script, which is what Firefox ESR 140 takes',
    detect: null,
    probe: 'service-worker-type',
  },
]);

/**
 * Fallbacks kept for one browser line, and the terms on which they go.
 *
 * A fallback with no stated end is a fallback nobody ever removes. Each entry
 * names the line it exists for, what it costs to keep, what removing it would
 * delete, and the earliest date that removal should be considered. Nothing here
 * removes anything on a date: `retained` is a decision a person makes, and the
 * check refuses to let the code and this record disagree about it.
 */
export const RETIREMENT_PLANS = Object.freeze([
  Object.freeze({
    id: 'classic-service-worker',
    feature: 'js-modules-service-workers',
    retained: true,
    // Read from product-details.mozilla.org on 2026-09-09: FIREFOX_ESR is
    // 140.15.0esr and FIREFOX_ESR_NEXT is 153.2.0esr, so the two lines overlap
    // right now and the older one is still what a pinned enterprise install
    // gets. Module service workers reached Baseline with Firefox 147, so 140
    // needs the classic path and 153 does not.
    servesEsrLine: '140',
    replacementEsrLine: '153',
    checkedOn: '2026-09-09',
    // Not a trigger. The item that asked for this plan set the date, and the
    // reason is the pinned-enterprise tail rather than the end-of-life date
    // itself: an install that stopped updating does not stop existing when
    // upstream stops shipping it.
    revisitNoEarlierThan: '2027-01-01',
    costs: 'test:offline-smoke:classic runs the entire offline suite a second time with module registration refused',
    removes: [
      "the 'classic' entry in WORKER_TYPES in src/sw-updates.js, leaving a single registration attempt",
      'the workerType diagnostic that reports which registration actually took',
      'the test:offline-smoke:classic script in package.json and its gate entry',
      "the constraint that sw.js stay free of import and import.meta, which is what keeps it a valid classic script",
    ],
  }),
]);

/**
 * The date the app's floor sits at: the latest date among the features it
 * cannot run without. Stating a date earlier than this would understate what
 * the app needs.
 */
export function contractFloor(features = BASELINE_FEATURES) {
  const required = features.filter(feature => feature.requirement === 'required');
  // No hard requirement means no floor to state, rather than a floor of
  // 0000-00-00 that the README would then be told to contain.
  if (!required.length) return null;
  return required.reduce((latest, feature) => {
    const date = feature.baseline === 'widely' ? feature.widelyAvailable : feature.newlyAvailable;
    return date > latest ? date : latest;
  }, '0000-00-00');
}

/** The sentence check:baseline requires the README to contain for a feature. */
export function readmeClaim(feature) {
  const tier = feature.baseline === 'widely' ? 'Widely available' : 'Newly available';
  const date = feature.baseline === 'widely' ? feature.widelyAvailable : feature.newlyAvailable;
  return `${feature.name}, Baseline ${tier} as of ${date}`;
}

/**
 * Detections a property lookup can answer, run in the page. They are described
 * rather than written as source because the application document runs
 * script-src 'self' with no unsafe-eval, so a detection written as a string
 * would have to be handed to new Function and the page would refuse it. The two
 * features a lookup cannot answer carry a probe name instead and are resolved
 * by the caller, which has an engine to drive.
 */
export const SYNCHRONOUS_DETECTIONS = Object.freeze(
  BASELINE_FEATURES
    .filter(feature => feature.detect)
    .map(feature => ({ id: feature.id, name: feature.name, detect: feature.detect })),
);

/** Answers one described detection. Runs in the page, so it stays standalone. */
export function detectionResult(detect, scope = globalThis) {
  if (detect?.kind === 'global') return typeof scope[detect.name] === 'function';
  if (detect?.kind === 'prototype') {
    const constructor = scope[detect.object];
    return Boolean(constructor?.prototype) && detect.property in constructor.prototype;
  }
  return false;
}
