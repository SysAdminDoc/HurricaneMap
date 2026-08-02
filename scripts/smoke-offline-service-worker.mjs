import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.HURRICANEMAP_ROOT
  ? path.resolve(process.env.HURRICANEMAP_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    // Runs in EVERY frame, including the opaque-origin 3D-globe iframe
    // (sandbox="allow-scripts") where storage access throws. Seed the real
    // document only.
    if (window.top !== window) return;
    localStorage.setItem('hm-settings-v1', JSON.stringify({ onboarded: true }));
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  // Seed the previous cache/database generation before the service worker is
  // installed. Activation must remove it without disturbing the current store.
  await page.goto(`${baseUrl}/data/metadata.json`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    for (const cacheName of [
      'hm-shell-hm-v0.9.0',
      'hm-data-v1',
      'hm-data-v2',
      'hm-tiles-v0',
      'hm-radar-v0',
    ]) {
      const cache = await caches.open(cacheName);
      await cache.put('/legacy', new Response('legacy'));
    }

    const createDb = (name, seed) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('responses', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('responses', 'readwrite');
        tx.objectStore('responses').put(seed);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });

    await createDb('hm-offline-data-v1', { key: 'legacy/data.json' });
    await createDb('hm-offline-data-v2', { key: 'legacy-v2/data.json' });
    await createDb('hm-offline-data-hm-v1.9.1', { key: 'data/obsolete.json' });
  });

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

  const releaseTuple = await page.evaluate(async () => {
    const dataCacheName = (await caches.keys()).find(name => name.startsWith('hm-data-hm-'));
    if (!dataCacheName) throw new Error('versioned data cache was not installed');
    const marker = await (await caches.open(dataCacheName)).match('./__hurricanemap-release.json');
    if (!marker) throw new Error('offline release marker was not installed');
    const tuple = await marker.json();
    if (tuple.data_cache !== dataCacheName || tuple.shell_cache !== 'hm-shell-hm-v1.9.1') {
      throw new Error(`offline release tuple is incoherent: ${JSON.stringify(tuple)}`);
    }
    return tuple;
  });
  const migrationState = await page.evaluate(async (dbName) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const offlineKeys = await new Promise((resolve, reject) => {
        const tx = db.transaction('responses', 'readonly');
        const request = tx.objectStore('responses').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return {
        offlineKeys,
        cacheKeys: await caches.keys(),
        databaseNames: typeof indexedDB.databases === 'function'
          ? (await indexedDB.databases()).map(database => database.name)
          : [],
      };
    } finally {
      db.close();
    }
  }, releaseTuple.data_db);
  const offlineKeys = migrationState.offlineKeys;
  for (const legacyCache of ['hm-shell-hm-v0.9.0', 'hm-data-v1', 'hm-data-v2', 'hm-tiles-v0', 'hm-radar-v0']) {
    assert(!migrationState.cacheKeys.includes(legacyCache), `legacy cache survived activation: ${legacyCache}`);
  }
  assert(!offlineKeys.includes('data/obsolete.json'), 'obsolete current-database record survived activation pruning');
  if (migrationState.databaseNames.length) {
    assert(
      !migrationState.databaseNames.includes('hm-offline-data-v1'),
      'legacy IndexedDB survived activation',
    );
    assert(
      !migrationState.databaseNames.includes('hm-offline-data-v2'),
      'v2 fixed IndexedDB survived activation',
    );
  }
  for (const required of [
    'data/landfalls.json',
    'data/stats.json',
    'data/us-states.geojson',
    'data/hurdat2-sources.json',
    'data/hurdat2-atlantic.txt',
  ]) {
    assert(offlineKeys.includes(required), `offline IndexedDB store missing ${required}`);
  }
  assert(
    offlineKeys.includes('data/storms.json.gz') || offlineKeys.includes('data/storms.json'),
    'offline IndexedDB store missing storms bundle',
  );
  const diagnostics = await page.evaluate(async () => {
    const module = await import('/src/diagnostics.js');
    return module.collectOfflineDiagnostics();
  });
  assert(diagnostics.release?.state === 'coherent', `offline diagnostics did not report a coherent release: ${diagnostics.release?.state}`);
  const repairResult = await page.evaluate(async () => {
    const updates = await import('/src/sw-updates.js');
    return updates.requestOfflineDataRepair({ timeoutMs: 30000 });
  });
  assert(repairResult?.ok === true, `offline data repair failed: ${repairResult?.error || 'unknown error'}`);

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

  const distribution = await page.evaluate(async () => {
    const response = await fetch('/data/distribution.json');
    return response.json();
  });
  if (process.env.HURRICANEMAP_EXPECT_PROFILE) {
    assert(
      distribution.profile === process.env.HURRICANEMAP_EXPECT_PROFILE,
      `expected ${process.env.HURRICANEMAP_EXPECT_PROFILE} profile, got ${distribution.profile}`,
    );
  }
  if (distribution.profile === 'core') {
    assert(distribution.capabilities?.bundled_radar === false, 'core profile claims bundled radar');
  }

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
  console.log(`offline service worker ok (${distribution.profile} profile, ${offlineKeys.length} data records, ${offlineResult.storms} storms, legacy storage removed, optional caches absent)`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
