"""HURDAT2 preprocessor: parse Atlantic + Eastern Pacific best-track files,
identify US landfalls, attribute to states via point-in-polygon, and emit
JSON for the web map + a stats roll-up."""

from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

ATL_FILE = DATA / "hurdat2-atlantic.txt"
EPAC_FILE = DATA / "hurdat2-nepac.txt"
STATES_GEOJSON = DATA / "us-states.geojson"

OUT_LANDFALLS = DATA / "landfalls.json"
OUT_STORMS = DATA / "storms.json"
OUT_STATS = DATA / "stats.json"
OUT_METADATA = DATA / "metadata.json"

GENERATOR_NAME = "scripts/preprocess_hurdat2.py"
METADATA_SCHEMA_VERSION = 1

# Saffir-Simpson categories from sustained wind in knots.
def saffir_simpson(wind_kt: int) -> int:
    if wind_kt < 34:
        return 0  # TD
    if wind_kt < 64:
        return -1  # TS / sub-hurricane
    if wind_kt < 83:
        return 1
    if wind_kt < 96:
        return 2
    if wind_kt < 113:
        return 3
    if wind_kt < 137:
        return 4
    return 5


def parse_lat(s: str) -> float:
    s = s.strip()
    if s.endswith("N"):
        return float(s[:-1])
    if s.endswith("S"):
        return -float(s[:-1])
    return float(s)


def parse_lon(s: str) -> float:
    s = s.strip()
    if s.endswith("W"):
        return -float(s[:-1])
    if s.endswith("E"):
        # HURDAT2 occasionally crosses the antimeridian for EPac storms.
        return float(s[:-1])
    return float(s)


def iso_time(date8: str, hhmm: str) -> str:
    return f"{date8[:4]}-{date8[4:6]}-{date8[6:8]}T{hhmm[:2]}:{hhmm[2:]}:00Z"


def parse_hurdat2(path: Path, basin_label: str):
    """Yield dicts for each storm with header fields + list of track records."""
    with path.open("r", encoding="utf-8") as fh:
        current = None
        for raw in fh:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            cols = [c.strip() for c in line.split(",")]
            # Header lines have 4 fields and start with basin code.
            if cols[0][:2] in ("AL", "EP", "CP") and cols[0][2:].isdigit():
                if current:
                    yield current
                storm_id = cols[0]
                name = cols[1] if len(cols) > 1 else "UNNAMED"
                year = int(storm_id[-4:])
                current = {
                    "id": storm_id,
                    "basin": basin_label,
                    "name": name,
                    "year": year,
                    "track": [],
                }
                continue
            # Data lines have >= 21 fields.
            if not current or len(cols) < 8:
                continue
            try:
                date8, hhmm, rec_id, status, lat_s, lon_s, wind_s, pres_s = cols[:8]
                wind = int(wind_s)
                pres = int(pres_s)
                lat = parse_lat(lat_s)
                lon = parse_lon(lon_s)
            except (ValueError, IndexError):
                continue
            # Wind radii (best-tracked from 2004 onward). 4 quadrants per
            # threshold: 34 kt (TS-force), 50 kt, 64 kt (hurricane-force).
            # Stored as nautical miles; -999/0 means missing or no extent.
            radii = None
            try:
                if len(cols) >= 21:
                    raw_r = [int(cols[i]) for i in range(8, 20)]
                    # If any value is positive, keep the record. Negative-999
                    # means "no analysis"; zero means "no wind at that radius".
                    if any(v > 0 for v in raw_r):
                        # Store as flat 12-int array: [r34_ne, r34_se, r34_sw, r34_nw,
                        # r50_ne, r50_se, r50_sw, r50_nw, r64_ne, r64_se, r64_sw, r64_nw]
                        # Replace -999 with 0 to keep the JSON small.
                        radii = [max(0, v) for v in raw_r]
            except (ValueError, IndexError):
                radii = None
            rec = {
                "t": iso_time(date8, hhmm),
                "rec": rec_id,
                "status": status,
                "lat": lat,
                "lon": lon,
                "wind": wind if wind > 0 else None,
                "pres": pres if pres > 0 else None,
            }
            if radii:
                rec["radii"] = radii
            current["track"].append(rec)
        if current:
            yield current


def utc_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def file_mtime_utc(path: Path):
    if not path.exists():
        return None
    return utc_iso(datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc))


def load_package_version() -> str:
    package_path = ROOT / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
        version = package.get("version")
        return version if isinstance(version, str) and version else "unknown"
    except (OSError, json.JSONDecodeError):
        return "unknown"


