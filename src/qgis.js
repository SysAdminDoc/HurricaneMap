// P12.3 — QGIS layer export: Export filtered storms as GeoJSON ready for QGIS import

import { getLandfalls, getStormDetails, filterLandfalls } from './data.js';

export function exportQGISGeoJSON(filters) {
  const allLandfalls = filterLandfalls(getLandfalls(), filters);
  
  // Group landfalls by storm_id to reconstruct tracks
  const stormMap = {};
  for (const lf of allLandfalls) {
    if (!stormMap[lf.storm_id]) {
      stormMap[lf.storm_id] = [];
    }
    stormMap[lf.storm_id].push(lf);
  }
  
  // Build GeoJSON FeatureCollection with LineString tracks + Point landfalls
  const features = [];
  
  // Add track LineStrings (one per storm)
  for (const [stormId, points] of Object.entries(stormMap)) {
    if (points.length < 2) continue; // Skip single-point tracks
    
    // Sort points by date to ensure proper line order
    points.sort((a, b) => {
      const dateA = new Date(a.year, a.month - 1, a.day, a.hour || 0);
      const dateB = new Date(b.year, b.month - 1, b.day, b.hour || 0);
      return dateA - dateB;
    });
    
    // Get storm details for attributes
    const stormName = points[0].name || 'UNNAMED';
    const category = points[0].category || 0;
    const startDate = `${points[0].year}-${String(points[0].month).padStart(2, '0')}-${String(points[0].day).padStart(2, '0')}`;
    const endDate = `${points[points.length - 1].year}-${String(points[points.length - 1].month).padStart(2, '0')}-${String(points[points.length - 1].day).padStart(2, '0')}`;
    
    const coordinates = points.map(p => [p.lon, p.lat]);
    
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        storm_id: stormId,
        name: stormName,
        year: points[0].year,
        category_max: category,
        category_label: category <= 0 ? 'TS' : String(category),
        start_date: startDate,
        end_date: endDate,
        duration_days: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)),
        wind_max_kt: Math.max(...points.map(p => p.wind || 0)),
        pressure_min_mb: Math.min(...points.map(p => p.pressure || 1013)),
        num_positions: points.length,
      },
    });
  }
  
  // Add landfall Points (one per landfall record)
  for (const lf of allLandfalls) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lf.lon, lf.lat],
      },
      properties: {
        storm_id: lf.storm_id,
        name: lf.name || 'UNNAMED',
        year: lf.year,
        month: lf.month,
        day: lf.day,
        hour: lf.hour || 0,
        latitude: lf.lat.toFixed(3),
        longitude: lf.lon.toFixed(3),
        wind_speed_kt: lf.wind || null,
        wind_speed_mph: lf.wind ? Math.round(lf.wind * 1.15078) : null,
        pressure_mb: lf.pressure || null,
        category: lf.category <= 0 ? 'TS' : String(lf.category),
        state: lf.state || null,
        feature_type: 'landfall',
      },
    });
  }
  
  // Build FeatureCollection
  const geojson = {
    type: 'FeatureCollection',
    name: buildExportName(filters),
    crs: {
      type: 'name',
      properties: {
        name: 'EPSG:4326', // WGS 84
      },
    },
    features,
  };
  
  // Add metadata as a property
  geojson.metadata = {
    exported_at: new Date().toISOString(),
    source: 'HurricaneMap — NOAA NHC HURDAT2 Best-Track Database',
    license: 'Public Domain (NOAA/NHC)',
    attribution: 'Data from NOAA National Hurricane Center HURDAT2 best-track database, 1851-present',
    filters: {
      years: `${filters.yearMin}–${filters.yearMax}`,
      categories: Array.from(filters.categories).sort().join(', ') || 'All',
      state: filters.state || 'All',
    },
    notes: [
      'LineString features represent storm tracks (one per storm)',
      'Point features represent landfall locations (one per landfall record)',
      'Coordinates are in WGS 84 (EPSG:4326)',
      'Wind speeds in knots (kt); convert to mph: kt × 1.15078',
      'For pre-1945 data, see HURDAT2 documentation on data quality',
    ],
  };
  
  downloadGeoJSON(geojson);
}

function buildExportName(filters) {
  const parts = [];
  if (filters.yearMin === filters.yearMax) {
    parts.push(`${filters.yearMin}`);
  } else if (filters.yearMin !== 1851 || filters.yearMax !== 2025) {
    parts.push(`${filters.yearMin}-${filters.yearMax}`);
  }
  if (filters.state) {
    parts.push(filters.state);
  }
  if (filters.categories.size < 6 && filters.categories.size > 0) {
    const cats = Array.from(filters.categories)
      .map(c => c === 'ts' ? 'TS' : c)
      .sort()
      .join('');
    parts.push(`Cat${cats}`);
  }
  return parts.length > 0 ? `HurricaneMap-${parts.join('-')}` : 'HurricaneMap-Export';
}

export function downloadGeoJSON(geojson) {
  const json = JSON.stringify(geojson, null, 2);
  const blob = new Blob([json], { type: 'application/geo+json;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${geojson.name || 'HurricaneMap'}-${timestamp}.geojson`;
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
