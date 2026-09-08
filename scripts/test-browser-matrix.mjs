import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);
const engines = [
  { name: 'Chromium', launcher: chromium, required: true },
  { name: 'Firefox', launcher: firefox, required: false },
  { name: 'WebKit', launcher: webkit, required: false },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  return String(error?.message || error)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function waitForAppReady(page, label) {
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const visible = document.querySelector('#visible-count')?.textContent || '';
    return loading?.style.display === 'none' && /\d/.test(visible);
  }, { timeout: 30_000 });
  const visible = await page.textContent('#visible-count');
  assert(/landfalls/.test(visible || ''), `${label}: visible-count did not render landfalls`);
}

async function seedSettings(context) {
  await context.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem('hm-settings-v1', JSON.stringify({
      onboarded: true,
      theme: 'dark',
      palette: 'default',
      highContrast: false,
      reducedMotion: true,
      locale: 'en',
    }));
  });
}

async function createStaticServer() {
  let offline = false;
  const server = createServer(async (request, response) => {
    if (offline) {
      request.destroy();
      return;
    }
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
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    setOffline(value) {
      offline = Boolean(value);
    },
  };
}

async function preparePage(context, baseUrl) {
  await seedSettings(context);
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  return page;
}

async function runShellContract(browser, baseUrl, label) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    serviceWorkers: 'block',
  });
  try {
    const page = await preparePage(context, baseUrl);
    await waitForAppReady(page, label);

    const manifestChecks = await page.evaluate(async () => {
      const manifests = [
        ['manifest.webmanifest', 'en-US', 'Statistics'],
        ['manifest.es.webmanifest', 'es', 'Estadísticas'],
        ['manifest.ht.webmanifest', 'ht', 'Estatistik'],
      ];
      return Promise.all(manifests.map(async ([name, locale, shortcutName]) => {
        const manifestUrl = new URL(`./${name}`, location.href);
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        const manifest = response.ok ? await response.json() : null;
        const references = manifest
          ? [...(manifest.icons || []).map(icon => icon.src), ...(manifest.screenshots || []).map(image => image.src), ...(manifest.shortcuts || []).map(shortcut => shortcut.url)]
          : [];
        const assets = await Promise.all(references.map(async reference => {
          const assetResponse = await fetch(new URL(reference, manifestUrl), { cache: 'no-store' });
          return assetResponse.ok;
        }));
        return {
          name,
          locale,
          shortcutName,
          ok: response.ok,
          status: response.status,
          manifest,
          assets,
        };
      }));
    });
    for (const manifestCheck of manifestChecks) {
      assert(manifestCheck.ok, `${label}: ${manifestCheck.name} did not load (${manifestCheck.status})`);
      const manifest = manifestCheck.manifest;
      assert(manifest.id === './' && manifest.scope === './' && manifest.start_url === './', `${label}: ${manifestCheck.name} has unstable identity/scope`);
      assert(manifest.lang === manifestCheck.locale, `${label}: ${manifestCheck.name} locale is incorrect`);
      assert(manifest.shortcuts?.[0]?.name === manifestCheck.shortcutName, `${label}: ${manifestCheck.name} shortcut label is not localized`);
      assert(manifestCheck.assets.length > 0 && manifestCheck.assets.every(Boolean), `${label}: ${manifestCheck.name} has an unresolved icon/screenshot/shortcut URL`);
    }
    const manifest = manifestChecks[0].manifest;
    assert(manifest.short_name === 'HurricaneMap', `${label}: web app manifest short name is incorrect`);
    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, `${label}: manifest icons are incomplete`);

    if (!(await page.locator('#search-input').isVisible())) {
      await page.click('#toggle-filters');
      await page.waitForFunction(() => document.querySelector('#search-input')?.offsetParent !== null, { timeout: 5_000 });
    }
    await page.fill('#search-input', 'Katrina');
    await page.waitForFunction(() => document.querySelectorAll('#search-results [role="option"]').length > 0, { timeout: 10_000 });
    const searchText = await page.textContent('#search-results');
    assert(/Katrina/i.test(searchText || ''), `${label}: search results did not contain Katrina`);

    await page.evaluate(async () => {
      const data = await import('/src/data.js');
      const panel = await import('/src/panel.js');
      await data.ensureStormsLoaded();
      const landfall = data.getLandfalls().find(item => item.storm_id === 'AL122005');
      if (!landfall) throw new Error('Katrina landfall is missing');
      await panel.showStorm(landfall);
    });
    await page.waitForSelector('#storm-panel:not([hidden]) .storm-panel-layout', { timeout: 15_000 });
    const panelTitle = await page.textContent('#storm-panel-title');
    assert(/Katrina/i.test(panelTitle || ''), `${label}: storm panel did not open Katrina`);
  } finally {
    await context.close();
  }
}

