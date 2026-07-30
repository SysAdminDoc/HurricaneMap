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
