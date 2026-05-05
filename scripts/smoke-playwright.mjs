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
  console.error('Playwright is required for npm run test:smoke. Run npm install first.');
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

try {
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

  await page.goto(`${baseUrl}/#c=bad&s=NotAState`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading');
    const visible = document.querySelector('#visible-count')?.textContent || '';
    return loading && loading.style.display === 'none' && /landfalls/.test(visible);
  }, { timeout: 20000 });

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
  assert(restored.hash === '', `invalid default hash was not cleaned: ${restored.hash}`);
  assert(restored.state === '', `invalid state filter was not cleared: ${restored.state}`);
  assert(restored.categories.length === 6 && restored.categories.every(category => category.on && category.pressed === 'true'), 'invalid category hash did not restore default categories');
  assert(/landfalls/.test(restored.visible), `visible-count did not render: ${restored.visible}`);

  await page.click('#toggle-info');
  await page.waitForFunction(() => {
    const modal = document.querySelector('#info-modal');
    const text = document.querySelector('#data-provenance-body')?.textContent || '';
    return modal && !modal.hidden && text.includes('hurdat2-atlantic.txt') && text.includes('1851-2025');
  }, { timeout: 5000 });
  const provenanceText = await page.textContent('#data-provenance-body');
  assert(/596\s+storms/.test(provenanceText), 'About provenance did not render the storm count.');
  assert(/760\s+landfalls/.test(provenanceText), 'About provenance did not render the landfall count.');
  assert(/HurricaneMap 1\.3\.9/.test(provenanceText), 'About provenance did not render the generator app version.');
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
  assert(/latest map shell and offline cache/.test(updatePromptText), 'service-worker update prompt help copy did not render.');
  await page.click('#hm-update-prompt .hm-update-dismiss');
  await page.waitForFunction(() => document.querySelector('#hm-update-prompt')?.hidden, { timeout: 5000 });
  await page.evaluate(() => window.__swUpdatePrompt.show());
  await page.click('#hm-update-prompt .hm-update-reload');
  const reloadClicked = await page.evaluate(() => window.__swUpdateReload);
  assert(reloadClicked === true, 'service-worker update prompt reload action did not fire.');
  await page.evaluate(() => window.__swUpdatePrompt.hide());

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
  await page.waitForFunction(() => /Est\. exposure/.test(document.querySelector('#storm-panel .stat-grid')?.textContent || ''), { timeout: 10000 });
  const exposureText = await page.textContent('#storm-panel .stat-grid');
  assert(/Est\. exposure/.test(exposureText) && /Cat-2\+ winds/.test(exposureText), `Katrina exposure metric did not render: ${exposureText}`);
  await page.click('#toggle-settings');
  await page.waitForFunction(() => !document.querySelector('#settings-menu')?.hidden, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#settings-menu')?.hidden, { timeout: 5000 });
  const afterSettingsEscape = await page.evaluate(() => ({
    stormPanelHidden: document.querySelector('#storm-panel')?.hidden,
    yearMin: document.querySelector('#year-min')?.value,
    yearMax: document.querySelector('#year-max')?.value,
  }));
  assert(afterSettingsEscape.stormPanelHidden === false, 'Escape while settings was open also closed the storm panel.');

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
  assert(!/undefined|NaN/.test(impactText), `impact panel contains invalid text: ${impactText}`);

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
  await browser.close();

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);

  console.log(`smoke ok (${restored.visible}, 2005 ACE ${seasonAce}, decade ACE max ${stats.maxDecadeAce})`);
} finally {
  await new Promise(resolve => server.close(resolve));
}
