"""Contract tests for deterministic HURDAT2 preprocessing provenance."""

import json
from pathlib import Path

from preprocess_hurdat2 import load_source_manifest, normalize_generated_at


ROOT = Path(__file__).resolve().parent.parent

assert normalize_generated_at("2026-08-02T00:00:00-04:00") == "2026-08-02T04:00:00Z"
assert normalize_generated_at("2026-08-02T00:00:00Z") == "2026-08-02T00:00:00Z"

try:
    normalize_generated_at("2026-08-02T00:00:00")
except ValueError:
    pass
else:
    raise AssertionError("naive timestamps must be rejected")

locked = load_source_manifest()
assert set(locked) == {
    "data/hurdat2-atlantic.txt",
    "data/hurdat2-nepac.txt",
}

metadata = json.loads((ROOT / "data/metadata.json").read_text(encoding="utf-8"))
assert metadata["generated_at_utc"] == "2026-08-02T00:00:00Z"
assert len(metadata["generator"]["source_commit"]) == 40
assert metadata["generator"]["source_manifest"] == "data/hurdat2-sources.json"
assert all("sha256" in output for output in metadata["outputs"].values())
assert all(source["sha256"] == locked[source["path"]]["sha256"] for source in metadata["sources"])

print("preprocess provenance ok (explicit timestamp, source lock, and output hashes)")
