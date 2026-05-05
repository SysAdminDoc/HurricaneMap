// P12.3 — QGIS layer export: Export filtered storms as GeoJSON ready for QGIS import.

import { ensureStormsLoaded, filterLandfalls, getAllStorms, getLandfalls } from './data.js';

export async function exportQGISGeoJSON(filters) {
  await ensureStormsLoaded();
  const geojson = buildQGISGeoJSON({
    landfalls: filterLandfalls(getLandfalls(), filters),
    storms: getAllStorms(),
    filters,
  });
  downloadGeoJSON(geojson);
}

export function buildQGISGeoJSON({
  landfalls = [],
  storms = [],
  filters = {},
  exportedAt = new Date().toISOString(),
} = {}) {
  const filteredLandfalls = Array.isArray(landfalls)
    ? landfalls.filter(hasFiniteLatLon)
    : [];
  const stormsById = new Map(
    (Array.isArray(storms) ? storms : [])
      .filter(storm => storm?.id)
      .map(storm => [storm.id, storm]),
  );
  const landfallsByStorm = groupLandfallsByStorm(filteredLandfalls);
  const features = [];

  for (const [stormId, points] of landfallsByStorm) {
    const storm = stormsById.get(stormId);
    const trackPoints = sanitizeTrack(storm?.track);
    const fallbackPoints = sortByTime(points);
    const linePoints = trackPoints.length >= 2 ? trackPoints : fallbackPoints;
    const coordinates = linePoints.map(point => [roundNumber(point.lon, 4), roundNumber(point.lat, 4)]);
    if (coordinates.length < 2) continue;

    const categoryMax = firstFiniteNumber(storm?.landfall_max_category, maxFinite(points.map(p => p.category)));
    const windMax = firstFiniteNumber(storm?.landfall_max_wind_kt, storm?.peak_wind_kt, maxFinite(linePoints.map(p => p.wind)));
    const pressureMin = minFinite(linePoints.map(p => p.pres ?? p.pressure));
    const firstPoint = linePoints[0];
    const lastPoint = linePoints[linePoints.length - 1];

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        storm_id: stormId,
        name: storm?.name || points[0]?.name || 'UNNAMED',
        year: firstFiniteNumber(storm?.year, points[0]?.year),
        category_max: categoryMax,
        category_label: categoryLabel(categoryMax),
        start_date: dateOnly(firstPoint?.t) || dateFromParts(firstPoint),
        end_date: dateOnly(lastPoint?.t) || dateFromParts(lastPoint),
        duration_days: durationDays(linePoints),
        wind_max_kt: windMax,
        pressure_min_mb: pressureMin,
        track_points: trackPoints.length || null,
        num_landfalls: points.length,
        feature_type: 'track',
      },
    });
  }

  for (const lf of filteredLandfalls) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [roundNumber(lf.lon, 4), roundNumber(lf.lat, 4)],
      },
      properties: {
        storm_id: lf.storm_id,
        name: lf.name || 'UNNAMED',
        year: lf.year,
        month: lf.month,
        day: lf.day,
        hour: lf.hour || 0,
        latitude: roundNumber(lf.lat, 3),
        longitude: roundNumber(lf.lon, 3),
        wind_speed_kt: Number.isFinite(lf.wind) ? lf.wind : null,
        wind_speed_mph: Number.isFinite(lf.wind) ? Math.round(lf.wind * 1.15078) : null,
        pressure_mb: Number.isFinite(lf.pres) ? lf.pres : null,
        category: categoryLabel(lf.category),
        state: lf.state || null,
        feature_type: 'landfall',
      },
    });
  }

  return {
    type: 'FeatureCollection',
    name: buildExportName(filters),
    features,
    metadata: {
      exported_at: exportedAt,
      source: 'HurricaneMap - NOAA NHC HURDAT2 Best-Track Database',
      license: 'Public Domain (NOAA/NHC)',
      attribution: 'Data from NOAA National Hurricane Center HURDAT2 best-track database, 1851-present',
      filters: {
        years: formatYearRange(filters),
        categories: formatCategories(filters.categories),
        state: filters.state || 'All',
      },
      notes: [
        'LineString features represent complete storm tracks when storm data is available',
        'Point features represent landfall locations, one per landfall record',
        'Coordinates are WGS 84 longitude/latitude pairs as required by RFC 7946 GeoJSON',
        'Wind speeds are in knots (kt); convert to mph with kt x 1.15078',
        'For pre-1945 data, see HURDAT2 documentation on data quality',
      ],
    },
  };
}

