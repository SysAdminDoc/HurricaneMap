#!/usr/bin/env python3
"""Build the checked-in AOML continental U.S. landfall ground-truth artifact.

The AOML page is a human-oriented HTML table rather than an API.  This builder
keeps the exact source bytes beside the normalized JSON so a release can be
revalidated without network access.  Network access is only used with the
explicit ``--fetch`` flag.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SOURCE_URL = "https://www.aoml.noaa.gov/hrd/hurdat/UShurrs_detailed.html"
SOURCE_PATH = DATA / "aoml-us-landfalls.html"
OUTPUT_PATH = DATA / "aoml-landfalls.json"
ENCODING = "iso-8859-1"
MATCH_TIME_HOURS = 12
MATCH_DISTANCE_KM = 125
GROUND_TRUTH_START_YEAR = 1983
GROUND_TRUTH_END_YEAR = 1990
GROUND_TRUTH_MIN_CATEGORY = 1
NON_CONTINENTAL_STATES = {
    "Alaska",
    "American Samoa",
    "Guam",
    "Hawaii",
    "Northern Mariana Islands",
    "Puerto Rico",
    "U.S. Virgin Islands",
}


class TableParser(HTMLParser):
    """Collect table rows while tolerating the page's legacy omitted td tags."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def _finish_cell(self) -> None:
        if self._cell is None or self._row is None:
            return
        value = " ".join("".join(self._cell).replace("\xa0", " ").split())
        self._row.append(value)
        self._cell = None

    def _finish_row(self) -> None:
        self._finish_cell()
        if self._row is not None and self._row:
            self.rows.append(self._row)
        self._row = None

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: ANN001 - HTMLParser API
        tag = tag.lower()
        if tag == "tr":
            self._finish_row()
            self._row = []
        elif tag == "td":
            if self._row is None:
                return
            self._finish_cell()
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "td":
            self._finish_cell()
        elif tag == "tr":
            self._finish_row()

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def normalize_generated_at(value: str) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        raise ValueError("--generated-at is required; pass an explicit ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"--generated-at is not a valid ISO-8601 timestamp: {candidate}") from exc
    if parsed.tzinfo is None:
        raise ValueError("--generated-at must include a timezone, for example 2026-08-03T00:00:00Z")
    return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_source() -> bytes:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "HurricaneMap-build"})
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    SOURCE_PATH.write_bytes(raw)
    print(f"fetched {SOURCE_URL} ({len(raw):,} bytes)")
    return raw


def load_source(fetch: bool = False) -> bytes:
    if fetch:
        return fetch_source()
    if not SOURCE_PATH.is_file():
        raise FileNotFoundError(f"{SOURCE_PATH.relative_to(ROOT)} is missing; rerun with --fetch")
    return SOURCE_PATH.read_bytes()


def parse_number(value: str, *, integer: bool = False):
    text = value.strip().replace(",", "")
    if not text or text.upper() in {"---", "----", "N/A", "NA", "NONE", "-"}:
        return None
    try:
        number = float(text)
    except ValueError as exc:
        raise ValueError(f"invalid numeric value {value!r}") from exc
    if not math.isfinite(number):
        raise ValueError(f"invalid numeric value {value!r}")
    return int(number) if integer else number


def parse_pressure(value: str):
    text = value.strip()
    estimated = text.startswith("(") and text.endswith(")")
    if estimated:
        text = text[1:-1]
    return parse_number(text, integer=True), estimated


def parse_coordinate(value: str, suffixes: str) -> float:
    match = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)([NSEW])", value.strip().upper())
    if not match or match.group(2) not in suffixes:
        raise ValueError(f"invalid coordinate {value!r}")
    number = float(match.group(1))
    if match.group(2) in "SW":
        number = -number
    return number


def parse_category(value: str):
    text = value.strip().upper()
    if text in {"TS", "TROPICAL STORM"}:
        return -1
    if text in {"TD", "TROPICAL DEPRESSION"}:
        return 0
    return parse_number(text, integer=True)


