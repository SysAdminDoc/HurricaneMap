import { ensureStormsLoaded, getStorm, categoryColor, categoryLabel, windToCategory } from './data.js';
import { buildExportProvenance } from './export-provenance.js';
import { escapeHtml, formatStormName } from './html-utils.js';

const SVG_W = 800;
const SVG_H = 500;
const PAD = 40;

function project(lat, lon, bounds) {
  const x = PAD + ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * (SVG_W - PAD * 2);
  const y = PAD + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat)) * (SVG_H - PAD * 2);
  return [x, y];
}

function computeBounds(track) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of track) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const latPad = (maxLat - minLat) * 0.15 || 2;
  const lonPad = (maxLon - minLon) * 0.15 || 2;
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
  };
}

function buildTrackSegments(track, bounds) {
  const segs = [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const cat = windToCategory(b.wind);
    const [x1, y1] = project(a.lat, a.lon, bounds);
    const [x2, y2] = project(b.lat, b.lon, bounds);
    segs.push({ x1, y1, x2, y2, color: categoryColor(cat) });
  }
  return segs;
}

function buildLandfallDots(storm, bounds) {
  const lfs = storm.us_landfalls || storm.landfalls || [];
  if (!lfs.length) return [];
  return lfs.map(lf => {
    const [cx, cy] = project(lf.lat, lf.lon, bounds);
    const cat = windToCategory(lf.wind);
    return { cx, cy, color: categoryColor(cat), label: categoryLabel(lf.category ?? cat) };
  });
}

function buildLegend() {
  const cats = [
    { cat: -1, label: 'TS' },
    { cat: 1, label: 'Cat 1' },
    { cat: 2, label: 'Cat 2' },
    { cat: 3, label: 'Cat 3' },
    { cat: 4, label: 'Cat 4' },
    { cat: 5, label: 'Cat 5' },
  ];
  return cats.map((c, i) => {
    const y = SVG_H - 18 - (cats.length - 1 - i) * 18;
    const color = categoryColor(c.cat);
    return `<circle cx="${SVG_W - PAD - 60}" cy="${y}" r="4" fill="${color}"/>` +
           `<text x="${SVG_W - PAD - 50}" y="${y + 4}" font-size="11" fill="#cdd6f4">${c.label}</text>`;
  }).join('\n    ');
}

export function buildTrackSVG(storm, { exportedAt = new Date().toISOString() } = {}) {
  if (!storm || !storm.track?.length) return null;

  const bounds = computeBounds(storm.track);
  const segs = buildTrackSegments(storm.track, bounds);
  const dots = buildLandfallDots(storm, bounds);
  const legend = buildLegend();

  const name = formatStormName(storm.name);
  const title = escapeHtml(`${name} (${storm.year})`);
  const provenance = buildExportProvenance({
    artifactPaths: [
      'data/storms.json',
      'data/metadata.json',
      'data/hurdat2-sources.json',
      'data/hurdat2-atlantic.txt',
      'data/hurdat2-nepac.txt',
    ],
    exportedAt,
    methodology: [
      'The SVG renders the shipped HURDAT2 best-track positions for one storm.',
      'Track segments are colored by sustained-wind category; landfall points are marked separately.',
      'Coordinates are projected into a bounded 800 by 500 publication view.',
    ],
  });
  const provenanceJson = JSON.stringify(provenance).replaceAll(']]>', ']]]]><![CDATA[>');

  const trackLines = segs.map(s =>
    `<line x1="${s.x1.toFixed(1)}" y1="${s.y1.toFixed(1)}" x2="${s.x2.toFixed(1)}" y2="${s.y2.toFixed(1)}" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round"/>`
  ).join('\n    ');

  const landfallCircles = dots.map(d =>
    `<circle cx="${d.cx.toFixed(1)}" cy="${d.cy.toFixed(1)}" r="5" fill="${d.color}" stroke="#11111b" stroke-width="1.5"/>`
  ).join('\n    ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">
  <metadata id="hurricanemap-provenance"><![CDATA[${provenanceJson}]]></metadata>
  <rect width="${SVG_W}" height="${SVG_H}" fill="#11111b"/>
  <text x="${PAD}" y="24" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="700" fill="#cdd6f4">${title}</text>
  <text x="${PAD}" y="40" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#6c7086">HURDAT2 best-track · HurricaneMap · NOAA/NHC</text>
  <g>
    ${trackLines}
  </g>
  <g>
    ${landfallCircles}
  </g>
  <g font-family="Inter, system-ui, sans-serif">
    ${legend}
  </g>
  <text x="${PAD}" y="${SVG_H - 8}" font-family="Inter, system-ui, sans-serif" font-size="9" fill="#585b70">Data: NOAA National Hurricane Center HURDAT2 · https://www.nhc.noaa.gov/data/</text>
</svg>`;

  return svg;
}

export async function exportTrackSVG(stormId) {
  await ensureStormsLoaded();
  const storm = getStorm(stormId);
  const svg = buildTrackSVG(storm);
  if (!svg) return null;

  const name = formatStormName(storm.name);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/\s+/g, '-')}-${storm.year}-track.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
