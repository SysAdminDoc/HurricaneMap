// User-preference store. Single source of truth for unit toggle, palette,
// onboarding state. Backed by localStorage with graceful fallback.
//
// Other modules read via getSetting() and react to the
// "hm-settings:change" custom event when a value flips.

const STORAGE_KEY = 'hm-settings-v1';

const DEFAULTS = {
  windUnit: 'kt',          // 'kt' | 'mph' | 'kmh'
  theme: 'dark',           // 'dark' | 'light' | 'system'
  palette: 'default',      // 'default' (Catppuccin) | 'colorblind' (ColorBrewer YlOrRd)
  damageMode: 'real',      // 'nominal' | 'real' (CPI-adjusted to 2024 USD)
  nhcForecastCone: true,   // Show official NHC forecast cone/track for active storms
  goesRealtime: false,     // Show live NOAA/NESDIS/STAR GOES satellite backdrop
  locale: 'en',            // 'en' | 'es' (English | Spanish)
  highContrast: false,     // WCAG AAA 7:1+ contrast, bolder fonts, enhanced focus
  reducedMotion: false,    // In-app override: reduce animations independent of OS setting
  onboarded: false,
};

const VALID_VALUES = {
  windUnit: new Set(['kt', 'mph', 'kmh']),
  theme: new Set(['dark', 'light', 'system']),
  palette: new Set(['default', 'colorblind']),
  damageMode: new Set(['nominal', 'real']),
  locale: new Set(['en', 'es']),
};

const BOOLEAN_KEYS = new Set([
  'nhcForecastCone',
  'goesRealtime',
  'highContrast',
  'reducedMotion',
  'onboarded',
]);

let _state = null;
let themeMediaQuery = null;
let themeMediaListenerAttached = false;

function load() {
  if (_state) return _state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _state = raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    _state = { ...DEFAULTS };
  }
  return _state;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); }
  catch { /* private mode / quota — non-fatal */ }
}

export function getSetting(key) {
  return load()[key];
}

export function setSetting(key, value) {
  load();
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
  const nextState = normalizeSettings({ ..._state, [key]: value });
  const nextValue = nextState[key];
  if (_state[key] === nextValue) return;
  _state = nextState;
  save();
  document.dispatchEvent(new CustomEvent('hm-settings:change', { detail: { key, value: nextValue } }));
}

function prefersLightTheme() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function getEffectiveTheme() {
  const theme = getSetting('theme');
  if (theme === 'system') return prefersLightTheme() ? 'light' : 'dark';
  return theme === 'light' ? 'light' : 'dark';
}

function attachSystemThemeListener() {
  if (themeMediaListenerAttached ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function') {
    return;
  }
  themeMediaQuery = window.matchMedia('(prefers-color-scheme: light)');
  const onSystemThemeChange = () => {
    if (getSetting('theme') === 'system') applyThemeToRoot();
  };
  if (typeof themeMediaQuery.addEventListener === 'function') {
    themeMediaQuery.addEventListener('change', onSystemThemeChange);
  } else if (typeof themeMediaQuery.addListener === 'function') {
    themeMediaQuery.addListener(onSystemThemeChange);
  }
  themeMediaListenerAttached = true;
}

// --- Wind-unit conversion ----------------------------------------------------
// HURDAT2 stores sustained wind in knots. Convert per current setting.
const WIND_UNIT_LABEL = { kt: 'kt', mph: 'mph', kmh: 'km/h' };

export function formatWind(kt, opts = {}) {
  if (kt == null) return '—';
  const u = getSetting('windUnit');
  let v = kt;
  if (u === 'mph') v = kt * 1.15078;
  else if (u === 'kmh') v = kt * 1.852;
  const rounded = opts.decimals != null
    ? v.toFixed(opts.decimals)
    : String(Math.round(v));
  return opts.suffix === false ? rounded : `${rounded} ${WIND_UNIT_LABEL[u]}`;
}

export function windUnitLabel() {
  return WIND_UNIT_LABEL[getSetting('windUnit')];
}

// --- Saffir-Simpson palette --------------------------------------------------
// Default = Catppuccin Mocha hues (matches CSS vars in :root).
// Colorblind-safe = ColorBrewer YlOrRd 7-class sequential — distinguishable
// under deuteranopia/protanopia/tritanopia, AND ordered by intensity so the
// color story still reads correctly without distinguishing red from green.

export const PALETTES = {
  default: {
    '-1': '#74c7ec', 0: '#74c7ec',
    1: '#a6e3a1', 2: '#f9e2af', 3: '#fab387',
    4: '#f38ba8', 5: '#cba6f7',
  },
  colorblind: {
    '-1': '#ffeda0', 0: '#ffeda0',
    1: '#fed976', 2: '#feb24c', 3: '#fd8d3c',
    4: '#f03b20', 5: '#bd0026',
  },
};

export function getPaletteColor(cat) {
  const pal = PALETTES[getSetting('palette')] || PALETTES.default;
  return pal[cat] || pal['-1'];
}

// Apply the active palette to <body> as a class so CSS rules can also pick it up.
export function applyPaletteToBody() {
  const pal = getSetting('palette');
  document.body.classList.toggle('palette-colorblind', pal === 'colorblind');
}

// Apply theme to html element root
export function applyThemeToRoot() {
  attachSystemThemeListener();
  const theme = getSetting('theme');
  const effectiveTheme = getEffectiveTheme();
  document.documentElement.classList.toggle('light-theme', effectiveTheme === 'light');
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.dataset.themeSetting = theme;
}

export function prefersReducedMotion() {
  if (getSetting('reducedMotion')) return true;
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const next = { ...DEFAULTS };
  for (const [key, allowed] of Object.entries(VALID_VALUES)) {
    if (allowed.has(source[key])) next[key] = source[key];
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') next[key] = source[key];
  }
  return next;
}
