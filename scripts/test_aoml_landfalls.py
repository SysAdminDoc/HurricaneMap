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
assert detected["record_count"] == 358, detected
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
assert inferred["hurricane_strength_candidate_count"] == 7, inferred
assert inferred["unscoreable_candidate_count"] == 7, inferred
# Nothing is left for AOML to score. The three it could adjudicate were
# the 1880 and 1886 Texas rows, which its own table marks "Mexico
# landfall first", and it scored all three wrong.
assert inferred["scoreable_candidate_count"] == 0, inferred
assert all(1971 <= year <= 1982 for year in inferred["unscoreable_years"]), inferred["unscoreable_years"]

states = [{
    "name": "Test",
    "bbox": (0, 0, 10, 10),
    "polys": [[[(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)]]],
}]
# A state sits on land, so the mask says so over the same square. Without it the
# inference would read the whole fixture as ocean and the C guard would be the
# only thing left standing between the track and a candidate, which is less than
# this is meant to prove.
mask = {"ring": [[0, 0], [10, 0], [10, 10], [0, 10]], "window": [0, 0, 10, 10]}
track = [
    {"rec": "", "t": "2026-01-01T00:00:00Z", "lat": -1, "lon": 5, "wind": 70, "pres": 990, "status": "HU"},
    {"rec": "C", "t": "2026-01-01T06:00:00Z", "lat": 5, "lon": 5, "wind": 70, "pres": 990, "status": "HU"},
    {"rec": "", "t": "2026-01-01T12:00:00Z", "lat": -1, "lon": 5, "wind": 70, "pres": 990, "status": "HU"},
]
assert infer_landfall_candidates(track, states, "AL", mask) == []

# --- the crossing rule ------------------------------------------------------
#
# A landfall belongs to the country the storm came ashore in. Reading "not
# inside a US state polygon" as "over water" put six landfalls in the atlas that
# were in Tamaulipas, and three more crossed the Rio Grande hours after coming
# ashore in Mexico. Both fixtures below are the same shape as that: a square of
# land with the state in one corner of it, so the state has a coast on two sides
# and an inland border on the other two.
LAND = {"ring": [[0, 0], [20, 0], [20, 20], [0, 20]], "window": [-1, -1, 21, 21]}
COASTAL_STATE = [{
    "name": "Coastal",
    "bbox": (10, 10, 20, 20),
    "polys": [[[(10, 10), (20, 10), (20, 20), (10, 20), (10, 10)]]],
}]


def fix(lat, lon, hours):
    return {
        "rec": "", "t": "2026-01-0%dT00:00:00Z" % (hours + 1),
        "lat": lat, "lon": lon, "wind": 70, "pres": 990, "status": "HU",
    }


# Ashore on the far coast, then inland across the state's land border. The
# crossing is at 0N 5E, more than a thousand kilometres from the state, so this
# is the Rio Grande case and it is not a landfall on this state.
overland = [fix(-5, 5, 0), fix(5, 5, 1), fix(15, 15, 2)]
assert infer_landfall_candidates(overland, COASTAL_STATE, "AL", LAND) == [], (
    "a track that came ashore a continent away and crossed a land border is not a landfall"
)

# The same state, entered from the sea over its own coast. The crossing is on
# the state boundary itself, so this one stands: without it the assertion above
# would pass for a rule that simply refuses everything.
from_the_sea = [fix(25, 15, 0), fix(15, 15, 1)]
coastal = infer_landfall_candidates(from_the_sea, COASTAL_STATE, "AL", LAND)
assert len(coastal) == 1, f"a track crossing the state's own coast is a landfall: {coastal}"
assert coastal[0]["state"] == "Coastal"
assert coastal[0]["inferred"] is True

# With no mask coverage the rule has nothing to judge and must not refuse: the
# window here excludes the whole fixture, which is what a track outside the
# mask's region looks like.
elsewhere = {"ring": LAND["ring"], "window": [100, 100, 110, 110]}
assert len(infer_landfall_candidates(from_the_sea, COASTAL_STATE, "AL", elsewhere)) == 1, (
    "a track the mask cannot speak to keeps the behaviour it had before the mask existed"
)

print("AOML landfall contracts ok (parser, metrics, marker filtering, C guard, and the crossing rule)")
