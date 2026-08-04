import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'data/metadata.json'), 'utf8'));
const expectedGeneratorVersion = metadata.generator?.app_version || '';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('Playwright is required for npm run test:smoke. Run npm install first.');
  console.error(error.message || error);
  process.exit(1);
}

let AxeBuilder;
try {
  ({ AxeBuilder } = await import('@axe-core/playwright'));
} catch (error) {
  console.error('@axe-core/playwright is required for npm run test:smoke. Run npm install first.');
  console.error(error.message || error);
  process.exit(1);
}

// Init scripts run in EVERY frame, including the opaque-origin 3D-globe iframe
// (sandbox="allow-scripts") where storage access throws SecurityError. Seed the
// real document only.
async function seedSettings(context, settings) {
  await context.addInitScript(value => {
    if (window.top !== window) return;
    localStorage.setItem('hm-settings-v1', JSON.stringify(value));
  }, settings);
}

// Playwright's own serviceWorkers:'block' shim is injected into that sandboxed
// frame too and throws there. Product code inside the globe frame touches
// neither storage nor service workers, so these are harness noise.
const SANDBOX_HARNESS_ERROR = /lacks the 'allow-same-origin' flag/;

function collectPageErrors(target, sink) {
  target.on('pageerror', error => {
    if (SANDBOX_HARNESS_ERROR.test(error.message)) return;
    sink.push(error.message);
  });
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];
// Known-accepted axe rule ids (e.g. unavoidable map-canvas noise). Currently
// empty — new violations should be fixed, not allowlisted, unless they come
// from Leaflet internals we cannot control.
const AXE_ALLOWLIST = new Set([]);

async function assertNoAxeViolations(page, label, include = null) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const violations = results.violations.filter(violation => !AXE_ALLOWLIST.has(violation.id));
  assert(!violations.length, `${label}: axe violations: ${violations.map(v => `${v.id} (${v.impact}, ${v.nodes.length} nodes, first: ${v.nodes[0]?.target?.[0]})`).join(' | ')}`);
}

async function assertThemeContrastMatrix(page, { checkMapOverlays = false } = {}) {
  const combinations = [];
  for (const theme of ['dark', 'light']) {
    for (const palette of ['default', 'colorblind']) {
      for (const highContrast of [false, true]) combinations.push({ theme, palette, highContrast });
    }
  }

  for (const combination of combinations) {
    await page.evaluate(async ({ theme, palette, highContrast }) => {
      const settings = await import('/src/settings.js');
      settings.setSetting('theme', theme);
      settings.setSetting('palette', palette);
      settings.setSetting('highContrast', highContrast);
    }, combination);
    await page.waitForFunction(
      ({ theme, palette, highContrast }) =>
        document.documentElement.dataset.theme === theme &&
        document.body.classList.contains('palette-colorblind') === (palette === 'colorblind') &&
        document.documentElement.classList.contains('high-contrast') === highContrast,
      combination,
    );
    await page.waitForTimeout(200);

    const audit = await page.evaluate(() => {
      const parseColor = value => {
        const hex = String(value).trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
        if (hex) {
          const expanded = hex[1].length === 3
            ? [...hex[1]].map(character => character.repeat(2)).join('')
            : hex[1];
          return [
            Number.parseInt(expanded.slice(0, 2), 16),
            Number.parseInt(expanded.slice(2, 4), 16),
            Number.parseInt(expanded.slice(4, 6), 16),
            1,
          ];
        }
        const srgb = String(value).match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/i);
        if (srgb) {
          return [
            Number(srgb[1]) * 255,
            Number(srgb[2]) * 255,
            Number(srgb[3]) * 255,
            srgb[4] === undefined ? 1 : Number(srgb[4]),
          ];
        }
        const match = String(value).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
        if (!match) throw new Error(`Unsupported computed color: ${value}`);
        return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
      };
      const composite = (foreground, background) => {
        const alpha = foreground[3] + background[3] * (1 - foreground[3]);
        return [
          ...[0, 1, 2].map(index =>
            (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha),
          alpha,
        ];
      };
      const channel = value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = color => 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
      const ratio = (foreground, background) => {
        const light = Math.max(luminance(foreground), luminance(background));
        const dark = Math.min(luminance(foreground), luminance(background));
        return (light + 0.05) / (dark + 0.05);
      };
      const rootStyle = getComputedStyle(document.documentElement);
      const base = parseColor(rootStyle.getPropertyValue('--base'));
      const header = document.querySelector('.app-header');
      const headerBackground = composite(parseColor(getComputedStyle(header).backgroundColor), base);
      const titleStart = parseColor(rootStyle.getPropertyValue('--brand-title-start'));
      const titleEnd = parseColor(rootStyle.getPropertyValue('--brand-title-end'));
      const controls = [...header.querySelectorAll('button')].filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }).map(element => ({
        id: element.id || element.className,
        color: getComputedStyle(element).color,
        ratio: ratio(composite(parseColor(getComputedStyle(element).color), headerBackground), headerBackground),
      }));
      return {
        title: [ratio(titleStart, headerBackground), ratio(titleEnd, headerBackground)],
        controls,
      };
    });
    const label = `${combination.theme}/${combination.palette}/${combination.highContrast ? 'high-contrast' : 'standard'}`;
    assert(Math.min(...audit.title) >= 4.5, `${label}: title contrast ${audit.title.map(value => value.toFixed(2)).join(', ')} is below 4.5:1`);
    const failedControls = audit.controls.filter(control => control.ratio < 4.5);
    assert(!failedControls.length, `${label}: header control contrast below 4.5:1: ${failedControls.map(control => `${control.id} ${control.ratio.toFixed(2)} (${control.color})`).join(', ')}`);
    if (checkMapOverlays) {
      if (!await page.locator('path.advisory-forecast-line').count()) {
        await openStormPanel(page, 'AL142024');
        await page.check('#advisory-replay-enabled');
        await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line') && document.querySelector('path.advisory-actual-line'), { timeout: 15000 });
      }
      const overlayColors = await page.evaluate(() => {
        const normalize = value => String(value || '').replace(/\s+/g, '').toLowerCase();
        const forecast = document.querySelector('path.advisory-forecast-line');
        const actual = document.querySelector('path.advisory-actual-line');
        const forecastSwatch = document.querySelector('.advisory-swatch--forecast');
        const actualSwatch = document.querySelector('.advisory-swatch--actual');
        return {
          forecastStroke: normalize(forecast && getComputedStyle(forecast).stroke),
          forecastSwatch: normalize(forecastSwatch && getComputedStyle(forecastSwatch).backgroundColor),
          actualStroke: normalize(actual && getComputedStyle(actual).stroke),
          actualSwatch: normalize(actualSwatch && getComputedStyle(actualSwatch).backgroundColor),
        };
      });
      assert(overlayColors.forecastStroke && overlayColors.forecastStroke === overlayColors.forecastSwatch,
        `${label}: forecast overlay and legend colors diverged: ${JSON.stringify(overlayColors)}`);
      assert(overlayColors.actualStroke && overlayColors.actualStroke === overlayColors.actualSwatch,
        `${label}: actual overlay and legend colors diverged: ${JSON.stringify(overlayColors)}`);
    }
  }

  await page.evaluate(async () => {
    const settings = await import('/src/settings.js');
    settings.setSetting('theme', 'dark');
    settings.setSetting('palette', 'default');
    settings.setSetting('highContrast', false);
  });
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
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
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
const visualSnapshotDir = path.join(root, 'test-results', 'visual');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function clickHeaderAction(page, selector) {
  const action = page.locator(selector);
  const direct = await action.isVisible();
  if (!direct) {
    const menu = page.locator('#mobile-actions-menu');
    if (await menu.getAttribute('data-open') !== 'true') {
      await page.locator('#toggle-mobile-actions').dispatchEvent('click');
    }
    await page.waitForFunction(() => document.querySelector('#mobile-actions-menu')?.dataset.open === 'true');
    // The panel manager deliberately restores focus to More when an action is
    // invoked from this menu; keep that invoker explicit even while the menu's
    // fixed geometry is settling.
    await page.locator('#toggle-mobile-actions').focus();
  } else {
    await action.focus();
  }
  // A managed panel can still be settling its header View Transition after the
  // menu is open. Dispatch on the resolved DOM control so this helper remains
  // independent of transient geometry and never needs pointer coordinates.
  await action.dispatchEvent('click');
}

async function waitForAppReady(page) {
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const visible = document.querySelector('#visible-count')?.textContent || '';
    return loading && loading.style.display === 'none' && /\d/.test(visible);
  }, { timeout: 20000 });
}

async function openKatrinaPanel(page) {
  await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const storm = data.getAllStorms().find(item => item.year === 2005 && String(item.name).toUpperCase() === 'KATRINA');
    if (!storm) throw new Error('Katrina 2005 not found');
    const landfall = data.getLandfalls().find(item => item.storm_id === storm.id);
    if (!landfall) throw new Error('Katrina 2005 landfall not found');
    await panel.showStorm(landfall);
  });
  await page.waitForFunction(() => !document.querySelector('#storm-panel')?.hidden, { timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector('#radar-cache-status');
    return status && ['complete', 'partial', 'empty', 'unavailable'].includes(status.dataset.state);
  }, { timeout: 10000 });
}

async function openStormPanel(page, stormId) {
  await page.evaluate(async id => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const landfall = data.getLandfalls().find(item => item.storm_id === id);
    if (!landfall) throw new Error(`${id} landfall not found`);
    await panel.showStorm(landfall);
  }, stormId);
  await page.waitForFunction(() => (
    document.querySelector('#storm-panel')?.hidden === false &&
    document.querySelector('#advisory-replay-enabled')
  ), { timeout: 15000 });
}

async function assertAdvisoryForecastInViewport(page, stormId) {
  await openStormPanel(page, stormId);
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), { timeout: 15000 });
  await page.waitForFunction(() => {
    const path = document.querySelector('path.advisory-forecast-line');
    const map = document.querySelector('#map');
    if (!path || !map) return false;
    const pathRect = path.getBoundingClientRect();
    const mapRect = map.getBoundingClientRect();
    return pathRect.width > 0 && pathRect.height > 0 &&
      pathRect.right > mapRect.left && pathRect.left < mapRect.right &&
      pathRect.bottom > mapRect.top && pathRect.top < mapRect.bottom;
  }, { timeout: 15000 });
  const geometry = await page.evaluate(() => {
    const path = document.querySelector('path.advisory-forecast-line');
    const map = document.querySelector('#map');
    const pathRect = path?.getBoundingClientRect();
    const mapRect = map?.getBoundingClientRect();
    return {
      path: pathRect ? { left: pathRect.left, right: pathRect.right, top: pathRect.top, bottom: pathRect.bottom } : null,
      map: mapRect ? { left: mapRect.left, right: mapRect.right, top: mapRect.top, bottom: mapRect.bottom } : null,
    };
  });
  assert(geometry.path && geometry.map, `${stormId}: advisory forecast viewport geometry is missing`);
}

async function captureVisualSnapshot(page, name) {
  await mkdir(visualSnapshotDir, { recursive: true });
  const buffer = await page.screenshot({
    path: path.join(visualSnapshotDir, `${name}.png`),
    animations: 'disabled',
  });
  assert(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${name}: visual snapshot is not a PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const viewport = page.viewportSize();
  assert(width === viewport.width && height === viewport.height, `${name}: snapshot dimensions ${width}x${height} do not match ${viewport.width}x${viewport.height}`);
  assert(buffer.length > 20_000, `${name}: snapshot is unexpectedly small (${buffer.length} bytes)`);
}

async function assertDialogAndKeyboardContracts(page) {
  await page.evaluate(async () => {
    document.querySelector('#toggle-info')?.focus();
    scrollTo(0, 0);
  });
  await page.keyboard.press('Shift+/');
  await page.waitForFunction(() => document.querySelector('#keyboard-palette')?.open, { timeout: 5000 });
  assert(await page.evaluate(() => document.activeElement?.classList.contains('palette-close')), 'shortcut dialog did not focus its close button');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.classList.contains('palette-close')), 'single-control shortcut dialog did not trap Tab');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => document.activeElement?.id === 'toggle-info'), 'shortcut dialog did not return focus to its opener');

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#info-modal')?.hidden, { timeout: 5000 });
  assert(await page.evaluate(() => document.activeElement?.id === 'close-info'), 'About dialog did not focus its close button');
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(() => document.activeElement?.closest('#info-modal') !== null), 'About dialog let reverse focus escape');
  await page.evaluate(() => {
    const dialog = document.querySelector('#info-modal');
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    focusable.at(-1)?.focus();
  });
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.id === 'close-info'), 'About dialog did not wrap forward focus');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => document.activeElement?.id === 'toggle-info'), 'About dialog did not return focus to its opener');

  await page.focus('#toggle-glossary');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#glossary-modal:not([hidden]) #glossary-search', { timeout: 5000 });
  assert(await page.evaluate(() => document.activeElement?.id === 'glossary-search'), 'Glossary dialog did not focus search');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.id === 'close-glossary'), 'Glossary dialog did not wrap forward focus');
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(() => document.activeElement?.id === 'glossary-search'), 'Glossary dialog did not wrap reverse focus');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => document.activeElement?.id === 'toggle-glossary'), 'Glossary dialog did not return focus to its opener');

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus({ preventScroll: true });
    scrollTo(0, 0);
  });
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.classList.contains('skip-to-content')), 'skip link is not the first keyboard stop');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.id === 'main',
    null,
    { timeout: 2000 },
  ).catch(async () => {
    const state = await page.evaluate(() => ({
      hash: location.hash,
      activeId: document.activeElement?.id || '',
      activeClass: document.activeElement?.className || '',
    }));
    throw new Error(`skip link did not focus the main content target: ${JSON.stringify(state)}`);
  });

  const mapAlternative = await page.evaluate(() => ({
    mainTabIndex: document.querySelector('#main')?.getAttribute('tabindex') || '',
    mapInMain: document.querySelector('#map')?.closest('main')?.id || '',
    mapLabel: document.querySelector('#map')?.getAttribute('aria-label') || '',
    mapTabIndex: document.querySelector('#map')?.getAttribute('tabindex') || '',
    tableLabel: document.querySelector('#toggle-table-view')?.getAttribute('aria-label') || '',
  }));
  assert(mapAlternative.mainTabIndex === '-1' && mapAlternative.mapInMain === 'main', `main landmark does not own the map or is not programmatically focusable: ${JSON.stringify(mapAlternative)}`);
  assert(mapAlternative.mapLabel && /^-?1$|^0$/.test(mapAlternative.mapTabIndex), `map target is not programmatically focusable: ${JSON.stringify(mapAlternative)}`);
  assert(/table/i.test(mapAlternative.tableLabel), `keyboard map alternative is not labeled: ${JSON.stringify(mapAlternative)}`);
}

