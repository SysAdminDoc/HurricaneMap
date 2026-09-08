"""Offline contract tests for the AOML parser and HURDAT2 C guard."""

from __future__ import annotations

import json

from build_aoml_landfalls import OUTPUT_PATH, SOURCE_PATH, check_payload, parse_records
from preprocess_hurdat2 import infer_landfall_candidates


payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
raw = SOURCE_PATH.read_bytes()
records = parse_records(raw.decode("iso-8859-1"))
check_payload(payload)

assert len(records) == len(payload["records"]) >= 300
assert len({record["id"] for record in records}) == len(records)
alicia = next(record for record in records if record["storm_id"] == "AL031983")
assert (alicia["name"], alicia["t"], alicia["category"], alicia["states_affected"]) == (
    "Alicia", "1983-08-18T07:00:00Z", 3, ["CTX3"]
)
closest = next(record for record in records if "*" in record["markers"])
assert closest["direct_landfall"] is False
# Scored over every year the table gives a position for, which is the whole
# published record. It used to be 1983-1990: sixteen rows at a perfect score,
# which said nothing about whether the atlas is right.
validation = payload["validation"]
scope = validation["scope"]
assert scope["start_year"] == 1851 and scope["end_year"] == 2024, scope
assert scope["minimum_category"] == 1

detected = validation["detected"]
assert detected["record_count"] == 362, detected
assert validation["ground_truth"]["record_count"] == 352, validation["ground_truth"]
assert detected["matched_count"] == 337, detected

# Floors, not equalities: a HURDAT2 refresh moves the counts, and this has to
# fail when the atlas gets worse rather than whenever it changes at all.
assert detected["recall"] >= 0.95, f"recall fell to {detected['recall']}"
assert detected["precision"] >= 0.92, f"precision fell to {detected['precision']}"

per_decade = validation["per_decade"]
assert len(per_decade) == 18, len(per_decade)
assert all(row["recall"] is None or row["recall"] >= 0.8 for row in per_decade), [
    (row["decade"], row["recall"]) for row in per_decade if row["recall"] is not None and row["recall"] < 0.8
]

# Every unmatched reference row is named, so a person can go and look at it.
missed = validation["missed_reference_rows"]
assert len(missed) == validation["ground_truth"]["record_count"] - detected["matched_count"] == 15, len(missed)
assert all(row["storm_id"] and row["year"] and row["t"] for row in missed), missed[:3]

# AOML skips 1971-1982, which is most of HURDAT2's own marking gap and the
# window the inferred pass exists to recover, so candidates there are not
# scored as wrong answers.
inferred = validation["inferred"]
assert inferred["hurricane_strength_candidate_count"] == 10, inferred
assert inferred["unscoreable_candidate_count"] == 7, inferred
assert inferred["scoreable_candidate_count"] == 3, inferred
assert all(1971 <= year <= 1982 for year in inferred["unscoreable_years"]), inferred["unscoreable_years"]

states = [{
    "name": "Test",
    "bbox": (0, 0, 10, 10),
    "polys": [[[(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]]],
}]
track = [
    {"rec": "", "t": "2026-01-01T00:00:00Z", "lat": -1, "lon": 5, "wind": 70, "pres": 990, "status": "HU"},
    {"rec": "C", "t": "2026-01-01T06:00:00Z", "lat": 5, "lon": 5, "wind": 70, "pres": 990, "status": "HU"},
    {"rec": "", "t": "2026-01-01T12:00:00Z", "lat": -1, "lon": 5, "wind": 70, "pres": 990, "status": "HU"},
]
assert infer_landfall_candidates(track, states, "AL") == []

print("AOML landfall contracts ok (parser, metrics, marker filtering, and C guard)")
