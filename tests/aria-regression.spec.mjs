import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
]);
const locales = ['en', 'es', 'ht'];
const FIXED_NOW = Date.UTC(2026, 7, 8, 16, 30, 0);
let server;
let baseUrl;

test.use({
  viewport: { width: 1440, height: 960 },
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
  // The clock below is frozen in UTC, but the timestamps these snapshots
  // contain are rendered with toLocaleString, which reads the browser's
  // timezone. Without pinning it, a baseline recorded in New York fails in
  // Denver on the hour, and in Tokyo on the date and the meridiem.
  timezoneId: 'UTC',
});

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
      const resolved = path.resolve(root, `.${pathname}`);
      if (!resolved.startsWith(root)) throw new Error('Forbidden');
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('Not found');
      response.writeHead(200, {
        'Content-Type': mime.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(resolved).pipe(response);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function prepareLocalizedPage(page, locale) {
  await page.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.nhc.noaa.gov' && url.pathname === '/CurrentStorms.json') {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture unavailable"}' });
    }
    return route.abort();
  });
  await page.addInitScript(({ language, fixedNow }) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }

      static now() { return fixedNow; }
      static parse(value) { return NativeDate.parse(value); }
      static UTC(...args) { return NativeDate.UTC(...args); }
    }
    globalThis.Date = FixedDate;
    if (navigator.storage) {
      Object.defineProperty(navigator.storage, 'estimate', {
        configurable: true,
        value: async () => ({ usage: 0, quota: 6 * 1024 ** 3 }),
      });
    }
    localStorage.setItem('hm-settings-v1', JSON.stringify({
      onboarded: true,
      theme: 'dark',
      palette: 'default',
      highContrast: false,
      reducedMotion: true,
      locale: language,
    }));
  }, { language: locale, fixedNow: FIXED_NOW });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    return loading?.style.display === 'none' && /\d/.test(document.querySelector('#visible-count')?.textContent || '');
  }, null, { timeout: 20_000 });
  await page.waitForFunction(expected => document.documentElement.lang === expected, locale);
}

async function domClick(page, selector) {
  await page.evaluate(target => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) throw new Error(`Missing clickable element: ${target}`);
    element.focus({ preventScroll: true });
    element.click();
  }, selector);
}

async function domFocus(page, selector) {
  await page.evaluate(target => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) throw new Error(`Missing focus target: ${target}`);
    element.focus({ preventScroll: true });
  }, selector);
}

async function activateHeaderAction(page, selector) {
  if (!(await page.locator(selector).isVisible())) {
    await domClick(page, '#toggle-mobile-actions');
    await page.waitForFunction(() => document.querySelector('#mobile-actions-menu')?.dataset.open === 'true');
  }
  await domClick(page, selector);
}

async function setDomValue(page, selector, value, eventName = 'input') {
  await page.evaluate(({ target, nextValue, type }) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) {
      throw new Error(`Missing form element: ${target}`);
    }
    element.value = nextValue;
    element.dispatchEvent(new Event(type, { bubbles: true }));
  }, { target: selector, nextValue: String(value), type: eventName });
}

async function dispatchDomKey(page, selector, key, extra = {}) {
  await page.evaluate(({ target, keyName, init }) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) throw new Error(`Missing keyboard target: ${target}`);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init }));
  }, { target: selector, keyName: key, init: extra });
}

// Two of these panels are compared as JSON rather than as the YAML markup the
// rest use. YAML packs a node's role, name and state onto one line, so a diff
// reports a rewritten line and leaves you to work out which of those actually
// moved. The JSON tree puts each on its own property and the diff names it.
//
// These are also the two whose YAML had drifted furthest into regexes:
// /Cat 5 \d+ kt/ had stopped checking Katrina's peak wind at all, and the
// settings menu carried thirteen more of the same shape. The values here are
// literal, which is stricter, and the frozen clock and pinned timezone above
// are what make that reproducible.
//
// toMatchSnapshot is deliberately not used: it stamps the platform into the
// file name, and an accessibility tree is not platform-specific the way a
// screenshot is. These baselines are written and rewritten by the same
// --update-snapshots flag as the rest, read off the run's own config.
const ariaJsonDir = path.join(root, 'tests', 'aria-regression.spec.mjs-snapshots');

async function expectAriaJson(page, selector, name) {
  const tree = await page.locator(selector).ariaSnapshotJSON();
  const file = path.join(ariaJsonDir, `${name}.aria.json`);
  const baseline = await readFile(file, 'utf8').catch(() => null);
  const mode = test.info().config.updateSnapshots;
  // Only an explicit update rewrites a baseline. A plain run uses mode
  // 'missing', and letting that write an absent one meant deleting a baseline
  // self-approved: the file came back and the test went green. Playwright's
  // own toMatchAriaSnapshot, which the other snapshots in this file use,
  // writes the actual tree and still fails, so this does the same.
  if (mode === 'all' || mode === 'changed') {
    await mkdir(ariaJsonDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(tree, null, 2)}\n`);
    return;
  }
  if (baseline === null) {
    await mkdir(ariaJsonDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(tree, null, 2)}\n`);
    throw new Error(`${name}.aria.json did not exist; the actual tree has been written to ${file}. `
      + 'Check it, then re-run to accept it.');
  }
  expect(tree, `${name} accessibility tree changed`).toEqual(JSON.parse(baseline));
}

async function assertNoAxeViolations(page, label, selector) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .include(selector)
    .analyze();
  const failures = results.violations.map(violation => `${violation.id}: ${violation.nodes[0]?.target?.join(',') || 'unknown'}`);
  expect(failures, `${label} has axe violations`).toEqual([]);
}

