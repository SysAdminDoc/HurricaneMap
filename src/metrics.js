// Derived intensity metrics + spatial queries.
//
// All functions here are pure: given a storm's track array (HURDAT2-shaped
// records with `t` ISO timestamp, `wind` kt, `pres` mb, `lat`, `lon`), they
// compute a single derived value or structured result. No side effects.
//
// Authored 2026-05-03 for HurricaneMap v0.4.0 to surface ACE, rapid
// intensification windows, and closest-pass distances to U.S. coastal cities.

const KT_TO_MS_FACTOR = 0.51444; // not used directly; kept for reference
const EARTH_R_KM = 6371.0088;
const KM_TO_MI = 0.621371;
const RI_THRESHOLD_KT = 30;      // standard NHC RI definition
const RI_WINDOW_HOURS = 24;
const TS_THRESHOLD_KT = 34;      // ACE only counts obs ≥ TS-force

/** Accumulated Cyclone Energy.
 *  ACE = Σ(v² / 10⁴) over all 6-hourly obs where v ≥ 34 kt.
 *  Returned in 10⁴ kt² units (the conventional "ACE units"); typical
 *  Atlantic season is ~100, a major hurricane alone is ~10-30. */
export function computeACE(track) {
  if (!Array.isArray(track) || track.length === 0) return 0;
  let ace = 0;
  let count = 0;
  for (const r of track) {
    if (r.wind == null || r.wind < TS_THRESHOLD_KT) continue;
    // HURDAT2 records on synoptic 6-hour times. Skip the rare interpolated
    // landfall obs (rec === 'L' but t not on 0/6/12/18 UTC) so we don't
    // double-count.
    const d = new Date(r.t);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    if (h % 6 !== 0 || m !== 0) continue;
    ace += (r.wind * r.wind) / 1e4;
    count++;
  }
  return { value: ace, obs_count: count };
}

/** Find the strongest 24-hour rapid-intensification window in a track.
 *  Returns the window with the largest wind gain ≥ 30 kt, or null if
 *  no qualifying window exists. Both endpoints must have observed
 *  (non-null) wind values — we don't interpolate. */
export function findRapidIntensification(track) {
  if (!Array.isArray(track) || track.length < 2) return null;
  let best = null;
  for (let i = 0; i < track.length; i++) {
    if (track[i].wind == null) continue;
    const t0 = new Date(track[i].t).getTime();
    const w0 = track[i].wind;
    for (let j = i + 1; j < track.length; j++) {
      if (track[j].wind == null) continue;
      const t1 = new Date(track[j].t).getTime();
      const dh = (t1 - t0) / 3600000;
      if (dh > RI_WINDOW_HOURS + 0.5) break; // past 24h, stop
      if (dh < RI_WINDOW_HOURS - 0.5) continue; // not yet 24h
      const dw = track[j].wind - w0;
      if (dw >= RI_THRESHOLD_KT) {
        if (!best || dw > best.delta_kt) {
          best = {
            from_idx: i,
            to_idx: j,
            from_t: track[i].t,
            to_t: track[j].t,
            from_wind: w0,
            to_wind: track[j].wind,
            delta_kt: dw,
            hours: dh,
          };
        }
      }
    }
  }
  return best;
}

/** Hardcoded list of U.S. + nearby coastal cities for closest-pass queries.
 *  Curated for hurricane relevance (Atlantic + Gulf + Pacific NEPAC reach). */
