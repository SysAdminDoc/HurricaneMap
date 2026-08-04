// Shared reflectivity palette logic for archived PNGs and IEM radar tiles.
//
// IEM's NEXRAD products use the familiar 5 dBZ steps from cyan through red.
// The colour-blind setting remaps those source colours to Cividis, a
// perceptually uniform sequential palette designed to remain legible across
// common colour-vision deficiencies. Transparent and near-black no-echo
// pixels stay untouched so the basemap remains visible.

const SOURCE_COLORS = [
  '#00ecec', '#01a0f6', '#0000f6', '#00ff00', '#00c800', '#009000',
  '#ffff00', '#e7c000', '#ff9000', '#ff0000', '#d60000', '#c00000',
];

// Samples from the Cividis ramp at the same 5 dBZ intervals as the source.
// Keeping the endpoints dark-to-light makes weak echoes visible without
// reintroducing the green/red adjacency that motivated this remap.
const COLORBLIND_COLORS = [
  '#00224e', '#013271', '#2f426d', '#48526c', '#5e636f', '#727374',
  '#878478', '#9d9576', '#b6a96f', '#cebc63', '#e7d150', '#fee838',
];

function parseHex(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function makeStops(colors) {
  return Object.freeze(colors.map((color, index) => Object.freeze({
    dbz: (index + 1) * 5,
    color,
    rgb: Object.freeze(parseHex(color)),
  })));
}

export const RADAR_REFLECTIVITY_STOPS = makeStops(SOURCE_COLORS);
export const RADAR_COLORBLIND_STOPS = makeStops(COLORBLIND_COLORS);

const MAX_COLORIZED_IMAGES = 3;
const colorizedImages = new Map();
const tileLayerClasses = new WeakMap();
const RADAR_CLASSIFICATION_LUT = buildClassificationLut();

function isNoEcho(r, g, b, alpha) {
  return alpha === 0 || Math.max(r, g, b) < 24;
}

export function nearestRadarStop(r, g, b) {
  return RADAR_REFLECTIVITY_STOPS[nearestRadarStopIndex(r, g, b)];
}

function nearestRadarStopIndex(r, g, b) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < RADAR_REFLECTIVITY_STOPS.length; i++) {
    const [sr, sg, sb] = RADAR_REFLECTIVITY_STOPS[i].rgb;
    const distance = ((r - sr) ** 2) + ((g - sg) ** 2) + ((b - sb) ** 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function buildClassificationLut() {
  const lut = new Uint8Array(32 * 32 * 32);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const index = (r * 1024) + (g * 32) + b;
        lut[index] = nearestRadarStopIndex((r << 3) + 4, (g << 3) + 4, (b << 3) + 4);
      }
    }
  }
  return lut;
}

/** Return a new RGBA buffer, leaving the input untouched for easy testing. */
export function remapRadarPixels(pixels, { colorblind = true } = {}) {
  const output = new Uint8ClampedArray(pixels || []);
  if (!colorblind) return output;

  for (let i = 0; i + 3 < output.length; i += 4) {
    const r = output[i];
    const g = output[i + 1];
    const b = output[i + 2];
    const alpha = output[i + 3];
    if (isNoEcho(r, g, b, alpha)) continue;

    const sourceIndex = RADAR_CLASSIFICATION_LUT[((r >> 3) * 1024) + ((g >> 3) * 32) + (b >> 3)];
    const target = RADAR_COLORBLIND_STOPS[sourceIndex];
    output[i] = target.rgb[0];
    output[i + 1] = target.rgb[1];
    output[i + 2] = target.rgb[2];
  }
  return output;
}

export function remapRadarImageData(context) {
  const { width, height } = context.canvas;
  const imageData = context.getImageData(0, 0, width, height);
  imageData.data.set(remapRadarPixels(imageData.data));
  context.putImageData(imageData, 0, 0);
  return imageData;
}

function rememberColorizedImage(url, promise) {
  colorizedImages.set(url, promise);
  while (colorizedImages.size > MAX_COLORIZED_IMAGES) {
    colorizedImages.delete(colorizedImages.keys().next().value);
  }
}

/** Colorize a same-origin archived frame, falling back to the source URL. */
export function colorizeRadarImage(url) {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || !url || url.startsWith('data:')) {
    return Promise.resolve(url);
  }
  const cached = colorizedImages.get(url);
  if (cached) return cached;

  const promise = new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || !canvas.width || !canvas.height) {
          resolve(url);
          return;
        }
        context.drawImage(image, 0, 0);
        remapRadarImageData(context);
        resolve(canvas.toDataURL('image/png'));
      } catch (_) {
        // A browser that cannot read a source image should still display the
        // original radar instead of turning an optional overlay into a blank.
        resolve(url);
      }
    };
    image.onerror = () => resolve(url);
    image.src = url;
  });
  rememberColorizedImage(url, promise);
  return promise;
}

/** Keep Leaflet's image-overlay contract while asynchronously replacing the
 * source URL with a colourized data URL once the canvas work is complete. */
export function createRadarImageOverlay(leaflet, url, bounds, options = {}, colorblind = false) {
  const overlay = leaflet.imageOverlay(url, bounds, options);
  overlay.__hmRadarColorblind = Boolean(colorblind);
  overlay.__hmRadarPaletteApplied = false;
  if (colorblind) {
    colorizeRadarImage(url).then(colorizedUrl => {
      if (colorizedUrl !== url && overlay._map) {
        overlay.setUrl(colorizedUrl);
        overlay.__hmRadarPaletteApplied = true;
      }
    });
  }
  return overlay;
}

function colorblindTileLayerClass(leaflet) {
  let Layer = tileLayerClasses.get(leaflet);
  if (Layer) return Layer;

  Layer = leaflet.TileLayer.extend({
    createTile(coords, done) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      tile.__hmRadarPalette = 'cividis';
      tile.__hmRadarPaletteApplied = false;

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const context = tile.getContext('2d', { willReadFrequently: true });
        if (!context) {
          done(new Error('radar tile canvas is unavailable'), tile);
          return;
        }
        context.drawImage(image, 0, 0, size.x, size.y);
        try {
          remapRadarImageData(context);
          tile.__hmRadarPaletteApplied = true;
        } catch (_) {
          // CORS/readback failures leave the already-drawn source tile intact.
        }
        done(null, tile);
      };
      image.onerror = error => done(error, tile);
      image.src = this.getTileUrl(coords);
      return tile;
    },
  });
  tileLayerClasses.set(leaflet, Layer);
  return Layer;
}

/** A TileLayer-compatible renderer that applies the same LUT to remote IEM
 * tiles without changing the stable URL or Leaflet's tile lifecycle. */
export function createColorblindRadarTileLayer(leaflet, url, options = {}) {
  const Layer = colorblindTileLayerClass(leaflet);
  const layer = new Layer(url, options);
  layer.__hmRadarColorblind = true;
  return layer;
}