for (const locale of locales) {
  test(`ARIA snapshots remain localized for ${locale}`, async ({ page }) => {
    await prepareLocalizedPage(page, locale);

    await openStorm(page, 'AL122005');
    await expectAriaJson(page, '#storm-panel', `${locale}-storm-panel`);

    await closePanels(page);
    await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
    await page.waitForSelector('#settings-menu:popover-open', { timeout: 5_000 });
    await expectAriaJson(page, '#settings-menu', `${locale}-settings`);

    await closePanels(page);
    await openStorm(page, 'AL142024');
    await page.check('#advisory-replay-enabled');
    await page.waitForFunction(() => document.querySelector('#advisory-replay-meta')?.textContent);
    await expect(page.locator('#storm-panel .advisory-replay-control')).toMatchAriaSnapshot({
      name: `${locale}-advisory-replay.aria.yml`,
    });
  });
}

for (const locale of locales) {
  test(`localized accessibility journeys preserve focus for ${locale}`, async ({ page }) => {
    // Seven extra ARIA snapshots per locale on top of the axe sweep.
    test.setTimeout(150_000);
    await prepareLocalizedPage(page, locale);
    await assertNoAxeViolations(page, `${locale} filters`, '#filters');

    await domClick(page, '#toggle-filters');
    await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'));
    await domFocus(page, '#search-input');
    await setDomValue(page, '#search-input', 'Katrina');
    await page.waitForSelector('#search-results:not([hidden]) li[data-storm-id]');
    const searchState = await page.evaluate(async () => ({
      expanded: document.querySelector('#search-input')?.getAttribute('aria-expanded'),
      label: document.querySelector('#search-results')?.getAttribute('aria-label'),
      expectedLabel: (await import('/src/i18n.js')).t('filters.searchResults'),
    }));
    expect(searchState.expanded).toBe('true');
    expect(searchState.label).toBe(searchState.expectedLabel);

    // Search matches are painted through CSS.highlights rather than wrapped in
    // an element. Both halves of that claim are checked here, because the
    // <mark> implementation this replaced would pass neither: highlighting
    // must leave the markup identical, and it must leave the accessibility
    // tree identical. Taking the highlight down and re-reading both is the
    // comparison, so a future change that starts inserting nodes fails on the
    // difference rather than on a snapshot somebody re-approved.
    const highlighted = await page.evaluate(() => {
      const list = document.querySelector('#search-results');
      return {
        supported: typeof Highlight === 'function' && typeof CSS?.highlights?.set === 'function',
        ranges: CSS?.highlights?.get('hm-search-match')?.size ?? 0,
        // Only the region highlighting works in. The whole list cannot be
        // compared across two reads: backfillSparklines injects an SVG into
        // .search-result-spark-host asynchronously once storms.json has
        // loaded, and it landed between the two reads in 1 of 14 runs, failing
        // both the en and es journeys with a diff made entirely of sparkline
        // path data. The spark host is a sibling of .search-result-text and is
        // aria-hidden, so nothing about highlighting can reach it.
        markup: [...list.querySelectorAll('.search-result-text')].map(node => node.outerHTML).join(''),
        marks: list.querySelectorAll('mark').length,
      };
    });
    // Comparing two empty strings would pass for the wrong reason.
    expect(highlighted.markup.length, 'the result rows must have rendered').toBeGreaterThan(0);
    // Not conditional on support: an engine without the API renders plain text,
    // and plain text has no <mark> in it either.
    expect(highlighted.marks, 'match highlighting must not wrap text in elements').toBe(0);
    if (highlighted.supported) {
      expect(highlighted.ranges, 'searching Katrina must paint at least one range').toBeGreaterThan(0);
    }
    // A screen reader must still be given the whole row while the highlight is
    // up. This is an auto-retrying assertion on purpose. Chromium builds an
    // option's accessibility subtree in stages: it arrives with no name, then
    // with a partial one, then with its children. An earlier version of this
    // compared two ariaSnapshotJSON() reads taken either side of clearing the
    // highlight, which raced that build rather than measuring anything about
    // highlighting: 8 of 12 consecutive runs failed with the first read
    // holding a bare {role, selected}, and waiting only for a non-empty name
    // still left 1 in 12 failing on the partial name "Katrina". A retrying
    // assertion on the settled name is the same claim without the race.
    await expect(page.locator('#search-results li[data-storm-id]').first())
      .toHaveAccessibleName(/2005.*Katrina/);

    // And this is the comparison that would catch a <mark> implementation:
    // exact, taken from the DOM rather than from a tree derived from it, and
    // not a stored snapshot anybody can re-approve. The accessibility tree is
    // a function of this markup, so proving the markup is untouched is the
    // stronger half of "highlighting changes nothing a reader can see".
    const markupWithoutHighlight = await page.evaluate(async () => {
      const { clearSearchHighlights } = await import('/src/search-highlight.js');
      clearSearchHighlights();
      const list = document.querySelector('#search-results');
      return [...list.querySelectorAll('.search-result-text')].map(node => node.outerHTML).join('');
    });
    expect(markupWithoutHighlight).toBe(highlighted.markup);
    await dispatchDomKey(page, '#search-input', 'ArrowDown');
    await page.waitForFunction(() => Boolean(document.querySelector('#search-input')?.getAttribute('aria-activedescendant')));
    await dispatchDomKey(page, '#search-input', 'Enter');
    await page.waitForSelector('#storm-panel:not([hidden]) .storm-panel-layout', { timeout: 15_000 });
    await page.waitForFunction(() => document.activeElement?.closest('#storm-panel') !== null, null, { timeout: 5_000 });
    await assertNoAxeViolations(page, `${locale} storm panel`, '#storm-panel');
    const stormBeforeCloseFocus = await page.evaluate(() => document.activeElement?.closest('#storm-panel') !== null);
    expect(stormBeforeCloseFocus).toBe(true);
    await page.click('#close-panel');
    await page.waitForFunction(() => document.querySelector('#storm-panel')?.hidden);
    await page.waitForFunction(() => ['map', 'toggle-filters', 'search-input'].includes(document.activeElement?.id));

    const filtersCollapsed = await page.locator('#filters').evaluate(element => element.classList.contains('collapsed'));
    if (filtersCollapsed) await domClick(page, '#toggle-filters');
    await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'));
    const beforeFilterCount = await page.textContent('#visible-count');
    await setDomValue(page, '#year-min', 2000, 'change');
    await page.waitForFunction(previous => document.querySelector('#visible-count')?.textContent !== previous, beforeFilterCount);
    await domClick(page, '[data-cat="5"]');
    await page.waitForFunction(() => document.querySelector('[data-cat="5"]')?.getAttribute('aria-pressed') === 'false');
    await domClick(page, '#reset-filters');
    await page.waitForFunction(() => document.querySelector('#reset-filters')?.disabled === true);

    await domFocus(page, '#toggle-stats');
    await domClick(page, '#toggle-stats');
    await page.waitForSelector('#stats-panel:not([hidden]) #stats-panel-title', { timeout: 10_000 });
    await page.waitForFunction(() => document.activeElement?.id === 'stats-panel-title');
    await assertNoAxeViolations(page, `${locale} statistics`, '#stats-panel');
    await expect(page.locator('#stats-panel')).toMatchAriaSnapshot({ name: `${locale}-statistics.aria.yml` });
    await domClick(page, '#close-stats');
    await page.waitForFunction(() => document.querySelector('#stats-panel')?.hidden && document.activeElement?.id === 'toggle-stats');

    await domFocus(page, '#toggle-compare');
    await page.evaluate(async () => {
      const data = await import('/src/data.js');
      const compare = await import('/src/compare.js');
      await data.ensureStormsLoaded();
      await compare.setPinsByIds(['AL122005', 'AL041992']);
      compare.openComparePanel();
    });
    await page.waitForSelector('#compare-panel:not([hidden]) .cp-card', { timeout: 10_000 });
    await page.waitForFunction(() => document.activeElement?.id === 'compare-panel-title');
    await assertNoAxeViolations(page, `${locale} compare`, '#compare-panel');
    await expect(page.locator('#compare-panel')).toMatchAriaSnapshot({ name: `${locale}-compare.aria.yml` });
    await domClick(page, '#close-compare');
    await page.waitForFunction(() => document.querySelector('#compare-panel')?.hidden && document.activeElement?.id === 'toggle-compare');

    await activateHeaderAction(page, '#toggle-table-view');
    await page.waitForSelector('#table-view-panel:not([hidden]) tbody tr', { timeout: 10_000 });
    await assertNoAxeViolations(page, `${locale} landfall table`, '#table-view-panel');
    await expect(page.locator('#table-view-panel')).toMatchAriaSnapshot({ name: `${locale}-landfall-table.aria.yml` });
    await domFocus(page, '#table-view-panel th[data-col="year"]');
    const sortBefore = await page.getAttribute('#table-view-panel th[data-col="year"]', 'aria-sort');
    await dispatchDomKey(page, '#table-view-panel th[data-col="year"]', 'Enter');
    await page.waitForFunction(previous => document.querySelector('#table-view-panel th[data-col="year"]')?.getAttribute('aria-sort') !== previous, sortBefore);
    await domClick(page, '#close-table-view');
    await page.waitForFunction(() => document.querySelector('#table-view-panel')?.hidden && document.activeElement?.id === 'toggle-mobile-actions');

    await domFocus(page, '#toggle-on-this-date');
    await domClick(page, '#toggle-on-this-date');
    await page.waitForSelector('#on-this-date-panel:not([hidden]) .otd-content, #on-this-date-panel:not([hidden]) .empty-state', { timeout: 10_000 });
    await assertNoAxeViolations(page, `${locale} on-this-date`, '#on-this-date-panel');
    await expect(page.locator('#on-this-date-panel')).toMatchAriaSnapshot({ name: `${locale}-on-this-date.aria.yml` });
    await domClick(page, '#close-on-this-date');
    await page.waitForFunction(() => document.querySelector('#on-this-date-panel')?.hidden && document.activeElement?.id === 'toggle-on-this-date');

    await activateHeaderAction(page, '#toggle-prep');
    await page.waitForSelector('#prep-panel:not([hidden]) #prep-household', { timeout: 10_000 });
    await assertNoAxeViolations(page, `${locale} preparedness`, '#prep-panel');
    await expect(page.locator('#prep-panel')).toMatchAriaSnapshot({ name: `${locale}-preparedness.aria.yml` });
    await setDomValue(page, '#prep-household', 2, 'change');
    await setDomValue(page, '#prep-mode', 'home', 'change');
    await domClick(page, '[data-prep-item="water"]');
    await page.waitForFunction(() => /28/.test(document.querySelector('.prep-totals')?.textContent || '') && document.querySelector('[data-prep-item="water"]')?.checked);
    await domClick(page, '#close-prep');
    await page.waitForFunction(() => document.querySelector('#prep-panel')?.hidden && document.activeElement?.id === 'toggle-mobile-actions');

    await activateHeaderAction(page, '#toggle-evac');
    await page.waitForSelector('#evac-panel:not([hidden]) #evac-address-input', { timeout: 10_000 });
    await expect(page.locator('#evac-disclosure')).toContainText('Esri');
    await assertNoAxeViolations(page, `${locale} evacuation`, '#evac-panel');
    await expect(page.locator('#evac-panel')).toMatchAriaSnapshot({ name: `${locale}-evacuation.aria.yml` });
    const evacReady = await page.evaluate(async () => (await import('/src/i18n.js')).t('evac.ready'));
    await setDomValue(page, '#evac-address-input', '100 Main Street', 'input');
    await page.evaluate(() => document.querySelector('#evac-address-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await page.waitForFunction(previous => document.querySelector('#evac-result')?.textContent?.trim() !== previous, evacReady);
    await domClick(page, '#close-evac');
    await page.waitForFunction(() => document.querySelector('#evac-panel')?.hidden && document.activeElement?.id === 'toggle-mobile-actions');

    await activateHeaderAction(page, '#toggle-spatial-search');
    await page.waitForSelector('#spatial-results:not([hidden]) .sp-hint', { timeout: 10_000 });
    await page.evaluate(async () => {
      const { getMap } = await import('/src/map.js');
      getMap().fire('contextmenu', {
        latlng: { lat: 25.7617, lng: -80.1918 },
        originalEvent: { preventDefault() {} },
      });
    });
    await page.waitForSelector('#spatial-results:not([hidden]) .sp-count', { timeout: 15_000 });
    await assertNoAxeViolations(page, `${locale} spatial search`, '#spatial-results');
    await expect(page.locator('#spatial-results')).toMatchAriaSnapshot({ name: `${locale}-spatial-search.aria.yml` });
    await domClick(page, '#spatial-results .close-btn');
    await page.waitForFunction(() => document.querySelector('#spatial-results')?.hidden && document.activeElement?.id === 'toggle-mobile-actions');

    await domFocus(page, '#toggle-globe3d');
    await domClick(page, '#toggle-globe3d');
    await page.waitForSelector('#globe3d-panel:not([hidden])', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('#globe3d-status')?.textContent && !/loading/i.test(document.querySelector('#globe3d-status')?.textContent || ''), null, { timeout: 15_000 });
    await expect(page.locator('#globe3d-panel')).toHaveAttribute('aria-modal', 'true');
    await assertNoAxeViolations(page, `${locale} globe fallback`, '#globe3d-panel');
    await domClick(page, '#close-globe3d');
    await page.waitForFunction(() => document.querySelector('#globe3d-panel')?.hidden && document.activeElement?.id === 'toggle-globe3d');

    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    await domFocus(page, '#toggle-settings');
    await domClick(page, '#toggle-settings');
    await page.waitForSelector('#settings-menu:popover-open', { timeout: 5_000 });
    await assertNoAxeViolations(page, `${locale} forced-colors settings`, '#settings-menu');
    await domClick(page, '#toggle-high-contrast');
    await page.waitForFunction(() => document.documentElement.classList.contains('high-contrast'));
    const accessibilityState = await page.evaluate(() => ({
      forcedColors: matchMedia('(forced-colors: active)').matches,
      reducedMotion: document.documentElement.classList.contains('reduce-motion'),
      transitionDuration: getComputedStyle(document.querySelector('#settings-menu')).transitionDuration,
    }));
    expect(accessibilityState.forcedColors).toBe(true);
    expect(accessibilityState.reducedMotion).toBe(true);
    const transitionMillis = accessibilityState.transitionDuration.endsWith('ms')
      ? Number.parseFloat(accessibilityState.transitionDuration)
      : Number.parseFloat(accessibilityState.transitionDuration) * 1_000;
    expect(transitionMillis).toBeCloseTo(0.01, 6);
  });
}

test.describe('mobile accessibility journeys', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const locale of locales) {
    test(`action rail and panels remain localized for ${locale}`, async ({ page }) => {
      test.setTimeout(60_000);
      await prepareLocalizedPage(page, locale);
      await assertNoAxeViolations(page, `${locale} mobile filters`, '#filters');

      await domFocus(page, '.header-actions');
      await dispatchDomKey(page, '.header-actions', 'End');
      await page.waitForFunction(() => document.querySelector('.header-actions')?.dataset.scrollEnd === 'true');
      await dispatchDomKey(page, '.header-actions', 'Home');
      await page.waitForFunction(() => document.querySelector('.header-actions')?.dataset.scrollStart === 'true');

      await domFocus(page, '#toggle-mobile-actions');
      await domClick(page, '#toggle-mobile-actions');
      await page.waitForFunction(() => document.querySelector('#mobile-actions-menu')?.dataset.open === 'true');
      const mobileActions = await page.evaluate(() => [...document.querySelectorAll('#mobile-actions-menu > .icon-btn')]
        .map(button => button.getAttribute('aria-label')));
      expect(mobileActions.length).toBeGreaterThan(4);
      expect(mobileActions.every(Boolean)).toBe(true);

      await domFocus(page, '#toggle-table-view');
      await domClick(page, '#toggle-table-view');
      await page.waitForSelector('#table-view-panel:not([hidden]) tbody tr', { timeout: 10_000 });
      await assertNoAxeViolations(page, `${locale} mobile table`, '#table-view-panel');
      await domClick(page, '#close-table-view');
      await page.waitForFunction(() => document.querySelector('#table-view-panel')?.hidden && document.activeElement?.id === 'toggle-mobile-actions');

      await domFocus(page, '#toggle-mobile-actions');
      await domClick(page, '#toggle-mobile-actions');
      await page.waitForFunction(() => document.querySelector('#mobile-actions-menu')?.dataset.open === 'true');
      await dispatchDomKey(page, '#toggle-mobile-actions', 'Escape');
      await page.waitForFunction(() => document.querySelector('#mobile-actions-menu')?.dataset.open === 'false' && document.activeElement?.id === 'toggle-mobile-actions');
    });
  }
});

