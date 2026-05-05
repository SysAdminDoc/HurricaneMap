import assert from 'node:assert/strict';

import {
  activeStormCacheKey,
  buildNHCFeatureQueryUrl,
  buildStormMatcher,
  featureMatchesActiveStorm,
  filterFeaturesForActiveStorms,
  NHC_FORECAST_LAYER_IDS,
} from '../src/cone.js';

const storms = [
  {
    id: 'al062023',
    binNumber: 'AT1',
    name: 'Gert',
    lastUpdate: '2023-08-22T03:00:00.000Z',
    trackCone: { advNum: '011' },
  },
];

const matcher = buildStormMatcher(storms);

assert.ok(
  featureMatchesActiveStorm({ properties: { STORMID: 'AL062023' } }, matcher),
  'full ATCF storm id should match',
);
assert.ok(
  featureMatchesActiveStorm({ properties: { BASIN: 'AL', STORMNUM: 6 } }, matcher),
  'basin and storm number should match',
);
assert.ok(
  featureMatchesActiveStorm({ properties: { BASIN: 'AT', STORMNUM: 6 } }, matcher),
  'Atlantic basin aliases should match',
);
assert.ok(
  featureMatchesActiveStorm({ properties: { STORMNAME: 'GERT' } }, matcher),
  'storm name should match',
);
assert.equal(
  featureMatchesActiveStorm({ properties: { BASIN: 'AL', STORMNUM: 8, STORMNAME: 'FRANKLIN' } }, matcher),
  false,
  'different active storm should not match when feature fields are recognized',
);

const features = [
  { properties: { BASIN: 'AL', STORMNUM: 6, STORMNAME: 'GERT' } },
  { properties: { BASIN: 'AL', STORMNUM: 8, STORMNAME: 'FRANKLIN' } },
];
assert.deepEqual(
  filterFeaturesForActiveStorms(features, storms),
  [features[0]],
  'recognized features should filter down to the active storm set',
);
assert.deepEqual(
  filterFeaturesForActiveStorms([{ properties: { unrelated: true } }], storms),
  [{ properties: { unrelated: true } }],
  'unrecognized active-service schemas should fall back to visible active features',
);

const url = new URL(buildNHCFeatureQueryUrl(NHC_FORECAST_LAYER_IDS.cone));
assert.ok(url.pathname.endsWith('/FeatureServer/4/query'));
assert.equal(url.searchParams.get('f'), 'geojson');
assert.equal(url.searchParams.get('returnGeometry'), 'true');
assert.equal(url.searchParams.get('outSR'), '4326');

const firstKey = activeStormCacheKey(storms);
const secondKey = activeStormCacheKey([{ ...storms[0], trackCone: { advNum: '012' } }]);
assert.notEqual(firstKey, secondKey, 'advisory changes should invalidate the cone cache');

console.log('cone utils ok');
