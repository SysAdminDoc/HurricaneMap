import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('Playwright is required for offline service-worker smoke testing.');
  console.error(error.message || error);
  process.exit(1);
}

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/') pathname = '/index.html';
    const resolved = path.resolve(root, `.${pathname}`);
    if (!resolved.startsWith(root)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    const info = await stat(resolved);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
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
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    serviceWorkers: 'allow',
  });
  await context.addInitScript(() => {
    localStorage.setItem('hm-settings-v1', JSON.stringify({ onboarded: true }));
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const visible = document.querySelector('#visible-count')?.textContent || '';
    return loading && loading.style.display === 'none' && /landfalls/.test(visible);
  }, { timeout: 20000 });

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller && registration.active) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: 'load' });
  }

  const offlineKeys = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('hm-offline-data-v2');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('responses', 'readonly');
        const request = tx.objectStore('responses').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
  for (const required of [
    'data/landfalls.json',
    'data/stats.json',
    'data/us-states.geojson',
    'data/hurdat2-atlantic.txt',
  ]) {
    assert(offlineKeys.includes(required), `offline IndexedDB store missing ${required}`);
  }
  assert(
    offlineKeys.includes('data/storms.json.gz') || offlineKeys.includes('data/storms.json'),
    'offline IndexedDB store missing storms bundle',
  );

  // Optional cache pressure/clears must never remove the required historical
  // data store used by the offline app shell.
  await page.evaluate(async () => {
    await caches.delete('hm-radar-v1');
    await caches.delete('hm-tiles-v1');
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const visible = document.querySelector('#visible-count')?.textContent || '';
    return loading && loading.style.display === 'none' && /landfalls/.test(visible);
  }, { timeout: 20000 });

  const offlineResult = await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const storms = data.getAllStorms();
    const katrina = storms.find(storm => storm.id === 'AL122005');
    const landfall = data.getLandfalls().find(item => item.storm_id === 'AL122005');
    if (!katrina || !landfall) throw new Error('Katrina offline data unavailable');
    await panel.showStorm(landfall);
    return {
      storms: storms.length,
      panelText: document.querySelector('#storm-panel')?.textContent || '',
    };
  });

  assert(offlineResult.storms >= 500, `offline storms count too low: ${offlineResult.storms}`);
  assert(/Katrina/i.test(offlineResult.panelText), 'offline storm panel did not render Katrina');
  assert(/Est\. exposure/.test(offlineResult.panelText), 'offline exposure metric did not render from cached state density data');

  const offlinePrep = await page.evaluate(async () => {
    const prep = await import('/src/prep.js');
    prep.openPrepPanel();
    document.querySelector('#prep-household').value = '5';
    document.querySelector('#prep-household').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#prep-mode').value = 'home';
    document.querySelector('#prep-mode').dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('#prep-body')?.textContent || '';
  });
  assert(/70\s*gallons of water/.test(offlinePrep), `offline preparedness calculator did not render: ${offlinePrep}`);

  await context.close();
  await browser.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log(`offline service worker ok (${offlineKeys.length} data records, ${offlineResult.storms} storms, optional caches absent)`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
