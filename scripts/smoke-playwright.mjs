import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

// serve.py has no /nhc/ relay, so the app reads active storms and the tropical
// outlook straight from NHC's CORS-open summary MapServer. That service is
// live: whether a storm badge, a cone and outlook markers are on screen would
// otherwise depend on what the Atlantic was doing when the screenshot was
// taken. Every context that compares pixels or counts requests answers it with
// a quiet ocean instead. assertSummaryServiceServesActiveStorms drives the
// populated case from checked-in fixtures.
async function stubQuietTropics(context) {
  await context.route(
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/**',
    route => route.fulfill({
      status: 200,
      contentType: 'application/geo+json',
      body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
    }),
  );
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

// Failing requests the app makes for itself. A 404 is logged by the browser
// whatever the code does with the rejection, so the only way to keep the
// console clean is not to ask. One probe per page load is the floor: a
// deployment cannot be identified without a single request, and every feed
// reads that one answer.
const EXPECTED_FAILED_REQUESTS = 1;

function collectFailedRequests(target, sink) {
  target.on('response', response => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (url.origin !== new URL(target.url() || 'http://127.0.0.1').origin) return;
    sink.push(`${response.status()} ${url.pathname}`);
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

  // Header controls animate their colour over 120ms on a theme change. Sampling
  // after a fixed sleep read a value part-way through that animation whenever
  // the machine was busy, and reported the intermediate colour as a contrast
  // failure: on 2026-09-05 all nine controls failed at rgb(114, 117, 138),
  // which is neither theme's token, and an immediate re-run passed. Contrast is
  // a property of the settled colours, so measure with no animation at all.
  //
  // Scoped to this measurement and removed afterwards: left in place it also
  // collapses the animations that give the mobile filter checkboxes their
  // 44px touch targets, and the next assertion on the same page fails.
  const stillness = await page.addStyleTag({
    content: `*, *::before, *::after {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      animation-duration: 0s !important;
      animation-delay: 0s !important;
    }`,
  });
  try {

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
    // Belt and braces: nothing may still be running when the colours are read.
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

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
      // The header paints through the `background` shorthand with a
      // linear-gradient, which resets background-color to transparent. Reading
      // only background-color composited the header's ink onto the page behind
      // it, so the navy slab the light theme used to keep was measured as if it
      // were the light page.
      const gradientStops = value => {
        const image = String(value || '');
        if (!image.includes('gradient')) return [];
        return (image.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/gi) || []).map(parseColor);
      };
      const surfaceOf = node => {
        const style = getComputedStyle(node);
        const stops = gradientStops(style.backgroundImage);
        // The darkest stop is the one the text has to survive.
        if (stops.length) return stops.reduce((worst, stop) => (luminance(stop) < luminance(worst) ? stop : worst));
        return parseColor(style.backgroundColor);
      };
      const rootStyle = getComputedStyle(document.documentElement);
      const base = parseColor(rootStyle.getPropertyValue('--base'));
      const header = document.querySelector('.app-header');
      const headerBackground = composite(surfaceOf(header), base);
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
      // The rail is 10px text on its own surface, and its ink tokens follow the
      // theme. It kept a hardcoded navy background while they flipped light.
      // The rail is hidden below 720px, where the header takes its place.
      const rail = document.querySelector('.atlas-context-rail');
      const railShown = Boolean(rail) && getComputedStyle(rail).display !== 'none';
      const railBackground = railShown ? composite(surfaceOf(rail), base) : null;
      const railInk = railShown ? [...rail.querySelectorAll('span')].filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (element.textContent || '').trim();
      }).map(element => ({
        id: element.className || 'span',
        color: getComputedStyle(element).color,
        ratio: ratio(composite(parseColor(getComputedStyle(element).color), railBackground), railBackground),
      })) : [];

      return {
        title: [ratio(titleStart, headerBackground), ratio(titleEnd, headerBackground)],
        controls,
        headerLuminance: luminance(headerBackground),
        railLuminance: railShown ? luminance(railBackground) : null,
        railInk,
        railExpected: window.innerWidth > 720,
      };
    });
    const label = `${combination.theme}/${combination.palette}/${combination.highContrast ? 'high-contrast' : 'standard'}`;
    // The surfaces themselves, not only the ink on them. The light theme's
    // header and rail overrides live in the themes layer, and an !important
    // declaration in an earlier layer silently beats them, which is how the
    // header stayed navy under a light UI for five releases with every ink
    // check still passing.
    const surfaces = [['header', audit.headerLuminance], ['context rail', audit.railLuminance]]
      .filter(([, value]) => value !== null);
    assert(
      surfaces.length === (audit.railExpected ? 2 : 1),
      `${label}: expected ${audit.railExpected ? 2 : 1} measured surfaces, got ${surfaces.length}: the rail check proves nothing`,
    );
    for (const [name, value] of surfaces) {
      if (combination.theme === 'light') {
        assert(value >= 0.5, `${label}: the ${name} surface stayed dark under the light theme (luminance ${value.toFixed(3)})`);
      } else {
        assert(value <= 0.2, `${label}: the ${name} surface is not dark under the dark theme (luminance ${value.toFixed(3)})`);
      }
    }
    assert(
      audit.railInk.length >= (audit.railExpected ? 3 : 0),
      `${label}: only ${audit.railInk.length} rail labels were measured`,
    );
    const failedRail = audit.railInk.filter(item => item.ratio < 4.5);
    assert(!failedRail.length, `${label}: context rail text below 4.5:1: ${failedRail.map(item => `${item.id} ${item.ratio.toFixed(2)} (${item.color})`).join(', ')}`);

    assert(Math.min(...audit.title) >= 4.5, `${label}: title contrast ${audit.title.map(value => value.toFixed(2)).join(', ')} is below 4.5:1`);
    const failedControls = audit.controls.filter(control => control.ratio < 4.5);
    assert(!failedControls.length, `${label}: header control contrast below 4.5:1: ${failedControls.map(control => `${control.id} ${control.ratio.toFixed(2)} (${control.color})`).join(', ')}`);
    if (checkMapOverlays) {
      if (!await page.locator('path.advisory-forecast-line').count()) {
        await openStormPanel(page, 'AL142024');
        await page.check('#advisory-replay-enabled');
        await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line') && document.querySelector('path.advisory-actual-line'), null, { timeout: 15000 });
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
  } finally {
    await stillness.evaluate(node => node.remove());
  }
}

// What the comparison panel shows and what it exports have to be the same
// numbers. They are built from one row definition today, but nothing proved
// it, and a divergence here is the one defect class this product cannot
// afford: a reader cites the CSV and quotes the screen.
// The basemap provider can start watermarking keyless tiles without ever
// failing a request: CARTO's dark_all service composites "API KEY REQUIRED"
// into every tile at its CDN edge and still answers HTTP 200, so Leaflet's
// tileerror fallback never fires. Check the pixels, not the status code.
const BASEMAP_TILE_HOST = 'tile.openstreetmap.org';

// The badge is created by the active-storm poll and carries role="status", so
// a mislaid one is announced to screen readers and shown to nobody. Measure
// its box rather than waiting for the feed to reach a state that reveals it.
async function assertActiveBadgeInViewport(page, label) {
  // Attached, not visible: on a deployment without the NHC relay the feed is
  // unsupported and the badge legitimately stays hidden. Its box is still
  // measurable, and its box is what this checks.
  await page.waitForSelector('#active-storm-badge', { state: 'attached', timeout: 20000 });
  const box = await page.evaluate(() => {
    const badge = document.getElementById('active-storm-badge');
    const wasHidden = badge.hidden;
    badge.hidden = false;
    const rect = badge.getBoundingClientRect();
    badge.hidden = wasHidden;
    return {
      position: getComputedStyle(badge).position,
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  assert(box.width > 0 && box.height > 0, `${label}: active-storm badge has no box: ${JSON.stringify(box)}`);
  assert(box.position === 'absolute', `${label}: active-storm badge is positioned ${box.position}, not absolute`);
  assert(
    box.top >= 0 && box.left >= 0 && box.bottom <= box.viewport.height && box.right <= box.viewport.width,
    `${label}: active-storm badge lies outside the viewport: ${JSON.stringify(box)}`,
  );
}

async function assertBasemapNotWatermarked(page) {
  const report = await page.evaluate(async (host) => {
    const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

    // A watermark is sparse near-neutral ink on an otherwise featureless
    // field. Real map tiles fill their whole 256-colour palette; a watermarked
    // CARTO tile quantizes to 15-19 colours yet still carries contrasting grey
    // text, so "nearly flat but lettered" separates the two with room to spare.
    function measure(imageData) {
      const { data } = imageData;
      const total = data.length / 4;
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let modal = 0;
      let modalCount = 0;
      for (const [key, n] of counts) {
        if (n > modalCount) { modalCount = n; modal = key; }
      }
      const modalLum = luminance((modal >> 16) & 255, (modal >> 8) & 255, modal & 255);
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (Math.abs(r - g) > 8 || Math.abs(g - b) > 8 || Math.abs(r - b) > 8) continue;
        if (Math.abs(luminance(r, g, b) - modalLum) < 40) continue;
        ink++;
      }
      const stats = {
        distinctColors: counts.size,
        modalShare: modalCount / total,
        inkShare: ink / total,
      };
      stats.watermarked = stats.modalShare >= 0.5 && stats.distinctColors <= 128 && stats.inkShare > 0.005;
      return stats;
    }

    // Read the tile the visitor is looking at, not a second copy of it: the
    // layer is CORS-loaded so the rendered <img> can go straight to a canvas.
    function measureTile(image) {
      const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return measure(context.getImageData(0, 0, canvas.width, canvas.height));
    }

    // Positive control: the detector must flag a synthetic watermark tile, so
    // a green run means the pixels were read, not that the check went blind.
    const control = new OffscreenCanvas(256, 256);
    const controlContext = control.getContext('2d');
    controlContext.fillStyle = '#262626';
    controlContext.fillRect(0, 0, 256, 256);
    controlContext.fillStyle = '#9a9a9a';
    controlContext.font = 'bold 22px sans-serif';
    controlContext.rotate(-0.5);
    for (let y = 0; y < 420; y += 48) controlContext.fillText('API KEY REQUIRED', -120, y);
    const controlStats = measure(controlContext.getImageData(0, 0, 256, 256));

    const tiles = [...document.querySelectorAll('#map img.leaflet-tile.leaflet-tile-loaded')]
      .filter(image => image.src.startsWith('https://') && image.naturalWidth > 0);
    const hosts = [...new Set(tiles.map(image => new URL(image.src).host))];
    const sampled = tiles.slice(0, 6).map(image => ({ url: image.src, ...measureTile(image) }));
    return { control: controlStats, hosts, tileCount: tiles.length, sampled };
  }, BASEMAP_TILE_HOST);

  assert(report.control.watermarked, `basemap watermark detector failed its own positive control: ${JSON.stringify(report.control)}`);
  assert(report.tileCount > 0, 'no basemap tiles loaded, so the watermark check could not run');
  const flagged = report.sampled.filter(tile => tile.watermarked);
  assert(flagged.length === 0, `basemap tiles carry a watermark: ${JSON.stringify(flagged)}`);
  assert(
    report.hosts.length === 1 && report.hosts[0] === BASEMAP_TILE_HOST,
    `basemap tiles came from an unexpected host: ${report.hosts.join(', ')}`,
  );
}

// The desktop storm panel (>=1121px) is skinned with the --atlas-* tokens, and
// the light theme's overrides for those tokens named only the header, the
// mobile menu and the context rail. The panel kept its dark navy surfaces while
// the ink flipped light, so the title measured 1.01:1 on the white sticky
// header and the biography 1.96:1 on navy. Below 1121px the panel uses
// --surface-panel and reads fine, which is why the mobile baselines stayed
// green and nothing caught it.
async function measureContrast(page, targets) {
  return page.evaluate(selectors => {
      const parse = value => {
        const text = String(value).trim();
        const hex = text.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
        if (hex) {
          const expanded = hex[1].length === 3
            ? [...hex[1]].map(character => character.repeat(2)).join('')
            : hex[1];
          return {
            r: Number.parseInt(expanded.slice(0, 2), 16),
            g: Number.parseInt(expanded.slice(2, 4), 16),
            b: Number.parseInt(expanded.slice(4, 6), 16),
            a: 1,
          };
        }
        // color(srgb r g b / a) gives 0-1 components. Reading them as 0-255
        // makes a white surface measure as near-black, which is a contrast
        // number that looks like a finding. Any color-mix() surface computes
        // to this form.
        const srgb = text.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i);
        if (srgb) {
          return {
            r: Number(srgb[1]) * 255,
            g: Number(srgb[2]) * 255,
            b: Number(srgb[3]) * 255,
            a: srgb[4] === undefined ? 1 : Number(srgb[4]),
          };
        }
        const numbers = text.match(/[\d.]+/g);
        if (!numbers) throw new Error(`Unsupported computed color: ${value}`);
        const [r, g, b, a] = numbers.map(Number);
        return { r, g, b, a: a === undefined ? 1 : a };
      };
      const over = (front, back) => ({
        r: front.r * front.a + back.r * (1 - front.a),
        g: front.g * front.a + back.g * (1 - front.a),
        b: front.b * front.a + back.b * (1 - front.a),
        a: 1,
      });
      const channel = value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = color => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
      const ratio = (a, b) => {
        const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (high + 0.05) / (low + 0.05);
      };
      // The panel and its sticky header paint through the `background`
      // shorthand with a linear-gradient, which resets background-color to
      // transparent. Reading only background-color composited the panel's ink
      // straight onto the page behind it, so a gradient that went dark under
      // light ink would still have measured clean: the exact defect this
      // assertion exists to catch.
      const gradientStops = value => {
        const image = String(value || '');
        if (!image.includes('gradient')) return [];
        return (image.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/gi) || []).map(parse);
      };
      const surfaceOf = node => {
        const style = getComputedStyle(node);
        const stops = gradientStops(style.backgroundImage);
        // The darkest stop is the one the text has to survive.
        if (stops.length) {
          return stops.reduce((worst, stop) => (luminance(stop) < luminance(worst) ? stop : worst));
        }
        return parse(style.backgroundColor);
      };
      // Walk up compositing every translucent background until an opaque one
      // is reached: the panel's ink sits on a tint on a tint.
      const backgroundOf = element => {
        const stack = [];
        for (let node = element; node; node = node.parentElement) {
          const background = surfaceOf(node);
          if (background.a > 0) stack.push(background);
          if (background.a === 1) break;
        }
        let base = { r: 255, g: 255, b: 255, a: 1 };
        for (let index = stack.length - 1; index >= 0; index--) base = over(stack[index], base);
        return base;
      };
      return selectors.map(([name, selector, property = 'color', minimum = null]) => {
        const element = document.querySelector(selector);
        if (!element) return { name, selector, missing: true };
        const style = getComputedStyle(element);
        const background = backgroundOf(element);
        // SVG geometry paints through stroke and fill, and the chart dims its
        // landfall rule with element opacity, which getComputedStyle reports
        // separately from the colour. Reading the colour alone measured a mark
        // 30% more solid than the one on screen.
        const paint = parse(style[property]);
        const elementOpacity = Number(style.opacity);
        if (Number.isFinite(elementOpacity)) paint.a *= elementOpacity;
        const foreground = over(paint, background);
        return { name, selector, minimum, ratio: Number(ratio(foreground, background).toFixed(2)) };
      });
  }, targets);
}

// Both of these carried dark-palette values that stayed put while the ink
// around them flipped light. Neither is on screen by default, and switching
// theme re-renders the panel and stops playback, so this runs per profile and
// does nothing when the surfaces are already there.
// Two surfaces that cannot be on screen together: opening the comparison takes
// the storm panel's place, and #play-anim-btn lives inside that panel. Each is
// therefore staged and measured on its own, and re-staged per theme, because
// switching theme re-renders the panel and stops playback.
async function measurePausedPlaybackContrast(page) {
  await openKatrinaPanel(page);
  await page.evaluate(() => document.querySelector('#play-anim-btn')?.click());
  await page.waitForSelector('.play-anim-btn.is-playing', { state: 'attached', timeout: 10000 });
  await page.evaluate(() => document.querySelector('#play-anim-btn')?.click());
  await page.waitForSelector('.play-anim-btn.is-paused', { state: 'attached', timeout: 10000 });
  return measureContrast(page, [['paused playback button', '.play-anim-btn.is-paused']]);
}

async function measureComparisonHeaderContrast(page) {
  // Opened every time, not only when the header is absent: a hidden panel keeps
  // its markup, and the header's colour is written when the table is rendered,
  // so a stale hidden table would be measured with the previous theme's ink.
  await page.evaluate(async () => {
    const data = await import('/src/data.js');
    const compare = await import('/src/compare.js');
    await data.ensureStormsLoaded();
    for (const id of ['AL122005', 'AL041992']) {
      const storm = data.getAllStorms().find(item => item.id === id);
      if (storm && !compare.isPinned(id)) await compare.togglePin(storm);
    }
    compare.openComparePanel();
  });
  await page.waitForSelector('#compare-panel:not([hidden]) th:nth-child(2)', { timeout: 10000 });
  return measureContrast(page, [['compare column header', '#compare-panel th:nth-child(2)']]);
}

// The intensity chart is drawn as an SVG string inside the storm panel, and the
// panel switches theme under it. Its landfall rule, its label and the
// rapid-intensification overlay carried literal Catppuccin Mocha values, so a
// light-theme reader got a dark-palette pink at 2.31:1 on a white chart. The
// geometry is held to the 3:1 WCAG asks of a non-text graphic; the "L" and the
// RI caption are text and take the profile's own minimum.
const CHART_MARK_TARGETS = [
  ['chart landfall rule', '#storm-panel .intensity-landfall-line', 'stroke', 3],
  ['chart landfall label', '#storm-panel .intensity-landfall-label', 'fill', null],
  ['chart wind line', '#storm-panel .intensity-wind-line', 'stroke', 3],
  ['chart pressure line', '#storm-panel .intensity-pressure-line', 'stroke', 3],
  // Measuring four of seven marks let the RI overlay keep a frozen Mocha pink
  // at 1.96:1 in the light theme with the run still green, and left the grid
  // lines white on white in light high contrast.
  ['chart RI line', '#storm-panel .intensity-ri-line', 'stroke', 3],
  ['chart RI dot', '#storm-panel .intensity-ri-dot', 'fill', 3],
  ['chart RI label', '#storm-panel .intensity-ri-label', 'fill', null],
  // A dashed reference line behind the data is decorative: the axis labels
  // beside it carry the reading, and at 3:1 it would compete with the series.
  // It is held to being drawn at all, because in light high contrast it was
  // white on white at 1.00:1, which is not a faint gridline but a missing one.
  ['chart grid line', '#storm-panel .intensity-grid-line', 'stroke', 1.25],
  ['chart cursor', '#storm-panel .chart-cursor', 'stroke', 3],
  ['chart legend landfall', '#storm-panel .cl-landfall', 'color', null],
];
// Every mark the chart reads a token for. A colour frozen back into the markup
// or the stylesheet stops moving between themes, which a ratio check can miss
// whenever the frozen value happens to pass.
const CHART_THEME_MARKS = [
  ['landfall rule', '.intensity-landfall-line', 'stroke'],
  ['landfall label', '.intensity-landfall-label', 'fill'],
  ['category dot outline', '.chart-dot', 'stroke'],
  ['RI line', '.intensity-ri-line', 'stroke'],
  ['RI dot', '.intensity-ri-dot', 'fill'],
  ['grid line', '.intensity-grid-line', 'stroke'],
  ['cursor', '.chart-cursor', 'stroke'],
  ['wind line', '.intensity-wind-line', 'stroke'],
  ['pressure line', '.intensity-pressure-line', 'stroke'],
  ['legend pressure swatch', '.cl-swatch.pres', 'backgroundImage'],
];

async function assertStormPanelContrast(browser, baseUrl) {
  const targets = [
    ['title', '#storm-panel .storm-panel-header h2'],
    ['biography', '#storm-panel .biography-text'],
    ['stat label', '#storm-panel .stat-grid .label'],
    ['stat value', '#storm-panel .stat-grid .value'],
    ['meta pill', '#storm-panel .meta-row > span:not(.cat-pill)'],
    ['landfall row', '#storm-panel .landfall-list li'],
    ['section heading', '#storm-panel .panel-section-h3'],
    // The timeline footer, which is on screen in every one of these themes and
    // was measured by none of them. Both read --text-dim, which resolved to
    // --overlay and sat at 3.47:1 in dark, 3.54:1 in light and 5.01:1 in light
    // high contrast until 2026-09-09.
    ['timeline source', '.timeline-source'],
    ['timeline legend', '.timeline-legend'],
    // The storm-events card, whose tint is darker than the panel it sits on.
    // Its source credit read 3.47:1 in the light theme and its labels 4.43:1,
    // and the panel's own darker --subtext was tuned against a paler surface.
    ['storm events source', '#storm-panel .se-source'],
    ['storm events label', '#storm-panel .se-label'],
    // Required to be legible by the tile licence, and painted on a 94%-opaque
    // panel over live tiles, so it is the one surface here whose background
    // genuinely moves.
    ['map attribution', '.leaflet-control-attribution'],
  ];
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await seedSettings(context, { onboarded: true, theme: 'light', highContrast: false, reducedMotion: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  const covered = [];
  const chartLandfallStrokes = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await openKatrinaPanel(page);
    await page.waitForSelector('#storm-panel:not([hidden]) .storm-panel-layout');

    // Two more surfaces, both of which have to be rendered to be measured: a
    // comparison with at least two columns, and playback stopped rather than
    // never started, because .is-paused is a different rule from .is-playing.
    for (const profile of [
      { theme: 'light', highContrast: false, minimum: 4.5 },
      { theme: 'light', highContrast: true, minimum: 7 },
      { theme: 'dark', highContrast: false, minimum: 4.5 },
      // The fourth combination, which was missing: three of the four were
      // measured and dark + high contrast was assumed to follow from the other
      // three. It is its own token set and it holds itself to 7:1.
      { theme: 'dark', highContrast: true, minimum: 7 },
    ]) {
      await page.evaluate(async ({ theme, highContrast }) => {
        const settings = await import('/src/settings.js');
        settings.setSetting('theme', theme);
        settings.setSetting('highContrast', highContrast);
      }, profile);
      await page.waitForFunction(
        ({ theme, highContrast }) => document.documentElement.dataset.theme === theme &&
          document.documentElement.classList.contains('high-contrast') === highContrast,
        profile,
      );
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

      const measured = await measureContrast(page, [...targets, ...CHART_MARK_TARGETS]);

      const label = `${profile.theme}${profile.highContrast ? ' + high contrast' : ''} storm panel at 1440px`;
      const missing = measured.filter(row => row.missing);
      assert(!missing.length, `${label}: could not measure ${missing.map(row => row.selector).join(', ')}`);
      const failed = measured.filter(row => row.ratio < (row.minimum ?? profile.minimum));
      assert(
        !failed.length,
        `${label}: ${failed.map(row => `${row.name} ${row.ratio} under ${row.minimum ?? profile.minimum}`).join(', ')}`,
      );

      // Playback paused, and the comparison table open. Both carried
      // dark-palette values that stayed put while the ink around them flipped
      // light: the button measured 1.71:1 and the column headers 1.87:1.
      const extra = [
        ...await measurePausedPlaybackContrast(page),
        ...await measureComparisonHeaderContrast(page),
      ];
      const extraMissing = extra.filter(row => row.missing);
      assert(
        !extraMissing.length,
        `${label}: could not measure ${extraMissing.map(row => row.selector).join(', ')}; `
        + 'the playback and comparison surfaces have to be on screen for this to mean anything',
      );
      const extraFailed = extra.filter(row => row.ratio < profile.minimum);
      assert(
        !extraFailed.length,
        `${label}: below ${profile.minimum}:1 — ${extraFailed.map(row => `${row.name} ${row.ratio}`).join(', ')}`,
      );
      // The chart marks used to be literals in the SVG string, which pass a
      // ratio check in whichever theme they were picked for and never move.
      // The landfall rule is covered by the ratios above, since no single
      // frozen red clears 3:1 on both a white and a black panel. The dot
      // outline is not: it is a hairline with no ratio of its own, so freezing
      // it would go unnoticed. Reading both back per profile says the whole
      // chart follows the theme rather than one mark that happens to be
      // measured.
      chartLandfallStrokes.push(await page.evaluate((marks) => Object.fromEntries(marks.map(([name, selector, property]) => {
        const element = document.querySelector(`#storm-panel ${selector}`);
        return [name, element ? getComputedStyle(element)[property] : 'MISSING'];
      })), CHART_THEME_MARKS));
      // Collected rather than written out below, because the hand-written
      // summary went on naming three profiles after a fourth was added.
      covered.push(`${profile.theme}${profile.highContrast ? '+hc' : ''} >= ${profile.minimum}:1`);
    }
  } finally {
    await context.close();
  }
  if (pageErrors.length) throw new Error(`storm panel contrast page errors: ${pageErrors.join(' | ')}`);
  // Per mark, not per combination: a signature built from several marks together
  // stays varied when one of them is frozen, because the others still move.
  for (const [mark] of CHART_THEME_MARKS) {
    const values = chartLandfallStrokes.map(row => row[mark]);
    assert(!values.includes('MISSING'), `the chart's ${mark} mark was not on screen to measure`);
    assert(
      new Set(values).size >= 2,
      `the chart's ${mark} mark does not follow the theme: ${values.join(' | ')}`,
    );
  }
  console.log(`  storm panel contrast ok at 1440px (${covered.join(', ')}, chart marks follow all four themes, playback and comparison included)`);
}

// The status host for an optional feed registers two document listeners, and
// four callers rebuild their host with innerHTML immediately before mounting.
// A registry keyed by element never matched, so every re-render added another
// pair still rendering into a node that had been thrown away. The unit test
// pins the registry; this pins the thing a reader actually does.
// WCAG 2.2 SC 2.4.7 asks that a keyboard user can see where they are, and SC
// 1.4.11 puts a number on "see": 3:1 against what is behind it. Nothing else
// measured either, and the first version of this measured only whether a ring
// was declared at all, which passed three ways it should not have. A shadow of
// "0px 0px 0px 0px" paints nothing and passed. A ring at alpha 0.01 passed. A
// two-layer shadow whose second layer was transparent failed a plainly visible
// first layer, because the test read the whole string at once. Measuring the
// contrast of each layer against the surface behind it answers all three, and
// it caught what presence could not: the default dark theme's ring was 1.70:1.
//
// The accessibility layer ends with one focus block whose !important flags
// suppress roughly fifteen per-control focus rules above it in the same layer,
// and a roadmap item proposed scoping that block to html.high-contrast the way
// the hover block beside it was scoped. Two things were measured before writing
// this. Removing the !important changes the focus appearance of four control
// types, so the flags are load-bearing rather than decorative. Scoping the
// block, on the other hand, leaves every control still visibly focused: the
// per-control rules underneath take over. So this asserts the property that
// actually matters, that an indicator exists, rather than pinning which rule
// supplies it.
//
// Read after the transition settles. Straight after focus() the computed
// box-shadow is still the transition's transparent starting value, which reads
// as "this control has no focus ring" for every control in the app.
const MINIMUM_FOCUS_RING_RATIO = 3;

// High contrast darkens the accent tokens so white text can sit on top of
// them, which is the opposite of what accent-coloured TEXT needs on a
// near-black page. While both roles shared one value, turning the
// accessibility feature ON took the About dialog's headings from 9.87:1 to
// 1.51:1 and its links from 9.35:1 to 2.56:1, so the toggle made this text
// unreadable rather than clearer. Only the high-contrast profiles are asserted
// here: the light theme's own link colour is below AA for a different reason
// and has its own roadmap item.
async function assertAboutDialogContrast(browser, baseUrl) {
  const targets = [
    ['about section heading', '#info-modal .info-card h3'],
    ['about link', '#info-modal .info-card a'],
  ];
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await seedSettings(context, { onboarded: true, theme: 'dark', highContrast: true, reducedMotion: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  const covered = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.click('#toggle-info');
    await page.waitForSelector('#info-modal:not([hidden]) .info-card h3');

    // All four, not just high contrast. The light theme's link colour was the
    // one below AA here, at 2.79:1, because --sapphire has to work as a
    // category colour and a surface as well as link text and could not be
    // darkened for one of those jobs without changing the other two.
    for (const profile of [
      { theme: 'dark', highContrast: false, minimum: 4.5 },
      { theme: 'light', highContrast: false, minimum: 4.5 },
      { theme: 'dark', highContrast: true, minimum: 7 },
      { theme: 'light', highContrast: true, minimum: 7 },
    ]) {
      await page.evaluate(async ({ theme, highContrast }) => {
        const settings = await import('/src/settings.js');
        settings.setSetting('theme', theme);
        settings.setSetting('highContrast', highContrast);
      }, profile);
      await page.waitForFunction(
        ({ theme, highContrast }) => document.documentElement.dataset.theme === theme &&
          document.documentElement.classList.contains('high-contrast') === highContrast,
        profile,
      );
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

      const measured = await measureContrast(page, targets);
      const label = `${profile.theme} + high contrast About dialog at 1440px`;
      const missing = measured.filter(row => row.missing);
      assert(!missing.length, `${label}: could not measure ${missing.map(row => row.selector).join(', ')}`);
      const failed = measured.filter(row => row.ratio < profile.minimum);
      assert(
        !failed.length,
        `${label}: below ${profile.minimum}:1 — ${failed.map(row => `${row.name} ${row.ratio}`).join(', ')}`,
      );
      covered.push(`${profile.theme}${profile.highContrast ? '+hc' : ''} >= ${profile.minimum}:1`);
    }
  } finally {
    await context.close();
  }
  if (pageErrors.length) throw new Error(`about dialog contrast page errors: ${pageErrors.join(' | ')}`);
  console.log(`about dialog contrast ok (${covered.join(', ')})`);
}

async function assertFocusIndicatorInEveryTheme(browser, baseUrl) {
  const targets = [
    ['icon button', '#toggle-filters'],
    ['tabindex container', '.header-actions'],
    ['search input', '#search-input'],
    ['category button', '.cat-btn'],
  ];
  for (const [theme, highContrast] of [['dark', false], ['dark', true], ['light', false], ['light', true]]) {
    const label = `${theme}${highContrast ? ' + high contrast' : ''}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await seedSettings(context, { onboarded: true, theme, highContrast, locale: 'en', reducedMotion: true });
    await stubQuietTropics(context);
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.click('#toggle-filters');
      await page.waitForTimeout(400);
      // A click leaves the browser in pointer modality, where :focus-visible
      // does not match a programmatic focus(). One real Tab press restores the
      // keyboard modality every rule here is written for.
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);

      const applied = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        highContrast: document.documentElement.classList.contains('high-contrast'),
      }));
      assert(
        applied.theme === theme && applied.highContrast === highContrast,
        `${label}: the mode did not take (${JSON.stringify(applied)}), so nothing below would mean anything`,
      );

      for (const [name, selector] of targets) {
        const focused = await page.evaluate(sel => {
          const element = [...document.querySelectorAll(sel)].find(candidate => candidate.getClientRects().length);
          if (!element) return false;
          element.dataset.hmFocusProbe = '1';
          element.focus();
          return true;
        }, selector);
        assert(focused, `${label}: ${name} (${selector}) is not on screen, so its focus ring cannot be measured`);
        await page.waitForTimeout(600);
        const ring = await page.evaluate(minimum => {
          const element = document.querySelector('[data-hm-focus-probe="1"]');
          const style = getComputedStyle(element);

          const parse = value => {
            const text = String(value || '').trim();
            if (!text || text === 'transparent' || text === 'none') return null;
            const rgb = text.match(/^rgba?\(([^)]*)\)/i);
            if (!rgb) return { unsupported: text };
            const numbers = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
            if (numbers.length < 3 || numbers.some(Number.isNaN)) return { unsupported: text };
            return { r: numbers[0], g: numbers[1], b: numbers[2], a: numbers.length > 3 ? numbers[3] : 1 };
          };
          const over = (front, back) => ({
            r: front.r * front.a + back.r * (1 - front.a),
            g: front.g * front.a + back.g * (1 - front.a),
            b: front.b * front.a + back.b * (1 - front.a),
            a: 1,
          });
          const channel = value => {
            const normalized = value / 255;
            return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          };
          const luminance = color => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
          const ratio = (a, b) => {
            const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (high + 0.05) / (low + 0.05);
          };

          const surfaceOf = node => {
            const nodeStyle = getComputedStyle(node);
            const image = String(nodeStyle.backgroundImage || '');
            if (image.includes('gradient')) {
              // The darkest stop is the one the ring has to survive.
              const stops = (image.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/gi) || []).map(parse).filter(stop => stop && !stop.unsupported);
              if (stops.length) return stops.reduce((worst, stop) => (luminance(stop) < luminance(worst) ? stop : worst));
            }
            return parse(nodeStyle.backgroundColor);
          };
          const opaqueBackdrop = start => {
            const white = { r: 255, g: 255, b: 255, a: 1 };
            let stack = [];
            for (let host = start; host; host = host.parentElement) {
              const surface = surfaceOf(host);
              if (!surface || surface.unsupported) continue;
              if (surface.a <= 0) continue;
              stack.push(surface);
              if (surface.a >= 1) break;
            }
            if (!stack.length) return white;
            return stack.reverse().reduce((back, front) => (front.a >= 1 ? front : over(front, back)), white);
          };

          // Top-level commas only: a layer's colour carries its own.
          const splitLayers = text => {
            const layers = [];
            let depth = 0;
            let current = '';
            for (const character of String(text)) {
              if (character === '(') depth += 1;
              if (character === ')') depth -= 1;
              if (character === ',' && depth === 0) { layers.push(current); current = ''; continue; }
              current += character;
            }
            if (current.trim()) layers.push(current);
            return layers.map(layer => layer.trim()).filter(Boolean);
          };

          // An outset ring is painted over whatever is behind the element; an
          // inset one over the element's own background.
          const outerBackdrop = opaqueBackdrop(element.parentElement);
          const innerSurface = surfaceOf(element);
          const insetBackdrop = innerSurface && !innerSurface.unsupported && innerSurface.a > 0
            ? over(innerSurface, outerBackdrop)
            : outerBackdrop;

          const candidates = [];
          const unsupported = [];

          if (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) {
            const color = parse(style.outlineColor);
            if (color?.unsupported) unsupported.push(`outline-color ${color.unsupported}`);
            else if (color) candidates.push({ what: 'outline', ratio: ratio(over(color, outerBackdrop), outerBackdrop) });
          }

          if (style.boxShadow && style.boxShadow !== 'none') {
            for (const layer of splitLayers(style.boxShadow)) {
              const inset = /\binset\b/.test(layer);
              const color = parse(layer);
              if (color?.unsupported) { unsupported.push(`box-shadow ${color.unsupported}`); continue; }
              if (!color) continue;
              // A layer with no offset, no blur and no spread paints nothing,
              // whatever colour it is written in.
              const lengths = (layer.replace(/^rgba?\([^)]*\)/i, '').match(/-?\d*\.?\d+px/g) || []).map(Number.parseFloat);
              if (!lengths.length || lengths.every(length => length === 0)) continue;
              const backdrop = inset ? insetBackdrop : outerBackdrop;
              candidates.push({ what: inset ? 'inset shadow' : 'shadow', ratio: ratio(over(color, backdrop), backdrop) });
            }
          }

          const best = candidates.reduce((highest, candidate) => (candidate.ratio > highest.ratio ? candidate : highest), { what: 'nothing', ratio: 0 });
          const result = {
            focusVisible: element.matches(':focus-visible'),
            outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
            boxShadow: style.boxShadow.slice(0, 90),
            unsupported,
            best: { what: best.what, ratio: Number(best.ratio.toFixed(2)) },
            visible: best.ratio >= minimum,
          };
          element.blur();
          delete element.dataset.hmFocusProbe;
          return result;
        }, MINIMUM_FOCUS_RING_RATIO);
        assert(
          ring.focusVisible,
          `${label}: ${name} did not match :focus-visible, so this measured the wrong state`,
        );
        assert(
          !ring.unsupported.length,
          `${label}: ${name} paints its focus ring in a colour this gate cannot measure (${ring.unsupported.join(', ')})`,
        );
        assert(
          ring.visible,
          `${label}: ${name} draws a focus indicator of only ${ring.best.ratio}:1 (${ring.best.what}), under ${MINIMUM_FOCUS_RING_RATIO}:1`
          + ` — outline ${ring.outline}; shadow ${ring.boxShadow}`,
        );
      }
    } finally {
      await context.close();
    }
  }
  console.log('  focus indicator survives in all four theme combinations');
}

// Two hover rules, one in the components layer and one in the accessibility
// layer. The second was unscoped and !important, and !important in the last
// layer beats everything, so every component hover rule in every theme was dead
// and any hover styling added there did nothing. It is scoped to high contrast
// now, which is what it was written for.
async function assertHoverTreatmentFollowsTheTheme(browser, baseUrl) {
  const measure = async highContrast => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await seedSettings(context, { onboarded: true, theme: 'dark', highContrast, locale: 'en', reducedMotion: true });
    await stubQuietTropics(context);
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      const resting = await page.evaluate(() => getComputedStyle(document.querySelector('#toggle-filters')).backgroundColor);
      await page.hover('#toggle-filters');
      await page.waitForFunction(
        previous => getComputedStyle(document.querySelector('#toggle-filters')).backgroundColor !== previous,
        resting,
        { timeout: 5000 },
      );
      return await page.evaluate(previous => {
        const element = document.querySelector('#toggle-filters');
        // The accessibility rule forces exactly this token, so a hovered colour
        // equal to it means that rule is still winning.
        // Resolved through the browser rather than compared as text: the token
        // is authored as #2d2d2d and reported as rgb(45, 45, 45).
        const probe = document.createElement('div');
        probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--surface-control-hover').trim();
        document.body.appendChild(probe);
        const forced = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { resting: previous, hovered: getComputedStyle(element).backgroundColor, forced };
      }, resting);
    } finally {
      await context.close();
    }
  };

  const standard = await measure(false);
  const contrast = await measure(true);
  assert(
    standard.hovered !== standard.resting,
    `the default theme has no hover treatment: ${JSON.stringify(standard)}`,
  );
  assert(
    contrast.hovered !== contrast.resting,
    `high contrast lost its hover treatment: ${JSON.stringify(contrast)}`,
  );
  // The default theme must NOT land on the token the accessibility rule forces.
  // Comparing the two themes to each other proves nothing, because that token
  // has a different value in each of them.
  // \s, not s. Written without the backslash this stripped the letter s out of
  // the colour strings and normalised nothing at all.
  const normalize = value => String(value).replace(/\s+/g, '');
  assert(
    normalize(standard.hovered) !== normalize(standard.forced),
    `the default theme still hovers to the high-contrast token, so the rule is unscoped: ${standard.hovered}`,
  );
  assert(
    normalize(contrast.hovered) === normalize(contrast.forced),
    `high contrast no longer uses its own hover token: ${JSON.stringify(contrast)}`,
  );
}

// The subtitle is a flex container, and text-overflow does nothing on one, so
// at 1024px and again at 1378px the header read "...Atlas · 595 st", cut
// through a word. Either the text fits or it ends in an ellipsis; a clipped
// word with neither is the defect.
// Displays whose clientWidth and scrollWidth describe a real content area.
// Anything else, display: contents and plain inline included, reports 0 for
// both and would read as "this text fits".
const MEASURABLE_DISPLAYS = new Set([
  'block', 'flex', 'grid', 'inline-block', 'inline-flex', 'inline-grid',
  'flow-root', 'list-item', 'table', 'table-cell', 'table-row', 'table-caption',
]);

async function assertHeaderTextIsNotCut(browser, baseUrl, locale = 'en') {
  // 390 is in the list because the context rail is hidden below 720px, which
  // is the one width where the totals leave the shell entirely.
  const widths = [1440, 1378, 1280, 1024, 390];
  let railTotals = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await seedSettings(context, { onboarded: true, theme: 'dark', locale, reducedMotion: true });
  await stubQuietTropics(context);
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 });
      await page.waitForFunction(target => window.innerWidth === target, width);
      const measured = await page.evaluate(MEASURABLE_DISPLAYS_LIST => {
        const MEASURABLE_DISPLAYS = new Set(MEASURABLE_DISPLAYS_LIST);
        const describe = element => {
          const style = getComputedStyle(element);
          return {
            text: (element.textContent || '').trim().slice(0, 40),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            display: style.display,
            overflowX: style.overflowX,
            textOverflow: style.textOverflow,
          };
        };
        const visible = [...document.querySelectorAll('.app-header .subtitle, .app-header .subtitle > span, .app-header h1')]
          .filter(element => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });
        return {
          // display: contents generates no box, so scrollWidth and clientWidth
          // both read 0 and the comparison below says "fits" however far the
          // text actually runs. That is the measurement failing, not the header
          // passing, so it is reported instead of skipped.
          // scrollWidth and clientWidth are only meaningful on a box that has
          // a content area. display: contents has no box at all, and an inline
          // box returns 0 for both by spec, so either reads as "fits" however
          // far its text runs. Only display: contents was refused before, and
          // the spans in this list avoid the inline case solely because
          // .subtitle is a flex container, which blockifies them: the exact
          // property this is meant to be robust against.
          boxless: visible
            .filter(element => {
              if (!(element.textContent || '').trim()) return false;
              if (!element.getClientRects().length) return true;
              return !MEASURABLE_DISPLAYS.has(getComputedStyle(element).display);
            })
            .map(describe),
          cut: visible
            .filter(element => {
              const style = getComputedStyle(element);
              // A one-pixel rounding difference is not a clipped word, and
              // overflowing is not the defect on its own: an element that shows
              // an ellipsis overflows by definition. The defect is overflowing
              // with no ellipsis to show for it, which is how the header read
              // "...Atlas · 595 st".
              //
              // There are two ways to declare an ellipsis that never renders,
              // and both have to be refused or the excuse covers more than the
              // behaviour does. text-overflow is inert on a flex or grid
              // container, and .subtitle is one. It is equally inert while
              // overflow-x is visible, because there is nothing clipping the
              // text for it to replace.
              const honoursEllipsis = style.textOverflow === 'ellipsis' &&
                style.overflowX !== 'visible' &&
                !['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display);
              return element.scrollWidth > element.clientWidth + 1 && !honoursEllipsis;
            })
            .map(describe),
        };
      }, [...MEASURABLE_DISPLAYS]);
      assert(
        !measured.boxless.length,
        `[${locale}] header text has no box to measure at ${width}px: ${JSON.stringify(measured.boxless)}`,
      );
      assert(!measured.cut.length, `[${locale}] header text is cut with no ellipsis at ${width}px: ${JSON.stringify(measured.cut)}`);

      // The action labels are held to a stricter rule than the check above,
      // which accepts an ellipsis as a legitimate way to overflow. For these an
      // ellipsis IS the defect: the header read "3D STORM G..." in English and
      // clipped "Globo 3D de tormentas" by 62px in Spanish, and the label is
      // the only text on the button. They wrap to two lines instead, so nothing
      // should overflow at any of these widths in any locale.
      const clippedActionLabels = await page.evaluate(() => [...document.querySelectorAll('.app-header .header-action-label')]
        .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1)
        .map(element => `${element.textContent.trim()} (+${element.scrollWidth - element.clientWidth}px)`));
      assert(
        !clippedActionLabels.length,
        `header action labels are clipped at ${width}px in ${locale}: ${clippedActionLabels.join(', ')}`,
      );

      // Positive control, at every width rather than only the last one: the
      // subtitle has to have text on screen, or the loop above passed on an
      // empty header, and the totals it used to carry have to still be
      // somewhere a reader can reach.
      //
      // Three earlier versions of this were weaker than they read. textContent
      // alone said yes to a rail layout had collapsed. Measuring a rect said
      // yes to a rail inside an overflow:hidden box of zero height, and to one
      // at opacity 0, because it read the count's own box and nothing above it.
      // And it ran only at desktop widths, where the rail is always shown.
      const survivors = await page.evaluate(() => {
        const intersect = (a, b) => {
          const left = Math.max(a.left, b.left);
          const right = Math.min(a.right, b.right);
          const top = Math.max(a.top, b.top);
          const bottom = Math.min(a.bottom, b.bottom);
          return right - left > 1 && bottom - top > 1 ? { left, right, top, bottom } : null;
        };
        const rendered = element => {
          if (!element) return null;
          const text = (element.textContent || '').trim();
          // checkVisibility covers display, visibility and opacity: 0 on the
          // element and its ancestors.
          const displayed = element.checkVisibility
            ? element.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
            : getComputedStyle(element).visibility !== 'hidden';
          let box = element.getBoundingClientRect();
          let opacity = 1;
          let clipped = false;
          for (let host = element; host; host = host.parentElement) {
            const style = getComputedStyle(host);
            opacity *= Number.parseFloat(style.opacity);
            if (host === element) continue;
            // A scroll container with no room clips its child out of sight
            // while the child keeps a box of its own.
            if (style.overflow !== 'visible' || style.overflowX !== 'visible' || style.overflowY !== 'visible') {
              const next = box && intersect(box, host.getBoundingClientRect());
              if (!next) { clipped = true; break; }
              box = next;
            }
          }
          const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
          return {
            text,
            visible: Boolean(displayed && !clipped && box && opacity > 0.05 && box.right - box.left > 1 && box.bottom - box.top > 1),
            onScreen: Boolean(box && !clipped && intersect(box, viewport)),
          };
        };
        return {
          subtitle: rendered(document.querySelector('.app-header .subtitle')),
          // The count element, not the whole rail: the rail also carries the
          // year range, and taking the first two numbers off the rail took
          // 1851 and 2025, which the Statistics panel prints too, so the mobile
          // check below compared the wrong pair and passed while the totals
          // were gone. Visibility still accounts for the rail, because
          // rendered() walks the ancestors.
          counts: rendered(document.querySelector('.atlas-context-rail #storm-count')),
        };
      });
      assert(
        survivors.subtitle?.visible && survivors.subtitle.text.length > 20,
        `[${locale}] the subtitle has no visible text to clip at ${width}px, so the check above proves nothing: ${JSON.stringify(survivors.subtitle)}`,
      );
      assert(
        survivors.counts?.visible === Boolean(width > 720),
        `[${locale}] the context rail is ${survivors.counts?.visible ? 'shown' : 'hidden'} at ${width}px, which is not what the layout says: ${JSON.stringify(survivors.counts)}`,
      );

      if (survivors.counts?.visible) {
        const numbers = survivors.counts.text.match(/\d[\d,]*/g) || [];
        assert(
          survivors.counts.onScreen && numbers.length >= 2,
          `[${locale}] the totals did not survive the move out of the header at ${width}px: ${JSON.stringify(survivors.counts)}`,
        );
        railTotals = numbers.slice(0, 2);
      } else {
        // Below 720px the rail is hidden on purpose, and the totals it carries
        // are then on no part of the shell at all. They are still one tap away
        // in the Statistics panel, and that is the claim being made, so it is
        // the claim that gets checked rather than assumed.
        assert(railTotals.length === 2, `[${locale}] no desktop width ran before ${width}px, so there is nothing to compare the mobile totals against`);
        await page.click('#toggle-stats');
        await page.waitForSelector('#stats-panel:not([hidden])', { timeout: 10_000 });
        const statsText = await page.evaluate(() => (document.querySelector('#stats-panel')?.textContent || '').replace(/\s+/g, ' ').trim());
        for (const total of railTotals) {
          assert(
            statsText.includes(total),
            `[${locale}] at ${width}px the rail is hidden and the Statistics panel does not carry ${total} either, so the totals are on no surface: ${statsText.slice(0, 160)}`,
          );
        }
        await page.click('#toggle-stats');
        await page.waitForFunction(() => document.querySelector('#stats-panel')?.hidden === true, null, { timeout: 10_000 });
      }
    }
  } finally {
    await context.close();
  }
}