def parse_source_date(value: str) -> tuple[datetime, list[str]]:
    match = re.fullmatch(r"(\d{1,2}/\d{1,2}/\d{4})\s*([\$#&%*]*)", value.strip())
    if not match:
        raise ValueError(f"invalid AOML date {value!r}")
    date = datetime.strptime(match.group(1), "%m/%d/%Y")
    markers = list(dict.fromkeys(match.group(2)))
    return date, markers


def normalize_name(value: str):
    text = html.unescape(value).strip().strip('"').strip()
    if text.upper() in {"", "---", "---------------", "NONE", "UNNAMED"}:
        return None
    return text


def source_metadata(text: str, raw: bytes) -> dict:
    coverage_match = re.search(r"(\d{4})-(\d{4}),\s*(\d{4})-(\d{4})", text)
    if not coverage_match:
        raise ValueError("AOML page did not declare its coverage ranges")
    revision_match = re.search(r"Revised in\s+([^<.]+)", text, flags=re.IGNORECASE)
    revision = " ".join((revision_match.group(1) if revision_match else "").split())
    if not revision:
        raise ValueError("AOML page did not declare a revision")
    month_match = re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})", revision, flags=re.IGNORECASE)
    if month_match:
        source_date = datetime.strptime(f"{month_match.group(1)} {month_match.group(2)}", "%B %Y").date().replace(day=1).isoformat()
    else:
        source_date = f"{datetime.now(timezone.utc).year:04d}-01-01"
    return {
        "url": SOURCE_URL,
        "local_path": SOURCE_PATH.relative_to(ROOT).as_posix(),
        "source_date": source_date,
        "revision": revision,
        "sha256": sha256_bytes(raw),
        "bytes": len(raw),
        "encoding": "ISO-8859-1",
        "coverage_year_ranges": [
            [int(coverage_match.group(1)), int(coverage_match.group(2))],
            [int(coverage_match.group(3)), int(coverage_match.group(4))],
        ],
    }


def parse_records(text: str) -> list[dict]:
    parser = TableParser()
    parser.feed(text)
    records = []
    for cells in parser.rows:
        if len(cells) != 13 or not re.fullmatch(r"\d+", cells[0]):
            continue
        if not re.search(r"\d{1,2}/\d{1,2}/\d{4}", cells[1]):
            continue
        storm_number = int(cells[0])
        date, markers = parse_source_date(cells[1])
        time_match = re.fullmatch(r"(\d{2})(\d{2})Z", cells[2].strip().upper())
        if not time_match:
            raise ValueError(f"invalid AOML time {cells[2]!r} on {cells[1]!r}")
        timestamp = date.replace(
            hour=int(time_match.group(1)),
            minute=int(time_match.group(2)),
            tzinfo=timezone.utc,
        )
        lat = parse_coordinate(cells[3], "NS")
        lon = parse_coordinate(cells[4], "EW")
        max_wind = parse_number(cells[5], integer=True)
        category = parse_category(cells[6])
        central_pressure, central_pressure_estimated = parse_pressure(cells[8])
        states = [state.strip() for state in cells[11].split(",") if state.strip()]
        year = date.year
        storm_id = f"AL{storm_number:02d}{year}"
        timestamp_text = timestamp.isoformat().replace("+00:00", "Z")
        record_id = f"{storm_id}-{timestamp.strftime('%Y%m%d%H%M')}-{lat:.1f}-{lon:.1f}"
        records.append({
            "id": record_id,
            "storm_id": storm_id,
            "storm_number": storm_number,
            "name": normalize_name(cells[12]),
            "year": year,
            "t": timestamp_text,
            "lat": lat,
            "lon": lon,
            "max_wind_kt": max_wind,
            "category": category,
            "rmw_nm": parse_number(cells[7], integer=True),
            "central_pressure_mb": central_pressure,
            "central_pressure_estimated": central_pressure_estimated,
            "oci_mb": parse_number(cells[9], integer=True),
            "size_nm": parse_number(cells[10], integer=True),
            "states_raw": cells[11],
            "states_affected": states,
            "markers": markers,
            "direct_landfall": not any(marker in {"*", "#"} for marker in markers),
        })
    if not records:
        raise ValueError("AOML page yielded no detailed landfall rows")
    return records


