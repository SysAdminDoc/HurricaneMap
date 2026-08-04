"""Scrape the Iowa State IEM NEXRAD composite archive so HurricaneMap works
fully offline.

For every storm that has at least one in-coverage TS+ track point, this
fetches:
  - The primary frame at every U.S. landfall (with walkback if a 5-min slot
    is missing).
  - One frame per HURDAT2 synoptic track point while the storm is over a
    radar-covered region (CONUS / HI / PR) at TS+ intensity.

Coverage windows (matches src/radar.js):
  uscomp / n0r:  Aug 1995 onward   (CONUS)
  hicomp / n0q:  2010 onward       (Hawaii)
  prcomp / n0q:  2010 onward       (Puerto Rico)

Storage layout:
  data/radar/<Name>-<Year>/t_YYYYMMDDHHMM.png       e.g. Katrina-2005/t_200508291110.png
  data/radar/manifest.json                          unified index keyed by storm_id

The manifest is what src/radar.js consults at runtime to decide whether
to serve a local frame or fall back to IEM's archived XYZ tiles. This
scraper intentionally keeps downloading the full GIS PNG endpoint: those
files are the immutable offline path and are not replaced by remote tiles.

Flags:
  --cadence MIN       Densify track-point fetches to MIN-minute cadence by
                      interpolating between HURDAT2 records. Default = 360
                      (native 6-hourly HURDAT2). 60 (hourly) ~6x more frames.
  --hurricane-only    Only storms that landed at Cat 1+ (peak landfall cat).
  --major-only        Only storms that landed at Cat 3+.
  --landfalls-only    Skip the full-track expansion; fetch only landfall frames
                      (the original v0.1.0 behavior, ~35 MB).
  --start YYYY        Only storms in/after this year.
  --end YYYY          Only storms in/before this year.
  --force             Re-download even if the local file exists.
  --concurrency N     Parallel HTTP fetches (default 8).
  --dry-run           Print task count + estimated MB, don't download.

Estimated sizes at native (--cadence 360):
  All covered storms:     ~330 MB   (~1700 frames)
  --hurricane-only:       ~195 MB   (~990 frames)
  --major-only:            ~68 MB   (~350 frames)
  --landfalls-only:        ~35 MB   (181 frames)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RADAR_DIR = DATA / "radar"
MANIFEST = RADAR_DIR / "manifest.json"

LANDFALLS = DATA / "landfalls.json"
STORMS = DATA / "storms.json"

# Local archive downloads remain full georeferenced PNGs. The browser's
# online fallback uses the stable /c/tile.py/1.0.0 endpoint instead.
IEM_ARCHIVE_ROOT = "https://mesonet.agron.iastate.edu/archive/data"

# Region: (folder, product, earliest_year, lat_min, lat_max, lon_min, lon_max)
REGIONS = [
    ("uscomp", "n0r", 1995, 24.0, 50.0, -126.0, -66.0),
    ("hicomp", "n0q", 2010, 15.4, 24.5, -162.4, -152.4),
    ("prcomp", "n0q", 2010, 13.0, 23.1, -71.07, -61.0),
]

USER_AGENT = "HurricaneMap-RadarScraper/0.2 (+https://github.com/SysAdminDoc/HurricaneMap)"


def region_for_point(lat: float, lon: float, year: int):
    """Return the (folder, product) for the radar region that covers this point,
    or None if the point isn't in any radar coverage area for this year."""
    for folder, product, earliest, latmin, latmax, lonmin, lonmax in REGIONS:
        if year < earliest:
            continue
        if latmin <= lat <= latmax and lonmin <= lon <= lonmax:
            return folder, product
    return None


