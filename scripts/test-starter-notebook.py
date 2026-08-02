"""Execute the starter notebook against the checked-in release without network access."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
NOTEBOOK = ROOT / "notebooks" / "analysis-starter.ipynb"
EXPECTED_COUNTS = {
    "storm_count": 595,
    "landfall_event_count": 759,
    "hurricane_landfall_count": 374,
}
NOTEBOOK_PACKAGES = ("nbclient", "nbformat", "numpy", "pandas", "matplotlib")
PROVENANCE_FILES = ("data/landfalls.json", "data/metadata.json", "data/storms.json")
OFFLINE_GUARD = """
import socket
def _hurricanemap_network_blocked(*args, **kwargs):
    raise RuntimeError("network access is disabled for the starter-notebook release check")
socket.socket.connect = _hurricanemap_network_blocked
socket.create_connection = _hurricanemap_network_blocked
try:
    import urllib.request
    urllib.request.urlopen = _hurricanemap_network_blocked
except ImportError:
    pass
"""


def _load_json(relative: str) -> Any:
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_release_data() -> dict[str, Any]:
    """Validate the notebook's documented rows and release provenance."""

    landfalls = _load_json("data/landfalls.json")
    storms = _load_json("data/storms.json")
    metadata = _load_json("data/metadata.json")
    release_manifest = _load_json("data/release-manifest.json")

    counts = {
        "storm_count": len(storms),
        "landfall_event_count": len(landfalls),
        "hurricane_landfall_count": sum(int(row.get("category", 0)) >= 1 for row in landfalls),
    }
    if counts != EXPECTED_COUNTS:
        raise AssertionError(f"data counts {counts} do not match {EXPECTED_COUNTS}")

    coverage = metadata.get("coverage", {})
    for key, expected in EXPECTED_COUNTS.items():
        metadata_key = key
        if coverage.get(metadata_key) != expected:
            raise AssertionError(f"metadata coverage {metadata_key} is {coverage.get(metadata_key)!r}, expected {expected}")

    generated_at = metadata.get("generated_at_utc")
    source_commit = metadata.get("generator", {}).get("source_commit")
    if not generated_at or not source_commit or metadata.get("generator", {}).get("source_manifest") != "data/hurdat2-sources.json":
        raise AssertionError("metadata is missing the locked generator provenance fields")
    if release_manifest.get("generated_at_utc") != generated_at:
        raise AssertionError("release manifest and metadata timestamps differ")
    if release_manifest.get("source_commit") != source_commit:
        raise AssertionError("release manifest and metadata source commits differ")

    artifacts = {record.get("path"): record for record in release_manifest.get("artifacts", [])}
    verified_artifacts = {}
    for relative in PROVENANCE_FILES:
        record = artifacts.get(relative)
        path = ROOT / relative
        if not record:
            raise AssertionError(f"release manifest has no record for {relative}")
        for field in ("bytes", "sha256", "source_url", "source_date", "generated_at_utc", "schema_version"):
            if record.get(field) in (None, ""):
                raise AssertionError(f"release manifest record for {relative} is missing {field}")
        actual_bytes = path.stat().st_size
        actual_sha256 = _sha256(path)
        if record["bytes"] != actual_bytes or record["sha256"] != actual_sha256:
            raise AssertionError(f"release manifest checksum mismatch for {relative}")
        verified_artifacts[relative] = {
            "bytes": actual_bytes,
            "sha256": actual_sha256,
            "source_date": record["source_date"],
        }

    return {
        **counts,
        "generated_at_utc": generated_at,
        "source_commit": source_commit,
        "release_manifest_sha256": _sha256(ROOT / "data" / "release-manifest.json"),
        "artifacts": verified_artifacts,
    }


def _missing_notebook_packages() -> list[str]:
    missing = []
    for package in NOTEBOOK_PACKAGES:
        try:
            __import__(package)
        except ImportError:
            missing.append(package)
    return missing


def _execute_notebook(output_dir: Path) -> str:
    import nbformat
    from nbclient import NotebookClient

    notebook = nbformat.read(NOTEBOOK, as_version=4)
    notebook.cells.insert(0, nbformat.v4.new_code_cell(OFFLINE_GUARD))
    previous_environment = {}
    environment = {
        "HURRICANEMAP_NOTEBOOK_ROOT": str(ROOT),
        "HURRICANEMAP_NOTEBOOK_OUTPUT": str(output_dir),
        "MPLBACKEND": "Agg",
        "PYTHONHASHSEED": "0",
    }
    for key, value in environment.items():
        previous_environment[key] = os.environ.get(key)
        os.environ[key] = value
    try:
        client = NotebookClient(
            notebook,
            timeout=180,
            kernel_name="python3",
            resources={"metadata": {"path": str(ROOT)}},
        )
        client.execute()
    finally:
        for key, value in previous_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    export_path = output_dir / "major_hurricanes_landfalls.csv"
    if not export_path.is_file():
        raise AssertionError("notebook did not produce major_hurricanes_landfalls.csv")
    return _sha256(export_path)


def execute_release_check(data_report: dict[str, Any]) -> int:
    missing = _missing_notebook_packages()
    if missing:
        print(
            "starter notebook execution skipped: optional notebook packages missing "
            f"({', '.join(missing)}); data contract and provenance passed"
        )
        print(json.dumps(data_report, sort_keys=True))
        return 0

    try:
        with tempfile.TemporaryDirectory(prefix="hurricanemap-notebook-") as first_temp, tempfile.TemporaryDirectory(
            prefix="hurricanemap-notebook-"
        ) as second_temp:
            first_output = Path(first_temp)
            second_output = Path(second_temp)
            first_hash = _execute_notebook(first_output)
            second_hash = _execute_notebook(second_output)
            if first_hash != second_hash:
                raise AssertionError("notebook CSV output is not deterministic across isolated runs")
            report = {
                "data": data_report,
                "export_sha256": first_hash,
                "notebook": "notebooks/analysis-starter.ipynb",
            }
            report_text = json.dumps(report, indent=2, sort_keys=True) + "\n"
            (first_output / "verification.json").write_text(report_text, encoding="utf-8")
            if json.loads((first_output / "verification.json").read_text(encoding="utf-8")) != report:
                raise AssertionError("disposable verification output could not be read back")
    except Exception as error:  # noqa: BLE001 - preserve a concise release-gate failure
        print(f"starter notebook execution failure: {error}", file=sys.stderr)
        return 1

    print(
        "starter notebook verification ok "
        f"({data_report['storm_count']} storms, {data_report['landfall_event_count']} landfalls, "
        f"{data_report['hurricane_landfall_count']} hurricane-strength landfalls, deterministic CSV)"
    )
    return 0


def main() -> int:
    try:
        data_report = validate_release_data()
    except Exception as error:  # noqa: BLE001 - turn data failures into a distinct diagnostic
        print(f"starter notebook data failure: {error}", file=sys.stderr)
        return 1
    return execute_release_check(data_report)


if __name__ == "__main__":
    raise SystemExit(main())
