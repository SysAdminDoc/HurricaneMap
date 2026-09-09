// One social card per storm.
//
// All 596 storm pages shared a single og:image, so every share of every storm
// showed the same generic screenshot and none of them showed the storm. Each
// page now points at a 1200x630 card carrying that storm's own track.
//
// The card is built as an SVG here and rasterised by the Chromium that
// Playwright already installs for the browser lanes, because a PNG is what the
// crawlers accept: Open Graph and Twitter both reject SVG. Inter is embedded
// from fonts/inter-latin.woff2 as a data URI rather than named as a family, so
// the text does not depend on what fonts the generating machine happens to have.
//
// The images are NOT byte-reproducible the way the pages are: a different
// Chromium build can lay out a glyph a fraction of a pixel differently. They are
// generated deliberately, by `npm run generate:social-images`, and committed.
// Nothing rebuilds them as part of the gates; the gate checks that every page
// points at a distinct card and that the card is on disk at the right size.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { categoryColor, windToCategory } from '../src/data.js';
import { categoryLabel, escapeHtml, headline, stormSlug } from './build-storm-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'social');

const sha256 = value => createHash('sha256').update(value).digest('hex');

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const MAP_PAD = 56;
const TEXT_BAND = 168;

/** Where a storm's card lives, relative to the site root. */
export function socialImagePath(storm) {
  return `social/${stormSlug(storm)}.png`;
}

// Equirectangular with the usual cosine correction, then fitted to the box
// without stretching. buildTrackSVG stretches to fill its frame, which is fine
// for a figure the reader is measuring and wrong for a card they are glancing
// at: a Gulf storm should not read as a transatlantic one.
function projector(track) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const point of track) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  if (minLat > maxLat) return null;
  const midLat = (minLat + maxLat) / 2;
  const scaleLon = Math.cos((midLat * Math.PI) / 180) || 1;
  // A storm that barely moved still needs a box with area, or every point lands
  // on one pixel and the card is blank.
  const spanX = Math.max((maxLon - minLon) * scaleLon, 1.5);
  const spanY = Math.max(maxLat - minLat, 1.5);

  const boxW = CARD_WIDTH - MAP_PAD * 2;
  const boxH = CARD_HEIGHT - TEXT_BAND - MAP_PAD;
  const scale = Math.min(boxW / spanX, boxH / spanY) * 0.88;
  const centreX = ((minLon + maxLon) / 2) * scaleLon;
  const centreY = midLat;

  return (lat, lon) => [
    CARD_WIDTH / 2 + (lon * scaleLon - centreX) * scale,
    (CARD_HEIGHT - TEXT_BAND) / 2 - (lat - centreY) * scale,
  ];
}

// windToCategory returns 0 for a depression and -1 for a tropical storm, so the
// codes do not sort by intensity and a plain max picks the depression.
function intensityRank(category) {
  if (category >= 1) return category;
  return category === -1 ? 0 : -1;
}

function peakCategory(storm) {
  let best = null;
  for (const point of storm.track || []) {
    const category = windToCategory(point.wind);
    if (best === null || intensityRank(category) > intensityRank(best)) best = category;
  }
  return best;
}

function subtitle(storm, landfalls) {
  // The year moved into the headline when the card started using it, so the
  // subtitle carries only what the headline does not.
  const parts = [];
  if (Number.isFinite(storm.peak_wind_kt)) parts.push(`Peak ${storm.peak_wind_kt} kt`);
  if (Number.isFinite(storm.min_pres_mb)) parts.push(`${storm.min_pres_mb} mb`);
  if (landfalls.length) {
    const states = [...new Set(landfalls.map(row => row.state).filter(Boolean))];
    if (states.length) parts.push(states.length > 2 ? `${states.length} states` : states.join(' and '));
  }
  return parts.join('  ·  ');
}