def round_to_minutes(dt: datetime, mins: int) -> datetime:
    epoch = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    step_s = mins * 60
    rounded = (int(epoch.timestamp()) // step_s) * step_s
    return datetime.fromtimestamp(rounded, tz=timezone.utc)


def build_url(region: str, product: str, dt: datetime) -> str:
    stamp = dt.strftime("%Y%m%d%H%M")
    return f"{IEM_ARCHIVE_ROOT}/{dt.year:04d}/{dt.month:02d}/{dt.day:02d}/GIS/{region}/{product}_{stamp}.png"


def head_ok(url: str, timeout: int = 15) -> bool:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return False


def find_nearest(region: str, product: str, target: datetime, max_min: int = 60) -> Optional[datetime]:
    probe = round_to_minutes(target, 5)
    for _ in range(max_min // 5 + 1):
        if head_ok(build_url(region, product, probe)):
            return probe
        probe -= timedelta(minutes=5)
    probe = round_to_minutes(target, 60)
    for _ in range(4):
        if head_ok(build_url(region, product, probe)):
            return probe
        probe -= timedelta(hours=1)
    return None


def download(url: str, dest: Path, timeout: int = 60) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if len(data) < 200:
            return False
        dest.write_bytes(data)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return False
    add_transparency_inplace(dest)
    return True


def add_transparency_inplace(path: Path) -> None:
    """Re-save the PNG with a tRNS chunk on palette index 0 so the black
    "no echo" background renders as transparent in the browser. Skips files
    that aren't paletted-with-black-at-index-0 (e.g. truecolor PNGs)."""
    try:
        from PIL import Image
    except ImportError:
        return
    try:
        with Image.open(path) as img:
            if img.mode != "P" or img.info.get("transparency") == 0:
                return
            pal = img.getpalette()
            if not pal or (pal[0], pal[1], pal[2]) != (0, 0, 0):
                return
            img.save(path, optimize=True, transparency=0)
    except Exception:
        # If anything goes wrong, leave the original PNG in place — the
        # CSS blend-mode fallback in radar.js will still render it correctly.
        pass


def parse_iso(iso: str) -> datetime:
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    return datetime.fromisoformat(iso)


def storm_dirname(name: str, year: int, storm_id: str) -> str:
    name = (name or "UNNAMED").strip().upper()
    if name == "UNNAMED" or not name:
        return f"Unnamed-{year}-{storm_id}"
    return f"{name.title()}-{year}"


def collect_targets(args) -> list:
    """Build the list of (storm_meta, target_dt, region, product, kind, lf_idx) tuples.
    `kind` is 'landfall' or 'track'. Multiple targets can share a timestamp;
    we de-duplicate by exact timestamp before downloading."""
    storms = json.loads(STORMS.read_text())
    targets = []

    for s in storms:
        # Storm-level filters.
        if args.hurricane_only and s["landfall_max_category"] < 1:
            continue
        if args.major_only and s["landfall_max_category"] < 3:
            continue
        if args.start and s["year"] < args.start:
            continue
        if args.end and s["year"] > args.end:
            continue

        sub = storm_dirname(s["name"], s["year"], s["id"])
        meta = {"storm_id": s["id"], "name": s["name"], "year": s["year"], "dir": sub}

        # Landfall frames (with walkback).
        landfall_targets = []
        for lf_idx, lf in enumerate(s["us_landfalls"]):
            r = region_for_point(lf["lat"], lf["lon"], s["year"])
            if not r:
                continue
            region, product = r
            target = parse_iso(lf["t"])
            landfall_targets.append((meta, target, region, product, "landfall", lf_idx))
        targets.extend(landfall_targets)

        if args.landfalls_only:
            continue

        # Track-point frames at args.cadence (default 360 min = native 6-hourly).
        # Walk consecutive HURDAT2 records and emit at cadence intervals,
        # interpolating position so we know which region to query.
        track = s["track"]
        for i, rec in enumerate(track):
            if rec["status"] not in ("HU", "TS", "SS"):
                continue
            r = region_for_point(rec["lat"], rec["lon"], s["year"])
            if not r:
                continue
            region, product = r
            t = parse_iso(rec["t"])
            targets.append((meta, t, region, product, "track", -1))

            # Optional densification between this record and the next.
            if args.cadence < 360 and i < len(track) - 1:
                nxt = track[i + 1]
                if nxt["status"] not in ("HU", "TS", "SS"):
                    continue
                nt = parse_iso(nxt["t"])
                step = timedelta(minutes=args.cadence)
                cur = t + step
                while cur < nt:
                    f = (cur - t).total_seconds() / max((nt - t).total_seconds(), 1)
                    lat = rec["lat"] + (nxt["lat"] - rec["lat"]) * f
                    lon = rec["lon"] + (nxt["lon"] - rec["lon"]) * f
                    r2 = region_for_point(lat, lon, s["year"])
                    if r2:
                        targets.append((meta, cur, r2[0], r2[1], "track", -1))
                    cur += step
    return targets


def scrape_one(task, force=False) -> dict:
    meta, target, region, product, kind, lf_idx = task
    sub = meta["dir"]

    if kind == "landfall":
        # Walk back to find a frame near the landfall time.
        found = find_nearest(region, product, target)
        if not found:
            return {"missing": True, "kind": kind, "storm_id": meta["storm_id"], "lf_idx": lf_idx,
                    "name": meta["name"], "year": meta["year"]}
    else:
        # Track points: just try the rounded 5-min slot, no walkback.
        found = round_to_minutes(target, 5)

    stamp = found.strftime("%Y%m%d%H%M")
    fname = f"t_{stamp}.png"
    rel = f"{sub}/{fname}"
    dest = RADAR_DIR / sub / fname

    record = {
        "kind": kind,
        "storm_id": meta["storm_id"],
        "name": meta["name"],
        "year": meta["year"],
        "dir": sub,
        "region": region,
        "ts": stamp,
        "file": rel,
        "lf_idx": lf_idx,
    }

    if dest.exists() and not force:
        record["skipped"] = True
        return record
    url = build_url(region, product, found)
    if download(url, dest):
        record["downloaded"] = True
        return record
    return {"missing": True, "kind": kind, "storm_id": meta["storm_id"], "lf_idx": lf_idx,
            "name": meta["name"], "year": meta["year"]}


def deduplicate(targets):
    """Two targets with the same (storm_id, ts) point at the same file. Keep
    the landfall variant if both kinds reference a slot, so the lf_idx is
    captured in the manifest."""
    by_key = {}
    for t in targets:
        meta, dt, region, product, kind, lf_idx = t
        # Round to 5 min for the dedup key (matches what we'd actually fetch).
        ts = round_to_minutes(dt, 5).strftime("%Y%m%d%H%M")
        key = (meta["storm_id"], ts, region)
        if key not in by_key:
            by_key[key] = t
        elif kind == "landfall":
            by_key[key] = t  # prefer landfall metadata
    return list(by_key.values())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cadence", type=int, default=360, help="Track densification cadence in minutes (default 360 = native 6-hourly)")
    ap.add_argument("--hurricane-only", action="store_true")
    ap.add_argument("--major-only", action="store_true")
    ap.add_argument("--landfalls-only", action="store_true")
    ap.add_argument("--start", type=int, default=None)
    ap.add_argument("--end", type=int, default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    targets = collect_targets(args)
    targets = deduplicate(targets)
    print(f"Frames to fetch: {len(targets)}", file=sys.stderr)
    print(f"  Estimated download size at 200 KB/frame: ~{len(targets) * 200 / 1024:.0f} MB", file=sys.stderr)
    if args.dry_run:
        return

    RADAR_DIR.mkdir(parents=True, exist_ok=True)

    # Storm-level manifest: { storm_id: { name, year, dir, region, landfalls: {idx: ts}, frames: {ts: file} } }
    manifest = {}
    if MANIFEST.exists():
        try:
            manifest = json.loads(MANIFEST.read_text())
        except json.JSONDecodeError:
            manifest = {}

    completed = 0
    skipped = 0
    missing = 0
    started = time.time()

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = [ex.submit(scrape_one, t, args.force) for t in targets]
        for fut in as_completed(futures):
            res = fut.result()
            if res.get("missing"):
                missing += 1
                continue
            entry = manifest.setdefault(res["storm_id"], {
                "name": res["name"],
                "year": res["year"],
                "dir": res["dir"],
                "region": res.get("region"),
                "landfalls": {},
                "frames": {},
            })
            if res.get("region"):
                entry["region"] = res["region"]  # last write wins; usually consistent
            entry["frames"][res["ts"]] = res["file"]
            if res["kind"] == "landfall":
                entry["landfalls"][str(res["lf_idx"])] = res["ts"]
            if res.get("skipped"):
                skipped += 1
            elif res.get("downloaded"):
                completed += 1
            done = completed + skipped + missing
            if done % 50 == 0:
                rate = done / max(time.time() - started, 0.01)
                print(f"  [{done}/{len(targets)}]  ok={completed}  skip={skipped}  miss={missing}  ({rate:.1f}/s)", file=sys.stderr)

    # Sort everything for stable diffs.
    manifest_sorted = {}
    for sid in sorted(manifest):
        e = manifest[sid]
        e["landfalls"] = {k: e["landfalls"][k] for k in sorted(e["landfalls"], key=int)}
        e["frames"] = {k: e["frames"][k] for k in sorted(e["frames"])}
        manifest_sorted[sid] = e
    MANIFEST.write_text(json.dumps(manifest_sorted, indent=2, sort_keys=False))

    pngs = list(RADAR_DIR.rglob("*.png"))
    total_size = sum(p.stat().st_size for p in pngs)
    print(f"\nFinished. Downloaded={completed}  Skipped={skipped}  Missing={missing}", file=sys.stderr)
    print(f"On disk: {total_size / 1024 / 1024:.1f} MB across {len(pngs)} files", file=sys.stderr)
    print(f"Manifest: {MANIFEST}", file=sys.stderr)


if __name__ == "__main__":
    main()
