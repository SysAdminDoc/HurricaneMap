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
assert payload["validation"]["detected"] == {
    "record_count": 16,
    "matched_count": 16,
    "precision": 1.0,
    "recall": 1.0,
}
assert payload["validation"]["inferred"]["candidate_count"] == 3
assert payload["validation"]["inferred"]["hurricane_strength_candidate_count"] == 0

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
