"""Build per-storm tornado/hail aggregates from NOAA/NCEI Storm Events CSVs.

The output is intentionally compact: it stores only counts and a few example
events for each U.S.-landfalling HURDAT2 storm, not the full source rows.
"""

from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / ".tmp-stormevents"
STORMS_PATH = DATA / "storms.json"
OUT_PATH = DATA / "storm-events.json"

BULK_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
EVENT_TYPES = {"Tornado", "Hail"}
WINDOW_BEFORE_HOURS = 24
WINDOW_AFTER_HOURS = 48
SCHEMA_VERSION = 1


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso_z(value):
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def storm_year_range(start, end):
    for year in range(start.year, end.year + 1):
        yield year


def load_storms():
    return json.loads(STORMS_PATH.read_text(encoding="utf-8"))


def state_key(value):
    return str(value or "").strip().upper()


def discover_detail_files():
    with urlopen(BULK_URL, timeout=60) as response:
        html = response.read().decode("utf-8", errors="replace")
    return discover_detail_files_from_html(html)


def discover_detail_files_from_html(html):
    files = {}
    revisions = {}
    pattern = r'(StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d+)\.csv\.gz)'
    for filename, year_text, revision_text in re.findall(pattern, html):
        year = int(year_text)
        revision = int(revision_text)
        if revision > revisions.get(year, -1):
            revisions[year] = revision
            files[year] = filename
    return files


def download_year_file(year, filename):
    CACHE.mkdir(exist_ok=True)
    target = CACHE / filename
    if target.exists() and target.stat().st_size > 0:
        return target
    url = BULK_URL + filename
    print(f"Downloading {filename}...", file=sys.stderr)
    with urlopen(url, timeout=120) as response:
        target.write_bytes(response.read())
    return target


def build_windows(storms):
    by_year_state = defaultdict(lambda: defaultdict(list))
    for storm in storms:
        if storm.get("year", 0) < 1950:
            continue
        for landfall in storm.get("us_landfalls") or []:
            if not landfall.get("state") or not landfall.get("t"):
                continue
            landfall_time = parse_iso_z(landfall["t"])
            start = landfall_time - timedelta(hours=WINDOW_BEFORE_HOURS)
            end = landfall_time + timedelta(hours=WINDOW_AFTER_HOURS)
            window = {
                "storm_id": storm["id"],
                "name": storm.get("name"),
                "year": storm.get("year"),
                "state": landfall["state"],
                "state_key": state_key(landfall["state"]),
                "start": start,
                "end": end,
            }
            for year in storm_year_range(start, end):
                by_year_state[year][window["state_key"]].append(window)
    return by_year_state


def parse_timezone_offset(value):
    match = re.search(r"([+-]\d+)", str(value or ""))
    return int(match.group(1)) if match else 0


def parse_event_time(row):
    # One malformed source row must not raise mid-run and discard hours of
    # accumulated download work — skip it (callers treat None as skip).
    try:
        yearmonth = str(row.get("BEGIN_YEARMONTH") or "")
        if len(yearmonth) != 6:
            return None
        begin_day = int(row.get("BEGIN_DAY") or 1)
        begin_time = str(row.get("BEGIN_TIME") or "0").zfill(4)
        year = int(yearmonth[:4])
        month = int(yearmonth[4:])
        hour = int(begin_time[:-2] or "0")
        minute = int(begin_time[-2:])
        offset = parse_timezone_offset(row.get("CZ_TIMEZONE"))
        local_tz = timezone(timedelta(hours=offset))
        return datetime(year, month, begin_day, hour, minute, tzinfo=local_tz).astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        print(f"  skipping malformed event row: {row.get('EVENT_ID') or row.get('BEGIN_YEARMONTH')!r}", file=sys.stderr)
        return None


