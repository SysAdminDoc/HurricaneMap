import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const [main, search, filters, navigation, shell, panel, panelControls] = await Promise.all([
  read('src/main.js'),
  read('src/search-controller.js'),
  read('src/filter-controller.js'),
  read('src/shell-navigation.js'),
  read('src/shell-ui.js'),
  read('src/panel.js'),
  read('src/panel-controls.js'),
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

const mainLines = main.split(/\r?\n/).length;
const panelLines = panel.split(/\r?\n/).length;
assert(mainLines < 850, 'main.js shell orchestration regressed to ' + mainLines + ' lines');
assert(panelLines < 800, 'panel.js renderer regressed to ' + panelLines + ' lines');

// CIRA's SLIDER moved hosts. The old address still redirects with the query
// intact, so this is about not depending on that redirect outliving the link.
const sliderLink = panel.match(/return `(https:\/\/slider\.cira\.colostate\.edu\/\?[^`]*)`/)?.[1];
assert(sliderLink, 'the satellite quicklink must be built on the canonical SLIDER host');
assert(!/return `https:\/\/rammb-slider\./.test(panel), 'panel.js must not rebuild links on the retired SLIDER host');
for (const parameter of ['sat=', 'sec=', 'start_unix=']) {
  assert(sliderLink.includes(parameter), `the SLIDER quicklink must carry ${parameter}`);
}

// Storage persistence belongs to the save that needs it, not to boot: asking
// before the user has engaged spends the one prompt Firefox gives and the
// engagement heuristic Chromium has not seen yet, and the answer was discarded.
assert(
  !/navigator\.storage(\?\.)?\.?persist\b/.test(main),
  'main.js must not request storage persistence at boot; storage-manager.js requests it when offline data is saved',
);

console.log('shell boundaries ok (' + mainLines + ' main.js lines, ' + panelLines + ' panel.js lines; injected shell/panel owners)');
