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
  // 'missing' is the mode a plain run uses, so an absent baseline is written
  // once and an existing one is still compared. 'all' and 'changed' rewrite.
  const mode = test.info().config.updateSnapshots;
  if (mode === 'all' || mode === 'changed' || (baseline === null && mode === 'missing')) {
    await mkdir(ariaJsonDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(tree, null, 2)}\n`);
    return;
  }
  expect(baseline, `${name}.aria.json is missing; rerun with --update-snapshots`).not.toBeNull();
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