test('optional feed states stay localized, source-labelled, retryable, and cancellable', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('hm-settings-v1', JSON.stringify({
      onboarded: true,
      theme: 'dark',
      palette: 'default',
      highContrast: false,
      reducedMotion: true,
      locale: 'en',
    }));
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    const ui = await import('/src/optional-feed-ui.js');
    const host = document.createElement('div');
    host.id = 'optional-feed-browser-fixture';
    document.body.appendChild(host);
    feeds.idleOptionalFeed('active');
    ui.mountOptionalFeedStatus(host, 'active', {
      onRetry: async () => {
        const request = feeds.beginOptionalFeed('active');
        feeds.completeOptionalFeed('active', {
          requestId: request.requestId,
          itemCount: 1,
          completedAt: Date.now(),
        });
      },
    });

    const successRequest = feeds.beginOptionalFeed('active');
    if (host.dataset.state !== 'loading' || !host.textContent.includes('NOAA NHC CurrentStorms')) {
      throw new Error('loading state did not expose the localized source');
    }
    feeds.completeOptionalFeed('active', { requestId: successRequest.requestId, itemCount: 2, completedAt: Date.now() });
    if (host.dataset.state !== 'success' || !host.textContent.includes('Last good')) {
      throw new Error('success state did not expose last-good metadata');
    }

    feeds.idleOptionalFeed('forecast');
    feeds.beginOptionalFeed('forecast');
    feeds.failOptionalFeed('forecast', { responseStatus: 404 });
    feeds.idleOptionalFeed('alerts');
    feeds.beginOptionalFeed('alerts');
    feeds.failOptionalFeed('alerts', { responseStatus: 429 });
    feeds.idleOptionalFeed('surge');
    feeds.beginOptionalFeed('surge');
    feeds.failOptionalFeed('surge', { error: new SyntaxError('malformed JSON') });
    feeds.idleOptionalFeed('goes');
    feeds.beginOptionalFeed('goes');
    feeds.failOptionalFeed('goes', { error: new Error('request timed out') });
    feeds.idleOptionalFeed('tides');
    feeds.beginOptionalFeed('tides');
    feeds.failOptionalFeed('tides', { online: false });
    if (feeds.getOptionalFeedState('forecast').state !== 'error'
      || feeds.getOptionalFeedState('alerts').state !== 'rate-limited'
      || feeds.getOptionalFeedState('surge').state !== 'malformed'
      || feeds.getOptionalFeedState('goes').state !== 'timeout'
      || feeds.getOptionalFeedState('tides').state !== 'offline') {
      throw new Error('one or more degraded states were not classified');
    }

    const staleRequest = feeds.beginOptionalFeed('active');
    feeds.failOptionalFeed('active', { responseStatus: 429, requestId: staleRequest.requestId });
    if (host.dataset.state !== 'stale' || !host.textContent.includes('Showing the last-good result')) {
      throw new Error('stale last-good state did not render its recovery notice');
    }

    const first = feeds.beginOptionalFeed('radar');
    const second = feeds.beginOptionalFeed('radar');
    feeds.completeOptionalFeed('radar', { requestId: first.requestId, itemCount: 1 });
    if (feeds.getOptionalFeedState('radar').state !== 'loading') throw new Error('late completion won after cancellation replacement');
    feeds.cancelOptionalFeed('radar', { requestId: second.requestId });
  });

  await page.evaluate(() => document.querySelector('#optional-feed-browser-fixture [data-optional-feed-retry]')?.click());
  await page.waitForFunction(() => document.querySelector('#optional-feed-browser-fixture')?.dataset.state === 'success');
  await expect(page.locator('#optional-feed-browser-fixture')).toContainText('Current');
});