// iOS 26 opens any Home Screen site as a web app whether or not anyone went
// through an install flow, so the standalone layout is now reached by people
// who never saw it offered, and there is no browser chrome to fall back on.
// Two things have to hold there. Nothing may depend on chrome the web app does
// not have, and the overlays have to inset themselves out of the status bar and
// the home indicator once viewport-fit=cover lets the insets be non-zero.
//
// Nothing can give env(safe-area-inset-*) a value from a test, which is why the
// stylesheets read them through --safe-* variables: setting those on the root
// is the same arithmetic a notched phone performs. The numbers below are an
// iPhone 15 Pro in portrait.
// Portrait puts the inset at the top and bottom; landscape moves it to the
// sides, which is a different set of rules and was where the header ran off
// the screen because its real width comes from a token the max-width rule
// could not reach.
const SAFE_AREA_CASES = [
  { orientation: 'portrait', viewport: { width: 393, height: 852 }, insets: { top: '59px', right: '0px', bottom: '34px', left: '0px' } },
  { orientation: 'landscape', viewport: { width: 852, height: 393 }, insets: { top: '0px', right: '59px', bottom: '21px', left: '59px' } },
];

async function runStandaloneContract(browser, baseUrl, label) {
  for (const testCase of SAFE_AREA_CASES) {
    await runStandaloneCase(browser, baseUrl, `${label} ${testCase.orientation}`, testCase);
  }
  return { state: 'passed' };
}