async function assertReducedMotionContract(page, label) {
  const state = await page.evaluate(() => {
    const parseTimes = value => String(value || '').split(',').map(part => {
      const token = part.trim();
      if (token.endsWith('ms')) return Number.parseFloat(token);
      if (token.endsWith('s')) return Number.parseFloat(token) * 1000;
      return 0;
    });
    const offenders = [];
    for (const element of document.querySelectorAll('body *')) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = getComputedStyle(element);
      const animationTimes = parseTimes(style.animationDuration);
      const transitionTimes = parseTimes(style.transitionDuration);
      if (
        (style.animationName !== 'none' && animationTimes.some(time => time > 0.02)) ||
        transitionTimes.some(time => time > 0.02)
      ) {
        offenders.push({
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: String(element.className || '').slice(0, 80),
          animation: `${style.animationName}/${style.animationDuration}`,
          transition: style.transitionDuration,
        });
        if (offenders.length >= 12) break;
      }
    }
    return {
      classApplied: document.documentElement.classList.contains('reduce-motion'),
      offenders,
    };
  });
  assert(state.classApplied, `${label}: reduced-motion class was not applied`);
  assert(!state.offenders.length, `${label}: visible motion remains: ${JSON.stringify(state.offenders)}`);
}

async function assertMobileTargetSizes(page, label) {
  const undersized = await page.evaluate(() => [...document.querySelectorAll(
    '.app-header button, #filters button, #filters input, #filters select, .side-panel:not([hidden]) button, .anim-controls button, .anim-controls input'
  )].filter(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      Number(style.opacity) !== 0 &&
      // Chromium can report a 44px CSS target as 43.999... after viewport
      // scaling. Half-pixel tolerance distinguishes that from a real 43px target.
      (rect.width < 43.5 || rect.height < 43.5);
  }).slice(0, 20).map(element => {
    const rect = element.getBoundingClientRect();
    return {
      selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${String(element.className || '').split(/\s+/)[0]}`,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }));
  assert(!undersized.length, `${label}: interactive targets below 44x44px: ${JSON.stringify(undersized)}`);
}

function rectsIntersect(a, b) {
  return a && b &&
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top;
}

async function assertSidePanelLayout(page, label) {
  await page.waitForTimeout(260);
  const layout = await page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        element.hidden ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.pointerEvents === 'none' ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return null;
      }
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const panel = document.querySelector('#storm-panel');
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: rectFor('#storm-panel'),
      header: rectFor('.app-header'),
      filters: rectFor('#filters'),
      timeline: rectFor('.timeline-ribbon'),
      zoom: rectFor('.leaflet-control-zoom'),
      panelPosition: panelStyle?.position || '',
      panelOverflowY: panelStyle?.overflowY || '',
      theme: document.documentElement.dataset.theme || 'dark',
      highContrast: document.documentElement.classList.contains('high-contrast'),
    };
  });

  assert(layout.panel, `${label}: storm panel did not render`);
  assert(layout.panelPosition === 'fixed', `${label}: panel position is ${layout.panelPosition}, expected fixed`);
  assert(/auto|scroll/.test(layout.panelOverflowY), `${label}: panel overflow-y is ${layout.panelOverflowY}`);
  assert(layout.panel.width >= 280, `${label}: panel is too narrow (${layout.panel.width}px)`);
  assert(layout.panel.height >= 220, `${label}: panel is too short (${layout.panel.height}px)`);
  assert(layout.panel.left >= -0.5, `${label}: panel escapes left edge (${layout.panel.left}px)`);
  assert(layout.panel.top >= -0.5, `${label}: panel escapes top edge (${layout.panel.top}px)`);
  assert(layout.panel.right <= layout.viewport.width + 0.5, `${label}: panel escapes right edge (${layout.panel.right}px > ${layout.viewport.width}px)`);
  assert(layout.panel.bottom <= layout.viewport.height + 0.5, `${label}: panel escapes bottom edge (${layout.panel.bottom}px > ${layout.viewport.height}px)`);
  for (const [name, rect] of Object.entries({
    header: layout.header,
    filters: layout.filters,
    timeline: layout.timeline,
    zoom: layout.zoom,
  })) {
    assert(!rectsIntersect(layout.panel, rect), `${label}: panel overlaps ${name}`);
  }
}

async function assertPlaybackMapMode(page, label, snapshotName = null) {
  await page.click('#play-anim-btn');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#storm-panel');
    const controls = document.querySelector('.anim-controls');
    return document.body.classList.contains('track-playback-active') &&
      panel?.classList.contains('minimized') &&
      controls &&
      !controls.hidden &&
      getComputedStyle(controls).display !== 'none';
  }, { timeout: 10000 });
  await page.waitForTimeout(220);

  const layout = await page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        element.hidden ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        Number(style.opacity) === 0 ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        return null;
      }
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const pointInside = (point, rect) => rect &&
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom;
    const viewport = { width: innerWidth, height: innerHeight };
    const mapCenter = { x: viewport.width / 2, y: viewport.height / 2 };
    const panel = document.querySelector('#storm-panel');
    return {
      viewport,
      bodyPlayback: document.body.classList.contains('track-playback-active'),
      panelMinimized: !!panel?.classList.contains('minimized'),
      panel: rectFor('#storm-panel'),
      restore: rectFor('#storm-panel .panel-restore-bar'),
      controls: rectFor('.anim-controls'),
      header: rectFor('.app-header'),
      headerActions: rectFor('.header-actions'),
      timeline: rectFor('.timeline-ribbon'),
      map: rectFor('#map'),
      centerCoveredByPanel: pointInside(mapCenter, rectFor('#storm-panel')),
      centerCoveredByControls: pointInside(mapCenter, rectFor('.anim-controls')),
    };
  });

  assert(layout.bodyPlayback, `${label}: body did not enter playback map mode`);
  assert(layout.panelMinimized, `${label}: storm panel was not minimized during playback`);
  assert(layout.panel, `${label}: minimized storm restore tab did not render`);
  assert(layout.controls, `${label}: playback controls did not render on the map`);
  assert(layout.map, `${label}: map disappeared during playback`);
  assert(!layout.timeline, `${label}: timeline still competes with playback controls`);
  assert(layout.panel.width <= Math.min(260, layout.viewport.width - 16), `${label}: restore tab is too wide (${layout.panel.width}px)`);
  assert(layout.panel.height <= 72, `${label}: minimized panel is too tall (${layout.panel.height}px)`);
  assert(layout.controls.left >= -0.5, `${label}: playback controls escape left edge`);
  assert(layout.controls.right <= layout.viewport.width + 0.5, `${label}: playback controls escape right edge`);
  assert(layout.controls.bottom <= layout.viewport.height + 0.5, `${label}: playback controls escape bottom edge`);
  assert(layout.controls.height <= layout.viewport.height * 0.42, `${label}: playback controls consume too much vertical space (${layout.controls.height}px)`);
  assert(!rectsIntersect(layout.controls, layout.restore), `${label}: playback controls overlap the restore tab`);
  assert(!layout.centerCoveredByPanel, `${label}: minimized panel covers the map center`);
  assert(!layout.centerCoveredByControls, `${label}: playback controls cover the map center`);
  if (layout.viewport.width <= 720) {
    assert(layout.header && layout.header.height <= 70, `${label}: mobile playback header is too tall (${layout.header?.height}px)`);
    assert(!layout.headerActions, `${label}: mobile playback still shows secondary header actions`);
    assert(layout.controls.height <= 140, `${label}: mobile playback dock is too tall (${layout.controls.height}px)`);
    await assertMobileTargetSizes(page, `${label} controls`);
  }

  if (snapshotName) await captureVisualSnapshot(page, snapshotName);
  await page.click('.anim-close');
  await page.waitForFunction(() => (
    !document.body.classList.contains('track-playback-active') &&
    !document.querySelector('#storm-panel')?.classList.contains('minimized')
  ), { timeout: 5000 });
}

async function assertSettingsSurface(page, label) {
  await page.evaluate(() => {
    const menu = document.querySelector('#settings-menu');
    if (menu && !menu.matches(':popover-open')) menu.showPopover();
  });
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'), { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#storage-manager .storage-scope').length === 5, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#offline-diagnostics')?.dataset.ready === 'true', { timeout: 10000 });
  const layout = await page.evaluate(() => {
    const menu = document.querySelector('#settings-menu');
    const rect = menu?.getBoundingClientRect();
    const style = menu ? getComputedStyle(menu) : null;
    const focusables = [...document.querySelectorAll('#settings-menu button, #settings-menu label.toggle-row')].map(element => {
      const r = element.getBoundingClientRect();
      return { text: (element.textContent || element.getAttribute('aria-label') || '').trim(), width: r.width, height: r.height };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      menu: rect ? {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      } : null,
      position: style?.position || '',
      overflowY: style?.overflowY || '',
      helperCount: document.querySelectorAll('#settings-menu .settings-help, #settings-menu .settings-toggle-copy small').length,
      storageScopes: document.querySelectorAll('#storage-manager .storage-scope').length,
      storageClearActions: document.querySelectorAll('#storage-manager [data-clear-storage]').length,
      sourceBundleActions: document.querySelectorAll('#storage-manager [data-cache-source-bundle]').length,
      diagnosticScopes: document.querySelectorAll('#offline-diagnostics .diagnostics-caches [role="listitem"]').length,
      diagnosticActions: document.querySelectorAll('#offline-diagnostics [data-diagnostics-repair], #offline-diagnostics [data-diagnostics-retry], #offline-diagnostics [data-diagnostics-refresh], #offline-diagnostics [data-diagnostics-export]').length,
      radioGroups: [...document.querySelectorAll('#settings-menu [role="radiogroup"]')].map(group => ({
        checked: group.querySelectorAll('[role="radio"][aria-checked="true"]').length,
        tabbable: [...group.querySelectorAll('[role="radio"]')].filter(radio => radio.tabIndex === 0).length,
      })),
      focusables,
    };
  });
  assert(layout.menu, `${label}: settings menu did not render`);
  assert(layout.position === 'fixed', `${label}: settings menu position is ${layout.position}, expected fixed`);
  assert(/auto|scroll/.test(layout.overflowY), `${label}: settings menu overflow-y is ${layout.overflowY}`);
  assert(layout.menu.left >= -0.5, `${label}: settings menu escapes left edge`);
  assert(layout.menu.top >= -0.5, `${label}: settings menu escapes top edge`);
  assert(layout.menu.right <= layout.viewport.width + 0.5, `${label}: settings menu escapes right edge`);
  assert(layout.menu.bottom <= layout.viewport.height + 0.5, `${label}: settings menu escapes bottom edge`);
  assert(layout.menu.height <= layout.viewport.height - 16, `${label}: settings menu leaves no map context (${layout.menu.height}px)`);
  assert(layout.helperCount >= 9, `${label}: settings helper copy did not render (${layout.helperCount})`);
  assert(layout.diagnosticScopes === 5 && layout.diagnosticActions === 4, `${label}: offline diagnostics are incomplete`);
  assert(layout.storageScopes === 5, `${label}: expected five storage scopes`);
  assert(layout.storageClearActions === 3, `${label}: only optional storage scopes should be clearable`);
  assert(layout.sourceBundleActions === 1, `${label}: source bundle must be user-initiated`);
  assert(layout.radioGroups.length === 5, `${label}: expected five settings radio groups`);
  assert(layout.radioGroups.every(group => group.checked === 1 && group.tabbable === 1), `${label}: settings radios do not use one checked/tabbable item per group`);
  const cramped = layout.focusables.filter(item => item.height < 34);
  assert(!cramped.length, `${label}: settings controls are too small: ${cramped.map(item => `${item.text}:${item.height}`).join(', ')}`);
  const priorUnit = await page.evaluate(() => {
    const selected = document.querySelector('[data-set-unit][aria-checked="true"]');
    selected?.focus();
    return selected?.dataset.setUnit || '';
  });
  await page.keyboard.press('ArrowRight');
  const nextUnit = await page.evaluate(() => ({
    value: document.querySelector('[data-set-unit][aria-checked="true"]')?.dataset.setUnit || '',
    focused: document.activeElement?.dataset?.setUnit || '',
    tabbable: [...document.querySelectorAll('[data-set-unit]')].filter(radio => radio.tabIndex === 0).length,
  }));
  assert(nextUnit.value && nextUnit.value !== priorUnit, `${label}: ArrowRight did not select the next wind-unit radio`);
  assert(nextUnit.focused === nextUnit.value && nextUnit.tabbable === 1, `${label}: radio focus did not rove with selection`);
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => document.querySelector('#settings-menu')?.hidePopover());
}

async function assertDesktopPanelSystem(page, label) {
  await page.evaluate(async () => {
    const season = await import('/src/season.js');
    await season.refreshSeasonSummary({ yearMin: 2020, yearMax: 2020 });
  });
  await page.waitForFunction(() => {
    const summary = document.querySelector('#season-summary');
    const timeline = document.querySelector('.timeline-ribbon');
    return document.body.classList.contains('season-summary-visible') &&
      summary &&
      !summary.hidden &&
      timeline &&
      getComputedStyle(summary).display !== 'none' &&
      getComputedStyle(timeline).display !== 'none';
  }, { timeout: 10000 });

  const assertPanelFit = async (selector, name) => {
    const layout = await page.evaluate((panelSelector) => {
      const rectFor = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (
          element.hidden ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) === 0 ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          return null;
        }
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const panel = document.querySelector(panelSelector);
      const panelRect = rectFor(panelSelector);
      const children = [...document.querySelectorAll(`${panelSelector} .state-summary-cluster, ${panelSelector} .state-distribution-cluster, ${panelSelector} .state-records-cluster, ${panelSelector} .storm-summary-cluster, ${panelSelector} .storm-analysis-cluster, ${panelSelector} .storm-resources-cluster, ${panelSelector} .stats-panel-column`)]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { className: String(element.className || ''), left: rect.left, right: rect.right, width: rect.width };
        });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        panel: panelRect,
        clientWidth: panel?.clientWidth || 0,
        scrollWidth: panel?.scrollWidth || 0,
        children,
        fullBleedHeader: !!document.querySelector(`${panelSelector} .panel-sticky-header, ${panelSelector} .table-view-header`),
        timeline: rectFor('.timeline-ribbon'),
        seasonSummary: rectFor('.season-summary'),
      };
    }, selector);
    assert(layout.panel, `${label}: ${name} did not render`);
    assert(layout.panel.width >= 520, `${label}: ${name} is too narrow for desktop (${layout.panel.width}px)`);
    assert(layout.panel.right <= layout.viewport.width + 0.5, `${label}: ${name} escapes right edge`);
    if (!layout.fullBleedHeader) {
      assert(layout.scrollWidth <= layout.clientWidth + 2, `${label}: ${name} has clipped horizontal overflow (${layout.scrollWidth}px > ${layout.clientWidth}px)`);
    }
    assert(layout.timeline, `${label}: timeline shelf did not render with ${name}`);
    assert(layout.seasonSummary, `${label}: season summary did not render in the desktop shelf with ${name}`);
    assert(!rectsIntersect(layout.panel, layout.timeline), `${label}: ${name} overlaps the timeline shelf`);
    assert(!rectsIntersect(layout.panel, layout.seasonSummary), `${label}: ${name} overlaps the season shelf`);
    assert(Math.abs(layout.seasonSummary.top - layout.timeline.top) <= 2, `${label}: season shelf top is not aligned with timeline (${layout.seasonSummary.top} vs ${layout.timeline.top})`);
    assert(Math.abs(layout.seasonSummary.bottom - layout.timeline.bottom) <= 2, `${label}: season shelf bottom is not aligned with timeline (${layout.seasonSummary.bottom} vs ${layout.timeline.bottom})`);
    assert(layout.seasonSummary.right <= layout.timeline.left - 4, `${label}: season shelf is not left of timeline`);
    assert(layout.timeline.right <= layout.panel.left - 8, `${label}: timeline shelf does not reserve space before ${name}`);
    assert(layout.seasonSummary.height <= 150, `${label}: season shelf is too tall (${layout.seasonSummary.height}px)`);
    const shelfGap = Math.min(layout.timeline.top, layout.seasonSummary.top) - layout.panel.bottom;
    assert(shelfGap >= 4, `${label}: ${name} overlaps or crowds the shelf (${shelfGap}px gap)`);
    assert(shelfGap <= 8, `${label}: ${name} leaves too much empty space above the shelf (${shelfGap}px gap)`);
    for (const child of layout.children) {
      assert(child.left >= layout.panel.left - 1, `${label}: ${name} child escapes left edge (${child.className})`);
      assert(child.right <= layout.panel.right + 1, `${label}: ${name} child escapes right edge (${child.className})`);
    }
  };

  await assertPanelFit('#storm-panel', 'storm panel');
  assert(await page.locator('#storm-panel .citation-block').count() === 1, `${label}: storm panel did not expose a release citation`);

  await page.evaluate(async () => {
    const state = await import('/src/state.js');
    await state.openState('Florida');
  });
  await page.waitForFunction(() => !document.querySelector('#state-panel')?.hidden && /Florida/.test(document.querySelector('#state-panel')?.textContent || ''), { timeout: 10000 });
  await assertPanelFit('#state-panel', 'state panel');
  const stateRows = await page.evaluate(() => [...document.querySelectorAll('#state-panel .state-storm-row')].map(row => ({
    role: row.getAttribute('role'),
    tabIndex: row.getAttribute('tabindex'),
    label: row.getAttribute('aria-label') || '',
  })).slice(0, 12));
  assert(stateRows.length >= 5, `${label}: state panel did not render enough storm rows`);
  assert(stateRows.every(row => row.role === 'button' && row.tabIndex === '0' && /^Open .+ storm details/.test(row.label)), `${label}: state rows are not keyboard-accessible buttons`);
  await page.focus('#state-panel .state-storm-row');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#storm-panel')?.hidden && /Storm details/.test(document.querySelector('#storm-panel')?.textContent || ''), { timeout: 10000 });
  await assertPanelFit('#storm-panel', 'storm panel after keyboard state selection');

  await page.click('#toggle-stats');
  await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, { timeout: 10000 });
  await assertPanelFit('#stats-panel', 'statistics panel');
  assert(await page.locator('#stats-panel .citation-block').count() === 1, `${label}: statistics panel did not expose a release citation`);
  const outlookLayout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    return {
      banner: rect('#stats-panel .seasonal-outlook-banner'),
      current: rect('#stats-panel .sob-current'),
      rows: [...document.querySelectorAll('#stats-panel .sob-row')].map((row) => {
        const bounds = row.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height, scrollWidth: row.scrollWidth };
      }),
    };
  });
  assert(outlookLayout.banner && outlookLayout.current, `${label}: Seasonal Outlook did not render`);
  assert(
    outlookLayout.current.width >= outlookLayout.banner.width - 20,
    `${label}: Seasonal Outlook current block is crushed (${outlookLayout.current.width}px vs ${outlookLayout.banner.width}px)`,
  );
  assert(
    outlookLayout.current.left >= outlookLayout.banner.left - 1 &&
      outlookLayout.current.right <= outlookLayout.banner.right + 1,
    `${label}: Seasonal Outlook current block escapes its card`,
  );
  assert(
    outlookLayout.rows.length > 0 &&
      outlookLayout.rows.every(row => row.width >= 240 && row.scrollWidth <= row.width + 2),
    `${label}: Seasonal Outlook rows overlap or clip (${JSON.stringify(outlookLayout.rows)})`,
  );
}

async function assertSupportBundleExport(page) {
  await page.evaluate(() => {
    localStorage.setItem('hm-saved-views-v1', JSON.stringify({ views: [{ name: 'PRIVATE VIEW' }] }));
    localStorage.setItem('hm-search-history-v1', JSON.stringify({ values: ['PRIVATE SEARCH'] }));
    localStorage.setItem('hm-prep-v1', JSON.stringify({ answers: ['PRIVATE ANSWER'] }));
    localStorage.setItem('hm-user-point-v2', JSON.stringify({ lat: 25.7617, lon: -80.1918 }));
    document.querySelector('#settings-menu')?.showPopover();
  });
  await page.waitForFunction(() => document.querySelector('#offline-diagnostics')?.dataset.ready === 'true', { timeout: 10000 });
  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-diagnostics-export]');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  const bundle = JSON.parse(body);
  assert(bundle.schema_version === 1 && bundle.app?.version === expectedGeneratorVersion, 'support bundle is missing app/schema versions');
  assert(bundle.storage?.scopes?.length === 5, 'support bundle is missing cache scope versions and sizes');
  assert(['coherent', 'unverified'].includes(bundle.release?.state), `support bundle returned an invalid release state: ${bundle.release?.state}`);
  assert(Array.isArray(bundle.optional_feeds) && bundle.optional_feeds.length >= 10, 'support bundle is missing optional-feed readiness');
  assert(!/PRIVATE VIEW|PRIVATE SEARCH|PRIVATE ANSWER|25\.7617|-80\.1918|saved.?views|search.?history|preparedness|\"lat\"|\"lon\"/i.test(body), 'support bundle leaked private local state');
  const activeDataCache = 'hm-data-hm-v1.9.1';
  await page.evaluate(async (dataCacheName) => {
    await (await caches.open('hm-tiles-v1')).put('/recoverable-tile', new Response('tile'));
    await (await caches.open(dataCacheName)).put('/protected-history', new Response('history'));
  }, activeDataCache);
  await page.click('[data-clear-storage="tiles"]');
  await page.waitForSelector('#confirm-local-action[open]');
  assert(/Map tiles/.test(await page.locator('#confirm-local-action').textContent()), 'storage confirmation did not name its scope');
  await page.click('#confirm-local-action .confirm-action-cancel');
  await page.waitForFunction(() => document.activeElement?.matches('[data-clear-storage="tiles"]'));
  assert(await page.evaluate(async () => (
    Boolean(await (await caches.open('hm-tiles-v1')).match('/recoverable-tile')) &&
    document.activeElement?.matches('[data-clear-storage="tiles"]')
  )), 'cancelling cache clearing removed data or lost invoker focus');
  await page.click('[data-clear-storage="tiles"]');
  await page.click('#confirm-local-action .confirm-action-submit');
  await page.waitForFunction(async (dataCacheName) => (
    !(await caches.keys()).includes('hm-tiles-v1') &&
    (await caches.keys()).includes(dataCacheName) &&
    document.activeElement?.matches('[data-clear-storage="tiles"]') &&
    /Map tiles.*cleared/i.test(document.querySelector('#map-announce')?.textContent || '')
  ), activeDataCache, { timeout: 10000 });
  await page.evaluate(async (dataCacheName) => {
    for (const key of ['hm-saved-views-v1', 'hm-search-history-v1', 'hm-prep-v1', 'hm-user-point-v2']) {
      localStorage.removeItem(key);
    }
    await caches.delete(dataCacheName);
    document.querySelector('#settings-menu')?.hidePopover();
  }, activeDataCache);
}

async function assertPremiumChrome(page, label) {
  const offenders = await page.evaluate(() => {
    const selectors = [
      'button',
      '[role="button"]',
      '.cat-pill',
      '.storm-flag',
      '.visible-count',
      '.ct-chip',
      '.cold-tag',
      '.dai-bar',
      '.segmented-control',
      '.ss-tier',
      '.onb-step',
      '.hm-toast',
      '.settings-menu',
      '.search-empty',
      '.panel-restore-bar',
      '.anim-controls',
      '.anim-radar-toggle',
    ].join(',');
    return [...document.querySelectorAll(selectors)].filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return false;
      if (element.closest('.leaflet-control-container')) return false;
      const radius = Number.parseFloat(style.borderTopLeftRadius || '0');
      return Number.isFinite(radius) && radius > 12;
    }).slice(0, 20).map(element => ({
      tag: element.tagName.toLowerCase(),
      className: String(element.className || ''),
      text: (element.textContent || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      radius: getComputedStyle(element).borderTopLeftRadius,
    }));
  });
  assert(!offenders.length, `${label}: oversized rounded controls remain: ${JSON.stringify(offenders)}`);
}

async function runPanelLayoutScenario(browser, baseUrl, scenario) {
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    serviceWorkers: 'block',
  });
  await seedSettings(context, {
    onboarded: true,
    theme: scenario.theme,
    highContrast: scenario.highContrast,
    locale: 'en',
  });
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await openKatrinaPanel(page);
    await assertSidePanelLayout(page, scenario.label);
    await assertSettingsSurface(page, scenario.label);
    if (scenario.desktopPanelAudit) await assertDesktopPanelSystem(page, scenario.label);
    if (scenario.playback) await assertPlaybackMapMode(page, scenario.label);
    await assertPremiumChrome(page, scenario.label);
    if (pageErrors.length) throw new Error(`${scenario.label}: page errors: ${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function runVisualSnapshotMatrix(browser, baseUrl, { width, height, name }) {
  const context = await browser.newContext({
    viewport: { width, height },
    serviceWorkers: 'block',
    reducedMotion: 'no-preference',
  });
  await seedSettings(context, {
    onboarded: true,
    theme: 'dark',
    highContrast: false,
    reducedMotion: false,
    locale: 'en',
  });
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await assertThemeContrastMatrix(page);
    await captureVisualSnapshot(page, `${name}-dark`);

    await page.click('#toggle-filters');
    await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'), { timeout: 5000 });
    if (width <= 720) await assertMobileTargetSizes(page, `${name} filters`);
    await captureVisualSnapshot(page, `${name}-filters`);
    await page.click('#toggle-filters');

    await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
    await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'), { timeout: 5000 });
    if (width <= 720) await assertMobileTargetSizes(page, `${name} settings`);
    await captureVisualSnapshot(page, `${name}-settings`);
    await page.evaluate(() => document.querySelector('#settings-menu')?.hidePopover());

    await page.evaluate(async () => {
      const settings = await import('/src/settings.js');
      settings.setSetting('theme', 'light');
    });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await captureVisualSnapshot(page, `${name}-light`);

    await page.evaluate(async () => {
      const settings = await import('/src/settings.js');
      settings.setSetting('theme', 'dark');
      settings.setSetting('highContrast', true);
    });
    await page.waitForFunction(() => document.documentElement.classList.contains('high-contrast'));
    await captureVisualSnapshot(page, `${name}-high-contrast`);

    await page.evaluate(async () => {
      const settings = await import('/src/settings.js');
      settings.setSetting('highContrast', false);
      settings.setSetting('reducedMotion', true);
    });
    await page.waitForFunction(() => document.documentElement.classList.contains('reduce-motion'));
    await assertReducedMotionContract(page, `${name} reduced motion`);
    await captureVisualSnapshot(page, `${name}-reduced-motion`);
    await page.evaluate(async () => {
      const settings = await import('/src/settings.js');
      settings.setSetting('reducedMotion', false);
    });

    await openKatrinaPanel(page);
    await assertSidePanelLayout(page, `${name} storm detail`);
    if (width <= 720) await assertMobileTargetSizes(page, `${name} storm detail`);
    await captureVisualSnapshot(page, `${name}-storm-detail`);

    await page.evaluate(async () => {
      const panels = await import('/src/panels.js');
      panels.closeAllPanels();
      const stats = await import('/src/stats.js');
      stats.toggleStats();
    });
    await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, { timeout: 10000 });
    if (width <= 720) await assertMobileTargetSizes(page, `${name} statistics`);
    await captureVisualSnapshot(page, `${name}-statistics`);

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
    await page.waitForSelector('#compare-panel:not([hidden]) .cp-card', { timeout: 10000 });
    if (width <= 720) await assertMobileTargetSizes(page, `${name} comparison`);
    await captureVisualSnapshot(page, `${name}-comparison`);

    await openKatrinaPanel(page);
    await assertPlaybackMapMode(page, `${name} playback`, `${name}-playback`);
    if (pageErrors.length) throw new Error(`${name}: page errors: ${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function assertManagedPanelFocusContracts(browser, baseUrl) {
  for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({
      viewport,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    await seedSettings(context, { onboarded: true, locale: 'en' });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      const scenarios = [
        { trigger: '#toggle-prep', panel: '#prep-panel', close: '#close-prep', entry: '#prep-panel-title' },
        { trigger: '#toggle-evac', panel: '#evac-panel', close: '#close-evac', entry: '#evac-panel-title' },
        { trigger: '#toggle-table-view', panel: '#table-view-panel', close: '#close-table-view', entry: '#table-view-title' },
        { trigger: '#toggle-spatial-search', panel: '#spatial-results', close: '#spatial-results .close-btn', entry: '#spatial-results h3' },
      ];
      for (const scenario of scenarios) {
        const directTriggerVisible = await page.locator(scenario.trigger).isVisible();
        await clickHeaderAction(page, scenario.trigger);
        await page.waitForSelector(`${scenario.panel}:not([hidden])`, { timeout: 10_000 });
        await page.waitForFunction(
          selector => document.activeElement === document.querySelector(selector),
          scenario.entry,
          { timeout: 5_000 },
        );
        const semantics = await page.locator(scenario.panel).evaluate(element => ({
          role: element.getAttribute('role'),
          modal: element.getAttribute('aria-modal'),
        }));
        assert(semantics.role === 'region' && semantics.modal !== 'true', `${scenario.panel}: non-modal panel semantics changed: ${JSON.stringify(semantics)}`);
        await page.locator(scenario.close).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(
          ({ panel, expected }) => {
            const target = document.activeElement;
            const rect = target?.getBoundingClientRect?.();
            return document.querySelector(panel)?.hidden === true
              && target?.id === expected
              && rect?.width > 0
              && rect?.height > 0
              && getComputedStyle(target).visibility !== 'hidden';
          },
          {
            panel: scenario.panel,
            expected: directTriggerVisible ? scenario.trigger.slice(1) : 'toggle-mobile-actions',
          },
          { timeout: 5_000 },
        ).catch(async () => {
          const state = await page.evaluate(panel => {
            const target = document.activeElement;
            const rect = target?.getBoundingClientRect?.();
            return {
              panel,
              hidden: document.querySelector(panel)?.hidden,
              activeId: target?.id || '',
              activeClass: String(target?.className || ''),
              width: rect?.width || 0,
              height: rect?.height || 0,
            };
          }, scenario.panel);
          throw new Error(`${viewport.width}px ${scenario.panel}: focus was not returned to a visible invoker: ${JSON.stringify(state)}`);
        });
      }
    } finally {
      await context.close();
    }
  }
}

async function assertLocalizedWorkflowChrome(browser, baseUrl) {
  for (const locale of ['en', 'es', 'ht']) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    await seedSettings(context, { onboarded: true, locale, reducedMotion: true });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await assertNoAxeViolations(page, `${locale} main view (WCAG 2.2 AA)`);
      const expected = await page.evaluate(async () => {
        const { getLocale, t } = await import('/src/i18n.js');
        return {
          locale: getLocale(),
          onboardingSkip: t('onboarding.skip'),
          savedTitle: t('savedViews.title'),
          savedEmpty: t('savedViews.empty'),
          tableLabel: t('table.filteredLabel'),
          tableYear: t('table.column.year'),
          tableCount: t('table.countMany', (759).toLocaleString(getLocale())),
          spatialTitle: t('spatial.title'),
          spatialClose: t('spatial.close'),
          seasonalLabel: t('seasonal.label'),
          seasonalHistory: t('seasonal.history'),
        };
      });
      assert(expected.locale === locale, `${locale}: application locale did not initialize`);

      await page.evaluate(async () => {
        const onboarding = await import('/src/onboarding.js');
        onboarding.maybeStartOnboarding({ force: true });
      });
      await page.waitForSelector('.onb-overlay .onb-skip', { timeout: 5_000 });
      assert(await page.locator('.onb-skip').textContent() === expected.onboardingSkip, `${locale}: onboarding controls are not localized`);
      await page.locator('.onb-skip').click();
      await page.waitForSelector('.onb-overlay', { state: 'detached', timeout: 5_000 });

      await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
      await page.waitForSelector('#settings-menu:popover-open #saved-views-manager', { timeout: 5_000 });
      assert((await page.locator('#settings-saved-views-title').textContent()) === expected.savedTitle, `${locale}: saved-view heading is not localized`);
      assert((await page.locator('#saved-views-manager .settings-help').textContent()) === expected.savedEmpty, `${locale}: saved-view empty state is not localized`);
      await assertNoAxeViolations(page, `${locale} settings (WCAG 2.2 AA)`, '#settings-menu');
      await page.evaluate(() => document.querySelector('#settings-menu')?.hidePopover());

      await clickHeaderAction(page, '#toggle-table-view');
      await page.waitForSelector('#table-view-panel:not([hidden]) tbody tr', { timeout: 10_000 });
      assert(await page.locator('.table-view-table').getAttribute('aria-label') === expected.tableLabel, `${locale}: table label is not localized`);
      assert((await page.locator('th[data-col="year"]').textContent()).startsWith(expected.tableYear), `${locale}: table columns are not localized`);
      assert((await page.locator('.table-view-count').textContent()) === expected.tableCount, `${locale}: table count is not locale-aware`);
      await page.locator('#close-table-view').focus();
      await page.keyboard.press('Enter');

      await clickHeaderAction(page, '#toggle-spatial-search');
      await page.waitForSelector('#spatial-results:not([hidden]) h3', { timeout: 5_000 });
      assert((await page.locator('#spatial-results h3').textContent()) === expected.spatialTitle, `${locale}: spatial prompt is not localized`);
      assert(await page.locator('#spatial-results .close-btn').getAttribute('aria-label') === expected.spatialClose, `${locale}: spatial close label is not localized`);
      await page.locator('#spatial-results .close-btn').focus();
      await page.keyboard.press('Enter');

      await clickHeaderAction(page, '#toggle-stats');
      await page.waitForSelector('#stats-panel:not([hidden]) .seasonal-outlook-banner', { timeout: 10_000 });
      assert((await page.locator('.sob-label').textContent()) === expected.seasonalLabel, `${locale}: seasonal heading is not localized`);
      assert((await page.locator('.sob-details summary').textContent()) === expected.seasonalHistory, `${locale}: seasonal disclosure is not localized`);

      await openKatrinaPanel(page);
      await assertNoAxeViolations(page, `${locale} storm panel (WCAG 2.2 AA)`, '#storm-panel');
    } finally {
      await context.close();
    }
  }
}

async function assertSourceLanguageDisclosures(browser, baseUrl) {
  const expected = {
    es: /fuente en inglés/i,
    ht: /sous anglè/i,
  };
  for (const [locale, pattern] of Object.entries(expected)) {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      serviceWorkers: 'block',
    });
    await seedSettings(context, { onboarded: true, locale });
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await openKatrinaPanel(page);
      const biography = await page.evaluate(() => {
        const disclosure = document.querySelector('#storm-panel .content-language-note');
        return {
          text: disclosure?.textContent || '',
          language: disclosure?.closest('.biography-text')?.getAttribute('lang') || '',
        };
      });
      assert(pattern.test(biography.text) && biography.language === 'en', `${locale}: biography source language is not disclosed: ${JSON.stringify(biography)}`);

      await page.evaluate(async () => {
        const glossary = await import('/src/glossary.js');
        await glossary.initGlossary();
        glossary.showGlossary();
      });
      const glossary = await page.evaluate(() => ({
        text: document.querySelector('#glossary-modal .content-language-note')?.textContent || '',
        languages: [...document.querySelectorAll('#glossary-modal .glossary-item')].map(item => item.lang),
      }));
      assert(pattern.test(glossary.text), `${locale}: glossary source language is not disclosed: ${JSON.stringify(glossary)}`);
      assert(glossary.languages.length === 20 && glossary.languages.every(language => language === 'en'), `${locale}: glossary rows lack English language metadata`);
    } finally {
      await context.close();
    }
  }
}

async function assertForcedColorsContract(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    serviceWorkers: 'block',
    forcedColors: 'active',
  });
  // Playwright exposes forced-colors but not prefers-contrast on every
  // Chromium channel. Seed the OS contrast query so this run also proves the
  // unset high-contrast setting adopts the system default.
  await context.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    const listeners = new Set();
    const contrastMedia = {
      matches: true,
      media: '(prefers-contrast: more)',
      onchange: null,
      addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
      addListener(listener) { listeners.add(listener); },
      removeListener(listener) { listeners.delete(listener); },
      dispatchEvent(event) { listeners.forEach(listener => listener.call(this, event)); return true; },
    };
    window.__hmContrastMedia = contrastMedia;
    window.matchMedia = query => query === '(prefers-contrast: more)' ? contrastMedia : nativeMatchMedia(query);
  });
  await seedSettings(context, { schema_version: 1, settings: { onboarded: true, locale: 'en' } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForFunction(() => window.matchMedia('(forced-colors: active)').matches);
    const systemState = await page.evaluate(async () => {
      const settings = await import('/src/settings.js');
      return {
        forcedColors: window.matchMedia('(forced-colors: active)').matches,
        prefersContrast: window.matchMedia('(prefers-contrast: more)').matches,
        highContrast: settings.getSetting('highContrast'),
        classApplied: document.documentElement.classList.contains('high-contrast'),
      };
    });
    assert(systemState.forcedColors && systemState.prefersContrast && systemState.highContrast && systemState.classApplied,
      `forced-colors did not seed high contrast: ${JSON.stringify(systemState)}`);
    await page.evaluate(() => {
      window.__hmContrastMedia.matches = false;
      window.__hmContrastMedia.dispatchEvent({ type: 'change' });
    });
    await page.waitForFunction(() => !document.documentElement.classList.contains('high-contrast'));
    await page.evaluate(() => {
      window.__hmContrastMedia.matches = true;
      window.__hmContrastMedia.dispatchEvent({ type: 'change' });
    });
    await page.waitForFunction(() => document.documentElement.classList.contains('high-contrast'));

    const legend = await page.evaluate(() => {
      const element = document.querySelector('.filter-legend');
      const style = element ? getComputedStyle(element) : null;
      const rect = element?.getBoundingClientRect();
      return {
        text: element?.textContent?.replace(/\s+/g, ' ').trim() || '',
        width: rect?.width || 0,
        height: rect?.height || 0,
        color: style?.color || '',
        background: style?.backgroundColor || '',
        border: style?.borderTopColor || '',
        forcedColorAdjust: style?.forcedColorAdjust || '',
      };
    });
    assert(legend.text && /Saffir-Simpson/.test(legend.text) && legend.width > 0 && legend.height > 0,
      `forced-colors legend did not render: ${JSON.stringify(legend)}`);
    assert(!/transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(`${legend.color} ${legend.background} ${legend.border}`),
      `forced-colors legend has transparent system chrome: ${JSON.stringify(legend)}`);
    assert(legend.forcedColorAdjust === 'auto', `forced-colors legend did not use system colors: ${JSON.stringify(legend)}`);
    await assertNoAxeViolations(page, 'forced-colors main view (WCAG 2.2 AA)');

    await openKatrinaPanel(page);
    const panel = await page.evaluate(() => {
      const elements = [
        document.querySelector('#storm-panel'),
        document.querySelector('.leaflet-control-zoom a'),
      ];
      return elements.map(element => {
        const style = element ? getComputedStyle(element) : null;
        const rect = element?.getBoundingClientRect();
        return {
          width: rect?.width || 0,
          height: rect?.height || 0,
          color: style?.color || '',
          background: style?.backgroundColor || '',
          border: style?.borderTopColor || '',
          forcedColorAdjust: style?.forcedColorAdjust || '',
        };
      });
    });
    assert(panel.every(surface => surface.width > 0 && surface.height > 0 &&
      !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(`${surface.color} ${surface.background} ${surface.border}`) &&
      surface.forcedColorAdjust === 'auto'), `forced-colors panel/control is not legible: ${JSON.stringify(panel)}`);
    await assertNoAxeViolations(page, 'forced-colors storm panel (WCAG 2.2 AA)', '#storm-panel');
  } finally {
    await context.close();
  }
}

async function assertActivePopupDomSafety(page) {
  const result = await page.evaluate(async () => {
    const { activeStormCardElement } = await import('/src/active.js');
    const poison = '<img src=x onerror="window.__hmPopupPoisoned=true"><svg onload="window.__hmPopupPoisoned=true">';
    window.__hmPopupPoisoned = false;
    const card = activeStormCardElement({
      id: 'AL012026',
      name: poison,
      classification: poison,
      intensity: 70,
      publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/MIATCPAT1.shtml?note=%22%3E%3Cscript%3E' },
      forecastDiscussion: { url: 'javascript:window.__hmPopupPoisoned=true' },
    }, [25, -70]);
    document.body.appendChild(card);
    const snapshot = {
      text: card.textContent || '',
      dangerousElements: card.querySelectorAll('img,svg,script,iframe,object').length,
      eventAttributes: [...card.querySelectorAll('*')].flatMap(element =>
        [...element.attributes].filter(attribute => /^on/i.test(attribute.name)).map(attribute => attribute.name)
      ),
      hrefs: [...card.querySelectorAll('a')].map(anchor => anchor.href),
      poisoned: window.__hmPopupPoisoned,
    };
    card.remove();
    return snapshot;
  });
  assert(result.text.includes('<img src=x onerror='), `active popup did not preserve poisoned text as text: ${JSON.stringify(result)}`);
  assert(result.dangerousElements === 0, `active popup created executable elements: ${JSON.stringify(result)}`);
  assert(result.eventAttributes.length === 0 && !result.poisoned, `active popup created executable attributes: ${JSON.stringify(result)}`);
  assert(result.hrefs.length === 3, `active popup URL allowlist kept the wrong links: ${JSON.stringify(result.hrefs)}`);
  assert(
    result.hrefs.every(href => new URL(href).protocol === 'https:' && ['www.nhc.noaa.gov', 'nhc.noaa.gov'].includes(new URL(href).hostname)),
    `active popup URL allowlist admitted an unexpected origin: ${JSON.stringify(result.hrefs)}`,
  );
}

async function assertAdvisoryTooltipDomSafety(page) {
  const result = await page.evaluate(async () => {
    const { ensureStormsLoaded, getStorm } = await import('/src/data.js');
    const { getMap } = await import('/src/map.js');
    const { clearAdvisoryReplay, renderAdvisory } = await import('/src/advisory-replay.js');
    await ensureStormsLoaded();
    const storm = getStorm('AL142024');
    const poison = '<img src=x onerror="window.__hmAdvisoryPoisoned=true">';
    window.__hmAdvisoryPoisoned = false;
    const record = {
      unmatchedForecasts: 0,
      missingDiscussions: 0,
      advisories: [{
        t: '2024-09-24T00:00:00Z',
        n: 1,
        f: [
          [0, storm.track[0].lat, storm.track[0].lon, poison],
          [6, storm.track[1].lat, storm.track[1].lon, poison],
        ],
        e: [],
        discussion: null,
      }],
    };
    const rendered = await renderAdvisory(storm, { map: getMap(), record, coneEra: '2025' });
    getMap().eachLayer(layer => {
      if (typeof layer.openTooltip === 'function') layer.openTooltip();
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const tooltips = [...document.querySelectorAll('.leaflet-tooltip')];
    const snapshot = {
      status: rendered.status,
      text: tooltips.map(tooltip => tooltip.textContent || '').join(' '),
      dangerousElements: tooltips.reduce((total, tooltip) => total + tooltip.querySelectorAll('img,svg,script,iframe,object').length, 0),
      eventAttributes: tooltips.flatMap(tooltip => [...tooltip.querySelectorAll('*')].flatMap(element =>
        [...element.attributes].filter(attribute => /^on/i.test(attribute.name)).map(attribute => attribute.name)
      )),
      poisoned: window.__hmAdvisoryPoisoned,
    };
    clearAdvisoryReplay();
    document.querySelectorAll('.leaflet-tooltip').forEach(tooltip => tooltip.remove());
    return snapshot;
  });
  assert(result.status === 'rendered', `advisory poison fixture did not render: ${JSON.stringify(result)}`);
  assert(result.text.includes('<img src=x onerror='), `advisory tooltip did not preserve poisoned text as text: ${JSON.stringify(result)}`);
  assert(result.dangerousElements === 0, `advisory tooltip created executable elements: ${JSON.stringify(result)}`);
  assert(result.eventAttributes.length === 0 && !result.poisoned, `advisory tooltip created executable attributes: ${JSON.stringify(result)}`);
}

async function assertLocationPrivacyFlow(page) {
  await page.evaluate(async () => {
    const spatial = await import('/src/spatial-search.js');
    if (!spatial.isSpatialActive()) spatial.toggleSpatialMode();
  });
  await page.waitForSelector('#spatial-results:not([hidden]) .sp-location-privacy');
  const initial = await page.evaluate(() => ({
    disclosure: document.querySelector('.sp-location-privacy p')?.textContent || '',
    rememberChecked: document.querySelector('.sp-remember-location')?.checked,
    legacy: localStorage.getItem('hm-user-point-v1'),
    persisted: localStorage.getItem('hm-user-point-v2'),
    session: sessionStorage.getItem('hm-user-point-session-v2'),
  }));
  assert(/tab session/i.test(initial.disclosure), `location retention disclosure is missing: ${JSON.stringify(initial)}`);
  assert(initial.rememberChecked === false, 'location persistence was opted in by default');
  assert(initial.legacy === null && initial.persisted === null && initial.session === null, `location storage was not initially empty: ${JSON.stringify(initial)}`);
  await captureVisualSnapshot(page, 'desktop-location-privacy');

  await page.click('.sp-locate-btn');
  await page.waitForFunction(() => sessionStorage.getItem('hm-user-point-session-v2') && document.querySelector('.sp-count'));
  const sessionState = await page.evaluate(() => ({
    session: JSON.parse(sessionStorage.getItem('hm-user-point-session-v2')),
    persisted: localStorage.getItem('hm-user-point-v2'),
    status: document.querySelector('.sp-location-status')?.textContent || '',
  }));
  assert(sessionState.session?.schema_version === 2 && sessionState.persisted === null, `default location did not remain session-only: ${JSON.stringify(sessionState)}`);
  assert(/tab session/i.test(sessionState.status), `session retention status is missing: ${JSON.stringify(sessionState)}`);

  await page.check('.sp-remember-location');
  await page.click('.sp-locate-btn');
  await page.waitForFunction(() => localStorage.getItem('hm-user-point-v2') && !sessionStorage.getItem('hm-user-point-session-v2'));
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('hm-user-point-v2')));
  assert(
    remembered?.schema_version === 2 && remembered.expires_at > Date.now() && remembered.expires_at <= Date.now() + 24 * 60 * 60 * 1000 + 5000,
    `remembered location lacks a bounded expiry: ${JSON.stringify(remembered)}`,
  );

  await page.click('.sp-clear-location');
  const cleared = await page.evaluate(() => ({
    persisted: localStorage.getItem('hm-user-point-v2'),
    session: sessionStorage.getItem('hm-user-point-session-v2'),
    status: document.querySelector('.sp-location-status')?.textContent || '',
  }));
  assert(cleared.persisted === null && cleared.session === null && /cleared/i.test(cleared.status), `location clear control failed: ${JSON.stringify(cleared)}`);

  const errors = [
    [1, /permission was denied/i],
    [3, /timed out/i],
    [2, /could not provide a location/i],
  ];
  for (const [code, pattern] of errors) {
    await page.evaluate((errorCode) => {
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
        configurable: true,
        value: (_success, error) => error({ code: errorCode }),
      });
    }, code);
    await page.click('.sp-locate-btn');
    await page.waitForFunction(expectedCode => {
      const text = document.querySelector('.sp-location-status')?.textContent || '';
      return expectedCode === 1
        ? /permission was denied/i.test(text)
        : expectedCode === 3
          ? /timed out/i.test(text)
          : /could not provide a location/i.test(text);
    }, code);
    const text = await page.textContent('.sp-location-status');
    assert(pattern.test(text || ''), `geolocation error ${code} was not distinct: ${text}`);
  }

  await page.evaluate(async () => {
    const spatial = await import('/src/spatial-search.js');
    if (spatial.isSpatialActive()) spatial.toggleSpatialMode();
  });
}

try {
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: 25.7617, longitude: -80.1918 },
  });
  await seedSettings(context, { onboarded: true });
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);

  await page.goto(`${baseUrl}/#c=bad&s=NotAState`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await assertActivePopupDomSafety(page);
  await assertAdvisoryTooltipDomSafety(page);
  await assertLocationPrivacyFlow(page);

  const migratedSettings = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hm-settings-v1') || 'null'),
  );
  assert(
    migratedSettings?.schema_version === 1 &&
      migratedSettings?.settings?.onboarded === true,
    `legacy settings were not migrated to a versioned envelope: ${JSON.stringify(migratedSettings)}`,
  );

  const hasPanelKeyframes = await page.evaluate(() => {
    const containsKeyframes = rules => [...rules].some(rule => {
      if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === 'slideInPanel') return true;
      if (rule.styleSheet) {
        try {
          if (containsKeyframes(rule.styleSheet.cssRules)) return true;
        } catch {
          // Ignore cross-origin stylesheets; application styles are same-origin.
        }
      }
      return rule.cssRules ? containsKeyframes(rule.cssRules) : false;
    });
    return [...document.styleSheets].some(sheet => {
      try {
        return containsKeyframes(sheet.cssRules);
      } catch {
        return false;
      }
    });
  });
  assert(hasPanelKeyframes, 'slideInPanel keyframes were swallowed by an invalid preceding CSS selector');

  const restored = await page.evaluate(() => ({
    hash: location.hash,
    state: document.querySelector('#state-filter')?.value || '',
    categories: [...document.querySelectorAll('.cat-btn')].map(button => ({
      cat: button.dataset.cat,
      on: button.classList.contains('on'),
      pressed: button.getAttribute('aria-pressed'),
    })),
    visible: document.querySelector('#visible-count')?.textContent || '',
  }));
  assert(/^#v=1&rel=[a-f0-9]{64}$/.test(restored.hash), `invalid default hash was not canonicalized to the current data release: ${restored.hash}`);
  assert(restored.state === '', `invalid state filter was not cleared: ${restored.state}`);
  assert(restored.categories.length === 6 && restored.categories.every(category => category.on && category.pressed === 'true'), 'invalid category hash did not restore default categories');
  assert(/landfalls/.test(restored.visible), `visible-count did not render: ${restored.visible}`);

  await assertDialogAndKeyboardContracts(page);

  const shortcutPage = await context.newPage();
  await shortcutPage.goto(`${baseUrl}/#stats`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(shortcutPage);
  await shortcutPage.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, { timeout: 10000 });
  await shortcutPage.close();

  await page.click('#toggle-info');
  await page.waitForFunction(() => {
    const modal = document.querySelector('#info-modal');
    const text = document.querySelector('#data-provenance-body')?.textContent || '';
    return modal && !modal.hidden && text.includes('hurdat2-atlantic.txt') && text.includes('1851-2025');
  }, { timeout: 5000 });
  const provenanceText = await page.textContent('#data-provenance-body');
  const aboutText = await page.textContent('#info-modal');
  assert(/595\s+storms/.test(provenanceText), 'About provenance did not render the storm count.');
  assert(/759\s+landfalls/.test(provenanceText), 'About provenance did not render the landfall count.');
  assert(/16 of 16/.test(aboutText) && /100\.0% precision/.test(aboutText), 'About did not render the measured AOML ground-truth result.');
  assert(/Cite this release/.test(aboutText) && /@software\{hurricanemap_/.test(aboutText), 'About did not render copy-paste APA and BibTeX citations.');
  assert(
    expectedGeneratorVersion && provenanceText.includes(`HurricaneMap ${expectedGeneratorVersion}`),
    'About provenance did not render the generator app version.',
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#info-modal')?.hidden, { timeout: 5000 });

  await page.evaluate(async () => {
    const updates = await import('/src/sw-updates.js');
    document.querySelector('#hm-update-prompt')?.remove();
    window.__swUpdateReload = false;
    window.__swUpdatePrompt = updates.createUpdatePrompt({
      onReload: () => { window.__swUpdateReload = true; },
    });
    window.__swUpdatePrompt.show();
  });
  await page.waitForSelector('#hm-update-prompt.is-visible', { timeout: 5000 });
  const updatePromptText = await page.textContent('#hm-update-prompt');
  assert(/Update available/.test(updatePromptText), 'service-worker update prompt title did not render.');
  assert(/newest map shell and offline data cache/.test(updatePromptText), 'service-worker update prompt help copy did not render.');
  await page.click('#hm-update-prompt .hm-update-dismiss');
  await page.waitForFunction(() => document.querySelector('#hm-update-prompt')?.hidden, { timeout: 5000 });
  await page.evaluate(() => window.__swUpdatePrompt.show());
  await page.click('#hm-update-prompt .hm-update-reload');
  const reloadClicked = await page.evaluate(() => window.__swUpdateReload);
  assert(reloadClicked === true, 'service-worker update prompt reload action did not fire.');
  await page.evaluate(() => window.__swUpdatePrompt.hide());
  await assertSupportBundleExport(page);

  const errorSurfaceInstalled = await page.evaluate(() => window.__hmErrorSurface === true);
  assert(errorSurfaceInstalled, 'global error surface was not installed at boot.');

  // Locale switching must reach dynamic strings, not just data-i18n statics.
  const localeStrings = await page.evaluate(async () => {
    const i18n = await import('/src/i18n.js');
    const before = i18n.t('panel.loading');
    i18n.setLocale('es');
    const es = i18n.t('panel.loading');
    i18n.setLocale('ht');
    const ht = i18n.t('panel.loading');
    i18n.setLocale('en');
    return { before, es, ht };
  });
  assert(/Loading track/.test(localeStrings.before), `EN dynamic string wrong: ${localeStrings.before}`);
  assert(localeStrings.es !== localeStrings.before && /Cargando/.test(localeStrings.es), `ES dynamic string did not switch: ${localeStrings.es}`);
  assert(localeStrings.ht !== localeStrings.before && /chaje/.test(localeStrings.ht), `HT dynamic string did not switch: ${localeStrings.ht}`);

  await clickHeaderAction(page, '#toggle-on-this-date');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#on-this-date-panel');
    return panel && !panel.hidden && /On this date in history/.test(document.querySelector('#on-this-date-body')?.textContent || '');
  }, { timeout: 15000 });
  await page.evaluate(async () => (await import('/src/i18n.js')).setLocale('es'));
  await page.waitForFunction(() => /Esta fecha en la historia/.test(document.querySelector('#on-this-date-body')?.textContent || ''), { timeout: 10000 });
  const onThisDateEs = await page.textContent('#on-this-date-body');
  assert(!/Finding historical|\btoday\b|\bunnamed\b|Show full storm details/.test(onThisDateEs), `On-this-date Spanish surface retained English copy: ${onThisDateEs}`);
  await page.evaluate(async () => (await import('/src/i18n.js')).setLocale('ht'));
  await page.waitForFunction(() => /Jou sa a nan istwa/.test(document.querySelector('#on-this-date-body')?.textContent || ''), { timeout: 10000 });
  const onThisDateHt = await page.textContent('#on-this-date-body');
  assert(!/Finding historical|\btoday\b|\bunnamed\b|Show full storm details/.test(onThisDateHt), `On-this-date Haitian Creole surface retained English copy: ${onThisDateHt}`);
  await page.evaluate(async () => (await import('/src/i18n.js')).setLocale('en'));
  await page.click('#close-on-this-date');
  await page.waitForFunction(() => document.querySelector('#on-this-date-panel')?.hidden, { timeout: 5000 });

  // Versioned saved views restore bounded filters, units, and comparison IDs
  // without persisting addresses or arbitrary location coordinates.
  await page.evaluate(() => {
    location.hash = '#v=1&c=3%2C4%2C5&p=AL122005%2CAL041992&u=mph&d=nominal';
  });
  await page.waitForFunction(async () => {
    const compare = await import('/src/compare.js');
    const settings = await import('/src/settings.js');
    return compare.getPins().length === 2 &&
      settings.getSetting('windUnit') === 'mph' &&
      settings.getSetting('damageMode') === 'nominal';
  }, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
  await page.fill('#saved-view-name', 'Major comparison');
  await page.click('#saved-views-manager [data-action="save"]');
  const savedViewState = await page.evaluate(() => {
    const raw = localStorage.getItem('hm-saved-views-v1') || '';
    return { raw, parsed: JSON.parse(raw || 'null') };
  });
  assert(savedViewState.parsed?.schema_version === 1, 'saved view did not use a versioned envelope');
  assert(savedViewState.parsed?.views?.[0]?.hash.includes('p=AL122005%2CAL041992'), 'saved comparison IDs did not round-trip');
  assert(!/address|latitude|longitude|\\blat\\b|\\blon\\b/i.test(savedViewState.raw), 'saved view persisted unexpected location data');
  await page.click('#saved-views-manager [data-action="delete"]');
  await page.waitForSelector('#confirm-local-action[open]');
  await assertNoAxeViolations(page, 'saved-view deletion confirmation (WCAG 2.2 AA)', '#confirm-local-action');
  assert(await page.evaluate(() => document.activeElement?.classList.contains('confirm-action-cancel')), 'saved-view confirmation did not focus the safe action');
  await page.click('#confirm-local-action .confirm-action-cancel');
  await page.waitForSelector('#confirm-local-action', { state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('#saved-views-manager [data-action="delete"]'));
  const cancelledSavedViewDelete = await page.evaluate(() => ({
    count: JSON.parse(localStorage.getItem('hm-saved-views-v1')).views.length,
    active: document.activeElement?.outerHTML || '',
    isDelete: document.activeElement?.matches('#saved-views-manager [data-action="delete"]'),
    settingsOpen: document.querySelector('#settings-menu')?.matches(':popover-open'),
  }));
  assert(
    cancelledSavedViewDelete.count === 1 && cancelledSavedViewDelete.isDelete,
    `cancelling saved-view deletion changed data or lost invoker focus: ${JSON.stringify(cancelledSavedViewDelete)}`,
  );
  await page.click('#saved-views-manager [data-action="delete"]');
  await page.click('#confirm-local-action .confirm-action-submit');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('hm-saved-views-v1')).views.length === 0);
  assert(await page.evaluate(() => (
    document.activeElement?.id === 'saved-view-name' &&
    /Major comparison.*deleted/i.test(document.querySelector('#map-announce')?.textContent || '')
  )), 'saved-view deletion did not announce completion or move focus predictably');

  await page.fill('#saved-view-name', 'Existing view');
  await page.click('#saved-views-manager [data-action="save"]');
  await page.setInputFiles('[data-saved-view-file]', {
    name: 'malformed.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not json'),
  });
  await page.waitForSelector('.saved-view-import-preview');
  assert(
    await page.locator('.saved-view-import-errors code').textContent() === '$' &&
      await page.locator('[data-action="commit-import"]').isDisabled(),
    'malformed saved-view import did not show a field-level error and disable commit',
  );
  await page.click('[data-action="cancel-import"]');

  const transferBody = JSON.stringify({
    schema_version: 1,
    views: [
      { id: 'transfer-existing', name: 'Existing view', hash: '#v=1&y=2004-2005' },
      { id: 'transfer-florida', name: 'Florida majors', hash: '#v=1&s=Florida&c=3%2C4%2C5' },
    ],
  });
  await page.setInputFiles('[data-saved-view-file]', {
    name: 'saved-views.json',
    mimeType: 'application/json',
    buffer: Buffer.from(transferBody),
  });
  await page.waitForFunction(() => (
    [...document.querySelectorAll('.saved-view-import-list li')].some(item => item.textContent === 'Existing view (2)')
  ));
  await assertNoAxeViolations(page, 'saved-view import preview (WCAG 2.2 AA)', '.saved-view-import-preview');
  await page.check('[name="saved-view-import-mode"][value="replace"]');
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll('.saved-view-import-list li')].map(item => item.textContent);
    return names.includes('Existing view') && !names.includes('Existing view (2)');
  });
  await page.click('[data-action="commit-import"]');
  await page.waitForFunction(() => {
    const record = JSON.parse(localStorage.getItem('hm-saved-views-v1'));
    return record.views.length === 2 &&
      record.views[0].name === 'Existing view' &&
      record.views[1].name === 'Florida majors' &&
      document.activeElement?.id === 'saved-view-name';
  });
  await page.waitForFunction(() => /2 saved views imported/i.test(document.querySelector('#map-announce')?.textContent || ''));
  await page.evaluate(() => {
    document.querySelector('#settings-menu')?.hidePopover();
    location.hash = '#v=1';
  });
  await page.waitForFunction(async () => {
    const compare = await import('/src/compare.js');
    const settings = await import('/src/settings.js');
    return compare.getPins().length === 0 &&
      settings.getSetting('windUnit') === 'kt' &&
      settings.getSetting('damageMode') === 'real';
  }, { timeout: 15000 });

  // 2026 cone parity: watch/warning overlay renders zone polygons, the
  // pink/blue hatch pattern, and its legend — exercised against stubbed
  // api.weather.gov responses since active storms are rare in test runs.
  const alertOverlay = await page.evaluate(async () => {
    const alerts = await import('/src/alerts.js');
    const { getMap } = await import('/src/map.js');
    const realFetch = window.fetch;
    window.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/alerts/active')) {
        return new Response(JSON.stringify({ features: [
          { properties: { event: 'Hurricane Warning', geocode: { UGC: ['FLZ151'] } }, geometry: null },
          { properties: { event: 'Hurricane Watch', geocode: { UGC: ['FLZ052'] } }, geometry: null },
          { properties: { event: 'Tropical Storm Warning', geocode: { UGC: ['FLZ052'] } }, geometry: null },
        ] }), { status: 200 });
      }
      if (u.includes('/zones/forecast/FLZ151')) {
        return new Response(JSON.stringify({ geometry: { type: 'Polygon', coordinates: [[[-82, 27], [-81, 27], [-81, 28], [-82, 27]]] } }), { status: 200 });
      }
      if (u.includes('/zones/forecast/FLZ052')) {
        return new Response(JSON.stringify({ geometry: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', coordinates: [[[-83, 28], [-82, 28], [-82, 29], [-83, 28]]] }] } }), { status: 200 });
      }
      return realFetch(url, init);
    };
    try {
      const result = await alerts.renderTropicalAlerts([{ id: 'AL012026', name: 'TEST' }], { map: getMap(), enabled: true, force: true });
      const legend = document.querySelector('#tropical-alert-legend');
      const snapshot = {
        ...result,
        paths: document.querySelectorAll('path.tropical-alert').length,
        hatch: !!document.querySelector('#hm-ww-hatch'),
        legendText: legend && !legend.hidden ? legend.textContent : '',
      };
      alerts.clearTropicalAlerts();
      return snapshot;
    } finally {
      window.fetch = realFetch;
    }
  });
  assert(alertOverlay.status === 'rendered' && alertOverlay.zoneCount === 2, `watch/warning overlay did not render: ${JSON.stringify(alertOverlay)}`);
  assert(alertOverlay.paths >= 2, `expected zone polygons in the SVG pane, got ${alertOverlay.paths}`);
  assert(alertOverlay.hatch, 'pink/blue hatch pattern was not installed in the map SVG defs');
  assert(/Hurricane Warning/.test(alertOverlay.legendText) && /Hurricane Watch \+ Tropical Storm Warning/.test(alertOverlay.legendText), `alert legend incomplete: ${alertOverlay.legendText}`);

  // Operational NHC product parity: the near-zero formation style renders as
  // a gray X and the opt-in marine feed produces warning polygons + legend.
  const operationalLayers = await page.evaluate(async () => {
    const outlook = await import('/src/outlook.js');
    const marine = await import('/src/marine-warnings.js');
    const { getMap } = await import('/src/map.js');
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><styleUrl>#zerox</styleUrl><ExtendedData><Data name="Disturbance"><value>1</value></Data><Data name="2day_percentage"><value>Near 0%</value></Data><Data name="2day_category"><value>NearZero</value></Data><Data name="7day_percentage"><value>Near 0%</value></Data><Data name="7day_category"><value>NearZero</value></Data></ExtendedData><Point><coordinates>-70,20,0</coordinates></Point></Placemark></Document></kml>`;
    const marineKml = `<?xml version="1.0"?><kml><Document><Placemark><name>Hurricane force possible</name><styleUrl>#high</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>-75,25 -74,25 -74,26 -75,25</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const storedZip = (filename, contents) => {
      const name = new TextEncoder().encode(filename);
      const data = new TextEncoder().encode(contents);
      const local = new Uint8Array(30 + name.length + data.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      central.set(name, 46);
      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      endView.setUint32(0, 0x06054b50, true);
      endView.setUint16(8, 1, true);
      endView.setUint16(10, 1, true);
      endView.setUint32(12, central.length, true);
      endView.setUint32(16, local.length, true);
      const zip = new Uint8Array(local.length + central.length + end.length);
      zip.set(local);
      zip.set(central, local.length);
      zip.set(end, local.length + central.length);
      return zip;
    };
    const kmz = storedZip('doc.kml', kml);
    const realFetch = window.fetch;
    window.fetch = async url => String(url).includes('/nhc/outlook/')
      ? new Response(kmz, { status: 200 })
      : String(url).includes('/nhc/marine/')
        ? new Response(marineKml, { status: 200 })
        : realFetch(url);
    try {
      const [outlookResult, marineResult] = await Promise.all([
        outlook.renderTropicalOutlook({ map: getMap(), enabled: true, force: true }),
        marine.renderMarineWarnings({ map: getMap(), enabled: true, force: true }),
      ]);
      const grayX = document.querySelector('.nhc-outlook-x--near-zero');
      const marineLegend = document.querySelector('#marine-warning-legend');
      const snapshot = {
        outlookResult,
        marineResult,
        grayX: grayX ? getComputedStyle(grayX).color : '',
        marinePaths: document.querySelectorAll('path.marine-warning-zone').length,
        marineLegend: marineLegend && !marineLegend.hidden ? marineLegend.textContent : '',
      };
      outlook.clearTropicalOutlook();
      marine.clearMarineWarnings();
      return snapshot;
    } finally {
      window.fetch = realFetch;
    }
  });
  assert(operationalLayers.outlookResult.status === 'rendered' && operationalLayers.outlookResult.pointCount === 3, `outlook overlay did not render: ${JSON.stringify(operationalLayers)}`);
  assert(operationalLayers.grayX === 'rgb(147, 153, 178)', `near-zero outlook X was not gray: ${operationalLayers.grayX}`);
  assert(operationalLayers.marineResult.status === 'rendered' && operationalLayers.marineResult.polygonCount === 2, `marine warning overlay did not render: ${JSON.stringify(operationalLayers)}`);
  assert(operationalLayers.marinePaths >= 2 && /High/.test(operationalLayers.marineLegend), `marine warning rendering incomplete: ${JSON.stringify(operationalLayers)}`);
  // Synthetic ErrorEvent exercises the listener + toast without registering
  // as a real uncaught error (which would trip the pageerror assertions).
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'hm-smoke-synthetic-error', filename: 'smoke.js' }));
  });
  await page.waitForFunction(() => {
    const toast = document.querySelector('.hm-toast--warn.is-visible');
    return !!toast && /Something went wrong/.test(toast.textContent || '');
  }, { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('.hm-toast--warn'), { timeout: 10000 });

  await assertNoAxeViolations(page, 'main view (WCAG 2.2 AA)');

  await openKatrinaPanel(page);
  await page.waitForFunction(() => /Est\. exposure/.test(document.querySelector('#storm-panel .stat-grid')?.textContent || ''), { timeout: 10000 });
  await assertNoAxeViolations(page, 'storm panel (WCAG 2.2 AA)', '#storm-panel');
  const exposureText = await page.textContent('#storm-panel .stat-grid');
  assert(/Est\. exposure/.test(exposureText) && /Cat-2\+ winds/.test(exposureText), `Katrina exposure metric did not render: ${exposureText}`);
  // Live permalink navigation: assigning a new hash in an open tab must
  // apply it without a reload (hashchange listener).
  await page.evaluate(() => { location.hash = '#storm=AL092022'; });
  await page.waitForFunction(() => {
    const header = document.querySelector('#panel-sticky-header')?.textContent || '';
    return /Ian \(2022\)/i.test(header) && /AL092022/.test(header);
  }, { timeout: 15000 });
  await page.evaluate(() => { location.hash = '#storm=AL122005'; });
  await page.waitForFunction(() => {
    const header = document.querySelector('#panel-sticky-header')?.textContent || '';
    return /Katrina \(2005\)/i.test(header) && /AL122005/.test(header);
  }, { timeout: 15000 });
  await page.waitForFunction(() => {
    const impacts = document.querySelector('#storm-panel .impacts-block')?.textContent || '';
    return /Est\. exposure/.test(document.querySelector('#storm-panel .stat-grid')?.textContent || '') &&
      /Billion-dollar disaster/.test(impacts) && /201\.3/.test(impacts.replace(/ /g, ' ')) && /1,833 deaths/.test(impacts);
  }, { timeout: 10000 });

  const impactsText = await page.textContent('#storm-panel .impacts-block');
  assert(/Billion-dollar disaster/.test(impactsText) && /\$201\.3B|\$201,297|201\.3/.test(impactsText.replace(/ /g, ' ')), `Katrina NCEI billion-dollar row did not render: ${impactsText}`);
  assert(/1,833 deaths/.test(impactsText), `Katrina NCEI deaths did not render: ${impactsText}`);

  await page.check('#cone-retro-enabled');
  await page.waitForFunction(() => document.querySelector('path.cone-retro-shape--circle') && /Cone drawn/.test(document.querySelector('#cone-retro-status')?.textContent || ''), { timeout: 10000 });
  const circleConePath = await page.getAttribute('path.cone-retro-shape--circle', 'd');
  await page.selectOption('#cone-retro-era', '2026');
  await page.check('#cone-retro-ellipse');
  await page.waitForFunction(() => document.querySelector('path.cone-retro-shape--ellipse') && /2026/.test(document.querySelector('#cone-retro-legend')?.textContent || ''), { timeout: 10000 });
  const ellipseCone = await page.evaluate(() => ({
    path: document.querySelector('path.cone-retro-shape--ellipse')?.getAttribute('d') || '',
    legend: document.querySelector('#cone-retro-legend')?.textContent || '',
    explainer: document.querySelector('.cone-retro-control p')?.textContent || '',
  }));
  assert(circleConePath && ellipseCone.path && circleConePath !== ellipseCone.path, 'ellipse mode did not redraw the retrospective cone geometry');
  assert(/illustrative ellipse/.test(ellipseCone.legend), `retrospective cone legend did not identify ellipse mode: ${ellipseCone.legend}`);
  assert(/not a historical forecast/i.test(ellipseCone.explainer) && /outside any cone/i.test(ellipseCone.explainer), `retrospective cone explainer is incomplete: ${ellipseCone.explainer}`);
  await page.uncheck('#cone-retro-enabled');
  await page.waitForFunction(() => !document.querySelector('path.cone-retro-shape'), { timeout: 5000 });

  // Katrina predates the archived-advisory era, so the replay must say so and
  // release its own control rather than sitting enabled over an empty map.
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => /No archived advisories/.test(document.querySelector('#advisory-replay-status')?.textContent || ''),
    { timeout: 10000 },
  );
  const outsideEra = await page.evaluate(() => ({
    checked: document.querySelector('#advisory-replay-enabled')?.checked,
    stepsHidden: document.querySelector('#advisory-replay-steps')?.hidden,
    status: document.querySelector('#advisory-replay-status')?.textContent || '',
    shapes: document.querySelectorAll('path.advisory-forecast-line, path.advisory-cone-shape').length,
  }));
  assert(outsideEra.checked === false, 'advisory replay stayed enabled for a storm it cannot replay');
  assert(outsideEra.stepsHidden === true, 'advisory replay left its stepper visible with no advisories');
  assert(outsideEra.shapes === 0, 'advisory replay drew geometry for a storm outside the archived era');
  assert(/2015-2024/.test(outsideEra.status), `advisory replay did not name its covered era: ${outsideEra.status}`);

  for (const stormId of ['AL022024', 'AL132020', 'AL142024', 'AL092022', 'AL092017']) {
    await assertAdvisoryForecastInViewport(page, stormId);
  }
  await assertThemeContrastMatrix(page, { checkMapOverlays: true });

  // The ingester retains the count of OFCL forecasts that continue after the
  // numbered NHC advisory series. That provenance must be visible only for
  // storms whose archive actually has such a post-tropical tail.
  await openStormPanel(page, 'AL092021');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => /post-tropical stage/i.test(document.querySelector('#advisory-replay-provenance')?.textContent || ''),
    { timeout: 15000 },
  );
  const idaProvenance = await page.textContent('#advisory-replay-provenance');
  assert(/10/.test(idaProvenance), `Ida replay did not report its ten post-tropical forecasts: ${idaProvenance}`);

  await openStormPanel(page, 'AL132020');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => /post-tropical stage/i.test(document.querySelector('#advisory-replay-provenance')?.textContent || ''),
    { timeout: 15000 },
  );
  const lauraProvenance = await page.textContent('#advisory-replay-provenance');
  assert(/5/.test(lauraProvenance), `Laura replay did not report its five post-tropical forecasts: ${lauraProvenance}`);

  await openStormPanel(page, 'AL142024');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), { timeout: 15000 });
  assert((await page.textContent('#advisory-replay-provenance')) === '', 'a complete replay incorrectly showed a provenance note');

  // Harvey exercises the expanded historical era: the replay record must carry
  // the annual 2017 NHC cone table rather than falling back to the 2025 pool.
  await openStormPanel(page, 'AL092017');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-cone-shape'), { timeout: 15000 });
  const harveyConeEra = await page.evaluate(async () => {
    const archive = await (await fetch('/data/advisories.json')).json();
    return archive.storms.AL092017?.coneEra || null;
  });
  assert(harveyConeEra === '2017', `historical replay did not retain its annual cone era: ${harveyConeEra}`);

  // Ian is inside the era: the issued forecast, its cone, and the best track it
  // is compared against must all render, and stepping must change the geometry.
  await openStormPanel(page, 'AL092022');
  // The helper above renders the lazy panel directly; synchronize the shell's
  // permalink owner before exercising replay URL updates.
  await page.evaluate(() => { location.hash = '#v=1&storm=AL092022'; });
  await page.waitForFunction(
    () => /Ian \(2022\)/i.test(document.querySelector('#panel-sticky-header')?.textContent || '') &&
      document.querySelector('#advisory-replay-enabled'),
    { timeout: 15000 },
  );
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => document.querySelector('path.advisory-forecast-line') && document.querySelector('path.advisory-cone-shape'),
    { timeout: 15000 },
  );
  const firstAdvisory = await page.evaluate(() => ({
    meta: document.querySelector('#advisory-replay-meta')?.textContent || '',
    status: document.querySelector('#advisory-replay-status')?.textContent || '',
    discussion: document.querySelector('#advisory-replay-discussion a')?.href || '',
    forecastPath: document.querySelector('path.advisory-forecast-line')?.getAttribute('d') || '',
    actualPath: document.querySelector('path.advisory-actual-line')?.getAttribute('d') || '',
    prevDisabled: document.querySelector('#advisory-replay-prev')?.disabled,
    points: document.querySelectorAll('path.advisory-forecast-point').length,
  }));
  assert(/Advisory 1 of \d+/.test(firstAdvisory.meta), `advisory replay did not report its position: ${firstAdvisory.meta}`);
  assert(firstAdvisory.prevDisabled === true, 'advisory replay allowed stepping before the first advisory');
  assert(firstAdvisory.points > 0, 'advisory replay drew no forecast positions');
  assert(
    /^https:\/\/www\.nhc\.noaa\.gov\/archive\/2022\/al09\/al092022\.discus\.\d{3}\.shtml$/.test(firstAdvisory.discussion),
    `advisory replay discussion link is not an archived NHC product: ${firstAdvisory.discussion}`,
  );
  await page.click('#advisory-replay-next');
  await page.waitForFunction(
    previous => document.querySelector('path.advisory-forecast-line')?.getAttribute('d') !== previous,
    firstAdvisory.forecastPath,
    { timeout: 10000 },
  );
  const secondAdvisory = await page.evaluate(() => ({
    meta: document.querySelector('#advisory-replay-meta')?.textContent || '',
    status: document.querySelector('#advisory-replay-status')?.textContent || '',
    scrubber: document.querySelector('#advisory-replay-scrubber')?.value || '',
    actualPath: document.querySelector('path.advisory-actual-line')?.getAttribute('d') || '',
  }));
  assert(/Advisory 2 of \d+/.test(secondAdvisory.meta), `stepping did not advance the advisory: ${secondAdvisory.meta}`);
  assert(secondAdvisory.scrubber === '1', `stepping did not move the scrubber: ${secondAdvisory.scrubber}`);
  assert(
    /Verified at \d+ leads/.test(secondAdvisory.status) || /No best-track point/.test(secondAdvisory.status),
    `advisory replay reported no verification outcome: ${secondAdvisory.status}`,
  );
  assert(
    firstAdvisory.actualPath && secondAdvisory.actualPath,
    'advisory replay never drew the best track it compares against',
  );
  await page.waitForFunction(
    () => /(?:^|&)replay=1\.AL092022\.1\.2025(?:&|$)/.test(location.hash),
    { timeout: 5000 },
  );
  const replayShareHash = await page.evaluate(() => location.hash);
  assert(
    replayShareHash.includes('storm=AL092022') && replayShareHash.includes('replay=1.AL092022.1.2025'),
    `advisory replay share state was not canonical: ${replayShareHash}`,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('#storm-panel')?.hidden === false &&
      document.querySelector('#advisory-replay-enabled')?.checked === true &&
      /Advisory 2 of/.test(document.querySelector('#advisory-replay-meta')?.textContent || ''),
    { timeout: 20000 },
  );
  const restoredReplay = await page.evaluate(() => ({
    hash: location.hash,
    checked: document.querySelector('#advisory-replay-enabled')?.checked,
    meta: document.querySelector('#advisory-replay-meta')?.textContent || '',
    forecast: document.querySelectorAll('path.advisory-forecast-line').length,
    actual: document.querySelectorAll('path.advisory-actual-line').length,
  }));
  assert(restoredReplay.checked && /Advisory 2 of/.test(restoredReplay.meta), `shared replay did not restore: ${JSON.stringify(restoredReplay)}`);
  assert(restoredReplay.forecast > 0 && restoredReplay.actual > 0, 'shared replay lost forecast/actual geometry after reload');
  await page.evaluate(() => {
    location.hash = '#v=1&storm=AL092022&replay=1.AL092022.1000.2025';
  });
  await page.waitForFunction(
    () => document.querySelector('#advisory-replay-enabled')?.checked === false &&
      document.querySelectorAll('path.advisory-forecast-line').length === 0,
    { timeout: 15000 },
  );
  assert(
    await page.evaluate(() => !location.hash.includes('replay=1.AL092022.1000.2025')),
    'malformed replay state remained active after navigation',
  );
  await page.evaluate(hash => { location.hash = hash; }, replayShareHash);
  await page.waitForFunction(
    () => document.querySelector('#advisory-replay-enabled')?.checked === true &&
      /Advisory 2 of/.test(document.querySelector('#advisory-replay-meta')?.textContent || ''),
    { timeout: 15000 },
  );
  await page.locator('#advisory-replay-scrubber').evaluate(element => {
    element.value = element.max;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const scrubber = document.querySelector('#advisory-replay-scrubber');
    return scrubber?.value === scrubber?.max && scrubber?.getAttribute('aria-valuenow') === scrubber?.max;
  }, { timeout: 10000 });
  const finalAdvisory = await page.evaluate(() => {
    const scrubber = document.querySelector('#advisory-replay-scrubber');
    const meta = document.querySelector('#advisory-replay-meta')?.textContent || '';
    const match = meta.match(/Advisory\s+(\d+)\s+of\s+(\d+)/i);
    return {
      ariaValueNow: Number(scrubber?.getAttribute('aria-valuenow')),
      min: Number(scrubber?.min),
      max: Number(scrubber?.max),
      meta,
      position: match ? [Number(match[1]), Number(match[2])] : null,
    };
  });
  assert(
    finalAdvisory.position && finalAdvisory.position[0] <= finalAdvisory.position[1],
    `final advisory replay position is out of order: ${JSON.stringify(finalAdvisory)}`,
  );
  assert(
    finalAdvisory.ariaValueNow >= finalAdvisory.min && finalAdvisory.ariaValueNow <= finalAdvisory.max,
    `final advisory replay aria value is outside its range: ${JSON.stringify(finalAdvisory)}`,
  );
  await page.uncheck('#advisory-replay-enabled');
  await page.waitForFunction(() => !document.querySelector('path.advisory-forecast-line'), { timeout: 5000 });
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), { timeout: 10000 });
  await page.check('#cone-retro-enabled');
  await page.waitForFunction(() => document.querySelector('path.cone-retro-shape'), { timeout: 10000 });
  await page.check('#art-mode-enabled');
  await page.waitForFunction(() => document.querySelector('path.art-risk-path'), { timeout: 10000 });
  await page.click('#toggle-stats');
  await page.waitForFunction(() => (
    document.querySelector('#storm-panel')?.hidden === true &&
    document.querySelector('#stats-panel')?.hidden === false
  ), { timeout: 10000 });
  const orphanedOverlays = await page.evaluate(() => ({
    stormHidden: document.querySelector('#storm-panel')?.hidden,
    conePaths: document.querySelectorAll('path.cone-retro-shape').length,
    artPaths: document.querySelectorAll('path.art-risk-path').length,
    advisoryPaths: document.querySelectorAll('path.advisory-forecast-line').length,
    coneLegendVisible: Boolean(document.querySelector('#cone-retro-legend') && !document.querySelector('#cone-retro-legend').hidden),
    artLegendVisible: Boolean(document.querySelector('#art-mode-legend') && !document.querySelector('#art-mode-legend').hidden),
  }));
  assert(
    orphanedOverlays.stormHidden && orphanedOverlays.conePaths === 0 && orphanedOverlays.artPaths === 0 && orphanedOverlays.advisoryPaths === 0 && !orphanedOverlays.coneLegendVisible && !orphanedOverlays.artLegendVisible,
    `storm overlays survived opening Statistics: ${JSON.stringify(orphanedOverlays)}`,
  );
  await openKatrinaPanel(page);

  await page.check('#art-mode-enabled');
  await page.waitForFunction(() => document.querySelectorAll('path.art-risk-path--animated').length === 20 && /20 plausible paths/.test(document.querySelector('#art-mode-status')?.textContent || ''), { timeout: 5000 });
  const animatedRisk = await page.evaluate(() => ({
    pathCount: document.querySelectorAll('path.art-risk-path').length,
    animationName: getComputedStyle(document.querySelector('path.art-risk-path')).animationName,
    legend: document.querySelector('#art-mode-legend')?.textContent || '',
    explainer: document.querySelector('.art-mode-control p')?.textContent || '',
  }));
  assert(animatedRisk.pathCount === 20 && animatedRisk.animationName === 'art-risk-flow', `risk trajectories did not animate: ${JSON.stringify(animatedRisk)}`);
  assert(/educational possibilities/i.test(animatedRisk.explainer) && /not forecasts/i.test(animatedRisk.explainer), `risk trajectory explainer is incomplete: ${animatedRisk.explainer}`);

  await page.uncheck('#art-mode-enabled');
  await page.evaluate(async () => {
    const settings = await import('/src/settings.js');
    settings.setSetting('reducedMotion', true);
  });
  await page.check('#art-mode-enabled');
  await page.waitForFunction(() => document.querySelectorAll('path.art-risk-path--static').length === 20 && /without animation/.test(document.querySelector('#art-mode-status')?.textContent || ''), { timeout: 5000 });
  const reducedRisk = await page.evaluate(() => ({
    animationName: getComputedStyle(document.querySelector('path.art-risk-path--static')).animationName,
    legend: document.querySelector('#art-mode-legend')?.textContent || '',
  }));
  assert(reducedRisk.animationName === 'none' && /Animation paused/.test(reducedRisk.legend), `risk trajectories ignored reduced motion: ${JSON.stringify(reducedRisk)}`);
  await page.uncheck('#art-mode-enabled');
  await page.evaluate(async () => {
    const settings = await import('/src/settings.js');
    settings.setSetting('reducedMotion', false);
  });

  await page.click('#toggle-settings');
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'), { timeout: 5000 });
  await page.hover('#toggle-stats');
  await page.waitForFunction(() => {
    const tooltip = document.querySelector('#header-tooltip');
    return tooltip?.matches(':popover-open') || tooltip?.hasAttribute('data-fallback-open');
  }, { timeout: 5000 });
  const anchoredPopovers = await page.evaluate(() => {
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const settings = document.querySelector('#settings-menu');
    const cog = document.querySelector('#toggle-settings');
    const tooltip = document.querySelector('#header-tooltip');
    const stats = document.querySelector('#toggle-stats');
    return {
      anchorSupported: tooltip.dataset.anchorPositioning === 'true',
      hintState: tooltip.getAttribute('popover'),
      tooltipText: tooltip.textContent || '',
      settingsOpen: settings.matches(':popover-open'),
      tooltipOpen: tooltip.matches(':popover-open') || tooltip.hasAttribute('data-fallback-open'),
      settings: rect(settings),
      cog: rect(cog),
      tooltip: rect(tooltip),
      stats: rect(stats),
    };
  });
  assert(anchoredPopovers.hintState === 'hint' && /Statistics/.test(anchoredPopovers.tooltipText), `hint tooltip state is wrong: ${JSON.stringify(anchoredPopovers)}`);
  assert(anchoredPopovers.settingsOpen && anchoredPopovers.tooltipOpen, 'opening a hint tooltip closed the settings auto popover');
  if (anchoredPopovers.anchorSupported) {
    const tooltipCenter = (anchoredPopovers.tooltip.left + anchoredPopovers.tooltip.right) / 2;
    const statsCenter = (anchoredPopovers.stats.left + anchoredPopovers.stats.right) / 2;
    assert(Math.abs(tooltipCenter - statsCenter) < 3 && Math.abs(anchoredPopovers.tooltip.top - anchoredPopovers.stats.bottom - 8) < 3, `tooltip is not anchor-positioned: ${JSON.stringify(anchoredPopovers)}`);
    assert(Math.abs(anchoredPopovers.settings.top - anchoredPopovers.cog.bottom - 8) < 3 && Math.abs(anchoredPopovers.settings.right - anchoredPopovers.cog.right) < 3, `settings flyout is not anchor-positioned: ${JSON.stringify(anchoredPopovers)}`);
  }
  if (process.env.HM_PLATFORM_SCREENSHOT) {
    await page.screenshot({ path: process.env.HM_PLATFORM_SCREENSHOT });
  }
  await page.mouse.move(12, 980);
  await page.waitForFunction(() => {
    const tooltip = document.querySelector('#header-tooltip');
    return !tooltip.matches(':popover-open') && !tooltip.hasAttribute('data-fallback-open');
  }, { timeout: 5000 });
  assert(await page.getAttribute('#toggle-stats', 'title') === 'Statistics', 'tooltip fallback did not restore the native title');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#settings-menu')?.matches(':popover-open'), { timeout: 5000 });
  const afterSettingsEscape = await page.evaluate(() => ({
    stormPanelHidden: document.querySelector('#storm-panel')?.hidden,
    yearMin: document.querySelector('#year-min')?.value,
    yearMax: document.querySelector('#year-max')?.value,
  }));
  assert(afterSettingsEscape.stormPanelHidden === false, 'Escape while settings was open also closed the storm panel.');

  await clickHeaderAction(page, '#toggle-prep');
  await page.waitForSelector('#prep-panel:not([hidden]) #prep-household');
  await page.waitForFunction(() => document.activeElement?.id === 'prep-panel-title', { timeout: 5000 });
  await page.focus('[data-prep-item="water"]');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-prep-item="water"]')?.checked === true);
  const checklistFocus = await page.evaluate(() => ({
    checked: document.querySelector('[data-prep-item="water"]')?.checked,
    focused: document.activeElement?.dataset?.prepItem || '',
  }));
  assert(checklistFocus.checked === true && checklistFocus.focused === 'water', `preparedness checkbox lost focus: ${JSON.stringify(checklistFocus)}`);
  await page.keyboard.press('Space');
  await page.focus('#prep-household');
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowUp');
  const householdFocus = await page.evaluate(() => ({
    value: document.querySelector('#prep-household')?.value || '',
    focused: document.activeElement?.id || '',
  }));
  assert(householdFocus.value === '6' && householdFocus.focused === 'prep-household', `preparedness household input lost focus: ${JSON.stringify(householdFocus)}`);
  await page.fill('#prep-household', '4');
  await page.dispatchEvent('#prep-household', 'change');
  await page.selectOption('#prep-mode', 'home');
  await page.check('[data-prep-item="water"]');
  await page.check('[data-prep-item="food"]');
  const prepState = await page.evaluate(() => ({
    text: document.querySelector('#prep-body')?.textContent || '',
    completed: document.querySelector('.prep-progress')?.getAttribute('aria-valuenow'),
    stored: JSON.parse(localStorage.getItem('hm-prep-v1') || 'null'),
  }));
  assert(/56\s*gallons of water/.test(prepState.text) && /56\s*person-days of food/.test(prepState.text), `preparedness calculator totals are wrong: ${prepState.text}`);
  assert(
    prepState.completed === '2' &&
      prepState.stored?.schema_version === 1 &&
      prepState.stored?.state?.household === 4 &&
      prepState.stored?.state?.mode === 'home',
    `preparedness progress did not persist: ${JSON.stringify(prepState)}`,
  );
  await page.click('#close-prep');
  await clickHeaderAction(page, '#toggle-prep');
  await page.waitForFunction(() => document.querySelector('#prep-household')?.value === '4' && document.querySelector('[data-prep-item="water"]')?.checked, { timeout: 5000 });
  const prepLocales = await page.evaluate(async () => {
    const i18n = await import('/src/i18n.js');
    const prep = await import('/src/prep.js');
    i18n.setLocale('es');
    prep.renderPrepPanel();
    const es = document.querySelector('#prep-body')?.textContent || '';
    i18n.setLocale('ht');
    prep.renderPrepPanel();
    const ht = document.querySelector('#prep-body')?.textContent || '';
    i18n.setLocale('en');
    prep.renderPrepPanel();
    return { es, ht };
  });
  assert(/Calculadora de suministros/.test(prepLocales.es) && /Lista de suministros/.test(prepLocales.es), 'Spanish preparedness surface did not render');
  assert(/Kalkilatris pwovizyon/.test(prepLocales.ht) && /Lis pwovizyon/.test(prepLocales.ht), 'Haitian Creole preparedness surface did not render');
  await assertNoAxeViolations(page, 'preparedness panel (WCAG 2.2 AA)', '#prep-panel');
  await page.click('#prep-reset');
  await page.click('#confirm-local-action .confirm-action-cancel');
  await page.waitForFunction(() => document.activeElement?.id === 'prep-reset');
  assert(await page.evaluate(() => (
    JSON.parse(localStorage.getItem('hm-prep-v1')).state.checked.length === 2 &&
    document.activeElement?.id === 'prep-reset'
  )), 'cancelling preparedness reset changed data or lost focus');
  await page.click('#prep-reset');
  await page.click('#confirm-local-action .confirm-action-submit');
  await page.waitForFunction(() => (
    JSON.parse(localStorage.getItem('hm-prep-v1')).state.checked.length === 0 &&
    document.activeElement?.id === 'prep-reset'
  ));
  await page.waitForFunction(() => /items cleared/i.test(document.querySelector('#map-announce')?.textContent || ''), { timeout: 5000 });
  const prepReset = await page.evaluate(() => ({
    state: JSON.parse(localStorage.getItem('hm-prep-v1')).state,
    focused: document.activeElement?.id,
    announcement: document.querySelector('#map-announce')?.textContent || '',
  }));
  assert(
    prepReset.state.checked.length === 0 &&
      prepReset.state.household === 4 &&
      prepReset.state.mode === 'home' &&
      prepReset.focused === 'prep-reset' &&
      /items cleared/i.test(prepReset.announcement),
    `preparedness reset was not scoped and recoverable: ${JSON.stringify(prepReset)}`,
  );
  await page.click('#close-prep');

  let evacServiceDown = false;
  await page.route('https://geocode.arcgis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ candidates: [{
      address: '1100 Washington Ave, Miami Beach, Florida',
      location: { x: -80.1332, y: 25.7823 },
      attributes: { Region: 'FL', Match_addr: '1100 Washington Ave, Miami Beach, Florida' },
    }] }),
  }));
  await page.route('https://services.arcgis.com/**', route => {
    if (evacServiceDown) return route.fulfill({ status: 503, body: 'unavailable' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ features: [{ attributes: {
        EZone: 'B', County_Nam: 'MIAMI-DADE', STATUS: '', Edit_Date: '7/17/2013',
        EM_Web: 'https://www.miamidade.gov/global/emergency/home.page',
      } }] }),
    });
  });
  await clickHeaderAction(page, '#toggle-evac');
  await page.waitForSelector('#evac-panel:not([hidden]) #evac-address-input');
  await page.fill('#evac-address-input', '1100 Washington Ave, Miami Beach, FL');
  await page.click('#evac-address-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.evac-zone-badge strong')?.textContent === 'B', { timeout: 5000 });
  const evacAddressResult = await page.textContent('#evac-result');
  assert(/MIAMI-DADE/.test(evacAddressResult) && /not an evacuation order/i.test(evacAddressResult), `address zone result is incomplete: ${evacAddressResult}`);
  assert(await page.getAttribute('#evac-result a', 'href') === 'https://www.floridadisaster.org/knowyourzone/', 'zone result did not link to official Florida verification');

  await page.click('#evac-map-pick');
  await page.evaluate(async () => {
    const { getMap } = await import('/src/map.js');
    getMap().fire('click', { latlng: { lat: 25.7617, lng: -80.1918 } });
  });
  await page.waitForFunction(() => /Selected map point/.test(document.querySelector('#evac-result')?.textContent || ''), { timeout: 5000 });
  assert(await page.locator('.evac-location-marker').count() === 1, 'map zone lookup did not mark the selected point');

  evacServiceDown = true;
  await page.fill('#evac-address-input', '1100 Washington Ave, Miami Beach, FL');
  await page.click('#evac-address-form button[type="submit"]');
  await page.waitForFunction(() => /unavailable right now/i.test(document.querySelector('#evac-result')?.textContent || ''), { timeout: 5000 });
  const evacFallback = await page.evaluate(() => ({
    links: [...document.querySelectorAll('.evac-linkouts a')].map(link => link.textContent.trim()),
    floridaHref: document.querySelector('.evac-linkouts a')?.href || '',
  }));
  assert(evacFallback.links.length === 4 && evacFallback.links.includes('Virginia'), `service failure did not preserve state link-outs: ${JSON.stringify(evacFallback)}`);
  assert(evacFallback.floridaHref === 'https://www.floridadisaster.org/knowyourzone/', 'failure fallback is missing the official Florida link');
  await assertNoAxeViolations(page, 'evacuation zone panel (WCAG 2.2 AA)', '#evac-panel');
  await page.click('#close-evac');
  assert(await page.locator('.evac-location-marker').count() === 0, 'closing the zone panel left its selection marker on the map');

  await clickHeaderAction(page, '#toggle-poster');
  await page.waitForFunction(() => Number(document.querySelector('#poster-canvas')?.dataset.segmentCount) > 1000, { timeout: 15000 });
  const poster = await page.evaluate(() => {
    const canvas = document.querySelector('#poster-canvas');
    const context = canvas.getContext('2d');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let y = 0; y < canvas.height; y += 60) {
      for (let x = 0; x < canvas.width; x += 60) {
        const offset = (y * canvas.width + x) * 4;
        colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      stormCount: Number(canvas.dataset.stormCount),
      segmentCount: Number(canvas.dataset.segmentCount),
      attribution: canvas.dataset.attribution || '',
      colorCount: colors.size,
      label: canvas.getAttribute('aria-label') || '',
    };
  });
  assert(poster.width === 1800 && poster.height === 1200, `poster export resolution changed: ${JSON.stringify(poster)}`);
  assert(poster.stormCount === 591 && poster.segmentCount > 10000, `poster did not honor the 591 drawable tracks in the unfiltered storm set: ${JSON.stringify(poster)}`);
  assert(poster.colorCount > 30, `poster canvas lacks rendered visual variation: ${JSON.stringify(poster)}`);
  assert(/NOAA\/NHC HURDAT2/.test(poster.attribution) && /591 storms/.test(poster.label), `poster metadata is incomplete: ${JSON.stringify(poster)}`);
  if (process.env.HM_POSTER_SCREENSHOT) {
    await page.locator('#poster-view').screenshot({ path: process.env.HM_POSTER_SCREENSHOT });
  }
  await assertNoAxeViolations(page, 'track gallery poster (WCAG 2.2 AA)', '#poster-view');
  const [posterDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#poster-export'),
  ]);
  assert(/^HurricaneMap-tracks-1851-2025\.png$/.test(posterDownload.suggestedFilename()), `poster download filename is unstable: ${posterDownload.suggestedFilename()}`);
  assert(await posterDownload.failure() === null, 'poster PNG download failed');
  await page.click('#close-poster');
  await page.waitForFunction(() => document.querySelector('#poster-view')?.hidden && !document.body.classList.contains('poster-open'));
  assert(await page.evaluate(() => document.activeElement?.id === 'toggle-mobile-actions'), 'poster dialog did not return focus to the actions trigger');

  await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const storm = data.getAllStorms().find(item => item.id === 'AL051960');
    if (!storm) throw new Error('Donna 1960 not found');
    const landfall = data.getLandfalls().find(item => item.storm_id === storm.id);
    if (!landfall) throw new Error('Donna 1960 landfall not found');
    await panel.showStorm(landfall);
  });
  await page.waitForSelector('#storm-panel .impacts-block', { timeout: 10000 });
  const impactText = await page.textContent('#storm-panel .impacts-block');
  assert(/Fatalities\s*439/.test(impactText), `normalized fatalities did not render in impact panel: ${impactText}`);
  assert(/Damage/.test(impactText), `damage row did not render in impact panel: ${impactText}`);
  assert(/Confidence:\s*(high|medium|low)/i.test(impactText), `impact confidence did not render: ${impactText}`);
  assert(!/undefined|NaN/.test(impactText), `impact panel contains invalid text: ${impactText}`);

  const missingImpactState = await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    const missing = data.getAllStorms().find(storm =>
      storm.year >= 2000 && !data.getImpactsFor(storm.id) && storm.us_landfalls?.length
    );
    if (!missing) throw new Error('No missing-impact fixture found');
    const landfall = data.getLandfalls().find(item => item.storm_id === missing.id);
    if (!landfall) throw new Error(`No landfall fixture found for ${missing.id}`);
    await panel.showStorm(landfall);
    return {
      stormId: missing.id,
      text: document.querySelector('#storm-panel .impacts-block')?.textContent || '',
    };
  });
  assert(
    /missing means unavailable, not zero/i.test(missingImpactState.text),
    `missing impact state did not distinguish unavailable from zero: ${JSON.stringify(missingImpactState)}`,
  );

  await openStormPanel(page, 'AL032025');
  await page.waitForFunction(() => /No data\s*—\s*series ended 2024/.test(
    document.querySelector('#storm-panel .impacts-block')?.textContent || '',
  ), { timeout: 10000 });
  const closedSeriesText = await page.textContent('#storm-panel .impacts-block');
  assert(
    /No data\s*—\s*series ended 2024/.test(closedSeriesText),
    `closed NCEI series was not distinguished from unavailable data: ${closedSeriesText}`,
  );

  await page.click('#toggle-filters');
  await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'), { timeout: 5000 });
  await page.fill('#year-min', '2005');
  await page.dispatchEvent('#year-min', 'change');
  await page.fill('#year-max', '2005');
  await page.dispatchEvent('#year-max', 'change');
  await page.waitForFunction(() => {
    const host = document.querySelector('#season-summary');
    const ace = document.querySelector('#season-summary [data-role="ace"] .ss-stat-num')?.textContent?.trim();
    return host && !host.hidden && ace && ace !== '...' && ace !== '-' && ace !== '\u2014';
  }, { timeout: 15000 });
  const seasonAce = await page.textContent('#season-summary [data-role="ace"] .ss-stat-num');
  assert(Number.parseFloat(seasonAce) > 0, `season ACE did not compute: ${seasonAce}`);

  await page.click('#toggle-stats');
  await page.waitForSelector('#climatology-chart .clim-legend-item', { timeout: 15000 });
  await page.waitForSelector('#decade-trends-chart .dt-row', { timeout: 15000 });
  await page.waitForSelector('#climate-trends-chart svg', { timeout: 15000 });
  await page.waitForFunction(() => {
    const host = document.querySelector('#impact-coverage-summary');
    return /244 of 595/.test(host?.textContent || '') &&
      host?.querySelectorAll('.impact-coverage-table tbody tr').length > 100;
  }, { timeout: 15000 });
  const stats = await page.evaluate(() => {
    const climatologyText = document.querySelector('#climatology-chart')?.textContent || '';
    const decadeAceValues = [...document.querySelectorAll('#decade-trends-chart .dt-ace')]
      .map(element => Number.parseFloat(element.textContent || '0'))
      .filter(Number.isFinite);
    return {
      climatologyText,
      maxDecadeAce: Math.max(...decadeAceValues, 0),
    };
  });
  assert(/ACE \(Accumulated Cyclone Energy\).*peak\s+[1-9]/s.test(stats.climatologyText), 'climatology ACE peak appears empty or zero.');
  assert(stats.maxDecadeAce > 0, 'decade ACE values did not compute.');

  await page.evaluate(() => {
    window.__exportCapture = { anchors: [], csv: '' };
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob && String(blob.type || '').includes('text/csv')) {
        blob.text().then(text => { window.__exportCapture.csv = text; });
      }
      return originalCreateObjectURL(blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.download) {
        window.__exportCapture.anchors.push({
          download: this.download,
          href: this.href,
          attached: document.body.contains(this),
        });
      }
      return originalClick.call(this);
    };
  });
  await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const compare = await import('/src/compare.js');
    await data.ensureStormsLoaded();
    for (const target of [{ name: 'KATRINA', year: 2005 }, { name: 'ANDREW', year: 1992 }]) {
      const storm = data.getAllStorms().find(item => item.year === target.year && String(item.name).toUpperCase() === target.name);
      if (!storm) throw new Error(`${target.name} ${target.year} not found`);
      if (!compare.isPinned(storm.id)) await compare.togglePin(storm);
    }
  });
  await page.click('#toggle-compare');
  await page.waitForSelector('#cp-export-btn', { timeout: 10000 });
  await page.click('#cp-export-btn');
  await page.waitForFunction(() => window.__exportCapture?.csv?.length > 0, { timeout: 5000 });
  const exportCapture = await page.evaluate(() => window.__exportCapture);
  const csv = exportCapture.csv;
  assert(exportCapture.anchors.length === 1 && exportCapture.anchors[0].attached === true, 'comparison export did not trigger an attached download anchor.');
  assert(csv.includes('Katrina (2005)') && csv.includes('Andrew (1992)'), 'comparison export did not include formatted storm headers.');
  assert(csv.includes('Forward speed (km/h)'), 'comparison export is missing forward speed row.');
  assert(!/undefined|NaN/.test(csv), 'comparison export contains undefined or NaN.');
  assert(/RI risk category,[^\n]*(low|medium|high)/i.test(csv), 'comparison export did not include RI risk categories.');

  await context.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

  // Mobile viewport pass (430x900)
  const mobileContext = await browser.newContext({
    viewport: { width: 430, height: 900 },
    serviceWorkers: 'block',
  });
  await seedSettings(mobileContext, { onboarded: true });
  const mobilePage = await mobileContext.newPage();
  const mobileErrors = [];
  collectPageErrors(mobilePage, mobileErrors);

  await mobilePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(mobilePage);

  const mobileState = await mobilePage.evaluate(() => ({
    visible: document.querySelector('#visible-count')?.textContent || '',
    filtersHidden: document.querySelector('#filters')?.hidden || document.querySelector('#filters')?.offsetWidth === 0,
    mapVisible: document.querySelector('#map')?.offsetWidth > 0,
  }));
  assert(/landfalls/.test(mobileState.visible), `mobile: visible-count did not render: ${mobileState.visible}`);
  assert(mobileState.mapVisible, 'mobile: map is not visible');

  await mobilePage.click('#toggle-filters');
  await mobilePage.waitForFunction(() => {
    const filters = document.querySelector('#filters');
    return filters && !filters.hidden && filters.offsetWidth > 0;
  }, { timeout: 5000 });
  await mobilePage.click('#toggle-filters');

  await mobileContext.close();
  if (mobileErrors.length) throw new Error(`mobile page errors: ${mobileErrors.join(' | ')}`);

  const panelLayoutViewports = [
    { width: 1440, height: 960, desktopPanelAudit: true },
    { width: 1280, height: 900, desktopPanelAudit: true },
    { width: 1120, height: 820 },
    { width: 860, height: 820 },
    { width: 720, height: 900 },
    { width: 640, height: 900 },
    { width: 430, height: 900 },
  ];
  const panelLayoutThemes = [
    { name: 'dark', theme: 'dark', highContrast: false },
    { name: 'light', theme: 'light', highContrast: false },
    { name: 'high-contrast', theme: 'dark', highContrast: true },
  ];
  for (const viewport of panelLayoutViewports) {
    for (const theme of panelLayoutThemes) {
      await runPanelLayoutScenario(browser, baseUrl, {
        ...viewport,
        ...theme,
        playback: viewport.width === 1120 || viewport.width === 430,
        desktopPanelAudit: !!viewport.desktopPanelAudit,
        label: `panel layout ${viewport.width}x${viewport.height} ${theme.name}`,
      });
    }
  }

  await runVisualSnapshotMatrix(browser, baseUrl, { width: 1440, height: 960, name: 'desktop' });
  await runVisualSnapshotMatrix(browser, baseUrl, { width: 390, height: 844, name: 'mobile' });
  await assertManagedPanelFocusContracts(browser, baseUrl);
  await assertLocalizedWorkflowChrome(browser, baseUrl);
  await assertSourceLanguageDisclosures(browser, baseUrl);
  await assertForcedColorsContract(browser, baseUrl);

  await browser.close();

  console.log(`smoke ok (${restored.visible}, 2005 ACE ${seasonAce}, decade ACE max ${stats.maxDecadeAce}, keyboard/focus contracts ok, 21 visual snapshots, panel layout/playback matrix ok)`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
