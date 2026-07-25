import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const [main, search, filters, navigation] = await Promise.all([
  read('src/main.js'),
  read('src/search-controller.js'),
  read('src/filter-controller.js'),
  read('src/shell-navigation.js'),
]);

assert.match(main, /initSearchController/);
assert.match(main, /createFilterController/);
assert.match(main, /wireShellNavigation/);
assert.doesNotMatch(main, /searchStorms|getHistory|resetPrimaryFilters|resetYearRange|toggleCategory|closeAllPanels/);

assert.match(search, /searchStorms/);
assert.match(search, /getHistory/);
assert.match(search, /aria-activedescendant/);
assert.match(filters, /resetPrimaryFilters/);
assert.match(filters, /setYearRange/);
assert.match(filters, /toggleCategory/);
assert.match(navigation, /closeAllPanels/);
assert.match(navigation, /mobileActionsMenu|wireMobileActionsMenu/);

const mainLines = main.split(/\r?\n/).length;
assert(mainLines < 900, `main.js shell orchestration regressed to ${mainLines} lines`);

console.log(`shell boundaries ok (${mainLines} main.js lines; search/filter/navigation controllers)`);