async function openStorm(page, stormId) {
  await page.evaluate(async id => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const landfall = data.getLandfalls().find(item => item.storm_id === id);
    if (!landfall) throw new Error(`ARIA snapshot storm ${id} not found`);
    await panel.showStorm(landfall);
  }, stormId);
  await page.waitForSelector('#storm-panel:not([hidden]) .storm-panel-layout', { timeout: 15_000 });
}

async function closePanels(page) {
  await page.evaluate(async () => {
    const panels = await import('/src/panels.js');
    panels.closeAllPanels();
    document.querySelector('#settings-menu')?.hidePopover();
  });
  await page.waitForFunction(() => (
    document.querySelector('#storm-panel')?.hidden !== false &&
    !document.querySelector('#settings-menu')?.matches(':popover-open')
  ));
}

// WCAG 2.2 SC 1.4.13 Content on Hover or Focus: hover content has to be
// dismissible without moving the pointer or the focus, hoverable, and
// persistent. The header tooltips closed only on pointerleave and blur, so
// Escape did nothing and moving the pointer toward the tooltip dismissed it.
// The VPAT claimed all three long before any of them were true.
test('header tooltips are dismissible with Escape and survive being hovered', async ({ page }) => {
  await prepareLocalizedPage(page, 'en');
  const tooltip = page.locator('#header-tooltip');
  const shown = () => page.evaluate(() => {
    const element = document.querySelector('#header-tooltip');
    return Boolean(element) && getComputedStyle(element).display !== 'none';
  });

  // Driven by dispatched pointer events rather than by mouse geometry: the
  // tooltip sits below its control, so a synthetic cursor path between the two
  // proves nothing about which listener ran.
  const enter = selector => page.dispatchEvent(selector, 'pointerenter');
  const leave = selector => page.dispatchEvent(selector, 'pointerleave');

  // Persistent: it appears on hover and stays while the pointer is still.
  await enter('#toggle-filters');
  await expect(tooltip).toBeVisible();
  await page.waitForTimeout(400);
  expect(await shown()).toBe(true);

  // Dismissible: Escape hides it without the pointer or the focus moving.
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  // And it stays dismissed. Another pointerenter on the same control, which is
  // what a stationary cursor produces after any reflow, must not bring it back.
  await enter('#toggle-filters');
  await page.waitForTimeout(500);
  expect(await shown()).toBe(false);

  // Leaving the control and coming back is a fresh request for it.
  await leave('#toggle-filters');
  await enter('#toggle-filters');
  await expect(tooltip).toBeVisible();

  // Hoverable: leaving the control starts a grace period, and a pointer inside
  // the tooltip's box holds it open. The tooltip itself takes no pointer
  // events, because it is fixed at z-index 6000 over the context rail and the
  // map and would otherwise swallow a click on either.
  const box = await tooltip.boundingBox();
  await leave('#toggle-filters');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  expect(await shown()).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#header-tooltip')).pointerEvents)).toBe('none');
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id !== 'header-tooltip',
    { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true);

  // Moving off it does close it.
  await page.mouse.move(700, 700);
  await expect(tooltip).toBeHidden();

  // Escape must still reach everything else WHILE a tooltip is showing. An
  // earlier version stopped propagation from the capture phase, so a tooltip
  // over an open panel meant Escape closed neither.
  await page.click('#toggle-stats');
  await page.waitForSelector('#stats-panel:not([hidden])', { timeout: 10_000 });
  // Blurred first: the click left the stats toggle focused, and closing the
  // panel returns focus to it, which legitimately opens its own tooltip and
  // makes "is the tooltip hidden" the wrong question to ask afterwards.
  await page.evaluate(() => document.querySelector('#toggle-stats')?.blur());
  await enter('#toggle-filters');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  // Only the panel is asserted here. Closing it returns focus to the control
  // that opened it, and a focused control opens its own tooltip, so "is a
  // tooltip showing" a moment later is a race rather than a contract. That the
  // tooltip is dismissed by Escape is proved above, with nothing else moving.
  await page.waitForFunction(() => document.querySelector('#stats-panel')?.hidden === true, null, { timeout: 5_000 });
});

