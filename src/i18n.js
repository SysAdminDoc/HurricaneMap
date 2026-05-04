// Internationalization (i18n) — Spanish (ES-LA) + English (EN) support
// Single source of truth for all user-facing strings.

const LOCALE_EN = 'en';
const LOCALE_ES = 'es';

export const STRINGS = {
  en: {
    // Header & navigation
    'header.title': 'HurricaneMap',
    'header.subtitle': '174-year U.S. Hurricane Landfall Atlas',
    'header.btn.settings': 'Settings',
    'header.btn.info': 'About',
    'header.btn.stats': 'Statistics',
    'header.btn.compare': 'Compare',
    'header.btn.onthisdate': 'This Date',
    'header.btn.filters': 'Filters',

    // Settings menu
    'settings.title': 'Settings',
    'settings.windUnits': 'Wind units',
    'settings.theme': 'Theme',
    'settings.themeDark': 'Dark',
    'settings.themeLight': 'Light',
    'settings.palette': 'Color palette',
    'settings.paletteDefault': 'Default',
    'settings.paletteColorblind': 'Colorblind',
    'settings.damageMode': 'Damage figures',
    'settings.damageModeNominal': 'Nominal',
    'settings.damageMode2024': '2024 USD',
    'settings.ensembleTracks': 'Forecast ensemble spaghetti (when active)',
    'settings.replayTour': 'Replay welcome tour',
    'settings.meta': 'Settings save to your browser only — no account required.',

    // Filters panel
    'filters.title': 'Filters',
    'filters.yearRange': 'Year range',
    'filters.category': 'Category',
    'filters.categoryTS': 'Tropical Storm at landfall',
    'filters.state': 'State',
    'filters.searchStorm': 'Search storm',
    'filters.searchPlaceholder': 'e.g. Katrina, 2005, Helene…',
    'filters.mapLayers': 'Map layers',
    'filters.tracksForVisibleLandfalls': 'Tracks for visible landfalls',
    'filters.landfall': 'Landfall dots',
    'filters.heatmap': 'Landfall heatmap',
    'filters.population': 'Population density',
    'filters.stormSurge': 'Storm surge (SLOSH MOMs)',
    'filters.resetFilters': 'Reset filters',

    // Storm panel
    'panel.title': 'Storm Details',
    'panel.close': 'Close',
    'panel.track': 'Track',
    'panel.intensity': 'Intensity',
    'panel.peakWind': 'Peak wind',
    'panel.minPressure': 'Min pressure',
    'panel.formed': 'Formed',
    'panel.dissipated': 'Dissipated',
    'panel.track_km': 'Track length',
    'panel.landfalls': 'U.S. landfalls',
    'panel.ACE': 'Accumulated Cyclone Energy',
    'panel.forwardSpeed': 'Forward speed',
    'panel.rapidIntensification': 'Rapid intensification',
    'panel.explosiveDeepening': 'Explosive deepening',
    'panel.daysAtIntensity': 'Days at intensity',
    'panel.closestApproach': 'Closest approach to coast',
    'panel.casualties': 'Casualties',
    'panel.damages': 'Damages',
    'panel.impacts': 'Impacts',
    'panel.similarStorms': 'Similar storms',
    'panel.playTrack': 'Play track',
    'panel.pauseTrack': 'Pause track',
    'panel.speed': 'Speed',
    'panel.exportTrack': 'Export track',

    // Stats panel
    'stats.title': 'Statistics',
    'stats.seasonSummary': 'Season summary',
    'stats.namedStorms': 'Named storms',
    'stats.majors': 'Majors (Cat 3+)',
    'stats.totalACE': 'Total ACE',
    'stats.landfalls': 'Landfalls',
    'stats.strongest': 'Strongest',
    'stats.deadliest': 'Deadliest',
    'stats.costliest': 'Costliest',
    'stats.climatologyChart': 'Annual climatology',
    'stats.decadeTrends': 'Decade trends',
    'stats.climateTrends': 'Climate trends',

    // Comparison panel
    'compare.title': 'Compare Storms',
    'compare.pin': 'Pin',
    'compare.unpin': 'Unpin',
    'compare.selectUpTo4': 'Select up to 4 storms to compare',
    'compare.noStorms': 'No storms pinned. Click the pin icon in a storm panel to add.',

    // Buttons & actions
    'btn.clearYearFilter': 'Reset',
    'btn.share': '🔗 Share view',
    'btn.exportCSV': 'CSV',
    'btn.exportGeoJSON': 'GeoJSON',
    'btn.exportKML': 'KML',
    'btn.exportPNG': 'PNG',
    'btn.exportSVG': 'SVG',
    'btn.showMoreResults': 'Show more',
    'btn.recentlyViewed': 'Recently viewed',

    // Status messages
    'status.loading': 'Loading…',
    'status.noResults': 'No storms found',
    'status.stormCount': 'storms · {0} landfalls',
    'status.visibleCount': '{0} visible',
    'status.activeStorms': '{0} active storm{1}',

    // Toasts
    'toast.copiedLink': 'Copied to clipboard',
    'toast.exportedFile': 'Downloaded {0}',

    // Categories
    'category.-1': 'Extratropical',
    'category.0': 'Subtropical',
    'category.ts': 'Tropical Storm',
    'category.1': 'Category 1',
    'category.2': 'Category 2',
    'category.3': 'Category 3',
    'category.4': 'Category 4',
    'category.5': 'Category 5',

    // Months
    'month.1': 'January',
    'month.2': 'February',
    'month.3': 'March',
    'month.4': 'April',
    'month.5': 'May',
    'month.6': 'June',
    'month.7': 'July',
    'month.8': 'August',
    'month.9': 'September',
    'month.10': 'October',
    'month.11': 'November',
    'month.12': 'December',

    // About / info modal
    'about.title': 'About HurricaneMap',
    'about.description': 'HurricaneMap is an interactive 174-year atlas of U.S. hurricane landfalls (1851–2025) from HURDAT2, enhanced with advanced analytics, live active-storm tracking, and climate trend analysis.',
    'about.dataSource': 'Data source: National Hurricane Center HURDAT2',
    'about.version': 'Version {0}',
    'about.github': 'GitHub',
    'about.privacy': 'All data processing happens in your browser. No tracking, no accounts, no servers.',
  },
  es: {
    // Header & navigation
    'header.title': 'HurricaneMap',
    'header.subtitle': 'Atlas de 174 años de huracanes que azotaron Estados Unidos',
    'header.btn.settings': 'Configuración',
    'header.btn.info': 'Acerca de',
    'header.btn.stats': 'Estadísticas',
    'header.btn.compare': 'Comparar',
    'header.btn.onthisdate': 'Esta fecha',
    'header.btn.filters': 'Filtros',

    // Settings menu
    'settings.title': 'Configuración',
    'settings.windUnits': 'Unidades de viento',
    'settings.theme': 'Tema',
    'settings.themeDark': 'Oscuro',
    'settings.themeLight': 'Claro',
    'settings.palette': 'Paleta de colores',
    'settings.paletteDefault': 'Predeterminada',
    'settings.paletteColorblind': 'Daltonismo',
    'settings.damageMode': 'Cifras de daños',
    'settings.damageModeNominal': 'Nominal',
    'settings.damageMode2024': 'USD 2024',
    'settings.ensembleTracks': 'Pronóstico ensemble (cuando hay tormentas activas)',
    'settings.replayTour': 'Reproducir gira de bienvenida',
    'settings.meta': 'La configuración se guarda solo en tu navegador — no se requiere cuenta.',

    // Filters panel
    'filters.title': 'Filtros',
    'filters.yearRange': 'Rango de años',
    'filters.category': 'Categoría',
    'filters.categoryTS': 'Tormenta tropical en el momento de tocamiento',
    'filters.state': 'Estado',
    'filters.searchStorm': 'Buscar huracán',
    'filters.searchPlaceholder': 'p. ej. Katrina, 2005, Helene…',
    'filters.mapLayers': 'Capas del mapa',
    'filters.tracksForVisibleLandfalls': 'Pistas de tocamientos visibles',
    'filters.landfall': 'Puntos de tocamiento',
    'filters.heatmap': 'Mapa de calor de tocamientos',
    'filters.population': 'Densidad de población',
    'filters.stormSurge': 'Marea de tormenta (MOMs SLOSH)',
    'filters.resetFilters': 'Restablecer filtros',

    // Storm panel
    'panel.title': 'Detalles de la tormenta',
    'panel.close': 'Cerrar',
    'panel.track': 'Trayectoria',
    'panel.intensity': 'Intensidad',
    'panel.peakWind': 'Viento máximo',
    'panel.minPressure': 'Presión mínima',
    'panel.formed': 'Formado',
    'panel.dissipated': 'Disipado',
    'panel.track_km': 'Longitud de la trayectoria',
    'panel.landfalls': 'Tocamientos en EE.UU.',
    'panel.ACE': 'Energía ciclónica acumulada',
    'panel.forwardSpeed': 'Velocidad de avance',
    'panel.rapidIntensification': 'Intensificación rápida',
    'panel.explosiveDeepening': 'Profundización explosiva',
    'panel.daysAtIntensity': 'Días con esta intensidad',
    'panel.closestApproach': 'Aproximación más cercana a la costa',
    'panel.casualties': 'Víctimas mortales',
    'panel.damages': 'Daños',
    'panel.impacts': 'Impactos',
    'panel.similarStorms': 'Huracanes similares',
    'panel.playTrack': 'Reproducir trayectoria',
    'panel.pauseTrack': 'Pausar trayectoria',
    'panel.speed': 'Velocidad',
    'panel.exportTrack': 'Exportar trayectoria',

    // Stats panel
    'stats.title': 'Estadísticas',
    'stats.seasonSummary': 'Resumen de la temporada',
    'stats.namedStorms': 'Tormentas con nombre',
    'stats.majors': 'Mayores (Cat 3+)',
    'stats.totalACE': 'ACE total',
    'stats.landfalls': 'Tocamientos',
    'stats.strongest': 'Más fuerte',
    'stats.deadliest': 'Más mortífero',
    'stats.costliest': 'Más costoso',
    'stats.climatologyChart': 'Climatología anual',
    'stats.decadeTrends': 'Tendencias por década',
    'stats.climateTrends': 'Tendencias climáticas',

    // Comparison panel
    'compare.title': 'Comparar huracanes',
    'compare.pin': 'Fijar',
    'compare.unpin': 'Desfijar',
    'compare.selectUpTo4': 'Selecciona hasta 4 huracanes para comparar',
    'compare.noStorms': 'Sin huracanes fijados. Haz clic en el icono de alfiler en un panel de huracán para agregar.',

    // Buttons & actions
    'btn.clearYearFilter': 'Restablecer',
    'btn.share': '🔗 Compartir vista',
    'btn.exportCSV': 'CSV',
    'btn.exportGeoJSON': 'GeoJSON',
    'btn.exportKML': 'KML',
    'btn.exportPNG': 'PNG',
    'btn.exportSVG': 'SVG',
    'btn.showMoreResults': 'Mostrar más',
    'btn.recentlyViewed': 'Visto recientemente',

    // Status messages
    'status.loading': 'Cargando…',
    'status.noResults': 'No se encontraron huracanes',
    'status.stormCount': 'huracanes · {0} tocamientos',
    'status.visibleCount': '{0} visibles',
    'status.activeStorms': '{0} huracán{1} activo{1}',

    // Toasts
    'toast.copiedLink': 'Copiado al portapapeles',
    'toast.exportedFile': 'Descargado {0}',

    // Categories
    'category.-1': 'Extratropical',
    'category.0': 'Subtropical',
    'category.ts': 'Tormenta tropical',
    'category.1': 'Categoría 1',
    'category.2': 'Categoría 2',
    'category.3': 'Categoría 3',
    'category.4': 'Categoría 4',
    'category.5': 'Categoría 5',

    // Months
    'month.1': 'Enero',
    'month.2': 'Febrero',
    'month.3': 'Marzo',
    'month.4': 'Abril',
    'month.5': 'Mayo',
    'month.6': 'Junio',
    'month.7': 'Julio',
    'month.8': 'Agosto',
    'month.9': 'Septiembre',
    'month.10': 'Octubre',
    'month.11': 'Noviembre',
    'month.12': 'Diciembre',

    // About / info modal
    'about.title': 'Acerca de HurricaneMap',
    'about.description': 'HurricaneMap es un atlas interactivo de 174 años de huracanes que azotaron Estados Unidos (1851–2025) desde HURDAT2, mejorado con análisis avanzado, seguimiento de tormentas activas en tiempo real y análisis de tendencias climáticas.',
    'about.dataSource': 'Fuente de datos: Centro Nacional de Huracanes HURDAT2',
    'about.version': 'Versión {0}',
    'about.github': 'GitHub',
    'about.privacy': 'Todo el procesamiento de datos ocurre en tu navegador. Sin rastreo, sin cuentas, sin servidores.',
  },
};

