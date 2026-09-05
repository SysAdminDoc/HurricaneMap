import json
from pathlib import Path

from preprocess_hurdat2 import haversine_km, point_segment_distance_km


ROOT = Path(__file__).resolve().parent.parent
VECTORS = json.loads((ROOT / "tests" / "fixtures" / "geodesy-reference.json").read_text(encoding="utf-8"))
TOLERANCE_KM = 1e-6

for vector in VECTORS["distance_vectors"]:
    actual = haversine_km(*vector["from"], *vector["to"])
    assert abs(actual - vector["expected_km"]) <= TOLERANCE_KM, (vector["name"], actual)

for vector in VECTORS["segment_vectors"]:
    actual = point_segment_distance_km(
        *vector["point"],
        [vector["start"][1], vector["start"][0]],
        [vector["end"][1], vector["end"][0]],
    )
    assert abs(actual - vector["expected_km"]) <= TOLERANCE_KM, (vector["name"], actual)

# Long range is its own error class: an implementation can be exact across a
# basin and still run short across an ocean, which is what Tropycal disclosed at
# roughly 4.5% over 4000 km. These references were computed independently of
# this code, by two other formulas, so they catch that rather than record it.
LONG_BASELINES = [v for v in VECTORS["distance_vectors"] if v.get("long_baseline")]
assert len(LONG_BASELINES) >= 2, "the reference set must keep at least two long-baseline vectors"
for vector in LONG_BASELINES:
    assert vector["expected_km"] >= VECTORS["long_baseline_min_km"], (
        vector["name"],
        vector["expected_km"],
    )
    actual = haversine_km(*vector["from"], *vector["to"])
    assert abs(actual - vector["expected_km"]) <= TOLERANCE_KM, (vector["name"], actual)

print(
    f"python geodesy ok ({len(VECTORS['distance_vectors'])} distances, "
    f"{len(VECTORS['segment_vectors'])} segments, "
    f"{len(LONG_BASELINES)} long baselines to {TOLERANCE_KM} km)"
)
