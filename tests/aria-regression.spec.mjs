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
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
]);
const locales = ['en', 'es', 'ht'];
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

for (const locale of locales) {
  test(`ARIA snapshots remain localized for ${locale}`, async ({ page }) => {
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(value => {
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
        locale: value,
      }));
    }, locale);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const loading = document.querySelector('#loading');
      return loading?.style.display === 'none' && /\d/.test(document.querySelector('#visible-count')?.textContent || '');
    }, { timeout: 20_000 });
    await page.waitForFunction(expected => document.documentElement.lang === expected, locale);

    await openStorm(page, 'AL122005');
    await expect(page.locator('#storm-panel')).toMatchAriaSnapshot({ name: `${locale}-storm-panel.aria.yml` });

    await closePanels(page);
    await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
    await page.waitForSelector('#settings-menu:popover-open', { timeout: 5_000 });
    await expect(page.locator('#settings-menu')).toMatchAriaSnapshot({ name: `${locale}-settings.aria.yml` });

    await closePanels(page);
    await openStorm(page, 'AL142024');
    await page.check('#advisory-replay-enabled');
    await page.waitForFunction(() => document.querySelector('#advisory-replay-meta')?.textContent);
    await expect(page.locator('#storm-panel .advisory-replay-control')).toMatchAriaSnapshot({
      name: `${locale}-advisory-replay.aria.yml`,
    });
  });
}

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