// The header's stacking and its blur used to be declared !important in the
// shell layer, which is also what stopped the light theme reaching it. Removing
// that took two other things with it, and nothing here was looking: a more
// specific selector in the same layer put the header back under the filters and
// the storm panel at z-index 1000, and the themes layer's generic .glass rules
// took the blur over, keying it to the operating system's colour preference
// rather than to the app's own theme.
async function assertHeaderStackingAndBlur(browser, baseUrl) {
  const readHeader = async scheme => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: scheme });
    await seedSettings(context, { onboarded: true, theme: 'dark', locale: 'en', reducedMotion: true });
    await stubQuietTropics(context);
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      return await page.evaluate(() => {
        const layer = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const value = Number.parseInt(getComputedStyle(element).zIndex, 10);
          return Number.isFinite(value) ? value : null;
        };
        const header = document.querySelector('.app-header');
        return {
          headerZ: layer('.app-header'),
          backdrop: getComputedStyle(header).backdropFilter,
          below: Object.fromEntries(
            ['#filters', '.storm-panel', '.optional-feed-status-overlay', '.atlas-context-rail', '.season-summary', '.radar-controls']
              .map(selector => [selector, layer(selector)])
              .filter(([, value]) => value !== null),
          ),
        };
      });
    } finally {
      await context.close();
    }
  };

  const dark = await readHeader('dark');
  const light = await readHeader('light');
  assert(Number.isFinite(dark.headerZ), `header has no numeric z-index: ${dark.headerZ}`);
  const covered = Object.entries(dark.below).filter(([, value]) => value >= dark.headerZ);
  assert(
    Object.keys(dark.below).length >= 3,
    `only ${Object.keys(dark.below).length} stacked surfaces were measured, so the header stacking check proves nothing`,
  );
  assert(
    !covered.length,
    `the header sits at z-index ${dark.headerZ}, at or below ${covered.map(([name, value]) => `${name} (${value})`).join(', ')}`,
  );
  assert(
    dark.backdrop === light.backdrop,
    `the header's blur follows the operating system rather than the app: dark-preference "${dark.backdrop}" vs light-preference "${light.backdrop}"`,
  );
  assert(
    /blur\(18px\)/.test(dark.backdrop),
    `the header lost its own blur to the generic .glass rules: ${dark.backdrop}`,
  );
}

