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
const SW_TILE_URL = 'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::500::0.0/0/0/0.png';
const SW_TILE_RESPONSE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

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
  const routedServiceWorkerRequests = [];
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.serviceWorker()) {
      routedServiceWorkerRequests.push(request.url());
      if (request.url() === SW_TILE_URL) {
        await route.fulfill({
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'Content-Type': 'image/png',
          },
          body: SW_TILE_RESPONSE,
        });
        return;
      }
    }
    await route.continue();
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
    await createDb('hm-offline-data-hm-v1.9.3', { key: 'data/obsolete.json' });
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

  const routedTile = await page.evaluate(async url => {
    const response = await fetch(url, { cache: 'no-store' });
    return { ok: response.ok, status: response.status, contentType: response.headers.get('content-type') };
  }, SW_TILE_URL);
  assert(routedTile.ok && routedTile.status === 200 && routedTile.contentType === 'image/png', `service-worker route probe failed: ${JSON.stringify(routedTile)}`);
  assert(routedServiceWorkerRequests.includes(SW_TILE_URL), 'service-worker-owned tile request was not observed by browserContext.route');

  const releaseTuple = await page.evaluate(async () => {
    const dataCacheName = (await caches.keys()).find(name => name.startsWith('hm-data-hm-'));
    if (!dataCacheName) throw new Error('versioned data cache was not installed');
    const marker = await (await caches.open(dataCacheName)).match('./__hurricanemap-release.json');
    if (!marker) throw new Error('offline release marker was not installed');
    const tuple = await marker.json();
    if (tuple.data_cache !== dataCacheName || tuple.shell_cache !== 'hm-shell-hm-v1.9.3') {
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
  assert(!migrationState.cacheKeys.includes('hm-source-bundle-v1'), 'source bundle was installed without a user action');
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
    'data/stac/catalog.json',
  ]) {
    assert(offlineKeys.includes(required), `offline IndexedDB store missing ${required}`);
  }
  for (const omitted of ['data/hurdat2-atlantic.txt', 'data/hurdat2-nepac.txt', 'data/release-manifest.json']) {
    assert(!offlineKeys.includes(omitted), `optional source asset was installed as mandatory data: ${omitted}`);
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
  const integrityBeforeEviction = await page.evaluate(async () => {
    const updates = await import('/src/sw-updates.js');
    return updates.requestOfflineIntegrityCheck({ timeoutMs: 30000 });
  });
  assert(integrityBeforeEviction?.state === 'intact', `launch integrity check did not report intact: ${JSON.stringify(integrityBeforeEviction)}`);
  const evicted = await page.evaluate(async cacheName => caches.delete(cacheName), releaseTuple.data_cache);
  assert(evicted, `offline data cache could not be evicted for repair smoke: ${releaseTuple.data_cache}`);
  const integrityAfterEviction = await page.evaluate(async () => {
    const updates = await import('/src/sw-updates.js');
    return updates.requestOfflineIntegrityCheck({ timeoutMs: 30000 });
  });
  assert(integrityAfterEviction?.state === 'evicted', `integrity check did not classify an evicted cache: ${JSON.stringify(integrityAfterEviction)}`);
  const repairResult = await page.evaluate(async () => {
    const updates = await import('/src/sw-updates.js');
    return updates.requestOfflineDataRepair({ timeoutMs: 30000 });
  });
  assert(repairResult?.ok === true, `offline data repair failed: ${repairResult?.error || 'unknown error'}`);
  const integrityAfterRepair = await page.evaluate(async () => {
    const updates = await import('/src/sw-updates.js');
    return updates.requestOfflineIntegrityCheck({ timeoutMs: 30000 });
  });
  assert(integrityAfterRepair?.state === 'intact', `integrity repair did not restore an intact bundle: ${JSON.stringify(integrityAfterRepair)}`);

  const sourcePack = await page.evaluate(async () => {
    const storage = await import('/src/storage-manager.js');
    return storage.cacheSourceBundle();
  });
  assert(sourcePack?.saved === 3 && sourcePack.bytes > 11 * 1024 * 1024, 'source bundle did not save the bounded optional payload');
  const sourceState = await page.evaluate(async () => {
    const cache = await caches.open('hm-source-bundle-v1');
    const keys = (await cache.keys()).map(request => new URL(request.url).pathname);
    const dataRequests = await (await caches.open('hm-data-hm-v1.9.3')).keys();
    return {
      keys,
      dataKeys: dataRequests.map(request => new URL(request.url).pathname),
    };
  });
  assert(sourceState.keys.length === 4 && sourceState.keys.some(key => key.endsWith('__hurricanemap-source-bundle.json')), 'source bundle cache is missing its marker or assets');
  assert(!sourceState.dataKeys.some(key => ['/data/hurdat2-atlantic.txt', '/data/hurdat2-nepac.txt', '/data/release-manifest.json'].includes(key)), `source bundle leaked into mandatory data cache: ${JSON.stringify(sourceState.dataKeys)}`);

  // Optional cache pressure/clears must never remove the required historical
  // data store used by the offline app shell.
  await page.evaluate(async () => {
    await caches.delete('hm-radar-v1');
    await caches.delete('hm-tiles-v1');
    await caches.delete('hm-source-bundle-v1');
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
    const coverage = await (await fetch('/data/coverage.json')).json();
    const katrina = storms.find(storm => storm.id === 'AL122005');
    const landfall = data.getLandfalls().find(item => item.storm_id === 'AL122005');
    if (!katrina || !landfall) throw new Error('Katrina offline data unavailable');
    await panel.showStorm(landfall);
    return {
      storms: storms.length,
      radarFrames: coverage.datasets.find(dataset => dataset.id === 'radar-archive')?.availability?.frames,
      catalogStorms: coverage.catalog?.storm_count,
      panelText: document.querySelector('#storm-panel')?.textContent || '',
    };
  });

  assert(offlineResult.storms >= 500, `offline storms count too low: ${offlineResult.storms}`);
  assert(offlineResult.catalogStorms === 595 && offlineResult.radarFrames === 1703, 'offline archive coverage facts are unavailable');
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
  console.log(`offline service worker ok (${distribution.profile} profile, ${offlineKeys.length} data records, ${offlineResult.storms} storms, direct SW route probe passed, legacy storage removed, optional caches absent)`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
