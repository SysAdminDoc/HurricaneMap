import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const [main, search, filters, navigation, shell, panel, panelControls, panelImpacts] = await Promise.all([
  read('src/main.js'),
  read('src/search-controller.js'),
  read('src/filter-controller.js'),
  read('src/shell-navigation.js'),
  read('src/shell-ui.js'),
  read('src/panel.js'),
  read('src/panel-controls.js'),
  read('src/panel-impacts.js'),
]);

assert.match(main, /wireApplicationShell/);
assert.match(main, /createFilterController/);
assert.doesNotMatch(main, /initSearchController|wireShellNavigation|function wireUI/);
assert.doesNotMatch(main, /toggleStatsBtn\.addEventListener|exportBtn\.addEventListener|querySelector\('#toggle-spatial-search'\)/);

assert.match(search, /searchStorms/);
assert.match(search, /getHistory/);
assert.match(search, /aria-activedescendant/);
assert.match(filters, /resetPrimaryFilters/);
assert.match(filters, /setYearRange/);
assert.match(filters, /toggleCategory/);
assert.match(navigation, /closeAllPanels/);
assert.match(navigation, /mobileActionsMenu|wireMobileActionsMenu/);

assert.match(shell, /initSearchController/);
assert.match(shell, /wireShellNavigation/);
assert.match(shell, /toggleStatsBtn\.addEventListener/);
assert.match(shell, /exportPublicationCSV|generateStatisticalReport|exportQGISGeoJSON/);
assert.doesNotMatch(shell, /filterLandfalls|createDefaultFilters|computeACE|buildExports/);

assert.match(panel, /wirePanelControls/);
assert.doesNotMatch(panel, /function wireAdvisoryReplay|querySelectorAll\('\.export-btn'\)|renderAdvisory/);
assert.match(panelControls, /wireAdvisoryReplay/);
assert.match(panelControls, /buildExports|downloadBlob|exportChartAsPng/);

// The impacts block and the outbound source links live in their own module.
// panel.js sat on its ceiling with them, so every ordinary edit had to be paid
// for by deleting a comment somewhere else.
assert.match(panelImpacts, /export function renderImpactsBlock/);
for (const owned of ['wikipediaUrl', 'youtubeUrl', 'noaaTcrUrl', 'reconArchiveUrl', 'nhcWalletUrlFor', 'sliderSatelliteUrl']) {
  assert.match(panelImpacts, new RegExp(String.raw`export function ${owned}\(`), `panel-impacts.js must own ${owned}`);
  assert.doesNotMatch(panel, new RegExp(String.raw`function ${owned}\(`), `${owned} must not be redefined in panel.js`);
}
assert.doesNotMatch(panel, /function renderImpactsBlock|im-row|impacts-block/, 'panel.js must not render impacts itself');
// The billion-dollar source link only renders once that dataset has loaded,
// which a Node test cannot do, so the address is pinned here instead. It is the
// attribution for every NCEI cost figure the panel prints.
assert.match(
  panelImpacts,
  /href="https:\/\/www\.ncei\.noaa\.gov\/access\/billions\/"/,
  'the NCEI cost figures must credit the billion-dollar disasters product itself',
);
assert.match(panel, /from '\.\/panel-impacts\.js'/, 'panel.js must consume the extracted module');

const mainLines = main.split(/\r?\n/).length;
const panelLines = panel.split(/\r?\n/).length;
assert(mainLines < 850, 'main.js shell orchestration regressed to ' + mainLines + ' lines');
assert(panelLines < 700, 'panel.js renderer regressed to ' + panelLines + ' lines');

// CIRA's SLIDER moved hosts. The old address still redirects with the query
// intact, so this is about not depending on that redirect outliving the link.
const sliderLink = panelImpacts.match(/return `(https:\/\/slider\.cira\.colostate\.edu\/\?[^`]*)`/)?.[1];
assert(sliderLink, 'the satellite quicklink must be built on the canonical SLIDER host');
// Matched anywhere in the file, not just in the return, so an interpolated
// host cannot slip the retired name past a literal-prefix check.
assert(!/rammb-slider/.test(panelImpacts), 'panel-impacts.js must not name the retired SLIDER host at all');
for (const parameter of ['sat=', 'sec=', 'start_unix=']) {
  assert(sliderLink.includes(parameter), `the SLIDER quicklink must carry ${parameter}`);
}
// SLIDER 404s goes-16 since GOES-19 took over as GOES-East on 2025-04-07.
assert(!/'goes-16'|"goes-16"|=goes-16/.test(panelImpacts), 'panel-impacts.js must not request the decommissioned goes-16 feed');
const satellites = [...panelImpacts.matchAll(/'(goes-\d+)'/g)].map(match => match[1]);
assert(satellites.length > 0, 'the quicklink must name its satellites explicitly');
for (const satellite of satellites) {
  assert(['goes-18', 'goes-19'].includes(satellite), `${satellite} is not a SLIDER feed this app should link to`);
}

// Storage persistence belongs to the save that needs it, not to boot: asking
// before the user has engaged spends the one prompt Firefox gives and the
// engagement heuristic Chromium has not seen yet, and the answer was discarded.
assert(
  !/navigator\.storage(\?\.)?\.?persist\b/.test(main),
  'main.js must not request storage persistence at boot; storage-manager.js requests it when offline data is saved',
);

console.log('shell boundaries ok (' + mainLines + ' main.js lines, ' + panelLines + ' panel.js lines; injected shell/panel owners)');