async function runStandaloneCase(browser, baseUrl, label, { viewport, insets }) {
  const SAFE_AREA = insets;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  try {
    await context.addInitScript(insets => {
      // A real installed web app reports standalone, which is what suppresses
      // the "add to Home Screen" coachmark. Patch the query rather than the
      // whole of matchMedia so every other media query still answers honestly.
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = query => (/display-mode:\s*(standalone|fullscreen)/.test(query)
        ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
        : nativeMatchMedia(query));
      document.addEventListener('DOMContentLoaded', () => {
        for (const [side, value] of Object.entries(insets)) {
          document.documentElement.style.setProperty(`--safe-${side}`, value);
        }
      });
    }, SAFE_AREA);
    const page = await preparePage(context, baseUrl);
    await waitForAppReady(page, label);

    const standalone = await page.evaluate(() => window.matchMedia('(display-mode: standalone)').matches);
    assert(standalone, `${label}: standalone display mode was not emulated`);

    const safeTop = Number.parseFloat(SAFE_AREA.top);
    const safeBottom = Number.parseFloat(SAFE_AREA.bottom);
    const layout = await page.evaluate(() => {
      const box = selector => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      return {
        header: box('.app-header'),
        moreActions: box('#toggle-mobile-actions'),
        // The ribbon itself is meant to run to the bottom edge; what must clear
        // the home indicator is the part carrying the axis and the legend.
        timelineSurface: box('.timeline-ribbon'),
        timeline: box('.timeline-ribbon .timeline-inner'),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });

    assert(layout.header, `${label}: header did not render in standalone`);
    // The status bar sits over the top inset, so a header that starts above it
    // is a header partly under the clock on a real device.
    assert(
      layout.header.top >= safeTop,
      `${label}: header starts at ${Math.round(layout.header.top)}px, inside the ${safeTop}px status-bar inset`,
    );
    assert(
      layout.header.right <= layout.viewport.width + 0.5 && layout.header.left >= 0,
      `${label}: header escapes the viewport in standalone`,
    );
    assert(layout.moreActions, `${label}: the action rail's overflow control did not render`);
    assert(
      layout.moreActions.bottom <= layout.viewport.height && layout.moreActions.top >= 0,
      `${label}: the action rail is not reachable in standalone`,
    );
    assert(layout.timelineSurface, `${label}: the timeline did not render in standalone`);
    assert(layout.timeline, `${label}: the timeline rendered without its content`);
    assert(
      layout.timeline.bottom <= layout.viewport.height - safeBottom + 0.5,
      `${label}: the timeline's content ends at ${Math.round(layout.timeline.bottom)}px, inside the ${safeBottom}px home-indicator inset`,
    );

    // No browser chrome means the app's own dismissal is the only way back.
    await page.evaluate(async () => {
      const data = await import('/src/data.js');
      const panel = await import('/src/panel.js');
      await data.ensureStormsLoaded();
      const landfall = data.getLandfalls().find(item => item.storm_id === 'AL122005');
      await panel.showStorm(landfall);
    });
    await page.waitForSelector('#storm-panel:not([hidden])', { timeout: 15_000 });

    // The ribbon grows upward by the bottom inset, so the panel lane above it
    // has to reserve the same amount. When it did not, the panel painted over
    // the timeline: it covered the toggle chip and cut the tops off the bars.
    const overlap = await page.evaluate(() => {
      const panel = document.querySelector('#storm-panel:not([hidden])');
      const ribbon = document.querySelector('.timeline-ribbon');
      if (!panel || !ribbon) return null;
      const panelBox = panel.getBoundingClientRect();
      const ribbonBox = ribbon.getBoundingClientRect();
      return { panelBottom: panelBox.bottom, ribbonTop: ribbonBox.top, panelTop: panelBox.top };
    });
    if (overlap && overlap.panelBottom > overlap.panelTop) {
      assert(
        overlap.panelBottom <= overlap.ribbonTop + 0.5,
        `${label}: the storm panel overlaps the timeline by ${Math.round(overlap.panelBottom - overlap.ribbonTop)}px`,
      );
    }
    await page.click('#storm-panel .close-btn');
    await page.waitForFunction(() => document.querySelector('#storm-panel')?.hidden === true, { timeout: 10_000 });

    // The install coachmark advertises a Home Screen install to someone who is
    // already running from the Home Screen.
    const offersInstall = await page.evaluate(async () => (await import('/src/onboarding.js')).isIosSafari());
    assert(!offersInstall, `${label}: the app still offers a Home Screen install while running standalone`);
    return { state: 'passed' };
  } finally {
    await context.close();
  }
}

async function runOfflineContract(browser, baseUrl, label, setOffline) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    serviceWorkers: 'allow',
  });
  try {
    const page = await preparePage(context, baseUrl);
    const hasServiceWorkers = await page.evaluate(() => 'serviceWorker' in navigator);
    if (!hasServiceWorkers) {
      return { state: 'unsupported', reason: 'service workers unavailable' };
    }
    await waitForAppReady(page, label);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 30_000 });

    const tuple = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const dataCache = cacheNames.find(name => name.startsWith('hm-data-hm-'));
      if (!dataCache) return null;
      const markerResponse = await (await caches.open(dataCache)).match('./__hurricanemap-release.json');
      return markerResponse ? { dataCache, marker: await markerResponse.json() } : null;
    });
    assert(tuple?.marker?.data_cache === tuple.dataCache, `${label}: offline data cache marker is incoherent`);
    assert(tuple.marker.shell_cache?.startsWith('hm-shell-hm-'), `${label}: offline shell tuple is missing`);

    setOffline(true);
    const offlineState = await page.evaluate(async () => {
      const metadataResponse = await fetch('/data/metadata.json', { cache: 'no-store' });
      if (!metadataResponse.ok) throw new Error(`offline metadata returned ${metadataResponse.status}`);
      const data = await import('/src/data.js');
      await data.ensureStormsLoaded();
      const storms = data.getAllStorms();
      return {
        storms: storms.length,
        katrina: Boolean(storms.find(storm => storm.id === 'AL122005')),
      };
    });
    assert(offlineState.storms >= 500 && offlineState.katrina, `${label}: offline historical data contract failed`);
    return { state: 'passed', storms: offlineState.storms };
  } finally {
    setOffline(false);
    await context.close();
  }
}

const { server, baseUrl, setOffline } = await createStaticServer();
const results = [];
try {
  for (const engine of engines) {
    let browser;
    try {
      browser = await engine.launcher.launch({ headless: true });
    } catch (error) {
      const reason = `launch unavailable: ${errorText(error)}`;
      if (engine.required) throw new Error(`${engine.name}: ${reason}`);
      console.log(`${engine.name}: unsupported (${reason})`);
      results.push({ name: engine.name, state: 'unsupported', reason });
      continue;
    }
    try {
      await runShellContract(browser, baseUrl, engine.name);
      await runStandaloneContract(browser, baseUrl, engine.name);
      const offline = await runOfflineContract(browser, baseUrl, engine.name, setOffline);
      if (offline.state === 'unsupported') {
        console.log(`${engine.name}: shell/manifest/search/panel/standalone passed; offline cache unsupported (${offline.reason})`);
      } else {
        console.log(`${engine.name}: shell/manifest/search/panel/standalone/offline passed (${offline.storms} storms)`);
      }
      results.push({ name: engine.name, state: 'passed', offline: offline.state });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}

assert(results.some(result => result.name === 'Chromium' && result.state === 'passed'), 'Chromium contract did not run');
const unsupported = results.filter(result => result.state === 'unsupported').map(result => result.name);
console.log(`browser matrix ok (${results.length} engines; unsupported: ${unsupported.length ? unsupported.join(', ') : 'none'})`);