// The other half of the same change: where the relay IS deployed it still wins,
// because only CurrentStorms.json carries the advisory and discussion URLs. If
// isMissingProxyRoute ever misread a real worker 404 the app would silently
// switch to the MapServer and lose those links with nothing to notice.
async function assertRelayStillWinsForActiveStorms(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await seedSettings(context, {
    onboarded: true, theme: 'dark', reducedMotion: true, locale: 'en',
    nhcOutlook: false, nhcForecastCone: false, goesRealtime: false, marineWarnings: false,
  });
  let summaryReads = 0;
  await context.route(
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/**',
    route => {
      summaryReads += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/geo+json',
        body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
      });
    },
  );
  // What the Cloudflare worker serves, tag and all.
  await context.route('**/nhc/CurrentStorms.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'X-HurricaneMap-CDN': 'MISS' },
    body: JSON.stringify({ activeStorms: [{
      id: 'al092026',
      binNumber: 'AT1',
      name: 'Relay',
      classification: 'HU',
      intensity: '90',
      pressure: '960',
      latitude: '25.0N',
      longitude: '80.0W',
      lastUpdate: '2026-09-07T15:00:00Z',
      publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/071500.shtml' },
      forecastDiscussion: { url: 'https://www.nhc.noaa.gov/text/refresh/MIATCDAT1+shtml/071500.shtml' },
    }] }),
  }));

  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForFunction(async () => {
      const feeds = await import('/src/optional-feeds.js');
      return !['idle', 'loading'].includes(feeds.getOptionalFeedState('active').state);
    }, null, { timeout: 25000 });

    const state = await page.evaluate(async () => {
      const feeds = await import('/src/optional-feeds.js');
      const active = feeds.getOptionalFeedState('active');
      const badge = document.getElementById('active-storm-badge');
      return {
        state: active.state,
        itemCount: active.itemCount,
        source: active.source,
        badgeLabel: badge?.getAttribute('aria-label') || '',
      };
    });
    assert(
      state.state === 'success' && state.itemCount === 1,
      `with a relay: the relay feed did not answer: ${JSON.stringify(state)}`,
    );
    assert(
      /CurrentStorms/.test(state.source),
      `with a relay: the feed credits the wrong source: ${state.source}`,
    );
    assert(summaryReads === 0, `with a relay: the MapServer was queried ${summaryReads} times when the relay answered`);
    assert(/1 active storm/i.test(state.badgeLabel), `with a relay: badge did not announce the storm: ${state.badgeLabel}`);

    // The links only CurrentStorms.json carries are what the relay is for.
    const links = await page.evaluate(async () => {
      const active = await import('/src/active.js');
      const card = active.activeStormCardElement({
        name: 'Relay',
        id: 'al092026',
        classification: 'HU',
        intensity: '90',
        publicAdvisory: { url: 'https://www.nhc.noaa.gov/text/refresh/MIATCPAT1+shtml/071500.shtml' },
        forecastDiscussion: { url: 'https://www.nhc.noaa.gov/text/refresh/MIATCDAT1+shtml/071500.shtml' },
      }, [25, -80]);
      return {
        hrefs: [...card.querySelectorAll('a')].map(anchor => anchor.getAttribute('href')),
        summary: card.querySelector('p')?.textContent || '',
      };
    });
    assert(
      links.hrefs.some(href => /MIATCPAT1/.test(href)) && links.hrefs.some(href => /MIATCDAT1/.test(href)),
      `with a relay: the advisory and discussion links are missing: ${links.hrefs.join(', ')}`,
    );
    assert(/90 kt/.test(links.summary), `with a relay: the card lost the intensity: ${links.summary}`);

    // A storm with no reported intensity must not read as a calm one. The
    // MapServer writes 9999 where it has no value, which the parser turns into
    // null, and Number(null) is 0.
    const missingIntensity = await page.evaluate(async () => {
      const active = await import('/src/active.js');
      const card = active.activeStormCardElement({ name: 'Lowell', id: 'ep122026', classification: 'MH', intensity: null }, [18, -162]);
      return card.querySelector('p')?.textContent || '';
    });
    assert(
      !/\b0 kt\b/.test(missingIntensity),
      `an unreported intensity rendered as calm: "${missingIntensity}"`,
    );

    assert(!pageErrors.length, `with a relay: page errors: ${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

// A deployment with no /nhc/ relay used to report the active-storm feed and
// the tropical outlook "not available on this deployment" and stop. NHC's
// tropical weather summary MapServer answers the same questions with a CORS
// header, so both feeds work on GitHub Pages with no worker at all. The
// fixtures were captured from the live service on 2026-09-07.
async function assertSummaryServiceServesActiveStorms(browser, baseUrl) {
  const fixtures = {
    5: JSON.parse(await readFile(new URL('../tests/fixtures/nhc-summary-forecast-points.json', import.meta.url), 'utf8')),
    2: JSON.parse(await readFile(new URL('../tests/fixtures/nhc-summary-outlook-points.json', import.meta.url), 'utf8')),
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await seedSettings(context, {
    onboarded: true, theme: 'dark', highContrast: false, reducedMotion: true, locale: 'en',
    nhcOutlook: true, nhcForecastCone: true, goesRealtime: false, marineWarnings: false,
  });

  const summaryLayersRead = [];
  const relayRoutesTried = [];
  await context.route(
    'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/**',
    route => {
      const layer = new URL(route.request().url()).pathname.match(/MapServer\/(\d+)\/query$/)?.[1];
      summaryLayersRead.push(layer);
      return route.fulfill({
        status: 200,
        contentType: 'application/geo+json',
        body: JSON.stringify(fixtures[layer] || { type: 'FeatureCollection', features: [] }),
      });
    },
  );

  const coneLayersRead = [];
  await context.route('https://services9.arcgis.com/**', route => {
    const url = new URL(route.request().url());
    const layer = url.pathname.match(/FeatureServer\/(\d+)\/query$/)?.[1];
    coneLayersRead.push(layer);
    // Layer 4 is the forecast error cone; a matching polygon around Lowell's
    // fixture position is enough to prove the cone reaches the map from a
    // MapServer-sourced storm.
    const cone = {
      type: 'FeatureCollection',
      features: layer === '4' ? [{
        type: 'Feature',
        properties: { STORMNAME: 'Hurricane Lowell', BASIN: 'EP', STORMNUM: 12, ADVISNUM: '46A', STORMID: 'ep122026' },
        geometry: { type: 'Polygon', coordinates: [[[-164, 16], [-160, 16], [-160, 20], [-164, 20], [-164, 16]]] },
      }] : [],
    };
    return route.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(cone) });
  });
  // Everything else the active-storm render reaches for is a separate feed with
  // its own coverage; answer them emptily so this assertion is about the
  // MapServer fallback and not about NOAA's uptime.
  for (const host of ['https://api.weather.gov/**', 'https://cdn.star.nesdis.noaa.gov/**']) {
    await context.route(host, route => route.fulfill({
      status: 200,
      contentType: 'application/geo+json',
      body: JSON.stringify({ type: 'FeatureCollection', features: [] }),
    }));
  }

  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/nhc/')) relayRoutesTried.push(url.pathname);
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForFunction(async () => {
      const feeds = await import('/src/optional-feeds.js');
      return ['active', 'outlook'].every(id => !['idle', 'loading'].includes(feeds.getOptionalFeedState(id).state));
    }, null, { timeout: 25000 });

    const feedStates = await page.evaluate(async () => {
      const feeds = await import('/src/optional-feeds.js');
      const read = id => {
        const state = feeds.getOptionalFeedState(id);
        return { state: state.state, itemCount: state.itemCount, source: state.source };
      };
      return { active: read('active'), outlook: read('outlook') };
    });
    assert(
      feedStates.active.state === 'success' && feedStates.active.itemCount === 2,
      `no relay: the active feed did not read the summary service: ${JSON.stringify(feedStates.active)}`,
    );
    assert(
      feedStates.outlook.state === 'success' && feedStates.outlook.itemCount === 1,
      `no relay: the outlook did not read the summary service: ${JSON.stringify(feedStates.outlook)}`,
    );
    assert(
      /summary/i.test(feedStates.active.source) && /summary/i.test(feedStates.outlook.source),
      `no relay: the diagnostics panel credits the wrong source: ${JSON.stringify(feedStates)}`,
    );

    // Positive control. The relay probe has to have been made and to have
    // failed, or these feeds were served by something other than the fallback
    // this asserts.
    assert(
      relayRoutesTried.some(path => path.endsWith('/nhc/CurrentStorms.json')),
      `no relay: the app never probed the relay, so nothing proves the fallback ran: ${relayRoutesTried.join(', ')}`,
    );
    assert(
      summaryLayersRead.includes('5') && summaryLayersRead.includes('2'),
      `no relay: the summary layers were not both read: ${summaryLayersRead.join(', ')}`,
    );

    const rendered = await page.evaluate(() => {
      const badge = document.getElementById('active-storm-badge');
      return {
        badgeHidden: badge?.hidden ?? null,
        badgeLabel: badge?.getAttribute('aria-label') || '',
        outlookMarkers: document.querySelectorAll('.nhc-outlook-marker').length,
        stormPopups: [...document.querySelectorAll('.leaflet-marker-icon, .leaflet-interactive')].length,
      };
    });
    assert(rendered.badgeHidden === false, 'no relay: the active-storm badge stayed hidden with two storms up');
    assert(/2 active storms/i.test(rendered.badgeLabel), `no relay: badge does not announce both storms: ${rendered.badgeLabel}`);
    assert(rendered.outlookMarkers === 1, `no relay: expected one outlook marker, saw ${rendered.outlookMarkers}`);

    // The cone travels with a MapServer-sourced storm, or the fallback delivers
    // a badge and nothing a reader can act on.
    await page.waitForFunction(async () => {
      const feeds = await import('/src/optional-feeds.js');
      return !['idle', 'loading'].includes(feeds.getOptionalFeedState('forecast').state);
    }, null, { timeout: 25000 });
    const forecast = await page.evaluate(async () => {
      const feeds = await import('/src/optional-feeds.js');
      const state = feeds.getOptionalFeedState('forecast');
      return { state: state.state, cones: document.querySelectorAll('path.nhc-cone, .nhc-forecast-cone').length };
    });
    assert(
      coneLayersRead.includes('4'),
      `no relay: the forecast cone service was never queried for a MapServer-sourced storm: ${coneLayersRead.join(', ')}`,
    );
    assert(
      forecast.state === 'success',
      `no relay: the forecast cone did not render for a MapServer-sourced storm: ${JSON.stringify(forecast)}`,
    );

    // The storms are the ones in the fixture, not a coincidence of live data.
    const stormNames = await page.evaluate(async () => {
      const summary = await import('/src/nhc-summary.js');
      const response = await fetch(summary.buildSummaryQueryUrl(summary.SUMMARY_LAYERS.forecastPoints));
      return summary.parseSummaryActiveStorms(await response.json()).map(storm => storm.name);
    });
    assert(
      stormNames.join(',') === 'Lowell,Marie',
      `no relay: the rendered storms are not the fixture's: ${stormNames.join(', ')}`,
    );

    assert(!pageErrors.length, `no relay: page errors during the summary-service fallback: ${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

async function assertFeedListenersDoNotAccumulate(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await seedSettings(context, { onboarded: true, theme: 'dark', highContrast: false, reducedMotion: true, locale: 'en' });
  await stubQuietTropics(context);
  // Count before any application script runs, so nothing is missed.
  await context.addInitScript(() => {
    if (window.top !== window) return;
    window.__hmFeedListenerCounts = { 'hm-optional-feed:change': 0, 'hm-locale:change': 0 };
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, ...rest) => {
      if (type in window.__hmFeedListenerCounts) window.__hmFeedListenerCounts[type] += 1;
      return add(type, ...rest);
    };
    document.removeEventListener = (type, ...rest) => {
      if (type in window.__hmFeedListenerCounts) window.__hmFeedListenerCounts[type] -= 1;
      return remove(type, ...rest);
    };
  });
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const storms = ['AL122005', 'AL092022', 'AL112017', 'AL041992', 'AL092017'];
    await openStormPanel(page, storms[0]);
    await page.waitForFunction(() => Boolean(document.querySelector('#tides-feed-status')), null, { timeout: 15000 });
    const baseline = await page.evaluate(() => ({ ...window.__hmFeedListenerCounts }));

    for (let round = 0; round < 2; round++) {
      for (const storm of storms) {
        await openStormPanel(page, storm);
        await page.waitForFunction(() => Boolean(document.querySelector('#tides-feed-status')), null, { timeout: 15000 });
      }
    }

    const after = await page.evaluate(() => ({ ...window.__hmFeedListenerCounts }));
    for (const [type, count] of Object.entries(after)) {
      assert(
        count <= baseline[type],
        `opening ten storms grew the ${type} listener count from ${baseline[type]} to ${count}`,
      );
    }
    // Positive control: the instrumentation has to have seen the listeners at
    // all, or a constant zero would pass.
    assert(
      baseline['hm-optional-feed:change'] > 0,
      'the listener counter never observed a feed status mount, so it proved nothing',
    );
  } finally {
    await context.close();
  }
  if (pageErrors.length) throw new Error(`feed listener page errors: ${pageErrors.join(' | ')}`);
  console.log('  feed status listeners stay constant across ten storm opens');
}

async function assertComparisonExportParity(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  // serve.py has no relay, so without this the active feed reaches the live
  // summary MapServer and puts a third-party dependency inside a test that had
  // none. This context seeds no settings, so the stub has to be asked for here.
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const parity = await page.evaluate(async () => {
      const data = await import('/src/data.js');
      const compare = await import('/src/compare.js');
      const settings = await import('/src/settings.js');
      const i18n = await import('/src/i18n.js');
      await data.ensureStormsLoaded();
      // Three storms, deliberately unlike each other: Katrina, Iniki in the
      // Pacific, and an 1851 storm with no impact record, so missing values
      // and multi-state rows are compared too, not just the easy ones.
      const ids = ['AL122005', 'EP181992', 'AL011851'];
      const chosen = ids.map(id => data.getAllStorms().find(item => item.id === id)).filter(Boolean);
      for (const storm of chosen) {
        if (!compare.isPinned(storm.id)) await compare.togglePin(storm);
      }
      compare.openComparePanel();

      const csv = compare.buildComparisonCSVText({
        storms: compare.getPins(),
        allStorms: data.getAllStorms(),
        translate: i18n.t,
        windUnit: settings.getSetting('windUnit'),
        locale: i18n.getLocale(),
        generatedAt: '2026-01-01T00:00:00.000Z',
      });

      // Parse the CSV table section the same way a spreadsheet would.
      const parseCsvRow = line => {
        const fields = [];
        let field = '';
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
          const character = line[index];
          if (quoted) {
            if (character === '"' && line[index + 1] === '"') { field += '"'; index += 1; }
            else if (character === '"') quoted = false;
            else field += character;
          } else if (character === '"') quoted = true;
          else if (character === ',') { fields.push(field); field = ''; }
          else field += character;
        }
        fields.push(field);
        return fields;
      };
      const csvLines = csv.split('\n');
      const blank = csvLines.indexOf('');
      const csvRows = csvLines.slice(1, blank === -1 ? undefined : blank).map(parseCsvRow);

      const table = document.querySelector('#compare-panel table');
      const domRows = [...(table?.querySelectorAll('tbody tr') || table?.querySelectorAll('tr') || [])]
        .map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent.trim()))
        .filter(cells => cells.length > 1);

      const cards = [...document.querySelectorAll('#compare-panel .cp-card')].map(card => ({
        title: card.querySelector('h3')?.textContent.trim() || '',
        meta: card.querySelector('.cp-meta')?.textContent.replace(/\s+/g, ' ').trim() || '',
      }));

      return { csvHeader: parseCsvRow(csvLines[0]), csvRows, domRows, cards, pins: compare.getPins().length };
    });

    assert(parity.pins >= 2, `comparison parity needs at least two pinned storms, got ${parity.pins}`);
    assert(parity.domRows.length > 0, 'the comparison table rendered no rows');
    assert(
      parity.csvRows.length === parity.domRows.length,
      `the export has ${parity.csvRows.length} metric rows and the table shows ${parity.domRows.length}`,
    );

    for (const [index, csvRow] of parity.csvRows.entries()) {
      const domRow = parity.domRows[index];
      assert(
        csvRow.length === domRow.length,
        `row ${index} has ${csvRow.length} exported fields and ${domRow.length} rendered cells`,
      );
      for (const [column, exported] of csvRow.entries()) {
        assert(
          exported === domRow[column],
          `comparison row "${csvRow[0]}" column ${column}: the panel shows `
          + `${JSON.stringify(domRow[column])} and the export says ${JSON.stringify(exported)}`,
        );
      }
    }

    // The cards restate a handful of the same metrics in a different shape, so
    // every figure on them has to appear in that storm's exported column.
    for (const card of parity.cards) {
      const column = parity.csvHeader.findIndex(name => name.replace(/\s+/g, ' ') === card.title);
      assert(column > 0, `the export has no column for the pinned card "${card.title}"`);
      const exported = new Set(parity.csvRows.map(row => row[column]));
      const figures = card.meta.match(/-?\d[\d,]*(?:\.\d+)?(?:\s*(?:kt|mph|km\/h|mb))?/g) || [];
      assert(figures.length > 0, `the card for ${card.title} showed no figures at all`);
      for (const figure of figures) {
        assert(
          [...exported].some(value => value.includes(figure)),
          `the card for ${card.title} shows ${JSON.stringify(figure)}, which appears in no exported field`,
        );
      }
    }

    assert(!pageErrors.length, `comparison parity produced page errors: ${pageErrors.join(' | ')}`);
    console.log(
      `  comparison parity ok (${parity.csvRows.length} metrics x ${parity.pins} storms, cards cross-checked)`,
    );
  } finally {
    await context.close();
  }
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
// Captures that got all the way through. The run used to end by printing a
// figure typed into the format string, so adding or removing a capture left
// the line claiming a number that was true whenever somebody last edited it.
let visualSnapshotCount = 0;
// Failures go somewhere the next run will not wipe. The counter above needs
// visual/ to hold exactly what this run captured, so the run clears it on
// start, and that clear was destroying the evidence from the run before: a
// size failure wrote its dump, the next run began, and the diagnosis was gone
// before anybody read it. Stamped, so two failures of the same snapshot do not
// overwrite each other.
const visualFailureDir = path.join(root, 'test-results', 'visual-failures');

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
  }, null, { timeout: 20000 });
}

const femaRouteStates = new WeakMap();
const FEMA_SMOKE_ROWS = [
  {
    femaDeclarationString: 'DR-1603-LA',
    disasterNumber: 1603,
    state: 'LA',
    declarationType: 'DR',
    declarationDate: '2005-08-29T00:00:00.000Z',
    incidentType: 'Hurricane',
    declarationTitle: 'HURRICANE KATRINA',
    incidentBeginDate: '2005-08-23T00:00:00.000Z',
    incidentEndDate: '2005-09-15T00:00:00.000Z',
    designatedArea: 'Orleans (Parish)',
  },
  {
    femaDeclarationString: 'DR-1603-LA',
    disasterNumber: 1603,
    state: 'LA',
    declarationType: 'DR',
    declarationDate: '2005-08-29T00:00:00.000Z',
    incidentType: 'Hurricane',
    declarationTitle: 'HURRICANE KATRINA',
    incidentBeginDate: '2005-08-23T00:00:00.000Z',
    incidentEndDate: '2005-09-15T00:00:00.000Z',
    designatedArea: 'Jefferson (Parish)',
  },
  {
    femaDeclarationString: 'EM-3263-DE',
    disasterNumber: 3263,
    state: 'DE',
    declarationType: 'EM',
    declarationDate: '2005-08-30T00:00:00.000Z',
    incidentType: 'Hurricane',
    declarationTitle: 'HURRICANE KATRINA EVACUATION',
    incidentBeginDate: '2005-08-25T00:00:00.000Z',
    incidentEndDate: '2005-09-02T00:00:00.000Z',
    designatedArea: 'Statewide (State)',
  },
];

async function installFemaRoute(page) {
  if (femaRouteStates.has(page)) return femaRouteStates.get(page);
  const state = { status: 200, rows: FEMA_SMOKE_ROWS };
  femaRouteStates.set(page, state);
  await page.route('https://www.fema.gov/**', route => route.fulfill({
    status: state.status,
    contentType: 'application/json',
    body: state.status === 200
      ? JSON.stringify({ DisasterDeclarationsSummaries: state.rows })
      : 'unavailable',
  }));
  return state;
}

async function openStormPanel(page, stormId) {
  await installFemaRoute(page);
  await page.evaluate(async id => {
    const data = await import('/src/data.js');
    const panel = await import('/src/panel.js');
    await data.ensureStormsLoaded();
    const landfall = data.getLandfalls().find(item => item.storm_id === id);
    if (!landfall) throw new Error(`Storm ${id} not found`);
    await panel.showStorm(landfall);
  }, stormId);
  await page.waitForFunction(() => !document.querySelector('#storm-panel')?.hidden, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector('#radar-cache-status');
    return status && ['complete', 'partial', 'empty', 'unavailable'].includes(status.dataset.state);
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const status = document.querySelector('#fema-context');
    return status && ['success', 'empty', 'error', 'stale', 'offline'].includes(status.dataset.state);
  }, null, { timeout: 15000 });
}

async function openKatrinaPanel(page) {
  await openStormPanel(page, 'AL122005');
}

async function assertVideoExport(page) {
  const button = page.locator('#video-export-btn');
  await page.waitForFunction(() => {
    const download = document.querySelector('#video-export-btn');
    const unavailable = document.querySelector('#video-export-unavailable');
    return download && unavailable && (!download.hidden || !unavailable.hidden);
  }, null, { timeout: 10000 });

  if (await button.isHidden()) {
    const unavailable = await page.textContent('#video-export-unavailable');
    assert(/Video export unavailable/i.test(unavailable || ''), `video export fallback is not explained: ${unavailable}`);
    return;
  }

  await page.selectOption('#video-export-fps', '24');
  await page.selectOption('#video-export-duration', '5');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await button.click();
  const download = await downloadPromise;
  assert(
    download.suggestedFilename() === 'HurricaneMap-Katrina-2005-track.webm',
    `video export filename was incorrect: ${download.suggestedFilename()}`,
  );
  await page.waitForFunction(
    () => /download started/i.test(document.querySelector('#video-export-status')?.textContent || ''),
    null,
    { timeout: 10000 },
  );
  await download.delete();
}

// The storm panel owns the radar overlay, the track animator, the wind-field
// swath and the high-water marks, and every control for them lives inside the
// panel. When another managed panel hid the storm panel, only the cone, the
// risk trajectories and the advisory replay were torn down: the radar kept
// running under the newly opened panel with no way to switch it off, still
// captioned with the previous storm.
async function assertStormOverlaysStopWithThePanel(page) {
  await openKatrinaPanel(page);
  await page.locator('#storm-panel button:has-text("Radar")').first().click();
  await page.waitForFunction(
    () => Boolean(document.querySelector('.radar-controls')) &&
      document.querySelectorAll('#map .leaflet-image-layer').length > 0,
    null,
    { timeout: 20000 },
  );

  await page.click('#toggle-stats');
  await page.waitForFunction(() => document.querySelector('#storm-panel')?.hidden === true, null, { timeout: 10000 });

  const leftovers = await page.evaluate(() => {
    const controls = document.querySelector('.radar-controls');
    const visible = element => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    return {
      radarControlsVisible: visible(controls),
      radarImageLayers: document.querySelectorAll('#map .leaflet-image-layer').length,
      windFieldPaths: document.querySelectorAll('path.wind-field-swath, .wind-field-legend').length,
      highWaterMarks: document.querySelectorAll('.hwm-marker, #hwm-legend:not([hidden])').length,
    };
  });
  assert(!leftovers.radarControlsVisible, 'radar controls survived the storm panel being hidden by another panel');
  assert(leftovers.radarImageLayers === 0, `radar imagery survived the storm panel being hidden: ${leftovers.radarImageLayers} layers`);
  assert(!leftovers.windFieldPaths, 'wind-field overlay survived the storm panel being hidden');
  assert(!leftovers.highWaterMarks, 'high-water marks survived the storm panel being hidden');

  await page.evaluate(async () => {
    const panels = await import('/src/panels.js');
    panels.closeAllPanels();
  });
}

// A local frame that cannot be decoded used to leave a blank overlay under a
// status line still reporting its timestamp, so the panel claimed a frame was
// on screen when none was. Driven by failing the frame's own request, which is
// what a truncated or corrupt PNG in the archive looks like to the browser.
async function assertUnreadableRadarFrameIsReported(page) {
  // Only the frame images: blocking the manifest too would send show() down
  // the remote walkback and never build the image overlay this is about.
  await page.route('**/data/radar/**/*.png', route => route.abort('failed'));
  try {
    await page.evaluate(async () => {
      window.__hmLocalRadarSmoke?.close();
      window.__hmBrokenRadarSmoke?.close();
      const { getMap } = await import('/src/map.js');
      const { RadarOverlay } = await import('/src/radar.js');
      const overlay = new RadarOverlay(getMap());
      window.__hmBrokenRadarSmoke = overlay;
      // A storm no earlier assertion has opened. Katrina's frame is already in
      // the browser's memory cache by now, and a cache hit issues no request
      // for page.route to fail.
      await overlay.show({
        id: 'AL011995',
        name: 'ALLISON',
        year: 1995,
        us_landfalls: [{ t: '1995-06-05T14:00:00Z', lat: 29.9, lon: -84.4, state: 'Florida' }],
        track: [],
      }, 0);
    });

    // A frame was chosen and the local image path was taken. Without this the
    // wait below is satisfied by the constructor's own `overlay = null`, so a
    // run where show() drew nothing at all would read as a pass.
    const chosen = await page.evaluate(() => ({
      frame: window.__hmBrokenRadarSmoke?.currentFrame?.url || '',
      source: window.__hmBrokenRadarSmoke?.currentFrame?.source || '',
    }));
    assert(
      chosen.source === 'local' && /^data\/radar\/Allison-1995\/.*\.png$/.test(chosen.frame),
      `the broken-frame case did not take the local image path: ${JSON.stringify(chosen)}`,
    );

    // The frame that never painted must not be left on the map.
    await page.waitForFunction(
      () => window.__hmBrokenRadarSmoke?.overlay === null,
      null,
      { timeout: 15000 },
    ).catch(() => {
      throw new Error('a radar frame that failed to load was left on the map');
    });
    // What the status WOULD have said if the frame had painted, built by the
    // app's own formatter rather than guessed at with a regex. A hand-written
    // pattern here was satisfied by every real timestamp the app produces,
    // because they read "Jun 5, 1995, 02:00 PM UTC" and the pattern expected a
    // bare clock time.
    const wouldHaveSaid = await page.evaluate(async () => {
      const { formatTime } = await import('/src/data.js');
      const frame = window.__hmBrokenRadarSmoke?.currentFrame;
      return frame ? formatTime(frame.date.toISOString()) : '';
    });
    assert(wouldHaveSaid, 'could not build the timestamp this frame would have shown');
    const reported = await page.evaluate(() => ({
      status: document.getElementById('radar-time')?.textContent || '',
      feedState: document.querySelector('#radar-feed-status')?.dataset.state || '',
      retry: Boolean(document.querySelector('#radar-feed-status button')),
    }));
    assert(
      !reported.status.includes(wouldHaveSaid),
      `the radar status still shows the frame's timestamp after it failed: ${JSON.stringify(reported.status)}`,
    );
    assert(
      /could not be displayed/i.test(reported.status),
      `the radar status did not say the frame failed: ${JSON.stringify(reported.status)}`,
    );
    // Reported through the same optional-feed host every other feed uses, so it
    // reaches the diagnostics panel and offers the retry that host already
    // wires to reopening the storm. The button alone proves nothing: the host
    // shows one for a successful feed too, so the state it is showing is the
    // part that has to be a failure.
    assert(reported.retry, 'the failed radar frame offered no retry');
    assert(
      reported.feedState === 'stale' || reported.feedState === 'error',
      `the radar status host still reads as a success: ${reported.feedState}`,
    );

    // Stepping past the last frame re-renders the status without drawing
    // anything. It used to put the timestamp straight back over a map with no
    // overlay on it, two clicks after the failure.
    //
    // Walked one step at a time, letting each failed draw settle first: the
    // image error that removes an overlay is asynchronous, and a straggler
    // arriving after the end-of-list branch would rewrite the status and hide
    // exactly what this is checking.
    const currentStamp = () => page.evaluate(
      () => window.__hmBrokenRadarSmoke?.currentDate?.toISOString() || '',
    );
    let reachedEnd = false;
    for (let index = 0; index < 12 && !reachedEnd; index += 1) {
      const before = await currentStamp();
      await page.evaluate(() => window.__hmBrokenRadarSmoke.step(+1));
      await page.waitForFunction(
        () => window.__hmBrokenRadarSmoke?.overlay === null,
        null,
        { timeout: 15000 },
      ).catch(() => {
        throw new Error('a frame that failed to load was left on the map by stepping');
      });
      reachedEnd = (await currentStamp()) === before;
    }
    assert(reachedEnd, 'stepping never reached the end of the frame list');
    const afterStepping = await page.evaluate(() => ({
      status: document.getElementById('radar-time')?.textContent || '',
    }));
    assert(
      !/(?<![\d:])\d{1,2}:\d{2}(?![\d:])/.test(afterStepping.status),
      `stepping past the last unreadable frame put a time back on a blank map: ${JSON.stringify(afterStepping.status)}`,
    );

    const feed = await page.evaluate(async () => {
      const feeds = await import('/src/optional-feeds.js');
      const state = feeds.getOptionalFeedState('radar');
      return { state: state?.state, detail: state?.detail };
    });
    // Deterministically 'stale', not 'error': show() calls completeOptionalFeed
    // three statements before draw()'s image can fail, so the feed always has
    // last-good data by the time failOptionalFeed runs and always takes its
    // hasLastGood branch. The failure kind is filed in detail.
    assert(
      feed.state === 'stale' && feed.detail === 'error',
      `the radar feed did not record the frame failure: ${JSON.stringify(feed)}`,
    );
  } finally {
    await page.unroute('**/data/radar/**/*.png');
    await page.evaluate(() => { window.__hmBrokenRadarSmoke?.close(); });
  }
}

async function assertRadarRenderModes(page) {
  await page.evaluate(async () => {
    const { getMap } = await import('/src/map.js');
    const { RadarOverlay } = await import('/src/radar.js');
    const overlay = new RadarOverlay(getMap());
    window.__hmRemoteRadarSmoke = overlay;
    await overlay.show({
      id: '__smoke_remote_radar__',
      name: 'SMOKE',
      year: 2024,
      us_landfalls: [{
        t: '2024-08-01T12:05:00Z',
        lat: 29.2,
        lon: -89.6,
        state: 'Louisiana',
      }],
      track: [],
    }, 0);
  });
  await page.waitForFunction(() => {
    const layer = window.__hmRemoteRadarSmoke?.overlay;
    return layer instanceof window.L.TileLayer &&
      Object.values(layer._tiles || {}).some(tile => tile.el?.complete && tile.el.naturalWidth > 0);
  }, null, { timeout: 30000 });
  const remote = await page.evaluate(() => {
    const layer = window.__hmRemoteRadarSmoke?.overlay;
    return {
      isTileLayer: layer instanceof window.L.TileLayer,
      template: layer?._url || '',
      tileCount: Object.values(layer?._tiles || {}).filter(tile => tile.el?.complete && tile.el.naturalWidth > 0).length,
    };
  });
  assert(remote.isTileLayer, 'remote radar did not render as a Leaflet tile layer');
  assert(/ridge::USCOMP-N0Q-2024080112\d\d\/\{z\}\/\{x\}\/\{y\}\.png$/.test(remote.template), `remote radar tile template was incorrect: ${remote.template}`);
  assert(remote.tileCount > 0, `remote radar tile layer loaded no tiles: ${JSON.stringify(remote)}`);

  await page.evaluate(async () => {
    const { getMap } = await import('/src/map.js');
    const { RadarOverlay } = await import('/src/radar.js');
    const overlay = new RadarOverlay(getMap());
    window.__hmLocalRadarSmoke = overlay;
    await overlay.show({
      id: 'AL122005',
      name: 'KATRINA',
      year: 2005,
      us_landfalls: [{
        t: '2005-08-29T11:10:00Z',
        lat: 29.2,
        lon: -89.6,
        state: 'Louisiana',
      }],
      track: [],
    }, 0);
  });
  const local = await page.evaluate(() => {
    const layer = window.__hmLocalRadarSmoke?.overlay;
    return {
      isImageOverlay: layer instanceof window.L.ImageOverlay,
      url: layer?._url || '',
    };
  });
  assert(local.isImageOverlay && local.url.startsWith('data/radar/'), `local radar path changed: ${JSON.stringify(local)}`);

  await page.evaluate(async () => {
    window.__hmRemoteRadarSmoke?.close();
    window.__hmLocalRadarSmoke?.close();
    const settings = await import('/src/settings.js');
    settings.setSetting('palette', 'colorblind');
    const { getMap } = await import('/src/map.js');
    const { RadarOverlay } = await import('/src/radar.js');
    const overlay = new RadarOverlay(getMap());
    window.__hmColorblindRadarSmoke = overlay;
    await overlay.show({
      id: '__smoke_colorblind_radar__',
      name: 'SMOKE',
      year: 2024,
      us_landfalls: [{
        t: '2024-08-01T12:05:00Z',
        lat: 29.2,
        lon: -89.6,
        state: 'Louisiana',
      }],
      track: [],
    }, 0);
  });
  await page.waitForFunction(() => {
    const layer = window.__hmColorblindRadarSmoke?.overlay;
    return layer instanceof window.L.TileLayer &&
      Object.values(layer._tiles || {}).some(tile => tile.el?.tagName === 'CANVAS' && tile.el.__hmRadarPaletteApplied);
  }, null, { timeout: 30000 });
  const colorblind = await page.evaluate(() => {
    const layer = window.__hmColorblindRadarSmoke?.overlay;
    const canvases = Object.values(layer?._tiles || {}).filter(tile => tile.el?.tagName === 'CANVAS');
    return {
      isTileLayer: layer instanceof window.L.TileLayer,
      palette: layer?.__hmRadarColorblind || false,
      canvasCount: canvases.length,
      appliedCount: canvases.filter(tile => tile.el.__hmRadarPaletteApplied).length,
      legend: document.querySelector('#radar-controls .radar-legend')?.textContent || '',
    };
  });
  assert(colorblind.isTileLayer && colorblind.palette, `colour-blind radar did not preserve the tile-layer contract: ${JSON.stringify(colorblind)}`);
  assert(colorblind.appliedCount > 0, `colour-blind radar did not remap any canvas tiles: ${JSON.stringify(colorblind)}`);
  assert(/Cividis/.test(colorblind.legend), `radar legend did not identify the colour-blind ramp: ${colorblind.legend}`);
  await page.evaluate(() => {
    window.__hmRemoteRadarSmoke?.close();
    window.__hmLocalRadarSmoke?.close();
    window.__hmColorblindRadarSmoke?.close();
  });
  await page.evaluate(async () => {
    const settings = await import('/src/settings.js');
    settings.setSetting('palette', 'default');
    delete window.__hmRemoteRadarSmoke;
    delete window.__hmLocalRadarSmoke;
    delete window.__hmColorblindRadarSmoke;
  });
}

async function assertAdvisoryForecastInViewport(page, stormId) {
  await openStormPanel(page, stormId);
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const path = document.querySelector('path.advisory-forecast-line');
    const map = document.querySelector('#map');
    if (!path || !map) return false;
    const pathRect = path.getBoundingClientRect();
    const mapRect = map.getBoundingClientRect();
    return pathRect.width > 0 && pathRect.height > 0 &&
      pathRect.right > mapRect.left && pathRect.left < mapRect.right &&
      pathRect.bottom > mapRect.top && pathRect.top < mapRect.bottom;
  }, null, { timeout: 15000 });
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

// Two things have to have settled before a screenshot means anything.
//
// The basemap: a capture taken before any tile arrives is the app chrome over
// an empty map, which is a different picture from the one every other capture
// in the run takes. desktop-location-privacy is the first of the run and the
// only one taken this early, so it was the only one that raced.
//
// And any view transition. showPanel wraps its DOM update in
// document.startViewTransition, and a waitForSelector resolves INSIDE that
// update callback, so the capture lands while Chromium is cross-fading the
// old snapshot into the new one. Measured: at the moment the privacy panel's
// selector resolves, five ::view-transition animations are running and the
// PNG is 787 KB against 591 KB settled, because it holds two frames at once.
// Playwright's animations:'disabled' does not cover view transitions.
async function waitForViewTransition(page, timeout = 5000) {
  return page.waitForFunction(
    () => !document.getAnimations().some(
      animation => typeof animation.effect?.pseudoElement === 'string'
        && animation.effect.pseudoElement.includes('view-transition'),
    ),
    null,
    { timeout },
  ).then(() => true).catch(() => false);
}

async function waitForMapPaint(page, timeout = 15_000) {
  const state = await page.evaluate(() => {
    const el = document.querySelector('#map');
    if (!el) return 'absent';
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? 'onscreen' : 'hidden';
  });
  if (state !== 'onscreen') return state;
  const painted = await page.waitForFunction(
    () => {
      const pane = document.querySelector('#map .leaflet-tile-pane');
      if (!pane) return false;
      const tiles = [...pane.querySelectorAll('img.leaflet-tile')];
      if (tiles.length === 0) return false;
      return tiles.filter(image => image.complete && image.naturalWidth > 0).length >= Math.min(4, tiles.length);
    },
    null,
    { timeout },
  ).then(() => true).catch(() => false);
  if (painted) return 'painted';
  // An empty basemap has two causes and they deserve different answers. The
  // app failing to build the layer is a bug here. OpenStreetMap declining to
  // serve us is not: its usage policy forbids bulk fetching, and eight
  // consecutive smoke runs are enough to get throttled, after which every run
  // fails in seventeen seconds on a tree that is perfectly fine. Ask the tile
  // server directly rather than guessing which one it is.
  const upstream = await page.evaluate(async () => {
    const tile = document.querySelector('#map .leaflet-tile-pane img.leaflet-tile');
    if (!tile?.src) return null;
    try {
      const response = await fetch(tile.src, { cache: 'no-store' });
      return response.ok ? null : `HTTP ${response.status}`;
    } catch (error) {
      return String(error?.message || error).slice(0, 80);
    }
  }).catch(() => null);
  return upstream ? `upstream:${upstream}` : 'blank';
}