def haversine_km(a: dict, b: dict) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
    d_lat = lat2 - lat1
    d_lon = lon2 - lon1
    term = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(term)))


def match_records(truth: list[dict], predictions: list[dict]) -> list[tuple[dict, dict]]:
    pairs = []
    for truth_record in truth:
        truth_time = datetime.fromisoformat(truth_record["t"].replace("Z", "+00:00"))
        for prediction in predictions:
            if prediction.get("storm_id") != truth_record.get("storm_id"):
                continue
            prediction_time = datetime.fromisoformat(prediction["t"].replace("Z", "+00:00"))
            time_hours = abs((prediction_time - truth_time).total_seconds()) / 3600
            distance_km = haversine_km(truth_record, prediction)
            if time_hours <= MATCH_TIME_HOURS and distance_km <= MATCH_DISTANCE_KM:
                pairs.append((time_hours, distance_km, truth_record, prediction))
    pairs.sort(key=lambda pair: (pair[0], pair[1], pair[2]["id"], pair[3].get("t", "")))
    matched_truth = set()
    matched_predictions = set()
    matches = []
    for _, _, truth_record, prediction in pairs:
        truth_id = truth_record["id"]
        prediction_id = (prediction.get("storm_id"), prediction.get("t"), prediction.get("lat"), prediction.get("lon"))
        if truth_id in matched_truth or prediction_id in matched_predictions:
            continue
        matched_truth.add(truth_id)
        matched_predictions.add(prediction_id)
        matches.append((truth_record, prediction))
    return matches


def ratio(numerator: int, denominator: int):
    return round(numerator / denominator, 6) if denominator else None


