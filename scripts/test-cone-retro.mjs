import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildConeEnvelope,
  buildConeSamples,
  destinationPoint,
  interpolateTrackPoint,
  ellipseMethodIsOfficial,
  isEllipseMethodOfficial,
} from '../src/cone-retro.js';
import en from '../src/locales/en.js';
import es from '../src/locales/es.js';
import ht from '../src/locales/ht.js';

const start = Date.UTC(2026, 7, 20, 0, 0);
const track = Array.from({ length: 9 }, (_, index) => ({
  t: new Date(start + index * 6 * 60 * 60 * 1000).toISOString(),
  lat: 20 + index * 0.25,
  lon: -80 + index * 0.5,
}));
const storm = {
  basin: 'AL',
  track,
  us_landfalls: [{ t: track.at(-1).t, lat: track.at(-1).lat, lon: track.at(-1).lon }],
};

const halfway = interpolateTrackPoint(track, start + 3 * 60 * 60 * 1000);
assert.equal(halfway.lat, 20.125);
assert.equal(halfway.lon, -79.75);
assert.equal(interpolateTrackPoint(track, start - 1), null);

const samples = buildConeSamples(storm, { 12: 25, 24: 39, 48: 62 });
assert.equal(samples.length, 4, 'origin plus three valid forecast leads should be sampled');
assert.deepEqual(samples.slice(1).map(sample => sample.hours), [12, 24, 48]);
assert.deepEqual(samples.slice(1).map(sample => sample.radius), [25, 39, 62]);

const circular = buildConeEnvelope(samples);
const ellipse = buildConeEnvelope(samples, { ellipse: true, alongTrackScale: 1.35, crossTrackScale: 1.05 });
assert(circular.length >= 3, 'circle method should return a polygon envelope');
assert(ellipse.length >= 3, 'ellipse method should return a polygon envelope');
const lonSpan = points => Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
assert(lonSpan(ellipse) > lonSpan(circular), 'along-track ellipse scaling should lengthen the envelope');

const north = destinationPoint(20, -80, 0, 60);
assert(Math.abs(north[0] - 21) < 0.02, '60 n mi north should be approximately one latitude degree');
assert(Math.abs(north[1] + 80) < 0.01);

// What the explainer has to say, in every language the panel speaks.
//
// A cone is a statement about where a centre might go. NHC says plainly that it
// carries no information about wind risk, and the winds reach well outside it.
// This one has a second problem the real product does not: it is drawn around a
// track that already happened, so there is no probability in it at all. Both
// sentences have to be there or the drawing is more confident than the data.
{
  const claims = {
    en: [/says nothing about the risk of strong winds/i, /carries no probability/i],
    es: [/no dice nada sobre el riesgo de vientos fuertes/i, /no expresa ninguna probabilidad/i],
    ht: [/pa di anyen sou risk gwo van/i, /pa bay okenn pwobabilite/i],
  };
  for (const [locale, catalog] of Object.entries({ en, es, ht })) {
    const explainer = catalog['coneRetro.explainer'];
    assert(explainer, `${locale} has no coneRetro.explainer`);
    for (const claim of claims[locale]) {
      assert(
        claim.test(explainer),
        `${locale} explainer does not carry ${claim}: ${explainer}`,
      );
    }
  }
}

// The ellipse method is withheld until the axes it claims to draw are real.
{
  const radii = JSON.parse(await readFile(new URL('../data/cone-radii.json', import.meta.url), 'utf8'));
  const experimental = radii.experimentalEllipse;
  assert.equal(typeof experimental.official, 'boolean', 'the ellipse method must declare whether it is official');
  assert(experimental.recheckOn, 'an unofficial method must carry the date to look again');
  assert.equal(
    experimental.recheckOn,
    '2026-11-30',
    'the re-check date is the close of NHC comments on the experimental cone',
  );
  assert.equal(
    experimental.official,
    false,
    'NHC has published the experimental cone as graphics and not its axes, so this stays false until they exist',
  );
  // Both directions, against the predicate rather than the fetch. Node cannot
  // fetch a file: URL, so `isEllipseMethodOfficial()` answers false from its
  // catch here whatever the data says, and asserting on it would have proved
  // only that the two happened to agree.
  assert.equal(ellipseMethodIsOfficial(radii), false, 'the shipped data withholds the method');
  assert.equal(
    ellipseMethodIsOfficial({ experimentalEllipse: { official: true } }),
    true,
    'the predicate must be able to answer true, or the withholding is permanent by accident',
  );
  assert.equal(ellipseMethodIsOfficial({ experimentalEllipse: { official: 'true' } }), false, 'only the boolean counts');
  assert.equal(ellipseMethodIsOfficial({}), false, 'missing data withholds');
  assert.equal(ellipseMethodIsOfficial(null), false, 'no data withholds');
  assert.equal(
    await isEllipseMethodOfficial(),
    false,
    'and the async wrapper answers false rather than throwing when the radii cannot be read',
  );

  // The control has to start hidden rather than be taken away afterwards.
  // Rendering it and removing it once the radii arrive leaves a window, as long
  // as that fetch takes, in which a reader can tick it and draw the invented
  // ellipse; the control is then removed with the ellipse still on the map.
  const panel = await readFile(new URL('../src/panel.js', import.meta.url), 'utf8');
  const toggleMarkup = /<label[^>]*id="cone-retro-ellipse-toggle"[^>]*>/.exec(panel);
  assert(toggleMarkup, 'the ellipse toggle must be identifiable in the panel markup');
  assert(
    /\bhidden\b/.test(toggleMarkup[0]),
    `the ellipse toggle must render hidden: ${toggleMarkup[0]}`,
  );

  // And the flag has to be readable in both directions, or the withholding is
  // permanent by accident rather than by the data.
  const controls = await readFile(new URL('../src/panel-controls.js', import.meta.url), 'utf8');
  assert(
    /isEllipseMethodOfficial\(\)\.then\(official => \{[\s\S]{0,400}?hidden = false;/.test(controls),
    'the panel must reveal the ellipse control when the method is official',
  );
  assert(
    /\?\.remove\(\);/.test(controls),
    'and must take it out of the page when it is not',
  );
}

console.log(
  'retrospective cone utilities ok (explainer carries the wind-risk and no-probability caveats in three '
  + 'locales; the ellipse method is withheld until its axes are published, re-check 2026-11-30)',
);
