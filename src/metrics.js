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