async function captureVisualSnapshot(page, name, { paintTimeout } = {}) {
  await mkdir(visualSnapshotDir, { recursive: true });
  const paint = await waitForMapPaint(page, paintTimeout);
  const settled = await waitForViewTransition(page);
  // The byte guard below cannot see this. A map with every tile request
  // refused still screenshots at 283 KB, because the header, timeline, markers
  // and panels all paint: 20 KB catches an empty viewport, not an empty
  // basemap. Say which one failed.
  if (String(paint).startsWith('upstream:')) {
    // Loud, and not a failure: the tree is not what is broken.
    console.warn(`${name}: the basemap did not paint because the tile server answered ${paint.slice('upstream:'.length)}; the snapshot shows the app over an empty map`);
  } else {
    assert(paint !== 'blank', `${name}: the basemap never painted, so this snapshot is not the picture it claims to be`);
  }
  assert(settled, `${name}: a view transition was still running, so this snapshot holds two states at once`);
  const buffer = await page.screenshot({
    path: path.join(visualSnapshotDir, `${name}.png`),
    animations: 'disabled',
  });
  assert(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${name}: visual snapshot is not a PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const viewport = page.viewportSize();
  assert(width === viewport.width && height === viewport.height, `${name}: snapshot dimensions ${width}x${height} do not match ${viewport.width}x${viewport.height}`);
  if (buffer.length <= 20_000) {
    // A byte count is not a diagnosis. The one time this fired, the two
    // mechanisms it was blamed on were both measured and neither makes a small
    // file: with every tile request refused the same capture is 283 KB, because
    // the header, timeline, markers and panels all paint, and a view transition
    // caught mid-flight is larger than a settled frame rather than smaller. So
    // record what the page looked like at the moment it happened, beside the
    // PNG that shows it, instead of leaving the next occurrence to be chased
    // from the number again.
    await mkdir(visualFailureDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const keptPng = path.join(visualFailureDir, `${name}-${stamp}.png`);
    const dumpPath = path.join(visualFailureDir, `${name}-${stamp}.state.json`);
    const dump = await describeUndersizedSnapshot(page, name, buffer, paint, keptPng);
    await writeFile(keptPng, buffer);
    await writeFile(dumpPath, `${JSON.stringify(dump, null, 2)}\n`);
    assert(
      false,
      `${name}: snapshot is unexpectedly small (${buffer.length} bytes); page state written to ${dumpPath}`,
    );
  }
  visualSnapshotCount += 1;
}

/**
 * What the page looked like when a snapshot came back too small. Named fields
 * rather than one blob, because the point is to tell the candidate causes apart
 * on sight: an unpainted basemap, a loading overlay that never came down, a
 * backgrounded tab, or an animation still running.
 */
async function describeUndersizedSnapshot(page, name, buffer, paint, pngPath) {
  const pageState = await page.evaluate(() => {
    const pane = document.querySelector('#map .leaflet-tile-pane');
    const tiles = pane ? [...pane.querySelectorAll('img.leaflet-tile')] : [];
    const loading = document.getElementById('loading');
    const map = document.querySelector('#map');
    const rect = map?.getBoundingClientRect();
    return {
      url: location.href,
      visibility_state: document.visibilityState,
      ready_state: document.readyState,
      loading_overlay_display: loading ? getComputedStyle(loading).display : 'absent',
      loading_overlay_opacity: loading ? getComputedStyle(loading).opacity : null,
      map_rect: rect ? { width: rect.width, height: rect.height, x: rect.x, y: rect.y } : null,
      tiles_total: tiles.length,
      tiles_loaded: tiles.filter(image => image.complete && image.naturalWidth > 0).length,
      animations: document.getAnimations().slice(0, 20).map(animation => ({
        pseudo: animation.effect?.pseudoElement || null,
        state: animation.playState,
      })),
      open_panels: [...document.querySelectorAll('.panel')].filter(panel => !panel.hidden).map(panel => panel.id),
      body_background: getComputedStyle(document.body).backgroundColor,
    };
  }).catch(error => ({ evaluate_failed: String(error?.message || error).slice(0, 200) }));

  return {
    snapshot: name,
    captured_at: new Date().toISOString(),
    bytes: buffer.length,
    png: pngPath,
    map_paint: paint,
    viewport: page.viewportSize(),
    page: pageState,
  };
}

/**
 * The diagnosis path is worth nothing unless it runs, and it runs only when a
 * capture comes back small, which is the thing nobody can reproduce on demand.
 * So produce one on purpose. A viewport covered in a single flat colour is what
 * a blank frame compresses to, and it must trip the guard and leave both the
 * PNG and the state dump behind.
 */
/**
 * The shared destructive-action dialog and the focus trap under it.
 *
 * confirm-action.js is the only thing between three call sites and an
 * irreversible delete, and dialog-focus.js is the trap every modal leans on.
 * Neither had a test. The ARIA snapshots cannot cover them: they record the
 * accessibility tree, and every claim here is about which element holds focus
 * and whether a rejected confirmation left the store alone. Neither is visible
 * in a tree.
 *
 * Driven in a real engine on purpose. showModal(), the top layer and
 * :popover-open have no faithful stand-in, and a hand-built DOM would prove the
 * fake behaves rather than that the dialog does.
 */
// A closed <dialog> is hidden, and waitForSelector waits for visibility, so
// ':not([open])' never resolves. Ask about the attribute directly.
async function waitForDialogClosed(page) {
  await page.waitForFunction(
    () => !document.querySelector('#confirm-local-action')?.hasAttribute('open'),
    null,
    { timeout: 10_000 },
  );
}

/** Poll for focus to land on `id`, and report what actually holds it if it
 *  never does. A bare waitForFunction fails with a timeout and no evidence. */
async function assertFocusReturns(page, id, label) {
  const deadline = Date.now() + 8000;
  let seen = null;
  while (Date.now() < deadline) {
    seen = await page.evaluate(() => ({
      id: document.activeElement?.id || '',
      cls: document.activeElement?.className || '',
      tag: document.activeElement?.tagName || '',
    }));
    if (seen.id === id) return;
    await page.waitForTimeout(100);
  }
  assert(false, `${label}: focus never returned to #${id}; it sits on ${JSON.stringify(seen)}`);
}

/**
 * The empty state. A filter combination that matches nothing used to render a
 * blank map under "0 of 759" with no message and no way back, which reads as a
 * broken app rather than an empty answer.
 *
 * The combination is derived from the data rather than assumed: the state
 * filter only offers states that have taken a landfall, so there is no
 * permanently impossible state to pick.
 */
async function assertEmptyFilterState(page) {
  const readEmpty = () => page.evaluate(() => {
    const host = document.querySelector('#filter-empty');
    return {
      hidden: host ? host.hidden : null,
      message: document.querySelector('#filter-empty-message')?.textContent?.trim() || '',
      hasReset: !document.querySelector('#filter-empty-reset')?.hidden,
      count: document.querySelector('#visible-count')?.textContent?.trim() || '',
    };
  });

  const countMarkers = () => page.evaluate(
    () => document.querySelectorAll('#map path.landfall-marker').length,
  );

  const filtersCollapsed = await page.locator('#filters').evaluate(el => el.classList.contains('collapsed'));
  if (filtersCollapsed) await clickHeaderAction(page, '#toggle-filters');
  await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'));

  const populated = await readEmpty();
  assert(populated.hidden === true, `the empty state is showing while landfalls match: ${JSON.stringify(populated)}`);
  const markersBefore = await countMarkers();
  assert(markersBefore > 0, `no landfall markers to lose, so this proves nothing: ${markersBefore}`);

  // The layers the message does NOT name must survive the clear. Turning tracks
  // on here is what catches a reset that quietly switches them off.
  const tracksWereOn = await page.evaluate(() => document.querySelector('#show-tracks')?.checked === true);
  await page.evaluate(() => {
    const tracks = document.querySelector('#show-tracks');
    if (tracks && !tracks.checked) { tracks.checked = true; tracks.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForFunction(() => document.querySelector('#show-tracks')?.checked === true);

  // The state filter only offers states that have taken a landfall, so there is
  // no permanently impossible state to pick. Derive a pair that genuinely has
  // no data instead: a real state, and a year in which it was never hit.
  const combo = await page.evaluate(async () => {
    const { getLandfalls } = await import('/src/data.js');
    const all = getLandfalls();
    const state = [...new Set(all.map(item => item.state).filter(Boolean))].sort()[0];
    const years = new Set(all.filter(item => item.state === state).map(item => item.year));
    for (let year = 1900; year <= 2025; year += 1) {
      if (!years.has(year)) return { state, year };
    }
    return null;
  });
  assert(combo, 'every year has a landfall in every state, so no impossible combination exists');

  await page.selectOption('#state-filter', combo.state);
  await page.fill('#year-min', String(combo.year));
  await page.dispatchEvent('#year-min', 'change');
  await page.fill('#year-max', String(combo.year));
  await page.dispatchEvent('#year-max', 'change');
  await page.waitForFunction(
    () => document.querySelector('#filter-empty')?.hidden === false,
    null,
    { timeout: 8000 },
  ).catch(async () => {
    const seen = await readEmpty();
    assert(false, `filtering to ${combo.state} in ${combo.year} matched nothing but raised no empty state: ${JSON.stringify(seen)}`);
  });

  const empty = await readEmpty();
  assert(empty.message.length > 0, `the empty state has no message: ${JSON.stringify(empty)}`);
  const emptyBox = await page.locator('#filter-empty').boundingBox();
  assert(
    emptyBox && emptyBox.width > 0 && emptyBox.height > 0,
    `the empty state is not hidden but has no box on screen: ${JSON.stringify(emptyBox)}`,
  );
  assert(empty.hasReset, `the empty state offers no way to clear the filters: ${JSON.stringify(empty)}`);
  // The message has to name the filters that did it, not just say "nothing".
  assert(
    /year|state|a\u00f1os|estado|ane|eta/i.test(empty.message),
    `the empty state does not name the filters responsible: "${empty.message}"`,
  );

  // The table says so too, rather than drawing an empty grid.
  await clickHeaderAction(page, '#toggle-table-view');
  await page.waitForSelector('#table-view-panel:not([hidden])');
  const tableEmpty = await page.evaluate(() => ({
    rows: document.querySelectorAll('#table-view-body tbody tr').length,
    message: document.querySelector('.table-view-empty')?.textContent?.trim() || '',
  }));
  assert(
    tableEmpty.rows === 0 && tableEmpty.message.length > 0,
    `the table rendered an empty grid instead of a message: ${JSON.stringify(tableEmpty)}`,
  );
  await clickHeaderAction(page, '#toggle-table-view');

  // Clearing brings the landfalls back and takes the message away. The table
  // panel collapses the filter sidebar on its way in, so the control has to be
  // brought back on screen before it can be clicked.
  const collapsedAgain = await page.locator('#filters').evaluate(el => el.classList.contains('collapsed'));
  if (collapsedAgain) await clickHeaderAction(page, '#toggle-filters');
  await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'));
  await page.click('#filter-empty-reset');
  await page.waitForFunction(() => document.querySelector('#filter-empty')?.hidden === true, null, { timeout: 8000 });
  const restored = await readEmpty();
  assert(restored.hidden === true, `clearing the filters left the empty state up: ${JSON.stringify(restored)}`);
  const markersAfter = await countMarkers();
  assert(
    markersAfter === markersBefore,
    `clearing the filters did not bring the landfalls back: ${markersBefore} before, ${markersAfter} after`,
  );
  // And it must not have switched off a layer its message never mentioned.
  const tracksStillOn = await page.evaluate(() => document.querySelector('#show-tracks')?.checked === true);
  assert(
    tracksStillOn,
    'clearing the filters switched off the track layer, which its message does not name',
  );
  // Hand the suite back the state it lent us: t=1 in the fragment fails a later
  // assertion about a default view.
  if (!tracksWereOn) {
    await page.evaluate(() => {
      const tracks = document.querySelector('#show-tracks');
      if (tracks?.checked) { tracks.checked = false; tracks.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForFunction(() => document.querySelector('#show-tracks')?.checked === false);
  }
}

/**
 * Importing saved views in replace mode destroys every view on the device, so
 * it is confirmed the way deleting a single one already was. The guard used to
 * be inverted: the small destructive action asked, the total one did not.
 *
 * The import fixture is produced by the app's own exportSavedViews() rather
 * than typed here, so the file under test is one the app would actually write.
 */
async function assertSavedViewReplaceIsConfirmed(page) {
  const DIALOG = '#confirm-local-action';
  const names = () => page.evaluate(
    () => (JSON.parse(localStorage.getItem('hm-saved-views-v1') || 'null')?.views || []).map(view => view.name).sort(),
  );

  const filtersCollapsed = await page.locator('#filters').evaluate(el => el.classList.contains('collapsed'));
  if (filtersCollapsed) await clickHeaderAction(page, '#toggle-filters');

  // Build a real export file holding one view, then leave a different view in
  // the store so the two are told apart by name.
  const fixture = await page.evaluate(async () => {
    const store = await import('/src/saved-views.js');
    localStorage.removeItem('hm-saved-views-v1');
    store.saveCurrentView('Imported one', '#v=1&t=1');
    const exported = store.exportSavedViews();
    localStorage.removeItem('hm-saved-views-v1');
    store.saveCurrentView('Keep me', '#v=1&h=1');
    return exported;
  });
  assert(/Imported one/.test(fixture), `the export fixture is not what it claims: ${fixture.slice(0, 120)}`);

  await clickHeaderAction(page, '#toggle-settings');
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'));
  await page.evaluate(async () => {
    const { renderSavedViewsManager } = await import('/src/saved-views-ui.js');
    if (typeof renderSavedViewsManager === 'function') renderSavedViewsManager();
  }).catch(() => {});

  const loadFixture = async () => {
    await page.setInputFiles('[data-saved-view-file]', {
      name: 'saved-views.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fixture, 'utf8'),
    });
    await page.waitForSelector('.saved-view-import-preview');
  };

  // --- replace mode asks, and a refusal changes nothing -------------------
  await loadFixture();
  await page.check('input[name="saved-view-import-mode"][value="replace"]');
  await page.click('[data-action="commit-import"]');
  await page.waitForSelector(`${DIALOG}[open]`);
  const asked = await page.evaluate(
    () => document.querySelector('#confirm-local-action-message')?.textContent || '',
  );
  assert(/\b1\b/.test(asked), `the confirmation does not say how many views it will destroy: "${asked}"`);
  await page.keyboard.press('Escape');
  await waitForDialogClosed(page);
  await page.waitForTimeout(300);
  const afterRefusal = await names();
  assert(
    afterRefusal.length === 1 && afterRefusal[0] === 'Keep me',
    `refusing the replace still changed the store: ${JSON.stringify(afterRefusal)}`,
  );

  // --- confirming does replace everything ---------------------------------
  await page.click('[data-action="commit-import"]');
  await page.waitForSelector(`${DIALOG}[open]`);
  await page.click('.confirm-action-submit');
  await waitForDialogClosed(page);
  await page.waitForFunction(
    () => (JSON.parse(localStorage.getItem('hm-saved-views-v1') || 'null')?.views || [])
      .some(view => view.name === 'Imported one'),
    null,
    { timeout: 8000 },
  );
  const afterReplace = await names();
  assert(
    afterReplace.length === 1 && afterReplace[0] === 'Imported one',
    `replace did not put the imported view in place of the old one: ${JSON.stringify(afterReplace)}`,
  );

  // --- merge mode does not ask, and does commit ---------------------------
  // Start from a store holding ONLY the view merge must preserve. Leaving the
  // replace step's view in place made the post-condition true before the click,
  // so a merge that silently no-opped passed.
  await page.evaluate(async () => {
    const store = await import('/src/saved-views.js');
    localStorage.removeItem('hm-saved-views-v1');
    store.saveCurrentView('Keep me', '#v=1&h=1');
  });
  const beforeMerge = await names();
  assert(
    beforeMerge.length === 1 && beforeMerge[0] === 'Keep me',
    `the merge step did not start from one known view: ${JSON.stringify(beforeMerge)}`,
  );
  await loadFixture();
  await page.check('input[name="saved-view-import-mode"][value="merge"]');
  await page.click('[data-action="commit-import"]');
  // The imported view has to actually arrive, which is what proves the commit
  // happened rather than that the pre-state already satisfied a count.
  await page.waitForFunction(
    () => (JSON.parse(localStorage.getItem('hm-saved-views-v1') || 'null')?.views || [])
      .some(view => view.name === 'Imported one'),
    null,
    { timeout: 8000 },
  );
  const dialogOpened = await page.evaluate(
    () => Boolean(document.querySelector('#confirm-local-action')?.hasAttribute('open')),
  );
  assert(!dialogOpened, 'merge mode asked for confirmation, which it has no reason to');
  const afterMerge = await names();
  assert(
    afterMerge.includes('Keep me'),
    `merge destroyed the view already on the device: ${JSON.stringify(afterMerge)}`,
  );
  assert(
    afterMerge.includes('Imported one') && afterMerge.length === 2,
    `merge did not add the imported view beside the existing one: ${JSON.stringify(afterMerge)}`,
  );

  await page.evaluate(() => {
    localStorage.removeItem('hm-saved-views-v1');
    document.querySelector('#settings-menu')?.hidePopover?.();
  });
}

async function assertConfirmDialogContract(page) {
  const DIALOG = '#confirm-local-action';
  const readPrep = () => page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('hm-prep-v1') || 'null');
    return (raw?.state?.checked || raw?.checked || []).slice().sort();
  });

  await clickHeaderAction(page, '#toggle-prep');
  await page.waitForSelector('#prep-panel:not([hidden]) #prep-reset');
  await page.check('[data-prep-item="water"]');
  await page.check('[data-prep-item="food"]');
  await page.waitForFunction(() => {
    const raw = JSON.parse(localStorage.getItem('hm-prep-v1') || 'null');
    return (raw?.state?.checked || raw?.checked || []).length >= 2;
  });
  const before = await readPrep();
  assert(before.length >= 2, `nothing to destroy, so a cancelled reset would prove nothing: ${JSON.stringify(before)}`);

  // --- Cancel is the control focus lands on -------------------------------
  await page.click('#prep-reset');
  await page.waitForSelector(`${DIALOG}[open]`);
  const opened = await page.evaluate(() => ({
    focused: document.activeElement?.className || '',
    cancelText: document.querySelector('.confirm-action-cancel')?.textContent || '',
    confirmText: document.querySelector('.confirm-action-submit')?.textContent || '',
  }));
  assert(
    opened.focused.includes('confirm-action-cancel'),
    `focus must start on Cancel, not on the destructive button: ${JSON.stringify(opened)}`,
  );
  assert(opened.cancelText.trim() && opened.confirmText.trim(), `dialog buttons have no labels: ${JSON.stringify(opened)}`);

  // --- Tab cycles inside the dialog ---------------------------------------
  await page.evaluate(() => document.querySelector('.confirm-action-submit')?.focus());
  await page.keyboard.press('Tab');
  const wrapped = await page.evaluate(() => document.activeElement?.className || '');
  assert(
    wrapped.includes('confirm-action-cancel'),
    `Tab from the last control must wrap to the first, landed on "${wrapped}"`,
  );
  await page.keyboard.press('Shift+Tab');
  const wrappedBack = await page.evaluate(() => document.activeElement?.className || '');
  assert(
    wrappedBack.includes('confirm-action-submit'),
    `Shift+Tab from the first control must wrap to the last, landed on "${wrappedBack}"`,
  );

  // --- Escape cancels, changes nothing, and hands focus back --------------
  await page.keyboard.press('Escape');
  await waitForDialogClosed(page);
  // Focus comes back in the same callback that resolves the promise, so this
  // is the ordering barrier: once focus is home, the caller has had its answer.
  await assertFocusReturns(page, 'prep-reset', 'after cancelling the reset');
  // A negative claim needs a window, not an instant. Watch the store for half
  // a second and fail if it ever empties.
  for (let tick = 0; tick < 5; tick += 1) {
    const still = await readPrep();
    assert(
      JSON.stringify(still) === JSON.stringify(before),
      `a cancelled confirmation mutated the checklist: ${JSON.stringify(before)} became ${JSON.stringify(still)}`,
    );
    await page.waitForTimeout(100);
  }

  // --- Confirming does the work and hands focus back ----------------------
  await page.click('#prep-reset');
  await page.waitForSelector(`${DIALOG}[open]`);
  await page.click('.confirm-action-submit');
  await waitForDialogClosed(page);
  await page.waitForFunction(() => {
    const raw = JSON.parse(localStorage.getItem('hm-prep-v1') || 'null');
    return (raw?.state?.checked || raw?.checked || []).length === 0;
  }, null, { timeout: 8000 }).catch(() => {});
  const afterConfirm = await readPrep();
  assert(
    afterConfirm.length === 0,
    `confirming the reset left items checked: ${JSON.stringify(afterConfirm)}`,
  );
  // NOT asserting focus return here: prep.js focuses #prep-reset itself after a
  // confirmed reset (src/prep.js:192), so this path is satisfied by the caller
  // whether or not confirm-action.js restores anything.
  await clickHeaderAction(page, '#toggle-prep');

  // --- focus lands on the invoker, with an invoker nothing else touches ---
  // Two honest caveats, both measured. Every call site that confirms also moves
  // focus itself (src/prep.js:192, src/saved-views-ui.js:93), so no call site
  // can isolate the module. And a native <dialog> returns focus to whatever was
  // focused before showModal() on its own, so deleting confirm-action.js's
  // opener.focus() does NOT fail this: the browser covers the plain case. What
  // this asserts is the requirement, that focus ends up on the invoker, not the
  // implementation. The popover case below is the one the platform cannot do
  // alone, and removing reopenPopover does fail it.
  const isolated = await page.evaluate(async () => {
    const { confirmLocalAction } = await import('/src/confirm-action.js');
    const probe = document.createElement('button');
    probe.id = 'hm-confirm-focus-probe';
    probe.textContent = 'probe';
    document.body.appendChild(probe);
    probe.focus();
    window.__hmConfirm = confirmLocalAction({
      title: 'Focus probe',
      message: 'Does focus come back to the invoker?',
      confirmLabel: 'Confirm',
      invoker: probe,
    });
    return document.activeElement?.className || '';
  });
  assert(
    isolated.includes('confirm-action-cancel'),
    `the isolated confirmation did not take focus into the dialog: "${isolated}"`,
  );
  await page.click('.confirm-action-submit');
  await waitForDialogClosed(page);
  const confirmedValue = await page.evaluate(() => window.__hmConfirm);
  assert(confirmedValue === true, `confirming resolved ${JSON.stringify(confirmedValue)} rather than true`);
  await assertFocusReturns(page, 'hm-confirm-focus-probe', 'after confirming, with an invoker that refocuses nothing');
  await page.evaluate(() => {
    document.getElementById('hm-confirm-focus-probe')?.remove();
    delete window.__hmConfirm;
  });

  // --- An invoker inside a popover gets its popover back ------------------
  // Saved views live in the settings popover, and showModal() light-dismisses
  // it, so without the reopen the reader is returned to a control on a surface
  // that is no longer on screen.
  await page.evaluate(() => localStorage.removeItem('hm-saved-views-v1'));
  await clickHeaderAction(page, '#toggle-settings');
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'));
  await page.fill('#saved-view-name', 'Confirm contract');
  await page.click('#saved-views-manager [data-action="save"]');
  await page.waitForSelector('#saved-views-manager [data-action="delete"]');
  await page.click('#saved-views-manager [data-action="delete"]');
  await page.waitForSelector(`${DIALOG}[open]`);
  await page.keyboard.press('Escape');
  await waitForDialogClosed(page);
  await page.waitForTimeout(300);
  const popoverBack = await page.evaluate(() => ({
    open: Boolean(document.querySelector('#settings-menu')?.matches(':popover-open')),
    views: (JSON.parse(localStorage.getItem('hm-saved-views-v1') || 'null')?.views || []).length,
  }));
  assert(
    popoverBack.open,
    'cancelling a confirmation opened from the settings popover left the popover closed',
  );
  assert(
    popoverBack.views === 1,
    `a cancelled delete removed the saved view anyway: ${popoverBack.views} left`,
  );
  await page.evaluate(() => {
    localStorage.removeItem('hm-saved-views-v1');
    document.querySelector('#settings-menu')?.hidePopover?.();
  });
}

async function assertUndersizedSnapshotIsDiagnosed(page) {
  const name = 'diagnostic-blank-viewport';

  await page.evaluate(() => {
    const cover = document.createElement('div');
    cover.id = 'hm-smoke-blank-cover';
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000';
    document.body.appendChild(cover);
  });

  let failure = null;
  try {
    await captureVisualSnapshot(page, name);
  } catch (error) {
    failure = error;
  } finally {
    await page.evaluate(() => document.getElementById('hm-smoke-blank-cover')?.remove());
  }

  assert(failure, 'a viewport painted one flat colour must trip the snapshot size guard');
  assert(
    failure.message.includes('snapshot is unexpectedly small'),
    `the blanked viewport failed for some other reason: ${failure.message}`,
  );
  const marker = 'page state written to ';
  assert(
    failure.message.includes(marker),
    `the size failure must name the state dump it wrote: ${failure.message}`,
  );
  const dumpPath = failure.message.slice(failure.message.indexOf(marker) + marker.length);
  assert(
    dumpPath.includes('visual-failures'),
    `the dump must land where the next run will not clear it, got ${dumpPath}`,
  );

  const dump = JSON.parse(await readFile(dumpPath, 'utf8'));
  for (const field of ['snapshot', 'bytes', 'png', 'map_paint', 'viewport', 'page']) {
    assert(field in dump, `the state dump is missing ${field}: ${Object.keys(dump).join(', ')}`);
  }
  for (const field of ['url', 'visibility_state', 'loading_overlay_display', 'map_rect', 'tiles_total', 'tiles_loaded', 'animations']) {
    assert(field in dump.page, `the dumped page state is missing ${field}: ${Object.keys(dump.page).join(', ')}`);
  }
  assert(dump.bytes <= 20_000, `the dump must record the size that failed, got ${dump.bytes}`);
  assert(dump.snapshot === name, `the dump must name its snapshot, got ${dump.snapshot}`);
  const kept = await stat(dump.png);
  assert(
    kept.size === dump.bytes,
    `the failing PNG must be kept beside the dump at the size the dump reports, ${kept.size} against ${dump.bytes}`,
  );
  assert(
    path.dirname(dump.png) === path.dirname(dumpPath),
    'the PNG and its dump must sit together',
  );

  // Only this deliberate pair. A real failure's artifacts are the point and
  // stay where they were written.
  await rm(dump.png, { force: true });
  await rm(dumpPath, { force: true });
  // page.screenshot writes into the counted directory before the guard runs, so
  // this synthetic capture leaves a PNG the run never counted. A real size
  // failure aborts before the count is taken, so only this one has to tidy up.
  await rm(path.join(visualSnapshotDir, `${name}.png`), { force: true });
}

/**
 * The paint wait is the whole of the fix for `desktop-location-privacy:
 * snapshot is unexpectedly small (6491 bytes)` on 2026-09-08: the capture used
 * to fire as soon as the privacy panel's selector resolved, with the basemap
 * still blank behind it. A wait nobody has watched fail is a wait nobody can
 * tell from a sleep, so empty the tile pane and prove the capture refuses
 * rather than photographing a map that never painted.
 *
 * The tiles are moved, not rebuilt. Leaflet holds the img elements it created,
 * so re-parsing the pane's innerHTML would hand the map back a tree of
 * strangers and every later frame in this run would be drawn on top of it.
 */
async function assertUnpaintedMapIsRefused(page) {
  const name = 'diagnostic-unpainted-basemap';
  const stashed = await page.evaluate(() => {
    const pane = document.querySelector('#map .leaflet-tile-pane');
    if (!pane) return 0;
    const stash = document.createElement('div');
    stash.id = 'hm-smoke-tile-stash';
    stash.hidden = true;
    document.body.appendChild(stash);
    let moved = 0;
    while (pane.firstChild) {
      stash.appendChild(pane.firstChild);
      moved += 1;
    }
    return moved;
  });
  assert(stashed > 0, 'the tile pane was already empty, so this proves nothing about the paint wait');

  let failure = null;
  try {
    await captureVisualSnapshot(page, name, { paintTimeout: 1500 });
  } catch (error) {
    failure = error;
  } finally {
    await page.evaluate(() => {
      const pane = document.querySelector('#map .leaflet-tile-pane');
      const stash = document.getElementById('hm-smoke-tile-stash');
      if (!pane || !stash) return;
      while (stash.firstChild) pane.appendChild(stash.firstChild);
      stash.remove();
    });
  }

  assert(failure, 'a map with nothing painted must not be screenshotted as if it were the app');
  assert(
    failure.message.includes('the basemap never painted'),
    `the unpainted map failed for some other reason: ${failure.message}`,
  );
  // The refusal comes before page.screenshot, so there is no PNG to clean up
  // and visualSnapshotCount is untouched. Assert that rather than assume it.
  const orphan = await stat(path.join(visualSnapshotDir, `${name}.png`)).catch(() => null);
  assert(!orphan, 'the capture wrote a PNG for a map it had already judged unpainted');

  // And the pane has to come back, or every later snapshot in this run is the
  // blank frame this function exists to catch.
  const repainted = await waitForMapPaint(page);
  assert(
    repainted !== 'blank',
    `the stashed tiles did not come back: waitForMapPaint now reports ${repainted}`,
  );
}

// Impacts, the AOML ground-truth artifact, the NCEI billion-dollar table and the
// ONI series are two thirds of the boot payload and paint nothing. Hold all four
// open: the atlas has to become usable anyway, and the two surfaces that read
// them have to fill in once they land.
// A unit or colour change re-renders the storm panel by re-opening it, and
// opening a panel closes the others and takes focus. A reader who opened a storm
// earlier and is now reading the statistics panel must not be thrown back to it.
async function assertSettingsChangeKeepsPanel(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/#v=1&storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
    await page.click('#toggle-stats');
    await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, null, { timeout: 10000 });

    // Minimized is not hidden, so this used to slip past the guard and pull the
    // panel back open over the map with focus.
    await page.evaluate(() => { location.hash = '#v=1&storm=AL122005'; });
    await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
    await page.click('#storm-panel .panel-min-btn');
    await page.waitForFunction(() => document.querySelector('#storm-panel')?.classList.contains('minimized'), null, { timeout: 10000 });
    // 'mph', not the 'kt' it already holds: setSetting returns early on an
    // unchanged value, so asking for the default fires no event at all and the
    // guard below is never reached.
    await page.evaluate(async () => {
      const settings = await import('/src/settings.js');
      settings.setSetting('windUnit', 'mph');
    });
    const minimized = await page.waitForFunction(
      () => document.querySelector('#storm-panel')?.classList.contains('minimized') === false,
      null,
      { timeout: 2000 },
    ).then(() => false).catch(() => true);
    assert(minimized, 'a unit change re-expanded a minimized storm panel');

    await page.evaluate(() => { location.hash = ''; });
    await page.click('#toggle-stats');
    await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, null, { timeout: 10000 });

    for (const [key, value] of [['windUnit', 'mph'], ['damageMode', 'nominal'], ['palette', 'colorblind']]) {
      await page.evaluate(async ([settingKey, settingValue]) => {
        const settings = await import('/src/settings.js');
        settings.setSetting(settingKey, settingValue);
      }, [key, value]);
      // The re-open is asynchronous, so reading the DOM straight after the
      // change passes whether or not the steal is coming. Watch for it instead.
      const stolen = await page.waitForFunction(
        () => document.querySelector('#storm-panel')?.hidden === false,
        null,
        { timeout: 2000 },
      ).then(() => true).catch(() => false);
      assert(!stolen, `changing ${key} pulled the storm panel back over the statistics panel`);
      assert(
        await page.evaluate(() => document.querySelector('#stats-panel')?.hidden === false),
        `changing ${key} closed the statistics panel`,
      );
    }
  } finally {
    await page.close();
  }
}

// A setting changed from the open settings menu re-renders the storm panel
// behind it. Re-rendering is not opening, and it must not take focus out of the
// control the reader is still using.
async function assertSettingsMenuKeepsFocus(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/#v=1&storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
    await page.click('#toggle-settings');
    await page.waitForSelector('#settings-menu:popover-open', { timeout: 10000 });
    const unitControl = '#settings-menu [data-set-unit="mph"]';
    const control = await page.$(unitControl);
    assert(control, 'the settings menu no longer offers a wind-unit control this can drive');
    // Reading focus once after the change proved nothing. The re-render is
    // asynchronous and the steal itself lands inside a requestAnimationFrame,
    // so the read ran first and passed with the theft still queued: putting the
    // defect back left this green. Record every focus that leaves the menu, and
    // count the panel's re-renders so a run where nothing re-rendered fails
    // rather than passing for the wrong reason.
    await page.evaluate(() => {
      window.__hmFocusEscapes = [];
      window.__hmStormShown = 0;
      document.addEventListener('focusin', () => {
        if (document.activeElement?.closest('#settings-menu')) return;
        window.__hmFocusEscapes.push(
          document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || 'unknown',
        );
      });
      document.addEventListener('hm-panel:shown', (event) => {
        if (event.detail?.id === 'storm-panel') window.__hmStormShown += 1;
      });
    });
    await control.focus();
    await control.click();
    await page.waitForFunction(async () => {
      const settings = await import('/src/settings.js');
      return settings.getSetting('windUnit') === 'mph';
    }, null, { timeout: 10000 });
    const reRendered = await page.waitForFunction(() => window.__hmStormShown > 0, null, { timeout: 15000 })
      .then(() => true).catch(() => false);
    assert(reRendered, 'changing the wind unit never re-rendered the storm panel, so this assertion proved nothing');
    const escaped = await page.waitForFunction(
      () => (window.__hmFocusEscapes.length > 0 ? window.__hmFocusEscapes : false),
      null,
      { timeout: 2000 },
    ).then(handle => handle.jsonValue()).catch(() => null);
    const menuOpen = await page.evaluate(() => document.querySelector('#settings-menu')?.matches(':popover-open') === true);
    assert(
      menuOpen && !escaped,
      `changing a setting from the menu moved focus to ${escaped ? escaped.join(', ') : 'nowhere'}${menuOpen ? '' : ' and closed the menu'}`,
    );
  } finally {
    await page.close();
  }
}
// Activating a similar-storms row re-renders the panel, which destroys the very
// button that was activated. Focus fell to <body>, so a keyboard reader was
// returned to the top of the document with no idea where they were. Making the
// rows focusable without this is worse than leaving them unreachable.
async function assertRowActivationKeepsFocus(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/#v=1&storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel .similar-storm-row', { timeout: 15000 });
    const before = await page.evaluate(() => document.querySelector('#storm-panel h2')?.textContent || '');
    await page.focus('#storm-panel .similar-storm-row');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (heading) => (document.querySelector('#storm-panel h2')?.textContent || '') !== heading,
      before,
      { timeout: 15000 },
    );
    // The move is deferred to an animation frame, so watch for it rather than
    // sampling once; reading straight after the re-render passes either way.
    const landed = await page.waitForFunction(
      () => {
        const active = document.activeElement;
        return Boolean(active) && active !== document.body && active !== document.documentElement;
      },
      null,
      { timeout: 3000 },
    ).then(() => true).catch(() => false);
    const where = await page.evaluate(() => ({
      tag: document.activeElement?.tagName || null,
      inPanel: Boolean(document.activeElement?.closest('#storm-panel')),
      heading: document.querySelector('#storm-panel h2')?.textContent || '',
    }));
    assert(before && where.heading && where.heading !== before, `activating a similar-storms row did not open another storm: ${where.heading}`);
    assert(landed && where.inPanel, `activating a similar-storms row dropped focus to ${where.tag}`);
  } finally {
    await page.close();
  }
}

// applyFilters() empties the one Leaflet layer the panel's track lives in, and
// a theme or high-contrast change goes through it. The panel stayed open naming
// a storm with no track on the map, and nothing redrew it.
async function assertThemeChangeKeepsStormTrack(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/#v=1&storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#map path').length > 5, null, { timeout: 15000 });
    const before = await page.evaluate(() => document.querySelectorAll('#map path').length);
    for (const [key, value] of [['theme', 'light'], ['highContrast', true]]) {
      await page.evaluate(async ([settingKey, settingValue]) => {
        const settings = await import('/src/settings.js');
        settings.setSetting(settingKey, settingValue);
      }, [key, value]);
      const redrawn = await page.waitForFunction(
        (expected) => document.querySelectorAll('#map path').length >= expected,
        before,
        { timeout: 10000 },
      ).then(() => true).catch(() => false);
      const state = await page.evaluate(() => ({
        paths: document.querySelectorAll('#map path').length,
        open: document.querySelector('#storm-panel')?.hidden === false,
        heading: document.querySelector('#storm-panel h2')?.textContent || '',
      }));
      assert(state.open, `changing ${key} closed the storm panel`);
      assert(
        redrawn && state.paths >= before,
        `changing ${key} left the open panel (${state.heading}) with no track: ${before} paths became ${state.paths}`,
      );
    }
  } finally {
    await page.close();
  }
}

// Two things the storm panel owes the map. A similar-storms row has to open the
// storm it names, and closing the panel must not take the "show tracks" filter's
// own tracks with it: they share one Leaflet layer, so clearing the layer looked
// like the panel tidying up after itself and was really the filter going blank
// while its checkbox and the URL both still said it was on.
async function assertStormPanelMapContracts(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/#v=1&storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel .similar-storm-row', { timeout: 15000 });
    const before = await page.evaluate(() => document.querySelector('#storm-panel h2')?.textContent || '');
    // Reachable by keyboard: the rows carried cursor:pointer, no tabindex, no
    // role and no key handling, so nobody navigating by keyboard could open one.
    const rowIsFocusable = await page.evaluate(() => {
      const row = document.querySelector('#storm-panel .similar-storm-row');
      if (!row) return null;
      row.focus();
      return { tag: row.tagName, focused: document.activeElement === row };
    });
    assert(
      rowIsFocusable?.focused,
      `a similar-storms row cannot be focused: ${JSON.stringify(rowIsFocusable)}`,
    );

    await page.evaluate(() => localStorage.removeItem('hm-search-history-v1'));
    await page.click('#storm-panel .similar-storm-row');
    await page.waitForFunction(
      (previous) => (document.querySelector('#storm-panel h2')?.textContent || '') !== previous,
      before,
      { timeout: 15000 },
    );
    const opened = await page.evaluate(() => ({
      heading: document.querySelector('#storm-panel h2')?.textContent || '',
      body: document.querySelector('#panel-body')?.textContent || '',
      hash: location.hash,
    }));
    assert(
      !/record unavailable/i.test(opened.body),
      `a similar-storms row could not open its storm: ${opened.heading}`,
    );
    assert(
      /storm=AL\d{6}/.test(opened.hash) && !opened.hash.includes('storm=AL122005'),
      `a similar-storms row did not put its storm in the URL: ${opened.hash}`,
    );
    // A us_landfalls record carries no name or year, and the history store drops
    // an entry without an integer year, so this opened a storm and recorded
    // nothing at all.
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('hm-search-history-v1') || 'null'));
    assert(
      history?.entries?.length >= 1 && Number.isInteger(history.entries[0]?.year),
      `a similar-storms open recorded no view history: ${JSON.stringify(history)}`,
    );

    // The filter's tracks and the panel's own track share one Leaflet layer.
    // Opening a storm used to clear the layer and draw only that storm, so the
    // filter went blank with its checkbox still ticked.
    await page.goto(`${baseUrl}/#v=1&y=2005-2005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.click('#toggle-filters');
    await page.locator('#show-tracks').visible().waitFor({ timeout: 10000 });
    await page.check('#show-tracks');
    await page.waitForFunction(() => document.querySelectorAll('#map path').length > 40, null, { timeout: 15000 });
    const beforeOpen = await page.evaluate(() => document.querySelectorAll('#map path').length);
    await page.evaluate(() => { location.hash = '#v=1&y=2005-2005&t=1&storm=AL122005'; });
    await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
    // The same hash change turns the filter on, and its redraw is asynchronous,
    // so the first row can appear while the layer is still being rebuilt.
    // Sampling the count there caught a transient dip of a few paths and failed
    // on a map that was about to be correct. Wait for the recovery the way the
    // sibling assertion below already does: a real wipe never recovers, so this
    // still fails on the defect it was written for.
    await page.waitForFunction(
      (expected) => document.querySelectorAll('#map path').length >= expected,
      beforeOpen,
      { timeout: 10000 },
    ).catch(() => {});
    const whileOpen = await page.evaluate(() => ({
      paths: document.querySelectorAll('#map path').length,
      checked: document.querySelector('#show-tracks')?.checked,
    }));
    assert(
      whileOpen.checked && whileOpen.paths >= beforeOpen,
      `opening a storm wiped the filter's tracks: ${beforeOpen} paths became ${whileOpen.paths} with the box still ${whileOpen.checked ? 'ticked' : 'clear'}`,
    );

    await page.goto(`${baseUrl}/#v=1&y=2005-2005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.click('#toggle-filters');
    await page.locator('#show-tracks').visible().waitFor({ timeout: 10000 });
    await page.check('#show-tracks');
    await page.waitForFunction(() => document.querySelectorAll('#map path').length > 40, null, { timeout: 15000 });
    const withTracks = await page.evaluate(() => document.querySelectorAll('#map path').length);

    await page.evaluate(() => { location.hash = '#v=1&y=2005-2005&t=1&storm=AL122005'; });
    await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
    await page.click('#toggle-stats');
    await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, null, { timeout: 10000 });
    await page.waitForFunction(
      (expected) => document.querySelectorAll('#map path').length >= expected,
      withTracks,
      { timeout: 10000 },
    ).catch(() => {});
    const afterOtherPanel = await page.evaluate(() => ({
      paths: document.querySelectorAll('#map path').length,
      checked: document.querySelector('#show-tracks')?.checked,
    }));
    assert(
      afterOtherPanel.checked && afterOtherPanel.paths >= withTracks,
      `opening another panel wiped the filter's tracks: ${withTracks} paths became ${afterOtherPanel.paths} with the box still ${afterOtherPanel.checked ? 'ticked' : 'clear'}`,
    );
  } finally {
    await page.close();
  }
}