test('the recents list can be cleared, and stays cleared across a reload', async ({ page }) => {
  await prepareLocalizedPage(page, 'en');

  // Seeded through the module that owns the record, so the shape under test is
  // the shape the app actually writes rather than a hand-built one.
  await page.evaluate(async () => {
    const history = await import('/src/search-history.js');
    history.recordView({ storm_id: 'AL122005', name: 'KATRINA', year: 2005, category: 5, state: 'Louisiana', t: '2005-08-29T11:10:00Z', lat: 29.3, lon: -89.6 });
    history.recordView({ storm_id: 'AL092022', name: 'IAN', year: 2022, category: 4, state: 'Florida', t: '2022-09-28T19:05:00Z', lat: 26.7, lon: -82.2 });
  });

  // The filter panel's starting state differs by viewport, so it is expanded
  // conditionally: an unconditional click closed it here and the search field
  // was never reachable.
  const expandFilters = async () => {
    if (await page.getAttribute('#toggle-filters', 'aria-expanded') !== 'true') {
      await page.click('#toggle-filters');
    }
    await expect(page.locator('#search-input')).toBeVisible();
  };
  await expandFilters();
  await page.locator('#search-input').focus();
  await expect(page.locator('#search-results')).toBeVisible();
  await expect(page.locator('#search-results li[data-storm-id]')).toHaveCount(2);
  const clear = page.locator('#clear-search-history');
  await expect(clear).toBeVisible();

  // The control is a button beside the listbox, not an option inside it. axe
  // is asked about the whole row so the listbox and the button are judged
  // together, which is where a button owned by a listbox would show up.
  await assertNoAxeViolations(page, 'search recents with the clear control', '#search-popup');

  // Reachable from the keyboard, and reaching it must not close the popup out
  // from under the focus that just arrived.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('clear-search-history');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('clear-search-history');
  await expect(page.locator('#search-results')).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#search-results li[data-storm-id]')).toHaveCount(0);
  await expect(page.locator('#search-results .search-empty')).toContainText('Recent searches cleared');
  await expect(clear).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('hm-search-history-v1'))).toBe(null);

  // A reload is the only thing that proves the device forgot rather than the
  // open page forgetting.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    return loading?.style.display === 'none' && /\d/.test(document.querySelector('#visible-count')?.textContent || '');
  }, null, { timeout: 20_000 });
  expect(await page.evaluate(async () => {
    const history = await import('/src/search-history.js');
    return history.getHistory().length;
  })).toBe(0);
  await expandFilters();
  await page.locator('#search-input').focus();
  await page.waitForTimeout(300);
  await expect(page.locator('#search-results')).toBeHidden();
  await expect(page.locator('#clear-search-history')).toBeHidden();
});

