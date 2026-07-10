#!/usr/bin/env python3
"""Snapshot the NOAA CO-OPS water-level station list to data/tide-stations.json.

The mdapi payload is ~775 KB; the app only needs id/name/state/lat/lon
(~25 KB) to pick the nearest gauges for a storm's landfall. Station churn is
rare — re-run alongside the annual HURDAT2 refresh.

Source: https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels
"""

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels"
OUT = ROOT / "data" / "tide-stations.json"


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "HurricaneMap-build"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    stations = []
    for station in data.get("stations", []):
        try:
            stations.append({
                "id": str(station["id"]),
                "name": station.get("name", ""),
                "state": station.get("state", ""),
                "lat": round(float(station["lat"]), 4),
                "lon": round(float(station["lng"]), 4),
            })
        except (KeyError, TypeError, ValueError):
            continue
    stations.sort(key=lambda s: s["id"])
    OUT.write_text(json.dumps(stations, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.name}: {len(stations)} stations")


if __name__ == "__main__":
    main()
