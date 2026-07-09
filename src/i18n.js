// Internationalization (i18n) — English, Spanish (ES-LA), Haitian Creole
// Single source of truth for all user-facing strings.

const LOCALE_EN = 'en';
const LOCALE_ES = 'es';
const LOCALE_HT = 'ht';
const SUPPORTED_LOCALES = new Set([LOCALE_EN, LOCALE_ES, LOCALE_HT]);

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
    'settings.description': 'Tune units, accessibility, and live-storm layers. Changes stay on this device.',
    'settings.windUnits': 'Wind units',
    'settings.windHelp': 'Used in panels, charts, and exports.',
    'settings.theme': 'Theme',
    'settings.themeHelp': 'Choose the map chrome that fits your lighting.',
    'settings.themeDark': 'Dark',
    'settings.themeLight': 'Light',
    'settings.themeSystem': 'System',
    'settings.palette': 'Color palette',
    'settings.paletteHelp': 'Keeps category color meaning consistent across the map and panels.',
    'settings.paletteDefault': 'Default',
    'settings.paletteColorblind': 'Colorblind',
    'settings.damageMode': 'Damage figures',
    'settings.damageHelp': 'Compare historical losses either as reported or CPI-adjusted.',
    'settings.damageModeNominal': 'Nominal',
    'settings.damageMode2024': '2024 USD',
    'settings.language': 'Language',
    'settings.languageHelp': 'Updates interface labels without changing data.',
    'settings.highContrast': 'High-contrast mode',
    'settings.highContrastHelp': 'Strengthens text, borders, and focus outlines.',
    'settings.reduceMotion': 'Reduce motion',
    'settings.reduceMotionHelp': 'Keeps state changes clear with less animation.',
    'settings.liveAids': 'Live storm aids',
    'settings.nhcCone': 'NHC forecast cone and track',
    'settings.nhcConeHelp': 'Appears only when official active-storm geometry is available.',
    'settings.goesLayer': 'GOES satellite backdrop',
    'settings.goesLayerHelp': 'Adds live imagery behind active storms when tiles are reachable.',
    'settings.replayTour': 'Replay welcome tour',
    'settings.meta': 'Saved on this device. No account, tracking profile, or cloud sync.',

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

    // On this date
    'onthisdate.title': 'On this date in history',
    'onthisdate.meta': 'Recorded U.S. landfalls within seven calendar days of {0}.',
    'onthisdate.empty': 'No nearby landfall anniversaries.',
    'onthisdate.emptyDetail': 'No recorded U.S. hurricane or tropical-storm landfalls fall within seven calendar days of today ({0}).',

    // State panel
    'state.title': 'State Details',
    'state.noLandfalls': 'No landfalls on record for this state.',

    // Glossary
    'glossary.title': 'Glossary',
    'glossary.searchPlaceholder': 'Search terms…',
    'glossary.noResults': 'No matching terms.',

    // Onboarding
    'onboarding.welcome': 'Welcome to HurricaneMap',
    'onboarding.welcomeBody': 'Explore 174 years of U.S. hurricane and tropical-storm landfalls. Every dot is a recorded NOAA HURDAT2 event.',
    'onboarding.filters': 'Filter the catalog',
    'onboarding.filtersBody': 'Narrow the map by year, Saffir-Simpson category, U.S. state, or storm name.',
    'onboarding.stats': 'Open the statistics panel',
    'onboarding.statsBody': 'Review decadal trends, top storms, ACE totals, and rapid-intensification counts.',
    'onboarding.about': 'About the data',
    'onboarding.aboutBody': 'Open source notes, methodology, coverage gaps, and radar archive details when you need provenance.',

    // Storm events
    'stormevents.title': 'Storm Events near landfall',
    'stormevents.unavailable': 'NOAA Storm Events records begin in 1950, so tornado and hail coincidence data is unavailable for this storm.',

    // About / info modal
    'about.title': 'About HurricaneMap',
    'about.description': 'HurricaneMap is an interactive 174-year atlas of U.S. hurricane landfalls (1851–2025) from HURDAT2, enhanced with advanced analytics, live active-storm tracking, and climate trend analysis.',
    'about.dataSource': 'Data source: National Hurricane Center HURDAT2',
    'about.github': 'GitHub',
    'about.privacy': 'All data processing happens in your browser. No tracking, no accounts, no servers.',

    // Errors
    'error.unexpected': 'Something went wrong — a feature may be unavailable. Check the browser console for details.',

    // Storm panel dynamic states
    'panel.loading': 'Loading track, landfalls, and impact context...',
    'panel.errorTitle': 'Storm record unavailable.',
    'panel.errorDetail': 'The selected map point loaded, but its detailed HURDAT2 track is missing from this data bundle.',
    'panel.unnamedAtlantic': '{0} unnamed Atlantic storm',
    'panel.unnamedPacific': '{0} unnamed Pacific storm',

    // Impacts labels
    'impacts.fatalities': 'Fatalities',
    'impacts.damage': 'Damage',
    'impacts.wikiSource': 'Source: Wikipedia',

    // Toasts
    'toast.chartSavedPNG': 'Chart saved as PNG',
    'toast.chartSavedSVG': 'Chart saved as SVG',
    'toast.exportFailedPNG': 'PNG export failed',
    'toast.exportFailedSVG': 'SVG export failed',
    'toast.linkCopied': 'Link copied to clipboard',
    'toast.copyFailed': 'Copy failed — select the address bar',
    'toast.playbackFailed': 'Track playback failed',
    'toast.pinFailed': 'Failed to pin storm',

    // Boot failure
    'boot.errorTitle': 'HurricaneMap could not load its data.',
    'boot.errorHint': 'Run the app from a local web server so the browser can read the data files: ',
    'boot.retry': 'Retry',

    // Service-worker update prompt
    'sw.updateTitle': 'Update available',
    'sw.updateBody': 'Refresh to use the newest map shell and offline data cache.',
    'sw.updateRefresh': 'Refresh',
    'sw.updateDismiss': 'Dismiss update prompt',

    // NCEI billion-dollar disasters
    'impacts.ncei': 'Billion-dollar disaster',
    'impacts.nceiSource': 'Source: NOAA NCEI (frozen at 2024)',
    'impacts.deaths': 'deaths',
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
    'settings.description': 'Ajusta unidades, accesibilidad y capas de tormentas activas. Los cambios quedan en este dispositivo.',
    'settings.windUnits': 'Unidades de viento',
    'settings.windHelp': 'Se usa en paneles, gráficos y exportaciones.',
    'settings.theme': 'Tema',
    'settings.themeHelp': 'Elige la interfaz del mapa que funcione mejor con tu iluminación.',
    'settings.themeDark': 'Oscuro',
    'settings.themeLight': 'Claro',
    'settings.themeSystem': 'Sistema',
    'settings.palette': 'Paleta de colores',
    'settings.paletteHelp': 'Mantiene el significado de las categorías en el mapa y los paneles.',
    'settings.paletteDefault': 'Predeterminada',
    'settings.paletteColorblind': 'Daltonismo',
    'settings.damageMode': 'Cifras de daños',
    'settings.damageHelp': 'Compara pérdidas históricas como fueron reportadas o ajustadas por IPC.',
    'settings.damageModeNominal': 'Nominal',
    'settings.damageMode2024': 'USD 2024',
    'settings.language': 'Idioma',
    'settings.languageHelp': 'Actualiza las etiquetas sin cambiar los datos.',
    'settings.highContrast': 'Modo de alto contraste',
    'settings.highContrastHelp': 'Refuerza texto, bordes y enfoques.',
    'settings.reduceMotion': 'Reducir movimiento',
    'settings.reduceMotionHelp': 'Mantiene cambios claros con menos animación.',
    'settings.liveAids': 'Ayudas de tormentas activas',
    'settings.nhcCone': 'Cono y trayectoria del NHC',
    'settings.nhcConeHelp': 'Aparece solo cuando hay geometría oficial disponible.',
    'settings.goesLayer': 'Fondo satelital GOES',
    'settings.goesLayerHelp': 'Agrega imágenes en vivo detrás de tormentas activas cuando están disponibles.',
    'settings.replayTour': 'Reproducir gira de bienvenida',
    'settings.meta': 'Guardado en este dispositivo. Sin cuenta, perfil de seguimiento ni sincronización en la nube.',

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

    // On this date
    'onthisdate.title': 'Esta fecha en la historia',
    'onthisdate.meta': 'Tocamientos registrados dentro de siete días calendario de {0}.',
    'onthisdate.empty': 'Sin aniversarios de tocamiento cercanos.',
    'onthisdate.emptyDetail': 'Ningún tocamiento registrado cae dentro de siete días calendario de hoy ({0}).',

    // State panel
    'state.title': 'Detalles del estado',
    'state.noLandfalls': 'Sin tocamientos registrados para este estado.',

    // Glossary
    'glossary.title': 'Glosario',
    'glossary.searchPlaceholder': 'Buscar términos…',
    'glossary.noResults': 'Sin resultados.',

    // Onboarding
    'onboarding.welcome': 'Bienvenido a HurricaneMap',
    'onboarding.welcomeBody': 'Explora 174 años de huracanes y tormentas tropicales que azotaron Estados Unidos. Cada punto es un evento HURDAT2 de la NOAA.',
    'onboarding.filters': 'Filtrar el catálogo',
    'onboarding.filtersBody': 'Filtra el mapa por año, categoría Saffir-Simpson, estado de EE.UU. o nombre del huracán.',
    'onboarding.stats': 'Panel de estadísticas',
    'onboarding.statsBody': 'Revisa tendencias por década, los huracanes más fuertes, totales de ACE y conteos de intensificación rápida.',
    'onboarding.about': 'Acerca de los datos',
    'onboarding.aboutBody': 'Notas de código abierto, metodología, brechas de cobertura y detalles del archivo de radar.',

    // Storm events
    'stormevents.title': 'Eventos meteorológicos cerca del tocamiento',
    'stormevents.unavailable': 'Los registros de eventos comienzan en 1950; datos de tornado y granizo no están disponibles para este huracán.',

    // About / info modal
    'about.title': 'Acerca de HurricaneMap',
    'about.description': 'HurricaneMap es un atlas interactivo de 174 años de huracanes que azotaron Estados Unidos (1851–2025) desde HURDAT2, mejorado con análisis avanzado, seguimiento de tormentas activas en tiempo real y análisis de tendencias climáticas.',
    'about.dataSource': 'Fuente de datos: Centro Nacional de Huracanes HURDAT2',
    'about.github': 'GitHub',
    'about.privacy': 'Todo el procesamiento de datos ocurre en tu navegador. Sin rastreo, sin cuentas, sin servidores.',

    // Errors
    'error.unexpected': 'Algo salió mal — una función puede no estar disponible. Revisa la consola del navegador para más detalles.',

    // Storm panel dynamic states
    'panel.loading': 'Cargando trayectoria, tocamientos y contexto de impactos...',
    'panel.errorTitle': 'Registro del huracán no disponible.',
    'panel.errorDetail': 'El punto seleccionado cargó, pero su trayectoria detallada de HURDAT2 no está en este paquete de datos.',
    'panel.unnamedAtlantic': 'Tormenta atlántica sin nombre de {0}',
    'panel.unnamedPacific': 'Tormenta del Pacífico sin nombre de {0}',

    // Impacts labels
    'impacts.fatalities': 'Víctimas mortales',
    'impacts.damage': 'Daños',
    'impacts.wikiSource': 'Fuente: Wikipedia',

    // Toasts
    'toast.chartSavedPNG': 'Gráfico guardado como PNG',
    'toast.chartSavedSVG': 'Gráfico guardado como SVG',
    'toast.exportFailedPNG': 'Falló la exportación PNG',
    'toast.exportFailedSVG': 'Falló la exportación SVG',
    'toast.linkCopied': 'Enlace copiado al portapapeles',
    'toast.copyFailed': 'Falló la copia — selecciona la barra de direcciones',
    'toast.playbackFailed': 'Falló la reproducción de la trayectoria',
    'toast.pinFailed': 'No se pudo fijar el huracán',

    // Boot failure
    'boot.errorTitle': 'HurricaneMap no pudo cargar sus datos.',
    'boot.errorHint': 'Ejecuta la app desde un servidor web local para que el navegador pueda leer los archivos de datos: ',
    'boot.retry': 'Reintentar',

    // Service-worker update prompt
    'sw.updateTitle': 'Actualización disponible',
    'sw.updateBody': 'Actualiza para usar la versión más reciente del mapa y la caché de datos sin conexión.',
    'sw.updateRefresh': 'Actualizar',
    'sw.updateDismiss': 'Descartar aviso de actualización',

    // NCEI billion-dollar disasters
    'impacts.ncei': 'Desastre de mil millones',
    'impacts.nceiSource': 'Fuente: NOAA NCEI (congelado en 2024)',
    'impacts.deaths': 'muertes',
  },
  ht: {
    'header.title': 'HurricaneMap',
    'header.subtitle': '174 ane siklòn ki frape Etazini',
    'header.btn.settings': 'Paramèt',
    'header.btn.info': 'Enfòmasyon',
    'header.btn.stats': 'Estatistik',
    'header.btn.compare': 'Konpare',
    'header.btn.onthisdate': 'Jou sa a',
    'header.btn.filters': 'Filtè',
    'settings.title': 'Paramèt',
    'settings.description': 'Ajiste inite, aksè, ak kouch tanpèt aktif. Chanjman yo rete sou aparèy sa a.',
    'settings.windUnits': 'Inite van',
    'settings.windHelp': 'Itilize nan panno, graf, ak ekspòtasyon.',
    'settings.theme': 'Tèm',
    'settings.themeHelp': 'Chwazi aparans kat la pou limyè kote w ye a.',
    'settings.themeDark': 'Fonse',
    'settings.themeLight': 'Klè',
    'settings.themeSystem': 'Sistèm',
    'settings.palette': 'Palèt koulè',
    'settings.paletteHelp': 'Kenbe siyifikasyon kategori yo menm sou kat ak panno.',
    'settings.paletteDefault': 'Pa defo',
    'settings.paletteColorblind': 'Pou je ki pa wè koulè',
    'settings.damageMode': 'Chif domaj',
    'settings.damageHelp': 'Konpare pèt istorik jan yo rapòte yo oswa ajiste ak CPI.',
    'settings.damageModeNominal': 'Nominal',
    'settings.damageMode2024': 'USD 2024',
    'settings.language': 'Lang',
    'settings.languageHelp': 'Mete etikèt yo ajou san chanje done yo.',
    'settings.highContrast': 'Gwo kontrast',
    'settings.highContrastHelp': 'Fè tèks, bòdi, ak konsantrasyon pi fò.',
    'settings.reduceMotion': 'Diminye mouvman',
    'settings.reduceMotionHelp': 'Kenbe chanjman yo klè ak mwens animasyon.',
    'settings.liveAids': 'Èd pou tanpèt aktif',
    'settings.nhcCone': 'Kòn ak tras NHC',
    'settings.nhcConeHelp': 'Parèt sèlman lè jeyometri ofisyèl disponib.',
    'settings.goesLayer': 'Fon satelit GOES',
    'settings.goesLayerHelp': 'Ajoute imaj an dirèk dèyè tanpèt aktif lè li disponib.',
    'settings.replayTour': 'Rejwe vizit byenveni',
    'settings.meta': 'Sove sou aparèy sa a. Pa gen kont, pwofil swivi, oswa senkronizasyon nwaj.',
    'filters.title': 'Filtè',
    'filters.yearRange': 'Ane',
    'filters.category': 'Kategori',
    'filters.categoryTS': 'Tanpèt twopikal lè li touche tè',
    'filters.state': 'Eta',
    'filters.searchStorm': 'Chèche siklòn',
    'filters.searchPlaceholder': 'pa egz. Katrina, 2005, Helene…',
    'filters.mapLayers': 'Kouch kat la',
    'filters.tracksForVisibleLandfalls': 'Chemen siklòn vizib yo',
    'filters.landfall': 'Pwen kote siklòn touche tè',
    'filters.heatmap': 'Kat chalè',
    'filters.population': 'Dansite popilasyon',
    'filters.stormSurge': 'Vag tanpèt (SLOSH MOMs)',
    'filters.resetFilters': 'Remèt filtè yo',
    'panel.title': 'Detay siklòn',
    'panel.close': 'Fèmen',
    'panel.track': 'Chemen',
    'panel.intensity': 'Entansite',
    'panel.peakWind': 'Van maksimòm',
    'panel.minPressure': 'Presyon minimòm',
    'panel.formed': 'Fòme',
    'panel.dissipated': 'Disparèt',
    'panel.landfalls': 'Touche tè Etazini',
    'panel.ACE': 'Enèji siklòn akimile',
    'panel.impacts': 'Enpak',
    'panel.similarStorms': 'Siklòn ki sanble',
    'panel.playTrack': 'Jwe chemen',
    'panel.pauseTrack': 'Poz chemen',
    'panel.exportTrack': 'Ekspòte chemen',
    'stats.title': 'Estatistik',
    'stats.landfalls': 'Touche tè',
    'stats.strongest': 'Pi fò',
    'stats.deadliest': 'Pi mòtèl',
    'stats.costliest': 'Pi chè',
    'compare.title': 'Konpare siklòn',
    'compare.noStorms': 'Pa gen siklòn tache. Klike sou ikòn epeng nan yon panno siklòn pou ajoute.',
    'btn.clearYearFilter': 'Remèt',
    'btn.share': '🔗 Pataje vi',
    'status.loading': 'Chajman…',
    'status.noResults': 'Pa jwenn siklòn',
    'toast.copiedLink': 'Kopye nan plas-papye',
    'category.ts': 'Tanpèt twopikal',
    'category.1': 'Kategori 1',
    'category.2': 'Kategori 2',
    'category.3': 'Kategori 3',
    'category.4': 'Kategori 4',
    'category.5': 'Kategori 5',
    'onthisdate.title': 'Jou sa a nan istwa',
    'onthisdate.empty': 'Pa gen anivèsè siklòn tou pre.',
    'state.title': 'Detay eta',
    'state.noLandfalls': 'Pa gen siklòn anrejistre pou eta sa a.',
    'glossary.title': 'Glosè',
    'glossary.noResults': 'Pa jwenn rezilta.',
    'onboarding.welcome': 'Byenveni nan HurricaneMap',
    'onboarding.welcomeBody': 'Eksplore 174 ane siklòn ki frape Etazini. Chak pwen se yon evènman HURDAT2 NOAA.',
    'onboarding.filters': 'Filtre katalòg la',
    'onboarding.filtersBody': 'Filtre kat la pa ane, kategori Saffir-Simpson, eta, oswa non siklòn.',
    'onboarding.stats': 'Panno estatistik',
    'onboarding.statsBody': 'Gade tandans pa deseni, siklòn pi fò yo, total ACE.',
    'onboarding.about': 'Konsènan done yo',
    'onboarding.aboutBody': 'Nòt metòd, twou nan kouvèti, ak detay achiv rada.',
    'stormevents.title': 'Evènman tanpèt bò kote siklòn touche tè',
    'stormevents.unavailable': 'Dosye NOAA kòmanse nan 1950; done tònad pa disponib pou siklòn sa a.',
    'about.title': 'Konsènan HurricaneMap',
    'about.description': 'HurricaneMap se yon atlas entèaktif 174 ane siklòn ki frape Etazini (1851–2025) soti nan HURDAT2.',
    'about.dataSource': 'Sous done: Sant Nasyonal Siklòn HURDAT2',
    'about.github': 'GitHub',
    'about.privacy': 'Tout tretman done fèt nan navigatè w. Pa gen swivi, pa gen kont, pa gen sèvè.',

    // Storm panel metrics
    'panel.track_km': 'Longè trajè a',
    'panel.forwardSpeed': 'Vitès deplasman',
    'panel.rapidIntensification': 'Entansifikasyon rapid',
    'panel.explosiveDeepening': 'Apwofondisman eksplozif',
    'panel.daysAtIntensity': 'Jou nan entansite sa a',
    'panel.closestApproach': 'Pwen ki pi pre kòt la',
    'panel.casualties': 'Viktim',
    'panel.damages': 'Dega',
    'panel.speed': 'Vitès',

    // Statistics
    'stats.seasonSummary': 'Rezime sezon an',
    'stats.namedStorms': 'Tanpèt ki gen non',
    'stats.majors': 'Majè (Kat 3+)',
    'stats.totalACE': 'ACE total',
    'stats.climatologyChart': 'Klimatoloji anyèl',
    'stats.decadeTrends': 'Tandans pa deseni',
    'stats.climateTrends': 'Tandans klimatik',

    // Compare
    'compare.pin': 'Epengle',
    'compare.unpin': 'Retire',
    'compare.selectUpTo4': 'Chwazi jiska 4 siklòn pou konpare',

    // Buttons & status
    'btn.exportCSV': 'CSV',
    'btn.exportGeoJSON': 'GeoJSON',
    'btn.exportKML': 'KML',
    'btn.exportPNG': 'PNG',
    'btn.exportSVG': 'SVG',
    'btn.showMoreResults': 'Montre plis',
    'btn.recentlyViewed': 'Gade dènyèman',
    'status.stormCount': 'siklòn · {0} fwa yo touche tè',
    'status.visibleCount': '{0} vizib',
    'status.activeStorms': '{0} siklòn aktif',
    'toast.exportedFile': 'Telechaje {0}',
    'category.-1': 'Ekstratwopikal',
    'category.0': 'Soutwopikal',

    // Months
    'month.1': 'Janvye',
    'month.2': 'Fevriye',
    'month.3': 'Mas',
    'month.4': 'Avril',
    'month.5': 'Me',
    'month.6': 'Jen',
    'month.7': 'Jiyè',
    'month.8': 'Out',
    'month.9': 'Septanm',
    'month.10': 'Oktòb',
    'month.11': 'Novanm',
    'month.12': 'Desanm',

    // On this date / glossary
    'onthisdate.meta': 'Fwa siklòn touche tè Ozetazini nan sèt jou kalandriye {0}.',
    'onthisdate.emptyDetail': 'Pa gen okenn siklòn oswa tanpèt twopikal ki touche tè Ozetazini nan sèt jou kalandriye jodi a ({0}).',
    'glossary.searchPlaceholder': 'Chèche tèm…',

    // Errors
    'error.unexpected': 'Gen yon bagay ki pa mache — yon fonksyon ka pa disponib. Gade konsòl navigatè a pou plis detay.',

    // Storm panel dynamic states
    'panel.loading': 'Ap chaje trajè, pwen kote li touche tè, ak kontèks enpak...',
    'panel.errorTitle': 'Dosye siklòn nan pa disponib.',
    'panel.errorDetail': 'Pwen ou chwazi a chaje, men trajè detaye HURDAT2 li a pa nan pakè done sa a.',
    'panel.unnamedAtlantic': 'Tanpèt Atlantik san non nan {0}',
    'panel.unnamedPacific': 'Tanpèt Pasifik san non nan {0}',

    // Impacts labels
    'impacts.fatalities': 'Viktim',
    'impacts.damage': 'Dega',
    'impacts.wikiSource': 'Sous: Wikipedya',

    // Toasts
    'toast.chartSavedPNG': 'Graf anrejistre kòm PNG',
    'toast.chartSavedSVG': 'Graf anrejistre kòm SVG',
    'toast.exportFailedPNG': 'Ekspòtasyon PNG echwe',
    'toast.exportFailedSVG': 'Ekspòtasyon SVG echwe',
    'toast.linkCopied': 'Lyen an kopye',
    'toast.copyFailed': 'Kopi a echwe — chwazi bar adrès la',
    'toast.playbackFailed': 'Lekti trajè a echwe',
    'toast.pinFailed': 'Nou pa t ka epengle siklòn nan',

    // Boot failure
    'boot.errorTitle': 'HurricaneMap pa t kapab chaje done li yo.',
    'boot.errorHint': 'Egzekite app la sou yon sèvè web lokal pou navigatè a ka li fichye done yo: ',
    'boot.retry': 'Eseye ankò',

    // Service-worker update prompt
    'sw.updateTitle': 'Gen yon mizajou disponib',
    'sw.updateBody': 'Rafrechi pou itilize dènye vèsyon kat la ak done offline yo.',
    'sw.updateRefresh': 'Rafrechi',
    'sw.updateDismiss': 'Inyore mizajou a',

    // NCEI billion-dollar disasters
    'impacts.ncei': 'Dezas plizyè milya dola',
    'impacts.nceiSource': 'Sous: NOAA NCEI (fikse nan 2024)',
    'impacts.deaths': 'moun ki mouri',
  },
};

let currentLocale = LOCALE_EN;

export function setLocale(locale) {
  if (SUPPORTED_LOCALES.has(locale)) {
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
  // Partial locales (ht) fall back to English before exposing the raw key.
  let str = strings[key] || STRINGS[LOCALE_EN][key] || key;

  // Simple substitution for numbered placeholders: {0}, {1}, etc.
  for (let i = 0; i < args.length; i++) {
    str = str.replace(`{${i}}`, args[i]);
  }

  return str;
}

export function initLocale() {
  // Explicit picks persist via the settings store (main.js applies them after
  // this call); here we only auto-detect from the browser language.
  const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  if (browserLang.startsWith('ht') || browserLang === 'fr-ht') setLocale(LOCALE_HT);
  else if (browserLang.startsWith('es')) setLocale(LOCALE_ES);
  return currentLocale;
}

export function translateStaticElements() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.textContent = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.title = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.placeholder = translated;
  }
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    const key = el.dataset.i18nAriaLabel;
    if (!key) continue;
    const translated = t(key);
    if (translated !== key) el.setAttribute('aria-label', translated);
  }
}
