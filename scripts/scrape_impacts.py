"""Pull deaths + damage figures for HurricaneMap's named storms from Wikipedia
infoboxes via the MediaWiki API. Output: data/impacts.json.

Strategy:
  - For every named storm in storms.json (skipping 'UNNAMED' / TS-only / pre-1900
    storms with no Wikipedia coverage), guess the canonical article title and
    fetch the page's wikitext via the MediaWiki API.
  - Parse the {{Infobox hurricane}} template's `Fatalities` and `Damages` fields.
  - Best-effort string extraction; cross-reference is up to the user via the
    existing 'Wikipedia' quicklink.

Output format:
  data/impacts.json = {
    "<storm_id>": {
      "deaths": "1,392 total",
      "damages": "$125 billion (2005 USD)",
      "wiki_title": "Hurricane Katrina",
      "wiki_url": "https://en.wikipedia.org/wiki/Hurricane_Katrina"
    }, ...
  }

Run anytime to refresh:  python scripts/scrape_impacts.py
"""

from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STORMS = DATA / "storms.json"
OUT = DATA / "impacts.json"

WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "HurricaneMap-ImpactsScraper/0.1 (https://github.com/SysAdminDoc/HurricaneMap)"


def http_get(url: str, timeout: int = 30) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def title_case(name: str) -> str:
    return name[0].upper() + name[1:].lower() if name else name


def candidate_titles(name: str, year: int) -> list[str]:
    """Generate likely Wikipedia article titles for a storm, in priority order."""
    if not name or name == "UNNAMED":
        return []
    n = title_case(name)
    return [
        f"Hurricane {n} ({year})",
        f"Tropical Storm {n} ({year})",
        f"Hurricane {n}",
        f"Tropical Storm {n}",
        f"Hurricane {n} ({year} Atlantic)",
    ]


def search_title(name: str, year: int) -> str | None:
    """Use MediaWiki's search to confirm an article exists."""
    for t in candidate_titles(name, year):
        params = urllib.parse.urlencode({
            "action": "query", "titles": t, "format": "json", "prop": "info",
        })
        url = f"{WIKI_API}?{params}"
        body = http_get(url)
        if not body:
            continue
        try:
            data = json.loads(body)
            pages = data.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                if pid != "-1" and "missing" not in page:
                    return page["title"]
        except json.JSONDecodeError:
            continue
    return None


def fetch_wikitext(title: str) -> str | None:
    params = urllib.parse.urlencode({
        "action": "parse", "page": title, "prop": "wikitext",
        "format": "json", "redirects": "1",
    })
    body = http_get(f"{WIKI_API}?{params}")
    if not body:
        return None
    try:
        data = json.loads(body)
        return data.get("parse", {}).get("wikitext", {}).get("*")
    except json.JSONDecodeError:
        return None


def extract_field(wikitext: str, field_names: list[str]) -> str | None:
    """Pull a value from an Infobox-style wikitext template by field name."""
    if not wikitext:
        return None
    for fname in field_names:
        # Match `| Fatalities = X` or `|Fatalities=X` allowing nested templates,
        # links, and references. We grab everything up to the next field marker.
        m = re.search(
            r"\|\s*" + re.escape(fname) + r"\s*=\s*(.*?)(?:\n\s*\||\n\s*\}\})",
            wikitext, re.DOTALL | re.IGNORECASE,
        )
        if m:
            val = m.group(1).strip()
            # Strip [[wiki|links]] → keep the display text.
            val = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", val)
            # Strip <ref>...</ref> footnotes.
            val = re.sub(r"<ref[^>]*>.*?</ref>", "", val, flags=re.DOTALL)
            val = re.sub(r"<ref[^/]*/>", "", val)
            # Strip remaining HTML tags.
            val = re.sub(r"<[^>]+>", "", val)
            # Collapse template formatters like {{nowrap|...}} → just the inner.
            val = re.sub(r"\{\{(?:nowrap|small|sortname|formatnum:|US\$|USD\|)([^}]+)\}\}", r"\1", val, flags=re.IGNORECASE)
            # Generic template strip: replace remaining {{...}} with empty.
            val = re.sub(r"\{\{[^}]*\}\}", "", val)
            val = re.sub(r"\s+", " ", val).strip()
            if val and val.lower() not in ("none", "—", "-", "n/a", ""):
                return val[:200]
    return None


def extract_impacts(wikitext: str) -> dict | None:
    if not wikitext:
        return None
    deaths = extract_field(wikitext, ["Fatalities", "Deaths", "Casualties"])
    damage = extract_field(wikitext, ["Damages", "Damage", "Damages (USD)"])
    if not deaths and not damage:
        return None
    out = {}
    if deaths: out["deaths"] = deaths
    if damage: out["damages"] = damage
    return out


def scrape_one(storm) -> tuple[str, dict | None]:
    name = storm.get("name", "")
    year = storm.get("year", 0)
    sid = storm["id"]
    if not name or name == "UNNAMED" or year < 1900:
        return sid, None
    title = search_title(name, year)
    if not title:
        return sid, None
    wikitext = fetch_wikitext(title)
    impacts = extract_impacts(wikitext)
    if not impacts:
        return sid, None
    impacts["wiki_title"] = title
    impacts["wiki_url"] = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
    return sid, impacts


def main():
    storms = json.loads(STORMS.read_text())
    eligible = [s for s in storms if s.get("name") and s["name"] != "UNNAMED" and s["year"] >= 1900]
    print(f"Scraping {len(eligible)} candidate storms...", file=sys.stderr)

    out = {}
    if OUT.exists():
        try:
            out = json.loads(OUT.read_text())
        except json.JSONDecodeError:
            out = {}

    started = time.time()
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = [ex.submit(scrape_one, s) for s in eligible if s["id"] not in out]
        for i, fut in enumerate(as_completed(futures)):
            try:
                sid, impacts = fut.result()
            except Exception:
                continue
            if impacts:
                out[sid] = impacts
            if (i + 1) % 25 == 0:
                rate = (i + 1) / max(time.time() - started, 0.01)
                print(f"  [{i+1}/{len(futures)}] hits={len(out)} ({rate:.1f}/s)", file=sys.stderr)

    # Sort and write.
    out_sorted = {k: out[k] for k in sorted(out)}
    OUT.write_text(json.dumps(out_sorted, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Done. Found impacts for {len(out_sorted)} storms.", file=sys.stderr)
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
