// Theme-invariant colors for geometry drawn on the dark basemap. UI themes
// change panel tokens, but these colors must stay aligned with their legends.

const MAP_OVERLAY_COLORS = Object.freeze({
  forecast: { token: '--map-overlay-forecast', fallback: '#f9e2af' },
  actual: { token: '--map-overlay-actual', fallback: '#a6e3a1' },
  cone: { token: '--map-overlay-cone', fallback: '#89b4fa' },
  ensemble: { token: '--map-overlay-ensemble', fallback: '#cba6f7' },
  location: { token: '--map-overlay-location', fallback: '#fab387' },
});

export function getMapOverlayColor(name) {
  const entry = MAP_OVERLAY_COLORS[name];
  if (!entry) return '';
  if (typeof document !== 'undefined' && document.documentElement && typeof getComputedStyle === 'function') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(entry.token).trim();
    if (value) return value;
  }
  return entry.fallback;
}
