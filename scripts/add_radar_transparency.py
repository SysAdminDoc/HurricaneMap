"""Post-process scraped IEM radar PNGs to add a tRNS chunk so palette index 0
(the solid-black "no echo" background) renders as transparent in the browser.

Why: src/radar.js used to rely on `mix-blend-mode: lighten` to fake out the
black background, which mostly worked over the dark basemap but washed out
city labels and coastline strokes inside the radar's bounding box. Adding
real transparency to the PNGs lets us drop the blend mode and have the
basemap (including labels) show through cleanly wherever there's no echo.

Run after scrape_radar.py, or whenever you've pulled fresh frames:

    python scripts/add_radar_transparency.py

Idempotent — files that already have transparency set are skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RADAR_DIR = ROOT / "data" / "radar"


def add_transparency(path: Path) -> bool:
    """Add tRNS chunk for palette index 0 if missing. Returns True if changed."""
    with Image.open(path) as img:
        if img.mode != "P":
            return False
        if img.info.get("transparency") == 0:
            return False  # already done
        # Sanity-check that index 0 is actually the black "no echo" entry.
        pal = img.getpalette()
        if not pal or (pal[0], pal[1], pal[2]) != (0, 0, 0):
            return False
        # Re-save with transparency=0. PIL writes a tRNS chunk pointing at index 0.
        img.save(path, optimize=True, transparency=0)
        return True


def main():
    if not RADAR_DIR.exists():
        print(f"No radar dir: {RADAR_DIR}", file=sys.stderr)
        return
    pngs = list(RADAR_DIR.rglob("*.png"))
    print(f"Scanning {len(pngs)} PNGs in {RADAR_DIR}…", file=sys.stderr)
    changed = 0
    skipped = 0
    failed = 0
    for i, p in enumerate(pngs, 1):
        try:
            if add_transparency(p):
                changed += 1
            else:
                skipped += 1
        except Exception as e:
            failed += 1
            print(f"  ! {p.name}: {e}", file=sys.stderr)
        if i % 200 == 0:
            print(f"  [{i}/{len(pngs)}]  changed={changed}  skipped={skipped}  failed={failed}", file=sys.stderr)
    print(f"Done. changed={changed}  skipped={skipped}  failed={failed}", file=sys.stderr)


if __name__ == "__main__":
    main()
