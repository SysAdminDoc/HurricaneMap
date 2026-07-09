// Tropical watch/warning overlay logic (2026 NHC cone standard):
// URL construction, per-zone hazard stacking, and the pink/blue
// hurricane-watch + tropical-storm-warning overlap case.
import {
  EVENT_TO_FLAG,
  HAZARD_PRIORITY,
  HAZARD_STYLE,
  buildAlertsUrl,
  buildZoneUrl,
  classifyAlerts,
  isLandZone,
  resolveHazard,
} from '../src/alerts.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`alerts test failed: ${message}`);
    process.exit(1);
  }
}

// --- URL construction -------------------------------------------------------
const alertsUrl = buildAlertsUrl();
assert(alertsUrl.startsWith('https://api.weather.gov/alerts/active?'), `bad alerts base: ${alertsUrl}`);
assert(alertsUrl.includes('status=actual'), 'alerts URL must filter to actual alerts');
// Multi-value filters MUST be one comma-separated param — repeated event=
// params silently override each other on api.weather.gov.
const eventParams = [...new URL(alertsUrl).searchParams.getAll('event')];
assert(eventParams.length === 1, `expected one comma-joined event param, got ${eventParams.length}`);
for (const event of Object.keys(EVENT_TO_FLAG)) {
  assert(eventParams[0].includes(event), `alerts URL missing event ${event}`);
}
assert(buildZoneUrl('FLZ151') === 'https://api.weather.gov/zones/forecast/FLZ151', 'forecast zone URL wrong');
assert(buildZoneUrl('TXC201') === 'https://api.weather.gov/zones/county/TXC201', 'county zone URL wrong');

// --- land/marine zone filter --------------------------------------------------
assert(isLandZone('FLZ151') && isLandZone('PRZ001') && isLandZone('VIZ001'), 'land/territory zones must pass');
assert(!isLandZone('AMZ130') && !isLandZone('GMZ850') && !isLandZone('ANZ335'), 'marine zones must be excluded');

// --- hazard stacking (2026 rules) --------------------------------------------
assert(resolveHazard(new Set(['huWarning', 'tsWarning'])) === 'huWarning', 'hurricane warning must dominate');
assert(resolveHazard(new Set(['huWatch', 'tsWarning'])) === 'huWatchTsWarning', 'HU watch + TS warning must hatch');
assert(resolveHazard(new Set(['huWatch', 'tsWatch'])) === 'huWatch', 'HU watch dominates TS watch');
assert(resolveHazard(new Set(['tsWarning'])) === 'tsWarning', 'TS warning stands alone');
assert(resolveHazard(new Set(['tsWatch'])) === 'tsWatch', 'TS watch stands alone');
assert(resolveHazard(new Set()) === null, 'no flags -> no hazard');
assert(resolveHazard(new Set(['huWarning', 'huWatch', 'tsWarning', 'tsWatch'])) === 'huWarning', 'full stack resolves to warning');

// --- alert classification ----------------------------------------------------
const fixture = [
  { properties: { event: 'Hurricane Warning', geocode: { UGC: ['FLZ151', 'FLZ051'] } }, geometry: null },
  { properties: { event: 'Tropical Storm Warning', geocode: { UGC: ['FLZ051', 'GAZ001'] } }, geometry: null },
  { properties: { event: 'Hurricane Watch', geocode: { UGC: ['GAZ001'] } }, geometry: null },
  { properties: { event: 'Tropical Storm Watch', geocode: { UGC: ['SCZ050'] } }, geometry: null },
  { properties: { event: 'Hurricane Watch' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  { properties: { event: 'Special Marine Warning', geocode: { UGC: ['LAZ040'] } }, geometry: null },
  { properties: { event: 'Tropical Storm Warning', geocode: { UGC: ['AMZ130'] } }, geometry: null },
];
const { zoneFlags, directGeometries } = classifyAlerts(fixture);
assert(zoneFlags.size === 4, `expected 4 zones, got ${zoneFlags.size}`);
assert(!zoneFlags.has('LAZ040'), 'non-tropical events must be ignored');
assert(!zoneFlags.has('AMZ130'), 'marine zones must be excluded even for tropical events');
assert(resolveHazard(zoneFlags.get('FLZ151')) === 'huWarning', 'FLZ151 should be hurricane warning');
assert(resolveHazard(zoneFlags.get('FLZ051')) === 'huWarning', 'FLZ051 warning stack should resolve to hurricane warning');
assert(resolveHazard(zoneFlags.get('GAZ001')) === 'huWatchTsWarning', 'GAZ001 must resolve to the hatched overlap');
assert(resolveHazard(zoneFlags.get('SCZ050')) === 'tsWatch', 'SCZ050 should be TS watch');
assert(directGeometries.length === 1 && resolveHazard(directGeometries[0].flags) === 'huWatch', 'polygon-carrying alert should render directly');

// --- style + ordering contracts ---------------------------------------------
assert(HAZARD_PRIORITY[HAZARD_PRIORITY.length - 1] === 'huWarning', 'warnings must render on top');
for (const hazard of HAZARD_PRIORITY) {
  assert(HAZARD_STYLE[hazard], `missing style for ${hazard}`);
}
assert(HAZARD_STYLE.huWatchTsWarning.fillColor.startsWith('url(#'), 'overlap case must use the hatch pattern fill');

console.log('alerts ok (2026 watch/warning stacking, urls, classification)');