def build_validation(records: list[dict]) -> dict:
    try:
        landfalls = json.loads((DATA / "landfalls.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("data/landfalls.json is required before building AOML validation") from exc
    if not isinstance(landfalls, list):
        raise RuntimeError("data/landfalls.json must contain an array")

    in_scope = lambda row: GROUND_TRUTH_START_YEAR <= row.get("year", 0) <= GROUND_TRUTH_END_YEAR
    truth = [
        row for row in records
        if in_scope(row) and row["direct_landfall"] and (row["category"] or 0) >= GROUND_TRUTH_MIN_CATEGORY
    ]
    predictions = [
        row for row in landfalls
        if in_scope(row)
        and row.get("category", 0) >= GROUND_TRUTH_MIN_CATEGORY
        and row.get("state") not in NON_CONTINENTAL_STATES
    ]
    matches = match_records(truth, predictions)
    inferred = [row for row in landfalls if in_scope(row) and row.get("inferred") is True]
    inferred_hurricane = [row for row in inferred if row.get("category", 0) >= GROUND_TRUTH_MIN_CATEGORY and row.get("state") not in NON_CONTINENTAL_STATES]
    inferred_matches = match_records(truth, inferred_hurricane)

    return {
        "scope": {
            "start_year": GROUND_TRUTH_START_YEAR,
            "end_year": GROUND_TRUTH_END_YEAR,
            "geography": "continental U.S.",
            "minimum_category": GROUND_TRUTH_MIN_CATEGORY,
            "matching": {
                "storm_id": "exact",
                "time_window_hours": MATCH_TIME_HOURS,
                "distance_km": MATCH_DISTANCE_KM,
            },
        },
        "ground_truth": {
            "record_count": len(truth),
            "direct_landfall_count": len(truth),
        },
        "detected": {
            "record_count": len(predictions),
            "matched_count": len(matches),
            "precision": ratio(len(matches), len(predictions)),
            "recall": ratio(len(matches), len(truth)),
        },
        "inferred": {
            "candidate_count": len(inferred),
            "hurricane_strength_candidate_count": len(inferred_hurricane),
            "matched_count": len(inferred_matches),
            "precision": ratio(len(inferred_matches), len(inferred_hurricane)),
            "recall": ratio(len(inferred_matches), len(truth)),
            "scope_note": "AOML's 1983-1990 reference rows are hurricane-strength continental impacts; tropical-storm inferred candidates are reported but not scored as hurricane matches.",
        },
    }


def build_payload(raw: bytes, generated_at: str) -> dict:
    text = raw.decode(ENCODING)
    source = source_metadata(text, raw)
    records = parse_records(text)
    return {
        "schema_version": 1,
        "generated_at_utc": generated_at,
        "source": source,
        "methodology": {
            "description": "AOML detailed continental United States hurricane impact/landfall table normalized from its published HTML.",
            "marker_notes": {
                "$": "AOML marks the record low reliability.",
                "#": "Mexico landfall first; Texas hurricane-force winds affected the United States.",
                "&": "Direct landfall; strongest winds were offshore.",
                "%": "Maximum winds affected the coast before landfall.",
                "*": "Closest approach to the United States without a center landfall.",
            },
            "direct_landfall_rule": "Rows marked * or # are retained but excluded from direct-landfall ground-truth scoring.",
            "storm_id_rule": "AL plus the two-digit storm number and four-digit calendar year, matching HURDAT2 identifiers.",
        },
        "records": records,
        "validation": build_validation(records),
    }


def check_payload(payload: dict) -> None:
    raw = load_source()
    expected = build_payload(raw, payload.get("generated_at_utc", ""))
    for key in ("schema_version", "source", "methodology", "records", "validation"):
        if payload.get(key) != expected[key]:
            raise ValueError(f"{OUTPUT_PATH.relative_to(ROOT)} is stale in {key}; rebuild from the checked-in AOML source")
    if not payload.get("generated_at_utc"):
        raise ValueError("AOML artifact is missing generated_at_utc")


def format_metric(value, numerator: int, denominator: int) -> str:
    if value is None:
        return f"not-defined ({numerator} candidates)"
    return f"{value * 100:.1f}% ({numerator}/{denominator})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="download the AOML HTML source before building/checking")
    parser.add_argument("--check", action="store_true", help="verify the checked-in source and normalized JSON without writing")
    parser.add_argument("--generated-at", help="explicit UTC generation timestamp, for example 2026-08-03T00:00:00Z")
    args = parser.parse_args()

    if args.check:
        if args.fetch:
            fetch_source()
        payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        check_payload(payload)
        print(f"AOML source/artifact ok ({len(payload['records'])} rows, {payload['source']['revision']})")
    else:
        generated_at = normalize_generated_at(args.generated_at)
        raw = load_source(fetch=args.fetch)
        payload = build_payload(raw, generated_at)
        OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8", newline="\n")
        validation = payload["validation"]
        detected = validation["detected"]
        inferred = validation["inferred"]
        print(
            "AOML 1983-1990 ground-truth gate (continental, category >= 1): "
            f"precision={format_metric(detected['precision'], detected['matched_count'], detected['record_count'])}, "
            f"recall={format_metric(detected['recall'], detected['matched_count'], validation['ground_truth']['record_count'])}; "
            f"inferred hurricane candidates={inferred['hurricane_strength_candidate_count']}, "
            f"precision={format_metric(inferred['precision'], inferred['matched_count'], inferred['hurricane_strength_candidate_count'])}, "
            f"recall={format_metric(inferred['recall'], inferred['matched_count'], validation['ground_truth']['record_count'])}",
        )
        print(f"wrote {OUTPUT_PATH.relative_to(ROOT)} ({len(payload['records'])} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