test('a region fetching a feed is announced busy, and never left busy', async ({ page }) => {
  await prepareLocalizedPage(page, 'en');
  await openStorm(page, 'AL122005');
  const panel = page.locator('#storm-panel');
  await expect(panel).toBeVisible();
  // The tides block mounts its status host before it fetches, so a loading
  // state has somewhere inside the region to render.
  await expect(page.locator('#storm-panel #tides-feed-status')).toHaveCount(1);
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');

  const drive = (call, args = {}) => page.evaluate(async ({ name, options }) => {
    const feeds = await import('/src/optional-feeds.js');
    feeds[name]('tides', options);
  }, { name: call, options: args });

  // Fetching: the region says so, so a screen reader is not handed stale
  // contents with nothing to indicate they are being replaced.
  await drive('beginOptionalFeed');
  await expect(panel).toHaveAttribute('aria-busy', 'true');

  // Settled: cleared.
  await drive('completeOptionalFeed', { itemCount: 3 });
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');

  // Failed: also cleared. A region left busy after an error is worse than one
  // that was never marked, because it never resolves for the reader.
  await drive('beginOptionalFeed');
  await expect(panel).toHaveAttribute('aria-busy', 'true');
  await drive('failOptionalFeed', { responseStatus: 503 });
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');

  // A second feed in the same region holds it busy while the first settles.
  // Clearing on the first to finish would announce the panel as ready while
  // something in it was still loading.
  const bothFeeds = await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    const hosts = [...document.querySelectorAll('#storm-panel [data-feed][data-state]')]
      .map(node => node.dataset.feed);
    return hosts;
  });
  // Asserted rather than guarded: a conditional here would go quiet the day the
  // panel stops carrying two feeds, and the multi-feed case is the one the
  // recompute exists for.
  expect(bothFeeds, 'the storm panel must carry more than one feed for this to mean anything')
    .toEqual(['tides', 'fema']);
  {
    const [first, second] = bothFeeds;
    await page.evaluate(async ({ a, b }) => {
      const feeds = await import('/src/optional-feeds.js');
      feeds.beginOptionalFeed(a);
      feeds.beginOptionalFeed(b);
    }, { a: first, b: second });
    await expect(panel).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(async ({ a }) => {
      const feeds = await import('/src/optional-feeds.js');
      feeds.completeOptionalFeed(a, { itemCount: 1 });
    }, { a: first });
    await expect(panel).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(async ({ b }) => {
      const feeds = await import('/src/optional-feeds.js');
      feeds.completeOptionalFeed(b, { itemCount: 1 });
    }, { b: second });
    await expect(panel).not.toHaveAttribute('aria-busy', 'true');
  }

  // Swept while it is actually busy. Running axe after everything settled asked
  // nothing about aria-busy at all.
  await drive('beginOptionalFeed');
  await expect(panel).toHaveAttribute('aria-busy', 'true');
  await assertNoAxeViolations(page, 'storm panel while a region is busy', '#storm-panel');
  await drive('completeOptionalFeed', { itemCount: 1 });
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');

  // The filter drawer is a region too, and it holds the storm search and every
  // filter control beside one feed. Marking the whole of it busy while a tile
  // layer loads would tell a reader the search box is being replaced. The
  // layer is switched on first, because that is what mounts the status host
  // this rule is about; driving the feed with no host mounted would assert
  // nothing.
  await page.evaluate(async () => {
    const population = await import('/src/population.js');
    population.setPopulation(true);
  });
  await expect(page.locator('#filters #population-feed-status')).toHaveAttribute('data-feed', 'population');
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    feeds.beginOptionalFeed('population');
  });
  await expect(page.locator('#filters #population-feed-status')).toHaveAttribute('data-state', 'loading');
  await expect(page.locator('#filters')).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    feeds.completeOptionalFeed('population', { itemCount: 1 });
    const population = await import('/src/population.js');
    population.setPopulation(false);
  });

  // The diagnostics list renders a row per feed carrying the same data-feed and
  // data-state pair as a status host. If one ever lands inside a panel, it must
  // not hold that panel busy on behalf of every feed in the app.
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'feed-diagnostic';
    row.dataset.feed = 'forecast';
    row.dataset.state = 'loading';
    row.id = 'hm-fake-diagnostic-row';
    document.getElementById('storm-panel')?.appendChild(row);
  });
  await drive('completeOptionalFeed', { itemCount: 1 });
  await expect(panel).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => document.getElementById('hm-fake-diagnostic-row')?.remove());
});

