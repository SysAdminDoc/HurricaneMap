// Pure radar timestamp helpers shared by the online fallback and its tests.

const IEM_TILE_ROOT = 'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0';

export function buildRadarProbeTimes(target, maxMinutes = 60, stepMinutes = 5) {
  if (!(target instanceof Date) || !Number.isFinite(target.getTime())) return [];
  if (!Number.isFinite(maxMinutes) || maxMinutes < 0 || !Number.isFinite(stepMinutes) || stepMinutes <= 0) return [];

  const stepMs = stepMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  const baseMs = Math.floor(target.getTime() / stepMs) * stepMs;
  const candidates = [];
  for (let offsetMs = -maxMs; offsetMs <= maxMs; offsetMs += stepMs) {
    const timeMs = baseMs + offsetMs;
    if (Math.abs(timeMs - target.getTime()) <= maxMs) candidates.push(new Date(timeMs));
  }

  return candidates.sort((a, b) => {
    const distance = Math.abs(a.getTime() - target.getTime()) - Math.abs(b.getTime() - target.getTime());
    return distance || a.getTime() - b.getTime();
  });
}

function normalizeTilePart(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalized)) throw new Error(`invalid radar tile ${label}`);
  return normalized;
}

/** Build IEM's stable, archived XYZ tile template for a radar frame. */
export function buildIemRadarTileUrl(sector, product, stamp) {
  const normalizedStamp = String(stamp || '').trim();
  if (!/^\d{12}$/.test(normalizedStamp)) throw new Error('invalid radar tile timestamp');
  return `${IEM_TILE_ROOT}/ridge::${normalizeTilePart(sector, 'sector')}-${normalizeTilePart(product, 'product')}-${normalizedStamp}/{z}/{x}/{y}.png`;
}

/** Replace Leaflet's tile placeholders with a known in-coverage tile for a
 * lightweight availability probe. The server returns 503 for a missing
 * archived layer and some deployments return 404, so callers must treat both
 * as a normal miss rather than a fatal request error. */
export function buildIemRadarTileProbeUrl(sector, product, stamp, tile = { z: 3, x: 2, y: 3 }) {
  const z = Number(tile.z);
  const x = Number(tile.x);
  const y = Number(tile.y);
  if (![z, x, y].every(Number.isInteger) || [z, x, y].some(value => value < 0)) {
    throw new Error('invalid radar tile probe coordinates');
  }
  return buildIemRadarTileUrl(sector, product, stamp)
    .replace('{z}/{x}/{y}', `${z}/${x}/${y}`);
}

export function isRadarFrameResponseAvailable(response) {
  const status = Number(response?.status);
  if (status === 404 || status === 503) return false;
  return response?.ok === true;
}
