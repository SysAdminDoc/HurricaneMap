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

print(f"python geodesy ok ({len(VECTORS['distance_vectors'])} distances, {len(VECTORS['segment_vectors'])} segments)")
