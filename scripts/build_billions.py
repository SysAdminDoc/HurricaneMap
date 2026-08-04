#!/usr/bin/env python3
"""Join NCEI Billion-Dollar Weather Disasters (Tropical Cyclone events) to
HURDAT2 storm IDs and emit data/billions.json.

The NCEI product was retired 2025-05-08 and is frozen at calendar year 2024,
so this is effectively a one-time build; re-run only if the archived CSV moves.

Source: https://www.ncei.noaa.gov/access/billions/events-US-1980-2024.csv
        (public domain, CORS-enabled, ~36 KB)

Matching: (normalized storm name, year) against storms.json, with begin/end
date overlap against the storm track as tiebreaker. Combined multi-storm rows
(" and " in the event name) are skipped with a warning — attribute manually.
"""

import csv
import io
import json
import re
import sys
import urllib.request
from datetime import date, timezone, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_URL = "https://www.ncei.noaa.gov/access/billions/events-US-1980-2024.csv"
CSV_CACHE = ROOT / "data" / "ncei-billions-1980-2024.csv"
OUT_PATH = ROOT / "data" / "billions.json"
RETIREMENT_CITATION = {
    "title": "Billion Dollar Weather and Climate Disasters",
    "date": "2025-05-08",
    "url": "https://www.nesdis.noaa.gov/about/documents-reports/notice-of-changes/2025-notice-of-changes/billion-dollar-weather-and-climate-disasters",
}


def fetch_csv() -> str:
    if CSV_CACHE.exists():
        print(f"using cached {CSV_CACHE.name}")
        return CSV_CACHE.read_text(encoding="utf-8")
    print(f"downloading {CSV_URL}")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "HurricaneMap-build"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    CSV_CACHE.write_text(text, encoding="utf-8")
    return text


def parse_events(text: str):
    """Yield tropical-cyclone rows from the NCEI CSV (2 comment lines, then header)."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("Name,"))
    reader = csv.DictReader(io.StringIO("\n".join(lines[start:])))
    for row in reader:
        if (row.get("Disaster") or "").strip() != "Tropical Cyclone":
            continue
        yield row


def parse_yyyymmdd(value: str) -> date:
    value = (value or "").strip()
    return date(int(value[0:4]), int(value[4:6]), int(value[6:8]))


NAME_RE = re.compile(r"^(?:Hurricane|Tropical Storm|Typhoon)\s+(?P<name>[A-Za-z]+)", re.IGNORECASE)


def extract_storm_name(event_name: str):
    if " and " in event_name.lower():
        return None  # combined multi-storm entry — manual attribution only
    m = NAME_RE.match(event_name.strip())
    return m.group("name").upper() if m else None


def load_storms():
    storms = json.loads((ROOT / "data" / "storms.json").read_text(encoding="utf-8"))
    return storms if isinstance(storms, list) else storms.get("storms", [])


def storm_dates(storm):
    track = storm.get("track") or []
    if not track:
        return None, None
    def to_date(pt):
        return datetime.fromisoformat(pt["t"].replace("Z", "+00:00")).date()
    return to_date(track[0]), to_date(track[-1])


def overlaps(a_start, a_end, b_start, b_end, slack_days=7):
    if not all([a_start, a_end, b_start, b_end]):
        return True  # can't disprove — accept the name/year match
    from datetime import timedelta
    pad = timedelta(days=slack_days)
    return a_start - pad <= b_end and b_start - pad <= a_end


def main():
    text = fetch_csv()
    storms = load_storms()
    by_name_year = {}
    for storm in storms:
        key = (storm.get("name", "").upper(), int(storm.get("year", 0)))
        by_name_year.setdefault(key, []).append(storm)

    out = {}
    skipped = []
    for row in parse_events(text):
        event_name = (row.get("Name") or "").strip()
        begin = parse_yyyymmdd(row["Begin Date"])
        end = parse_yyyymmdd(row["End Date"])
        name = extract_storm_name(event_name)
        if not name:
            skipped.append(event_name)
            continue
        candidates = by_name_year.get((name, begin.year), []) + (
            by_name_year.get((name, end.year), []) if end.year != begin.year else []
        )
        matched = None
        for storm in candidates:
            s_start, s_end = storm_dates(storm)
            if overlaps(begin, end, s_start, s_end):
                matched = storm
                break
        # The frozen NCEI CSV has month-level date errors on a few rows
        # (e.g. Frances 1998, Lili 2002). Name+year is unique in practice,
        # so fall back to it when it identifies exactly one storm.
        if not matched and len({s["id"] for s in candidates}) == 1:
            matched = candidates[0]
            print(f"  date-mismatch fallback: {event_name} -> {matched['id']} (NCEI dates {begin}..{end})")
        if not matched:
            skipped.append(event_name)
            continue
        out[matched["id"]] = {
            "event": event_name,
            "begin": begin.isoformat(),
            "end": end.isoformat(),
            "cost_cpi_musd": float(row["CPI-Adjusted Cost"]),
            "cost_nominal_musd": float(row["Unadjusted Cost"]),
            "deaths": int(float(row["Deaths"])),
        }

    out["_meta"] = {
        "dataset_id": "ncei-billions",
        "status": "closed",
        "end_date": "2024-12-31",
        "retirement_citation": RETIREMENT_CITATION,
        "source": CSV_URL,
        "product": "NOAA NCEI U.S. Billion-Dollar Weather and Climate Disasters",
        "note": "Product retired 2025-05-08; data frozen at calendar year 2024. Costs are millions USD, CPI-adjusted to 2024.",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "matched_events": len(out),
        "skipped_events": skipped,
    }
    OUT_PATH.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH.name}: {len(out) - 1} matched storms, {len(skipped)} skipped")
    for name in skipped:
        print(f"  skipped: {name}")


if __name__ == "__main__":
    sys.exit(main())
