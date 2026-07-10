#!/usr/bin/env python3
"""Build per-storm USGS high-water-mark files from the Short-Term Network API.

Observed peak-water elevations surveyed after flood events — the ground truth
to pair with the modeled SLOSH MOM overlay. Coverage is systematic from
~2005 (Katrina era) onward.

API: https://stn.wim.usgs.gov/STNServices/ (CORS *, but preprocessed here so
the layer works offline). Use GET only — HEAD requests 500.

Outputs:
  data/surge-obs/index.json          storm_id -> {event, count}
  data/surge-obs/<STORMID>.json      [[lat, lon, elev_ft, env], ...]
"""

import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "surge-obs"
BASE = "https://stn.wim.usgs.gov/STNServices"
YEAR_NAME_RE = re.compile(r"\b(19|20)\d{2}\b")


def get_json(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HurricaneMap-build"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.load(resp)
        except Exception as error:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} for {url}: {error}")
            time.sleep(3)


def load_storm_index():
    storms = json.loads((ROOT / "data" / "storms.json").read_text(encoding="utf-8"))
    index = {}
    for storm in storms:
        name = storm.get("name", "").upper()
        if not name or name == "UNNAMED":
            continue
        index[(name, int(storm["year"]))] = storm["id"]
    return index


def match_event(event_name, storm_index):
    """Match '2005 Katrina' / 'Hurricane Ian 2022'-style names to a storm id."""
    year_match = YEAR_NAME_RE.search(event_name or "")
    if not year_match:
        return None
    year = int(year_match.group(0))
    words = re.findall(r"[A-Za-z]+", event_name.upper())
    for word in words:
        storm_id = storm_index.get((word, year))
        if storm_id:
            return storm_id
    return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    storm_index = load_storm_index()
    events = get_json(f"{BASE}/Events.json")
    matched = []
    for event in events:
        storm_id = match_event(event.get("event_name", ""), storm_index)
        if storm_id:
            matched.append((event["event_id"], event["event_name"], storm_id))
    print(f"{len(matched)} STN events matched to landfalling storms")

    index = {}
    for event_id, event_name, storm_id in sorted(matched, key=lambda m: m[2]):
        try:
            hwms = get_json(f"{BASE}/Events/{event_id}/HWMs.json")
        except Exception as error:
            print(f"  SKIP {event_name}: {error}")
            continue
        points = []
        for hwm in hwms or []:
            lat = hwm.get("latitude_dd")
            lon = hwm.get("longitude_dd")
            elev = hwm.get("elev_ft")
            if lat is None or lon is None or elev is None:
                continue
            env = "R" if str(hwm.get("hwm_environment", "")).lower().startswith("r") else "C"
            points.append([round(float(lat), 5), round(float(lon), 5), round(float(elev), 2), env])
        if len(points) < 5:
            print(f"  skip {event_name} -> {storm_id}: only {len(points)} usable marks")
            continue
        # A storm can map to multiple STN events (rare) — merge.
        existing = []
        out_path = OUT_DIR / f"{storm_id}.json"
        if storm_id in index and out_path.exists():
            existing = json.loads(out_path.read_text(encoding="utf-8"))
        merged = existing + points
        out_path.write_text(json.dumps(merged, separators=(",", ":")) + "\n", encoding="utf-8")
        index[storm_id] = {
            "event": event_name if storm_id not in index else f"{index[storm_id]['event']}; {event_name}",
            "count": len(merged),
        }
        print(f"  {event_name} -> {storm_id}: {len(points)} marks")
        time.sleep(0.5)

    (OUT_DIR / "index.json").write_text(
        json.dumps(index, indent=1, sort_keys=True) + "\n", encoding="utf-8",
    )
    total = sum(entry["count"] for entry in index.values())
    print(f"wrote surge-obs for {len(index)} storms, {total} marks total")


if __name__ == "__main__":
    main()