def aggregate_event(record, row, event_time, state_name):
    event_type = row.get("EVENT_TYPE")
    bucket = "tornado" if event_type == "Tornado" else "hail"
    record[f"{bucket}_count"] += 1
    state_counts = record["state_counts"].setdefault(state_name, {"tornado": 0, "hail": 0})
    state_counts[bucket] += 1
    record["states"].add(state_name)

    if event_type == "Hail":
        try:
            magnitude = float(row.get("MAGNITUDE") or 0)
            record["max_hail_in"] = max(record["max_hail_in"] or 0, magnitude)
        except ValueError:
            pass
    elif event_type == "Tornado":
        scale = row.get("TOR_F_SCALE") or ""
        if scale:
            record["tornado_scales"].add(scale)

    if len(record["sample_events"]) < 6:
        record["sample_events"].append({
            "event_id": row.get("EVENT_ID"),
            "type": event_type,
            "state": state_name,
            "county": row.get("CZ_NAME"),
            "begin_utc": event_time.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "magnitude": row.get("MAGNITUDE") or None,
            "tor_f_scale": row.get("TOR_F_SCALE") or None,
        })


def empty_record(storm_id):
    return {
        "storm_id": storm_id,
        "tornado_count": 0,
        "hail_count": 0,
        "states": set(),
        "state_counts": {},
        "max_hail_in": None,
        "tornado_scales": set(),
        "sample_events": [],
    }


def finalize_record(record):
    scales = sorted(record["tornado_scales"], key=tornado_scale_rank)
    out = {
        "tornado_count": record["tornado_count"],
        "hail_count": record["hail_count"],
        "states": sorted(record["states"]),
        "state_counts": dict(sorted(record["state_counts"].items())),
        "sample_events": record["sample_events"],
    }
    if record["max_hail_in"]:
        out["max_hail_in"] = round(record["max_hail_in"], 2)
    if scales:
        out["strongest_tornado_scale"] = scales[-1]
    return out


def tornado_scale_rank(scale):
    match = re.search(r"(\d)", scale or "")
    return int(match.group(1)) if match else -1


def main():
    storms = load_storms()
    windows_by_year_state = build_windows(storms)
    needed_years = sorted(windows_by_year_state)
    detail_files = discover_detail_files()

    missing = [year for year in needed_years if year not in detail_files]
    if missing:
        raise SystemExit(f"Missing Storm Events detail files for years: {missing}")

    records = defaultdict(lambda: None)
    seen = set()
    files_used = []
    rows_scanned = 0
    rows_matched = 0

    for year in needed_years:
        path = download_year_file(year, detail_files[year])
        files_used.append(detail_files[year])
        with gzip.open(path, "rt", newline="", encoding="utf-8", errors="replace") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                rows_scanned += 1
                if row.get("EVENT_TYPE") not in EVENT_TYPES:
                    continue
                event_time = parse_event_time(row)
                if not event_time:
                    continue
                state_windows = windows_by_year_state.get(event_time.year, {}).get(state_key(row.get("STATE")), [])
                if not state_windows:
                    continue
                for window in state_windows:
                    if not (window["start"] <= event_time <= window["end"]):
                        continue
                    event_id = row.get("EVENT_ID")
                    dedupe_key = (window["storm_id"], event_id, row.get("EVENT_TYPE"))
                    if dedupe_key in seen:
                        continue
                    seen.add(dedupe_key)
                    if records[window["storm_id"]] is None:
                        records[window["storm_id"]] = empty_record(window["storm_id"])
                    aggregate_event(records[window["storm_id"]], row, event_time, window["state"])
                    rows_matched += 1

    storm_records = {
        storm_id: finalize_record(record)
        for storm_id, record in sorted(records.items())
        if record and (record["tornado_count"] or record["hail_count"])
    }

    output = {
        "schema_version": SCHEMA_VERSION,
        "generated_at_utc": utc_now(),
        "source": {
            "name": "NOAA/NCEI Storm Events Database bulk CSV",
            "base_url": BULK_URL,
            "files_used": files_used,
            "rows_scanned": rows_scanned,
            "rows_matched": rows_matched,
        },
        "methodology": {
            "event_types": sorted(EVENT_TYPES),
            "window_before_hours": WINDOW_BEFORE_HOURS,
            "window_after_hours": WINDOW_AFTER_HOURS,
            "match_rule": "Events are counted when their begin time falls in the same state from 24 hours before to 48 hours after a HURDAT2 U.S. landfall.",
            "time_zone_note": "Storm Events local times are converted to UTC using the row's CZ_TIMEZONE offset.",
        },
        "storms": storm_records,
    }

    OUT_PATH.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUT_PATH.relative_to(ROOT)} with {len(storm_records)} storm aggregates "
        f"from {rows_matched} matched events.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