export const COASTAL_CITIES = [
  // Atlantic / Gulf US
  { name: 'Miami, FL',          lat: 25.7617,  lon:  -80.1918 },
  { name: 'Key West, FL',       lat: 24.5551,  lon:  -81.7800 },
  { name: 'Tampa, FL',          lat: 27.9506,  lon:  -82.4572 },
  { name: 'Jacksonville, FL',   lat: 30.3322,  lon:  -81.6557 },
  { name: 'Daytona Beach, FL',  lat: 29.2108,  lon:  -81.0228 },
  { name: 'Pensacola, FL',      lat: 30.4213,  lon:  -87.2169 },
  { name: 'Mobile, AL',         lat: 30.6954,  lon:  -88.0399 },
  { name: 'New Orleans, LA',    lat: 29.9511,  lon:  -90.0715 },
  { name: 'Galveston, TX',      lat: 29.3013,  lon:  -94.7977 },
  { name: 'Houston, TX',        lat: 29.7604,  lon:  -95.3698 },
  { name: 'Corpus Christi, TX', lat: 27.8006,  lon:  -97.3964 },
  { name: 'Brownsville, TX',    lat: 25.9018,  lon:  -97.4975 },
  // Atlantic Eastern Seaboard
  { name: 'Savannah, GA',       lat: 32.0809,  lon:  -81.0912 },
  { name: 'Charleston, SC',     lat: 32.7765,  lon:  -79.9311 },
  { name: 'Wilmington, NC',     lat: 34.2257,  lon:  -77.9447 },
  { name: 'Cape Hatteras, NC',  lat: 35.2509,  lon:  -75.5288 },
  { name: 'Norfolk, VA',        lat: 36.8508,  lon:  -76.2859 },
  { name: 'Washington, DC',     lat: 38.9072,  lon:  -77.0369 },
  { name: 'New York, NY',       lat: 40.7128,  lon:  -74.0060 },
  { name: 'Boston, MA',         lat: 42.3601,  lon:  -71.0589 },
  // Caribbean / outlying US
  { name: 'San Juan, PR',       lat: 18.4655,  lon:  -66.1057 },
  // NEPAC reach
  { name: 'Honolulu, HI',       lat: 21.3099,  lon: -157.8581 },
  { name: 'Hilo, HI',           lat: 19.7297,  lon: -155.0900 },
  { name: 'San Diego, CA',      lat: 32.7157,  lon: -117.1611 },
  { name: 'Cabo San Lucas, MX', lat: 22.8905,  lon: -109.9167 },
];

/** Great-circle distance in km between two lat/lon points (haversine). */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function kmToMi(km) {
  return km * KM_TO_MI;
}

/** Closest approach of a storm track to a target lat/lon.
 *  Returns the nearest track-point index + distance (km, mi) + the obs at
 *  that point. Returns null if track is empty. */
export function closestApproach(track, targetLat, targetLon) {
  if (!Array.isArray(track) || track.length === 0) return null;
  let bestIdx = 0;
  let bestKm = Infinity;
  for (let i = 0; i < track.length; i++) {
    const r = track[i];
    if (r.lat == null || r.lon == null) continue;
    const km = haversineKm(r.lat, r.lon, targetLat, targetLon);
    if (km < bestKm) { bestKm = km; bestIdx = i; }
  }
  if (bestKm === Infinity) return null;
  const point = track[bestIdx];
  return {
    idx: bestIdx,
    distance_km: bestKm,
    distance_mi: kmToMi(bestKm),
    track_point: point,
  };
}

/** Compute empirical return periods for a given city across all historical storms.
 *  For each category (1, 3, 5), counts the number of storms that made a landfall
 *  within 50 km (31 mi) of the city at that intensity or stronger, then computes
 *  the average years between such events.
 *  Returns { cat1_years, cat3_years, cat5_years } with null for "never" cases.
 */
export function computeCityReturnPeriods(city, allStorms) {
  const RADIUS_KM = 50;
  const CATEGORIES = { 1: 1, 3: 3, 5: 5 };
  
  const landfallsByCategory = { 1: [], 3: [], 5: [] };
  
  // Scan all storms for landfalls within radius at each category
  for (const storm of allStorms) {
    const landfalls = storm.us_landfalls || [];
    for (const lf of landfalls) {
      const dist = haversineKm(lf.lat, lf.lon, city.lat, city.lon);
      if (dist > RADIUS_KM) continue;
      const cat = lf.category >= 1 ? lf.category : -1;
      if (cat >= 1) landfallsByCategory[1].push(storm.year);
      if (cat >= 3) landfallsByCategory[3].push(storm.year);
      if (cat >= 5) landfallsByCategory[5].push(storm.year);
    }
  }
  
  // Compute return periods (years between events)
  const computeReturnPeriod = (events) => {
    if (events.length === 0) return null;
    if (events.length === 1) return null; // Need at least 2 events
    const sorted = events.sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(sorted[i] - sorted[i - 1]);
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(mean * 10) / 10; // 1 decimal place
  };
  
  return {
    cat1_years: computeReturnPeriod(landfallsByCategory[1]),
    cat3_years: computeReturnPeriod(landfallsByCategory[3]),
    cat5_years: computeReturnPeriod(landfallsByCategory[5]),
    cat1_count: landfallsByCategory[1].length,
    cat3_count: landfallsByCategory[3].length,
    cat5_count: landfallsByCategory[5].length,
  };
}

