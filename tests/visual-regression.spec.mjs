import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

let server;
let baseUrl;

test.use({
  viewport: { width: 1440, height: 960 },
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
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

async function openDeterministicApp(page) {
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
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    return loading?.style.display === 'none' && /\d/.test(document.querySelector('#visible-count')?.textContent || '');
  }, { timeout: 20_000 });
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      caret-color: transparent !important;
      transition: none !important;
    }
    #map {
      background: #071426 !important;
    }
    #map > *,
    #active-storms-pill,
    #active-storm-badge,
    .hm-toast,
    .header-tooltip {
      visibility: hidden !important;
    }
  ` });
  await page.evaluate(() => document.fonts.ready);
}

function deterministicMasks(page) {
  return [
    page.locator('#active-storms-pill'),
    page.locator('#active-storm-badge'),
    page.locator('.hm-toast'),
    page.locator('.header-tooltip'),
  ];
}

async function expectMatrixScreenshot(page, name) {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    mask: deterministicMasks(page),
    maskColor: '#071426',
    maxDiffPixelRatio: 0.001,
  });
}

async function setVisualTheme(page, theme, highContrast = false) {
  await page.evaluate(async ({ nextTheme, nextHighContrast }) => {
    const settings = await import('/src/settings.js');
    settings.setSetting('theme', nextTheme);
    settings.setSetting('highContrast', nextHighContrast);
  }, { nextTheme: theme, nextHighContrast: highContrast });
  await page.waitForFunction(({ nextTheme, nextHighContrast }) => (
    document.documentElement.dataset.theme === nextTheme &&
    document.documentElement.classList.contains('high-contrast') === nextHighContrast
  ), { nextTheme: theme, nextHighContrast: highContrast });
}

async function closeVisualPanels(page) {
  await page.evaluate(async () => {
    const panels = await import('/src/panels.js');
    panels.closeAllPanels();
    document.querySelector('#settings-menu')?.hidePopover();
  });
  await page.waitForFunction(() => (
    document.querySelector('#storm-panel')?.hidden !== false &&
    document.querySelector('#stats-panel')?.hidden !== false &&
    document.querySelector('#compare-panel')?.hidden !== false &&
    !document.querySelector('#settings-menu')?.matches(':popover-open')
  ));
}

async function openVisualStorm(page, stormId = 'AL122005') {
  await closeVisualPanels(page);
  await page.evaluate(async id => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const landfall = data.getLandfalls().find(item => item.storm_id === id);
    if (!landfall) throw new Error(`Visual storm ${id} not found`);
    await panel.showStorm(landfall);
  }, stormId);
  await page.waitForSelector('#storm-panel:not([hidden]) .storm-panel-layout', { timeout: 15_000 });
  await page.evaluate(() => {
    const panel = document.querySelector('#storm-panel');
    if (panel) panel.scrollTop = 0;
  });
}

async function openVisualStats(page) {
  await closeVisualPanels(page);
  await page.evaluate(async () => (await import('/src/stats.js')).toggleStats());
  await page.waitForSelector('#stats-panel:not([hidden]) .sob-current', { timeout: 15_000 });
}

async function openVisualCompare(page) {
  await closeVisualPanels(page);
  await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const compare = await import('/src/compare.js');
    await data.ensureStormsLoaded();
    for (const id of ['AL122005', 'AL041992']) {
      const storm = data.getAllStorms().find(item => item.id === id);
      if (!storm) throw new Error(`Visual comparison storm ${id} not found`);
      if (!compare.isPinned(id)) await compare.togglePin(storm);
    }
    compare.openComparePanel();
  });
  await page.waitForSelector('#compare-panel:not([hidden]) .cp-card', { timeout: 15_000 });
}

async function openVisualSettings(page) {
  await closeVisualPanels(page);
  await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
  await page.waitForSelector('#settings-menu:popover-open', { timeout: 5_000 });
}

async function openVisualReplay(page) {
  await openVisualStorm(page, 'AL142024');
  await page.check('#advisory-replay-enabled');
  await page.waitForSelector('#advisory-replay-meta', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), { timeout: 15_000 });
  await page.evaluate(() => {
    const panel = document.querySelector('#storm-panel');
    const header = document.querySelector('#panel-sticky-header');
    const target = document.querySelector('.advisory-replay-control');
    if (!panel || !header || !target) return;
    const targetTop = header.getBoundingClientRect().bottom + 8;
    panel.scrollTop += target.getBoundingClientRect().top - targetTop;
  });
}

async function openVisualPlayback(page) {
  await openVisualStorm(page);
  await page.click('#play-anim-btn');
  await page.waitForFunction(() => (
    document.body.classList.contains('track-playback-active') &&
    document.querySelector('.anim-controls:not([hidden])')
  ), { timeout: 10_000 });
  await page.locator('.anim-controls [data-act="toggle"]').click();
  await page.locator('.anim-controls .anim-scrubber').fill('420');
}

test('stable atlas shell and statistics panel match approved baselines', async ({ page }) => {
  await openDeterministicApp(page);
  await expect(page).toHaveScreenshot('desktop-shell.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });

  await page.evaluate(async () => {
    const stats = await import('/src/stats.js');
    stats.toggleStats();
  });
  await page.waitForSelector('#stats-panel:not([hidden]) .sob-current', { timeout: 10_000 });
  await page.addStyleTag({ content: `
    #stats-panel {
      background: #08172a !important;
      backdrop-filter: none !important;
    }
  ` });
  await expect(page).toHaveScreenshot('desktop-statistics.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.001,
  });
});

test('critical desktop workflows remain pixel-stable across theme and panel states', async ({ page }) => {
  await openDeterministicApp(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-shell-dark.png');

  await openVisualStorm(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-storm.png');

  await openVisualStats(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-statistics.png');

  await openVisualCompare(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-compare.png');

  await openVisualSettings(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-settings.png');

  await openVisualReplay(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-advisory-replay.png');

  await openVisualPlayback(page);
  await expectMatrixScreenshot(page, 'matrix-desktop-track-playback.png');

  await closeVisualPanels(page);
  await setVisualTheme(page, 'light');
  await expectMatrixScreenshot(page, 'matrix-desktop-shell-light.png');

  await setVisualTheme(page, 'dark', true);
  await expectMatrixScreenshot(page, 'matrix-desktop-shell-high-contrast.png');
});

test.describe('critical mobile workflows', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('remain pixel-stable in the compact shell', async ({ page }) => {
    await openDeterministicApp(page);
    await expectMatrixScreenshot(page, 'matrix-mobile-shell-dark.png');

    await openVisualStorm(page);
    await expectMatrixScreenshot(page, 'matrix-mobile-storm.png');

    await openVisualStats(page);
    await expectMatrixScreenshot(page, 'matrix-mobile-statistics.png');

    await openVisualSettings(page);
    await expectMatrixScreenshot(page, 'matrix-mobile-settings.png');
  });
});