async function assertDeferredDataScope(context, baseUrl) {
  const deferred = ['impacts.json', 'billions.json', 'enso.json', 'aoml-landfalls.json'];
  // Long enough that the app is up and one assertion has run while the four are
  // still unanswered, short enough that the data fetch's own 10s timeout never
  // fires, so they arrive rather than falling back to nothing. Each case gets
  // its own page and its own hold: sharing one budget across all of them let a
  // later assertion run after the release and pass for the wrong reason.
  const HOLD_MS = 6000;

  // Hold the four open on a fresh page and hand back when they were requested.
  const heldPage = async (holdMs = HOLD_MS) => {
    const page = await context.newPage();
    const heldUntil = Date.now() + holdMs;
    const requested = new Map(deferred.map((file) => {
      let seen = null;
      const promise = new Promise((resolve) => { seen = resolve; });
      return [file, { promise, seen }];
    }));
    for (const file of deferred) {
      await page.route(`**/data/${file}`, async (route) => {
        requested.get(file).seen();
        const remaining = heldUntil - Date.now();
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        await route.continue();
      });
    }
    return { page, heldUntil, requested };
  };

  // 1. The atlas becomes usable while all four are still unanswered, and the two
  //    surfaces that read them fill in once they land.
  {
    const { page, heldUntil, requested } = await heldPage();
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      const readyAt = Date.now();
      assert(readyAt < heldUntil, `the first screen waited ${readyAt - heldUntil}ms past the deferred datasets`);
      await Promise.all([...requested.values()].map(entry => entry.promise));
      const beforeRelease = await page.evaluate(async () => {
        const { getAomlValidation, getImpactsFor } = await import('/src/data.js');
        return { aoml: Boolean(getAomlValidation()), impacts: Boolean(getImpactsFor('AL122005')) };
      });
      assert(!beforeRelease.aoml && !beforeRelease.impacts, `deferred datasets resolved before they were released: ${JSON.stringify(beforeRelease)}`);

      await page.evaluate(() => { location.hash = '#v=1&storm=AL122005'; });
      await page.waitForSelector('#storm-panel .im-row', { timeout: 15000 });
      await page.click('#toggle-info');
      await page.waitForFunction(() => {
        const text = document.querySelector('#aoml-validation')?.textContent || '';
        return /precision/.test(text) && /recall/.test(text);
      }, null, { timeout: 15000 });
    } finally {
      await page.close();
    }
  }

  // 2. On This Date imports showStorm from panel.js directly rather than through
  //    main.js's lazy loader, so it used to render "NOAA NCEI data unavailable"
  //    and "no impact record is bundled" as statements of fact while both files
  //    were still in flight. Watch for the claim appearing rather than reading
  //    the panel once: a single read runs after the release as easily as before
  //    it, and passes either way.
  {
    // The hold has to end inside the data fetch's own 10s timeout, or the four
    // fall back to nothing and the panel says "unavailable" for a real reason.
    // Boot plus the storms archive plus opening two panels does not fit in that,
    // so the page is warmed first with no routes registered: the reload refetches
    // the deferred four while everything else comes from the browser cache.
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.evaluate(async () => {
        const { ensureStormsLoaded } = await import('/src/data.js');
        await ensureStormsLoaded();
      });
      const heldUntil = Date.now() + 9000;
      for (const file of deferred) {
        await page.route(`**/data/${file}`, async (route) => {
          const remaining = heldUntil - Date.now();
          if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
          await route.continue();
        });
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.click('#toggle-on-this-date');
      await page.waitForSelector('.otd-link', { timeout: 15000 });
      await page.click('.otd-link');
      // The third argument is the options: passed second it is read as the page
      // function's argument, the default 30s timeout applies, and a probe whose
      // whole meaning is "within 1.5 seconds" quietly becomes "within thirty".
      const claimedTooEarly = await page.waitForFunction(
        () => /unavailable|not bundled|no wikipedia impact record/i
          .test(document.querySelector('#storm-panel')?.textContent || ''),
        null,
        { timeout: 1500 },
      ).then(() => true).catch(() => false);
      assert(
        Date.now() < heldUntil,
        `the On This Date check ran ${Date.now() - heldUntil}ms after its hold expired, so it proved nothing`,
      );
      assert(
        !claimedTooEarly,
        'a storm opened from On This Date called the deferred data unavailable while it was still loading',
      );
    } finally {
      await page.close();
    }
  }
}

// The data-release pin makes a shared link cite an exact release, which is worth
// having on a link somebody meant to share and not on the address bar of a page
// they just opened. Cold load: no fragment at all. Shape the view: the pin rides
// along, and the resulting URL restores what it describes.
async function assertReleasePinScope(context, baseUrl) {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const cold = await page.evaluate(() => ({ hash: location.hash, href: location.href }));
    assert(cold.hash === '', `a cold load put a fragment on the address bar: ${cold.hash}`);
    assert(!cold.href.includes('#'), `a cold load left a '#' in the URL: ${cold.href}`);

    // Same again for a reader who has settings stored. The unit and the damage
    // mode reach writeHash from settings on every load, so with them counted as
    // shaped state a cold load carried a fragment for anyone who had ever
    // changed either one.
    const configured = await context.newPage();
    try {
      await configured.addInitScript(() => {
        if (window.top !== window) return;
        localStorage.setItem('hm-settings-v1', JSON.stringify({
          onboarded: true, schema_version: 1, windUnit: 'mph', damageMode: 'nominal',
        }));
      });
      await configured.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(configured);
      const stored = await configured.evaluate(() => location.href);
      assert(!stored.includes('#'), `a cold load with stored settings put a fragment on the address bar: ${stored}`);
    } finally {
      await configured.close();
    }

    // The filters panel starts collapsed at every viewport, and its contents are
    // visibility:hidden until it is opened, so shaping the view means taking the
    // same first step a reader does.
    await page.click('#toggle-filters');
    await page.locator('#state-filter').visible().waitFor({ timeout: 10000 });
    await page.selectOption('#state-filter', 'Florida');
    await page.waitForFunction(() => /(?:^|&)s=Florida(?:&|$)/.test(location.hash), null, { timeout: 10000 });
    const shaped = await page.evaluate(() => location.href);
    assert(/#v=1&s=Florida&rel=[a-f0-9]{64}$/.test(shaped), `a shaped view did not carry the release pin: ${shaped}`);

    const shared = await context.newPage();
    try {
      await shared.goto(shaped, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(shared);
      const value = await shared.evaluate(() => document.querySelector('#state-filter')?.value || '');
      assert(value === 'Florida', `a shared release-pinned link did not restore its view: ${value}`);
    } finally {
      await shared.close();
    }

    // The Share button copies whatever is in the address bar, and it only exists
    // inside an open storm panel. Opening one from On This Date bypasses the
    // map's click handler, so the URL used to describe a different view than the
    // panel on screen.
    const viaOnThisDate = await context.newPage();
    try {
      await viaOnThisDate.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(viaOnThisDate);
      await viaOnThisDate.click('#toggle-on-this-date');
      await viaOnThisDate.waitForSelector('.otd-link', { timeout: 15000 });
      const stormId = await viaOnThisDate.getAttribute('.otd-link', 'data-storm-id');
      await viaOnThisDate.click('.otd-link');
      await viaOnThisDate.waitForSelector('#share-btn', { timeout: 15000 });
      const copied = await viaOnThisDate.evaluate(() => location.href);
      assert(
        copied.includes(`storm=${stormId}`) && /&rel=[a-f0-9]{64}/.test(copied),
        `Share would copy a link that does not describe the open storm: ${copied}`,
      );
    } finally {
      await viaOnThisDate.close();
    }
  } finally {
    await page.close();
  }
}

async function assertDialogAndKeyboardContracts(page) {
  await page.evaluate(async () => {
    document.querySelector('#toggle-info')?.focus();
    scrollTo(0, 0);
  });
  await page.keyboard.press('Shift+/');
  await page.waitForFunction(() => document.querySelector('#keyboard-palette')?.open, null, { timeout: 5000 });
  assert(await page.evaluate(() => document.activeElement?.classList.contains('palette-close')), 'shortcut dialog did not focus its close button');
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement?.classList.contains('palette-close')), 'single-control shortcut dialog did not trap Tab');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => document.activeElement?.id === 'toggle-info'), 'shortcut dialog did not return focus to its opener');

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#info-modal')?.hidden, null, { timeout: 5000 });
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

// A feed status card is fixed-position over the map, and on a phone the map is
// also where the storm panel and the timeline live. Both cards used to sit on
// top of an open panel: the outlook card covered the panel's lower half and the
// timeline, the active card covered its header.
async function assertNoOverlayCoversOpenPanel(page, label) {
  // Force both cards into a state that would render them. On a server with no
  // /nhc/ relay the feeds are unsupported and their hosts are hidden anyway, so
  // without this the check passes whether or not the rule that hides them
  // behind an open panel still exists.
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    for (const id of ['active', 'outlook']) feeds.failOptionalFeed(id, { responseStatus: 503 });
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.optional-feed-status-overlay')].some(element => !element.hidden),
    null,
    { timeout: 5000 },
  );
  const collisions = await page.evaluate(() => {
    const panel = document.querySelector('#storm-panel');
    if (!panel || panel.hidden) return 'no open storm panel';
    const panelRect = panel.getBoundingClientRect();
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return [...document.querySelectorAll('.optional-feed-status-overlay')]
      .filter(element => {
        const style = getComputedStyle(element);
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map(element => ({ id: element.id, rect: element.getBoundingClientRect() }))
      .filter(entry => overlaps(entry.rect, panelRect))
      .map(entry => entry.id);
  });
  assert(collisions !== 'no open storm panel', `${label}: the storm panel was not open, so the overlay check proved nothing`);
  assert(!collisions.length, `${label}: feed status overlays sit on top of the open storm panel: ${collisions.join(', ')}`);

  // Positive control: with the panel closed the same cards must be on screen,
  // so a green result means they were hidden by the panel and not by something
  // that had already removed them.
  await page.evaluate(async () => {
    const panels = await import('/src/panels.js');
    panels.closeAllPanels();
  });
  await page.waitForFunction(() => document.querySelector('#storm-panel')?.hidden === true, null, { timeout: 5000 });
  const visibleWithoutPanel = await page.evaluate(() => [...document.querySelectorAll('.optional-feed-status-overlay')]
    .filter(element => !element.hidden && getComputedStyle(element).display !== 'none')
    .map(element => element.id));
  assert(
    visibleWithoutPanel.length > 0,
    `${label}: the feed cards were not visible even with no panel open, so the collision check proved nothing`,
  );
  await page.evaluate(async () => {
    const feeds = await import('/src/optional-feeds.js');
    for (const id of ['active', 'outlook']) feeds.unsupportedOptionalFeed(id);
  });
  // Hand the panel back open: the caller snapshots it next.
  await openKatrinaPanel(page);
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

async function assertMobileHeaderReachability(page, label, { requireOverflow = false } = {}) {
  const state = await page.evaluate(() => {
    const rail = document.querySelector('.header-actions');
    if (!rail) return { error: 'header action rail is missing' };
    const buttons = [...rail.querySelectorAll(':scope > button.icon-btn')];
    const visibleInRail = button => {
      const railRect = rail.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        rect.left >= railRect.left - 0.5 && rect.right <= railRect.right + 0.5;
    };
    const dispatchKey = key => rail.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const initialScroll = rail.scrollLeft;
    rail.focus();
    dispatchKey('ArrowRight');
    const arrowRightScroll = rail.scrollLeft;
    dispatchKey('End');
    const endScroll = rail.scrollLeft;
    const endVisible = visibleInRail(buttons.at(-1));
    dispatchKey('Home');
    const homeScroll = rail.scrollLeft;
    const homeVisible = visibleInRail(buttons[0]);
    const eachButtonReachable = buttons.map(button => {
      button.focus();
      return visibleInRail(button);
    });
    return {
      buttonCount: buttons.length,
      tabIndex: rail.tabIndex,
      shortcuts: rail.getAttribute('aria-keyshortcuts') || '',
      scrollable: rail.dataset.scrollable === 'true',
      initialScroll,
      arrowRightScroll,
      endScroll,
      homeScroll,
      maxScroll: Math.max(0, rail.scrollWidth - rail.clientWidth),
      endVisible,
      homeVisible,
      eachButtonReachable,
    };
  });
  assert(!state.error, `${label}: ${state.error}`);
  assert(state.buttonCount >= 9, `${label}: expected all primary header actions, got ${state.buttonCount}`);
  assert(state.tabIndex === 0, `${label}: header action rail is not keyboard-focusable`);
  assert(/ArrowLeft/.test(state.shortcuts) && /ArrowRight/.test(state.shortcuts) && /Home/.test(state.shortcuts) && /End/.test(state.shortcuts), `${label}: header rail keyboard shortcuts are incomplete`);
  if (requireOverflow) {
    assert(state.scrollable, `${label}: header action rail does not expose horizontal overflow`);
    assert(state.arrowRightScroll > state.initialScroll, `${label}: ArrowRight did not advance the header action rail`);
    assert(state.endScroll >= state.maxScroll - 1, `${label}: End did not reach the header action rail end`);
    assert(state.homeScroll <= 1, `${label}: Home did not return the header action rail to its start`);
  }
  assert(state.endVisible && state.homeVisible && state.eachButtonReachable.every(Boolean), `${label}: one or more primary header actions cannot be brought fully into view`);
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
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const live = document.querySelector('.anim-live-region');
    return live?.getAttribute('role') === 'status' && Boolean(live.textContent?.trim());
  }, null, { timeout: 5000 });
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
  ), null, { timeout: 5000 });
}

async function assertSettingsSurface(page, label) {
  await page.evaluate(() => {
    const menu = document.querySelector('#settings-menu');
    if (menu && !menu.matches(':popover-open')) menu.showPopover();
  });
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'), null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#storage-manager .storage-scope').length === 5, null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#offline-diagnostics')?.dataset.ready === 'true', null, { timeout: 10000 });
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
  assert(layout.radioGroups.length === 7, `${label}: expected seven settings radio groups`);
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

// A `points` attribute the SVG parser rejected leaves an empty point list and a
// zero-area box while the element, its class and its stroke all look healthy,
// so the chart reads as working with no data. Measure the parsed geometry, not
// the attribute string.
// The colourblind palette is a promise that category colour means the same
// thing everywhere: "Keeps category color meaning consistent across the map and
// panels." It reached the markers and the timeline, which read the tokens, and
// not the heatmap gradient, the wind-field rings or the chart's Saffir-Simpson
// bands, which each carried a copy of the Catppuccin hexes. Selecting the
// palette repainted half the app and left the other half contradicting it.
async function assertPaletteReachesEveryLayer(page, label) {
  const sample = async palette => page.evaluate(async nextPalette => {
    const settings = await import('/src/settings.js');
    const data = await import('/src/data.js');
    const chart = await import('/src/chart.js');
    settings.setSetting('palette', nextPalette);
    settings.invalidatePaletteCache();
    settings.applyPaletteToBody();
    await data.ensureStormsLoaded();
    const storm = data.getAllStorms().find(item => item.id === 'AL122005');
    const host = document.createElement('div');
    chart.renderIntensityChart(host, storm);
    return {
      gradient: [-1, 1, 2, 3, 4, 5].map(category => settings.getPaletteColor(category)),
      bands: [...host.innerHTML.matchAll(/<rect[^>]*fill="(rgba\([^"]*\))"/g)].map(match => match[1]),
    };
  }, palette);

  const before = await sample('default');
  const after = await sample('colorblind');
  await page.evaluate(async () => {
    const settings = await import('/src/settings.js');
    settings.setSetting('palette', 'default');
    settings.invalidatePaletteCache();
    settings.applyPaletteToBody();
  });

  assert(before.bands.length >= 5, `${label}: the intensity chart drew no category bands`);
  assert(
    JSON.stringify(before.gradient) !== JSON.stringify(after.gradient),
    `${label}: the category palette did not change when the colourblind setting was selected`,
  );
  assert(
    JSON.stringify(before.bands) !== JSON.stringify(after.bands),
    `${label}: the intensity chart's category bands ignore the colourblind palette`,
  );
}