export function buildSocialCardSvg(storm, landfalls) {
  const track = (storm.track || []).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const project = projector(track);
  // The page's own headline, not a second rule for the same question. The page
  // calls a storm a hurricane by its strongest U.S. landfall and this had been
  // calling it one by its peak anywhere, so 35 pages said "Storm Love (1950)"
  // in the title and og:image:alt above a card that read "Hurricane Love".
  const title = headline(storm);
  const peak = peakCategory(storm);

  const segments = [];
  for (let index = 1; project && index < track.length; index += 1) {
    const [x1, y1] = project(track[index - 1].lat, track[index - 1].lon);
    const [x2, y2] = project(track[index].lat, track[index].lon);
    segments.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
      + `stroke="${categoryColor(windToCategory(track[index].wind))}" stroke-width="6" stroke-linecap="round"/>`,
    );
  }

  const marks = !project ? [] : landfalls
    .filter(row => Number.isFinite(row.lat) && Number.isFinite(row.lon))
    .map(row => {
      const [cx, cy] = project(row.lat, row.lon);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="${categoryColor(windToCategory(row.wind))}" stroke="#11111b" stroke-width="4"/>`;
    });

  // A storm with one usable position draws no segment, so its own dot is the
  // only thing on the card.
  const origin = project && track.length === 1
    ? [`<circle cx="${project(track[0].lat, track[0].lon)[0].toFixed(1)}" cy="${project(track[0].lat, track[0].lon)[1].toFixed(1)}" r="9" fill="${categoryColor(windToCategory(track[0].wind))}"/>`]
    : [];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#11111b"/>
  <g opacity="0.95">
    ${segments.join('\n    ')}
    ${origin.join('\n    ')}
  </g>
  <g>
    ${marks.join('\n    ')}
  </g>
  <rect x="0" y="${CARD_HEIGHT - TEXT_BAND}" width="${CARD_WIDTH}" height="${TEXT_BAND}" fill="#11111b" opacity="0.92"/>
  <rect x="${MAP_PAD}" y="${CARD_HEIGHT - TEXT_BAND}" width="${CARD_WIDTH - MAP_PAD * 2}" height="2" fill="#313244"/>
  <text x="${MAP_PAD}" y="${CARD_HEIGHT - 92}" font-size="52" font-weight="700" fill="#cdd6f4">${escapeHtml(title)}</text>
  <text x="${MAP_PAD}" y="${CARD_HEIGHT - 52}" font-size="26" fill="#a6adc8">${escapeHtml(subtitle(storm, landfalls))}</text>
  <text x="${MAP_PAD}" y="${CARD_HEIGHT - 20}" font-size="20" fill="#6c7086">HurricaneMap  ·  NOAA HURDAT2 best track  ·  ${escapeHtml(storm.id)}</text>
  <text x="${CARD_WIDTH - MAP_PAD}" y="${CARD_HEIGHT - 92}" text-anchor="end" font-size="30" font-weight="700" fill="${categoryColor(peak)}">${escapeHtml(categoryLabel(peak))}</text>
</svg>`;
}

function cardDocument(svg, fontDataUri) {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:CardInter;src:url(${fontDataUri}) format('woff2');font-weight:100 900;font-display:block}
html,body{margin:0;padding:0;background:#11111b}
svg{display:block}
svg text{font-family:CardInter,sans-serif}
</style>${svg}`;
}

export async function buildSocialImages({ write = true } = {}) {
  const [stormsGz, landfallsRaw, fontBytes] = await Promise.all([
    readFile(path.join(root, 'data', 'storms.json.gz')),
    readFile(path.join(root, 'data', 'landfalls.json'), 'utf8'),
    readFile(path.join(root, 'fonts', 'inter-latin.woff2')),
  ]);
  const storms = JSON.parse(gunzipSync(stormsGz).toString('utf8'));
  const landfallsByStorm = new Map();
  for (const row of JSON.parse(landfallsRaw)) {
    if (!landfallsByStorm.has(row.storm_id)) landfallsByStorm.set(row.storm_id, []);
    landfallsByStorm.get(row.storm_id).push(row);
  }
  const fontDataUri = `data:font/woff2;base64,${fontBytes.toString('base64')}`;

  const cards = storms.map(storm => ({
    storm,
    file: socialImagePath(storm),
    svg: buildSocialCardSvg(storm, landfallsByStorm.get(storm.id) || []),
  }));
  if (!write) return { cards };

  const { chromium } = await import('playwright');
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOptions);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = {};
  let written = 0;
  let bytes = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: CARD_WIDTH, height: CARD_HEIGHT },
      deviceScaleFactor: 1,
    });
    for (const card of cards) {
      await page.setContent(cardDocument(card.svg, fontDataUri), { waitUntil: 'load' });
      // The face is font-display:block, so text is invisible until it loads.
      // Screenshotting before that produced cards with a track and no name.
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: 'png' });
      await writeFile(path.join(root, card.file), png);
      manifest[`${stormSlug(card.storm)}.png`] = {
        storm_id: card.storm.id,
        svg_sha256: sha256(card.svg),
        png_sha256: sha256(png),
      };
      written += 1;
      bytes += png.length;
    }
  } finally {
    await browser.close();
  }
  // The rasteriser is not reproducible, so nothing can rebuild these and
  // compare. This is what ties each committed card to the storm it was drawn
  // from: the SVG hash catches a card left behind by a track revision, and the
  // PNG hash catches one that was swapped, truncated or edited afterwards.
  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify({ schema_version: 1, width: CARD_WIDTH, height: CARD_HEIGHT, cards: manifest }, null, 2)}
`,
    'utf8',
  );
  return { cards, written, bytes, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSocialImages({ write: true });
  const mb = (result.bytes / 1024 / 1024).toFixed(1);
  console.log(`social images ok (${result.written} cards, ${CARD_WIDTH}x${CARD_HEIGHT}, ${mb} MB)`);
}