test('a feed card that floats over the map names the surface it fills, and marks it busy', async ({ page }) => {
  await prepareLocalizedPage(page, 'en');

  // The radar panel is the case aria-busy could not reach: its status card is
  // appended to the body, so there is no panel around it to mark and it had to
  // be told which element its feed fills.
  await page.evaluate(async () => {
    const { getMap } = await import('/src/map.js');
    const { RadarOverlay } = await import('/src/radar.js');
    const overlay = new RadarOverlay(getMap());
    window.__hmRadarBusy = overlay;
    await overlay.show({
      id: 'AL011995',
      name: 'ALLISON',
      year: 1995,
      us_landfalls: [{ t: '1995-06-05T14:00:00Z', lat: 29.9, lon: -84.4, state: 'Florida' }],
      track: [],
    }, 0);
  });
  const controls = page.locator('#radar-time');
  const card = page.locator('#radar-feed-status');
  await expect(controls).toHaveCount(1);
  await expect(card).toHaveCount(1);

  // Named, so the card and the surface it speaks for are not two unrelated
  // things in the accessibility tree.
  await expect(card).toHaveAttribute('aria-controls', 'radar-time');
  await expect(controls).not.toHaveAttribute('aria-busy', 'true');

  const drive = (call, args = {}) => page.evaluate(async ({ name, options }) => {
    const feeds = await import('/src/optional-feeds.js');
    feeds[name]('radar', options);
  }, { name: call, options: args });

  await drive('beginOptionalFeed');
  await expect(controls).toHaveAttribute('aria-busy', 'true');
  await assertNoAxeViolations(page, 'radar controls while the feed is loading', '#radar-controls');

  await drive('completeOptionalFeed', { itemCount: 4 });
  await expect(controls).not.toHaveAttribute('aria-busy', 'true');

  // A failure clears it too. A surface left busy after an error never resolves
  // for the reader, which is worse than never marking it.
  await drive('beginOptionalFeed');
  await expect(controls).toHaveAttribute('aria-busy', 'true');
  await drive('failOptionalFeed', { responseStatus: 503 });
  await expect(controls).not.toHaveAttribute('aria-busy', 'true');

  // The card speaks only for the surface it names. Another feed loading must
  // not mark the radar controls. Driven with a feed whose own card is mounted,
  // because a feed with no card on the page changes nothing anywhere and would
  // assert nothing here.
  await openStorm(page, 'AL122005');
  await expect(page.locator('#storm-panel #tides-feed-status')).toHaveCount(1);
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    feeds.beginOptionalFeed('tides');
  });
  await expect(page.locator('#storm-panel')).toHaveAttribute('aria-busy', 'true');
  await expect(controls).not.toHaveAttribute('aria-busy', 'true');

  // And the radar card re-rendering while another feed is loading must still
  // report the radar. A card only re-marks its own surface when it re-renders,
  // so the isolation is only observable at that moment: settling the radar
  // while tides is still in flight has to leave the controls not busy.
  await drive('completeOptionalFeed', { itemCount: 4 });
  await expect(controls).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#storm-panel')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    feeds.completeOptionalFeed('tides', { itemCount: 1 });
    window.__hmRadarBusy?.close();
  });
});