function groupLandfallsByStorm(landfalls) {
  const grouped = new Map();
  for (const lf of landfalls) {
    if (!lf.storm_id) continue;
    if (!grouped.has(lf.storm_id)) grouped.set(lf.storm_id, []);
    grouped.get(lf.storm_id).push(lf);
  }
  return grouped;
}

function sanitizeTrack(track) {
  return Array.isArray(track)
    ? track.filter(hasFiniteLatLon).slice().sort((a, b) => timeValue(a) - timeValue(b))
    : [];
}

function sortByTime(points) {
  return points.slice().sort((a, b) => timeValue(a) - timeValue(b));
}

function hasFiniteLatLon(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function timeValue(point) {
  if (point?.t) {
    const parsed = Date.parse(point.t);
    if (Number.isFinite(parsed)) return parsed;
  }
  const year = Number.isFinite(point?.year) ? point.year : 0;
  const month = Number.isFinite(point?.month) ? point.month - 1 : 0;
  const day = Number.isFinite(point?.day) ? point.day : 1;
  const hour = Number.isFinite(point?.hour) ? point.hour : 0;
  return Date.UTC(year, month, day, hour);
}

function durationDays(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const start = timeValue(points[0]);
  const end = timeValue(points[points.length - 1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return roundNumber((end - start) / 86_400_000, 2);
}

function categoryLabel(category) {
  if (!Number.isFinite(category) || category <= 0) return 'TS';
  return String(category);
}

function dateOnly(value) {
  return typeof value === 'string' && value.includes('T') ? value.split('T')[0] : null;
}

function dateFromParts(point) {
  if (!Number.isFinite(point?.year) || !Number.isFinite(point?.month) || !Number.isFinite(point?.day)) return null;
  return `${point.year}-${String(point.month).padStart(2, '0')}-${String(point.day).padStart(2, '0')}`;
}

function firstFiniteNumber(...values) {
  return values.find(Number.isFinite) ?? null;
}

function maxFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function minFinite(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

function roundNumber(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function buildExportName(filters = {}) {
  const parts = [];
  if (Number.isFinite(filters.yearMin) && Number.isFinite(filters.yearMax)) {
    if (filters.yearMin === filters.yearMax) {
      parts.push(`${filters.yearMin}`);
    } else if (filters.yearMin !== 1851 || filters.yearMax !== 2025) {
      parts.push(`${filters.yearMin}-${filters.yearMax}`);
    }
  }
  if (filters.state) {
    parts.push(String(filters.state));
  }
  if (filters.categories instanceof Set && filters.categories.size < 6 && filters.categories.size > 0) {
    const cats = Array.from(filters.categories)
      .map(c => c === 'ts' ? 'TS' : c)
      .sort()
      .join('');
    parts.push(`Cat${cats}`);
  }
  return parts.length > 0 ? `HurricaneMap-${parts.join('-')}` : 'HurricaneMap-Export';
}

function formatYearRange(filters = {}) {
  if (!Number.isFinite(filters.yearMin) || !Number.isFinite(filters.yearMax)) return 'All';
  return `${filters.yearMin}-${filters.yearMax}`;
}

function formatCategories(categories) {
  if (!(categories instanceof Set) || categories.size === 0) return 'All';
  return Array.from(categories).sort().join(', ');
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
