"""Derive data/enso.json from the published CPC Oceanic Nino Index table.

The 76 per-year values used to be hand-entered and matched nothing in the source
they cited. Every contiguous three-month window of the CPC table was checked
against them on 2026-09-05: the closest, JJA+JAS, reproduced 6 of 76 years and
was out by as much as 0.26. So the numbers could not be refreshed, audited, or
even explained, and the "hand-maintained snapshot" could only ever be
re-stamped.

The derivation is now one sentence: each year takes the ONI anomaly for its
ASO season, August through October, which is the peak of the Atlantic hurricane
season and the window NOAA's own seasonal discussions quote. The phase follows
NOAA's thresholds, El Nino at or above +0.5 and La Nina at or below -0.5.

    python scripts/build_enso.py [--check] [--issued YYYY-MM-DD]

--check regenerates in memory and fails if the checked-in file differs, so the
file cannot drift from the table it claims to come from.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "oni.ascii.txt"
TARGET = ROOT / "data" / "enso.json"

# The season whose anomaly represents a hurricane season, and the thresholds
# NOAA uses to name a phase.
SEASON = "ASO"
EL_NINO = 0.5
LA_NINA = -0.5


def read_oni(text: str) -> dict[int, float]:
    """{year: ASO anomaly} from the fixed-width CPC table."""
    values: dict[int, float] = {}
    lines = text.splitlines()
    if not lines or lines[0].split()[:2] != ["SEAS", "YR"]:
        raise SystemExit(f"{SOURCE} does not start with the CPC ONI header")
    for line in lines[1:]:
        parts = line.split()
        if len(parts) != 4:
            continue
        season, year, _total, anomaly = parts
        if season != SEASON:
            continue
        values[int(year)] = float(anomaly)
    if not values:
        raise SystemExit(f"{SOURCE} holds no {SEASON} rows")
    return values


def phase_for(oni: float) -> str:
    if oni >= EL_NINO:
        return "el-nino"
    if oni <= LA_NINA:
        return "la-nina"
    return "neutral"


def render(meta: dict, values: dict[int, float]) -> str:
    """The file, formatted exactly as it is checked in."""
    lines = ["{", '  "_meta": {']
    meta_items = list(meta.items())
    for index, (key, value) in enumerate(meta_items):
        comma = "," if index < len(meta_items) - 1 else ""
        lines.append(f'    "{key}": {json.dumps(value)}{comma}')
    lines.append("  },")
    years = sorted(values)
    for index, year in enumerate(years):
        oni = values[year]
        comma = "," if index < len(years) - 1 else ""
        lines.append(f'  "{year}": {{ "oni": {oni:.2f}, "phase": "{phase_for(oni)}" }}{comma}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the checked-in file differs")
    parser.add_argument("--issued", help="the date data/oni.ascii.txt was retrieved")
    args = parser.parse_args()

    values = read_oni(SOURCE.read_text(encoding="utf-8"))
    existing = json.loads(TARGET.read_text(encoding="utf-8")) if TARGET.exists() else {}
    meta = dict(existing.get("_meta") or {})
    if args.issued:
        meta["issued"] = args.issued
    if not meta.get("issued"):
        raise SystemExit("data/enso.json has no _meta.issued; pass --issued with the retrieval date")

    rendered = render(meta, values)
    if args.check:
        current = TARGET.read_text(encoding="utf-8")
        if current != rendered:
            print(
                f"{TARGET.relative_to(ROOT)} does not match what {SOURCE.relative_to(ROOT)} derives. "
                "Re-run scripts/build_enso.py, or restore the source table.",
                file=sys.stderr,
            )
            return 1
        print(f"enso ok ({len(values)} years derived from the {SEASON} season, byte-identical)")
        return 0

    TARGET.write_text(rendered, encoding="utf-8")
    print(f"enso generated ({len(values)} years, {SEASON} season, phases at +-{EL_NINO})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
