// Shared spherical-Earth geodesy for every browser workflow. HURDAT2 and NHC
// products use geographic coordinates; a single mean-radius model keeps map,
// tide, track, cone, and contour distances numerically consistent.

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_NAUTICAL_MILE = 1.852;

export function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

export function toDegrees(value) {
  return Number(value) * 180 / Math.PI;
}

export function normalizeLongitude(value) {
  return ((Number(value) + 540) % 360) - 180;
}

function clampUnit(value) {
  return Math.max(-1, Math.min(1, value));
}

function angularDistance(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = phi2 - phi1;
  const deltaLambda = toRadians(normalizeLongitude(Number(lon2) - Number(lon1)));
  const haversine = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

function unitVector(lat, lon) {
  const phi = toRadians(lat);
  const lambda = toRadians(lon);
  const cosPhi = Math.cos(phi);
  return [
    cosPhi * Math.cos(lambda),
    cosPhi * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function greatCirclePoint(start, end, fraction, segmentAngle) {
  const a = unitVector(start.lat, start.lon);
  const b = unitVector(end.lat, end.lon);
  const omega = segmentAngle ?? Math.acos(clampUnit(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  if (omega === 0 || Math.sin(omega) === 0) return [start.lon, start.lat];
  const weightA = Math.sin((1 - fraction) * omega) / Math.sin(omega);
  const weightB = Math.sin(fraction * omega) / Math.sin(omega);
  const x = weightA * a[0] + weightB * b[0];
  const y = weightA * a[1] + weightB * b[1];
  const z = weightA * a[2] + weightB * b[2];
  return [
    normalizeLongitude(toDegrees(Math.atan2(y, x))),
    toDegrees(Math.atan2(z, Math.hypot(x, y))),
  ];
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  return EARTH_RADIUS_KM * angularDistance(lat1, lon1, lat2, lon2);
}

export function initialBearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaLambda = toRadians(normalizeLongitude(Number(lon2) - Number(lon1)));
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2)
    - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function destinationPointKm(lat, lon, bearing, distanceKm) {
  const angular = Number(distanceKm) / EARTH_RADIUS_KM;
  const phi1 = toRadians(lat);
  const lambda1 = toRadians(lon);
  const theta = toRadians(bearing);
  const phi2 = Math.asin(clampUnit(
    Math.sin(phi1) * Math.cos(angular)
    + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta),
  ));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
    Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2),
  );
  return [toDegrees(phi2), normalizeLongitude(toDegrees(lambda2))];
}

export function destinationPointNmi(lat, lon, bearing, distanceNmi) {
  return destinationPointKm(lat, lon, bearing, Number(distanceNmi) * KM_PER_NAUTICAL_MILE);
}

// Shortest great-circle distance and projected point on a finite great-circle
// segment. GeoJSON positions use [longitude, latitude].
export function pointToSegmentProjectionKm(lat, lon, start, end) {
  const a = { lat: Number(start?.[1]), lon: Number(start?.[0]) };
  const b = { lat: Number(end?.[1]), lon: Number(end?.[0]) };
  const point = { lat: Number(lat), lon: Number(lon) };
  if (![a.lat, a.lon, b.lat, b.lon, point.lat, point.lon].every(Number.isFinite)) {
    return { distance_km: Infinity, fraction: null, point: null };
  }
  const segmentAngle = angularDistance(a.lat, a.lon, b.lat, b.lon);
  if (segmentAngle === 0) {
    return {
      distance_km: haversineKm(point.lat, point.lon, a.lat, a.lon),
      fraction: 0,
      point: [a.lon, a.lat],
    };
  }

  const pointAngle = angularDistance(a.lat, a.lon, point.lat, point.lon);
  const bearingDelta = toRadians(
    initialBearingDeg(a.lat, a.lon, point.lat, point.lon)
    - initialBearingDeg(a.lat, a.lon, b.lat, b.lon),
  );
  const crossTrackAngle = Math.asin(clampUnit(Math.sin(pointAngle) * Math.sin(bearingDelta)));
  const alongTrackAngle = Math.atan2(
    Math.sin(pointAngle) * Math.cos(bearingDelta),
    Math.cos(pointAngle),
  );
  if (alongTrackAngle < 0 || alongTrackAngle > segmentAngle) {
    const distanceA = haversineKm(point.lat, point.lon, a.lat, a.lon);
    const distanceB = haversineKm(point.lat, point.lon, b.lat, b.lon);
    return distanceA <= distanceB
      ? { distance_km: distanceA, fraction: 0, point: [a.lon, a.lat] }
      : { distance_km: distanceB, fraction: 1, point: [b.lon, b.lat] };
  }
  const fraction = Math.max(0, Math.min(1, alongTrackAngle / segmentAngle));
  return {
    distance_km: Math.abs(crossTrackAngle) * EARTH_RADIUS_KM,
    fraction,
    point: greatCirclePoint(a, b, fraction, segmentAngle),
  };
}

// Shortest great-circle distance from a point to a finite great-circle
// segment. GeoJSON positions use [longitude, latitude].
export function pointToSegmentDistanceKm(lat, lon, start, end) {
  return pointToSegmentProjectionKm(lat, lon, start, end).distance_km;
}