async function assertClimateTrendLinesDraw(page, label) {
  const lines = await page.evaluate(() => Array.from(document.querySelectorAll('#stats-panel polyline.ct-line')).map(line => {
    const box = line.getBBox();
    return {
      name: line.getAttribute('class'),
      points: line.points.numberOfItems,
      width: box.width,
      height: box.height,
    };
  }));
  assert(lines.length === 3, `${label}: expected three climate trend lines, found ${lines.length}`);
  for (const line of lines) {
    assert(line.points > 1, `${label}: ${line.name} parsed ${line.points} points, so its curve does not draw`);
    assert(line.width > 0 && line.height > 0, `${label}: ${line.name} draws an empty ${line.width}x${line.height} box`);
  }
  // All three read the same rolling-average series, so a parser that dropped
  // part of one attribute shows up as a disagreement here.
  const counts = new Set(lines.map(line => line.points));
  assert(counts.size === 1, `${label}: trend lines parsed different point counts (${[...counts].join(', ')})`);
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
  }, null, { timeout: 10000 });

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
  await page.waitForFunction(() => !document.querySelector('#state-panel')?.hidden && /Florida/.test(document.querySelector('#state-panel')?.textContent || ''), null, { timeout: 10000 });
  await assertPanelFit('#state-panel', 'state panel');
  // These used to be <li role="button" tabindex="0">, which is what this
  // assertion checked for. That spelling replaced each row's listitem role, so
  // the two <ul>s around them contained no list items at all and axe reported
  // it as a serious violation. The rows are real buttons inside plain <li>s
  // now, so the attributes are gone and the semantics come from the element:
  // the property being asserted is unchanged, only the spelling of it.
  const stateRows = await page.evaluate(() => [...document.querySelectorAll('#state-panel .state-storm-row')].map(row => ({
    tag: row.tagName,
    parentTag: row.parentElement?.tagName,
    focusable: row.tabIndex >= 0,
    label: row.getAttribute('aria-label') || '',
  })).slice(0, 12));
  assert(stateRows.length >= 5, `${label}: state panel did not render enough storm rows`);
  assert(
    stateRows.every(row => row.tag === 'BUTTON' && row.parentTag === 'LI' && row.focusable && /^Open .+ storm details/.test(row.label)),
    `${label}: state rows are not keyboard-accessible buttons inside list items`,
  );
  // The shape assertion above would still pass if the <li>s picked up
  // role="presentation", which axe reports as a serious `list` violation. No
  // other axe scope covers this panel, because every whole-page run happens
  // with it closed.
  await assertNoAxeViolations(page, `${label} state panel`, '#state-panel');
  await page.focus('#state-panel .state-storm-row');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#storm-panel')?.hidden && /Storm details/.test(document.querySelector('#storm-panel')?.textContent || ''), null, { timeout: 10000 });
  await assertPanelFit('#storm-panel', 'storm panel after keyboard state selection');

  await page.click('#toggle-stats');
  await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, null, { timeout: 10000 });
  await assertPanelFit('#stats-panel', 'statistics panel');
  assert(await page.locator('#stats-panel .citation-block').count() === 1, `${label}: statistics panel did not expose a release citation`);
  await assertClimateTrendLinesDraw(page, label);
  await assertPaletteReachesEveryLayer(page, label);
  // A <header> only exposes the banner role when no sectioning element wraps
  // it, and <main> used to open before the header and close after everything,
  // so the app published one landmark where docs/VPAT.html:71 tells a reader to
  // expect several. Assert the role rather than the markup, because the defect
  // was that correct-looking markup produced the wrong tree.
  const landmarkRoles = await page.evaluate(() => {
    const header = document.querySelector('header.app-header');
    const main = document.querySelector('main#main');
    return {
      headerWrappedBySectioning: Boolean(header?.closest('article, aside, main, nav, section')),
      hasMain: Boolean(main),
      headerInsideMain: Boolean(main && header && main.contains(header)),
    };
  });
  assert(landmarkRoles.hasMain, `${label}: the page has no main landmark`);
  assert(!landmarkRoles.headerInsideMain, `${label}: the header sits inside main, so it is not a banner landmark`);
  assert(!landmarkRoles.headerWrappedBySectioning, `${label}: a sectioning element wraps the header, which suppresses its banner role`);
  // The by-state and by-decade lists sit two abreast in a grid whose tracks are
  // about 106px wide, and the row's minimums added up to more than that, so the
  // count ran into the label of the column beside it and the panel read
  // "273Texas". Measured rather than eyeballed, because a 0.2px overlap looks
  // like kerning in a screenshot.
  const barCollisions = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#stats-panel .bar-row')];
    const out = [];
    for (const row of rows) {
      const count = row.querySelector('.count');
      if (!count) continue;
      const countBox = count.getBoundingClientRect();
      for (const other of rows) {
        if (other === row) continue;
        const otherLabel = other.querySelector('.label');
        if (!otherLabel) continue;
        const labelBox = otherLabel.getBoundingClientRect();
        if (Math.abs(labelBox.top - countBox.top) > 4) continue;
        const gap = labelBox.left - countBox.right;
        if (gap > -2 && gap < 4) out.push(`${count.textContent}|${otherLabel.textContent.trim()} gap ${gap.toFixed(1)}px`);
      }
    }
    return out.slice(0, 6);
  });
  assert(!barCollisions.length, `${label}: stats bar rows collide with the next column: ${barCollisions.join(', ')}`);
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
  await page.waitForFunction(() => document.querySelector('#offline-diagnostics')?.dataset.ready === 'true', null, { timeout: 10000 });
  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-diagnostics-export]');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  const bundle = JSON.parse(body);
  // 2 since the storage figures were renamed to say they are approximate.
  assert(bundle.schema_version === 2 && bundle.app?.version === expectedGeneratorVersion, 'support bundle is missing app/schema versions');
  assert(
    'usage_bytes_approximate' in (bundle.storage || {}) && !('usage_bytes' in (bundle.storage || {})),
    `support bundle still names the padded browser estimate as though it were exact: ${Object.keys(bundle.storage || {}).join(', ')}`,
  );
  assert(bundle.storage?.scopes?.length === 5, 'support bundle is missing cache scope versions and sizes');
  assert(['coherent', 'unverified'].includes(bundle.release?.state), `support bundle returned an invalid release state: ${bundle.release?.state}`);
  assert(Array.isArray(bundle.optional_feeds) && bundle.optional_feeds.length >= 10, 'support bundle is missing optional-feed readiness');
  assert(!/PRIVATE VIEW|PRIVATE SEARCH|PRIVATE ANSWER|25\.7617|-80\.1918|saved.?views|search.?history|preparedness|\"lat\"|\"lon\"/i.test(body), 'support bundle leaked private local state');
  const activeDataCache = 'hm-data-hm-v1.9.3';
  await page.evaluate(async (dataCacheName) => {
    await (await caches.open('hm-tiles-v2')).put('/recoverable-tile', new Response('tile'));
    await (await caches.open(dataCacheName)).put('/protected-history', new Response('history'));
  }, activeDataCache);
  await page.click('[data-clear-storage="tiles"]');
  await page.waitForSelector('#confirm-local-action[open]');
  assert(/Map tiles/.test(await page.locator('#confirm-local-action').textContent()), 'storage confirmation did not name its scope');
  await page.click('#confirm-local-action .confirm-action-cancel');
  await page.waitForFunction(() => document.activeElement?.matches('[data-clear-storage="tiles"]'));
  assert(await page.evaluate(async () => (
    Boolean(await (await caches.open('hm-tiles-v2')).match('/recoverable-tile')) &&
    document.activeElement?.matches('[data-clear-storage="tiles"]')
  )), 'cancelling cache clearing removed data or lost invoker focus');
  await page.click('[data-clear-storage="tiles"]');
  await page.click('#confirm-local-action .confirm-action-submit');
  await page.waitForFunction(async (dataCacheName) => (
    !(await caches.keys()).includes('hm-tiles-v2') &&
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

// The map's own zoom control, which nothing held to being usable. It was
// invisible on every phone viewport for one commit: a rule keyed on
// `#active-feed-status:not([hidden])` matched from first paint, because
// src/active.js creates that card unhidden and never sets the attribute.
// assertSidePanelLayout only checks the storm panel does not overlap it, which
// a 0x0 control satisfies perfectly.
//
// Withheld and buried are told apart deliberately. Below 720px the layout fades
// the control away with the filter drawer open, on purpose and in one place;
// that is a choice. Being painted, opaque and underneath something else is not.
async function assertMapZoomControlUsable(page, label) {
  const state = await page.evaluate(() => {
    const node = document.querySelector('.leaflet-control-zoom');
    if (!node) return { present: false };
    const container = node.closest('.leaflet-top') || node;
    // pointer-events is read from the control, never the container: Leaflet
    // gives .leaflet-top pointer-events:none as a matter of course and
    // re-enables it per control, so reading the container calls every state
    // withheld, including the ones where the control is plainly on screen.
    const hidden = [node, container].some(target => {
      const style = getComputedStyle(target);
      return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
    });
    if (hidden || getComputedStyle(node).pointerEvents === 'none') return { present: true, withheld: true };
    const rect = node.getBoundingClientRect();
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    const onScreen = rect.width > 0 && rect.height > 0
      && rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    const hit = onScreen ? document.elementFromPoint(centreX, centreY) : null;
    const describe = element => element
      ? `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : '.' + String(element.className || '').split(' ')[0]}`
      : 'nothing';
    return {
      present: true,
      withheld: false,
      onScreen,
      reachable: Boolean(hit && node.contains(hit)),
      box: `${Math.round(rect.width)}x${Math.round(rect.height)} at ${Math.round(rect.x)},${Math.round(rect.y)}`,
      covering: hit && !node.contains(hit) ? describe(hit) : null,
    };
  });
  assert(state.present, `${label}: the map has no zoom control`);
  if (state.withheld) return false;
  assert(state.onScreen, `${label}: the zoom control is off screen or has no box (${state.box})`);
  assert(
    state.reachable,
    `${label}: the zoom control is ${state.box} but ${state.covering} sits on top of it`,
  );
  return true;
}

// Text that floats over the map, measured from the pixels rather than from the
// ancestor chain.
//
// #timeline and the Leaflet attribution are siblings of #map with alpha, so a
// tenth of whatever the reader has panned to comes through them. measureContrast
// walks parentElement and composites them onto <body>: it reported 4.86:1 for
// ribbon text that reads 3.89:1 over dark imagery, and it cannot do better,
// because the surface behind is not an ancestor.
//
// The map is flattened to white and then to black, which brackets every tile
// set and every overlay the app can put there, and each run is judged on the
// colour actually painted behind the text.
const OVER_MAP_TARGETS = [
  ['timeline source', '.timeline-source'],
  ['timeline legend', '.timeline-legend'],
  ['timeline legend item', '.timeline-legend span'],
  ['timeline year label', '.timeline-labels span'],
  ['timeline toggle', '.timeline-toggle'],
  ['map attribution', '.leaflet-control-attribution'],
  ['map attribution link', '.leaflet-control-attribution a'],
];

async function assertOverMapContrast(browser, baseUrl) {
  const decoder = await browser.newPage();
  await decoder.goto('data:text/html,<canvas id=c></canvas>');
  let measured = 0;
  try {
    for (const profile of [
      { theme: 'light', highContrast: false, minimum: 4.5 },
      { theme: 'dark', highContrast: false, minimum: 4.5 },
      { theme: 'light', highContrast: true, minimum: 7 },
      { theme: 'dark', highContrast: true, minimum: 7 },
    ]) {
      for (const [mapLabel, mapColour] of [['a white map', '#ffffff'], ['a black map', '#000000']]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
        await seedSettings(context, { onboarded: true, theme: profile.theme, highContrast: profile.highContrast, reducedMotion: true, locale: 'en' });
        await stubQuietTropics(context);
        const page = await context.newPage();
        try {
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
          await waitForAppReady(page);
          await page.addStyleTag({
            content: `.leaflet-tile-pane, .leaflet-overlay-pane { display: none !important; }
                      .leaflet-container { background: ${mapColour} !important; }`,
          });
          await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));

          const boxes = await page.evaluate(targets => targets.map(([name, selector]) => {
            const node = document.querySelector(selector);
            if (!node) return { name, selector, missing: true };
            const rect = node.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) return { name, selector, missing: true };
            const style = getComputedStyle(node);
            const ink = (style.color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            return { name, selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: style.color, ink };
          }), OVER_MAP_TARGETS);
          const missing = boxes.filter(box => box.missing);
          assert(!missing.length, `over-map contrast ${profile.theme} over ${mapLabel}: could not measure ${missing.map(box => box.name).join(', ')}`);

          const png = await page.screenshot({ type: 'png' });
          const sampled = await decoder.evaluate(async ({ dataUrl, items }) => {
            const image = new Image();
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
            const canvas = document.getElementById('c');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context2d = canvas.getContext('2d', { willReadFrequently: true });
            context2d.drawImage(image, 0, 0);
            return items.map(item => {
              const x = Math.max(0, Math.round(item.x));
              const y = Math.max(0, Math.round(item.y));
              const width = Math.max(1, Math.min(Math.round(item.width), canvas.width - x));
              const height = Math.max(1, Math.min(Math.round(item.height), canvas.height - y));
              const { data } = context2d.getImageData(x, y, width, height);
              const counts = new Map();
              for (let index = 0; index < data.length; index += 4) {
                const rgb = [data[index], data[index + 1], data[index + 2]];
                // Glyph pixels and their antialiased fringe are not the
                // background. Without this the vote returns the ink itself for
                // anything whose box is tight around dense text.
                if (Math.abs(rgb[0] - item.ink[0]) + Math.abs(rgb[1] - item.ink[1]) + Math.abs(rgb[2] - item.ink[2]) < 90) continue;
                const key = rgb.join(',');
                counts.set(key, (counts.get(key) || 0) + 1);
              }
              if (!counts.size) return { name: item.name, background: null };
              let background = null;
              let best = -1;
              for (const [key, count] of counts) if (count > best) { best = count; background = key; }
              return { name: item.name, background: background.split(',').map(Number) };
            });
          }, { dataUrl: `data:image/png;base64,${png.toString('base64')}`, items: boxes });

          const channel = value => {
            const normalized = value / 255;
            return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
          };
          const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
          const failed = [];
          for (const box of boxes) {
            const pixel = sampled.find(entry => entry.name === box.name);
            assert(pixel?.background, `over-map contrast: every pixel behind ${box.name} is its own ink, so nothing was measured`);
            const high = Math.max(luminance(box.ink), luminance(pixel.background));
            const low = Math.min(luminance(box.ink), luminance(pixel.background));
            const value = Number(((high + 0.05) / (low + 0.05)).toFixed(2));
            measured += 1;
            if (value < profile.minimum) failed.push(`${box.name} ${value} on rgb(${pixel.background})`);
          }
          assert(
            !failed.length,
            `over ${mapLabel}, ${profile.theme}${profile.highContrast ? ' + high contrast' : ''} below ${profile.minimum}:1 — ${failed.join(', ')}`,
          );
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await decoder.close();
  }
  assert(measured >= OVER_MAP_TARGETS.length * 8, `over-map contrast measured only ${measured} values`);
  console.log(`over-map contrast ok (${measured} painted measurements: ${OVER_MAP_TARGETS.length} surfaces, four themes, over a white map and a black one)`);
}

// Both halves of the replay, in a browser, including the half that had no
// browser coverage at all.
//
// What this exists for: the cone tooltip is the only place the app says whether
// it is showing the outline NHC drew or one rebuilt from that era's radii, and
// nothing asserted it. And the hash the app writes has to be a hash the app can
// read back, which it was not for any of the nineteen pre-2015 storms: their
// records name no cone era, the panel fell through to the archive-wide label,
// and the whole replay key was dropped from the URL.
async function assertAdvisoryReplayEras(browser, baseUrl) {
  const cases = [
    { stormId: 'AL182012', label: 'Sandy 2012', published: true },
    { stormId: 'AL092017', label: 'Irma 2017', published: false },
  ];
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  await seedSettings(context, { onboarded: true, theme: 'dark', reducedMotion: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    for (const { stormId, label, published } of cases) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await openStormPanel(page, stormId);
      await page.waitForSelector('#advisory-replay-enabled', { timeout: 20000 });
      await page.locator('#advisory-replay-enabled').check();
      await page.waitForFunction(() => document.querySelector('#advisory-replay-steps')?.hidden === false, null, { timeout: 20000 });
      await page.waitForFunction(() => document.querySelectorAll('#map path.advisory-cone-shape').length > 0, null, { timeout: 20000 });

      // Step away from the first advisory so the ordinal in the hash is not the
      // default, and a lost sub-state cannot pass by coincidence.
      await page.locator('#advisory-replay-next').click();
      await page.locator('#advisory-replay-next').click();
      await page.waitForFunction(() => document.querySelector('#advisory-replay-scrubber')?.value === '2', null, { timeout: 10000 });

      const tooltip = await page.evaluate(async () => {
        const cone = document.querySelector('#map path.advisory-cone-shape');
        cone?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 150));
        return document.querySelector('.leaflet-tooltip')?.textContent?.trim() || '';
      });
      const saysPublished = /as NHC published it/i.test(tooltip);
      const saysRebuilt = /error radii/i.test(tooltip);
      assert(
        saysPublished !== saysRebuilt,
        `${label}: the cone tooltip says neither or both of published and rebuilt: ${JSON.stringify(tooltip)}`,
      );
      assert(
        saysPublished === published,
        `${label}: the cone tooltip says ${saysPublished ? 'published' : 'rebuilt'}: ${JSON.stringify(tooltip)}`,
      );
      // The era label must never leak the archive-wide placeholder into prose.
      assert(!/per-record/.test(tooltip), `${label}: the tooltip carries the archive label: ${JSON.stringify(tooltip)}`);

      // The advisory line names when NHC issued it, and for a published-cone
      // record that is the exact time from the archive rather than the synoptic
      // hour its forecast was initialised on, which is up to seven hours
      // earlier and is what it used to show under the word "Issued".
      const meta = await page.textContent('#advisory-replay-meta');
      const expectedTime = await page.evaluate(async ([storm, index]) => {
        const archive = await (await fetch('data/advisories.json')).json();
        const advisory = archive.storms[storm]?.advisories?.[index];
        return { issued: advisory?.issued || null, initial: advisory?.t || null };
      }, [stormId, 2]);
      assert(
        published ? Boolean(expectedTime.issued) : expectedTime.issued === null,
        `${label}: the record ${published ? 'lacks' : 'carries'} an issue time it should ${published ? 'have' : 'not'}`,
      );
      // Built with the app's own formatter rather than matched with a pattern.
      // A hand-written one guesses at the rendering: the panel writes
      // "Oct 22, 2012, 09:00 PM UTC", and digit-matching "2100" against that
      // fails on text that is exactly right.
      const shownTime = await page.evaluate(async iso => {
        const { formatTime } = await import('/src/data.js');
        return formatTime(iso);
      }, published ? expectedTime.issued : expectedTime.initial);
      assert(
        new RegExp(published ? 'Issued' : 'Forecast from').test(meta || ''),
        `${label}: the advisory line uses the wrong label for its era: ${meta}`,
      );
      assert(
        meta && meta.includes(shownTime),
        `${label}: the advisory line does not show ${published ? 'the issue time' : 'the initial time'} ${shownTime}: ${meta}`,
      );

      // The hash the app wrote has to reopen what it describes.
      const hash = await page.evaluate(() => location.hash);
      assert(/replay=/.test(hash), `${label}: the app wrote no replay sub-state: ${hash}`);
      await page.goto(`${baseUrl}/${hash}`, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.waitForFunction(
        () => document.querySelector('#advisory-replay-enabled')?.checked === true,
        null, { timeout: 20000 },
      );
      const restored = await page.evaluate(() => ({
        index: document.querySelector('#advisory-replay-scrubber')?.value,
        cones: document.querySelectorAll('#map path.advisory-cone-shape').length,
      }));
      assert(
        restored.index === '2' && restored.cones > 0,
        `${label}: a copied link did not reopen the same advisory: ${JSON.stringify(restored)} from ${hash}`,
      );
    }
    assert(!pageErrors.length, `advisory replay eras: page errors: ${pageErrors.join(' | ')}`);
  } finally {
    await context.close();
  }
  console.log(`advisory replay eras ok (${cases.map(entry => entry.label).join(' and ')}: cone provenance named, and a copied link reopens the same advisory)`);
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
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    if (scenario.width <= 720) await assertMobileHeaderReachability(page, `${scenario.label} header`, { requireOverflow: scenario.width <= 430 });
    // In the state a reader lands in, before anything is opened. The active
    // card is on screen here at every width, which is the state that broke.
    const zoomUsable = await assertMapZoomControlUsable(page, `${scenario.label} as loaded`);
    assert(zoomUsable, `${scenario.label}: nothing withholds the zoom control in the default view, so it must be usable`);
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
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await assertActiveBadgeInViewport(page, `${name} active badge`);
    if (width <= 720) await assertMobileHeaderReachability(page, `${name} header`, { requireOverflow: width <= 430 });
    await assertThemeContrastMatrix(page);
    await captureVisualSnapshot(page, `${name}-dark`);

    await page.click('#toggle-filters');
    await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'), null, { timeout: 5000 });
    if (width <= 720) await assertMobileTargetSizes(page, `${name} filters`);
    await captureVisualSnapshot(page, `${name}-filters`);
    await page.click('#toggle-filters');

    await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
    await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'), null, { timeout: 5000 });
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
    if (width <= 720) await assertNoOverlayCoversOpenPanel(page, `${name} storm detail`);
    await captureVisualSnapshot(page, `${name}-storm-detail`);

    // Playwright's click fails when another element intercepts the pointer.
    // The panel's sticky header used to swallow the close button at every
    // width, and a dispatched click could not see it.
    await page.click('#close-panel', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('#storm-panel')?.hidden === true, null, { timeout: 5000 });
    await openKatrinaPanel(page);

    await page.evaluate(async () => {
      const panels = await import('/src/panels.js');
      panels.closeAllPanels();
      const stats = await import('/src/stats.js');
      stats.toggleStats();
    });
    await page.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, null, { timeout: 10000 });
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
    await stubQuietTropics(context);
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      const scenarios = [
        { trigger: '#toggle-prep', panel: '#prep-panel', close: '#close-prep', entry: '#prep-panel-title' },
        { trigger: '#toggle-evac', panel: '#evac-panel', close: '#close-evac', entry: '#evac-panel-title' },
        { trigger: '#toggle-table-view', panel: '#table-view-panel', close: '#close-table-view', entry: '#table-view-title' },
        { trigger: '#toggle-spatial-search', panel: '#spatial-results', close: '#spatial-results .close-btn', entry: '#spatial-results h2' },
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

// A filtered view of a panel used to be unshareable: only a hash that was
// exactly "#stats" or "#compare" opened anything, and that form is mutually
// exclusive with the versioned view the filters write. This drives the whole
// round trip in a browser rather than trusting the encoder: open the panel with
// a filter applied, reload the URL that produced, and close it again.
// One click of Reset filters clears nine pieces of state and then disables
// itself, so there was no way back to what the reader had built. Driven through
// the real controls, because three of the nine (surge, population, sea-surface)
// do not live on the filters object and are written back through their own
// modules.
async function assertFilterResetIsRecoverable(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    // Expanded conditionally: the panel's starting state differs by viewport and
    // an unconditional click closes it where it starts open.
    if (await page.getAttribute('#toggle-filters', 'aria-expanded') !== 'true') {
      await page.click('#toggle-filters');
    }
    await page.locator('#show-tracks').visible().waitFor({ timeout: 10_000 });

    const read = () => page.evaluate(async () => {
      const { isMapLayerActive } = await import('/src/layer-registry.js');
      return ({
      layers: { sst: isMapLayerActive('sst'), population: isMapLayerActive('population') },
      yearMin: document.getElementById('year-min')?.value,
      yearMax: document.getElementById('year-max')?.value,
      categories: [...document.querySelectorAll('.cat-btn')]
        .filter(button => button.classList.contains('on'))
        .map(button => button.dataset.cat).sort(),
      state: document.getElementById('state-filter')?.value,
      showTracks: document.getElementById('show-tracks')?.checked,
      showHeatmap: document.getElementById('show-heatmap')?.checked,
      retiredOnly: document.getElementById('show-retired-only')?.checked,
      surgeCategory: document.getElementById('surge-category')?.value,
      showPopulation: document.getElementById('show-population')?.checked,
      showSST: document.getElementById('show-sst')?.checked,
    });
    });

    // Move all nine away from their defaults.
    await page.fill('#year-min', '1992');
    await page.dispatchEvent('#year-min', 'change');
    await page.fill('#year-max', '2005');
    await page.dispatchEvent('#year-max', 'change');
    await page.click('.cat-btn[data-cat="ts"]');
    await page.click('.cat-btn[data-cat="1"]');
    await page.check('#show-tracks');
    await page.check('#show-heatmap');
    await page.check('#show-retired-only');
    await page.selectOption('#surge-category', '4');
    await page.check('#show-population');
    await page.check('#show-sst');
    // Last, and then the panel is reopened: choosing a state opens the state
    // panel, and any panel opening collapses the filter drawer, which puts
    // every control after it out of reach.
    await page.selectOption('#state-filter', { index: 1 });
    await page.waitForSelector('#state-panel:not([hidden])', { timeout: 15_000 });
    if (await page.getAttribute('#toggle-filters', 'aria-expanded') !== 'true') {
      await page.click('#toggle-filters');
    }
    await page.locator('#reset-filters').visible().waitFor({ timeout: 10_000 });
    // Waited on the layers themselves: the checkbox is ticked synchronously by
    // the click and says nothing about whether the layer arrived.
    await page.waitForFunction(async () => {
      const { isMapLayerActive } = await import('/src/layer-registry.js');
      return isMapLayerActive('sst') && isMapLayerActive('population')
        && document.getElementById('reset-filters')?.disabled === false;
    }, null, { timeout: 30_000 });
    const before = await read();
    assert(
      before.yearMin === '1992' && before.categories.length < 6 && before.state
      && before.showTracks && before.showHeatmap && before.retiredOnly
      && before.surgeCategory === '4' && before.showPopulation && before.showSST
      && before.layers.sst && before.layers.population,
      `the nine filters were not all moved off their defaults: ${JSON.stringify(before)}`,
    );

    await expect_hidden(page, '#undo-reset-filters', 'the undo control must not appear before a reset');
    await page.click('#reset-filters');
    await page.waitForFunction(
      () => document.getElementById('undo-reset-filters')?.hidden === false,
      null,
      { timeout: 10_000 },
    ).catch(() => {
      throw new Error('resetting the filters offered no way back');
    });
    await page.waitForFunction(async () => {
      const { isMapLayerActive } = await import('/src/layer-registry.js');
      return !isMapLayerActive('sst') && !isMapLayerActive('population');
    }, null, { timeout: 15_000 }).catch(() => {
      throw new Error('resetting the filters left a map layer on the map');
    });
    const cleared = await read();
    assert(
      JSON.stringify(cleared) !== JSON.stringify(before),
      'the reset cleared nothing, so the undo below would prove nothing',
    );

    await page.click('#undo-reset-filters');
    // The layer, not the checkbox: the checkbox is set synchronously and would
    // pass with every line that actually restores a layer deleted.
    await page.waitForFunction(async () => {
      const { isMapLayerActive } = await import('/src/layer-registry.js');
      return isMapLayerActive('sst') && isMapLayerActive('population');
    }, null, { timeout: 30_000 }).catch(() => {
      throw new Error('undo did not put the sea-surface and population layers back on the map');
    });
    const after = await read();
    assert(
      JSON.stringify(after) === JSON.stringify(before),
      `undo did not return the exact prior state\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`,
    );

    // Used once. Leaving it on screen offers to restore a state it no longer
    // holds, which is a lie about what the button does.
    await expect_hidden(page, '#undo-reset-filters', 'the undo control stayed after it was used');
  } finally {
    await context.close();
  }

  await assertFilterResetSurvivesAnUnreachableLayer(browser, baseUrl);
  await assertFilterResetDoesNotFetchAnUnusedLayer(browser, baseUrl);
}

// The sea-surface layer is a lazily imported chunk. Moving its call out of the
// reset handler's `if (checked)` guard made the reset fetch it for every
// reader, including the overwhelming majority who never turn the layer on.
async function assertFilterResetDoesNotFetchAnUnusedLayer(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  const sstRequests = [];
  page.on('request', request => {
    if (/\/src\/sst\.js$/.test(new URL(request.url()).pathname)) sstRequests.push(request.url());
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    if (await page.getAttribute('#toggle-filters', 'aria-expanded') !== 'true') {
      await page.click('#toggle-filters');
    }
    await page.locator('#show-tracks').visible().waitFor({ timeout: 10_000 });
    await page.check('#show-tracks');
    await page.waitForFunction(
      () => document.getElementById('reset-filters')?.disabled === false,
      null,
      { timeout: 10_000 },
    );
    assert(sstRequests.length === 0, `the sea-surface chunk was fetched before anyone asked for it: ${sstRequests.length}`);

    await page.click('#reset-filters');
    await page.waitForFunction(
      () => document.getElementById('undo-reset-filters')?.hidden === false,
      null,
      { timeout: 10_000 },
    );
    await page.click('#undo-reset-filters');
    await page.waitForFunction(
      () => document.getElementById('show-tracks')?.checked === true,
      null,
      { timeout: 10_000 },
    );
    // Held over a window, because the fetch this is about is asynchronous and
    // would arrive after the undo returns.
    assert(
      await page.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return true;
      }) && sstRequests.length === 0,
      `resetting and undoing fetched the sea-surface chunk on a visit that never used it: ${JSON.stringify(sstRequests)}`,
    );
  } finally {
    await context.close();
  }
}

// The sea-surface layer is a lazily imported chunk, and the import is memoised
// including its rejection, so one failed fetch poisons it for the session.
// Awaiting it in the middle of the reset destroyed nine pieces of state and
// then threw before the undo control was ever shown: the snapshot existed and
// nothing could reach it.
async function assertFilterResetSurvivesAnUnreachableLayer(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  await page.route('**/src/sst.js', route => route.abort('failed'));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    if (await page.getAttribute('#toggle-filters', 'aria-expanded') !== 'true') {
      await page.click('#toggle-filters');
    }
    await page.locator('#show-sst').visible().waitFor({ timeout: 10_000 });

    // A layer the reader asks for and cannot have must not leave its control
    // ticked: the box would claim a layer that will never arrive.
    await page.check('#show-sst');
    await page.waitForFunction(
      () => document.getElementById('show-sst')?.checked === false,
      null,
      { timeout: 15_000 },
    ).catch(() => {
      throw new Error('a sea-surface layer that cannot load left its checkbox ticked');
    });

    await page.check('#show-retired-only');
    await page.waitForFunction(
      () => document.getElementById('reset-filters')?.disabled === false,
      null,
      { timeout: 10_000 },
    );
    await page.click('#reset-filters');
    await page.waitForFunction(
      () => document.getElementById('undo-reset-filters')?.hidden === false,
      null,
      { timeout: 10_000 },
    ).catch(() => {
      throw new Error('a reset with an unreachable layer chunk offered no way back');
    });
    await page.click('#undo-reset-filters');
    await page.waitForFunction(
      () => document.getElementById('show-retired-only')?.checked === true
        && document.getElementById('undo-reset-filters')?.hidden === true,
      null,
      { timeout: 10_000 },
    ).catch(() => {
      throw new Error('an undo with an unreachable layer chunk did not finish');
    });
    // And the map followed. A half-applied undo left the checkbox saying
    // "retired only" over a map still showing everything.
    const counted = await page.textContent('#visible-count');
    assert(
      /\b(\d[\d,]*) of /.test(counted || ''),
      `undo restored the controls but not the map: ${JSON.stringify(counted)}`,
    );
  } finally {
    await page.unroute('**/src/sst.js');
    await context.close();
  }
}

async function expect_hidden(page, selector, message) {
  // Present AND hidden. `?.hidden !== false` on a missing element is true, so
  // the old form passed for a control that had been renamed out of existence.
  const state = await page.evaluate(target => {
    const element = document.querySelector(target);
    return { present: Boolean(element), hidden: element?.hidden === true };
  }, selector);
  assert(state.present, `${message} (${selector} is not on the page at all)`);
  assert(state.hidden, message);
}

// Two pinned storms compared on one map, with two clipped panes.
//
// The visual baselines cover the controls and cannot cover the geometry: the
// visual harness blanks #map for determinism, because tiles are not
// reproducible. So the clip itself is measured here, which is the stronger
// check anyway: a pixel diff would say a divider moved, and this says where it
// landed and that it is still there after the map moves under it.
async function assertDualPaneComparison(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.evaluate(async () => {
      const compare = await import('/src/compare.js');
      await compare.setPinsByIds(['AL122005', 'AL092022']);
      compare.openComparePanel();
    });
    await page.waitForSelector('#cp-map-compare', { timeout: 15_000 });

    const paneState = () => page.evaluate(() => {
      const pane = name => [...document.querySelectorAll('.leaflet-pane')]
        .find(node => node.className.includes(name));
      const read = node => (node ? {
        clip: node.style.clipPath,
        opacity: node.style.opacity,
        paths: node.querySelectorAll('path').length,
      } : null);
      return { a: read(pane('hm-compare-a')), b: read(pane('hm-compare-b')) };
    });

    // Each storm draws into its own pane. Without that there is nothing for a
    // divider to separate, and every assertion below would pass on one pane
    // holding everything.
    const drawn = await paneState();
    assert(drawn.a && drawn.b, 'the comparison panes were never created');
    assert(
      drawn.a.paths > 5 && drawn.b.paths > 5,
      `the two pinned storms did not draw into separate panes: ${JSON.stringify(drawn)}`,
    );
    assert(
      drawn.a.clip === '' && drawn.b.clip === '',
      'the panes start clipped, so the reader sees half a map before asking for one',
    );

    // The divider lands where the reader put it. Measured through the map's own
    // container-to-layer conversion, which is the thing that makes the clip
    // impossible to drift: it is derived from the map transform, not tracked
    // beside it.
    const cutFor = async percent => {
      await page.check('input[name="cp-map-mode"][value="swipe"]');
      await page.waitForSelector('#cp-divider:not([disabled])', { timeout: 5000 });
      await page.fill('#cp-divider', String(percent));
      await page.dispatchEvent('#cp-divider', 'input');
      return page.evaluate(async wanted => {
        const { getMap } = await import('/src/map.js');
        const map = getMap();
        const pane = [...document.querySelectorAll('.leaflet-pane')]
          .find(node => node.className.includes('hm-compare-a'));
        const cut = Number(/polygon\([^,]+, (-?\d+(?:\.\d+)?)px/.exec(pane.style.clipPath)?.[1]);
        const expected = map.containerPointToLayerPoint([
          Math.round((map.getSize().x * wanted) / 100), 0,
        ]).x;
        return { cut, expected };
      }, percent);
    };

    for (const percent of [25, 50, 75]) {
      const { cut, expected } = await cutFor(percent);
      assert(
        Number.isFinite(cut) && Math.abs(cut - expected) <= 1,
        `the divider at ${percent}% cut at ${cut} instead of ${expected}`,
      );
    }

    // And it survives the map moving under it. Two synced maps drift here;
    // one map with a clip derived from its own transform cannot.
    const before = await cutFor(40);
    await page.evaluate(async () => {
      const { getMap } = await import('/src/map.js');
      getMap().panBy([160, 90], { animate: false });
    });
    await page.waitForFunction(
      previous => {
        const pane = [...document.querySelectorAll('.leaflet-pane')]
          .find(node => node.className.includes('hm-compare-a'));
        const cut = Number(/polygon\([^,]+, (-?\d+(?:\.\d+)?)px/.exec(pane.style.clipPath)?.[1]);
        return Number.isFinite(cut) && cut !== previous;
      },
      before.cut,
      { timeout: 8000 },
    ).catch(() => {
      throw new Error('the clip did not follow the map when it was panned');
    });
    const afterPan = await page.evaluate(async () => {
      const { getMap } = await import('/src/map.js');
      const map = getMap();
      const pane = [...document.querySelectorAll('.leaflet-pane')]
        .find(node => node.className.includes('hm-compare-a'));
      const cut = Number(/polygon\([^,]+, (-?\d+(?:\.\d+)?)px/.exec(pane.style.clipPath)?.[1]);
      const expected = map.containerPointToLayerPoint([Math.round(map.getSize().x * 0.4), 0]).x;
      return { cut, expected };
    });
    assert(
      Math.abs(afterPan.cut - afterPan.expected) <= 1,
      `after a pan the divider cut at ${afterPan.cut} instead of ${afterPan.expected}`,
    );

    // Crossfade drops the clip and mixes instead. The two opacities sum to one,
    // so the basemap never shows through more than it would under either storm
    // alone.
    await page.check('input[name="cp-map-mode"][value="fade"]');
    await page.waitForSelector('#cp-divider:not([disabled])', { timeout: 5000 });
    await page.fill('#cp-divider', '65');
    await page.dispatchEvent('#cp-divider', 'input');
    const faded = await paneState();
    assert(
      faded.a.clip === '' && faded.b.clip === '',
      `crossfade left a clip behind: ${JSON.stringify(faded)}`,
    );
    const sum = Number(faded.a.opacity) + Number(faded.b.opacity);
    assert(
      Math.abs(Number(faded.a.opacity) - 0.35) < 0.01 && Math.abs(sum - 1) < 0.01,
      `crossfade did not mix the two storms: ${JSON.stringify(faded)}`,
    );

    // The shared time axis puts one marker on each track at the same fraction
    // of its own life, which is the only instant two storms decades apart have
    // in common.
    await page.fill('#cp-time', '50');
    await page.dispatchEvent('#cp-time', 'input');
    await page.waitForFunction(
      () => document.querySelectorAll('.compare-time-marker').length === 2,
      null,
      { timeout: 8000 },
    ).catch(() => {
      throw new Error('the shared time axis did not mark both storms');
    });
    const readout = await page.textContent('#cp-time-readout');
    assert(
      /Katrina 2005: 2005-/.test(readout || '') && /Ian 2022: 2022-/.test(readout || ''),
      `the shared time readout did not name both storms and both dates: ${JSON.stringify(readout)}`,
    );
    // Measured against the clock, not against the subject's own index formula.
    // Comparing with points[round(f * (n - 1))] was comparing the function to
    // itself, and it passed while Katrina sat six hours and Ian twelve hours
    // from their own midpoints: HURDAT2 intercalates non-synoptic fixes, so a
    // fraction of the point count is not a fraction of the storm.
    const halfway = await page.evaluate(async () => {
      const { getStorm } = await import('/src/data.js');
      const { trackPointAtFraction } = await import('/src/compare-panes.js');
      return ['AL122005', 'AL092022'].map(id => {
        const points = (getStorm(id).track || [])
          .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
        const times = points.map(point => Date.parse(point.t));
        const wanted = times[0] + 0.5 * (times[times.length - 1] - times[0]);
        const chosen = Date.parse(trackPointAtFraction(points, 0.5).t);
        const spacing = (times[times.length - 1] - times[0]) / (points.length - 1);
        return { id, offHours: Math.abs(chosen - wanted) / 3600000, spacingHours: spacing / 3600000 };
      });
    });
    for (const storm of halfway) {
      // Within half the average spacing: the axis can only land on a real fix,
      // so the nearest one is the best answer available.
      assert(
        storm.offHours <= storm.spacingHours / 2 + 0.01,
        `the shared time axis put ${storm.id} ${storm.offHours.toFixed(1)} h from its own midpoint, `
        + `with fixes ${storm.spacingHours.toFixed(1)} h apart`,
      );
    }

    // The panes follow the first two PINS, not the first two colour slots.
    // Slots are never reused, so unpinning the first of three left the panes
    // holding slots 1 and 2: one empty, and one storm drawn unclipped over
    // both halves of the split.
    await page.evaluate(async () => {
      const compare = await import('/src/compare.js');
      await compare.setPinsByIds(['AL041992', 'AL122005', 'AL092022']);
    });
    // Unpinned one at a time, not re-set: setPinsByIds clears every pin first,
    // so it never leaves the surviving storms holding the slots the removed one
    // did, which is the whole condition this is about.
    await page.evaluate(async () => {
      const compare = await import('/src/compare.js');
      const { getStorm } = await import('/src/data.js');
      await compare.togglePin(getStorm('AL041992'));
    });
    const repacked = await paneState();
    assert(
      repacked.a.paths > 5 && repacked.b.paths > 5,
      `after unpinning the first of three, the panes do not hold the remaining two: ${JSON.stringify(repacked)}`,
    );

    // Unpinning back to one storm cannot leave half the map clipped away with
    // nothing on the other side of the divider.
    await page.check('input[name="cp-map-mode"][value="swipe"]');
    await page.evaluate(async () => {
      const compare = await import('/src/compare.js');
      await compare.setPinsByIds(['AL122005']);
    });
    await page.waitForFunction(
      () => {
        const pane = [...document.querySelectorAll('.leaflet-pane')]
          .find(node => node.className.includes('hm-compare-a'));
        return pane && pane.style.clipPath === '';
      },
      null,
      { timeout: 8000 },
    ).catch(() => {
      throw new Error('unpinning to one storm left the map clipped in half');
    });
  } finally {
    await context.close();
  }

  // Below the shell's breakpoint the split runs top to bottom. The same
  // control, over a map that is taller than it is wide.
  const narrow = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(narrow, { onboarded: true, locale: 'en' });
  await stubQuietTropics(narrow);
  const small = await narrow.newPage();
  try {
    await small.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(small);
    await small.evaluate(async () => {
      const compare = await import('/src/compare.js');
      await compare.setPinsByIds(['AL122005', 'AL092022']);
      compare.openComparePanel();
    });
    await small.waitForSelector('#cp-map-compare', { timeout: 15_000 });
    await small.check('input[name="cp-map-mode"][value="swipe"]');
    await small.waitForSelector('#cp-divider:not([disabled])', { timeout: 5000 });
    await small.fill('#cp-divider', '45');
    await small.dispatchEvent('#cp-divider', 'input');
    const stacked = await small.evaluate(async () => {
      const { getMap } = await import('/src/map.js');
      const map = getMap();
      const pane = [...document.querySelectorAll('.leaflet-pane')]
        .find(node => node.className.includes('hm-compare-a'));
      // A stacked split cuts on y: the first two polygon points share a y and
      // differ in x, where a vertical split has them share an x.
      const points = [...pane.style.clipPath.matchAll(/(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px/g)]
        .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
      const expected = map.containerPointToLayerPoint([0, Math.round(map.getSize().y * 0.45)]).y;
      return { points, expected };
    });
    assert(stacked.points.length === 4, `the stacked clip is not a quadrilateral: ${JSON.stringify(stacked.points)}`);
    const cutY = stacked.points[2].y;
    assert(
      Math.abs(cutY - stacked.expected) <= 1,
      `the stacked split cut at y=${cutY} instead of ${stacked.expected}`,
    );
    // A stacked clip varies its cut in y and spans the full width; a vertical
    // one does the opposite. Comparing the first two points could not tell them
    // apart, because both generators emit the same top-left corner pair.
    const xs = new Set(stacked.points.map(point => point.x));
    const ys = new Set(stacked.points.map(point => point.y));
    assert(
      xs.size === 2 && ys.size === 2,
      `the clip is not a rectangle: ${JSON.stringify(stacked.points)}`,
    );
    assert(
      !xs.has(cutY) && ys.has(cutY),
      `the narrow layout cut in x instead of y: ${JSON.stringify(stacked.points)}`,
    );
    assert(
      Math.min(...xs) < -1000 && Math.max(...xs) > 1000,
      `a stacked clip must span the full width, not stop at a divider: ${JSON.stringify([...xs])}`,
    );
  } finally {
    await narrow.close();
  }
}

// NHC's Potential Storm Surge Flooding footprint.
//
// Driven against a recorded fixture, because the live layer is empty out of
// season: that is the state the layer spends most of the year in, and it is
// also the one this has to report as `empty` rather than as a failure, so both
// are driven here.
async function assertSurgeInundationLayer(browser, baseUrl) {
  const fixture = JSON.parse(
    await readFile(new URL('../tests/fixtures/nhc-summary-inundation-footprint.json', import.meta.url), 'utf8'),
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en', surgeInundation: true });
  await stubQuietTropics(context);
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const render = async (payload) => {
      await page.route(
        '**/NHC_tropical_weather_summary/MapServer/23/query**',
        route => route.fulfill({
          status: 200,
          contentType: 'application/geo+json',
          body: JSON.stringify(payload),
        }),
      );
      const result = await page.evaluate(async () => {
        const { getMap } = await import('/src/map.js');
        const layer = await import('/src/surge-inundation.js');
        layer.clearSurgeInundationCache();
        return layer.renderSurgeInundation([], { map: getMap(), enabled: true, force: true });
      });
      await page.unroute('**/NHC_tropical_weather_summary/MapServer/23/query**');
      return result;
    };

    // Out of season: zero features is not a failure, and reporting it as one
    // would put a retry in front of a reader for a product nobody has issued.
    const empty = await render({ type: 'FeatureCollection', features: [] });
    assert(
      empty.status === 'empty' && empty.featureCount === 0,
      `an unpublished footprint was not reported as empty: ${JSON.stringify(empty)}`,
    );
    assert(
      await page.evaluate(() => document.getElementById('surge-inundation-legend')?.hidden !== false),
      'the legend explained a footprint that does not exist',
    );

    // Published: the footprint draws, and the legend leads with the sentence
    // people get wrong about this product.
    const rendered = await render(fixture);
    assert(
      rendered.status === 'rendered' && rendered.featureCount === fixture.features.length,
      `the recorded footprint did not render: ${JSON.stringify(rendered)}`,
    );
    const legend = await page.evaluate(() => {
      const node = document.getElementById('surge-inundation-legend');
      return { hidden: node?.hidden, text: node?.textContent || '' };
    });
    assert(legend.hidden === false, 'the legend stayed hidden with a footprint on the map');
    assert(
      /10 percent chance/i.test(legend.text) && /above/i.test(legend.text),
      `the legend does not carry the 10 percent exceedance wording: ${JSON.stringify(legend.text)}`,
    );
    assert(
      await page.evaluate(() => document.querySelectorAll('path.surge-inundation-poly').length > 0),
      'the footprint reported as rendered but nothing was drawn',
    );

    // It reports itself the way every other optional feed does, so it turns up
    // in the diagnostics panel rather than being a layer nothing accounts for.
    const diagnostics = await page.evaluate(async () => {
      const feeds = await import('/src/optional-feeds.js');
      const state = feeds.getOptionalFeedState('inundation');
      return { known: Boolean(state), source: feeds.getOptionalFeedDefinition('inundation')?.source };
    });
    assert(diagnostics.known, 'the inundation layer is not a declared optional feed');
    assert(
      /Potential Storm Surge Flooding/.test(diagnostics.source || ''),
      `the feed does not name its source: ${JSON.stringify(diagnostics.source)}`,
    );

    // Switching it off takes the footprint and its legend away, and reports the
    // feed idle rather than leaving it reading as a success.
    await page.evaluate(async () => {
      const layer = await import('/src/surge-inundation.js');
      layer.clearSurgeInundation();
    });
    assert(
      await page.evaluate(() => document.querySelectorAll('path.surge-inundation-poly').length === 0
        && document.getElementById('surge-inundation-legend')?.hidden === true),
      'turning the layer off left the footprint or its legend on screen',
    );
    const afterOff = await page.evaluate(async () => {
      const feeds = await import('/src/optional-feeds.js');
      return feeds.getOptionalFeedState('inundation')?.state;
    });
    assert(afterOff === 'idle', `the feed did not go idle when the layer was turned off: ${afterOff}`);
  } finally {
    await context.close();
  }
}

// Continuous track colour: the same corridor read at any position along it,
// rather than in seven steps. A storm that intensifies steadily through a band
// rendered as one flat colour, which is what bins do to continuous data.
async function assertContinuousTrackColour(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en', trackColorBy: 'wind' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // Driven through the real control, not by writing the setting: the legend
    // is re-rendered by the toggle's own handler, and a test that skips it
    // proves the painter changed and nothing else did.
    await page.evaluate(() => document.getElementById('settings-menu')?.showPopover());
    await page.waitForSelector('#toggle-continuous-track-color', { timeout: 10_000 });
    const paintedFor = async (continuous) => {
      if (await page.isChecked('#toggle-continuous-track-color') !== continuous) {
        await page.setChecked('#toggle-continuous-track-color', continuous);
      }
      await page.waitForFunction(
        expected => document.getElementById('track-color-legend')?.dataset.continuous === String(expected),
        continuous,
        { timeout: 8000 },
      );
      // Read through the app's own painter, which is what the map calls: this
      // is the function under test, not a colour scraped off a rendered path.
      return page.evaluate(async () => {
        const { segmentColor } = await import('/src/map.js');
        const { getStorm, ensureStormsLoaded } = await import('/src/data.js');
        await ensureStormsLoaded();
        const track = getStorm('AL122005').track.filter(point => Number.isFinite(point.wind));
        return track.map(point => segmentColor({ point, cat: 0 }));
      });
    };

    const binned = await paintedFor(false);
    const continuous = await paintedFor(true);
    assert(binned.length > 20 && binned.length === continuous.length, 'the sampled track is too short to mean anything');

    // Bins collapse a track into a handful of colours; the continuous encoding
    // gives a distinct reading its own colour.
    const binnedDistinct = new Set(binned).size;
    const continuousDistinct = new Set(continuous).size;
    assert(
      continuousDistinct > binnedDistinct * 2,
      `the continuous encoding is not finer than the binned one: ${continuousDistinct} colours against ${binnedDistinct}`,
    );

    // And it is the SAME corridor, not a second palette: at a bin's own
    // fraction the continuous sampler returns that bin's colour exactly.
    const agrees = await page.evaluate(async () => {
      const ramps = await import('/src/track-ramps.js');
      return ramps.WIND_RAMP.every(
        (stop, index) => ramps.rampColorAt(index / (ramps.WIND_RAMP.length - 1)).toLowerCase() === stop.toLowerCase(),
      );
    });
    assert(agrees, 'the continuous sampler and the binned ramp disagree at the bin stops');

    // Two readings inside one band must now differ, which is the defect this
    // exists to remove.
    const insideOneBand = await page.evaluate(async () => {
      const ramps = await import('/src/track-ramps.js');
      return {
        binned: [ramps.trackPointColor('wind', { wind: 66 }), ramps.trackPointColor('wind', { wind: 80 })],
        continuous: [
          ramps.trackPointColorContinuous('wind', { wind: 66 }),
          ramps.trackPointColorContinuous('wind', { wind: 80 }),
        ],
      };
    });
    assert(
      insideOneBand.binned[0] === insideOneBand.binned[1],
      `66 kt and 80 kt are meant to share a bin: ${JSON.stringify(insideOneBand.binned)}`,
    );
    assert(
      insideOneBand.continuous[0] !== insideOneBand.continuous[1],
      `66 kt and 80 kt still paint the same colour: ${JSON.stringify(insideOneBand.continuous)}`,
    );

    // A reading with no answer still gets the no-data colour rather than an end
    // of the ramp, which would invent a value.
    const missing = await page.evaluate(async () => {
      const ramps = await import('/src/track-ramps.js');
      return {
        colour: ramps.trackPointColorContinuous('pressure', { pres: null }),
        noData: ramps.NO_DATA_COLOR,
        blank: ramps.trackPointColorContinuous('pressure', { pres: 0 }),
      };
    });
    assert(
      missing.colour === missing.noData && missing.blank === missing.noData,
      `a missing pressure was given a place on the ramp: ${JSON.stringify(missing)}`,
    );

    // The legend keeps the bands as its key and says they are reference points,
    // because a gradient with a banded key is only honest if it admits that.
    const legend = await page.evaluate(() => {
      const host = document.getElementById('track-color-legend');
      const note = document.getElementById('track-color-legend-note');
      return {
        rows: document.querySelectorAll('#track-color-legend-list li').length,
        continuous: host?.dataset.continuous,
        note: note?.hidden === false ? note.textContent : '',
      };
    });
    assert(legend.rows > 1, 'the banded legend disappeared when the encoding went continuous');
    assert(legend.continuous === 'true', 'the legend does not know the encoding is continuous');
    assert(
      /reference points/i.test(legend.note),
      `the legend does not say its swatches are reference points: ${JSON.stringify(legend.note)}`,
    );
  } finally {
    await context.close();
  }
}

async function assertPanelIsAddressable(browser, baseUrl) {
  const PANELS = ['stats', 'compare', 'on-this-date', 'table-view', 'prep', 'evac'];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await seedSettings(context, { onboarded: true, locale: 'en' });
  await stubQuietTropics(context);
  const page = await context.newPage();
  try {
    for (const panel of PANELS) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      // A filter first, so the hash is already in its versioned form. This is
      // the exact combination the bare-token form could not express. The filter
      // panel starts collapsed, so it has to be opened before the checkbox is
      // reachable.
      await page.click('#toggle-filters');
      await page.locator('#show-tracks').visible().waitFor({ timeout: 10_000 });
      await page.check('#show-tracks');
      await page.waitForFunction(() => location.hash.includes('t=1'), null, { timeout: 8000 });

      await clickHeaderAction(page, `#toggle-${panel}`);
      await page.waitForSelector(`#${panel}-panel:not([hidden])`, { timeout: 10_000 });
      await page.waitForFunction(
        id => location.hash.includes(`panel=${id}`),
        panel,
        { timeout: 8000 },
      ).catch(() => {
        throw new Error(`opening ${panel} did not reach the address bar`);
      });
      const shared = await page.evaluate(() => location.hash);
      assert(
        shared.includes('t=1') && shared.includes(`panel=${panel}`),
        `${panel}: the shared URL dropped either the filter or the panel: ${shared}`,
      );

      // The cold load. This is the reader who was handed the link.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.waitForSelector(`#${panel}-panel:not([hidden])`, { timeout: 10_000 }).catch(() => {
        throw new Error(`${panel}: the shared URL ${shared} did not reopen the panel`);
      });
      const restored = await page.evaluate(() => ({
        hash: location.hash,
        tracks: document.getElementById('show-tracks')?.checked,
      }));
      assert(restored.tracks === true, `${panel}: the filter did not survive beside the panel`);
      assert(
        restored.hash.includes(`panel=${panel}`),
        `${panel}: the restored view stopped advertising its panel: ${restored.hash}`,
      );

      // Closing it takes it back out, so the next link the reader copies is the
      // view they are actually looking at.
      // Driven from the keyboard: the panel's sticky heading overlays the close
      // button, so a synthetic click lands on the heading instead.
      await page.locator(`#close-${panel}`).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(id => !location.hash.includes(`panel=${id}`), panel, { timeout: 8000 })
        .catch(async () => {
          const hash = await page.evaluate(() => location.hash);
          throw new Error(`${panel}: closing the panel left it in the address bar: ${hash}`);
        });
    }

    // Moving between two links that both carry the same panel. The header
    // controls are toggles, so re-clicking one for a panel already on screen
    // would close it, which is the opposite of what the link asked for.
    await page.goto(`${baseUrl}#v=1&t=1&panel=stats`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#stats-panel:not([hidden])', { timeout: 10_000 });
    await page.evaluate(() => { location.hash = '#v=1&y=2005-2005&panel=stats'; });
    await page.waitForFunction(
      () => document.getElementById('year-min')?.value === '2005',
      null,
      { timeout: 8000 },
    );
    // Held open across a window long enough for a toggle to have closed it.
    const stayedOpen = await page.evaluate(async () => {
      const deadline = Date.now() + 800;
      while (Date.now() < deadline) {
        if (document.getElementById('stats-panel')?.hidden !== false) return false;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return document.getElementById('stats-panel')?.hidden === false;
    });
    assert(stayedOpen, 'navigating between two links carrying the same panel closed it');
    // A versioned hash that names no panel does not close one that is already
    // open, so the next check starts from a closed panel deliberately rather
    // than passing on leftovers.
    await page.locator('#close-stats').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('stats-panel')?.hidden === true, null, { timeout: 8000 });

    // A panel re-render must not rewrite the address from application state.
    // The storm panel re-renders on its own schedule and fires the same event
    // the launcher panels do; doing a full write then undid a hash the reader
    // had just pasted, in the window before the hashchange that would have
    // applied it ran, and the tab navigated back to the storm it was already
    // showing. Dispatched synchronously right after the assignment, which is
    // exactly that window.
    await page.goto(`${baseUrl}#storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel:not([hidden])', { timeout: 15_000 });
    const pasted = await page.evaluate(() => {
      location.hash = '#storm=AL092022';
      document.dispatchEvent(new CustomEvent('hm-panel:shown', { detail: { id: 'storm-panel' } }));
      return location.hash;
    });
    assert(
      pasted.includes('AL092022'),
      `a panel re-render undid the hash the reader had just pasted: ${pasted}`,
    );

    // The same window, but the incoming link names a panel that is not the one
    // on screen, which is the case this feature exists to serve. Guarding only
    // the already-in-sync case left the shared statistics link unprotected.
    await page.goto(`${baseUrl}#storm=AL122005`, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.waitForSelector('#storm-panel:not([hidden])', { timeout: 15_000 });
    const shared = await page.evaluate(() => {
      location.hash = '#v=1&t=1&panel=stats';
      document.dispatchEvent(new CustomEvent('hm-panel:shown', { detail: { id: 'storm-panel' } }));
      return location.hash;
    });
    assert(
      shared.includes('panel=stats') && shared.includes('t=1'),
      `a panel re-render undid a shared link before it could be applied: ${shared}`,
    );
    await page.waitForSelector('#stats-panel:not([hidden])', { timeout: 10_000 }).catch(() => {
      throw new Error('the shared statistics link never opened its panel');
    });

    // A versioned hash is a complete view: omitting a field means the contract
    // default, not whatever this tab happens to be showing. The panel has to
    // follow that rule too, or the reader does not get the view the link
    // describes and the next filter write puts the panel back in their address
    // bar.
    await page.evaluate(() => { location.hash = '#v=1&y=2005-2005'; });
    await page.waitForFunction(
      () => document.getElementById('stats-panel')?.hidden === true,
      null,
      { timeout: 8000 },
    ).catch(() => {
      throw new Error('a versioned link naming no panel left the statistics panel open');
    });
    await page.waitForFunction(() => !location.hash.includes('panel='), null, { timeout: 8000 })
      .catch(async () => {
        const hash = await page.evaluate(() => location.hash);
        throw new Error(`a closed panel was written back into a link that did not name it: ${hash}`);
      });

    // An unversioned hash is a partial edit, not a complete view: that is how
    // restoreFiltersFromHash already treats it, keeping whatever this tab has
    // for the fields it does not name. It says nothing about panels and must
    // leave an open one alone. Driven with a hash that opens no panel of its
    // own, because a hash that opens one would close the statistics panel
    // through the panel lane and prove nothing about this rule.
    await clickHeaderAction(page, '#toggle-stats');
    await page.waitForSelector('#stats-panel:not([hidden])', { timeout: 10_000 });
    await page.evaluate(() => { location.hash = '#t=1'; });
    await page.waitForFunction(
      () => document.getElementById('show-tracks')?.checked === true,
      null,
      { timeout: 8000 },
    );
    // Held across a window long enough for the deferred close to have run.
    assert(
      await page.evaluate(async () => {
        const deadline = Date.now() + 700;
        while (Date.now() < deadline) {
          if (document.getElementById('stats-panel')?.hidden !== false) return false;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return true;
      }),
      'an unversioned hash closed a panel it never mentioned',
    );

    // An id this build does not know falls back to no panel rather than
    // throwing, and does not survive into the address bar.
    const errors = [];
    // The sandboxed globe iframe cannot reach navigator.serviceWorker and says
    // so on every load. That is its own tracked noise, not something an
    // unknown panel id caused.
    const IGNORED = /Service worker is disabled because the context is sandboxed/;
    page.on('pageerror', error => { if (!IGNORED.test(String(error))) errors.push(String(error)); });
    await page.goto(`${baseUrl}#v=1&t=1&panel=nope`, { waitUntil: 'domcontentloaded' });
    // Only the hash changed, so that was a same-document navigation. The link
    // this is about arrives cold.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const unknown = await page.evaluate(panels => ({
      hash: location.hash,
      open: panels.filter(id => document.getElementById(`${id}-panel`)?.hidden === false),
    }), PANELS);
    assert(errors.length === 0, `an unknown panel id threw: ${errors.join(' | ')}`);
    assert(unknown.open.length === 0, `an unknown panel id opened something: ${JSON.stringify(unknown.open)}`);
    assert(!unknown.hash.includes('panel='), `an unknown panel id was echoed back: ${unknown.hash}`);

    // The PWA manifest's bare token still opens its panel.
    for (const panel of ['stats', 'compare']) {
      await page.goto(`${baseUrl}#${panel}`, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.waitForSelector(`#${panel}-panel:not([hidden])`, { timeout: 10_000 }).catch(() => {
        throw new Error(`the manifest shortcut #${panel} stopped opening its panel`);
      });
    }
  } finally {
    await context.close();
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
    await stubQuietTropics(context);
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
          trackTitle: t('table.trackTimelineTitle'),
          trackHighlights: t('table.trackHighlights'),
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

      await openKatrinaPanel(page);
      const trackTimeline = page.locator('#track-timeline-host .track-timeline');
      await trackTimeline.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('#track-timeline-host .track-timeline-highlights li', { timeout: 5000 });
      assert((await trackTimeline.locator(':scope > summary').textContent()).includes(expected.trackTitle), `${locale}: track timeline title is not localized`);
      assert((await trackTimeline.locator('h4').textContent()) === expected.trackHighlights, `${locale}: track timeline highlights are not localized`);
      assert(await trackTimeline.locator('.track-timeline-row').count() > 0, `${locale}: track timeline rendered no rows`);
      await assertNoAxeViolations(page, `${locale} track timeline (WCAG 2.2 AA)`, '#storm-panel');

      await clickHeaderAction(page, '#toggle-spatial-search');
      await page.waitForSelector('#spatial-results:not([hidden]) h2', { timeout: 5_000 });
      assert((await page.locator('#spatial-results h2').textContent()) === expected.spatialTitle, `${locale}: spatial prompt is not localized`);
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

async function assertIosInstallGuide(browser, baseUrl) {
  const iosSafariUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  for (const locale of ['en', 'es', 'ht']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: iosSafariUserAgent,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
    });
    await seedSettings(context, { onboarded: true, locale, reducedMotion: true });
    await stubQuietTropics(context);
    const page = await context.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      await page.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
      await page.waitForSelector('#storage-manager [data-ios-install-guide]', { timeout: 5000 });
      const expected = await page.evaluate(async () => {
        const { t } = await import('/src/i18n.js');
        return {
          help: t('storage.iosInstallHelp'),
          action: t('storage.iosInstallAction'),
          title: t('onboarding.iosInstallTitle'),
          body: t('onboarding.iosInstallBody'),
          steps: [
            t('onboarding.iosInstallStepShare'),
            t('onboarding.iosInstallStepAdd'),
            t('onboarding.iosInstallStepOpen'),
          ],
          note: t('onboarding.iosInstallNote'),
          dismiss: t('onboarding.iosInstallDismiss'),
        };
      });
      assert(await page.locator('#storage-manager .storage-install-guide .settings-help').textContent() === expected.help, `${locale}: iOS install help is not localized`);
      assert(await page.locator('[data-ios-install-guide]').textContent() === expected.action, `${locale}: iOS install action is not localized`);
      await page.locator('[data-ios-install-guide]').dispatchEvent('click');
      await page.waitForSelector('.ios-install-overlay', { timeout: 5000 });
      const dialog = await page.evaluate(() => ({
        role: document.querySelector('.ios-install-overlay')?.getAttribute('role'),
        modal: document.querySelector('.ios-install-overlay')?.getAttribute('aria-modal'),
        title: document.querySelector('#ios-install-title')?.textContent || '',
        body: document.querySelector('#ios-install-body')?.textContent || '',
        steps: [...document.querySelectorAll('.ios-install-steps li')].map(item => item.textContent || ''),
        note: document.querySelector('#ios-install-note')?.textContent || '',
        dismiss: document.querySelector('.ios-install-dismiss')?.textContent || '',
        activeId: document.activeElement?.className || '',
      }));
      assert(dialog.role === 'dialog' && dialog.modal === 'true', `${locale}: iOS install guide is not a modal dialog`);
      assert(dialog.title === expected.title && dialog.body === expected.body, `${locale}: iOS install copy is not localized`);
      assert(JSON.stringify(dialog.steps) === JSON.stringify(expected.steps), `${locale}: iOS install steps are not localized`);
      assert(dialog.note === expected.note && dialog.dismiss === expected.dismiss, `${locale}: iOS install dismissal copy is not localized`);
      assert(dialog.activeId.includes('ios-install-dismiss'), `${locale}: iOS install guide did not focus its dismiss control`);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await page.waitForSelector('.ios-install-overlay', { state: 'detached', timeout: 5000 });
    } finally {
      await context.close();
    }
  }

  const standaloneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: iosSafariUserAgent,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await standaloneContext.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  await seedSettings(standaloneContext, { onboarded: true, locale: 'en', reducedMotion: true });
  await stubQuietTropics(standaloneContext);
  const standalonePage = await standaloneContext.newPage();
  try {
    await standalonePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(standalonePage);
    await standalonePage.evaluate(() => document.querySelector('#settings-menu')?.showPopover());
    await standalonePage.waitForSelector('#storage-manager .storage-summary', { timeout: 5000 });
    assert(await standalonePage.locator('[data-ios-install-guide]').count() === 0, 'standalone iOS Safari still shows the install guide');
  } finally {
    await standaloneContext.close();
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
    await stubQuietTropics(context);
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
  await stubQuietTropics(context);
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

    // axe reads colours, and the high-contrast class was toggled off and back
    // on three lines above, which starts every colour transition in the page
    // again. Reading through those reported a contrast violation whose node
    // count moved run to run: 7 to 9 nodes on 2026-09-08, 23 on 2026-09-09,
    // with a different first node each time, and the same tree passed on a
    // re-run. A count that changes without the tree changing is a timing
    // dependency, not a contrast defect.
    //
    // Same treatment assertThemeContrastMatrix already uses for the same
    // reason: contrast is a property of the settled colours, so measure with
    // no animation at all. Scoped to this measurement and removed afterwards,
    // because leaving it in collapses the animations that give the mobile
    // filter checkboxes their 44px touch targets.
    const forcedStillness = await page.addStyleTag({
      content: `*, *::before, *::after {
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
      }`,
    });
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    try {
      await assertNoAxeViolations(page, 'forced-colors main view (WCAG 2.2 AA)');
    } finally {
      await forcedStillness.evaluate(node => node.remove());
    }

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

    // The year histogram and every colour key ARE the data. Under forced
    // colours the user agent repaints anything it is allowed to, so without
    // forced-color-adjust: none the timeline rendered as an empty box, its
    // legend as blank squares, and the compare, season and radar keys lost the
    // colour that ties a row to a track on the map.
    await page.evaluate(async () => {
      const panels = await import('/src/panels.js');
      panels.closeAllPanels();
    });
    // All nine, not the two that happen to be on screen. The rest had no test
    // at all, so the only evidence they were fixed was that the CSS had been
    // written. Each is built here with the class the app gives it, because
    // the rule is keyed on the class and several of them only exist while a
    // panel that is not open would be.
    const dataSwatches = await page.evaluate(() => {
      const selectors = [
        ['.tl-bar', 'div'],
        ['.timeline-legend-item i', 'i'],
        ['.ct-dot', 'span'],
        ['.cp-swatch', 'span'],
        ['.dai-seg', 'span'],
        ['.tal-swatch', 'span'],
        ['.ss-tier-dot', 'span'],
        ['.radar-swatch', 'span'],
        ['.cp-header-swatch', 'span'],
      ];
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.left = '0';
      host.style.top = '0';
      document.body.appendChild(host);
      const measured = [];
      for (const [selector, tag] of selectors) {
        const live = document.querySelector(selector);
        let element = live;
        if (!element) {
          element = document.createElement(tag);
          // The last simple class in the selector is the one the rule keys on.
          element.className = selector.split(' ').pop().replace(/^[.#]/, '');
          element.style.display = 'inline-block';
          element.style.width = '12px';
          element.style.height = '12px';
          // A fill of the app's own palette, which is what the rule protects.
          element.style.backgroundColor = 'rgb(250, 179, 135)';
          host.appendChild(element);
        }
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        measured.push({
          selector,
          synthesized: !live,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          background: style.backgroundColor,
          border: style.borderTopWidth,
          borderColor: style.borderTopColor,
          forcedColorAdjust: style.forcedColorAdjust,
        });
      }
      host.remove();
      return measured;
    });
    assert(dataSwatches.length === 9, `forced-colors: expected nine data swatches, measured ${dataSwatches.length}`);
    for (const swatch of dataSwatches) {
      assert(
        swatch.forcedColorAdjust === 'none',
        `forced-colors: ${swatch.selector} lets the user agent repaint the datum: ${JSON.stringify(swatch)}`,
      );
      // Colour alone is not a safe encoding where the palette can be replaced,
      // and Chromium reports a repainted background as the opaque Canvas colour
      // rather than as transparent, so a "did it lose its fill" check cannot
      // see the regression. The outline is what can be measured, and it is also
      // what keeps a swatch findable when its fixed fill lands near the
      // reader's chosen background.
      assert(
        Number.parseFloat(swatch.border) > 0 && !/transparent|rgba(0,s*0,s*0,s*0)/i.test(swatch.borderColor),
        `forced-colors: ${swatch.selector} has no system-coloured outline to fall back on: ${JSON.stringify(swatch)}`,
      );
    }
    // Positive control: the histogram bar is real, on screen and painted, so a
    // green result above is not an artefact of measuring elements this probe
    // built for itself.
    const liveBar = dataSwatches.find(entry => entry.selector === '.tl-bar');
    assert(
      liveBar && !liveBar.synthesized && liveBar.width > 0 && liveBar.height > 0,
      `forced-colors: the timeline bar was not measured live, so the swatch checks prove less than they claim: ${JSON.stringify(liveBar)}`,
    );

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
  // A stale PNG from a previous run would make the count below agree with
  // the wrong thing, so the run owns this directory.
  await rm(visualSnapshotDir, { recursive: true, force: true });
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: { latitude: 25.7617, longitude: -80.1918 },
  });
  await seedSettings(context, { onboarded: true });
  await stubQuietTropics(context);
  const page = await context.newPage();
  const pageErrors = [];
  collectPageErrors(page, pageErrors);

  await page.goto(`${baseUrl}/#c=bad&s=NotAState`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await assertActivePopupDomSafety(page);
  await assertAdvisoryTooltipDomSafety(page);
  await assertLocationPrivacyFlow(page);
  await assertUndersizedSnapshotIsDiagnosed(page);
  await assertConfirmDialogContract(page);
  await assertSavedViewReplaceIsConfirmed(page);
  await assertEmptyFilterState(page);
  await assertUnpaintedMapIsRefused(page);

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
  // A hash whose every value is invalid leaves the reader on the default view,
  // which is not a view they shaped, so canonicalizing it must clear the
  // fragment rather than swap it for a 64-character release pin.
  assert(restored.hash === '', `invalid default hash was not cleared: ${restored.hash}`);
  assert(restored.state === '', `invalid state filter was not cleared: ${restored.state}`);
  assert(restored.categories.length === 6 && restored.categories.every(category => category.on && category.pressed === 'true'), 'invalid category hash did not restore default categories');
  assert(/landfalls/.test(restored.visible), `visible-count did not render: ${restored.visible}`);

  await assertReleasePinScope(context, baseUrl);
  await assertDeferredDataScope(context, baseUrl);
  await assertSettingsChangeKeepsPanel(context, baseUrl);
  await assertStormPanelMapContracts(context, baseUrl);
  await assertRowActivationKeepsFocus(context, baseUrl);
  await assertThemeChangeKeepsStormTrack(context, baseUrl);
  await assertSettingsMenuKeepsFocus(context, baseUrl);

  await assertDialogAndKeyboardContracts(page);

  const shortcutPage = await context.newPage();
  await shortcutPage.goto(`${baseUrl}/#stats`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(shortcutPage);
  await shortcutPage.waitForFunction(() => !document.querySelector('#stats-panel')?.hidden, null, { timeout: 10000 });
  await shortcutPage.close();

  await page.click('#toggle-info');
  await page.waitForFunction(() => {
    const modal = document.querySelector('#info-modal');
    const text = document.querySelector('#data-provenance-body')?.textContent || '';
    return modal && !modal.hidden && text.includes('hurdat2-atlantic.txt') && text.includes('1851-2025');
  }, null, { timeout: 5000 });
  const provenanceText = await page.textContent('#data-provenance-body');
  const aboutText = await page.textContent('#info-modal');
  assert(/595\s+storms/.test(provenanceText), 'About provenance did not render the storm count.');
  assert(/759\s+landfalls/.test(provenanceText), 'About provenance did not render the landfall count.');
  // This used to pin "16 of 16" and "100.0% precision", which were the numbers
  // from a check that only covered 1983-1990. The gate now scores every year
  // the AOML table gives a position for, so the dialog is held to the artifact
  // it is rendering rather than to figures typed in here. The artifact's own
  // correctness is validate:data's job: it recomputes the whole delta from the
  // raw table in a second language.
  const aomlExpected = await page.evaluate(async () => {
    const { getAomlValidation } = await import('/src/data.js');
    const validation = getAomlValidation();
    const scored = (validation.per_decade || []).filter(row => typeof row.recall === 'number');
    const weakest = scored.reduce((worst, row) => (row.recall < worst.recall ? row : worst));
    return {
      matched: validation.detected.matched_count,
      truth: validation.ground_truth.record_count,
      precision: (validation.detected.precision * 100).toFixed(1),
      recall: (validation.detected.recall * 100).toFixed(1),
      unmatched: validation.ground_truth.record_count - validation.detected.matched_count,
      weakestDecade: weakest.decade,
      startYear: validation.scope.start_year,
      endYear: validation.scope.end_year,
    };
  });
  assert(
    aboutText.includes(`${aomlExpected.matched} of ${aomlExpected.truth}`)
    && aboutText.includes(`${aomlExpected.precision}% precision`)
    && aboutText.includes(`${aomlExpected.recall}% recall`),
    `About did not render the measured AOML ground-truth result (${aomlExpected.matched}/${aomlExpected.truth}).`,
  );
  assert(
    aboutText.includes(`${aomlExpected.unmatched} reference rows unmatched`)
    && aboutText.includes(`${aomlExpected.weakestDecade}s`),
    'About did not state how many reference rows went unmatched or which decade is weakest.',
  );
  // A silent narrowing of the scored window would leave every ratio looking
  // healthy, so the span itself is asserted to be the whole published record.
  assert(
    aomlExpected.startYear <= 1851 && aomlExpected.endYear >= 2024
    && aboutText.includes(`${aomlExpected.startYear}`) && aboutText.includes(`${aomlExpected.endYear}`),
    `About did not state the full scored span (${aomlExpected.startYear}-${aomlExpected.endYear}).`,
  );
  assert(/Cite this release/.test(aboutText) && /@software\{hurricanemap_/.test(aboutText), 'About did not render copy-paste APA and BibTeX citations.');
  assert(
    expectedGeneratorVersion && provenanceText.includes(`HurricaneMap ${expectedGeneratorVersion}`),
    'About provenance did not render the generator app version.',
  );
  // Two tiers: the best track reaches 1851, the layers built on top of it do
  // not, and one range for all of them overstated the shallow ones.
  const coverageText = await page.textContent('#archive-coverage-body');
  assert(
    /Layer depth is shallower than the best track/.test(coverageText),
    `About did not distinguish layer depth from best-track depth: ${coverageText.slice(0, 200)}`,
  );
  // Read from data/coverage.json rather than typed here. These ranges were
  // hard-coded, so extending the advisory replay back to 2008 failed this
  // assertion on text that had become correct.
  const coverageRanges = await page.evaluate(async () => {
    const response = await fetch('data/coverage.json');
    const coverage = await response.json();
    const datasets = coverage.datasets || coverage;
    const rangeFor = id => {
      const dataset = datasets.find(entry => entry.id === id);
      return dataset?.year_range ? `${dataset.year_range[0]}-${dataset.year_range[1]}` : null;
    };
    return { radar: rangeFor('radar-archive'), replay: rangeFor('advisory-replay') };
  });
  for (const [label, range] of [['Archived NEXRAD radar', coverageRanges.radar], ['Advisory replay', coverageRanges.replay]]) {
    assert(range, `data/coverage.json carries no year range for ${label}, so the About claim cannot be checked`);
    assert(
      coverageText.includes(range),
      `About did not state ${label} as covering ${range}: ${coverageText.slice(0, 400)}`,
    );
  }
  assert(
    /next revision is expected in 2027/.test(coverageText),
    `About did not name when the next HURDAT2 revision is due: ${coverageText.slice(0, 300)}`,
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#info-modal')?.hidden, null, { timeout: 5000 });

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
  await page.waitForFunction(() => document.querySelector('#hm-update-prompt')?.hidden, null, { timeout: 5000 });
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
    await i18n.setLocale('es');
    const es = i18n.t('panel.loading');
    await i18n.setLocale('ht');
    const ht = i18n.t('panel.loading');
    await i18n.setLocale('en');
    return { before, es, ht };
  });
  assert(/Loading track/.test(localeStrings.before), `EN dynamic string wrong: ${localeStrings.before}`);
  assert(localeStrings.es !== localeStrings.before && /Cargando/.test(localeStrings.es), `ES dynamic string did not switch: ${localeStrings.es}`);
  assert(localeStrings.ht !== localeStrings.before && /chaje/.test(localeStrings.ht), `HT dynamic string did not switch: ${localeStrings.ht}`);

  await clickHeaderAction(page, '#toggle-on-this-date');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#on-this-date-panel');
    return panel && !panel.hidden && /On this date in history/.test(document.querySelector('#on-this-date-body')?.textContent || '');
  }, null, { timeout: 15000 });
  await page.evaluate(async () => (await import('/src/i18n.js')).setLocale('es'));
  await page.waitForFunction(() => /Esta fecha en la historia/.test(document.querySelector('#on-this-date-body')?.textContent || ''), null, { timeout: 10000 });
  const onThisDateEs = await page.textContent('#on-this-date-body');
  assert(!/Finding historical|\btoday\b|\bunnamed\b|Show full storm details/.test(onThisDateEs), `On-this-date Spanish surface retained English copy: ${onThisDateEs}`);
  await page.evaluate(async () => (await import('/src/i18n.js')).setLocale('ht'));
  await page.waitForFunction(() => /Jou sa a nan istwa/.test(document.querySelector('#on-this-date-body')?.textContent || ''), null, { timeout: 10000 });
  const onThisDateHt = await page.textContent('#on-this-date-body');
  assert(!/Finding historical|\btoday\b|\bunnamed\b|Show full storm details/.test(onThisDateHt), `On-this-date Haitian Creole surface retained English copy: ${onThisDateHt}`);
  await page.evaluate(async () => (await import('/src/i18n.js')).setLocale('en'));
  await page.click('#close-on-this-date');
  await page.waitForFunction(() => document.querySelector('#on-this-date-panel')?.hidden, null, { timeout: 5000 });

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
  }, null, { timeout: 15000 });
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
  // Replacing destroys every saved view on the device and is confirmed now, the
  // way deleting a single one already was. This step was added when the guard
  // was: the assertion below is unchanged and still describes what a completed
  // replace leaves behind.
  await page.waitForSelector('#confirm-local-action[open]');
  await page.click('.confirm-action-submit');
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
  }, null, { timeout: 15000 });

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
    // Stubbing the relay's responses is simulating a deployment that has the
    // relay, so say so: the feeds now skip the /nhc/ routes outright when the
    // active poll has already found them missing.
    const proxy = await import('/src/nhc-proxy.js');
    proxy.resetNhcProxyAvailability();
    proxy.reportNhcProxyAvailability(true);
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

  // Track recolouring. Driven through setSetting so the whole path is under
  // test: the stored setting, the redraw that clears lastTracksKey, the colour
  // Leaflet actually paints on the polyline, and the legend that says what it
  // means. Reading the ramp module directly would have proved only that the
  // ramp exists.
  const trackColors = await page.evaluate(async () => {
    const { setSetting } = await import('/src/settings.js');
    const { showTrack, clearTracks } = await import('/src/map.js');
    const { WIND_RAMP, MONTH_RAMP, NO_DATA_COLOR } = await import('/src/track-ramps.js');

    const read = async (mode) => {
      setSetting('trackColorBy', mode);
      clearTracks();
      // Katrina: a 2005 storm with wind and pressure throughout, so every
      // encoding has something to say about it.
      await showTrack('AL122005', { focus: true });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const strokes = [...document.querySelectorAll('#map path.track-line')]
        .map(node => (node.getAttribute('stroke') || '').toLowerCase())
        .filter(Boolean);
      const legend = document.querySelector('#track-color-legend');
      return {
        mode,
        strokes,
        unique: [...new Set(strokes)].sort(),
        legendHidden: legend ? legend.hidden : null,
        legendTitle: document.querySelector('#track-color-legend-title')?.textContent || '',
        legendRows: document.querySelectorAll('#track-color-legend-list li').length,
        legendSwatches: [...document.querySelectorAll('#track-color-legend-list .track-color-swatch')]
          .map(node => node.style.background),
      };
    };

    const out = {};
    for (const mode of ['category', 'wind', 'pressure', 'month']) out[mode] = await read(mode);
    out.ramps = { wind: [...WIND_RAMP], month: [...MONTH_RAMP], noData: NO_DATA_COLOR };
    setSetting('trackColorBy', 'category');
    clearTracks();
    return out;
  });

  for (const mode of ['category', 'wind', 'pressure', 'month']) {
    assert(
      trackColors[mode].strokes.length > 0,
      `${mode} drew no track segments, so nothing about its colours was measured`,
    );
  }
  // The whole point: switching the encoding has to change what is painted.
  assert(
    trackColors.category.unique.join() !== trackColors.wind.unique.join(),
    `colouring by wind painted the same strokes as category: ${trackColors.wind.unique.join(' ')}`,
  );
  assert(
    trackColors.wind.unique.join() !== trackColors.month.unique.join(),
    `colouring by month painted the same strokes as wind: ${trackColors.month.unique.join(' ')}`,
  );
  // And every stroke has to come from the ramp that encoding owns, not from a
  // stale palette left over from the previous redraw.
  const windPalette = new Set([...trackColors.ramps.wind, trackColors.ramps.noData].map(value => value.toLowerCase()));
  const strayWind = trackColors.wind.strokes.filter(stroke => !windPalette.has(stroke));
  assert(!strayWind.length, `wind mode painted colours outside its ramp: ${[...new Set(strayWind)].join(' ')}`);
  const monthPalette = new Set([...trackColors.ramps.month, trackColors.ramps.noData].map(value => value.toLowerCase()));
  const strayMonth = trackColors.month.strokes.filter(stroke => !monthPalette.has(stroke));
  assert(!strayMonth.length, `month mode painted colours outside its ramp: ${[...new Set(strayMonth)].join(' ')}`);

  // The legend follows, and says which variable it is showing.
  assert(
    trackColors.category.legendHidden === true && trackColors.category.legendRows === 0,
    'the category encoding must not add a second legend beside the Saffir-Simpson one',
  );
  for (const mode of ['wind', 'pressure', 'month']) {
    const seen = trackColors[mode];
    assert(seen.legendHidden === false, `${mode} left its legend hidden`);
    assert(seen.legendRows === seen.legendSwatches.length && seen.legendRows > 1, `${mode} legend rendered ${seen.legendRows} rows`);
    assert(seen.legendTitle.trim().length > 0, `${mode} legend has no heading`);
  }
  assert(
    new Set(['wind', 'pressure', 'month'].map(mode => trackColors[mode].legendTitle)).size === 3,
    'two encodings share a legend heading, so the legend does not say which one is showing',
  );

  // The marine layer draws one of NHC's two forecast bands, and the band is
  // stated nowhere in the KML: both files call themselves GMWW24Hr.kml, and
  // whenever no warning is in force the two are byte-identical. So the only
  // way a wrong band shows up is as the wrong ocean during a storm, which is
  // exactly when nobody is checking. Give the two bands different polygon
  // counts and prove the switch moves the data, not just the caption.
  const marineHorizons = await page.evaluate(async () => {
    const marine = await import('/src/marine-warnings.js');
    const { getMap } = await import('/src/map.js');
    const proxy = await import('/src/nhc-proxy.js');
    proxy.resetNhcProxyAvailability();
    proxy.reportNhcProxyAvailability(true);

    const placemark = name => `<Placemark><name>${name}</name><styleUrl>#high</styleUrl>`
      + '<Polygon><outerBoundaryIs><LinearRing><coordinates>-75,25 -74,25 -74,26 -75,25'
      + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>';
    // One placemark for the near band, two for the far one, per basin.
    const bodies = {
      '00to24': `<?xml version="1.0"?><kml><Document>${placemark('near')}</Document></kml>`,
      '24to48': `<?xml version="1.0"?><kml><Document>${placemark('far a')}${placemark('far b')}</Document></kml>`,
    };

    const realFetch = window.fetch;
    const requested = [];
    let refuse = false;
    window.fetch = async (url, init) => {
      const href = String(url);
      if (!href.includes('/nhc/marine/')) return realFetch(url, init);
      requested.push(href);
      if (refuse) return new Response('', { status: 503 });
      const band = href.includes('24to48') ? '24to48' : '00to24';
      return new Response(bodies[band], { status: 200 });
    };

    const draw = async (horizon, force) => {
      const before = requested.length;
      const result = await marine.renderMarineWarnings({ map: getMap(), enabled: true, horizon, force });
      const legend = document.querySelector('#marine-warning-legend');
      return {
        result,
        urls: requested.slice(before),
        legend: legend && !legend.hidden ? legend.textContent : '',
        paths: document.querySelectorAll('path.marine-warning-zone').length,
      };
    };

    try {
      const near = await draw('00to24', true);
      const far = await draw('24to48', true);
      // No force: a shared cache slot would hand back the far band's polygons.
      const nearAgain = await draw('00to24', false);
      // Switching to a band whose feeds are down must not leave the previous
      // band's ocean on the map under a legend and a settings pill that both
      // name the new one. Keeping the last good polygons is right only while
      // the band has not changed, and nothing on screen says which it is.
      refuse = true;
      const failedSwitch = await draw('24to48', true);
      // And a failure on the band already drawn keeps it, which is the whole
      // point of not clearing on every error.
      const failedSame = await draw('00to24', true);
      refuse = false;
      return { near, far, nearAgain, failedSwitch, failedSame };
    } finally {
      marine.clearMarineWarnings();
      window.fetch = realFetch;
    }
  });

  for (const [band, seen] of [['00to24', marineHorizons.near], ['24to48', marineHorizons.far]]) {
    assert(
      seen.result.status === 'rendered' && seen.result.horizon === band,
      `the ${band} marine band did not render as itself: ${JSON.stringify(seen.result)}`,
    );
    assert(
      seen.urls.length > 0 && seen.urls.every(url => url.includes(band)),
      `the ${band} marine band requested ${JSON.stringify(seen.urls)}`,
    );
  }
  assert(
    marineHorizons.near.result.polygonCount === 2 && marineHorizons.far.result.polygonCount === 4,
    `the two marine bands drew the same features: ${JSON.stringify([marineHorizons.near.result, marineHorizons.far.result])}`,
  );
  assert(
    marineHorizons.near.paths === 2 && marineHorizons.far.paths === 4,
    `the map kept the other band's polygons: ${marineHorizons.near.paths} then ${marineHorizons.far.paths}`,
  );
  assert(
    /0\u201324 hour outlook/.test(marineHorizons.near.legend)
      && /24\u201348 hour outlook/.test(marineHorizons.far.legend),
    `the marine legend does not say which forecast band it is showing: `
    + `${JSON.stringify([marineHorizons.near.legend, marineHorizons.far.legend])}`,
  );
  assert(
    marineHorizons.nearAgain.result.polygonCount === 2
      && marineHorizons.nearAgain.result.cacheOrigin === 'memory'
      && marineHorizons.nearAgain.urls.length === 0,
    `switching back to 0-24 h did not come from its own cache slot: ${JSON.stringify(marineHorizons.nearAgain)}`,
  );
  assert(
    marineHorizons.failedSwitch.result.status === 'error'
      && marineHorizons.failedSwitch.result.droppedStaleBand === true
      && marineHorizons.failedSwitch.paths === 0
      && marineHorizons.failedSwitch.legend === '',
    'a failed switch left the other band on the map: '
    + `${JSON.stringify([marineHorizons.failedSwitch.result, marineHorizons.failedSwitch.paths, marineHorizons.failedSwitch.legend])}`,
  );
  assert(
    marineHorizons.failedSame.result.status === 'error'
      && marineHorizons.failedSame.result.droppedStaleBand === false,
    `a failure on the drawn band must keep it: ${JSON.stringify(marineHorizons.failedSame.result)}`,
  );
  // Synthetic ErrorEvent exercises the listener + toast without registering
  // as a real uncaught error (which would trip the pageerror assertions).
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'hm-smoke-synthetic-error', filename: 'smoke.js' }));
  });
  await page.waitForFunction(() => {
    const toast = document.querySelector('.hm-toast--warn.is-visible');
    return !!toast && /Something went wrong/.test(toast.textContent || '');
  }, null, { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('.hm-toast--warn'), null, { timeout: 10000 });

  await assertBasemapNotWatermarked(page);
  await assertNoAxeViolations(page, 'main view (WCAG 2.2 AA)');

  await openKatrinaPanel(page);
  await page.waitForFunction(() => /Est\. exposure/.test(document.querySelector('#storm-panel .stat-grid')?.textContent || ''), null, { timeout: 10000 });
  await assertNoAxeViolations(page, 'storm panel (WCAG 2.2 AA)', '#storm-panel');
  const exposureText = await page.textContent('#storm-panel .stat-grid');
  assert(/Est\. exposure/.test(exposureText) && /Cat-2\+ winds/.test(exposureText), `Katrina exposure metric did not render: ${exposureText}`);
  const femaContext = await page.evaluate(() => ({
    state: document.querySelector('#fema-context')?.dataset.state || '',
    text: document.querySelector('#fema-context')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    links: [...document.querySelectorAll('#fema-context a')].map(link => link.href),
  }));
  assert(femaContext.state === 'success' && /LA/.test(femaContext.text) && /Orleans/.test(femaContext.text) && /DR/.test(femaContext.text), `FEMA declaration cards did not render: ${JSON.stringify(femaContext)}`);
  assert(femaContext.links.includes('https://www.fema.gov/disaster/1603') && femaContext.links.includes('https://www.fema.gov/disaster/3263'), `FEMA record links were not grounded to FEMA: ${JSON.stringify(femaContext.links)}`);
  const femaSmokeState = femaRouteStates.get(page);
  femaSmokeState.rows = [];
  await page.evaluate(async () => (await import('/src/fema.js')).clearFemaCache());
  await openKatrinaPanel(page);
  const femaEmptyText = await page.textContent('#fema-context');
  assert(/No FEMA declaration found/.test(femaEmptyText || ''), `FEMA unmatched state was blank or mislabeled: ${femaEmptyText}`);
  femaSmokeState.rows = FEMA_SMOKE_ROWS;
  await page.evaluate(async () => (await import('/src/fema.js')).clearFemaCache());
  await openKatrinaPanel(page);
  await assertVideoExport(page);
  await assertRadarRenderModes(page);
  await assertUnreadableRadarFrameIsReported(page);
  await assertStormOverlaysStopWithThePanel(page);
  // Live permalink navigation: assigning a new hash in an open tab must
  // apply it without a reload (hashchange listener).
  await page.evaluate(() => { location.hash = '#storm=AL092022'; });
  await page.waitForFunction(() => {
    const header = document.querySelector('#panel-sticky-header')?.textContent || '';
    return /Ian \(2022\)/i.test(header) && /AL092022/.test(header);
  }, null, { timeout: 15000 });
  await page.evaluate(() => { location.hash = '#storm=AL122005'; });
  await page.waitForFunction(() => {
    const header = document.querySelector('#panel-sticky-header')?.textContent || '';
    return /Katrina \(2005\)/i.test(header) && /AL122005/.test(header);
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const impacts = document.querySelector('#storm-panel .impacts-block')?.textContent || '';
    return /Est\. exposure/.test(document.querySelector('#storm-panel .stat-grid')?.textContent || '') &&
      /Billion-dollar disaster/.test(impacts) && /201\.3/.test(impacts.replace(/ /g, ' ')) && /1,833 deaths/.test(impacts);
  }, null, { timeout: 10000 });

  const impactsText = await page.textContent('#storm-panel .impacts-block');
  assert(/Billion-dollar disaster/.test(impactsText) && /\$201\.3B|\$201,297|201\.3/.test(impactsText.replace(/ /g, ' ')), `Katrina NCEI billion-dollar row did not render: ${impactsText}`);
  assert(/1,833 deaths/.test(impactsText), `Katrina NCEI deaths did not render: ${impactsText}`);

  await page.check('#cone-retro-enabled');
  await page.waitForFunction(() => document.querySelector('path.cone-retro-shape--circle') && /Cone drawn/.test(document.querySelector('#cone-retro-status')?.textContent || ''), null, { timeout: 10000 });
  const circleConePath = await page.getAttribute('path.cone-retro-shape--circle', 'd');
  await page.selectOption('#cone-retro-era', '2026');

  // The ellipse control is not in the panel. NHC has published the experimental
  // cone as graphics and not the 90th-percentile axes it draws, so the scale
  // factors this repository uses are its own and are withheld from readers
  // until the real axes exist. The renderer still supports the method, and this
  // drives it directly so that path keeps its coverage: a capability that is
  // not offered is not the same as one that has stopped working.
  const ellipseControl = await page.$('#cone-retro-ellipse');
  assert(
    ellipseControl === null,
    'the illustrative ellipse toggle must not be offered while data/cone-radii.json says the axes are unofficial',
  );

  const ellipseCone = await page.evaluate(async () => {
    const cone = await import('/src/cone-retro.js');
    const map = (await import('/src/map.js')).getMap();
    const storms = await import('/src/data.js');
    await storms.ensureStormsLoaded();
    const storm = storms.getStorm('AL122005');
    const result = await cone.renderRetrospectiveCone(storm, { map, era: '2026', ellipse: true });
    return {
      status: result.status,
      path: document.querySelector('path.cone-retro-shape--ellipse')?.getAttribute('d') || '',
      legend: document.querySelector('#cone-retro-legend')?.textContent || '',
      explainer: document.querySelector('.cone-retro-control p')?.textContent || '',
    };
  });
  assert(ellipseCone.status === 'rendered', `the ellipse method did not draw: ${JSON.stringify(ellipseCone)}`);
  assert(circleConePath && ellipseCone.path && circleConePath !== ellipseCone.path, 'ellipse mode did not redraw the retrospective cone geometry');
  assert(/illustrative ellipse/.test(ellipseCone.legend), `retrospective cone legend did not identify ellipse mode: ${ellipseCone.legend}`);
  assert(/not a historical forecast/i.test(ellipseCone.explainer), `retrospective cone explainer is incomplete: ${ellipseCone.explainer}`);
  // What NHC says about every cone, and what is true of this one in particular.
  assert(
    /says nothing about the risk of strong winds/i.test(ellipseCone.explainer),
    `the explainer must carry the wind-risk caveat: ${ellipseCone.explainer}`,
  );
  assert(
    /carries no probability/i.test(ellipseCone.explainer),
    `the explainer must say a circle around a known track carries no probability: ${ellipseCone.explainer}`,
  );
  await page.uncheck('#cone-retro-enabled');
  await page.waitForFunction(() => !document.querySelector('path.cone-retro-shape'), null, { timeout: 5000 });

  // Katrina predates the archived-advisory era, so the replay must say so and
  // release its own control rather than sitting enabled over an empty map.
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => /No archived advisories/.test(document.querySelector('#advisory-replay-status')?.textContent || ''),
    null,
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
  // Read from the dataset the message is generated from. Typed here, this
  // failed the moment the replay reached back to 2008, on text that had become
  // correct.
  const eraLabel = await page.evaluate(async () => {
    const response = await fetch('data/advisories.json');
    return (await response.json()).era?.label || '';
  });
  assert(/^\d{4}-\d{4}$/.test(eraLabel), `data/advisories.json carries no era label: ${JSON.stringify(eraLabel)}`);
  assert(
    outsideEra.status.includes(eraLabel),
    `advisory replay did not name its covered era ${eraLabel}: ${outsideEra.status}`,
  );

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
    null,
    { timeout: 15000 },
  );
  const idaProvenance = await page.textContent('#advisory-replay-provenance');
  assert(/10/.test(idaProvenance), `Ida replay did not report its ten post-tropical forecasts: ${idaProvenance}`);

  await openStormPanel(page, 'AL132020');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => /post-tropical stage/i.test(document.querySelector('#advisory-replay-provenance')?.textContent || ''),
    null,
    { timeout: 15000 },
  );
  const lauraProvenance = await page.textContent('#advisory-replay-provenance');
  assert(/5/.test(lauraProvenance), `Laura replay did not report its five post-tropical forecasts: ${lauraProvenance}`);

  await openStormPanel(page, 'AL142024');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), null, { timeout: 15000 });
  assert((await page.textContent('#advisory-replay-provenance')) === '', 'a complete replay incorrectly showed a provenance note');

  // Harvey exercises the expanded historical era: the replay record must carry
  // the annual 2017 NHC cone table rather than falling back to the 2025 pool.
  await openStormPanel(page, 'AL092017');
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-cone-shape'), null, { timeout: 15000 });
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
    null,
    { timeout: 15000 },
  );
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(
    () => document.querySelector('path.advisory-forecast-line') && document.querySelector('path.advisory-cone-shape'),
    null,
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
    null,
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
    null,
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
    null,
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
    null,
    { timeout: 15000 },
  );
  await page.locator('#advisory-replay-scrubber').evaluate(element => {
    element.value = element.max;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const scrubber = document.querySelector('#advisory-replay-scrubber');
    return scrubber?.value === scrubber?.max && scrubber?.getAttribute('aria-valuenow') === scrubber?.max;
  }, null, { timeout: 10000 });
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
  await page.waitForFunction(() => !document.querySelector('path.advisory-forecast-line'), null, { timeout: 5000 });
  await page.check('#advisory-replay-enabled');
  await page.waitForFunction(() => document.querySelector('path.advisory-forecast-line'), null, { timeout: 10000 });
  await page.check('#cone-retro-enabled');
  await page.waitForFunction(() => document.querySelector('path.cone-retro-shape'), null, { timeout: 10000 });
  await page.check('#art-mode-enabled');
  await page.waitForFunction(() => document.querySelector('path.art-risk-path'), null, { timeout: 10000 });
  await page.click('#toggle-stats');
  await page.waitForFunction(() => (
    document.querySelector('#storm-panel')?.hidden === true &&
    document.querySelector('#stats-panel')?.hidden === false
  ), null, { timeout: 10000 });
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
  await page.waitForFunction(() => document.querySelectorAll('path.art-risk-path--animated').length === 20 && /20 plausible paths/.test(document.querySelector('#art-mode-status')?.textContent || ''), null, { timeout: 5000 });
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
  await page.waitForFunction(() => document.querySelectorAll('path.art-risk-path--static').length === 20 && /without animation/.test(document.querySelector('#art-mode-status')?.textContent || ''), null, { timeout: 5000 });
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
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.matches(':popover-open'), null, { timeout: 5000 });
  await page.hover('#toggle-stats');
  await page.waitForFunction(() => {
    const tooltip = document.querySelector('#header-tooltip');
    return tooltip?.matches(':popover-open') || tooltip?.hasAttribute('data-fallback-open');
  }, null, { timeout: 5000 });
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
  }, null, { timeout: 5000 });
  assert(await page.getAttribute('#toggle-stats', 'title') === 'Statistics', 'tooltip fallback did not restore the native title');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#settings-menu')?.matches(':popover-open'), null, { timeout: 5000 });
  const afterSettingsEscape = await page.evaluate(() => ({
    stormPanelHidden: document.querySelector('#storm-panel')?.hidden,
    yearMin: document.querySelector('#year-min')?.value,
    yearMax: document.querySelector('#year-max')?.value,
  }));
  assert(afterSettingsEscape.stormPanelHidden === false, 'Escape while settings was open also closed the storm panel.');

  await clickHeaderAction(page, '#toggle-prep');
  await page.waitForSelector('#prep-panel:not([hidden]) #prep-household');
  await page.waitForFunction(() => document.activeElement?.id === 'prep-panel-title', null, { timeout: 5000 });
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
  await page.waitForFunction(() => document.querySelector('#prep-household')?.value === '4' && document.querySelector('[data-prep-item="water"]')?.checked, null, { timeout: 5000 });
  const prepLocales = await page.evaluate(async () => {
    const i18n = await import('/src/i18n.js');
    const prep = await import('/src/prep.js');
    await i18n.setLocale('es');
    prep.renderPrepPanel();
    const es = document.querySelector('#prep-body')?.textContent || '';
    await i18n.setLocale('ht');
    prep.renderPrepPanel();
    const ht = document.querySelector('#prep-body')?.textContent || '';
    await i18n.setLocale('en');
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
  await page.waitForFunction(() => /items cleared/i.test(document.querySelector('#map-announce')?.textContent || ''), null, { timeout: 5000 });
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
  let evacGeocodeCalls = 0;
  let evacGeocodeDelayMs = 0;
  await page.route('https://geocode.arcgis.com/**', async route => {
    evacGeocodeCalls += 1;
    if (evacGeocodeDelayMs) await new Promise(resolve => setTimeout(resolve, evacGeocodeDelayMs));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{
        address: '1100 Washington Ave, Miami Beach, Florida',
        location: { x: -80.1332, y: 25.7823 },
        attributes: { Region: 'FL', Match_addr: '1100 Washington Ave, Miami Beach, Florida' },
      }] }),
    });
  });
  await page.route('https://services.arcgis.com/**', route => {
    if (evacServiceDown) return route.fulfill({ status: 503, body: 'unavailable' });
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith('/FeatureServer/46') && requestUrl.searchParams.get('f') === 'json') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'Feature Layer',
          name: 'Florida evacuation zones',
          geometryType: 'esriGeometryPolygon',
          fields: [{ name: 'EZone' }, { name: 'County_Nam' }],
        }),
      });
    }
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
  const evacDisclosure = await page.textContent('#evac-disclosure');
  assert(/Esri.*World Geocoding Service/i.test(evacDisclosure) && /latitude\/longitude/i.test(evacDisclosure), `evacuation privacy disclosure is incomplete: ${evacDisclosure}`);
  await page.fill('#evac-address-input', '1100 Washington Ave, Miami Beach, FL');
  await page.click('#evac-address-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.evac-zone-badge strong')?.textContent === 'B', null, { timeout: 5000 });
  const evacAddressResult = await page.textContent('#evac-result');
  assert(/MIAMI-DADE/.test(evacAddressResult) && /not an evacuation order/i.test(evacAddressResult), `address zone result is incomplete: ${evacAddressResult}`);
  assert(await page.getAttribute('#evac-result a', 'href') === 'https://www.floridadisaster.org/knowyourzone/', 'zone result did not link to official Florida verification');

  // A second address submitted while the first geocode is still running aborts
  // the first, and the abort used to be rendered as a generic failure over the
  // lookup that was still in progress.
  // Both lookups are slow, so the second is still running when the first is
  // aborted. That window is the whole defect: the abort used to render a
  // generic failure over a lookup that had not finished, and the second
  // result then overwrote it, so it is invisible to anything that only checks
  // the settled state.
  evacGeocodeDelayMs = 2500;
  const geocodeCallsBeforeRace = evacGeocodeCalls;
  await page.fill('#evac-address-input', '1100 Washington Ave, Miami Beach, FL');
  await page.click('#evac-address-form button[type="submit"]');
  await page.waitForFunction(() => /Finding that Florida location/i.test(document.querySelector('#evac-result')?.textContent || ''), null, { timeout: 5000 });
  await page.fill('#evac-address-input', '1100 Washington Ave, Miami Beach, FL');
  await page.click('#evac-address-form button[type="submit"]');
  // Sample the class rather than the copy: renderFailure is the only thing
  // that sets the warning tone, and matching English text would false-green in
  // any other locale.
  const duringSecondLookup = await page.evaluate(async () => {
    const seen = [];
    for (let sample = 0; sample < 12; sample++) {
      const result = document.querySelector('#evac-result');
      seen.push({ tone: result?.className || '', text: (result?.textContent || '').slice(0, 90) });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return seen;
  });
  // Positive control: the samples have to have landed while the replacement
  // was still in flight, or the check proves nothing. Two geocode calls and a
  // pending state during the window are what "still in flight" means.
  assert(
    evacGeocodeCalls === geocodeCallsBeforeRace + 2,
    `the superseded-lookup check did not issue two geocode requests: ${evacGeocodeCalls - geocodeCallsBeforeRace}`,
  );
  assert(
    duringSecondLookup.some(sample => /Finding that Florida location/i.test(sample.text)),
    'the superseded-lookup check never saw the pending state, so it sampled the wrong window',
  );
  const flashedFailure = duringSecondLookup.filter(sample => /evac-result--warning/.test(sample.tone));
  assert(
    !flashedFailure.length,
    `a superseded address lookup painted an error while its replacement was still running: ${JSON.stringify(flashedFailure[0])}`,
  );
  evacGeocodeDelayMs = 0;
  await page.waitForFunction(() => document.querySelector('.evac-zone-badge strong')?.textContent === 'B', null, { timeout: 10000 });
  const supersededLookup = await page.textContent('#evac-result');
  assert(
    /MIAMI-DADE/.test(supersededLookup),
    `the second address lookup did not survive the first being aborted: ${supersededLookup}`,
  );

  const geocodeCallsBeforeMap = evacGeocodeCalls;
  await page.click('#evac-map-pick');
  await page.evaluate(async () => {
    const { getMap } = await import('/src/map.js');
    getMap().fire('click', { latlng: { lat: 25.7617, lng: -80.1918 } });
  });
  await page.waitForFunction(() => /Selected map point/.test(document.querySelector('#evac-result')?.textContent || ''), null, { timeout: 5000 });
  assert(evacGeocodeCalls === geocodeCallsBeforeMap, 'map-point lookup unexpectedly sent another address to the geocoder');
  assert(await page.locator('.evac-location-marker').count() === 1, 'map zone lookup did not mark the selected point');

  evacServiceDown = true;
  await page.fill('#evac-address-input', '1100 Washington Ave, Miami Beach, FL');
  await page.click('#evac-address-form button[type="submit"]');
  await page.waitForFunction(() => /Layer unavailable/i.test(document.querySelector('#evac-result')?.textContent || ''), null, { timeout: 5000 });
  const evacFallback = await page.evaluate(() => ({
    links: [...document.querySelectorAll('.evac-linkouts a')].map(link => link.textContent.trim()),
    floridaHref: document.querySelector('.evac-linkouts a')?.href || '',
  }));
  assert(evacFallback.links.length === 8 && ['North Carolina', 'South Carolina', 'Georgia', 'Texas', 'Virginia'].every(state => evacFallback.links.includes(state)), `service failure did not preserve state link-outs: ${JSON.stringify(evacFallback)}`);
  assert(evacFallback.floridaHref === 'https://www.floridadisaster.org/knowyourzone/', 'failure fallback is missing the official Florida link');
  await assertNoAxeViolations(page, 'evacuation zone panel (WCAG 2.2 AA)', '#evac-panel');
  await page.click('#close-evac');
  assert(await page.locator('.evac-location-marker').count() === 0, 'closing the zone panel left its selection marker on the map');

  await clickHeaderAction(page, '#toggle-poster');
  await page.waitForFunction(() => Number(document.querySelector('#poster-canvas')?.dataset.segmentCount) > 1000, null, { timeout: 15000 });
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
  await page.waitForFunction(() => /No data,\s*series ended 2024/.test(
    document.querySelector('#storm-panel .impacts-block')?.textContent || '',
  ), null, { timeout: 10000 });
  const closedSeriesText = await page.textContent('#storm-panel .impacts-block');
  assert(
    /No data,\s*series ended 2024/.test(closedSeriesText),
    `closed NCEI series was not distinguished from unavailable data: ${closedSeriesText}`,
  );

  await page.click('#toggle-filters');
  await page.waitForFunction(() => !document.querySelector('#filters')?.classList.contains('collapsed'), null, { timeout: 5000 });
  await page.fill('#year-min', '2005');
  await page.dispatchEvent('#year-min', 'change');
  await page.fill('#year-max', '2005');
  await page.dispatchEvent('#year-max', 'change');
  await page.waitForFunction(() => {
    const host = document.querySelector('#season-summary');
    const ace = document.querySelector('#season-summary [data-role="ace"] .ss-stat-num')?.textContent?.trim();
    return host && !host.hidden && ace && ace !== '...' && ace !== '-' && ace !== '\u2014';
  }, null, { timeout: 15000 });
  const seasonAce = await page.textContent('#season-summary [data-role="ace"] .ss-stat-num');
  // Above zero was true of any number at all, and this line goes on to print
  // "2005 ACE 108.8" as though it had been checked. 108.8 is the total for the
  // seven 2005 storms data/storms.json carries, pinned at the source in
  // test-climatology.mjs; this is the same figure having survived the round
  // trip through the season panel.
  assert(
    Math.abs(Number.parseFloat(seasonAce) - 108.8) < 0.05,
    `the 2005 season panel should read 108.8 ACE, read ${seasonAce}`,
  );

  await page.click('#toggle-stats');
  await page.waitForSelector('#climatology-chart .clim-legend-item', { timeout: 15000 });
  await page.waitForSelector('#decade-trends-chart .dt-row', { timeout: 15000 });
  await page.waitForSelector('#climate-trends-chart svg', { timeout: 15000 });
  await page.waitForFunction(() => {
    const host = document.querySelector('#impact-coverage-summary');
    return /244 of 595/.test(host?.textContent || '') &&
      host?.querySelectorAll('.impact-coverage-table tbody tr').length > 100;
  }, null, { timeout: 15000 });
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
  await page.waitForFunction(() => window.__exportCapture?.csv?.length > 0, null, { timeout: 5000 });
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
  await stubQuietTropics(mobileContext);
  const mobilePage = await mobileContext.newPage();
  const mobileErrors = [];
  collectPageErrors(mobilePage, mobileErrors);
  const mobileFailedRequests = [];
  collectFailedRequests(mobilePage, mobileFailedRequests);

  await mobilePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(mobilePage);
  // Let the deferred active-storm poll run: it is the request this counts.
  await mobilePage.waitForFunction(async () => {
    const feeds = await import('/src/optional-feeds.js');
    return feeds.getOptionalFeedState('active').state !== 'idle';
  }, null, { timeout: 20000 });
  assert(
    mobileFailedRequests.length <= EXPECTED_FAILED_REQUESTS,
    `a fresh load made ${mobileFailedRequests.length} failing same-origin requests, expected at most ${EXPECTED_FAILED_REQUESTS}: ${mobileFailedRequests.join(', ')}`,
  );
  assert(
    mobileFailedRequests.every(entry => entry.includes('/nhc/')),
    `a fresh load failed on something other than the NHC relay probe: ${mobileFailedRequests.join(', ')}`,
  );

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
  }, null, { timeout: 5000 });
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
  await assertPanelIsAddressable(browser, baseUrl);
  await assertFilterResetIsRecoverable(browser, baseUrl);
  await assertDualPaneComparison(browser, baseUrl);
  await assertSurgeInundationLayer(browser, baseUrl);
  await assertContinuousTrackColour(browser, baseUrl);
  await assertLocalizedWorkflowChrome(browser, baseUrl);
  await assertIosInstallGuide(browser, baseUrl);
  await assertSourceLanguageDisclosures(browser, baseUrl);
  await assertForcedColorsContract(browser, baseUrl);
  await assertComparisonExportParity(browser, baseUrl);
  await assertAdvisoryReplayEras(browser, baseUrl);
  await assertOverMapContrast(browser, baseUrl);
  await assertStormPanelContrast(browser, baseUrl);
  await assertAboutDialogContrast(browser, baseUrl);
  await assertFeedListenersDoNotAccumulate(browser, baseUrl);
  await assertSummaryServiceServesActiveStorms(browser, baseUrl);
  await assertRelayStillWinsForActiveStorms(browser, baseUrl);
  await assertHeaderStackingAndBlur(browser, baseUrl);
  // Spanish is the longest of the three subtitles, and it is where the flex
  // children have to shrink rather than be cut through a word.
  for (const locale of ['en', 'es', 'ht']) await assertHeaderTextIsNotCut(browser, baseUrl, locale);
  await assertHoverTreatmentFollowsTheTheme(browser, baseUrl);
  await assertFocusIndicatorInEveryTheme(browser, baseUrl);

  await browser.close();

  // The count and the files have to agree. One is what the code did, the other
  // is what survived, and a capture that wrote nothing is worth hearing about.
  const writtenSnapshots = (await readdir(visualSnapshotDir)).filter(file => file.endsWith('.png'));
  assert(
    writtenSnapshots.length === visualSnapshotCount,
    `the run took ${visualSnapshotCount} visual snapshots but ${writtenSnapshots.length} PNG${writtenSnapshots.length === 1 ? '' : 's'} are on disk: ${writtenSnapshots.join(', ')}`,
  );
  console.log(`smoke ok (${restored.visible}, 2005 ACE ${seasonAce}, decade ACE max ${stats.maxDecadeAce}, keyboard/focus contracts ok, ${visualSnapshotCount} visual snapshots, panel layout/playback matrix ok)`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
