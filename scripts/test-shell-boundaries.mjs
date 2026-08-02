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

console.log('shell boundaries ok (' + mainLines + ' main.js lines, ' + panelLines + ' panel.js lines; injected shell/panel owners)');
