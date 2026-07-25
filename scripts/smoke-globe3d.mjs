import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const visualSnapshotDir = path.join(root, 'test-results', 'visual');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('Playwright is required for npm run test:globe3d-smoke. Run npm install first.');
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summarizePng(buffer) {
  const { width, height, rgba } = decodePng(buffer);
  let nonDarkPixels = 0;
  let variedPixels = 0;
  let saturatedPixels = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const a = rgba[i + 3];
    if (a === 0) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (r + g + b > 60) nonDarkPixels += 1;
    if (max - min > 10) variedPixels += 1;
    if (max > 95 && max - min > 35) saturatedPixels += 1;
  }
  return { width, height, nonDarkPixels, variedPixels, saturatedPixels };
}

function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';
  assert(buffer.subarray(0, 8).toString('hex') === signature, 'canvas screenshot is not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert(width > 0 && height > 0, 'canvas screenshot PNG has no dimensions');
  assert(bitDepth === 8 && (colorType === 2 || colorType === 6), `unsupported PNG format ${bitDepth}/${colorType}`);
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  let input = 0;
  let output = 0;
  let prior = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[input];
    input += 1;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[input];
      input += 1;
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = prior[x] || 0;
      const upLeft = x >= bytesPerPixel ? prior[x - bytesPerPixel] : 0;
      if (filter === 0) row[x] = value;
      else if (filter === 1) row[x] = (value + left) & 0xff;
      else if (filter === 2) row[x] = (value + up) & 0xff;
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (value + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * bytesPerPixel;
      rgba[output] = row[src];
      rgba[output + 1] = row[src + 1];
      rgba[output + 2] = row[src + 2];
      rgba[output + 3] = colorType === 6 ? row[src + 3] : 255;
      output += 4;
    }
    prior = row;
  }
  return { width, height, rgba };
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

try {
  await mkdir(new URL('../.tmp-pw/', import.meta.url), { recursive: true });
  await mkdir(visualSnapshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    localStorage.setItem('hm-settings-v1', JSON.stringify({ onboarded: true }));
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/#storm=AL122005`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const visible = document.querySelector('#visible-count')?.textContent || '';
    return loading && loading.style.display === 'none' && /landfalls/.test(visible);
  }, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#storm-panel')?.hidden, { timeout: 10000 });

  await page.click('#toggle-globe3d');
  await page.waitForSelector('#globe3d-panel:not([hidden])', { timeout: 5000 });
  assert(await page.evaluate(() => document.activeElement?.id === 'close-globe3d'), '3D globe dialog did not focus its close button');
  await page.waitForSelector('#globe3d-canvas canvas', { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('#globe3d-panel')?.dataset.ready === 'true', { timeout: 90000 });

  const desktop = await page.evaluate(() => {
    const panel = document.querySelector('#globe3d-panel');
    const canvas = document.querySelector('#globe3d-canvas canvas');
    const status = document.querySelector('#globe3d-status')?.textContent || '';
    const subtitle = document.querySelector('#globe3d-subtitle')?.textContent || '';
    const box = canvas.getBoundingClientRect();
    return {
      ready: panel.dataset.ready,
      entities: Number(panel.dataset.entities || 0),
      windCones: Number(panel.dataset.windCones || 0),
      width: box.width,
      height: box.height,
      status,
      subtitle,
    };
  });

  await page.locator('#globe3d-panel').screenshot({ path: path.join(visualSnapshotDir, 'desktop-globe.png'), animations: 'disabled' });
  const desktopCanvasPng = await page.locator('#globe3d-canvas canvas').screenshot({ path: path.join(visualSnapshotDir, 'desktop-globe-canvas.png'), animations: 'disabled' });
  const desktopPixels = summarizePng(desktopCanvasPng);

  assert(desktop.ready === 'true', '3D globe did not mark itself ready');
  assert(desktop.entities > 0, '3D globe did not create track entities');
  assert(desktop.windCones > 0, '3D globe did not expose focused storm wind-cone layers');
  assert(desktop.width >= 1000 && desktop.height >= 700, `desktop canvas is too small: ${desktop.width}x${desktop.height}`);
  assert(/3D globe ready/.test(desktop.status), `unexpected globe status: ${desktop.status}`);
  assert(/elevated segments/.test(desktop.subtitle) && /wind-cone layers/.test(desktop.subtitle) && /focused storm/.test(desktop.subtitle), `globe subtitle did not summarize focused tracks and cones: ${desktop.subtitle}`);
  assert(
    desktopPixels.nonDarkPixels > 50_000 && desktopPixels.variedPixels > 50_000 && desktopPixels.saturatedPixels > 1_000,
    `desktop canvas appears blank or unrendered: ${JSON.stringify({ desktop, desktopPixels })}`,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  const mobile = await page.evaluate(() => {
    const canvas = document.querySelector('#globe3d-canvas canvas');
    const topbar = document.querySelector('.globe3d-topbar');
    const c = canvas.getBoundingClientRect();
    const t = topbar.getBoundingClientRect();
    return {
      canvasWidth: c.width,
      canvasHeight: c.height,
      topbarWidth: t.width,
      topbarHeight: t.height,
      topbarBottom: t.bottom,
      viewportHeight: innerHeight,
    };
  });
  await page.locator('#globe3d-panel').screenshot({ path: path.join(visualSnapshotDir, 'mobile-globe.png'), animations: 'disabled' });
  const mobileCanvasPng = await page.locator('#globe3d-canvas canvas').screenshot({ path: path.join(visualSnapshotDir, 'mobile-globe-canvas.png'), animations: 'disabled' });
  const mobilePixels = summarizePng(mobileCanvasPng);
  assert(mobile.canvasWidth >= 360 && mobile.canvasHeight >= 800, `mobile canvas is too small: ${mobile.canvasWidth}x${mobile.canvasHeight}`);
  assert(mobile.topbarWidth <= 374 && mobile.topbarHeight < 260, `mobile topbar overflows or covers too much canvas: ${mobile.topbarWidth}x${mobile.topbarHeight}`);
  assert(mobile.topbarBottom < mobile.viewportHeight - 320, 'mobile globe controls leave too little interactive canvas');
  assert(
    mobilePixels.nonDarkPixels > 10_000 && mobilePixels.variedPixels > 10_000,
    `mobile canvas appears blank or unrendered: ${JSON.stringify({ mobile, mobilePixels })}`,
  );
  await page.evaluate(() => {
    const dialog = document.querySelector('#globe3d-panel');
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    window.__expectedGlobeFirstFocus = focusable[0] || null;
    focusable.at(-1)?.focus();
  });
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement === window.__expectedGlobeFirstFocus), '3D globe dialog did not wrap focus');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#globe3d-panel')?.hidden, { timeout: 5000 });
  assert(await page.evaluate(() => document.activeElement?.id === 'toggle-globe3d'), '3D globe dialog did not return focus to its opener');

  await context.close();
  await browser.close();
  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

  console.log(`globe3d smoke ok (${Math.round(desktop.width)}x${Math.round(desktop.height)}, ${desktop.entities} entities, ${desktop.windCones} cone layers, ${desktopPixels.variedPixels} varied pixels)`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