def create_source_summary(path: Path, basin: str, label: str) -> dict:
    stat = path.stat() if path.exists() else None
    return {
        "id": label,
        "basin": basin,
        "filename": path.name,
        "path": str(path.relative_to(ROOT)).replace(os.sep, "/"),
        "size_bytes": stat.st_size if stat else None,
        "modified_utc": file_mtime_utc(path),
        "storm_count": 0,
        "storm_year_range": [None, None],
    }


def update_source_summary(summary: dict, storm: dict) -> None:
    summary["storm_count"] += 1
    year = storm.get("year")
    if not isinstance(year, int):
        return
    current_min, current_max = summary["storm_year_range"]
    summary["storm_year_range"] = [
        year if current_min is None else min(current_min, year),
        year if current_max is None else max(current_max, year),
    ]


def build_metadata(source_summaries, stats, outputs):
    output_files = {}
    for key, path in outputs.items():
        stat = path.stat() if path.exists() else None
        output_files[key] = {
            "path": str(path.relative_to(ROOT)).replace(os.sep, "/"),
            "size_bytes": stat.st_size if stat else None,
            "modified_utc": file_mtime_utc(path),
        }

    return {
        "schema_version": METADATA_SCHEMA_VERSION,
        "generated_at_utc": utc_iso(datetime.now(timezone.utc)),
        "generator": {
            "name": GENERATOR_NAME,
            "app_version": load_package_version(),
        },
        "sources": source_summaries,
        "coverage": {
            "year_range": stats.get("year_range", [None, None]),
            "storm_count": stats.get("total_storms"),
            "landfall_event_count": stats.get("total_landfall_events"),
            "hurricane_landfall_count": stats.get("total_hurricane_landfalls"),
            "basins": sorted({source["basin"] for source in source_summaries if source.get("basin")}),
        },
        "outputs": output_files,
        "methodology": {
            "explicit_landfall_marker": "HURDAT2 records with rec_id L inside or near U.S. state polygons.",
            "inferred_landfall_rule": "Storms without explicit U.S. L records are checked for TS+ water-to-land transitions against U.S. state polygons.",
            "category_rule": "Saffir-Simpson category is computed from sustained wind in knots at U.S. landfall.",
        },
    }


def load_states():
    """Load US states geojson and pre-compute bounding boxes for fast reject."""
    with STATES_GEOJSON.open("r", encoding="utf-8") as fh:
        gj = json.load(fh)
    out = []
    for feat in gj["features"]:
        name = feat["properties"]["name"]
        geom = feat["geometry"]
        polys = []
        if geom["type"] == "Polygon":
            polys.append(geom["coordinates"])
        elif geom["type"] == "MultiPolygon":
            polys.extend(geom["coordinates"])
        flat = []
        min_lon = min_lat = math.inf
        max_lon = max_lat = -math.inf
        for poly in polys:
            for ring in poly:
                for lon, lat in ring:
                    if lon < min_lon:
                        min_lon = lon
                    if lon > max_lon:
                        max_lon = lon
                    if lat < min_lat:
                        min_lat = lat
                    if lat > max_lat:
                        max_lat = lat
            flat.append(poly)
        out.append({
            "name": name,
            "polys": flat,
            "bbox": (min_lon, min_lat, max_lon, max_lat),
        })
    return out


