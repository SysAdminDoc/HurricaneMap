// Export the storm-panel intensity chart as PNG or SVG.
//
// PNG path: serialize the live <svg>, draw it into an offscreen canvas at
// 2× scale (retina-crisp), then toBlob → trigger a download. Pure browser,
// no deps. SVG path: just XMLSerializer.serializeToString.

import { downloadBlob } from './metrics.js';

function slug(name) {
  return String(name || 'storm').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Serialize an SVGElement into a standalone string with proper xmlns. */
function serializeSvg(svgEl) {
  const clone = svgEl.cloneNode(true);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  // Inline a tiny stylesheet so the exported SVG renders consistently when
  // opened standalone (without our app CSS).
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    text { font-family: Inter, system-ui, sans-serif; font-size: 9px; fill: #cdd6f4; }
    .ax-tick { fill: rgba(205,214,244,0.7); font-size: 9px; }
    rect.bg { fill: #11111b; }
  `;
  // Background so PNGs aren't transparent.
  const vb = (clone.getAttribute('viewBox') || '0 0 360 160').split(/\s+/).map(Number);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('class', 'bg');
  bg.setAttribute('x', vb[0]); bg.setAttribute('y', vb[1]);
  bg.setAttribute('width', vb[2]); bg.setAttribute('height', vb[3]);
  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export function exportChartAsSvg(svgEl, stormName) {
  if (!svgEl) return false;
  const xml = serializeSvg(svgEl);
  downloadBlob({
    filename: `hurricanemap-${slug(stormName)}-intensity.svg`,
    mime: 'image/svg+xml',
    body: xml,
  });
  return true;
}

export function exportChartAsPng(svgEl, stormName, scale = 2) {
  return new Promise((resolve, reject) => {
    if (!svgEl) return reject(new Error('no svg'));
    const xml = serializeSvg(svgEl);
    const vb = (svgEl.getAttribute('viewBox') || '0 0 360 160').split(/\s+/).map(Number);
    const w = vb[2], h = vb[3];
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#11111b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return reject(new Error('toBlob failed'));
        const a = document.createElement('a');
        const dlUrl = URL.createObjectURL(pngBlob);
        a.href = dlUrl;
        a.download = `hurricanemap-${slug(stormName)}-intensity.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
        resolve(true);
      }, 'image/png');
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
