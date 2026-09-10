"""HURDAT2 preprocessor: parse Atlantic + Eastern Pacific best-track files,
identify US landfalls, attribute to states via point-in-polygon, and emit
JSON for the web map + a stats roll-up."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import platform
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_billions import RETIREMENT_CITATION as BILLIONS_RETIREMENT_CITATION  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

ATL_FILE = DATA / "hurdat2-atlantic.txt"
EPAC_FILE = DATA / "hurdat2-nepac.txt"
STATES_GEOJSON = DATA / "us-states.geojson"
SOURCE_LOCK_FILE = DATA / "hurdat2-sources.json"
AOML_LANDFALLS = DATA / "aoml-landfalls.json"
LAND_MASK = DATA / "land-mask.json"
# The tolerance data/land-mask.json is built at. The crossing walk samples a
# segment finer than this, and load_land_mask refuses a file built coarser.
LAND_MASK_TOLERANCE_DEGREES = 0.01

OUT_LANDFALLS = DATA / "landfalls.json"
OUT_STORMS = DATA / "storms.json"
OUT_STORMS_GZ = DATA / "storms.json.gz"
OUT_STATS = DATA / "stats.json"
OUT_METADATA = DATA / "metadata.json"
IMPACTS_FILE = DATA / "impacts.json"

GENERATOR_NAME = "scripts/preprocess_hurdat2.py"
METADATA_SCHEMA_VERSION = 1
EARTH_R_KM = 6371.0088
KM_PER_DEGREE = 111.1950802335329
TS_THRESHOLD_KT = 34
RI_THRESHOLD_KT = 30
RI_WINDOW_HOURS = 24
SIMILARITY_VECTOR_LENGTH = 8
SIMILARITY_VECTOR_STATS = {
    "wind_max": 185,
    "wind_min": 35,
    "landfalls_max": 7,
    "landfalls_min": 0,
    "track_km_max": 20000,
    "track_km_min": 500,
    "speed_max": 60,
    "speed_min": 2,
    "ri_max": 120,
    "ri_min": 0,
    "ace_max": 100,
    "ace_min": 0,
    "decay_max": 50,
    "decay_min": -5,
}

# Lifecycle metadata is shipped with the generated build metadata so a
# missing row can be distinguished from a source that has permanently ended.
# `end_date` is the last date covered by this bundled snapshot; it is not an
# expiry date for an active source. Closed/deprecated sources must also carry
# a retirement citation.
DATASET_STATUSES = [
    {
        "id": "hurdat2",
        "label": "NOAA/NHC HURDAT2 best-track and derived landfall data",
        "paths": [
            "data/hurdat2-atlantic.txt",
            "data/hurdat2-nepac.txt",
            "data/hurdat2-sources.json",
            "data/landfalls.json",
            "data/stats.json",
            "data/storms.json",
            "data/storms.json.gz",
        ],
        "status": "active",
        "end_date": "2025-12-31",
        "retirement_citation": None,
    },
    {
        "id": "aoml-landfalls",
        "label": "AOML detailed U.S. hurricane landfall table",
        "paths": ["data/aoml-landfalls.json", "data/aoml-us-landfalls.html"],
        "status": "active",
        "end_date": "2025-12-31",
        "retirement_citation": None,
    },
    {
        "id": "storm-impacts",
        "label": "Community-sourced storm impacts",
        "paths": ["data/impacts.json"],
        "status": "active",
        "end_date": "2025-12-31",
        "retirement_citation": None,
    },
    {
        "id": "ncei-billions",
        "label": "NOAA NCEI Billion-Dollar Weather and Climate Disasters",
        "paths": ["data/billions.json", "data/ncei-billions-1980-2024.csv"],
        "status": "closed",
        "end_date": "2024-12-31",
        # Read from the builder that owns the series rather than copied here.
        # The copy went stale the day the successor was added: build_billions.py
        # gained the Climate Central handover, metadata.json was edited to match,
        # and the next run of this file would have silently dropped it again.
        "retirement_citation": BILLIONS_RETIREMENT_CITATION,
    },
    {
        "id": "enso",
        "label": "NOAA PSL Oceanic Niño Index snapshot",
        "paths": ["data/enso.json"],
        "status": "active",
        "end_date": "2025-12-31",
        "retirement_citation": None,
    },
    {
        "id": "seasonal-outlook",
        "label": "NOAA/CPC and CSU seasonal outlook snapshot",
        "paths": ["data/outlook.json"],
        "status": "active",
        "end_date": "2026-12-31",
        "retirement_citation": None,
    },
    {
        "id": "forecast-skill",
        "label": "NOAA/NHC official forecast skill summary",
        "paths": ["data/forecast-skill.json"],
        "status": "active",
        "end_date": "2025-12-31",
        "retirement_citation": None,
    },
    {
        "id": "advisory-replay",
        "label": "NHC archived advisory replay",
        "paths": ["data/advisories.json", "data/cone-radii.json"],
        "status": "active",
        "end_date": "2024-12-31",
        "retirement_citation": None,
    },
    {
        "id": "storm-events",
        "label": "NOAA/NCEI Storm Events coincidence data",
        "paths": ["data/storm-events.json"],
        "status": "active",
        "end_date": "2025-12-31",
        "retirement_citation": None,
    },
    {
        "id": "rainfall",
        "label": "NOAA tropical cyclone rainfall reports",
        "paths": ["data/rainfall.json"],
        "status": "active",
        "end_date": "2024-12-31",
        "retirement_citation": None,
    },
    {
        "id": "radar-archive",
        "label": "Iowa State IEM archived NEXRAD composites",
        "paths": ["data/radar/manifest.json"],
        "status": "active",
        "end_date": None,
        "retirement_citation": None,
    },
    {
        "id": "hwm",
        "label": "USGS observed high-water marks",
        "paths": ["data/surge-obs/index.json"],
        "status": "active",
        "end_date": None,
        "retirement_citation": None,
    },
    {
        "id": "tide-stations",
        "label": "NOAA CO-OPS tide-station index",
        "paths": ["data/tide-stations.json"],
        "status": "active",
        "end_date": None,
        "retirement_citation": None,
    },
    {
        "id": "storm-boundaries",
        "label": "U.S. Census state boundary polygons",
        "paths": ["data/us-states.geojson"],
        "status": "active",
        "end_date": None,
        "retirement_citation": None,
    },
    {
        "id": "land-mask",
        "label": "Natural Earth North American coastline",
        "paths": ["data/land-mask.json"],
        "status": "active",
        "end_date": None,
        "retirement_citation": None,
    },
    {
        "id": "glossary",
        "label": "HurricaneMap glossary",
        "paths": ["data/glossary.json"],
        "status": "active",
        "end_date": None,
        "retirement_citation": None,
    },
]

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


def category_strength(category: int) -> int:
    """Return an intensity rank that preserves the TD=0, TS=-1 encoding."""
    if category == 0:
        return 0
    if category == -1:
        return 1
    return category + 1


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


def normalize_generated_at(value: str) -> str:
    """Normalize an explicit absolute timestamp without consulting the clock."""
    candidate = str(value or "").strip()
    if not candidate:
        raise ValueError("--generated-at is required; pass an explicit ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"--generated-at is not a valid ISO-8601 timestamp: {candidate}") from exc
    if parsed.tzinfo is None:
        raise ValueError("--generated-at must include a timezone, for example 2026-08-02T00:00:00Z")
    return utc_iso(parsed)


def resolve_source_commit(explicit: str | None = None) -> str:
    candidate = str(explicit or os.environ.get("HURRICANEMAP_SOURCE_COMMIT") or "").strip()
    if not candidate:
        try:
            candidate = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except (OSError, subprocess.CalledProcessError) as exc:
            raise RuntimeError("Unable to resolve a git source revision; pass --source-commit explicitly") from exc
    if len(candidate) != 40 or any(char not in "0123456789abcdefABCDEF" for char in candidate):
        raise ValueError(f"--source-commit must be a 40-character git revision: {candidate}")
    return candidate.lower()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_source_manifest() -> dict[str, dict]:
    """Load and verify the exact raw HURDAT2 bytes before parsing them."""
    try:
        manifest = json.loads(SOURCE_LOCK_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(
            f"Unable to read {SOURCE_LOCK_FILE.relative_to(ROOT)}; run refresh-hurdat2.mjs --apply first"
        ) from exc
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("sources"), list):
        raise RuntimeError(f"{SOURCE_LOCK_FILE.relative_to(ROOT)} is not a version 1 source lock")

    expected = {
        ATL_FILE.relative_to(ROOT).as_posix(): "AL",
        EPAC_FILE.relative_to(ROOT).as_posix(): "EP",
    }
    entries = {}
    for entry in manifest["sources"]:
        if not isinstance(entry, dict):
            raise RuntimeError("HURDAT2 source lock entries must be objects")
        local_path = entry.get("local_path")
        if local_path not in expected or entry.get("basin") != expected[local_path]:
            raise RuntimeError(f"Unexpected HURDAT2 source lock path or basin: {local_path}")
        if local_path in entries:
            raise RuntimeError(f"Duplicate HURDAT2 source lock path: {local_path}")
        if not isinstance(entry.get("source_url"), str) or not entry["source_url"].startswith("https://"):
            raise RuntimeError(f"HURDAT2 source lock URL is not HTTPS: {local_path}")
        try:
            datetime.strptime(entry["source_date"], "%Y-%m-%d")
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError(f"HURDAT2 source lock date is invalid: {local_path}") from exc
        if not isinstance(entry.get("source_file"), str) or not entry["source_file"].endswith(".txt"):
            raise RuntimeError(f"HURDAT2 source lock filename is invalid: {local_path}")
        if not isinstance(entry.get("sha256"), str) or len(entry["sha256"]) != 64:
            raise RuntimeError(f"HURDAT2 source lock SHA-256 is invalid: {local_path}")
        source_path = ROOT / local_path
        if not source_path.is_file():
            raise RuntimeError(f"HURDAT2 source file is missing: {local_path}")
        actual_bytes = source_path.stat().st_size
        actual_sha256 = sha256_file(source_path)
        if actual_bytes != entry.get("bytes") or actual_sha256 != entry.get("sha256"):
            raise RuntimeError(
                f"HURDAT2 source lock does not match {local_path}; "
                "run refresh-hurdat2.mjs --apply after verifying the upstream revision"
            )
        entries[local_path] = entry
    if set(entries) != set(expected):
        missing = sorted(set(expected) - set(entries))
        raise RuntimeError(f"HURDAT2 source lock is missing: {', '.join(missing)}")
    return entries


def load_package_version() -> str:
    package_path = ROOT / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
        version = package.get("version")
        return version if isinstance(version, str) and version else "unknown"
    except (OSError, json.JSONDecodeError):
        return "unknown"


def create_source_summary(path: Path, basin: str, label: str, source_lock: dict) -> dict:
    stat = path.stat() if path.exists() else None
    return {
        "id": label,
        "basin": basin,
        "filename": path.name,
        "path": str(path.relative_to(ROOT)).replace(os.sep, "/"),
        "size_bytes": stat.st_size if stat else None,
        "modified_utc": f"{source_lock['source_date']}T00:00:00Z",
        "source_date": source_lock["source_date"],
        "source_file": source_lock["source_file"],
        "source_url": source_lock["source_url"],
        "sha256": source_lock["sha256"],
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


def build_metadata(source_summaries, stats, outputs, generated_at, source_commit):
    output_files = {}
    for key, path in outputs.items():
        stat = path.stat() if path.exists() else None
        output_files[key] = {
            "path": str(path.relative_to(ROOT)).replace(os.sep, "/"),
            "size_bytes": stat.st_size if stat else None,
            "modified_utc": generated_at,
            "sha256": sha256_file(path) if stat else None,
        }

    try:
        impacts = json.loads(IMPACTS_FILE.read_text(encoding="utf-8"))
        impact_row_count = len([key for key in impacts if key != "_meta"]) if isinstance(impacts, dict) else 0
    except (OSError, json.JSONDecodeError):
        impact_row_count = 0

    return {
        "schema_version": METADATA_SCHEMA_VERSION,
        "generated_at_utc": generated_at,
        "generator": {
            "name": GENERATOR_NAME,
            "app_version": load_package_version(),
            "source_commit": source_commit,
            "source_manifest": str(SOURCE_LOCK_FILE.relative_to(ROOT)).replace(os.sep, "/"),
            "runtime": f"Python {platform.python_version()}",
        },
        "sources": source_summaries,
        "datasets": DATASET_STATUSES,
        "coverage": {
            "year_range": stats.get("year_range", [None, None]),
            "storm_count": stats.get("total_storms"),
            "landfall_event_count": stats.get("total_landfall_events"),
            "hurricane_landfall_count": stats.get("total_hurricane_landfalls"),
            "impact_row_count": impact_row_count,
            "basins": sorted({source["basin"] for source in source_summaries if source.get("basin")}),
        },
        "outputs": output_files,
        "methodology": {
            "explicit_landfall_marker": "HURDAT2 records with rec_id L inside or near U.S. state polygons.",
            "inferred_landfall_rule": "Storms without explicit U.S. L records are checked for TS+ water-to-land transitions against U.S. state polygons; HURDAT2 C (closest approach without a landfall) records and adjacent segments are excluded, as is any transition whose preceding fix is a landfall record outside the United States, because a centre already ashore cannot come ashore again. Texas landfalls are dropped for the storms AOML marks as having made landfall over Mexico first.",
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


def initial_bearing_radians(lat1, lon1, lat2, lon2) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lon = math.radians(((lon2 - lon1 + 540) % 360) - 180)
    return math.atan2(
        math.sin(delta_lon) * math.cos(phi2),
        math.cos(phi1) * math.sin(phi2)
        - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lon),
    )


def point_segment_distance_km(lat, lon, start, end) -> float:
    """Shortest spherical distance from a point to a finite GeoJSON segment."""
    a_lon, a_lat = start
    b_lon, b_lat = end
    segment_angle = haversine_km(a_lat, a_lon, b_lat, b_lon) / EARTH_R_KM
    if segment_angle == 0:
        return haversine_km(lat, lon, a_lat, a_lon)
    point_angle = haversine_km(a_lat, a_lon, lat, lon) / EARTH_R_KM
    bearing_delta = (
        initial_bearing_radians(a_lat, a_lon, lat, lon)
        - initial_bearing_radians(a_lat, a_lon, b_lat, b_lon)
    )
    cross_track = math.asin(max(-1.0, min(1.0, math.sin(point_angle) * math.sin(bearing_delta))))
    along_track = math.atan2(
        math.sin(point_angle) * math.cos(bearing_delta),
        math.cos(point_angle),
    )
    if along_track < 0 or along_track > segment_angle:
        return min(
            haversine_km(lat, lon, a_lat, a_lon),
            haversine_km(lat, lon, b_lat, b_lon),
        )
    return abs(cross_track) * EARTH_R_KM


def nearest_state(lon: float, lat: float, states, max_deg: float = 0.5):
    """Return (state_name, distance_km) for the closest US state polygon edge.
    If no state is within the equivalent max_deg radius, return (None, None).
    Tries PIP first (returns 0 distance), else samples polygon edges."""
    best = None
    best_d = max_deg * KM_PER_DEGREE
    # `best_d` is a distance in kilometres, so the box that rejects candidates
    # early has to be one too. A degree of longitude is shorter than a degree of
    # latitude everywhere but the equator, so a plain `max_deg` in longitude
    # rejected states that were genuinely inside the radius: 36.0 km at 26N,
    # 30.2 at 41.8N, 23.0 at 55N against a 40 km radius. Eighteen constructed
    # points across the state set were inside the radius and thrown out by the
    # box, one of them off the Atchafalaya delta, which is exactly where this
    # file says the two coastlines disagree most.
    lon_margin = max_deg / max(math.cos(math.radians(lat)), 0.1)
    for st in states:
        mlon, mlat, Mlon, Mlat = st["bbox"]
        if lon < mlon - lon_margin or lon > Mlon + lon_margin:
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
                    d = point_segment_distance_km(lat, lon, [ax, ay], [bx, by])
                    if d < best_d:
                        best_d = d
                        best = st["name"]
    return (best, best_d) if best else (None, None)


# How far outside the United States a water-to-land crossing may be and still
# be that storm's US landfall. The two coastlines this build uses disagree along
# the US shore, because Natural Earth and the Census boundaries draw barrier
# islands, bays and deltas differently, and a HURDAT2 fix is stated to a tenth
# of a degree on top of that. Both sides of this number are measured over the
# whole record rather than reasoned about:
#
# The inference runs only for a storm with no explicit US landfall record, so
# these are the crossings it actually sees, not every landfall in the atlas.
# Of the 35, twenty-two are inside a state polygon and score zero. The rest:
#
#   genuine, and kept: the 1936 Texas storm at 10.67 km, Babe 1977 at 11.81,
#   the 1880 storm at 13.96, the 1857 storm at 15.32, Beulah 1967 at 16.64 and
#   Danielle 1980 at 17.65, whose first crossing is on a barrier island the
#   Census polygons leave out;
#
#   entered over a land border, and refused: Hermine 2010 at 68.69 km, the 1925
#   storm at 75.78, Alice 1954 at 103.02, the 1874 storm at 114.64, and Lester
#   1992 at 273.54 into Arizona from Sonora.
#
# Swept over both basins, the whole atlas is identical anywhere from 20 km to
# 75 km. At 80 the 1925 storm comes back; at 200 all three Rio Grande crossings
# do; at 10 the 1936 storm, Babe 1977 and Danielle are lost. 40 sits in the
# middle of the plateau, and it is not a distance to read meaning into beyond
# "further from the United States than two coastlines can disagree, and nearer
# than Tamaulipas".
MAX_FOREIGN_CROSSING_KM = 40.0


def load_land_mask():
    """The North American coastline, as one ring, with the window it covers.

    Built by scripts/build_land_mask.py from Natural Earth. Islands are absent
    on purpose; see that file for why that is the right answer here.
    """
    with LAND_MASK.open("r", encoding="utf-8") as fh:
        mask = json.load(fh)
    if mask.get("schema_version") != 1:
        raise SystemExit(f"{LAND_MASK.name} schema_version {mask.get('schema_version')!r} is not 1")
    ring = mask["ring"]
    if len(ring) < 1000:
        raise SystemExit(f"{LAND_MASK.name} holds {len(ring)} vertices, which is not a coastline")
    if mask.get("tolerance_degrees") != LAND_MASK_TOLERANCE_DEGREES:
        raise SystemExit(
            f"{LAND_MASK.name} was built at {mask.get('tolerance_degrees')!r} degrees and this samples "
            f"a segment for {LAND_MASK_TOLERANCE_DEGREES}; the walk would step coarser than the coast"
        )
    return {"ring": ring, "window": mask["window"]}


def point_over_land(lon: float, lat: float, mask) -> bool:
    """Whether a position is on the North American mainland.

    Outside the mask's window this answers False. Nothing asks it to: the walk
    below stops at the first fix over water, so it never leaves the coast the
    storm came ashore on.
    """
    lon_min, lat_min, lon_max, lat_max = mask["window"]
    if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
        return False
    return point_in_ring(lon, lat, mask["ring"])


def landfall_crossing(track, index, mask):
    """Where the storm came ashore, for a fix it is still ashore from.

    Walks back while the fixes read as land; the last fix over water before them
    brackets the crossing. Returns None when the track begins on land, because
    then there is no crossing in the record to find and nothing can be concluded
    from its absence.

    The bracketing segment can meet the coast more than once, and the landfall
    is the first of those, not whichever one a bisection converges on. Danielle
    1980's segment crosses three times: ashore near Galveston, back out over the
    bay, and ashore again on its far side 16 km further west, which is the one
    bisection alone reported. So walk the segment at a step finer than the
    mask's own tolerance, take the first water-to-land step, and bisect in it.
    """
    if not point_over_land(track[index]["lon"], track[index]["lat"], mask):
        return None
    at = index
    while at > 0 and point_over_land(track[at]["lon"], track[at]["lat"], mask):
        at -= 1
    if point_over_land(track[at]["lon"], track[at]["lat"], mask):
        return None
    wet, dry = track[at], track[at + 1]
    span = math.hypot(dry["lon"] - wet["lon"], dry["lat"] - wet["lat"])
    steps = min(4000, max(64, int(span / (LAND_MASK_TOLERANCE_DEGREES / 2)) + 1))

    def at_fraction(fraction):
        return (
            wet["lon"] + (dry["lon"] - wet["lon"]) * fraction,
            wet["lat"] + (dry["lat"] - wet["lat"]) * fraction,
        )

    low, high = None, None
    for step in range(1, steps + 1):
        fraction = step / steps
        lon, lat = at_fraction(fraction)
        if point_over_land(lon, lat, mask):
            low, high = (step - 1) / steps, fraction
            break
    if high is None:
        # Every sample read as water although the far endpoint is land, so the
        # crossing sits inside the final step.
        low, high = (steps - 1) / steps, 1.0
    for _ in range(24):
        mid = (low + high) / 2
        lon, lat = at_fraction(mid)
        if point_over_land(lon, lat, mask):
            high = mid
        else:
            low = mid
    lon, lat = at_fraction(high)
    return {"index": at + 1, "fraction": high, "lon": lon, "lat": lat}


def interpolate_time(start_iso: str, end_iso: str, fraction: float) -> str:
    """The moment a fraction of the way between two track fixes, to the second."""
    start = datetime.strptime(start_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    end = datetime.strptime(end_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    moment = start + (end - start) * fraction
    return moment.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def crossing_is_outside_the_us(lon: float, lat: float, states) -> bool:
    """Whether a water-to-land crossing is too far from the US to be its landfall.

    `nearest_state` already measures this; its `max_deg` is a kilometre cutoff
    divided by the length of a degree, and it returns no state when nothing is
    inside that radius.
    """
    name, _ = nearest_state(lon, lat, states, max_deg=MAX_FOREIGN_CROSSING_KM / KM_PER_DEGREE)
    return name is None


def load_mexico_first_storms():
    """Storms AOML records as having come ashore in Mexico rather than Texas.

    AOML's own footnote, in data/aoml-us-landfalls.html: "# - Indicates that
    hurricane made landfall first over Mexico, but caused hurricane winds in
    Texas."  So the marker is about Texas by definition, and the check below
    fails rather than guessing if that ever stops being true of the rows.

    This is knowledge no geometry here can reach.  HURDAT2 puts Beulah's 1967
    landfall at 25.9N, which is 0.05 degrees south of the mouth of the Rio
    Grande, and the 1886 storm carries no landfall record at all.
    """
    with AOML_LANDFALLS.open("r", encoding="utf-8") as fh:
        table = json.load(fh)
    storm_ids = set()
    for record in table["records"]:
        if "#" not in record.get("markers", []):
            continue
        states = ",".join(record.get("states_affected") or [])
        if "TX" not in states:
            raise SystemExit(
                f"AOML marks {record['storm_id']} as a Mexico landfall but names {states!r}, not Texas; "
                "the marker's meaning has changed and load_mexico_first_storms needs rereading"
            )
        storm_ids.add(record["storm_id"])
    if not storm_ids:
        raise SystemExit("AOML lists no Mexico-first landfall, which it did for seven storms; the parse has moved")
    return storm_ids


def is_us_landfall_record(rec, states) -> bool:
    """Whether a HURDAT2 landfall record is a landfall on the United States.

    The same three tests the explicit-landfall path makes, in one place, so the
    inference can ask the question the other half of this file already answers.
    """
    if rec.get("rec") != "L":
        return False
    if not in_us_bbox(rec["lon"], rec["lat"]):
        return False
    if on_known_foreign_coast(rec["lon"], rec["lat"]):
        return False
    state, _ = nearest_state(rec["lon"], rec["lat"], states)
    return bool(state)


def on_known_foreign_coast(lon: float, lat: float) -> bool:
    """Exclude explicit-L fixes south of the Rio Grande mouth in Tamaulipas.

    Rows there fall within the generic 0.5-degree coastline tolerance but are
    geographically south of Texas.

    The longitude window is the point of this, and it used to be missing: an
    open-ended ``lon <= -96.8`` is everything west of the western Gulf, which
    includes Hawaii.  So Iselle's 2014 landfall record at 19.2N 155.4W, on the
    Big Island, was thrown out with Tamaulipas, and the atlas only had that
    landfall at all because the inference put an interpolated one back.  Every
    Tamaulipas row this is for sits between 97.0W and 97.8W.
    """
    return -98.5 <= lon <= -96.8 and lat < 25.84


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


def parse_track_time(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * EARTH_R_KM * math.asin(min(1, math.sqrt(a)))


def compute_track_length_km(track) -> float:
    points = [
        rec for rec in track
        if isinstance(rec.get("lat"), (int, float)) and isinstance(rec.get("lon"), (int, float))
    ]
    total = 0.0
    for idx in range(1, len(points)):
        a = points[idx - 1]
        b = points[idx]
        total += haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])
    return total


def compute_translation_mean_kmh(track):
    weighted_sum = 0.0
    total_hours = 0.0
    for idx in range(1, len(track)):
        a = track[idx - 1]
        b = track[idx]
        if a.get("lat") is None or a.get("lon") is None or b.get("lat") is None or b.get("lon") is None:
            continue
        t0 = parse_track_time(a.get("t"))
        t1 = parse_track_time(b.get("t"))
        if not t0 or not t1:
            continue
        hours = (t1 - t0).total_seconds() / 3600
        if hours <= 0 or hours > 12.5:
            continue
        kmh = haversine_km(a["lat"], a["lon"], b["lat"], b["lon"]) / hours
        weighted_sum += kmh * hours
        total_hours += hours
    return weighted_sum / total_hours if total_hours else None


def compute_ace(track) -> float:
    ace = 0.0
    for rec in track:
        wind = rec.get("wind")
        if wind is None or wind < TS_THRESHOLD_KT:
            continue
        t = parse_track_time(rec.get("t"))
        if not t or t.hour % 6 != 0 or t.minute != 0:
            continue
        ace += (wind * wind) / 10000
    return ace


def compute_ri_delta(track) -> int:
    best = 0
    for idx, start in enumerate(track):
        w0 = start.get("wind")
        if w0 is None:
            continue
        t0 = parse_track_time(start.get("t"))
        if not t0:
            continue
        for end in track[idx + 1:]:
            w1 = end.get("wind")
            if w1 is None:
                continue
            t1 = parse_track_time(end.get("t"))
            if not t1:
                continue
            hours = (t1 - t0).total_seconds() / 3600
            if hours > RI_WINDOW_HOURS + 0.5:
                break
            if hours < RI_WINDOW_HOURS - 0.5:
                continue
            delta = w1 - w0
            if delta >= RI_THRESHOLD_KT:
                best = max(best, delta)
    return best


def find_peak_wind_index(track):
    best_idx = None
    best_wind = -math.inf
    for idx, rec in enumerate(track):
        wind = rec.get("wind")
        if wind is None:
            continue
        if wind > best_wind:
            best_wind = wind
            best_idx = idx
    return best_idx


def compute_decay_rate(storm_record) -> float:
    track = storm_record.get("track") or []
    peak_idx = find_peak_wind_index(track)
    if peak_idx is None or peak_idx >= len(track):
        return 0.0
    peak_time = parse_track_time(track[peak_idx].get("t"))
    if not peak_time:
        return 0.0
    peak_wind = storm_record.get("peak_wind_kt") or track[peak_idx].get("wind") or 0
    final_wind = peak_wind
    final_time = peak_time
    for rec in track[peak_idx + 1:]:
        if rec.get("wind") is None:
            continue
        t = parse_track_time(rec.get("t"))
        if not t:
            continue
        final_wind = rec["wind"]
        final_time = t
    days = (final_time - peak_time).total_seconds() / (24 * 3600)
    return (peak_wind - final_wind) / (days + 1)


def genesis_month(track) -> int:
    for rec in track:
        t = parse_track_time(rec.get("t"))
        if t:
            return t.month
    return 8


def normalize(value, min_value, max_value) -> float:
    if max_value == min_value:
        return 0.0
    return max(0.0, min(1.0, (value - min_value) / (max_value - min_value)))


def compute_similarity_vector(storm_record) -> list[float]:
    track = storm_record.get("track") or []
    s = SIMILARITY_VECTOR_STATS
    vector = [
        normalize(storm_record.get("peak_wind_kt") or 50, s["wind_min"], s["wind_max"]),
        normalize(len(storm_record.get("us_landfalls") or []), s["landfalls_min"], s["landfalls_max"]),
        normalize(compute_track_length_km(track), s["track_km_min"], s["track_km_max"]),
        normalize(compute_translation_mean_kmh(track) or 15, s["speed_min"], s["speed_max"]),
        normalize(compute_ri_delta(track), s["ri_min"], s["ri_max"]),
        normalize(compute_ace(track), s["ace_min"], s["ace_max"]),
        normalize(compute_decay_rate(storm_record), s["decay_min"], s["decay_max"]),
        (genesis_month(track) - 1) / 11,
    ]
    return [round(value, 6) for value in vector]


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


def infer_landfall_candidates(track, states, basin, mask):
    """Find TS+ water-to-land candidates without promoting HURDAT2 C records.

    HURDAT2's ``C`` identifier means closest approach to a coast without a
    subsequent center landfall.  Treat those records as an explicit negative
    signal for the heuristic: neither a C endpoint nor a segment touching one
    may become an inferred landfall.
    """
    if not track:
        return []

    EP_COASTAL_OK = {
        "Hawaii", "California", "Oregon", "Washington", "Alaska",
    }
    allowed_states = EP_COASTAL_OK if basin == "EP" else None
    candidates = []

    def allowed(state):
        return state and (allowed_states is None or state in allowed_states)

    def append_candidate(record, state, *, lat=None, lon=None, wind=None, pres=None, status=None,
                         crossing=None, before=None, after=None):
        if not allowed(state):
            return
        # A landfall belongs where the centre crossed the coast. Usually that is
        # on the same segment the state polygon notices it on, and the record is
        # already within one fix of it. Where the two coastlines disagree it can
        # be a whole fix earlier: Danielle 1980 came ashore near Galveston at
        # 00Z and the Census polygons first place it in Texas at 06Z, 140 km
        # further west. Only that case moves, because only that case is wrong by
        # more than the coastlines differ by.
        if crossing is not None and before is not None and after is not None and crossing["index"] < i:
            wet = track[crossing["index"] - 1]
            dry = track[crossing["index"]]
            fraction = crossing["fraction"]
            lat = round(crossing["lat"], 2)
            lon = round(crossing["lon"], 2)
            w_a = wet["wind"] or 0
            w_b = dry["wind"] or 0
            p_a = wet["pres"] or 0
            p_b = dry["pres"] or 0
            wind = int(round(w_a + (w_b - w_a) * fraction)) if (w_a or w_b) else None
            pres = int(round(p_a + (p_b - p_a) * fraction)) if (p_a or p_b) else None
            status = wet["status"] if w_a >= w_b else dry["status"]
            # The position is interpolated, so the moment has to be too. Copying
            # the later fix's stamp put Danielle three minutes out, and would put
            # a crossing at a tenth of a segment nearly six hours out.
            record = dict(dry, t=interpolate_time(wet["t"], dry["t"], fraction))
        wind = record["wind"] if wind is None else wind
        pres = record["pres"] if pres is None else pres
        status = record["status"] if status is None else status
        candidates.append({
            "t": record["t"],
            "lat": record["lat"] if lat is None else lat,
            "lon": record["lon"] if lon is None else lon,
            "wind": wind,
            "pres": pres,
            "status": status,
            "category": saffir_simpson(wind or 0),
            "state": state,
            "inferred": True,
        })

    first = track[0]
    prev_state = None
    if first.get("rec") != "C":
        prev_state = state_at_point(first["lon"], first["lat"], states)
        if prev_state and first["status"] in ("HU", "TS", "SS"):
            append_candidate(first, prev_state)

    for i in range(1, len(track)):
        a = track[i - 1]
        b = track[i]
        here_state = state_at_point(b["lon"], b["lat"], states)

        # A C point is a closest-approach declaration, not a landfall.  Skip
        # both adjacent segments so interpolation cannot turn it into one.
        if a.get("rec") == "C" or b.get("rec") == "C":
            prev_state = here_state
            continue

        # A centre that came ashore somewhere else is already on land, and it
        # cannot come ashore again without going back to sea.  `prev_state`
        # only asks whether the previous fix was inside a US state, and Mexico
        # is not one, so a storm that came ashore in Tamaulipas and carried on
        # north across the Rio Grande read as arriving from the Gulf.  Hermine
        # 2010 is the clearest: its one landfall record is at 25.3N 97.4W, in
        # Tamaulipas, and the next fix four hours later is inland Texas.
        #
        # Only the fix immediately before counts.  Reaching further back would
        # catch Allen 1980, which came ashore on the Yucatan days earlier, went
        # back over the Gulf and then made a real Texas landfall.
        came_ashore_abroad = a.get("rec") == "L" and not is_us_landfall_record(a, states)

        # Direct entry on a synoptic point.
        if here_state and not prev_state and not came_ashore_abroad and b["status"] in ("HU", "TS", "SS"):
            crossing = landfall_crossing(track, i, mask)
            if crossing is None:
                # The track begins on land, so the record holds no crossing to
                # judge. Nothing can be concluded from its absence, and the
                # candidate stands as it did before the mask existed.
                append_candidate(b, here_state)
            elif not crossing_is_outside_the_us(crossing["lon"], crossing["lat"], states):
                append_candidate(b, here_state, crossing=crossing, before=a, after=b)
        # Mid-segment crossing: both endpoints offshore but segment grazes land.
        elif not here_state and not prev_state and not came_ashore_abroad and b["status"] in ("HU", "TS", "SS"):
            for k in range(1, 10):
                fraction = k / 10.0
                mid_lon = a["lon"] + (b["lon"] - a["lon"]) * fraction
                mid_lat = a["lat"] + (b["lat"] - a["lat"]) * fraction
                mid_state = state_at_point(mid_lon, mid_lat, states)
                if not allowed(mid_state):
                    continue
                # Interpolate wind/pres linearly.
                w_a = a["wind"] or 0
                w_b = b["wind"] or 0
                p_a = a["pres"] or 0
                p_b = b["pres"] or 0
                wind = int(round(w_a + (w_b - w_a) * fraction)) if (w_a or w_b) else None
                pres = int(round(p_a + (p_b - p_a) * fraction)) if (p_a or p_b) else None
                # Pick the higher-intensity status.
                status = a["status"] if w_a >= w_b else b["status"]
                crossing = landfall_crossing(track, i, mask)
                if crossing is not None and crossing_is_outside_the_us(crossing["lon"], crossing["lat"], states):
                    break
                # Position, wind and pressure are all interpolated to `fraction`,
                # so the moment has to be as well. Copying b's stamp put a graze
                # a tenth of the way along a six-hourly segment 5 h 24 min late.
                append_candidate(
                    dict(b, t=interpolate_time(a["t"], b["t"], fraction)),
                    mid_state,
                    lat=round(mid_lat, 2),
                    lon=round(mid_lon, 2),
                    wind=wind,
                    pres=pres,
                    status=status,
                )
                break
        prev_state = here_state

    return candidates


def parse_args() -> tuple[str, str]:
    parser = argparse.ArgumentParser(description="Build deterministic HurricaneMap HURDAT2 data artifacts.")
    parser.add_argument(
        "--generated-at",
        default=os.environ.get("HURRICANEMAP_GENERATED_AT"),
        help="explicit UTC generation timestamp, for example 2026-08-02T00:00:00Z",
    )
    parser.add_argument(
        "--source-commit",
        default=os.environ.get("HURRICANEMAP_SOURCE_COMMIT"),
        help="40-character git revision; defaults to the current HEAD",
    )
    args = parser.parse_args()
    try:
        generated_at = normalize_generated_at(args.generated_at)
        source_commit = resolve_source_commit(args.source_commit)
    except (RuntimeError, ValueError) as exc:
        parser.error(str(exc))
    return generated_at, source_commit


def main():
    generated_at, source_commit = parse_args()
    source_manifest = load_source_manifest()
    print("Loading state polygons...", file=sys.stderr)
    states = load_states()
    print(f"Loaded {len(states)} state/territory polygons.", file=sys.stderr)
    land_mask = load_land_mask()
    print(f"Land mask: {len(land_mask['ring'])} coastline vertices.", file=sys.stderr)
    mexico_first_storms = load_mexico_first_storms()
    print(f"AOML records {len(mexico_first_storms)} storms as coming ashore in Mexico before Texas.", file=sys.stderr)

    storms_with_us_landfall = []
    landfall_events = []  # flat list, one per US landfall record
    source_summaries = []

    for src_path, basin, source_id in (
        (ATL_FILE, "AL", "hurdat2_atlantic"),
        (EPAC_FILE, "EP", "hurdat2_eastern_pacific"),
    ):
        source_summary = create_source_summary(
            src_path,
            basin,
            source_id,
            source_manifest[src_path.relative_to(ROOT).as_posix()],
        )
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
                if on_known_foreign_coast(rec["lon"], rec["lat"]):
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

            if storm["id"] in mexico_first_storms:
                us_landfalls = [lf for lf in us_landfalls if lf["state"] != "Texas"]

            if not us_landfalls:
                us_landfalls = infer_landfall_candidates(storm["track"], states, storm["basin"], land_mask)
                if storm["id"] in mexico_first_storms:
                    us_landfalls = [lf for lf in us_landfalls if lf["state"] != "Texas"]

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
            max_landfall_cat = max(
                (lf["category"] for lf in us_landfalls),
                key=category_strength,
            )
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
            storm_record["similarity_vector"] = compute_similarity_vector(storm_record)
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
                    "inferred": lf.get("inferred", False),
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

    OUT_LANDFALLS.write_text(
        json.dumps(landfall_events, separators=(",", ":")),
        encoding="utf-8",
        newline="\n",
    )
    storms_json = json.dumps(storms_with_us_landfall, separators=(",", ":")).encode("utf-8")
    OUT_STORMS.write_bytes(storms_json)
    with OUT_STORMS_GZ.open("wb") as raw_gzip:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_gzip, mtime=0) as compressed:
            compressed.write(storms_json)
    OUT_STATS.write_text(json.dumps(stats, indent=2), encoding="utf-8", newline="\n")
    metadata = build_metadata(
        source_summaries,
        stats,
        {
            "landfalls": OUT_LANDFALLS,
            "storms": OUT_STORMS,
            "storms_gzip": OUT_STORMS_GZ,
            "stats": OUT_STATS,
        },
        generated_at,
        source_commit,
    )
    # The file is UTF-8 and one label carries an n-tilde. Escaping it into a
    # backslash-u sequence parses the same and reads worse, and the committed
    # file has always had the character itself, so the default here was one
    # more way a rerun rewrote a file nobody had changed.
    OUT_METADATA.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    sz = lambda p: f"{p.stat().st_size / 1024:.1f} KB"
    print(f"Wrote {OUT_LANDFALLS.name} ({sz(OUT_LANDFALLS)})", file=sys.stderr)
    print(f"Wrote {OUT_STORMS.name} ({sz(OUT_STORMS)})", file=sys.stderr)
    print(f"Wrote {OUT_STORMS_GZ.name} ({sz(OUT_STORMS_GZ)})", file=sys.stderr)
    print(f"Wrote {OUT_STATS.name} ({sz(OUT_STATS)})", file=sys.stderr)
    print(f"Wrote {OUT_METADATA.name} ({sz(OUT_METADATA)})", file=sys.stderr)


if __name__ == "__main__":
    main()