def point_in_ring(lon: float, lat: float, ring) -> bool:
    """Ray-casting PIP. Ring is a list of [lon, lat] pairs (closed)."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon: float, lat: float, poly) -> bool:
    """A polygon is [outer, *holes]. Inside = inside outer AND outside holes."""
    if not poly:
        return False
    if not point_in_ring(lon, lat, poly[0]):
        return False
    for hole in poly[1:]:
        if point_in_ring(lon, lat, hole):
            return False
    return True


def dist_point_to_segment(px, py, ax, ay, bx, by) -> float:
    """Approximate planar distance, scaled by cos(lat) so degrees~uniform."""
    # Convert to roughly equirectangular metric.
    cos_lat = math.cos(math.radians((ay + by) * 0.5))
    ax_m = ax * cos_lat
    bx_m = bx * cos_lat
    px_m = px * cos_lat
    dx = bx_m - ax_m
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px_m - ax_m, py - ay)
    t = max(0.0, min(1.0, ((px_m - ax_m) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx = ax_m + t * dx
    cy = ay + t * dy
    return math.hypot(px_m - cx, py - cy)


def nearest_state(lon: float, lat: float, states, max_deg: float = 0.5):
    """Return (state_name, distance_deg) for the closest US state polygon edge.
    If no state is within max_deg, return (None, None).
    Tries PIP first (returns 0 distance), else samples polygon edges."""
    best = None
    best_d = max_deg
    for st in states:
        mlon, mlat, Mlon, Mlat = st["bbox"]
        if lon < mlon - max_deg or lon > Mlon + max_deg:
            continue
        if lat < mlat - max_deg or lat > Mlat + max_deg:
            continue
        for poly in st["polys"]:
            if point_in_polygon(lon, lat, poly):
                return st["name"], 0.0
            for ring in poly:
                n = len(ring)
                for i in range(n - 1):
                    ax, ay = ring[i]
                    bx, by = ring[i + 1]
                    d = dist_point_to_segment(lon, lat, ax, ay, bx, by)
                    if d < best_d:
                        best_d = d
                        best = st["name"]
    return (best, best_d) if best else (None, None)


# US territory bounding boxes for the coarse first-pass filter (lat,lat,lon,lon).
US_BBOXES = [
    # CONUS east + Gulf coast
    ("CONUS_EAST", 24.0, 49.5, -100.0, -65.0),
    # Hawaii
    ("HAWAII", 18.5, 23.0, -161.0, -154.0),
    # Puerto Rico + USVI
    ("PR_USVI", 17.0, 19.0, -68.0, -64.5),
    # West coast (rare landfalls — Pacific)
    ("CONUS_WEST", 32.0, 49.0, -125.0, -116.0),
    # Alaska (extremely rare for tropical systems but include for completeness)
    ("ALASKA", 51.0, 72.0, -180.0, -130.0),
]


def in_us_bbox(lon: float, lat: float) -> bool:
    for _, lat0, lat1, lon0, lon1 in US_BBOXES:
        if lat0 - 1.0 <= lat <= lat1 + 1.0 and lon0 - 1.0 <= lon <= lon1 + 1.0:
            return True
    return False


def state_at_point(lon, lat, states):
    """Return state name if (lon, lat) is inside any US state polygon, else None.
    Strict PIP — used for inferred-landfall detection."""
    for st in states:
        mlon, mlat, Mlon, Mlat = st["bbox"]
        if not (mlon <= lon <= Mlon and mlat <= lat <= Mlat):
            continue
        for poly in st["polys"]:
            if point_in_polygon(lon, lat, poly):
                return st["name"]
    return None


def main():
    print("Loading state polygons...", file=sys.stderr)
    states = load_states()
    print(f"Loaded {len(states)} state/territory polygons.", file=sys.stderr)

    storms_with_us_landfall = []
    landfall_events = []  # flat list, one per US landfall record
    source_summaries = []

    for src_path, basin, source_id in (
        (ATL_FILE, "AL", "hurdat2_atlantic"),
        (EPAC_FILE, "EP", "hurdat2_eastern_pacific"),
    ):
        source_summary = create_source_summary(src_path, basin, source_id)
        source_summaries.append(source_summary)
        if not src_path.exists():
            print(f"WARN: missing {src_path}", file=sys.stderr)
            continue
        print(f"Parsing {src_path.name}...", file=sys.stderr)
        for storm in parse_hurdat2(src_path, basin):
            update_source_summary(source_summary, storm)
            us_landfalls = []
            for rec in storm["track"]:
                if rec["rec"] != "L":
                    continue
                if not in_us_bbox(rec["lon"], rec["lat"]):
                    continue
                state, d = nearest_state(rec["lon"], rec["lat"], states)
                if not state:
                    continue
                us_landfalls.append({
                    "t": rec["t"],
                    "lat": rec["lat"],
                    "lon": rec["lon"],
                    "wind": rec["wind"],
                    "pres": rec["pres"],
                    "status": rec["status"],
                    "category": saffir_simpson(rec["wind"] or 0),
                    "state": state,
                    "inferred": False,
                })

            # If the storm has no explicit US L record (e.g. Hawaii/Pacific
            # storms, or 1971-1990 gap years), look for water->land transitions
            # in the track. This catches storms like Iniki (1992) on Kauai.
            # We also sample mid-segment positions because HURDAT2 records are
            # 6-hourly and a fast-moving storm can cross a small island in <6h.
            # For Pacific-basin storms, we only allow inferred landfalls in
            # coastal Pacific states — otherwise EPac storms tracking up through
            # Mexico generate spurious "landfalls" in landlocked Arizona/NM.
            EP_COASTAL_OK = {
                "Hawaii", "California", "Oregon", "Washington", "Alaska",
            }
            allowed_states = EP_COASTAL_OK if storm["basin"] == "EP" else None
            if not us_landfalls:
                track = storm["track"]
                prev_state = None
                if track:
                    prev_state = state_at_point(track[0]["lon"], track[0]["lat"], states)
                    if prev_state and track[0]["status"] in ("HU", "TS", "SS"):
                        if allowed_states is None or prev_state in allowed_states:
                            us_landfalls.append({
                                "t": track[0]["t"], "lat": track[0]["lat"], "lon": track[0]["lon"],
                                "wind": track[0]["wind"], "pres": track[0]["pres"],
                                "status": track[0]["status"],
                                "category": saffir_simpson(track[0]["wind"] or 0),
                                "state": prev_state, "inferred": True,
                            })
                for i in range(1, len(track)):
                    a = track[i - 1]
                    b = track[i]
                    here_state = state_at_point(b["lon"], b["lat"], states)
                    # Direct entry on a synoptic point.
                    if here_state and not prev_state and b["status"] in ("HU", "TS", "SS"):
                        if allowed_states is None or here_state in allowed_states:
                            us_landfalls.append({
                                "t": b["t"], "lat": b["lat"], "lon": b["lon"],
                                "wind": b["wind"], "pres": b["pres"], "status": b["status"],
                                "category": saffir_simpson(b["wind"] or 0),
                                "state": here_state, "inferred": True,
                            })
                    # Mid-segment crossing: both endpoints offshore but segment grazes land.
                    elif not here_state and not prev_state and b["status"] in ("HU", "TS", "SS"):
                        for k in range(1, 10):
                            f = k / 10.0
                            mlon = a["lon"] + (b["lon"] - a["lon"]) * f
                            mlat = a["lat"] + (b["lat"] - a["lat"]) * f
                            mid_state = state_at_point(mlon, mlat, states)
                            if mid_state and (allowed_states is None or mid_state in allowed_states):
                                # Interpolate wind/pres linearly.
                                w_a = a["wind"] or 0
                                w_b = b["wind"] or 0
                                p_a = a["pres"] or 0
                                p_b = b["pres"] or 0
                                wind = int(round(w_a + (w_b - w_a) * f)) if (w_a or w_b) else None
                                pres = int(round(p_a + (p_b - p_a) * f)) if (p_a or p_b) else None
                                # Pick the higher-intensity status.
                                status = a["status"] if (w_a >= w_b) else b["status"]
                                us_landfalls.append({
                                    "t": b["t"], "lat": round(mlat, 2), "lon": round(mlon, 2),
                                    "wind": wind, "pres": pres, "status": status,
                                    "category": saffir_simpson(wind or 0),
                                    "state": mid_state, "inferred": True,
                                })
                                break
                    prev_state = here_state

            if not us_landfalls:
                continue

            # Peak intensity for the storm (any time, any location).
            peak_wind = 0
            min_pres = None
            peak_status = ""
            for rec in storm["track"]:
                if rec["wind"] and rec["wind"] > peak_wind:
                    peak_wind = rec["wind"]
                    peak_status = rec["status"]
                if rec["pres"] and (min_pres is None or rec["pres"] < min_pres):
                    min_pres = rec["pres"]

            # The storm's "headline" category is the max category at any US landfall
            # (so a storm peaking offshore but landing as a TS shows up as TS).
            max_landfall_cat = max(lf["category"] for lf in us_landfalls)
            max_landfall_wind = max((lf["wind"] or 0) for lf in us_landfalls)

            storm_record = {
                "id": storm["id"],
                "basin": storm["basin"],
                "name": storm["name"],
                "year": storm["year"],
                "peak_wind_kt": peak_wind,
                "min_pres_mb": min_pres,
                "peak_status": peak_status,
                "landfall_max_category": max_landfall_cat,
                "landfall_max_wind_kt": max_landfall_wind,
                "us_landfall_count": len(us_landfalls),
                "us_landfalls": us_landfalls,
                "track": [
                    {
                        "t": r["t"],
                        "lat": r["lat"],
                        "lon": r["lon"],
                        "wind": r["wind"],
                        "pres": r["pres"],
                        "status": r["status"],
                        "rec": r["rec"] or None,
                        # Wind radii kept ONLY when present (2004-onward best-track).
                        # Format: 12-int flat array, see parse_hurdat2.
                        **({"radii": r["radii"]} if r.get("radii") else {}),
                    }
                    for r in storm["track"]
                ],
            }
            storms_with_us_landfall.append(storm_record)
            for lf in us_landfalls:
                landfall_events.append({
                    "storm_id": storm["id"],
                    "name": storm["name"],
                    "year": storm["year"],
                    "t": lf["t"],
                    "lat": lf["lat"],
                    "lon": lf["lon"],
                    "wind": lf["wind"],
                    "pres": lf["pres"],
                    "status": lf["status"],
                    "category": lf["category"],
                    "state": lf["state"],
                })

    print(f"US-landfalling storms: {len(storms_with_us_landfall)}", file=sys.stderr)
    print(f"US landfall events: {len(landfall_events)}", file=sys.stderr)

    # Stats roll-up.
    by_state = defaultdict(lambda: {"total": 0, "by_cat": [0, 0, 0, 0, 0, 0, 0]})
    by_decade = defaultdict(lambda: {"total": 0, "by_cat": [0, 0, 0, 0, 0, 0, 0]})
    by_year = defaultdict(int)
    by_cat_total = [0, 0, 0, 0, 0, 0, 0]  # index 0=TD/none, then -1 mapped to 0
    hurricane_only = [lf for lf in landfall_events if lf["category"] >= 1]

    def cat_idx(cat):
        # Map -1 (TS) and 0 (TD) to bucket 0; 1..5 stay as-is in slots 1..5; index 6 unused
        if cat <= 0:
            return 0
        return cat

    for lf in landfall_events:
        idx = cat_idx(lf["category"])
        by_state[lf["state"]]["total"] += 1
        by_state[lf["state"]]["by_cat"][idx] += 1
        decade = (lf["year"] // 10) * 10
        by_decade[decade]["total"] += 1
        by_decade[decade]["by_cat"][idx] += 1
        by_year[lf["year"]] += 1
        by_cat_total[idx] += 1

    # Identify "cold-spot" coastal states: states with a coastline that have
    # never recorded a hurricane-strength US landfall in HURDAT2.
    coastal_states = [
        "Alabama", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii",
        "Louisiana", "Maine", "Maryland", "Massachusetts", "Mississippi",
        "New Hampshire", "New Jersey", "New York", "North Carolina",
        "Pennsylvania", "Puerto Rico", "Rhode Island", "South Carolina",
        "Texas", "Virginia", "District of Columbia",
    ]
    states_with_hurricane_landfall = {
        lf["state"] for lf in landfall_events if lf["category"] >= 1
    }
    cold_spots = sorted(set(coastal_states) - states_with_hurricane_landfall)

    stats = {
        "total_storms": len(storms_with_us_landfall),
        "total_landfall_events": len(landfall_events),
        "total_hurricane_landfalls": len(hurricane_only),
        "by_state": {k: dict(v) for k, v in sorted(by_state.items())},
        "by_decade": {str(k): dict(v) for k, v in sorted(by_decade.items())},
        "by_year": dict(sorted(by_year.items())),
        "by_category": {
            "ts_or_below": by_cat_total[0],
            "cat1": by_cat_total[1],
            "cat2": by_cat_total[2],
            "cat3": by_cat_total[3],
            "cat4": by_cat_total[4],
            "cat5": by_cat_total[5],
        },
        "cold_spot_coastal_states": cold_spots,
        "year_range": [min(by_year) if by_year else None,
                       max(by_year) if by_year else None],
        "generated_from": [ATL_FILE.name, EPAC_FILE.name],
    }

    OUT_LANDFALLS.write_text(json.dumps(landfall_events, separators=(",", ":")), encoding="utf-8")
    OUT_STORMS.write_text(json.dumps(storms_with_us_landfall, separators=(",", ":")), encoding="utf-8")
    OUT_STATS.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    metadata = build_metadata(
        source_summaries,
        stats,
        {
            "landfalls": OUT_LANDFALLS,
            "storms": OUT_STORMS,
            "stats": OUT_STATS,
        },
    )
    OUT_METADATA.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    sz = lambda p: f"{p.stat().st_size / 1024:.1f} KB"
    print(f"Wrote {OUT_LANDFALLS.name} ({sz(OUT_LANDFALLS)})", file=sys.stderr)
    print(f"Wrote {OUT_STORMS.name} ({sz(OUT_STORMS)})", file=sys.stderr)
    print(f"Wrote {OUT_STATS.name} ({sz(OUT_STATS)})", file=sys.stderr)
    print(f"Wrote {OUT_METADATA.name} ({sz(OUT_METADATA)})", file=sys.stderr)


if __name__ == "__main__":
    main()