/** Format a number with thousand-separators + N fixed decimals. */
export function formatNumber(n, decimals = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Build an export payload for a storm. Returns three string variants. */
export function buildExports(storm) {
  const safeName = (storm.name && storm.name !== 'UNNAMED' ? storm.name : 'unnamed').toLowerCase();
  const baseFilename = `hurricanemap-${storm.id}-${safeName}-${storm.year}`;

  return {
    csv: { filename: `${baseFilename}.csv`, mime: 'text/csv', body: exportCSV(storm) },
    csv_publication: { filename: `${baseFilename}-publication.csv`, mime: 'text/csv', body: exportCSVPublication(storm) },
    geojson: { filename: `${baseFilename}.geojson`, mime: 'application/geo+json', body: exportGeoJSON(storm) },
    kml: { filename: `${baseFilename}.kml`, mime: 'application/vnd.google-earth.kml+xml', body: exportKML(storm) },
  };
}

function exportCSV(storm) {
  const rows = [['time_utc', 'lat', 'lon', 'wind_kt', 'pres_mb', 'status', 'category', 'is_landfall']];
  const lfTimes = new Set((storm.us_landfalls || []).map(lf => lf.t));
  for (const r of storm.track) {
    rows.push([
      r.t,
      r.lat ?? '',
      r.lon ?? '',
      r.wind ?? '',
      r.pres ?? '',
      r.status ?? '',
      saffirCat(r.wind),
      lfTimes.has(r.t) ? '1' : '0',
    ]);
  }
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function exportCSVPublication(storm) {
  // Publication-ready CSV with metadata header and data dictionary
  const safeName = storm.name && storm.name !== 'UNNAMED' ? storm.name : 'Unnamed';
  const headerLines = [
    `# HurricaneMap Publication Export`,
    `# Storm: ${safeName} (${storm.year})`,
    `# Storm ID: ${storm.id}`,
    `# Export Date: ${new Date().toISOString().split('T')[0]}`,
    `# Source: NOAA NHC HURDAT2 Atlantic/Eastern Pacific Best Track Database`,
    `# License: Public domain (NOAA data) | Code: MIT`,
    `#`,
    `# DATA DICTIONARY`,
    `# time_utc: ISO 8601 timestamp of synoptic observation (0/6/12/18 UTC)`,
    `# lat: Latitude of storm center (decimal degrees, -90 to 90)`,
    `# lon: Longitude of storm center (decimal degrees, -180 to 180)`,
    `# wind_kt: Maximum sustained wind speed (knots, from HURDAT2)`,
    `# pres_mb: Minimum central pressure (millibars; null before 1870s)`,
    `# status: 'TD'=Tropical Depression, 'TS'=Tropical Storm, 'HU'=Hurricane`,
    `# category: Saffir-Simpson category (-1=TS, 0=unknown/incomplete, 1-5)`,
    `# is_landfall: 1 if center crossed U.S. coastline at this observation`,
    `#`,
    `# METHODOLOGY`,
    `# - Wind speed categories use operational Saffir-Simpson thresholds (1971+)`,
    `# - Pre-1851 storms excluded; data spans 1851-${new Date().getFullYear()}`,
    `# - Landfalls include both explicit (L marker) and inferred detections`,
    `# - Pre-aircraft (pre-1944) and pre-satellite (pre-1960s) data are less complete`,
    `# - For citations and complete methodology, see https://github.com/SysAdminDoc/HurricaneMap`,
    `#`,
  ];
  
  const rows = [['time_utc', 'lat', 'lon', 'wind_kt', 'pres_mb', 'status', 'category', 'is_landfall']];
  const lfTimes = new Set((storm.us_landfalls || []).map(lf => lf.t));
  for (const r of storm.track) {
    rows.push([
      r.t,
      r.lat ?? '',
      r.lon ?? '',
      r.wind ?? '',
      r.pres ?? '',
      r.status ?? '',
      saffirCat(r.wind),
      lfTimes.has(r.t) ? '1' : '0',
    ]);
  }
  
  const dataLines = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  return headerLines.join('\n') + dataLines;
}

function csvEscape(v) {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportGeoJSON(storm) {
  const trackCoords = storm.track
    .filter(r => r.lat != null && r.lon != null)
    .map(r => [r.lon, r.lat]);
  const features = [
    {
      type: 'Feature',
      properties: {
        kind: 'track',
        storm_id: storm.id,
        name: storm.name,
        year: storm.year,
        peak_wind_kt: storm.peak_wind_kt,
        min_pres_mb: storm.min_pres_mb,
      },
      geometry: { type: 'LineString', coordinates: trackCoords },
    },
    ...storm.track
      .filter(r => r.lat != null && r.lon != null)
      .map(r => ({
        type: 'Feature',
        properties: {
          kind: 'obs',
          time: r.t,
          wind_kt: r.wind,
          pres_mb: r.pres,
          status: r.status,
          category: saffirCat(r.wind),
        },
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      })),
    ...(storm.us_landfalls || []).map(lf => ({
      type: 'Feature',
      properties: {
        kind: 'landfall',
        time: lf.t,
        state: lf.state,
        category: lf.category,
        wind_kt: lf.wind,
        pres_mb: lf.pres,
        inferred: !!lf.inferred,
      },
      geometry: { type: 'Point', coordinates: [lf.lon, lf.lat] },
    })),
  ];
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
}

function exportKML(storm) {
  const xml = (s) => String(s ?? '').replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[c]);
  const trackLine = storm.track
    .filter(r => r.lat != null && r.lon != null)
    .map(r => `${r.lon},${r.lat},0`).join(' ');
  const landfallPoints = (storm.us_landfalls || []).map(lf => `
    <Placemark>
      <name>Landfall: ${xml(lf.state)} (Cat ${lf.category})</name>
      <description><![CDATA[
        ${xml(lf.t)} UTC<br/>
        Wind: ${lf.wind ?? '?'} kt · Pressure: ${lf.pres ?? '—'} mb
      ]]></description>
      <styleUrl>#landfallStyle</styleUrl>
      <Point><coordinates>${lf.lon},${lf.lat},0</coordinates></Point>
    </Placemark>`).join('');
  const heading = (storm.name && storm.name !== 'UNNAMED' ? storm.name : 'Unnamed') + ' ' + storm.year;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${xml(heading)} — track</name>
  <description>HurricaneMap export. Source: NOAA HURDAT2.</description>
  <Style id="trackStyle">
    <LineStyle><color>ff58c4f3</color><width>3</width></LineStyle>
  </Style>
  <Style id="landfallStyle">
    <IconStyle>
      <color>ffa881f3</color>
      <Icon><href>http://maps.google.com/mapfiles/kml/shapes/donut.png</href></Icon>
    </IconStyle>
  </Style>
  <Placemark>
    <name>${xml(heading)} track</name>
    <styleUrl>#trackStyle</styleUrl>
    <LineString>
      <tessellate>1</tessellate>
      <coordinates>${trackLine}</coordinates>
    </LineString>
  </Placemark>${landfallPoints}
</Document>
</kml>
`;
}

function saffirCat(kt) {
  if (kt == null || kt < 34) return 0;
  if (kt < 64) return -1;
  if (kt < 83) return 1;
  if (kt < 96) return 2;
  if (kt < 113) return 3;
  if (kt < 137) return 4;
  return 5;
}

/** Trigger a browser download of a string as a file. */
export function downloadBlob({ filename, mime, body }) {
  const blob = new Blob([body], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 250);
}

/** Find the steepest 24-hour pressure-fall window in a track.
 *  Returns the window with the largest mb drop ≥ 20 mb, or null if no
 *  qualifying window exists. Both endpoints must have observed (non-null)
 *  pressure values — we don't interpolate. The 20 mb / 24h threshold is
 *  the operational shorthand for "explosive deepening" (Wilma 2005 dropped
 *  95 mb in 24h; Patricia 2015 dropped 100 mb). */
export function findPressureFall(track) {
  if (!Array.isArray(track) || track.length < 2) return null;
  const PRESSURE_FALL_THRESHOLD_MB = 20;
  let best = null;
  for (let i = 0; i < track.length; i++) {
    if (track[i].pres == null) continue;
    const t0 = new Date(track[i].t).getTime();
    const p0 = track[i].pres;
    for (let j = i + 1; j < track.length; j++) {
      if (track[j].pres == null) continue;
      const t1 = new Date(track[j].t).getTime();
      const dh = (t1 - t0) / 3600000;
      if (dh > RI_WINDOW_HOURS + 0.5) break;
      if (dh < RI_WINDOW_HOURS - 0.5) continue;
      const drop = p0 - track[j].pres;
      if (drop >= PRESSURE_FALL_THRESHOLD_MB) {
        if (!best || drop > best.drop_mb) {
          best = {
            from_idx: i, to_idx: j,
            from_t: track[i].t, to_t: track[j].t,
            from_pres: p0, to_pres: track[j].pres,
            drop_mb: drop, hours: dh,
            rate_mb_per_h: drop / dh,
          };
        }
      }
    }
  }
  return best;
}

/** Compute translation-speed (forward speed) statistics from a track.
 *  Returns {min, mean, max, stalled_hours, peak_kmh, peak_t} where speeds
 *  are in km/h between consecutive valid lat/lon obs at synoptic 6-hour
 *  spacing. "stalled_hours" = total time the storm moved <10 km/h, the
 *  conventional flood-disaster threshold (Harvey 2017, Dorian 2019). */
export function computeTranslationStats(track) {
  if (!Array.isArray(track) || track.length < 2) return null;
  const speeds = [];
  let stalledHours = 0;
  let peak = { kmh: 0, t: null };
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    const dh = (new Date(b.t).getTime() - new Date(a.t).getTime()) / 3600000;
    if (dh <= 0 || dh > 12.5) continue; // skip gaps > ~12h
    const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const kmh = km / dh;
    speeds.push({ kmh, hours: dh, t: b.t });
    if (kmh < 10) stalledHours += dh;
    if (kmh > peak.kmh) peak = { kmh, t: b.t };
  }
  if (speeds.length === 0) return null;
  const sum = speeds.reduce((acc, s) => acc + s.kmh * s.hours, 0);
  const totalH = speeds.reduce((acc, s) => acc + s.hours, 0);
  return {
    min_kmh: Math.min(...speeds.map(s => s.kmh)),
    mean_kmh: sum / totalH,
    max_kmh: peak.kmh,
    peak_t: peak.t,
    stalled_hours: stalledHours,
    sample_count: speeds.length,
  };
}

/** km/h → mph helper for display. */
export function kmhToMph(kmh) {
  return kmh * 0.621371;
}

/** Days-at-intensity histogram.
 *  Returns hours spent at each Saffir-Simpson tier across the storm's life.
 *  Keys: td (depression, <34kt), ts (34-63), c1 (64-82), c2 (83-95),
 *        c3 (96-112), c4 (113-136), c5 (137+). Hours are floats. */
export function daysAtIntensity(track) {
  const buckets = { td: 0, ts: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 };
  if (!Array.isArray(track) || track.length < 2) return buckets;
  function tier(w) {
    if (w == null) return null;
    if (w < 34) return 'td';
    if (w < 64) return 'ts';
    if (w < 83) return 'c1';
    if (w < 96) return 'c2';
    if (w < 113) return 'c3';
    if (w < 137) return 'c4';
    return 'c5';
  }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i], b = track[i + 1];
    const ta = tier(a.wind);
    if (ta == null) continue;
    const dh = (new Date(b.t).getTime() - new Date(a.t).getTime()) / 3.6e6;
    if (!Number.isFinite(dh) || dh <= 0 || dh > 24) continue; // guard interpolated L
    buckets[ta] += dh;
  }
  return buckets;
}

/** Compute an 8-dimensional vector for a storm for similarity scoring.
 *  Dimensions: [peak_wind, landfall_count, track_length_km, forward_speed_kmh, RI_delta_kt, ACE, decay_rate, genesis_month]
 *  All normalized to [0, 1] range using historical min/max from the dataset.
 *  Used by findSimilarStorms() to find neighbors. */
export function getStormVector(storm, stats = null) {
  // Default stats (computed once per app load from all storms)
  const defaultStats = {
    wind_max: 185, wind_min: 35,
    landfalls_max: 7, landfalls_min: 0,
    track_km_max: 20000, track_km_min: 500,
    speed_max: 60, speed_min: 2,
    ri_max: 120, ri_min: 0,
    ace_max: 100, ace_min: 0,
    decay_max: 50, decay_min: -5,
  };
  const s = stats || defaultStats;

  const peak_wind = storm.peak_wind_kt || 50;
  const landfall_count = (storm.us_landfalls || []).length;
  const track_km = storm.track
    .filter(r => r.lat != null && r.lon != null)
    .reduce((acc, r, i, arr) => {
      if (i === 0) return 0;
      return acc + haversineKm(arr[i - 1].lat, arr[i - 1].lon, r.lat, r.lon);
    }, 0);
  
  const trans = computeTranslationStats(storm.track);
  const forward_speed = trans ? trans.mean_kmh : 15;
  
  const ri = findRapidIntensification(storm.track);
  const ri_delta = ri ? ri.delta_kt : 0;
  
  const ace_data = computeACE(storm.track);
  const ace = ace_data.value || 0;
  
  let decay_rate = 0;
  if (storm.peak_wind_idx != null && storm.track[storm.peak_wind_idx]) {
    const peak_t = new Date(storm.track[storm.peak_wind_idx].t).getTime();
    let final_wind = storm.peak_wind_kt;
    let final_t = peak_t;
    for (let i = storm.peak_wind_idx + 1; i < storm.track.length; i++) {
      if (storm.track[i].wind != null) {
        final_wind = storm.track[i].wind;
        final_t = new Date(storm.track[i].t).getTime();
      }
    }
    const days = (final_t - peak_t) / (24 * 3.6e6);
    decay_rate = (storm.peak_wind_kt - final_wind) / (days + 1);
  }
  
  const genesis_month = storm.genesis_t ? new Date(storm.genesis_t).getUTCMonth() + 1 : 8;

  const normalize = (val, min, max) => Math.max(0, Math.min(1, (val - min) / (max - min)));
  
  return [
    normalize(peak_wind, s.wind_min, s.wind_max),
    normalize(landfall_count, s.landfalls_min, s.landfalls_max),
    normalize(track_km, s.track_km_min, s.track_km_max),
    normalize(forward_speed, s.speed_min, s.speed_max),
    normalize(ri_delta, s.ri_min, s.ri_max),
    normalize(ace, s.ace_min, s.ace_max),
    normalize(decay_rate, s.decay_min, s.decay_max),
    (genesis_month - 1) / 11,
  ];
}

/** Compute cosine similarity between two 8-dimensional vectors. */
function cosineSimilarity(v1, v2) {
  if (!v1 || !v2 || v1.length !== v2.length) return 0;
  let dot = 0, mag1 = 0, mag2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    mag1 += v1[i] * v1[i];
    mag2 += v2[i] * v2[i];
  }
  const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
  return denom === 0 ? 0 : dot / denom;
}

/** Find the N most similar storms to a reference storm.
 *  Returns top-N array of {storm_id, name, year, similarity_score, peak_wind_kt, landfalls}. */
export function findSimilarStorms(referenceStorm, allStorms, topN = 5) {
  if (!referenceStorm || !Array.isArray(allStorms) || allStorms.length === 0) return [];
  
  const refVector = getStormVector(referenceStorm);
  const scores = allStorms
    .filter(s => s.id !== referenceStorm.id)
    .map(storm => ({
      storm_id: storm.id,
      name: storm.name,
      year: storm.year,
      peak_wind_kt: storm.peak_wind_kt,
      landfalls: (storm.us_landfalls || []).length,
      similarity_score: cosineSimilarity(refVector, getStormVector(storm)),
    }))
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, topN);
  
  return scores;
}

/** Compute climate trend data for stats panel.
 *  Returns yearly aggregates (ACE, landfall count, peak wind, forward speed)
 *  and 10-year rolling averages for visualization.
 *  Data range: 1851–present. */
export function computeClimateTrends(allStorms) {
  if (!Array.isArray(allStorms) || allStorms.length === 0) return null;

  // Group storms by year
  const byYear = {};
  for (const storm of allStorms) {
    if (!storm.year) continue;
    if (!byYear[storm.year]) {
      byYear[storm.year] = {
        year: storm.year,
        storms: [],
        us_landfalls: [],
      };
    }
    byYear[storm.year].storms.push(storm);
    if (Array.isArray(storm.us_landfalls)) {
      byYear[storm.year].us_landfalls.push(...storm.us_landfalls);
    }
  }

  // Compute yearly metrics
  const yearly = Object.values(byYear)
    .sort((a, b) => a.year - b.year)
    .map(year => {
      let totalACE = 0;
      let totalWind = 0;
      let totalSpeed = 0;
      let speedCount = 0;

      for (const storm of year.storms) {
        const ace = computeACE(storm.track);
        totalACE += ace.value;
        totalWind += storm.peak_wind_kt || 0;
        const trans = computeTranslationStats(storm.track);
        if (trans) {
          totalSpeed += trans.mean_kmh;
          speedCount++;
        }
      }

      return {
        year: year.year,
        named_storms: year.storms.length,
        landfalls: year.us_landfalls.length,
        major_landfalls: (year.us_landfalls || []).filter(lf => lf.category >= 3).length,
        avg_peak_wind: year.storms.length > 0 ? totalWind / year.storms.length : 0,
        avg_forward_speed: speedCount > 0 ? totalSpeed / speedCount : 0,
        total_ace: totalACE,
      };
    });

  // Compute 10-year rolling averages
  const rolling = yearly.map((year, idx) => {
    const start = Math.max(0, idx - 4); // center the window (5 years before + current + 4 years after = 10 years)
    const end = Math.min(yearly.length, idx + 6);
    const window = yearly.slice(start, end);

    if (window.length === 0) {
      return { year: year.year, rolling_avg_landfalls: 0, rolling_avg_ace: 0, rolling_avg_speed: 0 };
    }

    const avg_landfalls = window.reduce((sum, y) => sum + y.landfalls, 0) / window.length;
    const avg_ace = window.reduce((sum, y) => sum + y.total_ace, 0) / window.length;
    const avg_speed = window.reduce((sum, y) => sum + y.avg_forward_speed, 0) / window.length;

    return {
      year: year.year,
      rolling_avg_landfalls: avg_landfalls,
      rolling_avg_ace: avg_ace,
      rolling_avg_speed: avg_speed,
    };
  });

  // Compute overall trends (linear regression slope for the 10-year rolling averages)
  const trends = {
    landfalls_slope: computeTrendSlope(rolling.map(y => ({ x: y.year, y: y.rolling_avg_landfalls }))),
    ace_slope: computeTrendSlope(rolling.map(y => ({ x: y.year, y: y.rolling_avg_ace }))),
    speed_slope: computeTrendSlope(rolling.map(y => ({ x: y.year, y: y.rolling_avg_speed }))),
  };

  return {
    yearly,
    rolling,
    trends,
  };
}

/** Compute linear regression slope for trend analysis. */
function computeTrendSlope(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const n = points.length;
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumX2 = points.reduce((sum, p) => sum + p.x * p.x, 0);
  
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  
  return (n * sumXY - sumX * sumY) / denom;
}