test('a floating feed card names a surface that exists when it mounts', async ({ page }) => {
  await prepareLocalizedPage(page, 'en');

  // Three feeds whose status card floats over the map instead of sitting in a
  // panel. Each names the element its own feed fills, and that element has to
  // exist by the time the card is mounted: creating it inside a draw meant an
  // out-of-season outlook, or a marine feed that settled to an error, named
  // nothing at all for the life of the tab and announced no load ever.
  await page.evaluate(async () => {
    const outlook = await import('/src/outlook.js');
    const marine = await import('/src/marine-warnings.js');
    const active = await import('/src/active.js');
    const { getMap } = await import('/src/map.js');
    // Started, not awaited: what matters is the state of the page while the
    // fetch is in flight, which is exactly when the old code named nothing.
    outlook.renderTropicalOutlook({ map: getMap(), enabled: true, force: true }).catch(() => {});
    marine.renderMarineWarnings({ map: getMap(), enabled: true, horizon: '00to24', force: true }).catch(() => {});
    active.startActiveStormPolling?.();
  });

  const pairs = [
    ['#nhc-outlook-status', 'nhc-outlook-legend'],
    ['#marine-warning-status', 'marine-warning-legend'],
    ['#active-feed-status', 'active-storm-badge'],
  ];
  for (const [card, target] of pairs) {
    await page.waitForSelector(card, { timeout: 20_000 });
    await expect(page.locator(card)).toHaveAttribute('aria-controls', target, { timeout: 20_000 });
    await expect(page.locator(`#${target}`)).toHaveCount(1);
  }

  // And the naming survives a failure, which is the state these two feeds spend
  // most of their time in outside a season.
  for (const [card, target] of pairs) {
    const feed = await page.evaluate(selector => document.querySelector(selector)?.dataset.feed, card);
    await page.evaluate(async id => {
      const feeds = await import('/src/optional-feeds.js');
      feeds.beginOptionalFeed(id);
    }, feed);
    await expect(page.locator(`#${target}`)).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(async id => {
      const feeds = await import('/src/optional-feeds.js');
      feeds.failOptionalFeed(id, { responseStatus: 503 });
    }, feed);
    await expect(page.locator(`#${target}`)).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator(card)).toHaveAttribute('aria-controls', target);
  }
});

test('the radar card marks the timestamp, not the controls around it', async ({ page }) => {
  await prepareLocalizedPage(page, 'en');
  await page.evaluate(async () => {
    const { getMap } = await import('/src/map.js');
    const { RadarOverlay } = await import('/src/radar.js');
    const overlay = new RadarOverlay(getMap());
    window.__hmRadarTarget = overlay;
    await overlay.show({
      id: 'AL011995',
      name: 'ALLISON',
      year: 1995,
      us_landfalls: [{ t: '1995-06-05T14:00:00Z', lat: 29.9, lon: -84.4, state: 'Florida' }],
      track: [],
    }, 0);
  });
  const card = page.locator('#radar-feed-status');
  await expect(card).toHaveAttribute('aria-controls', 'radar-time');

  // The target must not be an ancestor of the card. aria-busy on an ancestor
  // of a live region tells assistive technology to withhold that region's
  // updates, so marking #radar-controls suppressed the very announcement the
  // card exists to make.
  expect(await page.evaluate(() => {
    const host = document.getElementById('radar-feed-status');
    const target = document.getElementById('radar-time');
    return target.contains(host);
  })).toBe(false);

  // And it holds no controls of its own, which is the rule the criterion sets.
  expect(await page.evaluate(
    () => document.getElementById('radar-time').querySelectorAll('button, a, input, select').length,
  )).toBe(0);

  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    feeds.beginOptionalFeed('radar');
  });
  await expect(page.locator('#radar-time')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#radar-controls')).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    feeds.completeOptionalFeed('radar', { itemCount: 1 });
    window.__hmRadarTarget?.close();
  });
});