let currentLocale = LOCALE_EN;

export function setLocale(locale) {
  if (locale === LOCALE_ES || locale === LOCALE_EN) {
    currentLocale = locale;
    document.documentElement.lang = locale;
    document.dispatchEvent(new CustomEvent('hm-locale:change', { detail: { locale } }));
  }
}

export function getLocale() {
  return currentLocale;
}

export function t(key, ...args) {
  const strings = STRINGS[currentLocale] || STRINGS[LOCALE_EN];
  let str = strings[key] || key;

  // Simple substitution for numbered placeholders: {0}, {1}, etc.
  for (let i = 0; i < args.length; i++) {
    str = str.replace(`{${i}}`, args[i]);
  }

  return str;
}

export function initLocale() {
  // Check localStorage for saved locale preference
  const saved = localStorage.getItem('hm-locale-v1');
  if (saved === LOCALE_ES) {
    setLocale(LOCALE_ES);
  } else {
    // Otherwise, check browser language
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang.startsWith('es')) {
      setLocale(LOCALE_ES);
    }
  }
  return currentLocale;
}

export function toggleLocale() {
  const newLocale = currentLocale === LOCALE_EN ? LOCALE_ES : LOCALE_EN;
  setLocale(newLocale);
  localStorage.setItem('hm-locale-v1', newLocale);
  location.reload();
}
