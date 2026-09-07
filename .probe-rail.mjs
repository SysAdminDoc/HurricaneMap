import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const mime = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.geojson','application/geo+json; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.png','image/png'],['.woff2','font/woff2']]);
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    const resolved = path.resolve(root, '.' + p);
    if (!resolved.startsWith(root)) throw new Error('no');
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error('no');
    res.writeHead(200, { 'Content-Type': mime.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(resolved).pipe(res);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('hm-settings-v1', JSON.stringify({ onboarded: true, theme: 'dark', locale: 'en', reducedMotion: true })); });
await ctx.route('https://mapservices.weather.noaa.gov/**', r => r.fulfill({ status: 200, contentType: 'application/geo+json', body: '{"type":"FeatureCollection","features":[]}' }));
const page = await ctx.newPage();
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#loading')?.style.display === 'none', { timeout: 20000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const rail = document.querySelector('.atlas-context-rail');
  const cs = getComputedStyle(rail);
  return {
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    rect: rail.getBoundingClientRect().toJSON(),
    bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 60),
    spans: [...rail.querySelectorAll('span')].map(s => ({ cls: s.className, text: (s.textContent||'').trim().slice(0,20), w: s.getBoundingClientRect().width, h: s.getBoundingClientRect().height, color: getComputedStyle(s).color })),
  };
}, null), null, 1));
await browser.close();
await new Promise(r => server.close(r));
