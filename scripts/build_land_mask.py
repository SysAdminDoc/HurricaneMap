#!/usr/bin/env python3
"""Build data/land-mask.json: the North American coastline, as one ring.

Why this exists. The landfall inference has to know whether the centre was over
water before it entered a US state polygon, and "not inside a US state" is not
that question: Mexico is not a US state either. Reading it that way put six
landfalls in the atlas that were really in Tamaulipas, and three more survive
the rules that replaced it because they cross the Rio Grande rather than a
coast.

Why one ring is the whole answer. The only land a storm can enter the United
States across is land contiguous with it, and Natural Earth holds the Americas
as a single polygon from Panama to Tierra del Fuego. Every island is left out on
purpose: a storm that crosses Cuba and then reaches Florida did cross water in
between, so reading Cuba as water gives the right answer and costs nothing.

The window. The ring is clipped to the region the inference can ask about, which
is a few six-hourly steps either side of a US state polygon, and the clip is
what keeps the file at a couple of hundred kilobytes instead of a megabyte.
Sutherland-Hodgman against a rectangle keeps one closed polygon, which is all
point-in-polygon needs. Outside the window the mask answers "water", and the
consumer never asks: the walk that finds a crossing stops at the first fix over
water, so it never leaves the coast it started from.

Source: Natural Earth 1:10m physical land, public domain, pinned to a release
tag rather than a branch so the hash below means something.

Usage: py -3.12 scripts/build_land_mask.py
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / "tmp" / "land-mask" / "ne_10m_land.geojson"
OUT_PATH = DATA / "land-mask.json"

SOURCE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "v5.1.2/geojson/ne_10m_land.geojson"
)
SOURCE_NAME = "Natural Earth 1:10m physical land, v5.1.2"
SOURCE_SHA256 = "1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416"

# lon_min, lat_min, lon_max, lat_max. Every entry transition in both basins has
# its previous fix inside lon -154.4..-64.6, lat 17.1..43.8, measured over the
# whole record, so this carries several degrees of margin on all four sides.
WINDOW = (-160.0, 10.0, -60.0, 60.0)

# A tenth of the 0.1-degree resolution HURDAT2 states its positions to, so the
# mask is finer than the fixes it judges. Coarser tolerances give the same
# verdicts; this one also keeps the crossing point it locates honest.
TOLERANCE_DEGREES = 0.01
COORDINATE_DECIMALS = 3

# Points the ring has to get right, checked before anything is written. Two of
# them are the cases this file exists for, and two are the ones a mask that was
# too coarse would break.
PROBES = [
    ("inland Tamaulipas", -97.8, 25.5, True),
    ("Nuevo Leon", -98.1, 25.6, True),
    ("inland Texas", -97.7, 26.2, True),
    ("Kansas", -98.0, 38.5, True),
    ("Danielle 1980 at 00Z", -94.9, 29.4, True),
    ("Gulf off Tamaulipas", -96.6, 25.3, False),
    ("open Gulf of Mexico", -90.0, 26.0, False),
    ("Galveston Bay", -94.9, 29.55, False),
    ("Atlantic off Hatteras", -74.0, 35.0, False),
    # The southern clip edge, where a dropped vertex left the ring wrong by
    # 8.76 km and no probe was looking.
    ("Venezuela at the clip edge", -70.0, 10.002, True),
    ("Colombia at the clip edge", -75.0, 10.008, True),
    ("Pacific off Panama at the clip edge", -80.0, 10.002, False),
]


def fetch_source() -> str:
    if CACHE.exists():
        text = CACHE.read_text(encoding="utf-8")
        if hashlib.sha256(text.encode("utf-8")).hexdigest() == SOURCE_SHA256:
            print(f"using cached {CACHE.name}", file=sys.stderr)
            return text
        print(f"cached {CACHE.name} does not match the pinned hash; refetching", file=sys.stderr)
    print(f"downloading {SOURCE_URL}", file=sys.stderr)
    with urllib.request.urlopen(SOURCE_URL) as response:
        raw = response.read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(
            f"{SOURCE_URL}\n  expected sha256 {SOURCE_SHA256}\n  got      sha256 {digest}\n"
            "The pinned release moved, which should be impossible for a tag. Review before trusting it."
        )
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(raw)
    return raw.decode("utf-8")


def point_in_ring(ring, lon: float, lat: float) -> bool:
    """Ray casting on [lon, lat] pairs."""
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def clip_to_window(ring, window):
    """Sutherland-Hodgman against a rectangle, one edge at a time."""
    lon_min, lat_min, lon_max, lat_max = window

    def cut_lon(a, b, x):
        return [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])]

    def cut_lat(a, b, y):
        return [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y]

    edges = [
        (lambda p: p[0] >= lon_min, lambda a, b: cut_lon(a, b, lon_min)),
        (lambda p: p[0] <= lon_max, lambda a, b: cut_lon(a, b, lon_max)),
        (lambda p: p[1] >= lat_min, lambda a, b: cut_lat(a, b, lat_min)),
        (lambda p: p[1] <= lat_max, lambda a, b: cut_lat(a, b, lat_max)),
    ]
    output = [list(point) for point in ring]
    for keep, cut in edges:
        current_input = output
        output = []
        for index in range(len(current_input)):
            current = current_input[index]
            previous = current_input[index - 1]
            if keep(current):
                if not keep(previous):
                    output.append(cut(previous, current))
                output.append(current)
            elif keep(previous):
                output.append(cut(previous, current))
        if not output:
            raise SystemExit("the clip window does not intersect the ring")
    return output


def _simplify_chain(chain, tolerance):
    """Douglas-Peucker on an open chain."""
    if len(chain) < 5:
        return chain
    keep = {0, len(chain) - 1}
    stack = [(0, len(chain) - 1)]
    while stack:
        first, last = stack.pop()
        x1, y1 = chain[first]
        x2, y2 = chain[last]
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy) or 1e-12
        worst = 0.0
        index = -1
        for i in range(first + 1, last):
            x, y = chain[i]
            distance = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length
            if distance > worst:
                worst = distance
                index = i
        if worst > tolerance and index > 0:
            keep.add(index)
            stack.append((first, index))
            stack.append((index, last))
    return [chain[i] for i in sorted(keep)]


def simplify_ring(ring, tolerance):
    """Simplify a ring by splitting it at its two most distant vertices.

    A ring cannot go through Douglas-Peucker in one piece: if it is closed the
    first and last points coincide, so the base segment has no length and every
    vertex measures infinitely far from it, and the ring comes back unchanged at
    every tolerance. Split it instead, simplify both halves, and rejoin.

    The ring is treated as open, which is what `clip_to_window` returns and what
    this writes: the closing edge is implicit. An earlier version dropped the
    last vertex on the way out, which left that implicit edge as a chord 22.7
    degrees long with no simplification behind it, and the mask wrong by 8.76 km
    across a band of the Caribbean.
    """
    if len(ring) < 8:
        return ring
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    far = max(range(1, len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
    head = _simplify_chain(ring[: far + 1], tolerance)
    tail = _simplify_chain(ring[far:], tolerance)
    return head + tail[1:]


def main() -> int:
    geo = json.loads(fetch_source())
    rings = []
    for feature in geo["features"]:
        geometry = feature["geometry"]
        parts = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for part in parts:
            rings.append(part[0])

    # Three interior points a continent apart, so this cannot pick up a lake
    # shore or an island that happens to contain one of them.
    americas = [
        ring for ring in rings
        if point_in_ring(ring, -100.0, 40.0)
        and point_in_ring(ring, -98.3, 25.9)
        and point_in_ring(ring, -60.0, -10.0)
    ]
    if len(americas) != 1:
        raise SystemExit(f"expected one ring holding North and South America, found {len(americas)}")
    print(f"Americas ring: {len(americas[0])} vertices", file=sys.stderr)

    clipped = clip_to_window(americas[0], WINDOW)
    simplified = simplify_ring(clipped, TOLERANCE_DEGREES)
    ring = [
        [round(lon, COORDINATE_DECIMALS), round(lat, COORDINATE_DECIMALS)]
        for lon, lat in simplified
    ]
    print(f"clipped and simplified: {len(ring)} vertices", file=sys.stderr)

    # Douglas-Peucker keeps a subsequence of what it is given and never moves a
    # vertex, so anything else means the simplifier lost or invented one. This
    # is the check the probe table below could not make: the vertex that went
    # missing was in the Caribbean, where no probe looks.
    pool = iter(clipped)
    for vertex in simplified:
        for candidate in pool:
            if candidate == vertex:
                break
        else:
            raise SystemExit(f"simplification produced {vertex}, which is not a vertex of the clipped ring")
    if simplified[0] != clipped[0] or simplified[-1] != clipped[-1]:
        raise SystemExit("simplification dropped an end of the ring, so the closing edge is unsimplified")

    wrong = [
        label for label, lon, lat, expected in PROBES
        if point_in_ring(ring, lon, lat) is not expected
    ]
    if wrong:
        raise SystemExit("the simplified ring answers wrongly for: " + ", ".join(wrong))
    print(f"{len(PROBES)} probes correct", file=sys.stderr)

    payload = {
        "schema_version": 1,
        "source": {
            "name": SOURCE_NAME,
            "url": SOURCE_URL,
            "sha256": SOURCE_SHA256,
            "license": "Public Domain",
        },
        "window": list(WINDOW),
        "tolerance_degrees": TOLERANCE_DEGREES,
        "note": (
            "The North American and South American mainland, as one ring, clipped to `window`. "
            "Islands are excluded on purpose: crossing one still means the storm reached the "
            "United States over water. Outside `window` this answers water, and the landfall "
            "inference never asks, because it stops walking at the first fix over water."
        ),
        "ring": ring,
    }
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"Wrote {OUT_PATH.relative_to(ROOT).as_posix()} ({size_kb:.1f} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
